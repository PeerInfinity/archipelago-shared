/**
 * Pure-function loop-mode cost generator.
 *
 * Derives per-region `moveCost` and per-location cost numbers from a
 * sphere log + rules.json. Output schema matches what
 * `frontend/modules/loops/costDataManager.js` consumes at runtime, so
 * sidecars produced here are interchangeable with sidecars produced by
 * the runtime CostGenerator.
 *
 * Algorithm (mirrors the runtime CostGenerator's behavior, but without
 * mutating live loop state):
 *   - Start with maxMana = 100 (or `startingMaxMana` opt). The simulated
 *     "current mana" at the start of each iteration equals maxMana,
 *     because the runtime version refills mana via `_resetLoop` between
 *     iterations.
 *   - For each location entry in sphere order:
 *       • BFS from the start region to the target region (rule-gates
 *         ignored — the sphere log already orders entries past their
 *         prereqs, so any traversable graph path is acceptable).
 *       • For each region in the path that hasn't been costed yet:
 *           cost = max(1, floor((maxMana / 2) / remainingUncostedInPath))
 *       • If the location hasn't been costed yet:
 *           cost = max(1, floor(maxMana / 2))
 *   - After each entry: maxMana += itemsReceived * manaPerItem.
 *   - Fill in defaults for regions/locations the sphere log didn't
 *     touch (default region cost = highest neighbor cost, location
 *     cost = max of existing location costs).
 *
 * This module has no DOM or eventBus dependencies and runs both in the
 * browser pipeline and in tests.
 */

import { substrateRegistry } from './substrateRegistry.js';

const DEFAULT_PLAYER_ID = '1';

const VALID_REGION_XP_EFFECTS = ['cost', 'speed', 'both', 'none'];
const DEFAULT_REGION_XP_EFFECT = 'cost';

/**
 * Mana per second charged while live-playing a SUMMARY substrate's region
 * (runner, bounce — M5, user default 2026-07-23). Lives here, with the
 * rest of the generated-sidecar vocabulary, so the generator and the
 * runtime reader (loops/costDataManager.js) cannot drift apart; this
 * module is pure, so importing it costs the runtime nothing.
 */
export const DEFAULT_TIME_DRAIN_PER_SECOND = 1;

/**
 * ⚖ THE COST VOCABULARY'S DEFAULTS, EXPORTED — user ruling 2026-09-06:
 * *"I want the updated default location cost of 10 to be an exported constant,
 * not a block field update. In general, I want the code to use exported
 * constants, not hardcoded numbers."*
 *
 * These are the numbers a cost block falls back to when it names no value for
 * a region or a location, AND the numbers the runtime charges when no block is
 * loaded at all. They lived as five independent hardcoded copies across
 * `loops/costDataManager.js`, `loops/loopState.js`, `loops/loopUI.js` (twice)
 * and `loopStats/queueAnalyzer.js`, which is how the store's location fallback
 * (100) and the generator's (10) came to disagree. One definition, here, beside
 * the rest of the generated-block vocabulary; every reader imports it.
 *
 * ⚠ `DEFAULT_LOCATION_COST` is **10**, not the runtime's historical 100 — that
 * is the ruling, and it moves what a world WITHOUT a block charges for a
 * location check.
 */
export const DEFAULT_REGION_COST = 50;
export const DEFAULT_LOCATION_COST = 10;

/**
 * Explore is priced as a multiple of the region's move cost — the generic
 * model, stated once. Read by `loopState._calculateActionCost` ('customAction'
 * = region cost × this), by `loopState._summaryBaseCost`, and by the planner's
 * explore loop and its defaults fill (an unvisited location is priced at its
 * region's cost × this, "matching explore cost ratio").
 */
export const DEFAULT_EXPLORE_MULTIPLIER = 2;

/** Mana a simulated loop starts with, before any item boost. */
export const DEFAULT_STARTING_MAX_MANA = 100;

/** Max mana added per inventory item received, in the simulation. */
export const DEFAULT_MANA_PER_ITEM = 10;

/**
 * The set of regions belonging to SUMMARY substrates (M5). Those regions
 * are priced by TIME: a per-action cost would be charged on top of the
 * time drain, so the sidecar states a drain rate for them and no moveCost
 * or location costs at all (ruling: summary substrates charge per action
 * only where the data says so EXPLICITLY — which a generated sidecar must
 * therefore not say by default).
 *
 * The substrate id comes from the preset sidecars; whether it is a summary
 * substrate comes from its registry declaration, so this can never
 * disagree with the runtime. An unregistered substrate (a headless run
 * that never imported the libraries) reads as non-summary — today's
 * behavior, which is the safe direction.
 */
function collectSummaryRegions(rulesJson, playerId) {
    const out = new Set();
    const sidecars = rulesJson?.preset_sidecars?.[playerId];
    if (!sidecars || typeof sidecars !== 'object') return out;
    for (const [regionName, entry] of Object.entries(sidecars)) {
        const id = entry?.substrate;
        if (!id) continue;
        try {
            if (substrateRegistry.get(id)?.loopSupport?.summaryRecording) out.add(regionName);
        } catch { /* registry unavailable — treat as non-summary */ }
    }
    return out;
}

function _normalizeRegionXpEffect(effect) {
    return VALID_REGION_XP_EFFECTS.includes(effect) ? effect : DEFAULT_REGION_XP_EFFECT;
}

/**
 * @param {Object} args
 * @param {Object} args.rulesJson — the source rules.json
 * @param {Array}  args.sphereLog — parsed sphere log entries
 * @param {string} [args.playerId='1']
 * @param {number} [args.startingMaxMana=DEFAULT_STARTING_MAX_MANA]
 * @param {number} [args.manaPerItem=DEFAULT_MANA_PER_ITEM]
 * @param {number} [args.defaultRegionCost=DEFAULT_REGION_COST]
 * @param {number} [args.defaultLocationCost=DEFAULT_LOCATION_COST]
 * @param {'cost'|'speed'|'both'|'none'} [args.regionXpEffect='cost']
 *        Per-region XP effect mode. Stamped on every region entry as
 *        `xpEffect`, plus written to `defaultRegionXpEffect` at the
 *        sidecar root for fallback.
 * @param {string} [args.sourceFileName=null] — recorded in metadata
 * @returns {Object} cost data (version, generatedAt, regions, locations,
 *                   defaultRegionCost, defaultLocationCost,
 *                   defaultRegionXpEffect)
 */
export function generateLoopCosts({
    rulesJson,
    sphereLog,
    playerId = DEFAULT_PLAYER_ID,
    startingMaxMana = DEFAULT_STARTING_MAX_MANA,
    manaPerItem = DEFAULT_MANA_PER_ITEM,
    defaultRegionCost = DEFAULT_REGION_COST,
    defaultLocationCost = DEFAULT_LOCATION_COST,
    regionXpEffect = DEFAULT_REGION_XP_EFFECT,
    sourceFileName = null,
} = {}) {
    if (!rulesJson || typeof rulesJson !== 'object') {
        throw new Error('generateLoopCosts: rulesJson required');
    }
    if (!Array.isArray(sphereLog)) {
        throw new Error('generateLoopCosts: sphereLog must be an array');
    }

    const regions = rulesJson?.regions?.[playerId] ?? {};
    if (Object.keys(regions).length === 0) {
        throw new Error(`generateLoopCosts: no regions for player '${playerId}'`);
    }

    const startRegion = resolveStartRegion(rulesJson, regions, playerId);
    if (!startRegion) {
        throw new Error(`generateLoopCosts: no usable start region for player '${playerId}'`);
    }

    const adjacency = buildAdjacency(regions);
    const locationToRegion = buildLocationIndex(regions);
    const xpEffect = _normalizeRegionXpEffect(regionXpEffect);

    const summaryRegions = collectSummaryRegions(rulesJson, playerId);
    const locationToSummary = (locationName) => summaryRegions.has(locationToRegion.get(locationName));

    const costs = {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        generatedFrom: sourceFileName,
        regions: {
            [startRegion]: summaryRegions.has(startRegion)
                ? { timeDrainPerSecond: DEFAULT_TIME_DRAIN_PER_SECOND, xpEffect }
                : { moveCost: 0, xpEffect },
        },
        locations: {},
        defaultRegionCost,
        defaultLocationCost,
        defaultRegionXpEffect: xpEffect,
    };

    const assignedRegions = new Set([startRegion]);
    const assignedLocations = new Set();

    let maxMana = startingMaxMana;

    const entries = extractLocationEntries(sphereLog, playerId);
    for (const entry of entries) {
        if (!entry.locationName) {
            // Phantom entry (items received from other players, no
            // location to check): just bump maxMana.
            maxMana += entry.itemsReceived * manaPerItem;
            continue;
        }

        const targetRegion = locationToRegion.get(entry.locationName);
        if (!targetRegion) {
            // Location not in this player's static data — apply mana
            // boost and skip.
            maxMana += entry.itemsReceived * manaPerItem;
            continue;
        }

        const path = bfsRegions(adjacency, startRegion, targetRegion);
        if (!path) {
            // Disconnected graph — still apply mana boost.
            maxMana += entry.itemsReceived * manaPerItem;
            continue;
        }

        // Cost the uncosted regions along the path.
        const uncosted = path.filter((r) => !assignedRegions.has(r));
        if (uncosted.length > 0) {
            const manaForRegions = maxMana / 2;
            let remaining = uncosted.length;
            for (const region of uncosted) {
                if (summaryRegions.has(region)) {
                    // Time-priced: a drain rate instead of a per-move cost.
                    costs.regions[region] = {
                        timeDrainPerSecond: DEFAULT_TIME_DRAIN_PER_SECOND, xpEffect,
                    };
                    assignedRegions.add(region);
                    remaining -= 1;
                    continue;
                }
                const cost = Math.max(1, Math.floor(manaForRegions / remaining));
                costs.regions[region] = { moveCost: cost, xpEffect };
                assignedRegions.add(region);
                remaining -= 1;
            }
        }

        // Cost the location if not already costed. Locations inside a
        // summary region stay uncosted — the visit's time is their price.
        if (!assignedLocations.has(entry.locationName)) {
            if (!locationToSummary(entry.locationName)) {
                costs.locations[entry.locationName] = Math.max(1, Math.floor(maxMana / 2));
            }
            assignedLocations.add(entry.locationName);
        }

        // Mana boost from items received in this sphere takes effect
        // for the next iteration.
        maxMana += entry.itemsReceived * manaPerItem;
    }

    fillDefaults(costs, regions, assignedRegions, assignedLocations, summaryRegions);
    return costs;
}

// ---------- helpers ----------

function resolveStartRegion(rulesJson, regions, playerId) {
    const startField = rulesJson?.start_regions?.[playerId];
    let declared = null;
    if (Array.isArray(startField?.default)) declared = startField.default[0];
    else if (Array.isArray(startField)) declared = startField[0];
    if (declared && regions[declared]) return declared;
    // Fall back to the first region in the map.
    const keys = Object.keys(regions);
    return keys.length > 0 ? keys[0] : null;
}

function buildAdjacency(regions) {
    // Map<regionName, Array<connectedRegion>>
    const map = new Map();
    for (const [name, data] of Object.entries(regions)) {
        const targets = [];
        for (const exit of data?.exits ?? []) {
            if (exit.connected_region) targets.push(exit.connected_region);
        }
        map.set(name, targets);
    }
    return map;
}

function buildLocationIndex(regions) {
    // Map<locationName, regionName>
    const idx = new Map();
    for (const [name, data] of Object.entries(regions)) {
        for (const loc of data?.locations ?? []) {
            const locName = typeof loc === 'string' ? loc : loc?.name;
            if (locName) idx.set(locName, name);
        }
    }
    return idx;
}

function bfsRegions(adjacency, source, target) {
    if (source === target) return [source];
    const visited = new Set([source]);
    const queue = [{ region: source, path: [source] }];
    while (queue.length > 0) {
        const { region, path } = queue.shift();
        for (const neighbor of adjacency.get(region) ?? []) {
            if (visited.has(neighbor)) continue;
            visited.add(neighbor);
            const next = [...path, neighbor];
            if (neighbor === target) return next;
            queue.push({ region: neighbor, path: next });
        }
    }
    return null;
}

function extractLocationEntries(sphereLog, playerId) {
    const out = [];
    const pid = String(playerId);
    for (const logEntry of sphereLog) {
        if (logEntry?.type !== 'state_update') continue;
        const playerData = logEntry.player_data?.[pid];
        if (!playerData) continue;

        const sphereLocations = playerData.sphere_locations || [];
        const baseItems = playerData.new_inventory_details?.base_items || {};
        const itemsReceived = Object.values(baseItems).reduce(
            (sum, count) => sum + count,
            0,
        );

        if (sphereLocations.length === 0 && itemsReceived > 0) {
            out.push({
                sphereIndex: logEntry.sphere_index,
                locationName: null,
                itemsReceived,
            });
            continue;
        }
        for (let i = 0; i < sphereLocations.length; i++) {
            out.push({
                sphereIndex: logEntry.sphere_index,
                locationName: sphereLocations[i],
                // Items received are credited on the last location of
                // the sphere (matches runtime CostGenerator).
                itemsReceived: i === sphereLocations.length - 1 ? itemsReceived : 0,
            });
        }
    }
    return out;
}

function fillDefaults(costs, regions, assignedRegions, assignedLocations, summaryRegions = new Set()) {
    const xpEffect = _normalizeRegionXpEffect(costs.defaultRegionXpEffect);
    // Uncosted regions: highest neighbor cost, or defaultRegionCost.
    // Summary regions are time-priced instead (M5).
    for (const [name, data] of Object.entries(regions)) {
        if (assignedRegions.has(name)) continue;
        if (summaryRegions.has(name)) {
            costs.regions[name] = {
                timeDrainPerSecond: DEFAULT_TIME_DRAIN_PER_SECOND, xpEffect,
            };
            continue;
        }
        let highest = 0;
        for (const exit of data?.exits ?? []) {
            const neighborCost = costs.regions[exit.connected_region]?.moveCost;
            if (neighborCost && neighborCost > highest) highest = neighborCost;
        }
        costs.regions[name] = {
            moveCost: highest > 0 ? highest : costs.defaultRegionCost,
            xpEffect,
        };
    }

    // Uncosted locations: max of existing location costs (or default).
    const existing = Object.values(costs.locations);
    const fallback = existing.length > 0
        ? Math.max(costs.defaultLocationCost, ...existing)
        : costs.defaultLocationCost;
    for (const [name, data] of Object.entries(regions)) {
        if (summaryRegions.has(name)) continue; // time-priced: locations stay free
        for (const loc of data?.locations ?? []) {
            const locName = typeof loc === 'string' ? loc : loc?.name;
            if (!locName || assignedLocations.has(locName)) continue;
            costs.locations[locName] = fallback;
        }
    }
}

// Exported for tests
export const _internal = {
    bfsRegions,
    buildAdjacency,
    buildLocationIndex,
    extractLocationEntries,
    fillDefaults,
};
