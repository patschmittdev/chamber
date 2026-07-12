import { describe, expect, expectTypeOf, it } from 'vitest';

import type {
  OperatorActivityAPI,
  OperatorActivityPhase,
  OperatorActivitySnapshot,
  OperatorBudgetWarningState,
  OperatorChatroomRunActivity,
  OperatorChatroomRunState,
  OperatorMindActivity,
  OperatorProgressSignal,
  OperatorUsageQuality,
  OperatorUsageRollup,
  OperatorUsageSample,
} from './operator-activity-types';
import {
  OPERATOR_ACTIVITY_PHASES,
  OPERATOR_BUDGET_WARNING_STATUSES,
  OPERATOR_CHATROOM_RUN_STATES,
  OPERATOR_USAGE_QUALITIES,
} from './operator-activity-types';

describe('operator activity contracts', () => {
  it('pins mind activity phases and chatroom run states', () => {
    expect(OPERATOR_ACTIVITY_PHASES).toEqual([
      'idle',
      'queued',
      'starting',
      'thinking',
      'waiting',
      'using-tools',
      'responding',
      'complete',
      'failed',
      'cancelled',
    ]);
    expect(OPERATOR_CHATROOM_RUN_STATES).toContain('waiting-for-approval');
    expectTypeOf<'using-tools'>().toMatchTypeOf<OperatorActivityPhase>();
    expectTypeOf<'running'>().toMatchTypeOf<OperatorChatroomRunState>();
  });

  it('represents progress and active speaker signals without prompt or output text', () => {
    expectTypeOf<OperatorProgressSignal['completedSteps']>().toEqualTypeOf<number | undefined>();
    expectTypeOf<OperatorChatroomRunActivity['activeSpeaker']>().toMatchTypeOf<
      | {
        readonly mindId: string;
        readonly phase: OperatorActivityPhase;
      }
      | undefined
    >();

    const activity: OperatorMindActivity = {
      mindId: 'mind-1',
      phase: 'thinking',
      updatedAt: '2026-07-12T12:00:00.000Z',
    };
    expect(Object.keys(activity)).not.toContain('prompt');
    expect(Object.keys(activity)).not.toContain('output');
  });

  it('models usage samples as observed, estimated, or unavailable', () => {
    expect(OPERATOR_USAGE_QUALITIES).toEqual(['observed', 'estimated', 'unavailable']);
    expectTypeOf<'observed'>().toMatchTypeOf<OperatorUsageQuality>();

    const observed: OperatorUsageSample = {
      sampleId: 'sample-observed',
      quality: 'observed',
      subject: { scope: 'mind', mindId: 'mind-1' },
      tokens: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: { amount: 0.01, currency: 'USD' },
      recordedAt: '2026-07-12T12:00:00.000Z',
    };
    const estimated: OperatorUsageSample = {
      sampleId: 'sample-estimated',
      quality: 'estimated',
      estimationMethod: 'tokenizer',
      subject: { scope: 'run', runId: 'run-1' },
      tokens: { totalTokens: 42 },
      recordedAt: '2026-07-12T12:01:00.000Z',
    };
    const unavailable: OperatorUsageSample = {
      sampleId: 'sample-unavailable',
      quality: 'unavailable',
      reason: 'provider-omitted',
      subject: { scope: 'chatroom', roundId: 'round-1' },
      recordedAt: '2026-07-12T12:02:00.000Z',
    };

    expect(observed.quality).toBe('observed');
    expect(estimated.quality).toBe('estimated');
    expect(unavailable.quality).toBe('unavailable');
  });

  it('keeps rollups and budget warnings explicit about their usage basis', () => {
    expect(OPERATOR_BUDGET_WARNING_STATUSES).toContain('unavailable');
    expectTypeOf<OperatorUsageRollup['quality']>().toEqualTypeOf<OperatorUsageQuality>();
    expectTypeOf<OperatorBudgetWarningState['basis']>().toEqualTypeOf<OperatorUsageQuality>();

    const rollup: OperatorUsageRollup = {
      rollupId: 'rollup-1',
      subject: { scope: 'chatroom', roundId: 'round-1' },
      window: { startedAt: '2026-07-12T12:00:00.000Z' },
      quality: 'estimated',
      samples: { observed: 0, estimated: 1, unavailable: 0, total: 1 },
      totals: { tokens: { totalTokens: 100 } },
      updatedAt: '2026-07-12T12:03:00.000Z',
    };
    const warning: OperatorBudgetWarningState = {
      budgetId: 'daily',
      subject: { scope: 'chatroom' },
      status: 'unavailable',
      severity: 'info',
      basis: 'unavailable',
      updatedAt: '2026-07-12T12:04:00.000Z',
    };

    expect(rollup.quality).toBe('estimated');
    expect(warning.basis).toBe('unavailable');
  });

  it('prevents unavailable rollups and budget warnings from carrying exact usage claims', () => {
    expectTypeOf<{
      rollupId: 'rollup-1';
      subject: { scope: 'chatroom' };
      window: { startedAt: '2026-07-12T12:00:00.000Z' };
      quality: 'unavailable';
      samples: { observed: 0; estimated: 0; unavailable: 1; total: 1 };
      totals: { cost: { amount: 1; currency: 'USD' } };
      updatedAt: '2026-07-12T12:00:00.000Z';
    }>().not.toMatchTypeOf<OperatorUsageRollup>();
    expectTypeOf<{
      budgetId: 'daily';
      subject: { scope: 'chatroom' };
      status: 'unavailable';
      severity: 'info';
      basis: 'unavailable';
      consumed: { amount: 1; currency: 'USD' };
      updatedAt: '2026-07-12T12:00:00.000Z';
    }>().not.toMatchTypeOf<OperatorBudgetWarningState>();
    expectTypeOf<{
      budgetId: 'daily';
      subject: { scope: 'chatroom' };
      status: 'unavailable';
      severity: 'info';
      basis: 'observed';
      consumed: { amount: 1; currency: 'USD' };
      updatedAt: '2026-07-12T12:00:00.000Z';
    }>().not.toMatchTypeOf<OperatorBudgetWarningState>();
  });

  it('defines the snapshot and renderer API seam', () => {
    expectTypeOf<OperatorActivitySnapshot['version']>().toEqualTypeOf<1>();
    expectTypeOf<OperatorActivitySnapshot['mindActivities']>().toEqualTypeOf<OperatorMindActivity[]>();
    expectTypeOf<OperatorActivitySnapshot['usageSamples']>().toEqualTypeOf<OperatorUsageSample[]>();
    expectTypeOf<OperatorActivityAPI['getSnapshot']>().toBeFunction();
    expectTypeOf<OperatorActivityAPI['onChanged']>().toBeFunction();
  });
});
