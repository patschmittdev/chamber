import { describe, expect, it, vi } from 'vitest';

import type {
  OperatorActivitySnapshot,
  OperatorBudgetWarningState,
  OperatorMindActivity,
  OperatorUsageSample,
} from '@chamber/shared/operator-activity-types';
import {
  createEmptyOperatorActivitySnapshot,
  InMemoryOperatorActivityStore,
  OperatorActivityService,
  type OperatorActivityStore,
} from './OperatorActivityService';

class FakeStore implements OperatorActivityStore {
  saved: OperatorActivitySnapshot | null = null;
  saveCalls = 0;

  async load(): Promise<OperatorActivitySnapshot | null> {
    return this.saved;
  }

  async save(snapshot: OperatorActivitySnapshot): Promise<void> {
    this.saveCalls += 1;
    this.saved = snapshot;
  }
}

const now = () => '2026-07-12T12:00:00.000Z';

describe('OperatorActivityService', () => {
  it('returns an empty snapshot when the store has no state', async () => {
    const service = new OperatorActivityService({ store: new FakeStore(), now });

    await expect(service.getSnapshot()).resolves.toEqual(createEmptyOperatorActivitySnapshot(now()));
  });

  it('records mind activity and chatroom progress through the injected store', async () => {
    const store = new FakeStore();
    const service = new OperatorActivityService({ store, now });
    const listener = vi.fn();
    service.subscribeChanged(listener);

    await service.recordMindActivity({
      mindId: 'mind-1',
      displayName: 'Planner',
      phase: 'thinking',
      progress: { state: 'in-progress', completedSteps: 1, totalSteps: 3, updatedAt: now() },
      updatedAt: now(),
    });
    await service.setChatroomRun({
      runId: 'run-1',
      roundId: 'round-1',
      mode: 'group-chat',
      state: 'running',
      activeSpeaker: {
        mindId: 'mind-1',
        displayName: 'Planner',
        phase: 'responding',
        startedAt: now(),
        updatedAt: now(),
      },
      updatedAt: now(),
    });

    expect(store.saved?.mindActivities).toHaveLength(1);
    expect(store.saved?.chatroom.state).toBe('running');
    expect(store.saved?.chatroom.activeSpeaker?.mindId).toBe('mind-1');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('preserves observed, estimated, and unavailable usage samples without upgrading unavailable data', async () => {
    const service = new OperatorActivityService({ store: new InMemoryOperatorActivityStore(), now });
    const observed: OperatorUsageSample = {
      sampleId: 'observed-1',
      quality: 'observed',
      subject: { scope: 'mind', mindId: 'mind-1' },
      tokens: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: { amount: 0.01, currency: 'USD' },
      recordedAt: now(),
    };
    const estimated: OperatorUsageSample = {
      sampleId: 'estimated-1',
      quality: 'estimated',
      estimationMethod: 'heuristic',
      subject: { scope: 'run', runId: 'run-1' },
      tokens: { totalTokens: 100 },
      recordedAt: now(),
    };
    const unavailable: OperatorUsageSample = {
      sampleId: 'unavailable-1',
      quality: 'unavailable',
      reason: 'provider-omitted',
      subject: { scope: 'chatroom', roundId: 'round-1' },
      recordedAt: now(),
    };

    await service.recordUsageSample(observed);
    await service.recordUsageSample(estimated);
    await service.recordUsageSample(unavailable);

    const snapshot = await service.getSnapshot();
    expect(snapshot.usageSamples.map((sample) => sample.quality)).toEqual([
      'observed',
      'estimated',
      'unavailable',
    ]);
    expect(snapshot.usageSamples[2]).toEqual(unavailable);
  });

  it('stores usage rollups and budget warning states with their explicit quality basis', async () => {
    const service = new OperatorActivityService({ store: new InMemoryOperatorActivityStore(), now });
    const warning: OperatorBudgetWarningState = {
      budgetId: 'daily',
      subject: { scope: 'chatroom' },
      status: 'approaching-limit',
      severity: 'warning',
      basis: 'estimated',
      thresholdPercent: 80,
      percentUsed: 84,
      updatedAt: now(),
    };

    await service.setUsageRollup({
      rollupId: 'round-1',
      subject: { scope: 'chatroom', roundId: 'round-1' },
      window: { startedAt: now() },
      quality: 'estimated',
      samples: { observed: 0, estimated: 1, unavailable: 0, total: 1 },
      totals: { tokens: { totalTokens: 200 } },
      updatedAt: now(),
    });
    await service.setBudgetWarning(warning);

    const snapshot = await service.getSnapshot();
    expect(snapshot.usageRollups[0].quality).toBe('estimated');
    expect(snapshot.budgetWarnings[0]).toEqual(warning);
  });

  it('rejects unavailable rollups that carry exact totals', async () => {
    const store = new FakeStore();
    const service = new OperatorActivityService({ store, now });

    await expect(service.setUsageRollup({
      rollupId: 'round-1',
      subject: { scope: 'chatroom', roundId: 'round-1' },
      window: { startedAt: now() },
      quality: 'unavailable',
      samples: { observed: 0, estimated: 0, unavailable: 1, total: 1 },
      totals: { cost: { amount: 1.23, currency: 'USD' } },
      updatedAt: now(),
    } as never)).rejects.toThrow(/totals/);
    expect(store.saveCalls).toBe(0);
  });

  it('rejects unavailable budget warnings that carry consumed or percent-used claims', async () => {
    const store = new FakeStore();
    const service = new OperatorActivityService({ store, now });

    await expect(service.setBudgetWarning({
      budgetId: 'daily',
      subject: { scope: 'chatroom' },
      status: 'unavailable',
      severity: 'info',
      basis: 'unavailable',
      percentUsed: 42,
      consumed: { amount: 1.23, currency: 'USD' },
      updatedAt: now(),
    } as never)).rejects.toThrow(/percentUsed/);
    expect(store.saveCalls).toBe(0);
  });

  it('rejects unavailable budget status when the basis claims observed usage', async () => {
    const store = new FakeStore();
    const service = new OperatorActivityService({ store, now });

    await expect(service.setBudgetWarning({
      budgetId: 'daily',
      subject: { scope: 'chatroom' },
      status: 'unavailable',
      severity: 'info',
      basis: 'observed',
      consumed: { amount: 1.23, currency: 'USD' },
      updatedAt: now(),
    } as never)).rejects.toThrow(/basis/);
    expect(store.saveCalls).toBe(0);
  });

  it('serializes concurrent snapshot mutations so parallel producers do not overwrite each other', async () => {
    const service = new OperatorActivityService({ store: new InMemoryOperatorActivityStore(), now });
    const first: OperatorMindActivity = {
      mindId: 'mind-1',
      phase: 'thinking',
      updatedAt: now(),
    };
    const second: OperatorMindActivity = {
      mindId: 'mind-2',
      phase: 'using-tools',
      updatedAt: now(),
    };

    await Promise.all([
      service.recordMindActivity(first),
      service.recordMindActivity(second),
    ]);

    await expect(service.getSnapshot()).resolves.toMatchObject({
      mindActivities: [first, second],
    });
  });

  it('rejects sensitive persistence fields before saving', async () => {
    const store = new FakeStore();
    const service = new OperatorActivityService({ store, now });
    const activity = {
      mindId: 'mind-1',
      phase: 'thinking',
      prompt: 'secret user request',
      updatedAt: now(),
    } as unknown as OperatorMindActivity;

    await expect(service.recordMindActivity(activity)).rejects.toThrow(/forbidden persistence field "prompt"/);
    expect(store.saveCalls).toBe(0);
  });

  it('rejects raw tool payload and chain-of-thought fields in snapshots', async () => {
    const store = new FakeStore();
    const service = new OperatorActivityService({ store, now });
    const snapshot = {
      ...createEmptyOperatorActivitySnapshot(now()),
      usageSamples: [
        {
          sampleId: 'sample-1',
          quality: 'observed',
          subject: { scope: 'mind', mindId: 'mind-1' },
          rawToolPayload: { token: 'secret' },
          chainOfThought: 'private reasoning',
          recordedAt: now(),
        },
      ],
    } as unknown as OperatorActivitySnapshot;

    await expect(service.replaceSnapshot(snapshot)).rejects.toThrow(/forbidden persistence field/);
    expect(store.saveCalls).toBe(0);
  });
});
