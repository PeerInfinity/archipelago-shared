/**
 * loopCostGenerator — **the `loop_costs` BLOCK producer.** One algorithm
 * (`loopCostPlanner.js`), one classification rule, one block.
 *
 * ── ⚖ ONE ALGORITHM, SINCE 2026-09-06 ─────────────────────────────────
 *
 * This module used to carry its OWN cost model — a maxMana/2 split across the
 * uncosted regions of a BFS path — while the runtime ran a different one
 * (`loopsCostDebugger/costPlanner.js`, the Loops panel's Generate Costs and the
 * auto-generate on entering loop mode). Over five documents the two agreed only
 * on the start region and the first priced region. ⚖ The user ruled: *"Let's
 * make the planner the official algorithm, but let's make the default location
 * cost 10, not 100."* That model now lives in `loopCostPlanner.js` and this file
 * is what turns a planned walk into the block a world ships. The old algorithm
 * is GONE — `check-loop-costs-one-model.mjs` is the standing proof that the
 * pipeline's block and the debugger's plan are the same bytes.
 *
 * ── ⚖ SIMULATE AS COARSE, WRITE BY CLASS ──────────────────────────────
 *
 * ⚖ the user, on the simulation's design: the planner *"was designed for only
 * coarse substrates"*, so v1 is *"treat every region as if it's a coarse region,
 * when running the simulation, but store the costs according to what we already
 * decided"*. The walk therefore prices EVERY region; `writeCostsByClass` then
 * decides what actually reaches the block, per the substrate's own registry
 * declaration. See `classifyRegion` for the four classes and how each was
 * measured.
 *
 * ── THE SHAPE THIS WRITES ─────────────────────────────────────────────
 *
 *   { version, generatedAt, generatedFrom, regions, locations,
 *     defaultRegionCost, defaultLocationCost, defaultRegionXpEffect }
 *
 * consumed by `frontend/modules/loops/costDataManager.js`. Its presence in a
 * rules.json is ALSO the loop-mode switch (⚖ "keep 'block presence means loop
 * mode on'"), which is why the hand-written test presets ship a deliberately
 * EMPTY one.
 *
 * This module has no DOM or eventBus dependencies and runs both in the browser
 * pipeline and in tests.
 */

import { substrateRegistry } from './substrateRegistry.js';
import {
    CostPlanner,
    topologyFromRulesJson,
    // re-exported below: the two adapters and the planner are this module's
    // public surface as much as generateLoopCosts is.
    topologyFromStaticData,
    regionSubstratesFromRulesJson,
    resolveStartRegion,
    emptyTopology,
} from './loopCostPlanner.js';
import {
    VALID_REGION_XP_EFFECTS,
    DEFAULT_REGION_XP_EFFECT,
    DEFAULT_TIME_DRAIN_PER_SECOND,
    DEFAULT_REGION_COST,
    DEFAULT_LOCATION_COST,
    DEFAULT_EXPLORE_MULTIPLIER,
    DEFAULT_STARTING_MAX_MANA,
    DEFAULT_MANA_PER_ITEM,
} from './loopCostDefaults.js';

const DEFAULT_PLAYER_ID = '1';

// ⛓ The vocabulary's numbers live in `loopCostDefaults.js` (a leaf module, so
// the producer can import the algorithm without a cycle) and are re-exported
// HERE, which is the path every runtime reader already imports.
export {
    VALID_REGION_XP_EFFECTS,
    DEFAULT_REGION_XP_EFFECT,
    DEFAULT_TIME_DRAIN_PER_SECOND,
    DEFAULT_REGION_COST,
    DEFAULT_LOCATION_COST,
    DEFAULT_EXPLORE_MULTIPLIER,
    DEFAULT_STARTING_MAX_MANA,
    DEFAULT_MANA_PER_ITEM,
};
export {
    CostPlanner,
    topologyFromRulesJson,
    topologyFromStaticData,
    regionSubstratesFromRulesJson,
    emptyTopology,
};

/** Region cost classes — what a region's substrate lets the block SAY. */
export const REGION_CLASS = Object.freeze({
    /** No substrate, or one that reads the block: full numbers. */
    COARSE: 'coarse',
    /** SUMMARY substrate (runner, bounce): a drain rate, nothing else. */
    SUMMARY: 'summary',
    /** The substrate runs its own mana economy (jta, omsi): NO entries. */
    NATIVE: 'native',
});

/**
 * ⚖ **WHICH CLASS A REGION IS IN — and every part of this was MEASURED, not
 * inherited.** The rule reads the substrate's own registry declaration, so it
 * can never disagree with the runtime about a substrate it has actually seen.
 *
 *   SUMMARY  `loopSupport.summaryRecording` — runner, bounce. Priced by TIME;
 *            a per-action cost would be charged ON TOP of the drain, so the
 *            block states a rate and says nothing else (M5, user 2026-07-23).
 *
 *   NATIVE   a RECORDER (`takeLastRecording`) **and** a shared-mana declaration
 *            (`sharing.mana`) **and not** `sharing.mana.loopActionDelegation` —
 *            jta and omsi. Their resource-channel router charges the pool with
 *            no region attached, so no block value is ever read, no region XP is
 *            awarded and no XP discount applies. ⚖ the user's "simplest option",
 *            already how the runtime behaves; the block only needs to EXIST.
 *
 *   COARSE   everything else, including two cases the slice's brief got wrong:
 *            • **maze** — it has `takeLastRecording` AND declares `sharing.mana`,
 *              so "a recorder that is a mana declarer" would have swept it into
 *              NATIVE. It is not: it declares
 *              `sharing.mana.loopActionDelegation: true`, which means it hands
 *              the loop action BACK to the host's cost model —
 *              `mazeRoomUI._perTileMoveCost` is the region's cost ÷
 *              `longestShortestPath`. Delete a maze region's `moveCost` and the
 *              per-tile charge goes to the default.
 *            • **text_adventure** — it declares `sharing.mana` too, so
 *              `resourceChannels.isManaDeclarer('text_adventure')` is TRUE. It
 *              has no recorder, and it prices the three coarse actions straight
 *              out of the block. The recorder test is what excludes it.
 *
 * An UNREGISTERED substrate (a headless run that never imported the libraries)
 * reads as COARSE — today's behaviour, and the safe direction: a block that
 * silently dropped every cost would look exactly like a small world.
 *
 * @param {string|null} substrateId
 * @returns {'coarse'|'summary'|'native'}
 */
export function classifyRegion(substrateId) {
    if (!substrateId) return REGION_CLASS.COARSE;
    let entry = null;
    try {
        entry = substrateRegistry.get(substrateId) ?? null;
    } catch { /* registry unavailable — treat as coarse */ }
    if (!entry) return REGION_CLASS.COARSE;
    if (entry.loopSupport?.summaryRecording) return REGION_CLASS.SUMMARY;
    const mana = entry.sharing?.mana;
    if (typeof entry.takeLastRecording === 'function'
        && mana !== undefined && mana?.loopActionDelegation !== true) {
        return REGION_CLASS.NATIVE;
    }
    return REGION_CLASS.COARSE;
}

/** region name → its class, for every region the topology knows. */
export function classifyRegions(topology) {
    const out = new Map();
    for (const name of topology.regions.keys()) {
        out.set(name, classifyRegion(topology.regionSubstrates.get(name) ?? null));
    }
    return out;
}

function normalizeRegionXpEffect(effect) {
    return VALID_REGION_XP_EFFECTS.includes(effect) ? effect : DEFAULT_REGION_XP_EFFECT;
}

/**
 * ⚖ **THE WRITE-BY-CLASS RULE, IN ONE FUNCTION.** Takes the planner's RAW cost
 * data (every region priced, because the simulation treats every region as
 * coarse) and produces the block a world ships.
 *
 * Per region:
 *   COARSE   `{moveCost, xpEffect}` + its locations' planned costs.
 *   NATIVE   nothing at all — no region entry, no location entries.
 *   SUMMARY  `{timeDrainPerSecond, xpEffect}` ONLY, plus any cost the INPUT
 *            block already names EXPLICITLY for that region or its locations,
 *            passed through verbatim. (Explicit-only is the M5 ruling; a
 *            generated block must not make "explicit" mean "everything".)
 *
 * The START region is `{moveCost: 0, xpEffect}` whatever its class, unless it is
 * SUMMARY (then the drain, as before). That zero is not a PRICE, it is the rule
 * that leaving the start region is free, and it is read by the HOST's queue
 * (`getRegionCost(startRegion)` for the first `regionMove`) rather than by the
 * substrate — so a NATIVE start region needs it too. In practice the start
 * region is `Menu`, which has no substrate at all.
 *
 * @param {Object} rawCosts        the planner's `getCostData()`
 * @param {Object} args
 * @param {import('./loopCostPlanner.js').CostTopology} args.topology
 * @param {Map<string,string>} args.regionClasses
 * @param {string} args.xpEffect
 * @param {Object} [args.inputBlock] an existing `loop_costs` to pass through
 * @param {number} [args.timeDrainPerSecond]
 * @returns {Object} the block
 */
export function writeCostsByClass(rawCosts, {
    topology,
    regionClasses,
    xpEffect,
    inputBlock = null,
    timeDrainPerSecond = DEFAULT_TIME_DRAIN_PER_SECOND,
} = {}) {
    const out = { regions: {}, locations: {} };
    const startRegion = topology.startRegion;

    for (const [regionName, cls] of regionClasses.entries()) {
        if (regionName === startRegion && cls !== REGION_CLASS.SUMMARY) {
            out.regions[regionName] = { moveCost: 0, xpEffect };
            continue;
        }
        if (cls === REGION_CLASS.NATIVE) continue;
        if (cls === REGION_CLASS.SUMMARY) {
            const explicit = inputBlock?.regions?.[regionName];
            const entry = { timeDrainPerSecond, xpEffect };
            if (typeof explicit?.moveCost === 'number') entry.moveCost = explicit.moveCost;
            if (typeof explicit?.timeDrainPerSecond === 'number') {
                entry.timeDrainPerSecond = explicit.timeDrainPerSecond;
            }
            out.regions[regionName] = entry;
            continue;
        }
        const planned = rawCosts.regions?.[regionName];
        out.regions[regionName] = {
            moveCost: typeof planned?.moveCost === 'number'
                ? planned.moveCost : rawCosts.defaultRegionCost,
            xpEffect,
        };
    }

    for (const [locationName, locData] of topology.locations.entries()) {
        const cls = regionClasses.get(locData.region) ?? REGION_CLASS.COARSE;
        if (cls === REGION_CLASS.NATIVE) continue;
        if (cls === REGION_CLASS.SUMMARY) {
            const explicit = inputBlock?.locations?.[locationName];
            if (typeof explicit === 'number') out.locations[locationName] = explicit;
            continue;
        }
        const planned = rawCosts.locations?.[locationName];
        if (typeof planned === 'number') out.locations[locationName] = planned;
    }

    return out;
}

/**
 * Plan a world's loop costs and write the block.
 *
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
 *        block root for fallback.
 * @param {string} [args.sourceFileName=null] — recorded in metadata
 * @returns {Object} cost data (version, generatedAt, generatedFrom, regions,
 *                   locations, defaultRegionCost, defaultLocationCost,
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

    const topology = topologyFromRulesJson(rulesJson, String(playerId));
    if (!topology.startRegion) {
        throw new Error(`generateLoopCosts: no usable start region for player '${playerId}'`);
    }

    const xpEffect = normalizeRegionXpEffect(regionXpEffect);

    const planner = new CostPlanner({
        topology,
        playerId: String(playerId),
        startingMaxMana,
        manaPerItem,
    });
    planner.loadSphereLog(sphereLog);
    planner.planAll();

    const raw = planner.getCostData();
    raw.defaultRegionCost = defaultRegionCost;
    raw.defaultLocationCost = defaultLocationCost;

    const { regions: outRegions, locations: outLocations } = writeCostsByClass(raw, {
        topology,
        regionClasses: classifyRegions(topology),
        xpEffect,
        inputBlock: rulesJson.loop_costs ?? null,
    });

    return {
        version: '1.0',
        generatedAt: new Date().toISOString(),
        generatedFrom: sourceFileName,
        regions: outRegions,
        locations: outLocations,
        defaultRegionCost,
        defaultLocationCost,
        defaultRegionXpEffect: xpEffect,
    };
}

// Exported for tests
export const _internal = {
    classifyRegion,
    classifyRegions,
    normalizeRegionXpEffect,
    resolveStartRegion,
    writeCostsByClass,
};
