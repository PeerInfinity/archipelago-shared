/**
 * Cross-game consumable tile generator (X1) — a maze content module,
 * sibling to hazardPathGen.
 *
 * Places two logic-inert tile overlays on a freshly-built maze world:
 *
 *   consumableTiles — stepping on one grants ANOTHER game's consumable
 *     (`{substrate, type, count}`) through the resourceChannels bus.
 *   manaTiles — stepping on one refills the shared loop-mode mana pool.
 *
 * Neither is an AP location (D10) and neither participates in
 * winnability (D5): Fill, the solvers, and the sphere oracle never see
 * them. That is what lets placement be a purely additive post-pass.
 *
 * DETERMINISM / BYTE-INERTNESS (D3/S3). Two properties matter and are
 * tested:
 *   - At defaults the caller never invokes this module, so ZERO rng is
 *     drawn and the shared rng stream is unperturbed — every existing
 *     preset regenerates byte-identically.
 *   - When active, placement is a single uniform draw per tile over a
 *     sorted candidate list, so the same (seed, params, world) always
 *     yields the same tiles.
 *
 * PLACEMENT POLICY v1 = ANY REACHABLE TILE (X1-R2). Candidates come
 * from `floorReachableSet` — the floor-only flood fill from the
 * entrance, which treats obstacles as transparent. Obstacle-transparent
 * is the right predicate here precisely BECAUSE these tiles are
 * logic-inert: a tile behind a locked door is still legitimately
 * reachable once the player holds the key, and nothing in the logic
 * depends on reaching it at all. (The inventory-aware `reachableTiles`
 * would instead confine every consumable to the pre-key frontier — a
 * placement bias nobody asked for.) `floorReachableSet` additionally
 * guarantees a non-empty extracted path, matching what
 * extractPathsAndObstacles consumes.
 *
 * Richer policies — dead-end bias, per-sphere quotas — are explicitly
 * LATER (X1-R2).
 */

import { floorReachableSet } from '../../../mazeRoom/mazeRoomEngine.js';

/**
 * Candidate tiles for consumable placement: reachable floor, minus the
 * anchors that already carry meaning.
 *
 * Exclusions mirror the hazard module's `reservedTiles` for the same
 * reasons — the entrance is where the player spawns, exits route
 * between regions, item tiles hold a location sprite — plus obstacle
 * tiles (a door sprite and a consumable sprite on one tile is
 * unreadable) and any tile a previous pass in this run already claimed.
 *
 * Returned in row-major order so the caller's draw is reproducible
 * regardless of Map/Set iteration incidentals.
 */
export function consumableTileCandidates(world, claimed = new Set()) {
    const reachable = floorReachableSet(world);
    const out = [];
    for (let y = 0; y < world.height; y++) {
        for (let x = 0; x < world.width; x++) {
            const key = `${x},${y}`;
            if (!reachable.has(key)) continue;
            if (world.entrance.x === x && world.entrance.y === y) continue;
            if (claimed.has(key)) continue;
            if (world.items?.has(key)) continue;
            if (world.obstacles?.has(key)) continue;
            let onExit = false;
            for (const e of world.exits.values()) {
                if (e.x === x && e.y === y) { onExit = true; break; }
            }
            if (onExit) continue;
            out.push({ x, y, key });
        }
    }
    return out;
}

/**
 * Place consumable + mana tiles on `world`. Mutates the world's
 * overlays; returns a summary for telemetry/tests.
 *
 * @param {object} world - target world (post base build + obstacles)
 * @param {object} opts
 * @param {number} [opts.consumableCount=0] - foreign-item tiles to place
 * @param {number} [opts.manaCount=0] - mana-refill tiles to place
 * @param {number} [opts.manaAmount=0] - mana granted per refill tile
 * @param {Array<{substrate,type}>} [opts.pool=[]] - foreign item pool,
 *   drawn from co-present substrates' registry `sharing.items`
 *   declarations. An empty pool means no consumable tiles can be placed
 *   (mana tiles are unaffected — they need no pool).
 * @param {number} [opts.countPerTile=1] - grant count stamped per tile
 * @param {{next:()=>number}} rng
 * @returns {{consumablesPlaced: number, manaPlaced: number}}
 */
export function generateConsumableTiles(world, opts = {}, rng) {
    const consumableCount = Math.max(0, Math.floor(opts.consumableCount ?? 0));
    const manaCount = Math.max(0, Math.floor(opts.manaCount ?? 0));
    const manaAmount = Number(opts.manaAmount ?? 0);
    const pool = Array.isArray(opts.pool) ? opts.pool : [];
    const countPerTile = Math.max(1, Math.floor(opts.countPerTile ?? 1));

    if (consumableCount === 0 && manaCount === 0) {
        return { consumablesPlaced: 0, manaPlaced: 0 };
    }
    if (!rng || typeof rng.next !== 'function') {
        throw new Error('generateConsumableTiles: rng required');
    }

    const claimed = new Set();
    let consumablesPlaced = 0;
    let manaPlaced = 0;

    // Consumable tiles first, so a pool-starved world still gets its
    // mana tiles on the same candidates it would have had otherwise
    // only if no consumables were placed — see the note below.
    if (pool.length > 0) {
        for (let i = 0; i < consumableCount; i++) {
            const candidates = consumableTileCandidates(world, claimed);
            if (candidates.length === 0) break;
            const tile = candidates[Math.floor(rng.next() * candidates.length)];
            const entry = pool[Math.floor(rng.next() * pool.length)];
            if (!world.consumableTiles) world.consumableTiles = new Map();
            world.consumableTiles.set(tile.key, {
                substrate: entry.substrate,
                type: entry.type,
                count: countPerTile,
            });
            claimed.add(tile.key);
            consumablesPlaced++;
        }
    }

    // Mana tiles. Note these draw from the SAME candidate space minus
    // whatever the consumable pass claimed, so the two never share a
    // tile — a tile that both grants an item and refills mana would be
    // indistinguishable to the renderer.
    if (manaAmount > 0) {
        for (let i = 0; i < manaCount; i++) {
            const candidates = consumableTileCandidates(world, claimed);
            if (candidates.length === 0) break;
            const tile = candidates[Math.floor(rng.next() * candidates.length)];
            if (!world.manaTiles) world.manaTiles = new Map();
            world.manaTiles.set(tile.key, manaAmount);
            claimed.add(tile.key);
            manaPlaced++;
        }
    }

    return { consumablesPlaced, manaPlaced };
}

/**
 * True when the options would actually place something. The caller uses
 * this as the "active" predicate that gates BOTH the rng draw and the
 * params_hash contribution — the P2 `awardsActive` discipline
 * (generateDataset.js) applied to tiles.
 */
export function consumableTilesActive(opts) {
    if (!opts) return false;
    const c = Math.max(0, Math.floor(opts.consumableCount ?? 0));
    const m = Math.max(0, Math.floor(opts.manaCount ?? 0));
    const amt = Number(opts.manaAmount ?? 0);
    return c > 0 || (m > 0 && amt > 0);
}
