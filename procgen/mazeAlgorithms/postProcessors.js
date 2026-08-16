/**
 * Post-processors that operate on any wall layout produced by a
 * backend. Run after the backend, before the validation safety net.
 *
 *  - braid(p) knocks down a fraction of dead-end walls. p = 0 is a
 *    no-op; p = 1 removes every dead end (every floor tile has at
 *    least two floor neighbors). Tree-based backends + braid are
 *    the standard recipe for "loopy" mazes.
 *
 *  - pruneDeadEnds(threshold) fills dead-end stubs of length less
 *    than `threshold` with walls. No v1 biome uses this; ships
 *    alongside braid because they're a natural pair.
 *
 *  - chambers({k, size, margin}) stamps `k` open size x size squares
 *    onto whatever the backend built. ⛓ CONSTRUCTIVE-MODE arc, slice 7
 *    (`NewDocs/plans/seedling-constructive-mode-kickoff.md` §3.6 item 3):
 *    a carved room is corridor, and every AREA template in either
 *    substrate's pass-2 palette (a pool, a pit patch, a lane) needs
 *    somewhere wider than one tile to be. It is the first post-processor
 *    written for the constructive mode rather than inherited from the
 *    region generator.
 *
 * All three refuse to touch entrance/exit tiles, so worst-case they
 * leave the input unchanged but never break feasibility.
 *
 * ⛔ AND `chambers` IS **MONOTONE** — it only ever turns wall into floor.
 * That is not a description, it is the whole reason it needs no
 * connectivity repair: adding walkable cells cannot disconnect two cells
 * that were already connected, so a room the backend certified stays
 * certified. `braid` shares the property; `pruneDeadEnds` does not (it
 * fills), which is why that one has to reason about dead ends.
 */

import {
    TILE_FLOOR, TILE_WALL,
    getTile, setTile,
} from './gridTiles.js';

const DELTAS = [
    { dx: 0, dy: -1 },
    { dx: 0, dy: 1 },
    { dx: 1, dy: 0 },
    { dx: -1, dy: 0 },
];

function isProtected(world, x, y) {
    if (world.entrance.x === x && world.entrance.y === y) return true;
    for (const e of world.exits.values()) {
        if (e.x === x && e.y === y) return true;
    }
    return false;
}

function floorNeighborCount(world, x, y) {
    let n = 0;
    for (const d of DELTAS) {
        const nx = x + d.dx;
        const ny = y + d.dy;
        if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
        if (getTile(world, nx, ny) === TILE_FLOOR) n += 1;
    }
    return n;
}

function listDeadEnds(world) {
    const out = [];
    for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
            if (getTile(world, x, y) !== TILE_FLOOR) continue;
            if (isProtected(world, x, y)) continue;
            if (floorNeighborCount(world, x, y) === 1) out.push({ x, y });
        }
    }
    return out;
}

/**
 * Knock down one wall on each dead-end with probability `p`. A wall
 * is eligible if the tile beyond it (one step further in the same
 * direction) is also floor — that's what creates the loop.
 *
 * Walls that don't have floor beyond (boundary walls, wall-bounded
 * corners) are skipped. A dead-end with no eligible walls is left
 * alone — that's the "stuck dead end" case the pruneDeadEnds
 * post-processor would handle if listed afterward.
 */
export function braid(world, params, rng) {
    const p = params?.p ?? 0;
    if (p <= 0) return { knockedDown: 0 };

    const deadEnds = listDeadEnds(world);
    let knockedDown = 0;
    for (const de of deadEnds) {
        if (rng.next() >= p) continue;
        const eligible = [];
        for (const d of DELTAS) {
            const wx = de.x + d.dx;
            const wy = de.y + d.dy;
            const bx = de.x + 2 * d.dx;
            const by = de.y + 2 * d.dy;
            if (wx < 0 || wx >= world.width || wy < 0 || wy >= world.height) continue;
            if (bx < 0 || bx >= world.width || by < 0 || by >= world.height) continue;
            if (getTile(world, wx, wy) !== TILE_WALL) continue;
            if (getTile(world, bx, by) !== TILE_FLOOR) continue;
            if (isProtected(world, wx, wy)) continue;
            eligible.push({ x: wx, y: wy });
        }
        if (eligible.length === 0) continue;
        const pick = eligible[Math.floor(rng.next() * eligible.length)];
        setTile(world, pick.x, pick.y, TILE_FLOOR);
        knockedDown += 1;
    }
    return { knockedDown };
}

/**
 * Fill every dead-end stub of length less than `threshold` with
 * walls. A stub is a corridor that terminates in a dead-end and has
 * no junction along the way. Threshold = 2 fills only single-tile
 * dead ends; threshold = 3 also fills 2-tile stubs; etc.
 *
 * Skips entrance and exit tiles — even a 1-tile dead-end stub at the
 * exit tile stays open.
 */
export function pruneDeadEnds(world, params, _rng) {
    const threshold = params?.threshold ?? 2;
    if (threshold <= 0) return { filled: 0 };

    let filled = 0;
    let changed = true;
    while (changed) {
        changed = false;
        const deadEnds = listDeadEnds(world);
        for (const de of deadEnds) {
            // Walk back along the corridor, filling tiles, up to
            // `threshold` steps. Stop when we hit a junction (>1
            // floor neighbors after the walked-back tile would be
            // filled) or a protected tile.
            let cur = de;
            let steps = 0;
            while (steps < threshold) {
                if (isProtected(world, cur.x, cur.y)) break;
                // Find the unique floor neighbor (or stop).
                let nextN = null;
                let count = 0;
                for (const d of DELTAS) {
                    const nx = cur.x + d.dx;
                    const ny = cur.y + d.dy;
                    if (nx < 0 || nx >= world.width || ny < 0 || ny >= world.height) continue;
                    if (getTile(world, nx, ny) !== TILE_FLOOR) continue;
                    count += 1;
                    nextN = { x: nx, y: ny };
                }
                if (count !== 1) break;
                setTile(world, cur.x, cur.y, TILE_WALL);
                filled += 1;
                changed = true;
                steps += 1;
                cur = nextN;
            }
        }
    }
    return { filled };
}

/**
 * ⛓⛓⛓ CHAMBERS — `k` small OPEN SQUARES stamped onto a carved layout.
 *
 * CONSTRUCTIVE-MODE arc, slice 7. See the file docblock for WHY; this is
 * HOW, and every choice below is one a caller can rely on.
 *
 *  · `k`      how many centres to draw. **`k <= 0` returns before touching
 *             `rng`** — the knob's default is off, and "off" has to mean
 *             the identical draw stream, or every existing seed->level pair
 *             would expire the day the knob was declared.
 *  · `size`   the side of the stamped square. **ODD ONLY**, because the
 *             stamp is centred on the drawn cell and an even square has no
 *             centre — that refuses by name rather than silently drifting
 *             half a tile.
 *  · `margin` how many cells in from the grid edge may NEVER be carved.
 *             ⛔ A CALLER FACT, not a default: the Seedling binding hands
 *             its room in with the border ring already walled and checks on
 *             the way out that the carve left it walled (a floor tile on
 *             the border is not a room — nothing stops a player walking off
 *             a floor that ends), so it passes 1. The maze has no wall ring
 *             and passes 0. A post-processor that guessed would be wrong in
 *             one of the two substrates.
 *
 * ⛔ THE CENTRES ARE DRAWN FROM ONE LIST, TAKEN ONCE. The floor cells are
 * enumerated BEFORE the first stamp, so the k draws are independent of each
 * other and a stamp cannot widen the pool the next draw reads. Two draws
 * may land on the same cell; that is a smaller room, not a defect, and
 * re-listing after each stamp would make the k-th draw depend on the
 * geometry of the first, which is the harder thing to reason about for no
 * gain.
 *
 * ⛔ IT IS CLAMPED, NOT SKIPPED. A centre whose square runs off the grid
 * (or into the margin) stamps the part that fits. Requiring the whole
 * square to fit would silently exclude every corridor cell near a wall —
 * i.e. most of a carved room — and the caller asked for area, not for a
 * guarantee about the shape of it.
 *
 * ⛔ PROTECTED TILES ARE UNTOUCHED **BY CONSTRUCTION**: this only ever
 * writes FLOOR, and the entrance and the exits already are floor when a
 * backend hands the grid over. There is no `isProtected` guard here
 * because there is nothing for it to prevent.
 *
 * @returns {{stamped:number, opened:number}} centres drawn, wall cells turned
 *   to floor.
 */
export function chambers(world, params, rng) {
    const k = params?.k ?? 0;
    const size = params?.size ?? 3;
    const margin = params?.margin ?? 0;
    if (!Number.isInteger(k)) {
        throw new Error(`chambers: k must be an integer, got ${JSON.stringify(k)}.`);
    }
    if (k <= 0) return { stamped: 0, opened: 0 };
    if (!Number.isInteger(size) || size < 1 || size % 2 === 0) {
        throw new Error(`chambers: size must be an ODD positive integer, got `
            + `${JSON.stringify(size)} — the stamp is centred on the drawn cell, and an `
            + 'even square has no centre.');
    }
    if (!Number.isInteger(margin) || margin < 0) {
        throw new Error(`chambers: margin must be a non-negative integer, got `
            + `${JSON.stringify(margin)}.`);
    }
    const centres = [];
    for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
            if (getTile(world, x, y) === TILE_FLOOR) centres.push({ x, y });
        }
    }
    if (centres.length === 0) return { stamped: 0, opened: 0 };
    const half = (size - 1) / 2;
    const loX = margin;
    const loY = margin;
    const hiX = world.width - 1 - margin;
    const hiY = world.height - 1 - margin;
    let stamped = 0;
    let opened = 0;
    for (let i = 0; i < k; i++) {
        const c = centres[Math.floor(rng.next() * centres.length)];
        stamped += 1;
        for (let dy = -half; dy <= half; dy++) {
            for (let dx = -half; dx <= half; dx++) {
                const x = c.x + dx;
                const y = c.y + dy;
                if (x < loX || y < loY || x > hiX || y > hiY) continue;
                if (getTile(world, x, y) === TILE_FLOOR) continue;
                setTile(world, x, y, TILE_FLOOR);
                opened += 1;
            }
        }
    }
    return { stamped, opened };
}

const POST_PROCESSORS = new Map([
    ['braid', braid],
    ['pruneDeadEnds', pruneDeadEnds],
    ['chambers', chambers],
]);

export function getPostProcessor(id) {
    return POST_PROCESSORS.get(id) ?? null;
}

export function listPostProcessors() {
    return [...POST_PROCESSORS.keys()];
}
