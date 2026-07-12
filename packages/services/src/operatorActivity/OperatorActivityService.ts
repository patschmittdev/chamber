import * as fs from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';

import { getErrorMessage } from '@chamber/shared/getErrorMessage';
import {
  OPERATOR_ACTIVITY_PHASES,
  OPERATOR_BUDGET_WARNING_SEVERITIES,
  OPERATOR_BUDGET_WARNING_STATUSES,
  OPERATOR_CHATROOM_RUN_STATES,
  OPERATOR_PROGRESS_STATES,
  OPERATOR_USAGE_ESTIMATION_METHODS,
  OPERATOR_USAGE_QUALITIES,
  OPERATOR_USAGE_SUBJECT_SCOPES,
  OPERATOR_USAGE_UNAVAILABLE_REASONS,
  type OperatorActivitySnapshot,
  type OperatorBudgetWarningState,
  type OperatorChatroomRunActivity,
  type OperatorMindActivity,
  type OperatorUsageRollup,
  type OperatorUsageSample,
} from '@chamber/shared/operator-activity-types';
import { Logger } from '../logger';

const log = Logger.create('OperatorActivity');

const FORBIDDEN_PERSISTENCE_KEYS = new Set([
  'prompt',
  'prompts',
  'output',
  'outputs',
  'rawtoolpayload',
  'rawtoolpayloads',
  'credential',
  'credentials',
  'chainofthought',
  'reasoning',
  'reasoningcontent',
]);

const nonEmptyStringSchema = z.string().min(1);
const optionalNonEmptyStringSchema = nonEmptyStringSchema.optional();
const nonNegativeNumberSchema = z.number().finite().nonnegative();
const timestampSchema = nonEmptyStringSchema;

const progressSchema = z
  .object({
    state: z.enum(OPERATOR_PROGRESS_STATES),
    completedSteps: nonNegativeNumberSchema.optional(),
    totalSteps: nonNegativeNumberSchema.optional(),
    updatedAt: timestampSchema,
  })
  .strict()
  .refine(
    (progress) => progress.completedSteps === undefined
      || progress.totalSteps === undefined
      || progress.completedSteps <= progress.totalSteps,
    { path: ['completedSteps'], message: 'must be less than or equal to totalSteps' },
  );

const activeSpeakerSchema = z
  .object({
    mindId: nonEmptyStringSchema,
    displayName: optionalNonEmptyStringSchema,
    phase: z.enum(OPERATOR_ACTIVITY_PHASES),
    turnIndex: nonNegativeNumberSchema.optional(),
    startedAt: timestampSchema,
    updatedAt: timestampSchema,
  })
  .strict();

const mindActivitySchema = z
  .object({
    mindId: nonEmptyStringSchema,
    displayName: optionalNonEmptyStringSchema,
    phase: z.enum(OPERATOR_ACTIVITY_PHASES),
    runId: optionalNonEmptyStringSchema,
    roundId: optionalNonEmptyStringSchema,
    progress: progressSchema.optional(),
    updatedAt: timestampSchema,
  })
  .strict();

const chatroomRunSchema = z
  .object({
    runId: nonEmptyStringSchema.nullable(),
    roundId: optionalNonEmptyStringSchema,
    mode: z.enum(['concurrent', 'sequential', 'handoff', 'group-chat', 'magentic']).optional(),
    state: z.enum(OPERATOR_CHATROOM_RUN_STATES),
    activeSpeaker: activeSpeakerSchema.optional(),
    progress: progressSchema.optional(),
    updatedAt: timestampSchema,
  })
  .strict();

const usageSubjectSchema = z
  .object({
    scope: z.enum(OPERATOR_USAGE_SUBJECT_SCOPES),
    mindId: optionalNonEmptyStringSchema,
    runId: optionalNonEmptyStringSchema,
    roundId: optionalNonEmptyStringSchema,
  })
  .strict()
  .superRefine((subject, ctx) => {
    if (subject.scope === 'mind' && !subject.mindId) {
      ctx.addIssue({
        code: 'custom',
        path: ['mindId'],
        message: 'is required when scope is mind',
      });
    }
    if (subject.scope === 'run' && !subject.runId) {
      ctx.addIssue({
        code: 'custom',
        path: ['runId'],
        message: 'is required when scope is run',
      });
    }
  });

const usageWindowSchema = z
  .object({
    startedAt: timestampSchema,
    endedAt: timestampSchema.optional(),
  })
  .strict();

const usageSourceSchema = z
  .object({
    provider: optionalNonEmptyStringSchema,
    model: optionalNonEmptyStringSchema,
  })
  .strict();

const tokenUsageSchema = z
  .object({
    inputTokens: nonNegativeNumberSchema.optional(),
    outputTokens: nonNegativeNumberSchema.optional(),
    totalTokens: nonNegativeNumberSchema.optional(),
    cachedInputTokens: nonNegativeNumberSchema.optional(),
  })
  .strict();

const costAmountSchema = z
  .object({
    amount: nonNegativeNumberSchema,
    currency: nonEmptyStringSchema,
  })
  .strict();

const observedUsageSampleSchema = z
  .object({
    sampleId: nonEmptyStringSchema,
    quality: z.literal('observed'),
    subject: usageSubjectSchema,
    source: usageSourceSchema.optional(),
    window: usageWindowSchema.optional(),
    recordedAt: timestampSchema,
    tokens: tokenUsageSchema.optional(),
    cost: costAmountSchema.optional(),
  })
  .strict();

const estimatedUsageSampleSchema = z
  .object({
    sampleId: nonEmptyStringSchema,
    quality: z.literal('estimated'),
    estimationMethod: z.enum(OPERATOR_USAGE_ESTIMATION_METHODS),
    subject: usageSubjectSchema,
    source: usageSourceSchema.optional(),
    window: usageWindowSchema.optional(),
    recordedAt: timestampSchema,
    tokens: tokenUsageSchema.optional(),
    cost: costAmountSchema.optional(),
  })
  .strict();

const unavailableUsageSampleSchema = z
  .object({
    sampleId: nonEmptyStringSchema,
    quality: z.literal('unavailable'),
    reason: z.enum(OPERATOR_USAGE_UNAVAILABLE_REASONS),
    subject: usageSubjectSchema,
    source: usageSourceSchema.optional(),
    window: usageWindowSchema.optional(),
    recordedAt: timestampSchema,
  })
  .strict();

const usageSampleSchema = z.discriminatedUnion('quality', [
  observedUsageSampleSchema,
  estimatedUsageSampleSchema,
  unavailableUsageSampleSchema,
]);

const usageSampleCountsSchema = z
  .object({
    observed: nonNegativeNumberSchema,
    estimated: nonNegativeNumberSchema,
    unavailable: nonNegativeNumberSchema,
    total: nonNegativeNumberSchema,
  })
  .strict()
  .refine(
    (counts) => counts.observed + counts.estimated + counts.unavailable === counts.total,
    { path: ['total'], message: 'must equal observed plus estimated plus unavailable' },
  );

const usageTotalsSchema = z
  .object({
    tokens: tokenUsageSchema.optional(),
    cost: costAmountSchema.optional(),
  })
  .strict();

const usageRollupSchema = z
  .object({
    rollupId: nonEmptyStringSchema,
    subject: usageSubjectSchema,
    window: usageWindowSchema,
    quality: z.enum(OPERATOR_USAGE_QUALITIES),
    samples: usageSampleCountsSchema,
    totals: usageTotalsSchema.optional(),
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((rollup, ctx) => {
    if (rollup.quality === 'unavailable' && rollup.totals !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['totals'],
        message: 'must be omitted when quality is unavailable',
      });
    }
  });

const budgetWarningSchema = z
  .object({
    budgetId: nonEmptyStringSchema,
    subject: usageSubjectSchema,
    status: z.enum(OPERATOR_BUDGET_WARNING_STATUSES),
    severity: z.enum(OPERATOR_BUDGET_WARNING_SEVERITIES),
    basis: z.enum(OPERATOR_USAGE_QUALITIES),
    thresholdPercent: nonNegativeNumberSchema.optional(),
    percentUsed: nonNegativeNumberSchema.optional(),
    limit: costAmountSchema.optional(),
    consumed: costAmountSchema.optional(),
    updatedAt: timestampSchema,
  })
  .strict()
  .superRefine((warning, ctx) => {
    const unavailableStatus = warning.status === 'unavailable';
    const unavailableBasis = warning.basis === 'unavailable';
    if (!unavailableStatus && !unavailableBasis) return;
    if (!unavailableStatus) {
      ctx.addIssue({
        code: 'custom',
        path: ['status'],
        message: 'must be unavailable when basis is unavailable',
      });
    }
    if (!unavailableBasis) {
      ctx.addIssue({
        code: 'custom',
        path: ['basis'],
        message: 'must be unavailable when status is unavailable',
      });
    }
    if (warning.percentUsed !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['percentUsed'],
        message: 'must be omitted when basis is unavailable',
      });
    }
    if (warning.consumed !== undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['consumed'],
        message: 'must be omitted when basis is unavailable',
      });
    }
  });

const snapshotSchema = z
  .object({
    version: z.literal(1),
    updatedAt: timestampSchema,
    mindActivities: z.array(mindActivitySchema),
    chatroom: chatroomRunSchema,
    usageSamples: z.array(usageSampleSchema),
    usageRollups: z.array(usageRollupSchema),
    budgetWarnings: z.array(budgetWarningSchema),
  })
  .strict();

export interface OperatorActivityStore {
  load(): Promise<OperatorActivitySnapshot | null>;
  save(snapshot: OperatorActivitySnapshot): Promise<void>;
}

export interface OperatorActivityServiceOptions {
  readonly store?: OperatorActivityStore;
  readonly now?: () => string;
  readonly maxUsageSamples?: number;
}

export interface OperatorActivityFileStoreOptions {
  readonly filePath: string;
}

export class OperatorActivityFileStore implements OperatorActivityStore {
  private readonly filePath: string;

  constructor(options: OperatorActivityFileStoreOptions) {
    this.filePath = options.filePath;
  }

  async load(): Promise<OperatorActivitySnapshot | null> {
    try {
      const raw = await fs.readFile(this.filePath, 'utf-8');
      return validateOperatorActivitySnapshot(JSON.parse(raw));
    } catch (err) {
      const code = (err as NodeJS.ErrnoException)?.code;
      if (code === 'ENOENT') return null;
      log.warn(`Failed to read operator activity snapshot from ${this.filePath}: ${getErrorMessage(err)}`);
      return null;
    }
  }

  async save(snapshot: OperatorActivitySnapshot): Promise<void> {
    const safeSnapshot = validateOperatorActivitySnapshot(snapshot);
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.tmp-${process.pid}-${randomUUID()}`;
    const file = await fs.open(tempPath, 'w');
    try {
      await file.writeFile(JSON.stringify(safeSnapshot, null, 2), 'utf-8');
      await file.sync();
    } finally {
      await file.close();
    }

    try {
      await fs.rename(tempPath, this.filePath);
    } catch (err) {
      await fs.rm(tempPath, { force: true });
      throw err;
    }
  }
}

export class InMemoryOperatorActivityStore implements OperatorActivityStore {
  private snapshot: OperatorActivitySnapshot | null = null;

  async load(): Promise<OperatorActivitySnapshot | null> {
    return this.snapshot ? validateOperatorActivitySnapshot(this.snapshot) : null;
  }

  async save(snapshot: OperatorActivitySnapshot): Promise<void> {
    this.snapshot = validateOperatorActivitySnapshot(snapshot);
  }
}

export class OperatorActivityService {
  private readonly store: OperatorActivityStore;
  private readonly now: () => string;
  private readonly maxUsageSamples: number;
  private readonly listeners = new Set<(snapshot: OperatorActivitySnapshot) => void>();
  private mutationQueue: Promise<unknown> = Promise.resolve();

  constructor(options: OperatorActivityServiceOptions = {}) {
    this.store = options.store ?? new InMemoryOperatorActivityStore();
    this.now = options.now ?? (() => new Date().toISOString());
    this.maxUsageSamples = options.maxUsageSamples ?? 250;
  }

  async getSnapshot(): Promise<OperatorActivitySnapshot> {
    const loaded = await this.store.load();
    return loaded ? validateOperatorActivitySnapshot(loaded) : createEmptyOperatorActivitySnapshot(this.now());
  }

  async replaceSnapshot(snapshot: OperatorActivitySnapshot): Promise<OperatorActivitySnapshot> {
    return this.enqueueMutation(() => this.persistSnapshot(validateOperatorActivitySnapshot(snapshot)));
  }

  async recordMindActivity(activity: OperatorMindActivity): Promise<OperatorActivitySnapshot> {
    const safeActivity = validateOperatorMindActivity(activity);
    return this.updateSnapshot((current) => ({
      ...current,
      updatedAt: this.now(),
      mindActivities: upsertBy(current.mindActivities, safeActivity, (item) => item.mindId),
    }));
  }

  async setChatroomRun(chatroom: OperatorChatroomRunActivity): Promise<OperatorActivitySnapshot> {
    const safeChatroom = validateOperatorChatroomRun(chatroom);
    return this.updateSnapshot((current) => ({
      ...current,
      updatedAt: this.now(),
      chatroom: safeChatroom,
    }));
  }

  async recordUsageSample(sample: OperatorUsageSample): Promise<OperatorActivitySnapshot> {
    const safeSample = validateOperatorUsageSample(sample);
    return this.updateSnapshot((current) => ({
      ...current,
      updatedAt: this.now(),
      usageSamples: [...current.usageSamples, safeSample].slice(-this.maxUsageSamples),
    }));
  }

  async setUsageRollup(rollup: OperatorUsageRollup): Promise<OperatorActivitySnapshot> {
    const safeRollup = validateOperatorUsageRollup(rollup);
    return this.updateSnapshot((current) => ({
      ...current,
      updatedAt: this.now(),
      usageRollups: upsertBy(current.usageRollups, safeRollup, (item) => item.rollupId),
    }));
  }

  async setBudgetWarning(warning: OperatorBudgetWarningState): Promise<OperatorActivitySnapshot> {
    const safeWarning = validateOperatorBudgetWarning(warning);
    return this.updateSnapshot((current) => ({
      ...current,
      updatedAt: this.now(),
      budgetWarnings: upsertBy(current.budgetWarnings, safeWarning, (item) => item.budgetId),
    }));
  }

  subscribeChanged(listener: (snapshot: OperatorActivitySnapshot) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  private async updateSnapshot(
    build: (current: OperatorActivitySnapshot) => OperatorActivitySnapshot,
  ): Promise<OperatorActivitySnapshot> {
    return this.enqueueMutation(async () => {
      const current = await this.getSnapshot();
      return this.persistSnapshot(build(current));
    });
  }

  private enqueueMutation<T>(operation: () => Promise<T>): Promise<T> {
    const run = this.mutationQueue.catch(() => undefined).then(operation);
    this.mutationQueue = run.catch(() => undefined);
    return run;
  }

  private async persistSnapshot(snapshot: OperatorActivitySnapshot): Promise<OperatorActivitySnapshot> {
    const safeSnapshot = validateOperatorActivitySnapshot(snapshot);
    await this.store.save(safeSnapshot);
    this.emitChanged(safeSnapshot);
    return safeSnapshot;
  }

  private emitChanged(snapshot: OperatorActivitySnapshot): void {
    const safeSnapshot = validateOperatorActivitySnapshot(snapshot);
    for (const listener of this.listeners) {
      listener(safeSnapshot);
    }
  }
}

export function createEmptyOperatorActivitySnapshot(updatedAt: string): OperatorActivitySnapshot {
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
  };
}

export function validateOperatorActivitySnapshot(input: unknown): OperatorActivitySnapshot {
  assertNoSensitiveOperatorActivityFields(input);
  return snapshotSchema.parse(input) as OperatorActivitySnapshot;
}

export function validateOperatorMindActivity(input: unknown): OperatorMindActivity {
  assertNoSensitiveOperatorActivityFields(input);
  return mindActivitySchema.parse(input) as OperatorMindActivity;
}

export function validateOperatorChatroomRun(input: unknown): OperatorChatroomRunActivity {
  assertNoSensitiveOperatorActivityFields(input);
  return chatroomRunSchema.parse(input) as OperatorChatroomRunActivity;
}

export function validateOperatorUsageSample(input: unknown): OperatorUsageSample {
  assertNoSensitiveOperatorActivityFields(input);
  return usageSampleSchema.parse(input) as OperatorUsageSample;
}

export function validateOperatorUsageRollup(input: unknown): OperatorUsageRollup {
  assertNoSensitiveOperatorActivityFields(input);
  return usageRollupSchema.parse(input) as OperatorUsageRollup;
}

export function validateOperatorBudgetWarning(input: unknown): OperatorBudgetWarningState {
  assertNoSensitiveOperatorActivityFields(input);
  return budgetWarningSchema.parse(input) as OperatorBudgetWarningState;
}

function assertNoSensitiveOperatorActivityFields(input: unknown): void {
  const seen = new WeakSet<object>();
  visitForSensitiveKeys(input, [], seen);
}

function visitForSensitiveKeys(input: unknown, pathParts: string[], seen: WeakSet<object>): void {
  if (typeof input !== 'object' || input === null) return;
  if (seen.has(input)) return;
  seen.add(input);

  if (Array.isArray(input)) {
    input.forEach((item, index) => visitForSensitiveKeys(item, [...pathParts, String(index)], seen));
    return;
  }

  for (const [key, value] of Object.entries(input)) {
    const normalized = key.replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (FORBIDDEN_PERSISTENCE_KEYS.has(normalized)) {
      throw new Error(`Operator activity payload contains forbidden persistence field "${[...pathParts, key].join('.')}"`);
    }
    visitForSensitiveKeys(value, [...pathParts, key], seen);
  }
}

function upsertBy<T>(items: readonly T[], item: T, getId: (item: T) => string): T[] {
  const id = getId(item);
  const existingIndex = items.findIndex((candidate) => getId(candidate) === id);
  if (existingIndex < 0) return [...items, item];
  return items.map((candidate, index) => index === existingIndex ? item : candidate);
}
