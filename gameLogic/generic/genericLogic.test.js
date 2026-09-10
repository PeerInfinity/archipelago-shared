import { describe, it, expect } from 'vitest';

import { helperFunctions } from './genericLogic.js';

/**
 * `has` / `count` over a slot's `progression_mapping`, whose entries come in TWO
 * kinds:
 *
 *   - PROGRESSIVE — `{base_item, items: [{name, level}, …]}`, an ARRAY of levels
 *     that these helpers resolve: a resolved name is granted once the pool of
 *     entries sharing the entry's `base_item` reaches that level.
 *   - ADDITIVE — `{type: 'additive', base_item, items: {name: value}}`, an
 *     OBJECT resolved by VALUE inside the inventory
 *     (`stateManager/core/inventoryManager.js:286`, `:381`), never by levels.
 *
 * Before the trap-1307 guard these helpers did `mapping.items || []` and then
 * `items.findIndex(…)`, so an additive entry threw
 * `TypeError: items.findIndex is not a function` — on EVERY has/count of a slot
 * carrying one, and the throw ALSO abandoned the loop, so any progressive entry
 * ordered after the additive one stopped resolving. The additive entry is
 * therefore FIRST in the mixed fixture below: that ordering is what makes the
 * pooled-resolution rows red when the guard is reverted.
 */

/** The additive entry is deliberately ordered before the progressive ones. */
const MIXED_MAPPING = {
    Shards: {
        type: 'additive',
        base_item: 'Shards',
        items: { 'Time Shard': 1, 'Time Shard (10)': 10, 'Time Shard (50)': 50 },
    },
    'Progressive Sword': {
        base_item: 'Progressive Sword',
        items: [
            { name: 'Fighter Sword', level: 1 },
            { name: 'Master Sword', level: 2 },
        ],
    },
    // Pools into the same base as the entry above — alttp's `Progressive Bow
    // (Alt)` shape, the reason `base_item` exists.
    'Progressive Sword (Alt)': {
        base_item: 'Progressive Sword',
        items: [
            { name: 'Fighter Sword', level: 1 },
            { name: 'Master Sword', level: 2 },
        ],
    },
};

/** messenger's committed shape — the corpus's only additive carrier. */
const ADDITIVE_ONLY_MAPPING = {
    Shards: {
        type: 'additive',
        base_item: 'Shards',
        items: {
            'Time Shard': 1,
            'Time Shard (10)': 10,
            'Time Shard (50)': 50,
            'Time Shard (100)': 100,
            'Time Shard (300)': 300,
            'Time Shard (500)': 500,
        },
    },
};

const staticFor = (mapping) => ({ progression_mapping: { 1: mapping } });
const snap = (inventory = {}) => ({
    player: { id: '1' },
    inventory,
    flags: [],
    events: [],
});

describe('genericLogic has/count with a mixed progression mapping', () => {
    const staticData = staticFor(MIXED_MAPPING);

    it('resolves a progressive level past an additive entry without throwing', () => {
        // Pre-guard this threw on `Shards` before `Progressive Sword` was read.
        expect(helperFunctions.has(snap({ 'Progressive Sword': 1 }), staticData, 'Fighter Sword'))
            .toBe(true);
        expect(helperFunctions.count(snap({ 'Progressive Sword': 1 }), staticData, 'Fighter Sword'))
            .toBe(1);
    });

    it('a level the pool has not reached is answered false / 0', () => {
        expect(helperFunctions.has(snap({ 'Progressive Sword': 1 }), staticData, 'Master Sword'))
            .toBe(false);
        expect(helperFunctions.count(snap({ 'Progressive Sword': 1 }), staticData, 'Master Sword'))
            .toBe(0);
    });

    it('entries sharing a base_item pool their counts toward a level', () => {
        const pooled = snap({ 'Progressive Sword': 1, 'Progressive Sword (Alt)': 1 });
        expect(helperFunctions.has(pooled, staticData, 'Master Sword')).toBe(true);
        expect(helperFunctions.count(pooled, staticData, 'Master Sword')).toBe(1);
    });

    it('an additive component contributes nothing to has/count', () => {
        // `Time Shard (10)` is a KEY of the additive entry's `items`, and the
        // inventory has spent it into the `Shards` counter — it is not an item
        // these helpers resolve.
        const state = snap({ Shards: 61 });
        expect(helperFunctions.has(state, staticData, 'Time Shard (10)')).toBe(false);
        expect(helperFunctions.count(state, staticData, 'Time Shard (10)')).toBe(0);
    });

    it('the additive counter itself is answered from the inventory', () => {
        const state = snap({ Shards: 61 });
        expect(helperFunctions.has(state, staticData, 'Shards')).toBe(true);
        expect(helperFunctions.count(state, staticData, 'Shards')).toBe(61);
    });

    it('an unknown name is answered false / 0, not a throw', () => {
        expect(helperFunctions.has(snap(), staticData, 'Nothing At All')).toBe(false);
        expect(helperFunctions.count(snap(), staticData, 'Nothing At All')).toBe(0);
    });
});

describe('genericLogic has/count with an additive-only slot (messenger)', () => {
    const staticData = staticFor(ADDITIVE_ONLY_MAPPING);

    it('answers every component without throwing', () => {
        const state = snap({ Shards: 300 });
        for (const component of Object.keys(ADDITIVE_ONLY_MAPPING.Shards.items)) {
            expect(helperFunctions.has(state, staticData, component)).toBe(false);
            expect(helperFunctions.count(state, staticData, component)).toBe(0);
        }
    });

    it('answers a name the slot knows nothing about without throwing', () => {
        expect(helperFunctions.has(snap({ Shards: 300 }), staticData, 'Wingsuit')).toBe(false);
        expect(helperFunctions.count(snap({ Shards: 300 }), staticData, 'Wingsuit')).toBe(0);
    });
});

describe('genericLogic has/count with a progressive-only slot (the control)', () => {
    const staticData = staticFor({
        'Progressive Sword': MIXED_MAPPING['Progressive Sword'],
    });

    it('is unmoved by the guard — levels still resolve', () => {
        expect(helperFunctions.has(snap({ 'Progressive Sword': 2 }), staticData, 'Master Sword'))
            .toBe(true);
        expect(helperFunctions.has(snap({ 'Progressive Sword': 0 }), staticData, 'Fighter Sword'))
            .toBe(false);
        expect(helperFunctions.count(snap({ 'Progressive Sword': 2 }), staticData, 'Master Sword'))
            .toBe(1);
    });
});
