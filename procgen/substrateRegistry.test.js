import { describe, it, expect, beforeEach } from 'vitest';

import { substrateRegistry } from './substrateRegistry.js';

describe('substrateRegistry', () => {
    beforeEach(() => {
        substrateRegistry.clear();
    });

    it('register stores an entry by id', () => {
        const entry = { id: 'maze', panelComponentType: 'mazeRoomPanel' };
        substrateRegistry.register(entry);
        expect(substrateRegistry.get('maze')).toBe(entry);
        expect(substrateRegistry.has('maze')).toBe(true);
    });

    it('getAll returns all registered entries', () => {
        substrateRegistry.register({ id: 'maze' });
        substrateRegistry.register({ id: 'incremental' });
        const all = substrateRegistry.getAll();
        expect(all).toHaveLength(2);
        expect(all.map((e) => e.id).sort()).toEqual(['incremental', 'maze']);
    });

    it('register rejects duplicate ids', () => {
        substrateRegistry.register({ id: 'maze' });
        expect(() => substrateRegistry.register({ id: 'maze' }))
            .toThrow(/already registered/);
    });

    it('register rejects entries without an id', () => {
        expect(() => substrateRegistry.register({})).toThrow(/id must be/);
        expect(() => substrateRegistry.register(null)).toThrow(/must be an object/);
    });

    it('get returns undefined for unknown ids', () => {
        expect(substrateRegistry.get('nonexistent')).toBeUndefined();
        expect(substrateRegistry.has('nonexistent')).toBe(false);
    });

    describe('sharing declaration', () => {
        it('accepts an entry without a sharing field', () => {
            substrateRegistry.register({ id: 'plain' });
            expect(substrateRegistry.get('plain').sharing).toBeUndefined();
        });

        it('accepts a bare mana declaration', () => {
            substrateRegistry.register({ id: 'ta', sharing: { mana: {} } });
            expect(substrateRegistry.get('ta').sharing.mana).toEqual({});
        });

        it('accepts mana with loopActionDelegation', () => {
            substrateRegistry.register({
                id: 'maze',
                sharing: { mana: { loopActionDelegation: true } },
            });
            expect(substrateRegistry.get('maze').sharing.mana.loopActionDelegation).toBe(true);
        });

        it('accepts items with a static types list', () => {
            substrateRegistry.register({
                id: 'jta',
                sharing: { mana: {}, items: { types: ['Fish', 'Mushroom'] } },
            });
            expect(substrateRegistry.get('jta').sharing.items.types).toEqual(['Fish', 'Mushroom']);
        });

        it('accepts items with a getTypes provider', () => {
            const getTypes = () => ['potions'];
            substrateRegistry.register({ id: 'omsi', sharing: { items: { getTypes } } });
            expect(substrateRegistry.get('omsi').sharing.items.getTypes).toBe(getTypes);
        });

        it('rejects non-object sharing values', () => {
            expect(() => substrateRegistry.register({ id: 'x', sharing: 'mana' }))
                .toThrow(/sharing: must be an object/);
            expect(() => substrateRegistry.register({ id: 'x', sharing: ['mana'] }))
                .toThrow(/sharing: must be an object/);
        });

        it('rejects unknown categories', () => {
            expect(() => substrateRegistry.register({ id: 'x', sharing: { gold: {} } }))
                .toThrow(/unknown category 'gold'/);
        });

        it('rejects unknown mana fields and non-boolean delegation', () => {
            expect(() => substrateRegistry.register(
                { id: 'x', sharing: { mana: { chargeModel: 'perTile' } } },
            )).toThrow(/mana: unknown field 'chargeModel'/);
            expect(() => substrateRegistry.register(
                { id: 'x', sharing: { mana: { loopActionDelegation: 1 } } },
            )).toThrow(/loopActionDelegation: must be a boolean/);
            expect(() => substrateRegistry.register({ id: 'x', sharing: { mana: null } }))
                .toThrow(/mana: must be an object/);
        });

        it('rejects items without exactly one of types/getTypes', () => {
            expect(() => substrateRegistry.register({ id: 'x', sharing: { items: {} } }))
                .toThrow(/exactly one of 'types' or 'getTypes'/);
            expect(() => substrateRegistry.register(
                { id: 'x', sharing: { items: { types: ['a'], getTypes: () => [] } } },
            )).toThrow(/exactly one of 'types' or 'getTypes'/);
        });

        it('rejects malformed items type lists and providers', () => {
            expect(() => substrateRegistry.register(
                { id: 'x', sharing: { items: { types: ['ok', ''] } } },
            )).toThrow(/array of non-empty strings/);
            expect(() => substrateRegistry.register(
                { id: 'x', sharing: { items: { types: 'Fish' } } },
            )).toThrow(/array of non-empty strings/);
            expect(() => substrateRegistry.register(
                { id: 'x', sharing: { items: { getTypes: ['a'] } } },
            )).toThrow(/getTypes: must be a function/);
            expect(() => substrateRegistry.register(
                { id: 'x', sharing: { items: { extra: 1, types: ['a'] } } },
            )).toThrow(/items: unknown field 'extra'/);
        });

        it('a rejected entry is not registered', () => {
            expect(() => substrateRegistry.register({ id: 'x', sharing: { gold: {} } }))
                .toThrow();
            expect(substrateRegistry.has('x')).toBe(false);
        });
    });
});
