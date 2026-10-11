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
