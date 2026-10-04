/**
 * rules.json `progression_mapping` — the ADDITIVE kind, applied when an item
 * is collected.
 *
 * A mapping entry is one of two kinds (schema `progressionMappingDetail`):
 *
 *   - PROGRESSIVE (`items` is an ARRAY of `{name, level}`): resolved at READ
 *     time — `has('Symmetry')` asks whether enough `Progressive Symmetry`
 *     are held. That is `gameLogic/generic/genericLogic.js` `has` / `count`.
 *   - ADDITIVE (`type: 'additive'`, `items` is an OBJECT `{name: value}`, e.g.
 *     messenger's `Shards`): resolved at COLLECT time — collecting
 *     `Time Shard (100)` adds 100 to the virtual counter `Shards`, the way the
 *     world's `collect` adds to `state.prog_items`. That is this file.
 *
 * One copy, two callers: the stateManager's inventory
 * (`stateManager/core/inventoryManager.js`) and the forward simulator's walk
 * (`procgen/forwardSimulator.js`).
 */

/**
 * True iff `itemName` is an ADDITIVE mapping's own counter (`Shards`). The
 * counter is derived from its component items, so collecting it by name is
 * not counted.
 */
export function isAdditiveProgressionCounter(progressionMapping, itemName) {
    return progressionMapping?.[itemName]?.type === 'additive';
}

/**
 * What collecting `count` × `itemName` adds to ADDITIVE counters:
 * `[[counterName, value], …]` (empty when nothing). Removal is the same list
 * negated.
 */
export function additiveProgressionGains(progressionMapping, itemName, count = 1) {
    const gains = [];
    if (!progressionMapping) return gains;
    for (const [counterName, mapping] of Object.entries(progressionMapping)) {
        if (mapping?.type === 'additive' && mapping.items && itemName in mapping.items) {
            gains.push([counterName, mapping.items[itemName] * count]);
        }
    }
    return gains;
}
