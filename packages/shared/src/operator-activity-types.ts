import type { OrchestrationMode } from './chatroom-types';

/**
 * Platform-neutral contracts for operator activity, chatroom progress, usage,
 * and budget state. These contracts intentionally exclude prompts, model
 * outputs, raw tool payloads, credentials, and reasoning text. Producers should
 * publish only lifecycle metadata and provider-reported or estimated usage.
 */

export const OPERATOR_ACTIVITY_PHASES = [
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
] as const;

export type OperatorActivityPhase = typeof OPERATOR_ACTIVITY_PHASES[number];

export const OPERATOR_CHATROOM_RUN_STATES = [
  'idle',
  'starting',
  'running',
  'waiting-for-approval',
  'cancelling',
  'completed',
  'failed',
  'cancelled',
] as const;

export type OperatorChatroomRunState = typeof OPERATOR_CHATROOM_RUN_STATES[number];

export const OPERATOR_PROGRESS_STATES = [
  'not-started',
  'in-progress',
  'blocked',
  'complete',
  'failed',
  'cancelled',
] as const;

export type OperatorProgressState = typeof OPERATOR_PROGRESS_STATES[number];

export interface OperatorProgressSignal {
  readonly state: OperatorProgressState;
  readonly completedSteps?: number;
  readonly totalSteps?: number;
  readonly updatedAt: string;
}

export interface OperatorActiveSpeakerSignal {
  readonly mindId: string;
  readonly displayName?: string;
  readonly phase: OperatorActivityPhase;
  readonly turnIndex?: number;
  readonly startedAt: string;
  readonly updatedAt: string;
}

export interface OperatorMindActivity {
  readonly mindId: string;
  readonly displayName?: string;
  readonly phase: OperatorActivityPhase;
  readonly runId?: string;
  readonly roundId?: string;
  readonly progress?: OperatorProgressSignal;
  readonly updatedAt: string;
}

export interface OperatorChatroomRunActivity {
  readonly runId: string | null;
  readonly roundId?: string;
  readonly mode?: OrchestrationMode;
  readonly state: OperatorChatroomRunState;
  readonly activeSpeaker?: OperatorActiveSpeakerSignal;
  readonly progress?: OperatorProgressSignal;
  readonly updatedAt: string;
}

export const OPERATOR_USAGE_QUALITIES = [
  'observed',
  'estimated',
  'unavailable',
] as const;

export type OperatorUsageQuality = typeof OPERATOR_USAGE_QUALITIES[number];

export const OPERATOR_USAGE_SUBJECT_SCOPES = [
  'mind',
  'chatroom',
  'run',
] as const;

export type OperatorUsageSubjectScope = typeof OPERATOR_USAGE_SUBJECT_SCOPES[number];

export interface OperatorUsageSubject {
  readonly scope: OperatorUsageSubjectScope;
  readonly mindId?: string;
  readonly runId?: string;
  readonly roundId?: string;
}

export interface OperatorUsageWindow {
  readonly startedAt: string;
  readonly endedAt?: string;
}

export interface OperatorUsageSource {
  readonly provider?: string;
  readonly model?: string;
}

export interface OperatorTokenUsage {
  readonly inputTokens?: number;
  readonly outputTokens?: number;
  readonly totalTokens?: number;
  readonly cachedInputTokens?: number;
}

export interface OperatorCostAmount {
  readonly amount: number;
  readonly currency: string;
}

export const OPERATOR_USAGE_ESTIMATION_METHODS = [
  'provider-rate-card',
  'tokenizer',
  'heuristic',
] as const;

export type OperatorUsageEstimationMethod = typeof OPERATOR_USAGE_ESTIMATION_METHODS[number];

export const OPERATOR_USAGE_UNAVAILABLE_REASONS = [
  'provider-omitted',
  'provider-unavailable',
  'not-supported',
  'not-yet-reported',
  'redacted',
  'unknown',
] as const;

export type OperatorUsageUnavailableReason = typeof OPERATOR_USAGE_UNAVAILABLE_REASONS[number];

interface OperatorUsageSampleBase {
  readonly sampleId: string;
  readonly subject: OperatorUsageSubject;
  readonly source?: OperatorUsageSource;
  readonly window?: OperatorUsageWindow;
  readonly recordedAt: string;
}

export type OperatorUsageSample =
  | (OperatorUsageSampleBase & {
    readonly quality: 'observed';
    readonly tokens?: OperatorTokenUsage;
    readonly cost?: OperatorCostAmount;
  })
  | (OperatorUsageSampleBase & {
    readonly quality: 'estimated';
    readonly estimationMethod: OperatorUsageEstimationMethod;
    readonly tokens?: OperatorTokenUsage;
    readonly cost?: OperatorCostAmount;
  })
  | (OperatorUsageSampleBase & {
    readonly quality: 'unavailable';
    readonly reason: OperatorUsageUnavailableReason;
  });

export interface OperatorUsageSampleCounts {
  readonly observed: number;
  readonly estimated: number;
  readonly unavailable: number;
  readonly total: number;
}

export interface OperatorUsageTotals {
  readonly tokens?: OperatorTokenUsage;
  readonly cost?: OperatorCostAmount;
}

interface OperatorUsageRollupBase {
  readonly rollupId: string;
  readonly subject: OperatorUsageSubject;
  readonly window: OperatorUsageWindow;
  readonly samples: OperatorUsageSampleCounts;
  readonly updatedAt: string;
}

export type OperatorUsageRollup =
  | (OperatorUsageRollupBase & {
    readonly quality: 'observed' | 'estimated';
    readonly totals?: OperatorUsageTotals;
  })
  | (OperatorUsageRollupBase & {
    readonly quality: 'unavailable';
    readonly totals?: never;
  });

export const OPERATOR_BUDGET_WARNING_STATUSES = [
  'not-configured',
  'within-budget',
  'approaching-limit',
  'over-limit',
  'unavailable',
] as const;

export type OperatorBudgetWarningStatus = typeof OPERATOR_BUDGET_WARNING_STATUSES[number];

export const OPERATOR_BUDGET_WARNING_SEVERITIES = [
  'none',
  'info',
  'warning',
  'critical',
] as const;

export type OperatorBudgetWarningSeverity = typeof OPERATOR_BUDGET_WARNING_SEVERITIES[number];

interface OperatorBudgetWarningStateBase {
  readonly budgetId: string;
  readonly subject: OperatorUsageSubject;
  readonly severity: OperatorBudgetWarningSeverity;
  readonly thresholdPercent?: number;
  readonly limit?: OperatorCostAmount;
  readonly updatedAt: string;
}

export type OperatorBudgetWarningState =
  | (OperatorBudgetWarningStateBase & {
    readonly status: Exclude<OperatorBudgetWarningStatus, 'unavailable'>;
    readonly basis: 'observed' | 'estimated';
    readonly percentUsed?: number;
    readonly consumed?: OperatorCostAmount;
  })
  | (OperatorBudgetWarningStateBase & {
    readonly status: 'unavailable';
    readonly basis: 'unavailable';
    readonly percentUsed?: never;
    readonly consumed?: never;
  });

export interface OperatorActivitySnapshot {
  readonly version: 1;
  readonly updatedAt: string;
  readonly mindActivities: OperatorMindActivity[];
  readonly chatroom: OperatorChatroomRunActivity;
  readonly usageSamples: OperatorUsageSample[];
  readonly usageRollups: OperatorUsageRollup[];
  readonly budgetWarnings: OperatorBudgetWarningState[];
}

export interface OperatorActivityAPI {
  getSnapshot: () => Promise<OperatorActivitySnapshot>;
  onChanged: (callback: (snapshot: OperatorActivitySnapshot) => void) => () => void;
}
