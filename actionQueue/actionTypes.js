// Game-agnostic action queue types, normalization and validation.
//
// ONE entry shape is shared by every substrate that records or executes a
// linear script of actions (jta, omsi, and — from the maze migration — the
// maze). The shape has exactly two layers:
//
//   * the DECLARED fields below, which every consumer may read; and
//   * `params`, an open bag for a substrate's own riders (jta's `zoneId` /
//     `taskType`, omsi's `loopsType`, a future verb's second argument).
//
// Anything a caller hands `normalizeEntry` that is not a declared field lands
// in `params` rather than being dropped — the mistake the three hand-written
// field lists used to make (a rider vanished on the first `undoLast`).

/**
 * State of a queue entry during execution
 * @enum {string}
 */
export const ActionState = Object.freeze({
    PENDING: 'pending',
    ACTIVE: 'active',
    COMPLETED: 'completed',
    FAILED: 'failed',
    SKIPPED: 'skipped',
});

/** The serialization envelope's format tag. */
export const ACTION_QUEUE_FORMAT = 'actionQueue/1';

/**
 * @typedef {object} QueueEntry
 * @property {string} [entryId] - Unique stable ID for drag-and-drop identity.
 *   A LIVE-QUEUE concern: minted by the queue itself and ABSENT from
 *   recordings, which must stay byte-identical across two captures of the
 *   same visit (a wall-clock id defeats the store's duplicate detection).
 * @property {string} [substrate] - Owning substrate id ('maze', 'jta', 'omsi').
 *   Optional: a queue built inside one substrate's own panel needs no stamp;
 *   a converter writing a recording stamps it, so a cross-substrate viewer can
 *   tell a maze `move` from a platformer `move`.
 * @property {string} actionType - String from a game-specific action type enum
 * @property {string|number|null} actionId - Game-specific identifier (task ID, item type, direction, ...)
 * @property {string} [label] - Display name. DERIVED, not authoritative: the
 *   substrate's registry entry `describeAction(entry)` is the owner. Kept as an
 *   optional field so existing stored queues and hand-authored entries survive.
 * @property {string} [group] - Optional grouping (zone name, item category)
 * @property {object} [params] - Substrate-specific riders. Plain object; keys
 *   are sorted so two entries with the same params serialize byte-identically.
 * @property {number} loops - Number of times to perform (default 1)
 * @property {boolean} disabled - Skip this entry when executing
 */

/**
 * @typedef {object} ActionStatus
 * @property {string} entryId - Matches QueueEntry.entryId
 * @property {ActionState} state - Current state
 * @property {number} loopsCompleted - How many loops finished so far
 * @property {string} [error] - Error message if failed
 */

/**
 * The declared fields, in the order every normalized entry carries them.
 * Serialization is `JSON.stringify` of these objects, so a FIXED key order is
 * what makes byte-identity a testable property rather than an accident.
 */
const DECLARED_KEYS = Object.freeze([
    'entryId', 'substrate', 'actionType', 'actionId',
    'label', 'group', 'params', 'loops', 'disabled',
]);

let nextEntryId = 1;

/**
 * Generate a unique entry ID.
 *
 * ⚠ Wall-clock based, therefore NOT stable across two captures of the same
 * thing. Only the live queue mints ids (`normalizeEntry(raw, {mintId:true})`);
 * a recording carries none.
 * @returns {string}
 */
export function generateEntryId() {
    return `aq_${Date.now()}_${nextEntryId++}`;
}

function isPlainObject(v) {
    return !!v && typeof v === 'object' && !Array.isArray(v);
}

/** Sorted-key copy, so `{b:1,a:2}` and `{a:2,b:1}` serialize the same. */
function canonicalParams(params) {
    const out = {};
    for (const key of Object.keys(params).sort()) {
        if (params[key] !== undefined) out[key] = params[key];
    }
    return out;
}

/**
 * Build a canonical entry from anything entry-shaped.
 *
 * The ONE place the entry shape is written down. `ActionQueue.add`,
 * `.deserialize` and `.undoLast` all route through it, as do the substrate
 * converters, so a rider added by any of them survives every copy.
 *
 * @param {object} raw
 * @param {{mintId?: boolean}} [opts] - mintId: give the entry an id when it has
 *   none (the LIVE-queue path — statuses are keyed by id). Recordings pass
 *   nothing and stay id-less.
 * @returns {QueueEntry}
 */
export function normalizeEntry(raw, { mintId = false } = {}) {
    const src = isPlainObject(raw) ? raw : {};

    const params = {};
    if (isPlainObject(src.params)) Object.assign(params, src.params);
    for (const [key, value] of Object.entries(src)) {
        if (DECLARED_KEYS.includes(key)) continue;
        if (value === undefined) continue;
        params[key] = value;
    }

    const out = {};
    if (src.entryId) out.entryId = src.entryId;
    else if (mintId) out.entryId = generateEntryId();
    if (src.substrate !== undefined) out.substrate = src.substrate;
    out.actionType = src.actionType;
    out.actionId = src.actionId ?? null;
    if (src.label !== undefined && src.label !== '') out.label = src.label;
    if (src.group !== undefined && src.group !== '') out.group = src.group;
    if (Object.keys(params).length > 0) out.params = canonicalParams(params);
    out.loops = src.loops ?? 1;
    out.disabled = src.disabled ?? false;
    return out;
}

/**
 * Why this entry is not a legal queue entry, or null when it is.
 *
 * `actionType` is the ONE required field. Everything else is either optional
 * or has a documented default that `normalizeEntry` fills in — a WRONG value
 * is refused by name, an ABSENT one is not, because raw recordings and
 * hand-authored entries legitimately omit `loops`/`disabled` and the store
 * validates them before they ever reach `normalizeEntry`.
 *
 * `loops` is an integer ≥ 0, NOT ≥ 1: omsi's authored plans legitimately hold
 * a 0-rep entry and `convertPlanToQueue` preserves it deliberately
 * (omsiSubstrateWrapperLibrary `_readLoops`, pinned by
 * omsiSubstrateWrapper.test.js "preserves a 0-rep entry rather than inventing
 * a rep"). A ≥ 1 rule would make every such recording unsaveable.
 *
 * @param {object} entry
 * @returns {string|null}
 */
export function validateEntry(entry) {
    if (!isPlainObject(entry)) return 'entry must be a plain object';
    if (typeof entry.actionType !== 'string' || entry.actionType === '') {
        return `actionType must be a non-empty string (got ${describeValue(entry.actionType)})`;
    }
    if (entry.loops !== undefined && (!Number.isInteger(entry.loops) || entry.loops < 0)) {
        return `loops must be an integer >= 0 when present (got ${describeValue(entry.loops)})`;
    }
    if (entry.disabled !== undefined && typeof entry.disabled !== 'boolean') {
        return `disabled must be a boolean when present (got ${describeValue(entry.disabled)})`;
    }
    if (entry.params !== undefined && !isPlainObject(entry.params)) {
        return `params must be a plain object when present (got ${describeValue(entry.params)})`;
    }
    if (entry.substrate !== undefined && typeof entry.substrate !== 'string') {
        return `substrate must be a string when present (got ${describeValue(entry.substrate)})`;
    }
    if (entry.entryId !== undefined && typeof entry.entryId !== 'string') {
        return `entryId must be a string when present (got ${describeValue(entry.entryId)})`;
    }
    if (entry.label !== undefined && typeof entry.label !== 'string') {
        return `label must be a string when present (got ${describeValue(entry.label)})`;
    }
    if (entry.group !== undefined && typeof entry.group !== 'string') {
        return `group must be a string when present (got ${describeValue(entry.group)})`;
    }
    return null;
}

/**
 * Throw unless `entry` is a legal queue entry. The message names the FIELD, so
 * a malformed recording says which one rather than replaying as garbage.
 * @param {object} entry
 * @param {string} [where] - caller name for the message prefix
 */
export function assertEntry(entry, where = 'actionQueue entry') {
    const problem = validateEntry(entry);
    if (problem) throw new TypeError(`${where}: ${problem}`);
}

function describeValue(v) {
    if (v === null) return 'null';
    if (v === undefined) return 'undefined';
    if (Array.isArray(v)) return 'array';
    if (typeof v === 'string') return `string '${v}'`;
    return `${typeof v} ${String(v)}`;
}

/**
 * Apply a status update. `actuals` is the one MERGED field — a substrate fills
 * it across several calls (energy before, energy after, skills retroactively),
 * so a plain Object.assign would drop the earlier passes.
 * @param {object} status
 * @param {object} update
 */
export function mergeStatus(status, update) {
    if (!update) return;
    const { actuals, ...rest } = update;
    Object.assign(status, rest);
    if (actuals !== undefined) {
        status.actuals = { ...(status.actuals ?? {}), ...actuals };
    }
}
