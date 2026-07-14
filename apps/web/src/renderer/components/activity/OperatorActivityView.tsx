import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import type {
  OperatorActivityPhase,
  OperatorActivitySnapshot,
  OperatorBudgetWarningState,
  OperatorChatroomRunActivity,
  OperatorChatroomRunState,
  OperatorMindActivity,
  OperatorProgressSignal,
  OperatorUsageRollup,
  OperatorUsageSample,
} from '@chamber/shared/operator-activity-types';
import {
  Activity,
  AlertTriangle,
  Bot,
  CheckCircle2,
  Clock3,
  Loader2,
  PauseCircle,
  ShieldAlert,
  Square,
  Users,
} from 'lucide-react';
import { Alert } from '../ui/alert';
import { Badge } from '../ui/badge';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '../ui/card';
import { formatRelativeTime } from '../../lib/utils';

const STALE_AFTER_MS = 120_000;

const CANCELLABLE_CHATROOM_STATES = new Set<OperatorChatroomRunState>([
  'starting',
  'running',
  'waiting-for-approval',
]);

const ERROR_PHASES = new Set<OperatorActivityPhase>(['failed']);

export function OperatorActivityView() {
  const [snapshot, setSnapshot] = useState<OperatorActivitySnapshot | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const snapshotRef = useRef<OperatorActivitySnapshot | null>(null);

  const commitSnapshot = useCallback((nextSnapshot: OperatorActivitySnapshot) => {
    const currentSnapshot = snapshotRef.current;
    if (currentSnapshot && isOlderSnapshot(nextSnapshot, currentSnapshot)) return;
    snapshotRef.current = nextSnapshot;
    setSnapshot(nextSnapshot);
    setNow(Date.now());
  }, []);

  const loadSnapshot = useCallback(async (mode: 'initial' | 'refresh' = 'refresh') => {
    if (mode === 'initial') {
      setLoading(true);
    } else {
      setRefreshing(true);
    }
    setError(null);
    try {
      const nextSnapshot = await window.electronAPI.operatorActivity.getSnapshot();
      commitSnapshot(nextSnapshot);
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const nextSnapshot = await window.electronAPI.operatorActivity.getSnapshot();
        if (mounted) {
          commitSnapshot(nextSnapshot);
        }
      } catch (err: unknown) {
        if (mounted) setError(getErrorMessage(err));
      } finally {
        if (mounted) setLoading(false);
      }
    };
    void load();
    const unsubscribe = window.electronAPI.operatorActivity.onChanged((nextSnapshot) => {
      if (!mounted) return;
      commitSnapshot(nextSnapshot);
      setError(null);
      setLoading(false);
    });
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [commitSnapshot]);

  const stopChatroomRun = useCallback(async () => {
    setStopping(true);
    setError(null);
    try {
      await window.electronAPI.chatroom.stop();
      await loadSnapshot();
    } catch (err: unknown) {
      setError(getErrorMessage(err));
    } finally {
      setStopping(false);
    }
  }, [loadSnapshot]);

  useEffect(() => {
    if (!snapshot) return;
    const timestamp = Date.parse(snapshot.updatedAt);
    if (Number.isNaN(timestamp)) {
      setNow(Date.now());
      return;
    }
    const msUntilStale = STALE_AFTER_MS - (Date.now() - timestamp);
    if (msUntilStale <= 0) {
      setNow(Date.now());
      return;
    }
    const timer = window.setTimeout(() => setNow(Date.now()), msUntilStale + 1);
    return () => window.clearTimeout(timer);
  }, [snapshot]);

  const stale = useMemo(() => snapshot ? isSnapshotStale(snapshot, now) : false, [snapshot, now]);

  if (loading && !snapshot) {
    return (
      <ActivityViewFrame>
        <div role="status" className="flex min-h-[320px] items-center justify-center rounded-2xl border border-border bg-card p-8 text-sm text-muted-foreground">
          <Loader2 className="mr-2 h-4 w-4 animate-spin" aria-hidden />
          Loading operator activity...
        </div>
      </ActivityViewFrame>
    );
  }

  if (error && !snapshot) {
    return (
      <ActivityViewFrame>
        <ErrorState message={error} onRetry={() => void loadSnapshot('initial')} />
      </ActivityViewFrame>
    );
  }

  if (!snapshot) {
    return (
      <ActivityViewFrame>
        <ErrorState message="Operator activity is unavailable in this host." onRetry={() => void loadSnapshot('initial')} />
      </ActivityViewFrame>
    );
  }

  return (
    <ActivityViewFrame snapshot={snapshot} onRefresh={() => void loadSnapshot()} refreshing={refreshing}>
      {error && <Alert variant="destructive">{error}</Alert>}
      {stale && (
        <div role="status" className="rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-sm text-amber-100">
          Activity snapshot is stale. Last update: {formatTimestamp(snapshot.updatedAt)}.
        </div>
      )}
      <div className="grid gap-6 xl:grid-cols-[1.3fr_0.7fr]">
        <main className="flex flex-col gap-6">
          <ChatroomRunCard
            run={snapshot.chatroom}
            stopping={stopping}
            onStop={stopChatroomRun}
          />
          <MindActivityCard activities={snapshot.mindActivities} />
        </main>
        <aside className="flex flex-col gap-6">
          <ActiveSpeakerCard run={snapshot.chatroom} />
          <UsageCard
            samples={snapshot.usageSamples}
            rollups={snapshot.usageRollups}
            budgetWarnings={snapshot.budgetWarnings}
          />
        </aside>
      </div>
    </ActivityViewFrame>
  );
}

function ActivityViewFrame({
  children,
  snapshot,
  onRefresh,
  refreshing,
}: {
  children: ReactNode;
  snapshot?: OperatorActivitySnapshot;
  onRefresh?: () => void;
  refreshing?: boolean;
}) {
  return (
    <div className="flex-1 overflow-auto bg-background">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 p-6">
        <header className="flex flex-col gap-4 rounded-2xl border border-border bg-card p-6 shadow-sm md:flex-row md:items-center md:justify-between">
          <div className="flex items-start gap-4">
            <div className="rounded-2xl border border-primary/30 bg-primary/10 p-3 text-primary">
              <Activity size={28} />
            </div>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight">Operator Activity</h1>
              <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
                Live lifecycle metadata for minds and chatroom runs, kept outside the transcript.
              </p>
              {snapshot && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Snapshot updated {formatTimestamp(snapshot.updatedAt)}
                </p>
              )}
            </div>
          </div>
          {onRefresh && (
            <button
              type="button"
              onClick={onRefresh}
              disabled={refreshing}
              className="inline-flex w-fit items-center gap-2 rounded-lg border border-border bg-muted px-4 py-2 text-sm font-semibold text-foreground disabled:cursor-not-allowed disabled:opacity-60"
            >
              {refreshing && <Loader2 className="h-4 w-4 animate-spin" aria-hidden />}
              Refresh
            </button>
          )}
        </header>
        {children}
      </div>
    </div>
  );
}

function ErrorState({ message, onRetry }: { message: string; onRetry: () => void }) {
  return (
    <div role="alert" className="flex min-h-[320px] flex-col items-center justify-center rounded-2xl border border-destructive/30 bg-destructive/10 p-8 text-center">
      <AlertTriangle className="mb-3 h-8 w-8 text-red-200" aria-hidden />
      <h2 className="text-lg font-semibold text-red-100">Operator activity unavailable</h2>
      <p className="mt-2 max-w-md text-sm text-red-100/80">{message}</p>
      <button
        type="button"
        onClick={onRetry}
        className="mt-4 rounded-lg border border-red-200/40 bg-red-200/10 px-4 py-2 text-sm font-semibold text-red-100"
      >
        Retry
      </button>
    </div>
  );
}

function ChatroomRunCard({
  run,
  stopping,
  onStop,
}: {
  run: OperatorChatroomRunActivity;
  stopping: boolean;
  onStop: () => Promise<void>;
}) {
  const canCancel = CANCELLABLE_CHATROOM_STATES.has(run.state);
  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between gap-4">
          <div>
            <CardTitle className="flex items-center gap-2">
              <Users className="h-4 w-4 text-muted-foreground" aria-hidden />
              Chatroom run
            </CardTitle>
            <CardDescription>
              Active run state from the operator activity contract.
            </CardDescription>
          </div>
          <StateBadge state={run.state} />
        </div>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="grid gap-3 sm:grid-cols-2">
          <ActivityField label="Run" value={run.runId ?? 'No active run reported'} />
          <ActivityField label="Round" value={run.roundId ?? 'Round unavailable'} />
          <ActivityField label="Mode" value={run.mode ? formatLabel(run.mode) : 'Mode unavailable'} />
          <ActivityField label="Updated" value={formatTimestamp(run.updatedAt)} />
        </div>
        <ProgressLine progress={run.progress} emptyText="Progress unavailable" />
        {run.state === 'waiting-for-approval' && (
          <Notice tone="warning" title="Approval waiting" detail="Chamber is waiting for an existing approval decision before the run can continue." />
        )}
        {run.state === 'failed' && (
          <Notice tone="danger" title="Run failed" detail="Error details are not exposed by the current activity contract." />
        )}
        {canCancel ? (
          <button
            type="button"
            onClick={() => { void onStop(); }}
            disabled={stopping || run.state === 'cancelling'}
            className="inline-flex items-center gap-2 rounded-lg border border-destructive/35 bg-destructive/10 px-4 py-2 text-sm font-semibold text-red-200 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {stopping ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden /> : <Square className="h-4 w-4" aria-hidden />}
            Stop chatroom run
          </button>
        ) : (
          <p className="text-sm text-muted-foreground">
            Cancellation is unavailable for the current run state.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

function ActiveSpeakerCard({ run }: { run: OperatorChatroomRunActivity }) {
  const speaker = run.activeSpeaker;
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <PauseCircle className="h-4 w-4 text-muted-foreground" aria-hidden />
          Active speaker
        </CardTitle>
        <CardDescription>
          Speaker and progress signals when the run can observe them.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {!speaker ? (
          <p className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
            No active speaker reported.
          </p>
        ) : (
          <div className="space-y-3">
            <div>
              <div className="font-medium">{speaker.displayName ?? speaker.mindId}</div>
              <div className="text-xs text-muted-foreground">{speaker.mindId}</div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ActivityField label="Phase" value={formatLabel(speaker.phase)} />
              <ActivityField label="Turn" value={speaker.turnIndex === undefined ? 'Turn unavailable' : String(speaker.turnIndex)} />
              <ActivityField label="Started" value={formatTimestamp(speaker.startedAt)} />
              <ActivityField label="Updated" value={formatTimestamp(speaker.updatedAt)} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MindActivityCard({ activities }: { activities: OperatorMindActivity[] }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <Bot className="h-4 w-4 text-muted-foreground" aria-hidden />
          Mind activity
        </CardTitle>
        <CardDescription>
          Per-mind phase and progress metadata. Prompts, outputs, and tool payloads are not stored here.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {activities.length === 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 p-5 text-sm text-muted-foreground">
            No mind activity reported yet. Chamber will show per-mind phases here once services emit activity snapshots.
          </div>
        ) : (
          <div className="divide-y divide-border overflow-hidden rounded-xl border border-border">
            {activities.map((activity) => (
              <MindActivityRow key={`${activity.mindId}:${activity.runId ?? 'none'}:${activity.roundId ?? 'none'}`} activity={activity} />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function MindActivityRow({ activity }: { activity: OperatorMindActivity }) {
  return (
    <div className="grid gap-4 bg-card p-4 md:grid-cols-[1fr_auto]">
      <div className="min-w-0">
        <div className="flex flex-wrap items-center gap-2">
          <div className="truncate font-medium">{activity.displayName ?? activity.mindId}</div>
          <PhaseBadge phase={activity.phase} />
        </div>
        <div className="mt-1 text-xs text-muted-foreground">{activity.mindId}</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <ActivityField label="Run" value={activity.runId ?? 'No run associated'} />
          <ActivityField label="Round" value={activity.roundId ?? 'No round associated'} />
          <ActivityField label="Updated" value={formatTimestamp(activity.updatedAt)} />
        </div>
        <div className="mt-3">
          <ProgressLine progress={activity.progress} emptyText="Progress unavailable" />
        </div>
        {ERROR_PHASES.has(activity.phase) && (
          <div className="mt-3">
            <Notice tone="danger" title="Error state reported" detail="Details are unavailable in the current activity contract." />
          </div>
        )}
      </div>
    </div>
  );
}

function UsageCard({
  samples,
  rollups,
  budgetWarnings,
}: {
  samples: OperatorUsageSample[];
  rollups: OperatorUsageRollup[];
  budgetWarnings: OperatorBudgetWarningState[];
}) {
  const availableRollups = rollups.filter((rollup) => rollup.quality !== 'unavailable');
  const availableSamples = samples.filter((sample) => sample.quality !== 'unavailable');
  const hasUsage = availableRollups.length > 0 || availableSamples.length > 0;
  const availableBudgetWarnings = budgetWarnings.filter((warning) => warning.status !== 'unavailable');

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2">
          <ShieldAlert className="h-4 w-4 text-muted-foreground" aria-hidden />
          Usage and budget
        </CardTitle>
        <CardDescription>
          Availability only. This surface does not display exact costs, token totals, or percent used.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-4">
        {hasUsage ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <div className="font-medium">Usage data available</div>
            <div className="mt-2 flex flex-wrap gap-2 text-xs text-muted-foreground">
              <Badge variant="outline">{countByQuality(rollups, 'observed')} observed rollups</Badge>
              <Badge variant="outline">{countByQuality(rollups, 'estimated')} estimated rollups</Badge>
              <Badge variant="outline">{availableSamples.length} available samples</Badge>
            </div>
          </div>
        ) : (
          <UnavailablePanel title="Usage data unavailable" detail="No observed or estimated usage data has been reported by the activity contract." />
        )}
        {availableBudgetWarnings.length > 0 ? (
          <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm">
            <div className="font-medium">Budget warning states reported</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {availableBudgetWarnings.map((warning) => (
                <Badge key={warning.budgetId} variant="outline">
                  {formatLabel(warning.status)} ({warning.basis})
                </Badge>
              ))}
            </div>
          </div>
        ) : (
          <UnavailablePanel title="Budget signals unavailable" detail="No budget warning state is currently observable." />
        )}
      </CardContent>
    </Card>
  );
}

function ProgressLine({ progress, emptyText }: { progress?: OperatorProgressSignal; emptyText: string }) {
  if (!progress) {
    return <p className="text-sm text-muted-foreground">{emptyText}</p>;
  }
  const hasStepCount = typeof progress.completedSteps === 'number' && typeof progress.totalSteps === 'number';
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">Progress: {formatLabel(progress.state)}</span>
        {hasStepCount && (
          <Badge variant="outline">
            {progress.completedSteps} of {progress.totalSteps} steps
          </Badge>
        )}
      </div>
      <div className="mt-1 text-xs text-muted-foreground">Updated {formatTimestamp(progress.updatedAt)}</div>
    </div>
  );
}

function Notice({ title, detail, tone }: { title: string; detail: string; tone: 'warning' | 'danger' }) {
  const isDanger = tone === 'danger';
  return (
    <div className={`rounded-lg border p-3 text-sm ${isDanger ? 'border-destructive/30 bg-destructive/10 text-red-100' : 'border-amber-500/30 bg-amber-500/10 text-amber-100'}`}>
      <div className="font-medium">{title}</div>
      <div className="mt-1 opacity-85">{detail}</div>
    </div>
  );
}

function UnavailablePanel({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 p-4 text-sm text-muted-foreground">
      <div className="font-medium text-foreground">{title}</div>
      <div className="mt-1">{detail}</div>
    </div>
  );
}

function ActivityField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs uppercase tracking-wide text-muted-foreground">{label}</div>
      <div className="mt-1 break-words text-sm">{value}</div>
    </div>
  );
}

function StateBadge({ state }: { state: OperatorChatroomRunState }) {
  const tone = state === 'failed'
    ? 'danger'
    : state === 'waiting-for-approval' || state === 'cancelling'
      ? 'warning'
      : state === 'running' || state === 'starting'
        ? 'active'
        : state === 'completed'
          ? 'success'
          : 'muted';
  return (
    <Badge variant="outline" className={stateToneClassName(tone)}>
      {state === 'running' || state === 'starting' ? <Clock3 className="h-3 w-3" aria-hidden /> : null}
      {state === 'completed' ? <CheckCircle2 className="h-3 w-3" aria-hidden /> : null}
      {formatLabel(state)}
    </Badge>
  );
}

function PhaseBadge({ phase }: { phase: OperatorActivityPhase }) {
  const tone = phase === 'failed'
    ? 'danger'
    : phase === 'waiting' || phase === 'queued' || phase === 'starting'
      ? 'warning'
      : phase === 'thinking' || phase === 'using-tools' || phase === 'responding'
        ? 'active'
        : phase === 'complete'
          ? 'success'
          : 'muted';
  return (
    <Badge variant="outline" className={stateToneClassName(tone)}>
      {formatLabel(phase)}
    </Badge>
  );
}

function stateToneClassName(tone: 'active' | 'danger' | 'muted' | 'success' | 'warning'): string {
  switch (tone) {
    case 'active':
      return 'border-blue-500/30 bg-blue-500/10 text-blue-200';
    case 'danger':
      return 'border-destructive/30 bg-destructive/10 text-red-200';
    case 'success':
      return 'border-green-500/30 bg-green-500/10 text-green-200';
    case 'warning':
      return 'border-amber-500/30 bg-amber-500/10 text-amber-200';
    case 'muted':
      return 'border-border bg-muted text-muted-foreground';
  }
}

function countByQuality(
  records: Array<{ quality: 'observed' | 'estimated' | 'unavailable' }>,
  quality: 'observed' | 'estimated',
): number {
  return records.filter((record) => record.quality === quality).length;
}

function isSnapshotStale(snapshot: OperatorActivitySnapshot, now: number): boolean {
  const timestamp = Date.parse(snapshot.updatedAt);
  if (Number.isNaN(timestamp) || timestamp <= 0) return true;
  return now - timestamp > STALE_AFTER_MS;
}

function isOlderSnapshot(nextSnapshot: OperatorActivitySnapshot, currentSnapshot: OperatorActivitySnapshot): boolean {
  return snapshotTime(nextSnapshot) < snapshotTime(currentSnapshot);
}

function snapshotTime(snapshot: OperatorActivitySnapshot): number {
  const timestamp = Date.parse(snapshot.updatedAt);
  return Number.isNaN(timestamp) || timestamp <= 0 ? Number.NEGATIVE_INFINITY : timestamp;
}

function formatTimestamp(value: string): string {
  const timestamp = Date.parse(value);
  if (Number.isNaN(timestamp) || timestamp <= 0) return 'Unavailable';
  return formatRelativeTime(value);
}

function formatLabel(value: string): string {
  return value
    .split(/[-_]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
