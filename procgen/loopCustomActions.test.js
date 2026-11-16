import { describe, it, expect } from 'vitest';
import {
    CUSTOM_ACTIONS,
    customActionRowOf,
    isQueueCustomAction,
    customActionBaseCost,
    customActionLabel,
    customActionDescription,
    EXPLORE_ACTION,
    ACT_ACTION,
} from './loopCustomActions.js';
import { DEFAULT_EXPLORE_MULTIPLIER } from './loopCostDefaults.js';

/** A cost data manager over a plain block, with the two readers the table uses. */
function cdmOf(regions) {
    return {
        getRegionCost: (r) => regions[r]?.moveCost ?? 50,
        getRegionActionCost: (r, name) => {
            const v = regions[r]?.actions?.[name];
            return typeof v === 'number' ? v : null;
        },
    };
}

describe('loopCustomActions — the named custom-action table', () => {
    it('knows explore and act, and nothing else is a queue custom action', () => {
        expect(Object.keys(CUSTOM_ACTIONS).sort()).toEqual([ACT_ACTION, EXPLORE_ACTION].sort());
        expect(isQueueCustomAction({ type: 'customAction', actionName: 'explore' })).toBe(true);
        expect(isQueueCustomAction({ type: 'customAction', actionName: 'act' })).toBe(true);
        expect(isQueueCustomAction({ type: 'customAction', actionName: 'dance' })).toBe(false);
        expect(isQueueCustomAction({ type: 'locationCheck' })).toBe(false);
        expect(customActionRowOf({ type: 'regionMove', actionName: 'act' })).toBeNull();
    });

    it('explore prices as before: move cost × the explore multiplier', () => {
        const cdm = cdmOf({ R: { moveCost: 12 } });
        expect(customActionBaseCost({ type: 'customAction', actionName: 'explore', sourceRegion: 'R' }, cdm))
            .toBe(12 * DEFAULT_EXPLORE_MULTIPLIER);
    });

    it('act prices at the region\'s authored actions.act, else its move cost', () => {
        const cdm = cdmOf({ N: { moveCost: 0, actions: { act: 40 } }, M: { moveCost: 3 } });
        expect(customActionBaseCost({ type: 'customAction', actionName: 'act', sourceRegion: 'N' }, cdm)).toBe(40);
        expect(customActionBaseCost({ type: 'customAction', actionName: 'act', sourceRegion: 'M' }, cdm)).toBe(3);
    });

    it('a stated price wins for any row, explore included', () => {
        const cdm = cdmOf({ R: { moveCost: 12, actions: { explore: 1 } } });
        expect(customActionBaseCost({ type: 'customAction', actionName: 'explore', sourceRegion: 'R' }, cdm)).toBe(1);
    });

    it('labels: explore names the region; act names the node from its params', () => {
        expect(customActionLabel({ type: 'customAction', actionName: 'explore', sourceRegion: 'R' })).toBe('Explore R');
        const act = { type: 'customAction', actionName: 'act', sourceRegion: 'do-chores', params: { label: 'Do Chores' } };
        expect(customActionLabel(act)).toBe('Do Chores');
        expect(customActionDescription(act)).toBe('Act: Do Chores');
        expect(customActionLabel({ type: 'customAction', actionName: 'act', sourceRegion: 'n' })).toBe('Act in n');
    });

    it('completion: explore through the dispatcher (discovery), act on the event bus (the runtime)', () => {
        expect(CUSTOM_ACTIONS.explore.completionChannel).toBe('dispatcher');
        expect(CUSTOM_ACTIONS.explore.completionEvent).toBe('loop:exploreCompleted');
        expect(CUSTOM_ACTIONS.act.completionChannel).toBe('eventBus');
        expect(CUSTOM_ACTIONS.act.completionEvent).toBe('loop:actionCompleted');
    });
});
