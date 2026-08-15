/**
 * The tile vocabulary the grid algorithms in this directory speak.
 *
 * These five definitions used to live in `mazeRoom/mazeRoomEngine.js`, which
 * made the shared algorithms reach BACK into the outer repo for them. They
 * moved here so the algorithms depend on a grid contract and nothing else;
 * `mazeRoomEngine.js` imports them from here and re-exports them under the
 * same names, so every maze-side caller is unchanged.
 *
 * ─── THE GRID CONTRACT ───────────────────────────────────────────────
 *
 * Every backend and post-processor in this directory operates on a `world`
 * that is only ever required to be:
 *
 *   {
 *     width:    integer  — tile columns
 *     height:   integer  — tile rows
 *     tiles:    Int8Array of length width*height, row-major
 *                          (index = y * width + x)
 *     entrance: { x, y }  — one fixed tile, never walled
 *     exits:    iterable of { x, y } via `exits.values()`
 *                          (the maze passes a Map keyed by exit_id; any
 *                           object with a `values()` yielding {x,y} does)
 *   }
 *
 * plus an `rng` with `rng.next()` returning a float in [0, 1).
 *
 * Nothing here reads inventory, obstacles, items, or any substrate-specific
 * overlay, and nothing here calls a simulator. A second grid substrate
 * satisfying the five fields above can use these algorithms as carvers
 * without adopting the maze's world model. (The maze's own `corridor_only`
 * and `random_walls` backends need the simulator and therefore stay in
 * `mazeRoom/mazeAlgorithms/`.)
 *
 * Bounds: `tileIndex`/`getTile`/`setTile` do NOT range-check — they are the
 * inner loop of the carvers. Callers that can go out of range check first
 * (see `cellGrid.repairConnectivity`, `postProcessors.braid`).
 *
 * See docs/json/developer/procgen/maze.md ("Biomes and wall backends").
 */

// --- Tile types ---

export const TILE_FLOOR = 0;
export const TILE_WALL = 1;

export function tileIndex(world, x, y) {
    return y * world.width + x;
}

export function getTile(world, x, y) {
    return world.tiles[tileIndex(world, x, y)];
}

export function setTile(world, x, y, tile) {
    world.tiles[tileIndex(world, x, y)] = tile;
}
