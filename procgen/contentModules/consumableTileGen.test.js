import { describe, it, expect } from 'vitest';

import { createRng } from '../../rng.js';
import {
    createWorld, setTile, setItem, setObstacle, TILE_FLOOR, TILE_WALL,
} from '../../../mazeRoom/mazeRoomEngine.js';
import {
    generateConsumableTiles,
    consumableTileCandidates,
    consumableTilesActive,
} from './consumableTileGen.js';

/** An open 6x6 room with a wall column, entrance top-left, exit bottom-right. */
function makeWorld() {
    const w = createWorld(6, 6, { entrance: { x: 0, y: 0 }, exit: { x: 5, y: 5 } });
    for (let y = 0; y < 6; y++) {
        for (let x = 0; x < 6; x++) setTile(w, x, y, TILE_FLOOR);
    }
    return w;
}

const POOL = [
    { substrate: 'omsi', type: 'gold' },
    { substrate: 'jta', type: 'Food' },
];

describe('consumableTilesActive', () => {
    it('is false at the byte-inert defaults', () => {
        expect(consumableTilesActive(null)).toBe(false);
        expect(consumableTilesActive({})).toBe(false);
        expect(consumableTilesActive({ consumableCount: 0, manaCount: 0, manaAmount: 0 })).toBe(false);
    });

    it('treats mana tiles with a zero amount as inactive', () => {
        // A refill tile that refills nothing is not worth perturbing the
        // rng stream for — it must not flip the active predicate.
        expect(consumableTilesActive({ manaCount: 5, manaAmount: 0 })).toBe(false);
        expect(consumableTilesActive({ manaCount: 5, manaAmount: 10 })).toBe(true);
    });

    it('is true once consumable tiles are requested', () => {
        expect(consumableTilesActive({ consumableCount: 1 })).toBe(true);
    });
});

describe('consumableTileCandidates', () => {
    it('excludes entrance, exits, item tiles, obstacle tiles and claimed tiles', () => {
        const w = makeWorld();
        setItem(w, 1, 0, 'key_red');
        setObstacle(w, 2, 0, 'door_red');
        const claimed = new Set(['3,0']);
        const keys = consumableTileCandidates(w, claimed).map((c) => c.key);

        expect(keys).not.toContain('0,0');  // entrance
        expect(keys).not.toContain('5,5');  // exit
        expect(keys).not.toContain('1,0');  // item
        expect(keys).not.toContain('2,0');  // obstacle
        expect(keys).not.toContain('3,0');  // already claimed
        expect(keys).toContain('4,0');
    });

    it('excludes unreachable floor pockets', () => {
        const w = makeWorld();
        // Wall off (5,0) completely: its only neighbours become walls.
        setTile(w, 4, 0, TILE_WALL);
        setTile(w, 5, 1, TILE_WALL);
        const keys = consumableTileCandidates(w).map((c) => c.key);
        expect(keys).not.toContain('5,0');
        expect(keys).not.toContain('4,0'); // the wall itself isn't floor
    });

    it('returns row-major order so draws are reproducible', () => {
        const w = makeWorld();
        const keys = consumableTileCandidates(w).map((c) => c.key);
        const sorted = [...keys].sort((a, b) => {
            const [ax, ay] = a.split(',').map(Number);
            const [bx, by] = b.split(',').map(Number);
            return ay !== by ? ay - by : ax - bx;
        });
        expect(keys).toEqual(sorted);
    });
});

describe('generateConsumableTiles', () => {
    it('draws NO rng and places nothing when inactive', () => {
        const w = makeWorld();
        let draws = 0;
        const rng = { next: () => { draws++; return 0.5; } };
        const res = generateConsumableTiles(w, { consumableCount: 0, manaCount: 0 }, rng);
        expect(res).toEqual({ consumablesPlaced: 0, manaPlaced: 0 });
        expect(draws).toBe(0);
        expect(w.consumableTiles.size).toBe(0);
    });

    it('places the requested number of consumable tiles from the pool', () => {
        const w = makeWorld();
        const res = generateConsumableTiles(
            w, { consumableCount: 3, pool: POOL }, createRng(1),
        );
        expect(res.consumablesPlaced).toBe(3);
        expect(w.consumableTiles.size).toBe(3);
        for (const grant of w.consumableTiles.values()) {
            expect(POOL.some((p) => p.substrate === grant.substrate && p.type === grant.type)).toBe(true);
            expect(grant.count).toBe(1);
        }
    });

    it('stamps countPerTile on every grant', () => {
        const w = makeWorld();
        generateConsumableTiles(
            w, { consumableCount: 2, pool: POOL, countPerTile: 4 }, createRng(1),
        );
        for (const grant of w.consumableTiles.values()) expect(grant.count).toBe(4);
    });

    it('places nothing when the pool is empty but still places mana tiles', () => {
        // A world co-present with no item-declaring substrate should not
        // silently lose its mana tiles too.
        const w = makeWorld();
        const res = generateConsumableTiles(
            w, { consumableCount: 3, pool: [], manaCount: 2, manaAmount: 25 }, createRng(1),
        );
        expect(res.consumablesPlaced).toBe(0);
        expect(res.manaPlaced).toBe(2);
        expect([...w.manaTiles.values()]).toEqual([25, 25]);
    });

    it('never puts a mana tile and a consumable tile on the same tile', () => {
        const w = makeWorld();
        generateConsumableTiles(
            w, { consumableCount: 6, pool: POOL, manaCount: 6, manaAmount: 10 }, createRng(7),
        );
        const overlap = [...w.consumableTiles.keys()].filter((k) => w.manaTiles.has(k));
        expect(overlap).toEqual([]);
    });

    it('is deterministic for the same seed, world and params', () => {
        const opts = { consumableCount: 4, pool: POOL, manaCount: 2, manaAmount: 20 };
        const a = makeWorld();
        const b = makeWorld();
        generateConsumableTiles(a, opts, createRng(42));
        generateConsumableTiles(b, opts, createRng(42));
        expect([...a.consumableTiles.entries()]).toEqual([...b.consumableTiles.entries()]);
        expect([...a.manaTiles.entries()]).toEqual([...b.manaTiles.entries()]);
    });

    it('diverges for a different seed', () => {
        const opts = { consumableCount: 4, pool: POOL };
        const a = makeWorld();
        const b = makeWorld();
        generateConsumableTiles(a, opts, createRng(1));
        generateConsumableTiles(b, opts, createRng(2));
        expect([...a.consumableTiles.keys()]).not.toEqual([...b.consumableTiles.keys()]);
    });

    it('stops early rather than looping forever when candidates run out', () => {
        const w = createWorld(3, 3, { entrance: { x: 0, y: 0 }, exit: { x: 2, y: 2 } });
        for (let y = 0; y < 3; y++) for (let x = 0; x < 3; x++) setTile(w, x, y, TILE_FLOOR);
        // 9 tiles - entrance - exit = 7 placeable.
        const res = generateConsumableTiles(
            w, { consumableCount: 50, pool: POOL }, createRng(1),
        );
        expect(res.consumablesPlaced).toBe(7);
        expect(w.consumableTiles.size).toBe(7);
    });

    it('never places on an item, obstacle, entrance or exit tile', () => {
        const w = makeWorld();
        setItem(w, 1, 1, 'key_red');
        setObstacle(w, 2, 2, 'door_red');
        generateConsumableTiles(
            w, { consumableCount: 20, pool: POOL, manaCount: 5, manaAmount: 10 }, createRng(3),
        );
        const claimed = new Set([...w.consumableTiles.keys(), ...w.manaTiles.keys()]);
        expect(claimed.has('0,0')).toBe(false);
        expect(claimed.has('5,5')).toBe(false);
        expect(claimed.has('1,1')).toBe(false);
        expect(claimed.has('2,2')).toBe(false);
    });

    it('throws when active without an rng', () => {
        expect(() => generateConsumableTiles(makeWorld(), { consumableCount: 1, pool: POOL }))
            .toThrow(/rng required/);
    });
});
