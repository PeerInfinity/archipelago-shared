/**
 * Items / obstacles library for the maze substrate.
 *
 * The vocabulary and its clear-condition semantics are documented in
 * docs/json/developer/procgen/paths-and-obstacles.md. The libraries
 * live with the substrate's frontend module and are imported directly.
 *
 * Items declare Archipelago classification. Obstacles declare one of
 * two clear-condition representations, distinguished by
 * `clear_set_type`:
 *
 *   'combo_list' (default) — `clear_set` is an OR of AND-combinations
 *       of items. `[[key_red]]` means "clears iff inventory contains
 *       key_red"; `[[jump], [fly], [rocket]]` means "clears with any
 *       one"; `[[red_key, keycard]]` means "requires both."
 *   'rule' — `clear_rule` is a Rule Builder JSON expression evaluated
 *       against the player's inventory. Used by the logic_gate
 *       obstacle (and anything else that needs to express an arbitrary
 *       AP access rule as an in-world gate).
 *
 * Permanent-key semantics: AP's `has()` is permanent, so picking up a
 * key keeps doors of its color open for the rest of the game. The
 * scenario pool is expected to supply one key per color and any
 * number of doors of that color.
 */

import { evaluateRule } from '../ruleEngine.js';

export const DEFAULT_ITEMS = Object.freeze({
    // Victory item — when present in a scenario's item pool, the
    // grid-growth driver wires up an item-check completion condition
    // (state.has(victory)) instead of the constant-true placeholder
    // and ScenarioPool defers victory items until everything else has
    // been placed, so the victory always lands in a leaf region whose
    // access chain requires the rest of the inventory. Opt-out by
    // removing the entry from the scenario's items pool. See
    // `is_victory` references in scenarioPool.js / procgenPipelineUI.js.
    victory: {
        name: 'Victory',
        id: 'victory',
        classification: 'progression',
        color: '#f5d020',
        symbol: 'star',
        feature: 'victory',
        is_victory: true,
    },
    key_red: {
        name: 'Red Key',
        id: 'key_red',
        classification: 'progression',
        color: '#d04040',
        symbol: 'key',
        feature: 'colored_doors_and_keys',
    },
    key_green: {
        name: 'Green Key',
        id: 'key_green',
        classification: 'progression',
        color: '#40c060',
        symbol: 'key',
        feature: 'colored_doors_and_keys',
    },
    key_blue: {
        name: 'Blue Key',
        id: 'key_blue',
        classification: 'progression',
        color: '#4080d0',
        symbol: 'key',
        feature: 'colored_doors_and_keys',
    },
    key_yellow: {
        name: 'Yellow Key',
        id: 'key_yellow',
        classification: 'progression',
        color: '#d8b820',
        symbol: 'key',
        feature: 'colored_doors_and_keys',
    },
    key_purple: {
        name: 'Purple Key',
        id: 'key_purple',
        classification: 'progression',
        color: '#a040c0',
        symbol: 'key',
        feature: 'colored_doors_and_keys',
    },
    key_orange: {
        name: 'Orange Key',
        id: 'key_orange',
        classification: 'progression',
        color: '#d87830',
        symbol: 'key',
        feature: 'colored_doors_and_keys',
    },
});

export const DEFAULT_OBSTACLES = Object.freeze({
    door_red: {
        name: 'Red Door',
        id: 'door_red',
        clear_set_type: 'combo_list',
        clear_set: [['key_red']],
        color: '#b84040',
        feature: 'colored_doors_and_keys',
    },
    door_green: {
        name: 'Green Door',
        id: 'door_green',
        clear_set_type: 'combo_list',
        clear_set: [['key_green']],
        color: '#408040',
        feature: 'colored_doors_and_keys',
    },
    door_blue: {
        name: 'Blue Door',
        id: 'door_blue',
        clear_set_type: 'combo_list',
        clear_set: [['key_blue']],
        color: '#404080',
        feature: 'colored_doors_and_keys',
    },
    door_yellow: {
        name: 'Yellow Door',
        id: 'door_yellow',
        clear_set_type: 'combo_list',
        clear_set: [['key_yellow']],
        color: '#a08018',
        feature: 'colored_doors_and_keys',
    },
    door_purple: {
        name: 'Purple Door',
        id: 'door_purple',
        clear_set_type: 'combo_list',
        clear_set: [['key_purple']],
        color: '#803090',
        feature: 'colored_doors_and_keys',
    },
    door_orange: {
        name: 'Orange Door',
        id: 'door_orange',
        clear_set_type: 'combo_list',
        clear_set: [['key_orange']],
        color: '#b06018',
        feature: 'colored_doors_and_keys',
    },
    // Template for logic-gate obstacles. Per-instance gates are
    // created by cloning this entry into the region's obstacleLib
    // with a unique id and an instance-specific `clear_rule` (a Rule
    // Builder JSON expression). Visual: a see-through gate so the
    // player can see what they're trying to reach before they know
    // which rule they need to satisfy.
    logic_gate: {
        name: 'Logic Gate',
        id: 'logic_gate',
        clear_set_type: 'rule',
        clear_rule: null,
        color: '#b06eb8',
        display: { mode: 'tree' },
        feature: 'logic_gate',
    },
});

/**
 * The shared rule engine's evaluation context, reduced to an inventory —
 * either a Set<item> (count-blind: every held item counts as 1) or a
 * Map<item, count> (count-aware; the forward simulator carries one so
 * count gates evaluate). It answers item questions only: anything that
 * needs more (a game helper, region reachability, a setting) evaluates
 * to `undefined` in the engine.
 */
export function inventoryRuleContext(inventory, playerId = '1') {
    const count = inventory instanceof Map
        ? (name) => inventory.get(name) ?? 0
        : (name) => (inventory.has(name) ? 1 : 0);
    return {
        _isSnapshotInterface: true,
        getPlayerId: () => String(playerId),
        hasItem: (name) => count(name) > 0,
        countItem: count,
    };
}

/**
 * Evaluate a rule against an inventory with THE shared rule engine
 * (`shared/ruleEngine`, the evaluator play uses) — three-valued: true,
 * false, or `undefined` when the rule needs something an inventory
 * cannot answer (a game helper, CanReachRegion, a setting…).
 */
export function evaluateRuleWithInventory(rule, inventory, playerId = '1') {
    if (!rule || typeof rule !== 'object') return undefined;
    return evaluateRule(rule, inventoryRuleContext(inventory, playerId));
}

/**
 * Evaluate a Rule Builder rule against an inventory (Set or Map, see
 * inventoryRuleContext). A rule the engine cannot decide from an
 * inventory alone is treated as unsatisfied (false) — per
 * top-down-driver.md §8's degradation strategy: rather than throwing on
 * a foreign rules.json, fall back to "blocked" so the substrate's
 * path-extraction / placement BFS keeps working. A caller that must NOT
 * degrade (the sphere log) uses evaluateRuleWithInventory and refuses on
 * `undefined` instead.
 *
 * One evaluator, not two: this delegates to the shared engine, so its
 * vocabulary is the engine's (Has, HasAll, HasAny, HasAllCounts,
 * HasFromList, HasFromListUnique, And, Or, AtLeast, …) and cannot drift.
 */
export function evaluateRuleAgainstInventory(rule, inventory, playerId = '1') {
    return evaluateRuleWithInventory(rule, inventory, playerId) === true;
}

/**
 * Name what makes `rule` undecidable over `inventory`: descend from the
 * root through children that themselves evaluate to `undefined`, and name
 * each undecided node none of whose children is undecided — its `rule`,
 * or `type:<t>` for an AST node. Sorted, distinct; empty when the rule
 * evaluates to true/false.
 */
export function undeterminedRuleKinds(rule, inventory, playerId = '1', out = new Set()) {
    if (evaluateRuleWithInventory(rule, inventory, playerId) !== undefined) return [...out].sort();
    let deeper = false;
    for (const child of Array.isArray(rule?.children) ? rule.children : []) {
        if (evaluateRuleWithInventory(child, inventory, playerId) === undefined) {
            deeper = true;
            undeterminedRuleKinds(child, inventory, playerId, out);
        }
    }
    if (!deeper) {
        out.add(typeof rule?.rule === 'string' ? rule.rule
            : (typeof rule?.type === 'string' ? `type:${rule.type}` : '<not a rule>'));
    }
    return [...out].sort();
}

/**
 * Render hints for an item id. Looks the item up in `itemLib`; when
 * absent (a "foreign" item from a top-down driver consuming another
 * game's rules.json), derives a hash-based HSL color and uses the
 * first character of the id as a label, so different unknown items
 * remain visually distinguishable.
 *
 *   { color, label, name }
 *
 * Both maze-substrate panels (mazeRoomUI, procgenPipelineUI) call
 * this when drawing an item tile. label is null when the library
 * entry has no symbol — known items keep their plain colored-circle
 * rendering; unknown items get the letter overlay.
 */
export function getItemRenderHints(itemId, itemLib = DEFAULT_ITEMS) {
    const item = itemLib?.[itemId];
    if (item) {
        return {
            color: item.color ?? '#e6a817',
            label: item.symbol ?? null,
            name: item.name ?? itemId,
        };
    }
    // Foreign item: hash the id for color, take the first character
    // (uppercased) as a label, and fall back to the id itself for
    // the display name.
    let hash = 0;
    for (let i = 0; i < itemId.length; i++) {
        hash = ((hash << 5) - hash) + itemId.charCodeAt(i);
        hash |= 0;
    }
    const hue = Math.abs(hash) % 360;
    return {
        color: `hsl(${hue}, 65%, 55%)`,
        label: (itemId[0] ?? '?').toUpperCase(),
        name: itemId,
    };
}

/**
 * True iff the player's inventory clears the obstacle. Dispatches on
 * `clear_set_type`:
 *   - 'combo_list' (default): any one AND-combination fully present
 *     in inventory.
 *   - 'rule': the obstacle's `clear_rule` is evaluated. By default
 *     this uses the local Rule-Builder subset evaluator
 *     (`evaluateRuleAgainstInventory`); for foreign rules.json
 *     files that use constructs the local evaluator doesn't
 *     understand (CountItem, helpers, …), the caller can pass
 *     `opts.evaluateRule` — a function `(rule, inventory) => bool`
 *     — to delegate to a richer evaluator (typically one wired up
 *     to stateManager's snapshot interface + the shared rule
 *     engine). See top-down-driver.md §8.
 */
export function isObstacleCleared(obstacleId, inventory, obstacleLib = DEFAULT_OBSTACLES, opts) {
    const obstacle = obstacleLib[obstacleId];
    if (!obstacle) return true; // Unknown obstacle id ≡ no gate; permissive for robustness.
    const type = obstacle.clear_set_type ?? 'combo_list';
    if (type === 'rule') {
        if (!obstacle.clear_rule) return false; // No rule attached ≡ never clearable.
        const evaluator = opts?.evaluateRule ?? evaluateRuleAgainstInventory;
        return evaluator(obstacle.clear_rule, inventory);
    }
    // combo_list
    for (const combination of obstacle.clear_set ?? []) {
        let all = true;
        for (const itemId of combination) {
            if (!inventory.has(itemId)) { all = false; break; }
        }
        if (all) return true;
    }
    return false;
}
