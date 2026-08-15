/**
 * Maze backend registry. A backend is one wall-generation strategy
 * (random walls, recursive backtracker, Kruskal's, etc.). Backends
 * register themselves at module load time; `getBackend(id)` looks one
 * up by id; the maze substrate dispatches on the id from the active
 * biome's `backend` field.
 *
 * Keeping the registry in shared/procgen rather than mazeRoom/ left room
 * for a future grid-based substrate (e.g. a tile-room generator) to
 * register its own backends here — and as of the constructive-mode arc's
 * shared refactor that room is real: `recursive_backtracker`, `kruskals`
 * and `recursive_division` live beside this file and depend only on the
 * grid contract in `gridTiles.js`, not on the maze substrate. The maze's
 * `corridor_only` / `random_walls` / `empty` still live in
 * `mazeRoom/mazeAlgorithms/` — the first two need the maze simulator.
 *
 * `listBackends()` returns INSERTION order, which is the import order in
 * `mazeRoom/mazeAlgorithms/index.js`.
 *
 * See docs/json/developer/procgen/maze.md ("Biomes and wall backends").
 */

const registry = new Map();

export function registerBackend(backend) {
    if (!backend || typeof backend.id !== 'string') {
        throw new Error('registerBackend: backend must have a string id');
    }
    if (typeof backend.run !== 'function') {
        throw new Error(`registerBackend: backend '${backend.id}' must have a run function`);
    }
    if (registry.has(backend.id)) {
        throw new Error(`registerBackend: duplicate id '${backend.id}'`);
    }
    registry.set(backend.id, backend);
}

export function getBackend(id) {
    return registry.get(id) ?? null;
}

export function listBackends() {
    return [...registry.values()];
}

export function hasBackend(id) {
    return registry.has(id);
}

// Test-only — drop all registered backends so a test can re-register
// from a clean state. Production code never calls this.
export function _testOnly_clearRegistry() {
    registry.clear();
}
