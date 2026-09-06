/**
 * loopCostDefaults — **THE loop_costs vocabulary's numbers, and nothing else.**
 *
 * ⚖ user ruling 2026-09-06: *"I want the updated default location cost of 10 to
 * be an exported constant, not a block field update. In general, I want the code
 * to use exported constants, not hardcoded numbers."*
 *
 * These are the numbers a cost block falls back to when it names no value for a
 * region or a location, AND the numbers the runtime charges when no block is
 * loaded at all. Before loop-costs L2 they existed as FIVE independent
 * hardcoded copies — `loops/costDataManager.js`, `loops/loopState.js`,
 * `loops/loopUI.js` (twice) and `loopStats/queueAnalyzer.js` — plus the two cost
 * models' own literals, which is how the store's location fallback (100) and the
 * generator's (10) came to disagree for eight months.
 *
 * ⛔ **THIS FILE HAS NO IMPORTS AND MUST KEEP NONE.** It exists as its own module
 * only to break a cycle: `loopCostGenerator.js` (the block producer) imports
 * `loopCostPlanner.js` (the algorithm), and the algorithm needs these numbers.
 * With the constants living in the generator that is a real import cycle through
 * a module `loops/costDataManager.js` and `loops/loopState.js` both pull in at
 * boot. ⚠ **Import them from `loopCostGenerator.js`, which re-exports every one
 * of them** — that is the door the runtime readers already use, and this path is
 * an implementation detail.
 *
 * ⚠ `DEFAULT_LOCATION_COST` is **10**, not the runtime's historical 100 — that is
 * the ruling, and it moves what a world WITHOUT a block charges for a location
 * check.
 */

/** The region XP effect modes a block may name, and the default. */
export const VALID_REGION_XP_EFFECTS = ['cost', 'speed', 'both', 'none'];
export const DEFAULT_REGION_XP_EFFECT = 'cost';

/**
 * Mana per second charged while live-playing a SUMMARY substrate's region
 * (runner, bounce — M5, user default 2026-07-23).
 */
export const DEFAULT_TIME_DRAIN_PER_SECOND = 1;

/** Fallback move cost for a region the block does not name. */
export const DEFAULT_REGION_COST = 50;

/** Fallback check cost for a location the block does not name. */
export const DEFAULT_LOCATION_COST = 10;

/**
 * Explore is priced as a multiple of the region's move cost — the generic
 * model, stated once. Read by `loopState._calculateActionCost` ('customAction'
 * = region cost × this), by `loopState._summaryBaseCost`, and by the planner's
 * explore loop and its defaults fill (an unvisited location is priced at its
 * region's cost × this, "matching explore cost ratio").
 */
export const DEFAULT_EXPLORE_MULTIPLIER = 2;

/** Mana a simulated loop starts with, before any item boost. */
export const DEFAULT_STARTING_MAX_MANA = 100;

/** Max mana added per inventory item received, in the simulation. */
export const DEFAULT_MANA_PER_ITEM = 10;
