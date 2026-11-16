/**
 * SoE reads the LOADED player's options and regions (sdc-player1-tidy).
 *
 * The defect: `has()` / `countProgress()` read `staticData.world[1].options`, so in a
 * combined document loaded at player 2 the OOB / sequence-break / energy-core settings
 * were player 1's. `location_item_name` read `staticData.regions[1]`, but `regions` is
 * a Map of the loaded player's regions, so it always returned null.
 *
 * Mutant: put `world[1]` back in `playerOptions` and the player-2 rows go red;
 * put `regions[1]` back and the location_item_name row goes red.
 */
import { describe, it, expect } from 'vitest';
import { has, location_item_name } from './soeLogic.js';

// Player 1: OOB/sequence breaks OFF (0). Player 2: both in LOGIC (2).
function combinedAt(playerId) {
  return {
    playerId,
    world: {
      1: { game: 'Secret of Evermore', options: { out_of_bounds: 0, sequence_breaks: 0, energy_core: 0 } },
      2: { game: 'Secret of Evermore', options: { out_of_bounds: 2, sequence_breaks: 2, energy_core: 0 } },
    },
    items: new Map(),
    regions: new Map([
      ['Menu', { name: 'Menu', locations: [{ name: 'Loc A', item: { name: 'Wheel', player: 2 } }] }],
    ]),
  };
}
const snap = { inventory: {} };

describe('SoE — the loaded slot, not player 1', () => {
  it('P_ALLOW_OOB (25) follows the loaded player', () => {
    expect(has(snap, combinedAt('2'), 25)).toBe(true);
    expect(has(snap, combinedAt('1'), 25)).toBe(false);
  });

  it('P_ALLOW_SEQUENCE_BREAKS (26) follows the loaded player', () => {
    expect(has(snap, combinedAt('2'), 26)).toBe(true);
    expect(has(snap, combinedAt('1'), 26)).toBe(false);
  });

  it('a numeric playerId resolves the same slot as its string', () => {
    expect(has(snap, combinedAt(2), 25)).toBe(true);
  });

  it('location_item_name finds the item in the regions Map', () => {
    expect(location_item_name(snap, combinedAt('2'), 'Loc A')).toEqual(['Wheel', 2]);
    expect(location_item_name(snap, combinedAt('2'), 'Nope')).toBeNull();
  });
});
