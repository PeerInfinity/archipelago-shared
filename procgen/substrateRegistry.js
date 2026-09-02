/**
 * Substrate registry — collects per-substrate registry entries so the
 * procgen player and pipeline can dispatch by substrate id without
 * any direct imports from substrate modules.
 *
 * Each substrate module registers its entry during its own
 * register() / initialize() phase by calling
 * substrateRegistry.register(entry). The registry is a singleton;
 * entries are keyed by their `id` field.
 *
 * Entry shape (informal — the authoritative field-by-field reference,
 * including optional fields not listed here, is
 * docs/json/developer/procgen/substrate-registry.md):
 *
 *   {
 *     // Identity (required)
 *     id,                       // string, unique substrate id
 *     label,                    // human-readable display name (e.g. 'Maze', 'Text Adventure', 'JtA');
 *                               // used by UI surfaces like the panel-status overlay
 *
 *     // Runtime — required for substrates that ship a panel
 *     panelComponentType,       // Golden Layout component type
 *     loadRegionEvent,          // eventBus event the panel subscribes to
 *     supportedFeatures,        // array of shared-library feature ids
 *     deserializeWorld,         // (sidecar) -> world; called by procgenPlayer
 *
 *     // Runtime — playback (optional; substrates that don't support
 *     // scripted playback may omit). The bot resolves the controller
 *     // for the current region's substrate and calls methods directly,
 *     // bypassing the eventBus. Returning null means "no panel mounted
 *     // / no controller available" and the bot should no-op.
 *     getPlaybackController,    // () -> PlaybackController | null
 *
 *     // Runtime — the action LABELLER (optional). How this substrate says
 *     // ONE shared actionQueue entry out loud: `describeAction(entry)` →
 *     // a short string ('move E', 'Chop Wood', 'check Chest'). Recordings
 *     // store no `label` — it is DERIVED from actionType/actionId and the
 *     // substrate is the only thing that knows the derivation — so every
 *     // surface that renders an entry (a panel, a tooltip, the loops item
 *     // annotation folder, a future cross-substrate queue viewer) asks the
 *     // entry's substrate rather than carrying its own copy of the wording.
 *     // ABSENT ⇒ callers fall back to the entry's own `label`, then to its
 *     // raw actionId.
 *     describeAction,           // (entry) -> string
 *
 *     // Runtime — loop-mode capabilities (optional). Declares which
 *     // loops-panel affordances this substrate's regions get. The
 *     // loops UI gates its per-region controls on this field:
 *     //   queueActions — which loop queue action types can be
 *     //     authored for the region ('regionMove', 'locationCheck',
 *     //     'explore'). E.g. bounce supports regionMove +
 *     //     locationCheck (mapped to the playback bot) but has no
 *     //     explore action.
 *     //   manual — the region can be played by hand in loop mode
 *     //     (manual checkbox / manual entries).
 *     //   customQueues — saved substrate-native action queues can be
 *     //     recorded and replayed for the region.
 *     //   executeVia (optional) — 'solver' makes the loops
 *     //     queue execute the region's queueActions by driving the
 *     //     substrate's PlaybackController.walkTo (the queue parks
 *     //     until the resulting locationCheck / regionChanged event
 *     //     arrives, then charges the action's loop_costs value).
 *     //     Absent ⇒ generic timer execution (event-driven teleport
 *     //     / AP-level check).
 *     // ABSENT field ⇒ no loop-mode affordances for the substrate's
 *     // regions. AP-native regions (no substrate at all) are not
 *     // affected — loops drives those itself.
 *     loopSupport,              // { queueActions: string[],
 *                               //   manual: boolean,
 *                               //   customQueues: boolean,
 *                               //   executeVia?: 'solver' }
 *
 *     // Cross-substrate sharing declaration (optional). Declares which
 *     // resource-channel categories this substrate participates in.
 *     // Validated at register() time — unknown categories or malformed
 *     // shapes throw. Two categories exist:
 *     //   mana — the continuous shared-pool channel (drain/refill/
 *     //     bonus/reset against the host's loop-mode mana). Presence
 *     //     means the host resource-channel router accepts this
 *     //     substrate's channel events and the shared charge/XP/
 *     //     OOM-reset helper recognizes its id.
 *     //       loopActionDelegation (optional boolean) — the loops
 *     //         queue delegates action execution + per-step charging
 *     //         for this substrate's manaEnabled regions to the
 *     //         substrate's own walker instead of the queue's flat
 *     //         tick-progress model.
 *     //   items — discrete shared consumables, namespaced
 *     //     `<substrateId>/<type>`. The declaration carries the
 *     //     shareable type list as EITHER a static `types` array OR a
 *     //     `getTypes()` provider (exactly one of the two). Grant
 *     //     routing validates against it.
 *     sharing,                  // { mana?: { loopActionDelegation?: boolean },
 *                               //   items?: { types: string[] } | { getTypes: () => string[] } }
 *
 *     // Build-time — required for substrates that drive procgen
 *     generateRegionCore,       // (input) -> { world, exits_placed, ... }
 *     placeFromItems,           // (world, input) -> { placed_items, placed_obstacles }
 *     placeFromRules,           // (world, input) -> { placed_logic_gates, placed_items, placed_locations }
 *     extractPathsAndObstacles, // (world, opts) -> extracted_rules
 *     serializeWorld,           // (world, extracted, baseObstacleLib, baseItemLib) -> sidecar
 *   }
 *
 * PlaybackController contract (substrate-neutral, used by the playback
 * bot and by the loops module's `customQueue` action type):
 *
 *   {
 *     play(rateHz?),            // start internal clock at given rate
 *     stop(),                   // pause clock
 *     step(),                   // advance one tick
 *     instant(),                // flush remaining work without delay
 *     reset(),                  // return to initial state
 *     setRate(rateHz),          // change clock rate
 *     walkTo(target),           // target = { kind:'location'|'exit'|'tile',
 *                               //            name?, region?, x?, y? }
 *     replayActions(actions, { onComplete }) — optional;
 *                               // dispatch substrate-native saved-queue
 *                               // actions in order. onComplete fires
 *                               // when the substrate has executed every
 *                               // action (or stopped trying). Returning
 *                               // null / not implementing this method
 *                               // means "this substrate does not support
 *                               // saved-queue replay" and the loops
 *                               // customQueue action will fall back to
 *                               // manual mode at that point.
 *   }
 *
 * Each method returns `void` or `Promise<void>`. Iframe-backed
 * substrates (e.g. textAdventureSubstrateWrapper) implement these as
 * host-side proxies that postMessage to an in-iframe controller and
 * naturally produce a Promise. The bot's `_dispatch` is fire-and-
 * forget — it does not await the return value. Progress signals come
 * back through the regular dispatcher events (user:locationCheck,
 * user:regionMove), the same way they do for in-process substrates.
 *
 * Build-time slots are optional. A substrate that only handles
 * runtime playback (e.g. consuming hand-authored sidecars) can
 * register without them; the driver checks for required slots at
 * dispatch time. Likewise, runtime slots are optional for a
 * substrate that only supplies build-time adapters.
 */

const SHARING_CATEGORIES = ['mana', 'items'];

/**
 * Validate an entry's optional `sharing` declaration (see the entry-shape
 * comment above). Throws with a substrate-id-prefixed message on any
 * malformed shape so misdeclarations fail loudly at register() time.
 */
function validateSharingDeclaration(entry) {
    const sharing = entry.sharing;
    if (sharing === undefined) return;
    const prefix = `substrateRegistry.register('${entry.id}').sharing`;
    if (!sharing || typeof sharing !== 'object' || Array.isArray(sharing)) {
        throw new Error(`${prefix}: must be an object`);
    }
    for (const key of Object.keys(sharing)) {
        if (!SHARING_CATEGORIES.includes(key)) {
            throw new Error(
                `${prefix}: unknown category '${key}' (known: ${SHARING_CATEGORIES.join(', ')})`,
            );
        }
    }
    const mana = sharing.mana;
    if (mana !== undefined) {
        if (!mana || typeof mana !== 'object' || Array.isArray(mana)) {
            throw new Error(`${prefix}.mana: must be an object`);
        }
        for (const key of Object.keys(mana)) {
            if (key !== 'loopActionDelegation') {
                throw new Error(`${prefix}.mana: unknown field '${key}'`);
            }
        }
        if (mana.loopActionDelegation !== undefined
            && typeof mana.loopActionDelegation !== 'boolean') {
            throw new Error(`${prefix}.mana.loopActionDelegation: must be a boolean`);
        }
    }
    const items = sharing.items;
    if (items !== undefined) {
        if (!items || typeof items !== 'object' || Array.isArray(items)) {
            throw new Error(`${prefix}.items: must be an object`);
        }
        for (const key of Object.keys(items)) {
            if (key !== 'types' && key !== 'getTypes') {
                throw new Error(`${prefix}.items: unknown field '${key}'`);
            }
        }
        const hasTypes = items.types !== undefined;
        const hasGetTypes = items.getTypes !== undefined;
        if (hasTypes === hasGetTypes) {
            throw new Error(`${prefix}.items: exactly one of 'types' or 'getTypes' required`);
        }
        if (hasTypes && (
            !Array.isArray(items.types)
            || items.types.some((t) => typeof t !== 'string' || t.length === 0)
        )) {
            throw new Error(`${prefix}.items.types: must be an array of non-empty strings`);
        }
        if (hasGetTypes && typeof items.getTypes !== 'function') {
            throw new Error(`${prefix}.items.getTypes: must be a function`);
        }
    }
}

class SubstrateRegistry {
    constructor() {
        this.entries = new Map();
    }

    register(entry) {
        if (!entry || typeof entry !== 'object') {
            throw new Error('substrateRegistry.register: entry must be an object');
        }
        if (!entry.id || typeof entry.id !== 'string') {
            throw new Error('substrateRegistry.register: entry.id must be a non-empty string');
        }
        if (this.entries.has(entry.id)) {
            throw new Error(`substrateRegistry.register: substrate '${entry.id}' already registered`);
        }
        validateSharingDeclaration(entry);
        this.entries.set(entry.id, entry);
    }

    get(id) {
        return this.entries.get(id);
    }

    has(id) {
        return this.entries.has(id);
    }

    getAll() {
        return [...this.entries.values()];
    }

    // Test-only: drop all registrations so a fresh state can be built up.
    clear() {
        this.entries.clear();
    }
}

export const substrateRegistry = new SubstrateRegistry();
