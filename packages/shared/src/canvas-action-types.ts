/**
 * Bounded, versioned Canvas action types.
 *
 * Canvas HTML, scripts, action names, and payloads are untrusted. This module
 * defines the only action variants the server will accept, and the grant that
 * proves a renderer user gesture initiated the dispatch.
 */

// ---------------------------------------------------------------------------
// Gesture grant — minted by the renderer, validated by CanvasServer
// ---------------------------------------------------------------------------

/**
 * A short-lived, single-use token minted synchronously inside a renderer user
 * event handler and transmitted to the Canvas iframe via postMessage. It binds
 * a specific action dispatch to a specific user gesture for a specific mind /
 * view pair.
 *
 * INVARIANT: grants are minted only inside trusted click/submit/keyboard handlers
 * in the CanvasLensView renderer component. They must not be created from
 * message event handlers, timers, or any programmatic path.
 */
export interface CanvasGestureGrant {
  /** Mind the grant is scoped to. */
  mindId: string;
  /** Lens view ID the grant is scoped to. */
  viewId: string;
  /** Action variant this grant authorises. */
  actionVariant: 'user-action';
  /** Single-use opaque identifier (crypto.randomUUID()). */
  nonce: string;
  /** Unix ms timestamp after which the grant is expired (mint time + 5 000 ms). */
  expiresAt: number;
  /** Unix ms timestamp when the grant was minted. */
  issuedAt: number;
}

// ---------------------------------------------------------------------------
// Bounded action schema
// ---------------------------------------------------------------------------

/**
 * Maximum byte length of the `label` field.
 * Labels describe the UI action (e.g. "button-clicked") and must not carry
 * prompt instructions.
 */
export const CANVAS_ACTION_LABEL_MAX_LENGTH = 120;

/** Maximum number of fields in the `fields` map. */
export const CANVAS_ACTION_FIELDS_MAX_COUNT = 20;

/** Maximum string length for a single field value. */
export const CANVAS_ACTION_FIELD_VALUE_MAX_LENGTH = 512;

/** Maximum total byte size of the parsed action request (64 KiB). */
export const CANVAS_ACTION_MAX_BYTES = 64 * 1024;

/**
 * A generic user-initiated interaction with a Canvas Lens view. The label
 * names the UI gesture (like a button id or form name). The fields carry
 * structured, primitive-typed data — no arbitrary prompt strings, no command
 * strings, no tool selection.
 *
 * All fields are treated as untrusted data when constructing prompts.
 */
export interface CanvasUserAction {
  schemaVersion: 1;
  variant: 'user-action';
  /**
   * Short label identifying the UI element or gesture.
   * Max length: CANVAS_ACTION_LABEL_MAX_LENGTH characters.
   */
  label: string;
  /**
   * Structured payload with primitive-typed values only.
   * No nested objects, no arrays, no null.
   */
  fields: Record<string, string | number | boolean>;
}

/** Discriminated union of all supported Canvas action variants. */
export type CanvasActionRequest = CanvasUserAction;

// ---------------------------------------------------------------------------
// Strict parser
// ---------------------------------------------------------------------------

/**
 * Parse and validate a raw (untrusted) value as a CanvasActionRequest.
 * Throws a descriptive Error if the value is invalid.
 *
 * Checks:
 * - schemaVersion === 1
 * - variant is a known value
 * - label is a non-empty string within length limit
 * - fields has only string/number/boolean values, within count and length limits
 * - no extra fields beyond the schema
 */
export function parseCanvasActionRequest(raw: unknown): CanvasActionRequest {
  if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('Canvas action request must be a plain object');
  }

  const obj = raw as Record<string, unknown>;

  if (obj.schemaVersion !== 1) {
    throw new Error(`Unsupported Canvas action schemaVersion: ${String(obj.schemaVersion)}`);
  }

  const { variant } = obj;
  if (variant !== 'user-action') {
    throw new Error(`Unknown Canvas action variant: ${String(variant)}`);
  }

  const { label } = obj;
  if (typeof label !== 'string' || label.trim().length === 0) {
    throw new Error('Canvas action label must be a non-empty string');
  }
  if (label.length > CANVAS_ACTION_LABEL_MAX_LENGTH) {
    throw new Error(
      `Canvas action label exceeds maximum length of ${CANVAS_ACTION_LABEL_MAX_LENGTH} characters`,
    );
  }

  const { fields } = obj;
  if (fields === null || typeof fields !== 'object' || Array.isArray(fields)) {
    throw new Error('Canvas action fields must be a plain object');
  }
  const fieldsObj = fields as Record<string, unknown>;
  const fieldKeys = Object.keys(fieldsObj);
  if (fieldKeys.length > CANVAS_ACTION_FIELDS_MAX_COUNT) {
    throw new Error(
      `Canvas action fields exceeds maximum count of ${CANVAS_ACTION_FIELDS_MAX_COUNT}`,
    );
  }
  const validatedFields: Record<string, string | number | boolean> = {};
  for (const key of fieldKeys) {
    const value = fieldsObj[key];
    if (typeof value === 'string') {
      if (value.length > CANVAS_ACTION_FIELD_VALUE_MAX_LENGTH) {
        throw new Error(
          `Canvas action field "${key}" value exceeds maximum length of ${CANVAS_ACTION_FIELD_VALUE_MAX_LENGTH} characters`,
        );
      }
      validatedFields[key] = value;
    } else if (typeof value === 'number' || typeof value === 'boolean') {
      validatedFields[key] = value;
    } else {
      throw new Error(
        `Canvas action field "${key}" has unsupported type "${typeof value}"; only string, number, and boolean are allowed`,
      );
    }
  }

  // Reject unknown top-level fields
  const knownKeys = new Set(['schemaVersion', 'variant', 'label', 'fields']);
  for (const key of Object.keys(obj)) {
    if (!knownKeys.has(key)) {
      throw new Error(`Canvas action request contains unknown field: "${key}"`);
    }
  }

  return {
    schemaVersion: 1,
    variant: 'user-action',
    label: label.trim(),
    fields: validatedFields,
  };
}

// ---------------------------------------------------------------------------
// Grant shape validator (used by bridge and CanvasServer)
// ---------------------------------------------------------------------------

/** Returns true if value has the required shape of a CanvasGestureGrant. */
export function isCanvasGestureGrantShape(value: unknown): value is CanvasGestureGrant {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const obj = value as Record<string, unknown>;
  return (
    typeof obj.mindId === 'string' && obj.mindId.length > 0 &&
    typeof obj.viewId === 'string' && obj.viewId.length > 0 &&
    obj.actionVariant === 'user-action' &&
    typeof obj.nonce === 'string' && obj.nonce.length > 0 &&
    typeof obj.expiresAt === 'number' &&
    typeof obj.issuedAt === 'number'
  );
}
