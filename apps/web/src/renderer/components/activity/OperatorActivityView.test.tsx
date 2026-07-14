/**
 * @vitest-environment jsdom
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import type {
  OperatorActivitySnapshot,
  OperatorBudgetWarningState,
  OperatorUsageRollup,
} from '@chamber/shared/operator-activity-types';
import { installElectronAPI, mockElectronAPI } from '../../../test/helpers';
import { OperatorActivityView } from './OperatorActivityView';

function freshTimestamp(): string {
  return new Date().toISOString();
}

function makeSnapshot(overrides: Partial<OperatorActivitySnapshot> = {}): OperatorActivitySnapshot {
  const updatedAt = freshTimestamp();
  return {
    version: 1,
    updatedAt,
    mindActivities: [],
    chatroom: {
      runId: null,
      state: 'idle',
      updatedAt,
    },
    usageSamples: [],
    usageRollups: [],
    budgetWarnings: [],
    ...overrides,
  };
}

describe('OperatorActivityView', () => {
  afterEach(() => {
    cleanup();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it('shows a loading state while the snapshot is loading', () => {
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn(() => new Promise<OperatorActivitySnapshot>(() => {}));
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(screen.getByRole('status').textContent).toContain('Loading operator activity');
  });

  it('shows empty and unavailable states when no activity has been reported', async () => {
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockResolvedValue(makeSnapshot());
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(await screen.findByText('No mind activity reported yet. Chamber will show per-mind phases here once services emit activity snapshots.')).toBeTruthy();
    expect(screen.getByText('No active run reported')).toBeTruthy();
    expect(screen.getByText('No active speaker reported.')).toBeTruthy();
    expect(screen.getByText('Usage data unavailable')).toBeTruthy();
    expect(screen.getByText('Budget signals unavailable')).toBeTruthy();
  });

  it('shows an error state when the snapshot cannot be loaded', async () => {
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockRejectedValue(new Error('activity service offline'));
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(await screen.findByText('Operator activity unavailable')).toBeTruthy();
    expect(screen.getByText('activity service offline')).toBeTruthy();
  });

  it('shows a stale state for old snapshots', async () => {
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockResolvedValue(makeSnapshot({
      updatedAt: '2020-01-01T00:00:00.000Z',
      chatroom: { runId: null, state: 'idle', updatedAt: '2020-01-01T00:00:00.000Z' },
    }));
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(await screen.findByText(/Activity snapshot is stale/)).toBeTruthy();
  });

  it('guards non-positive updatedAt timestamps as unavailable instead of relative time text', async () => {
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockResolvedValue(makeSnapshot({
      updatedAt: '1970-01-01T00:00:00.000Z',
      chatroom: { runId: null, state: 'idle', updatedAt: '1970-01-01T00:00:00.000Z' },
    }));
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(await screen.findByText('Snapshot updated Unavailable')).toBeTruthy();
  });

  it('marks a mounted fresh snapshot stale when no update arrives', async () => {
    vi.useFakeTimers();
    const updatedAt = '2026-07-12T17:30:00.000Z';
    vi.setSystemTime(new Date(updatedAt));
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockResolvedValue(makeSnapshot({
      updatedAt,
      chatroom: { runId: null, state: 'idle', updatedAt },
    }));
    installElectronAPI(api);

    render(<OperatorActivityView />);

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(screen.getByText('No mind activity reported yet. Chamber will show per-mind phases here once services emit activity snapshots.')).toBeTruthy();
    expect(screen.queryByText(/Activity snapshot is stale/)).toBeNull();

    await act(async () => {
      vi.advanceTimersByTime(120_001);
      await Promise.resolve();
    });

    expect(screen.getByText(/Activity snapshot is stale/)).toBeTruthy();
  });

  it('renders mind activity rows with phase, progress, and failure state', async () => {
    const updatedAt = freshTimestamp();
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockResolvedValue(makeSnapshot({
      mindActivities: [
        {
          mindId: 'mind-1',
          displayName: 'Monica',
          phase: 'thinking',
          runId: 'run-1',
          roundId: 'round-1',
          updatedAt,
          progress: {
            state: 'in-progress',
            completedSteps: 2,
            totalSteps: 4,
            updatedAt,
          },
        },
        {
          mindId: 'mind-2',
          displayName: 'Grace',
          phase: 'failed',
          updatedAt,
        },
      ],
    }));
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(await screen.findByText('Monica')).toBeTruthy();
    expect(screen.getByText('Thinking')).toBeTruthy();
    expect(screen.getByText('2 of 4 steps')).toBeTruthy();
    expect(screen.getByText('Grace')).toBeTruthy();
    expect(screen.getByText('Error state reported')).toBeTruthy();
  });

  it('renders chatroom run state, active speaker, approval waiting, progress, and cancellation', async () => {
    const updatedAt = freshTimestamp();
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockResolvedValue(makeSnapshot({
      chatroom: {
        runId: 'run-1',
        roundId: 'round-1',
        mode: 'group-chat',
        state: 'waiting-for-approval',
        updatedAt,
        activeSpeaker: {
          mindId: 'mind-2',
          displayName: 'Grace',
          phase: 'using-tools',
          turnIndex: 3,
          startedAt: updatedAt,
          updatedAt,
        },
        progress: {
          state: 'blocked',
          completedSteps: 1,
          totalSteps: 3,
          updatedAt,
        },
      },
    }));
    api.chatroom.stop = vi.fn().mockResolvedValue(undefined);
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(await screen.findByText('Waiting For Approval')).toBeTruthy();
    expect(screen.getByText('Approval waiting')).toBeTruthy();
    expect(screen.getByText('Grace')).toBeTruthy();
    expect(screen.getByText('Using Tools')).toBeTruthy();
    expect(screen.getByText('1 of 3 steps')).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: 'Stop chatroom run' }));

    await waitFor(() => {
      expect(api.chatroom.stop).toHaveBeenCalledTimes(1);
    });
  });

  it('does not overclaim exact usage or budget amounts', async () => {
    const updatedAt = freshTimestamp();
    const rollup: OperatorUsageRollup = {
      rollupId: 'rollup-1',
      subject: { scope: 'run', runId: 'run-1' },
      window: { startedAt: updatedAt },
      samples: { observed: 1, estimated: 0, unavailable: 0, total: 1 },
      updatedAt,
      quality: 'observed',
      totals: {
        tokens: { totalTokens: 1234 },
        cost: { amount: 12.34, currency: 'USD' },
      },
    };
    const budgetWarning: OperatorBudgetWarningState = {
      budgetId: 'budget-1',
      subject: { scope: 'run', runId: 'run-1' },
      status: 'approaching-limit',
      basis: 'observed',
      severity: 'warning',
      percentUsed: 75,
      consumed: { amount: 12.34, currency: 'USD' },
      limit: { amount: 20, currency: 'USD' },
      updatedAt,
    };
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockResolvedValue(makeSnapshot({
      usageRollups: [rollup],
      budgetWarnings: [budgetWarning],
    }));
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(await screen.findByText('Usage data available')).toBeTruthy();
    expect(screen.getByText('Budget warning states reported')).toBeTruthy();
    expect(screen.queryByText(/12\.34/)).toBeNull();
    expect(screen.queryByText(/75%/)).toBeNull();
    expect(screen.queryByText(/1234/)).toBeNull();
  });

  it('does not label samples-only usage as rollups', async () => {
    const updatedAt = freshTimestamp();
    const api = mockElectronAPI();
    api.operatorActivity.getSnapshot = vi.fn().mockResolvedValue(makeSnapshot({
      usageSamples: [
        {
          sampleId: 'sample-1',
          subject: { scope: 'mind', mindId: 'mind-1' },
          recordedAt: updatedAt,
          quality: 'observed',
          tokens: { totalTokens: 456 },
        },
      ],
    }));
    installElectronAPI(api);

    render(<OperatorActivityView />);

    expect(await screen.findByText('Usage data available')).toBeTruthy();
    expect(screen.queryByText('Usage rollups available')).toBeNull();
  });

  it('does not let an older snapshot request overwrite a newer live update', async () => {
    const older = makeSnapshot({
      updatedAt: '2026-07-12T17:00:00.000Z',
      chatroom: { runId: null, state: 'idle', updatedAt: '2026-07-12T17:00:00.000Z' },
      mindActivities: [
        { mindId: 'mind-old', displayName: 'Older', phase: 'thinking', updatedAt: '2026-07-12T17:00:00.000Z' },
      ],
    });
    const newer = makeSnapshot({
      updatedAt: '2026-07-12T17:01:00.000Z',
      chatroom: { runId: null, state: 'idle', updatedAt: '2026-07-12T17:01:00.000Z' },
      mindActivities: [
        { mindId: 'mind-new', displayName: 'Newer', phase: 'responding', updatedAt: '2026-07-12T17:01:00.000Z' },
      ],
    });
    const api = mockElectronAPI();
    let resolveSnapshot: (snapshot: OperatorActivitySnapshot) => void = () => {};
    let changedHandler: (snapshot: OperatorActivitySnapshot) => void = () => {};
    api.operatorActivity.getSnapshot = vi.fn(() => new Promise<OperatorActivitySnapshot>((resolve) => {
      resolveSnapshot = resolve;
    }));
    api.operatorActivity.onChanged = vi.fn((callback) => {
      changedHandler = callback;
      return vi.fn();
    });
    installElectronAPI(api);

    render(<OperatorActivityView />);

    await act(async () => {
      changedHandler(newer);
    });
    expect(screen.getByText('Newer')).toBeTruthy();

    await act(async () => {
      resolveSnapshot(older);
      await Promise.resolve();
    });

    expect(screen.getByText('Newer')).toBeTruthy();
    expect(screen.queryByText('Older')).toBeNull();
  });
});
