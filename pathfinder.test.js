import { describe, it, expect } from 'vitest';
import { PathFinder } from './pathfinder.js';

/** A stateManager double: static regions, a snapshot holding `items`, every region reachable. */
function stateManager(regions, items, { assumeBidirectional = true } = {}) {
    const map = new Map(Object.entries(regions));
    const inventory = Object.fromEntries(items.map((i) => [i, 1]));
    return {
        getStaticData: () => ({ regions: map, items: new Map(items.map((i) => [i, { name: i }])) }),
        getLatestStateSnapshot: () => ({
            inventory,
            regionReachability: Object.fromEntries([...map.keys()].map((r) => [r, 'reachable'])),
        }),
        getEffectiveBidirectionalSetting: () => ({ assumeBidirectional }),
    };
}

const has = (item) => ({ rule: 'Has', args: { item_name: item } });

describe('PathFinder — assume-bidirectional never bypasses an explicit reverse exit', () => {
    // A ⇄ B with B → A open and A → B locked; A → C → B is the open way round.
    const regions = {
        A: { name: 'A', exits: [{ name: 'a_to_b', connected_region: 'B', access_rule: has('key_red') },
            { name: 'a_to_c', connected_region: 'C', access_rule: { rule: 'True_' } }] },
        B: { name: 'B', exits: [{ name: 'b_to_a', connected_region: 'A', access_rule: { rule: 'True_' } }] },
        C: { name: 'C', exits: [{ name: 'c_to_b', connected_region: 'B', access_rule: { rule: 'True_' } }] },
    };

    it('routes round the locked exit instead of through it', () => {
        const path = new PathFinder(stateManager(regions, [])).findPathWithExits('A', 'B');
        expect(path.steps.map((s) => s.exitUsed)).toEqual([null, 'a_to_c', 'c_to_b']);
    });

    it('with the key, the direct exit is open again', () => {
        const path = new PathFinder(stateManager(regions, ['key_red'])).findPathWithExits('A', 'B');
        expect(path.steps.map((s) => s.exitUsed)).toEqual([null, 'a_to_b']);
    });

    it('a connection with NO reverse exit is still assumed both ways', () => {
        const oneWay = {
            A: { name: 'A', exits: [] },
            B: { name: 'B', exits: [{ name: 'b_to_a', connected_region: 'A', access_rule: { rule: 'True_' } }] },
        };
        const path = new PathFinder(stateManager(oneWay, [])).findPathWithExits('A', 'B');
        expect(path.steps.map((s) => s.exitUsed)).toEqual([null, 'b_to_a']);
    });
});

describe('PathFinder.findDiscoveredPath — starts at start_regions.default (sdc-player1-tidy)', () => {
    // The Map's FIRST region is not the start region (12 of 239 preset slots: Seedling, SM, …).
    const regions = {
        Ceres: { name: 'Ceres', exits: [] },
        Menu: { name: 'Menu', exits: [{ name: 'm_to_b', connected_region: 'B', access_rule: { rule: 'True_' } }] },
        B: { name: 'B', exits: [] },
    };
    const discovery = { isRegionDiscovered: () => true, isExitDiscovered: () => true };
    function withStart(startRegions) {
        const sm = stateManager(regions, []);
        const base = sm.getStaticData();
        sm.getStaticData = () => ({ ...base, startRegions });
        return sm;
    }

    it('the {default, available} object starts at default[0], not the first region', () => {
        const path = new PathFinder(withStart({ default: ['Menu'], available: [] })).findDiscoveredPath('B', discovery);
        expect(path).toEqual(['Menu', 'B']);
    });

    it('a bare array still works', () => {
        expect(new PathFinder(withStart(['Menu'])).findDiscoveredPath('B', discovery)).toEqual(['Menu', 'B']);
    });

    it('no start regions falls back to the first region', () => {
        expect(new PathFinder(withStart(undefined)).findDiscoveredPath('Ceres', discovery)).toEqual(['Ceres']);
    });
});
