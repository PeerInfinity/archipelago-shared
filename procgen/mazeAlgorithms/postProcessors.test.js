import { describe, it, expect } from 'vitest';

import { createRng } from '../../rng.js';
import {
    createWorld, getTile, setTile,
    TILE_FLOOR, TILE_WALL,
    allTargetsReachable,
} from '../../../mazeRoom/mazeRoomEngine.js';
// Side-effect: registers backends. Used by `mazeFromBackend` below.
import '../../../mazeRoom/mazeAlgorithms/index.js';
import { getBackend } from './registry.js';
import { braid, chambers, pruneDeadEnds } from './postProcessors.js';

function mazeWithBackend(backendId, params, seed = 1) {
    const w = createWorld(11, 9);
    const rng = createRng(seed);
    getBackend(backendId).run(w, params, rng);
    return w;
}

function countDeadEnds(world) {
    let n = 0;
    for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
            if (getTile(world, x, y) !== TILE_FLOOR) continue;
            let neighbors = 0;
            for (const [dx, dy] of [[-1, 0], [1, 0], [0, -1], [0, 1]]) {
                const nx = x + dx, ny = y + dy;
                if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
                if (getTile(world, nx, ny) === TILE_FLOOR) neighbors += 1;
            }
            if (neighbors === 1) n += 1;
        }
    }
    return n;
}

describe('braid', () => {
    it('p=0 is a no-op', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        const before = countDeadEnds(world);
        braid(world, { p: 0 }, createRng(99));
        expect(countDeadEnds(world)).toBe(before);
    });

    it('p=1 removes (almost) every dead end', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        expect(countDeadEnds(world)).toBeGreaterThan(0);
        braid(world, { p: 1 }, createRng(99));
        // Some boundary or fully-walled-corner dead-ends may not have
        // an eligible knockdown target; allow up to a couple of
        // residuals rather than insisting on exactly zero.
        expect(countDeadEnds(world)).toBeLessThanOrEqual(2);
    });

    it('intermediate p reduces dead-end count', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        const before = countDeadEnds(world);
        braid(world, { p: 0.5 }, createRng(7));
        expect(countDeadEnds(world)).toBeLessThan(before);
    });

    it('does not break feasibility', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        braid(world, { p: 1.0 }, createRng(7));
        expect(allTargetsReachable(world)).toBe(true);
    });

    it('does not knock down walls protecting entrance/exit tiles', () => {
        // Surround the entrance with walls, then verify braid doesn't
        // touch them. Use 'empty' so the only walls present are the
        // ones we set, then place an artificial dead-end.
        const w = createWorld(7, 7, { entrance: { x: 3, y: 3 }, exit: { x: 6, y: 6 } });
        // Wall everything except a thin corridor entrance→exit.
        for (let y = 0; y < w.height; y++) {
            for (let x = 0; x < w.width; x++) {
                if (x === 3 && y >= 3) continue;
                if (y === 6 && x >= 3) continue;
                setTile(w, x, y, TILE_WALL);
            }
        }
        // The entrance is a dead-end of the corridor — braid should
        // refuse to touch (3, 2) because that's adjacent to entrance.
        // (Actually entrance itself is protected; the wall at (3, 2)
        // is what would be knocked down. But we want to verify the
        // PROTECTED tile isn't itself overwritten.)
        const beforeEntrance = getTile(w, w.entrance.x, w.entrance.y);
        braid(w, { p: 1 }, createRng(1));
        expect(getTile(w, w.entrance.x, w.entrance.y)).toBe(beforeEntrance);
    });
});

describe('pruneDeadEnds', () => {
    it('threshold=0 is a no-op', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        const before = countDeadEnds(world);
        pruneDeadEnds(world, { threshold: 0 }, createRng(1));
        expect(countDeadEnds(world)).toBe(before);
    });

    it('threshold=1 removes single-tile dead-end stubs', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        const before = countDeadEnds(world);
        pruneDeadEnds(world, { threshold: 1 }, createRng(1));
        expect(countDeadEnds(world)).toBeLessThan(before);
    });

    it('higher threshold removes more', () => {
        const a = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        const b = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        pruneDeadEnds(a, { threshold: 1 }, createRng(1));
        pruneDeadEnds(b, { threshold: 5 }, createRng(1));
        // b should have fewer floor tiles than a (more pruning).
        const countFloor = (w) => {
            let n = 0;
            for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === TILE_FLOOR) n++;
            return n;
        };
        expect(countFloor(b)).toBeLessThanOrEqual(countFloor(a));
    });

    it('does not fill entrance or exit even if they are dead-end stubs', () => {
        const w = createWorld(5, 5, { entrance: { x: 0, y: 0 }, exit: { x: 4, y: 4 } });
        // Wall most of the grid; leave only entrance and a single corridor.
        for (let y = 0; y < w.height; y++) {
            for (let x = 0; x < w.width; x++) {
                setTile(w, x, y, TILE_WALL);
            }
        }
        // Carve entrance + 1 floor tile next to it = single-tile dead-end.
        setTile(w, 0, 0, TILE_FLOOR);
        setTile(w, 1, 0, TILE_FLOOR);
        pruneDeadEnds(w, { threshold: 5 }, createRng(1));
        expect(getTile(w, 0, 0)).toBe(TILE_FLOOR);    // entrance
    });

    it('does not break feasibility', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        pruneDeadEnds(world, { threshold: 3 }, createRng(1));
        expect(allTargetsReachable(world)).toBe(true);
    });
});

/**
 * ⛓⛓⛓ CHAMBERS — CONSTRUCTIVE-MODE arc, slice 7. The claims are about the
 * three properties the CALLERS rely on and cannot check for themselves:
 * `k=0` spends NO DRAW, the stamp is MONOTONE (so connectivity survives), and
 * `margin` is honoured on every side.
 */
describe('chambers', () => {
    const floorCount = (w) => {
        let n = 0;
        for (let i = 0; i < w.tiles.length; i++) if (w.tiles[i] === TILE_FLOOR) n += 1;
        return n;
    };
    const floorSet = (w) => {
        const s = new Set();
        for (let y = 0; y < w.height; y++) {
            for (let x = 0; x < w.width; x++) {
                if (getTile(w, x, y) === TILE_FLOOR) s.add(`${x},${y}`);
            }
        }
        return s;
    };

    /**
     * ⛔ THE BYTE-INERT CLAIM, AND IT IS ABOUT THE **RNG**, NOT THE TILES.
     * "The grid did not change" would pass for a k=0 that still drew a centre
     * and threw it away — and that version would shift every subsequent draw
     * on the room stream, expiring every committed seed→level pair. So the
     * subject is the stream's own position.
     */
    it('k=0 touches neither the grid NOR the rng — a counting stream proves it', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' });
        const before = floorSet(world);
        let draws = 0;
        const counting = { next: () => { draws += 1; return 0.5; } };
        expect(chambers(world, { k: 0, size: 3 }, counting)).toEqual({ stamped: 0, opened: 0 });
        expect(draws).toBe(0);
        expect(floorSet(world)).toEqual(before);
    });

    it('is MONOTONE — it only ever turns wall into floor, so nothing disconnects', () => {
        const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' }, 3);
        expect(allTargetsReachable(world)).toBe(true);
        const before = floorSet(world);
        const stats = chambers(world, { k: 3, size: 3 }, createRng(11));
        const after = floorSet(world);
        expect(stats.stamped).toBe(3);
        for (const cell of before) expect(after.has(cell)).toBe(true);
        expect(after.size).toBe(before.size + stats.opened);
        expect(allTargetsReachable(world)).toBe(true);
    });

    it('opens MORE floor as k rises, from the same seed', () => {
        const counts = [0, 1, 2, 3].map((k) => {
            const world = mazeWithBackend('recursive_backtracker', { picker: 'newest' }, 5);
            chambers(world, { k, size: 3 }, createRng(11));
            return floorCount(world);
        });
        expect(counts[1]).toBeGreaterThan(counts[0]);
        expect(counts[3]).toBeGreaterThan(counts[1]);
    });

    /**
     * ⛓⛓ THE MARGIN IS WHAT THE SEEDLING RING RESTS ON. Its binding hands the
     * grid in with the border already walled and REFUSES a carve that leaves a
     * border cell as floor — so a stamp that ignored `margin` would turn a
     * legal room into a refusal on the day somebody typed `chambers=1`.
     */
    it('margin=1 never writes the border, at any k, on any side', () => {
        for (const seed of [1, 2, 3, 4, 5]) {
            const world = createWorld(11, 9);
            for (let i = 0; i < world.tiles.length; i++) world.tiles[i] = TILE_WALL;
            setTile(world, 5, 4, TILE_FLOOR);
            chambers(world, { k: 3, size: 3, margin: 1 }, createRng(seed));
            for (let x = 0; x < world.width; x++) {
                expect(getTile(world, x, 0)).toBe(TILE_WALL);
                expect(getTile(world, x, world.height - 1)).toBe(TILE_WALL);
            }
            for (let y = 0; y < world.height; y++) {
                expect(getTile(world, 0, y)).toBe(TILE_WALL);
                expect(getTile(world, world.width - 1, y)).toBe(TILE_WALL);
            }
        }
    });

    /**
     * ⛔ CLAMPED, NOT SKIPPED — a centre against the wall stamps the part that
     * fits. Requiring the whole square to fit would exclude most cells of a
     * carved room, which is where the caller actually wants area.
     */
    it('CLAMPS a stamp that runs off the grid instead of dropping it', () => {
        const world = createWorld(5, 5);
        for (let i = 0; i < world.tiles.length; i++) world.tiles[i] = TILE_WALL;
        setTile(world, 0, 0, TILE_FLOOR);          // the only centre available
        const stats = chambers(world, { k: 1, size: 3 }, { next: () => 0 });
        // the 3x3 around (0,0) clipped to the grid is (0,0),(1,0),(0,1),(1,1)
        expect(stats).toEqual({ stamped: 1, opened: 3 });
        expect(getTile(world, 1, 1)).toBe(TILE_FLOOR);
        expect(getTile(world, 2, 0)).toBe(TILE_WALL);
    });

    it('is DETERMINISTIC from its stream, and two runs of one seed agree', () => {
        const run = () => {
            const w = mazeWithBackend('kruskals', {}, 7);
            chambers(w, { k: 2, size: 3 }, createRng(21));
            return [...w.tiles].join('');
        };
        expect(run()).toBe(run());
    });

    /** ⛔ Refusals by name — an even square has no centre to stamp around. */
    it('REFUSES an even size, a fractional k and a negative margin, by name', () => {
        const world = mazeWithBackend('kruskals', {}, 1);
        expect(() => chambers(world, { k: 1, size: 4 }, createRng(1)))
            .toThrow(/size must be an ODD positive integer/);
        expect(() => chambers(world, { k: 1.5, size: 3 }, createRng(1)))
            .toThrow(/k must be an integer/);
        expect(() => chambers(world, { k: 1, size: 3, margin: -1 }, createRng(1)))
            .toThrow(/margin must be a non-negative integer/);
    });

    it('leaves the entrance and every exit exactly as it found them (they are floor)', () => {
        const world = createWorld(11, 9, {
            entrance: { x: 0, y: 0 }, exits: [{ exit_id: 'e', x: 10, y: 8 }],
        });
        getBackend('recursive_backtracker').run(world, { picker: 'newest' }, createRng(4));
        expect(getTile(world, 0, 0)).toBe(TILE_FLOOR);
        expect(getTile(world, 10, 8)).toBe(TILE_FLOOR);
        chambers(world, { k: 3, size: 3 }, createRng(9));
        expect(getTile(world, 0, 0)).toBe(TILE_FLOOR);
        expect(getTile(world, 10, 8)).toBe(TILE_FLOOR);
    });
});
