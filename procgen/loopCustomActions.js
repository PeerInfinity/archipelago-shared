/**
 * loopCustomActions — **THE TABLE OF NAMED LOOP-QUEUE CUSTOM ACTIONS.**
 *
 * A queue entry `{type: 'customAction', actionName, params, sourceRegion, instanceNumber}` is priced, completed and
 * labelled by the row its `actionName` names. Before this table every `customAction` was an explore at every site
 * (cost, completion event, label); a named action other than `explore` now has a row of its own.
 *
 *   explore  the original custom action. Cost: the region's move cost × `DEFAULT_EXPLORE_MULTIPLIER` (no cost data:
 *            `DEFAULT_REGION_COST`, the long-standing no-data fallback). Completion: `loop:exploreCompleted` through
 *            the dispatcher (discovery listens). Behaviour unchanged.
 *   act      ActionNodes' verb: perform the node's action once (design §3). Cost: the region's authored
 *            `loop_costs[p].regions[<node>].actions.act`. Completion: `loop:actionCompleted` on the event bus; the
 *            substrate's runtime applies the results.
 *
 * A row's stated per-region price wins for ANY row: `regions[<region>].actions[<actionName>]` (schema: a
 * `loop_costs` region's `actions` map). No committed world states `actions.explore`, so explore prices exactly as
 * before.
 *
 * Pure: no DOM, no event bus; the caller passes its cost data manager.
 */

import { DEFAULT_EXPLORE_MULTIPLIER, DEFAULT_REGION_COST } from './loopCostDefaults.js';

export const EXPLORE_ACTION = 'explore';
export const ACT_ACTION = 'act';

/** The event bus event a completed `act` publishes: `{actionName, regionName, params, fromLoop: true}`. */
export const ACTION_COMPLETED_EVENT = 'loop:actionCompleted';

/**
 * @typedef {object} CustomActionRow
 * @property {string} name
 * @property {(region: string, cdm: object) => number} fallbackCost  the base cost when no row price is stated
 *           and cost data IS loaded
 * @property {'dispatcher'|'eventBus'} completionChannel
 * @property {string} completionEvent
 * @property {(action: object) => string} label    the queue row's text ("Explore Foo", "Do Chores")
 * @property {(action: object) => string} description  the loop-stats line ("Explore: Foo", "Act: Do Chores")
 */
export const CUSTOM_ACTIONS = Object.freeze({
    [EXPLORE_ACTION]: Object.freeze({
        name: EXPLORE_ACTION,
        fallbackCost: (region, cdm) => cdm.getRegionCost(region) * DEFAULT_EXPLORE_MULTIPLIER,
        completionChannel: 'dispatcher',
        completionEvent: 'loop:exploreCompleted',
        label: (action) => `Explore ${action.sourceRegion}`,
        description: (action) => `Explore: ${action.sourceRegion}`,
    }),
    [ACT_ACTION]: Object.freeze({
        name: ACT_ACTION,
        // A world that queues `act` states its price; with none, the region's move cost (0 in an ActionNodes world).
        fallbackCost: (region, cdm) => cdm.getRegionCost(region),
        completionChannel: 'eventBus',
        completionEvent: ACTION_COMPLETED_EVENT,
        label: (action) => actLabelOf(action),
        description: (action) => `Act: ${actLabelOf(action)}`,
    }),
});

function actLabelOf(action) {
    const label = action?.params?.label;
    return typeof label === 'string' && label ? label : `Act in ${action?.sourceRegion ?? '?'}`;
}

/** The row for a queue entry, or null when it is not a custom action the table knows. */
export function customActionRowOf(action) {
    if (action?.type !== 'customAction') return null;
    return CUSTOM_ACTIONS[action.actionName] ?? null;
}

/** Whether a path entry is a custom action the queue runs (a known row). */
export function isQueueCustomAction(entry) {
    return customActionRowOf(entry) !== null;
}

/**
 * The pre-XP base cost of a custom action, with cost data loaded: the stated row price, else the row's fallback.
 * An unknown name prices as an explore (the old behaviour of every custom action).
 * @param {object} action
 * @param {object} cdm - a loaded cost data manager (`getRegionCost`, optional `getRegionActionCost`)
 */
export function customActionBaseCost(action, cdm) {
    const row = customActionRowOf(action) ?? CUSTOM_ACTIONS[EXPLORE_ACTION];
    const stated = cdm?.getRegionActionCost?.(action.sourceRegion, row.name);
    if (typeof stated === 'number') return stated;
    return row.fallbackCost(action.sourceRegion, cdm);
}

/** The base cost with NO cost data loaded: every row's long-standing default. */
export function customActionDefaultCost() {
    return DEFAULT_REGION_COST;
}

/** The queue row's text. */
export function customActionLabel(action) {
    return (customActionRowOf(action) ?? CUSTOM_ACTIONS[EXPLORE_ACTION]).label(action);
}

/** The loop-stats description. */
export function customActionDescription(action) {
    return (customActionRowOf(action) ?? CUSTOM_ACTIONS[EXPLORE_ACTION]).description(action);
}
