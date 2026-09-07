/**
 * `shared/queueAnalysis` — the DISPLAY pricer.
 *
 * This module is what the Loops panel's queue analysis (`loopRenderer.js`'s
 * `analyzeQueue`) and the Loop Stats panel both price a queued action with.
 * `loopState._calculateActionCost` is what actually CHARGES; these rows cover
 * the one rule the two must agree about, ⚖ 2026-09-06 model (A): a `regionMove`
 * whose SOURCE is a start region is free, in BOTH the loaded-block branch and
 * the no-block fallback.
 *
 * ⚠ `isStartRegion` is duck-typed off the loop state, so the last row here is
 * the one that matters for old callers: a loop state that has never heard of the
 * rule must price a move exactly as before.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

const store = vi.hoisted(() => ({ loaded: true, regionCost: 50, locationCost: 10 }));

vi.mock('../loops/index.js', () => ({
  getCostDataManager: () => ({
    isLoaded: () => store.loaded,
    getRegionCost: () => store.regionCost,
    getLocationCost: () => store.locationCost,
    getRegionXpEffect: () => 'cost',
  }),
}));

const { getBaseCost, calculateActionCost, BASE_COSTS } = await import('./queueAnalysis.js');
const { START_REGION_MOVE_COST } = await import('./procgen/loopCostGenerator.js');

/** A loop state that knows the rule; 'Menu' is the start region, as in every preset. */
const loopStateWithRule = {
  isStartRegion: (region) => region === 'Menu',
  getRegionXP: () => ({ level: 0, xp: 0 }),
};

/** A loop state predating the rule — no `isStartRegion` at all. */
const loopStateWithoutRule = {
  getRegionXP: () => ({ level: 0, xp: 0 }),
};

const move = (sourceRegion) => ({
  type: 'regionMove', sourceRegion, destinationRegion: 'A', exitUsed: 'to_a',
});

describe('queueAnalysis — the start-region move is free by rule', () => {
  beforeEach(() => {
    store.loaded = true;
    store.regionCost = 50;
  });

  it('prices a move OUT of the start region at START_REGION_MOVE_COST even though the block says 50', () => {
    expect(store.regionCost).toBe(50);
    expect(getBaseCost(move('Menu'), loopStateWithRule)).toBe(START_REGION_MOVE_COST);
  });

  it('leaves a move out of a NON-start region priced by the block', () => {
    expect(getBaseCost(move('A'), loopStateWithRule)).toBe(50);
  });

  it('applies the rule in the NO-BLOCK fallback too', () => {
    store.loaded = false;
    expect(getBaseCost(move('Menu'), loopStateWithRule)).toBe(START_REGION_MOVE_COST);
    expect(getBaseCost(move('A'), loopStateWithRule)).toBe(BASE_COSTS.regionMove);
  });

  it('does NOT free an explore in the start region — the rule is about a regionMove only', () => {
    const explore = { type: 'customAction', actionName: 'explore', sourceRegion: 'Menu' };
    expect(getBaseCost(explore, loopStateWithRule)).toBe(100); // block's 50 × 2
  });

  it('does NOT free a location check in the start region', () => {
    const check = { type: 'locationCheck', locationName: 'Loc', sourceRegion: 'Menu' };
    expect(getBaseCost(check, loopStateWithRule)).toBe(10);
  });

  it('threads the loop state through calculateActionCost, so the queue readout shows 0', () => {
    const free = calculateActionCost(move('Menu'), loopStateWithRule);
    expect(free.baseCost).toBe(START_REGION_MOVE_COST);
    expect(free.finalCost).toBe(START_REGION_MOVE_COST);
    const paid = calculateActionCost(move('A'), loopStateWithRule);
    expect(paid.finalCost).toBe(50);
  });

  it('prices exactly as before for a loop state that has no isStartRegion', () => {
    expect(getBaseCost(move('Menu'), loopStateWithoutRule)).toBe(50);
    expect(getBaseCost(move('Menu'), undefined)).toBe(50);
  });
});
