/**
 * Shared Queue Analysis Module
 *
 * Core cost calculation and queue analysis logic used by both the Loops panel
 * and the Loop Stats panel. Extracted from loopStats/queueAnalyzer.js for reuse.
 */

import {
  proposedLinearReduction,
  applyRegionXpCostEffect,
} from '../loops/xpFormulas.js';
import { getCostDataManager } from '../loops/index.js';
import {
  DEFAULT_EXPLORE_MULTIPLIER,
  DEFAULT_LOCATION_COST,
  DEFAULT_REGION_COST,
  START_REGION_MOVE_COST,
} from './procgen/loopCostGenerator.js';

/** Maximum characters for truncated action names */
export const ACTION_NAME_MAX_CHARS = 30;

/**
 * Fallback base costs when no cost data is loaded — **THE SAME NAMES the
 * charging fallback uses** (`loopState._calculateActionCost`'s no-data branch),
 * ⚖ user ruling 2026-09-06/07: exported constants, never hardcoded numbers.
 *
 * ⛔ **`locationCheck` WAS A TYPED 100 AND THE RUNTIME HAS CHARGED 10 SINCE L2.**
 * Measured before this change, on a world with no block: the panel displayed
 * `100` for a check the queue then billed `10` — a 10× disagreement that
 * survived L2 because L2 moved the CHARGING copy and this DISPLAY copy typed its
 * own number. Reading `DEFAULT_LOCATION_COST` is what makes the two unable to
 * drift again.
 *
 * ⚠ `customAction` is `DEFAULT_REGION_COST`, **not**
 * `DEFAULT_REGION_COST × DEFAULT_EXPLORE_MULTIPLIER`. The no-data branch has
 * always priced an explore at a plain region move (`loops.md`, "Fallback Costs":
 * named, not changed), so ×2 here would introduce a fresh 2× disagreement in the
 * other direction. The multiplier applies only where a block IS loaded, below,
 * which is where it now appears by name.
 */
export const BASE_COSTS = {
  customAction: DEFAULT_REGION_COST,
  locationCheck: DEFAULT_LOCATION_COST,
  regionMove: DEFAULT_REGION_COST,
};

/**
 * Get base cost for an action, using costDataManager when available.
 *
 * ⚖ 2026-09-06, model (A) — **THE START-REGION MOVE IS FREE BY RULE**, and the
 * rule is tested BEFORE either branch below because it holds in both: whatever
 * the loaded block says for the start region, and whatever the fallback table
 * says when no block is loaded. This is the DISPLAY half of the rule
 * `loopState._calculateActionCost` charges by — the two must not disagree about
 * a number, and they share `START_REGION_MOVE_COST` so they cannot.
 *
 * `loopState` is optional and duck-typed: a caller that has no loop state (or a
 * mock predating the rule) simply prices the move as before.
 *
 * @param {Object} action - The action to calculate cost for
 * @param {Object} [loopState] - The loop state, for `isStartRegion`
 * @returns {number} Base mana cost
 */
export function getBaseCost(action, loopState) {
  if (action?.type === 'regionMove'
      && loopState?.isStartRegion?.(action.sourceRegion) === true) {
    return START_REGION_MOVE_COST;
  }

  const costDataManager = getCostDataManager();

  if (costDataManager?.isLoaded()) {
    switch (action.type) {
      case 'regionMove':
        return costDataManager.getRegionCost(action.sourceRegion);
      case 'locationCheck':
        return costDataManager.getLocationCost(action.locationName);
      case 'customAction':
        return costDataManager.getRegionCost(action.sourceRegion)
          * DEFAULT_EXPLORE_MULTIPLIER;
      default:
        return DEFAULT_REGION_COST;
    }
  }

  return BASE_COSTS[action.type] || DEFAULT_REGION_COST;
}

/**
 * Calculate the mana cost of an action
 * @param {Object} action - The action to calculate cost for
 * @param {Object} loopState - The loop state for XP data
 * @returns {Object} Cost breakdown: { baseCost, levelDiscount, itemPenalties, finalCost, level }
 */
export function calculateActionCost(action, loopState) {
  const baseCost = getBaseCost(action, loopState);

  let levelDiscount = 0;
  let finalCost = baseCost;
  let level = 0;

  // Apply region XP reduction if applicable, gated by the per-region
  // xpEffect from the loop_costs sidecar (defaults to 'cost').
  const actionRegion = action.sourceRegion;
  if (actionRegion && loopState) {
    const xpData = loopState.getRegionXP(actionRegion);
    level = xpData?.level || 0;

    const cdm = getCostDataManager();
    const effect = cdm?.getRegionXpEffect?.(actionRegion);
    finalCost = applyRegionXpCostEffect(baseCost, level, effect);
    levelDiscount = baseCost - finalCost;
  }

  return {
    baseCost,
    levelDiscount,
    itemPenalties: [], // Future: Phase 3 implementation
    finalCost,
    level,
  };
}

/**
 * Get a display name for an action
 * @param {Object} action - The action
 * @returns {string} Display name
 */
export function getActionDescription(action) {
  switch (action.type) {
    case 'customAction':
      return `Explore: ${action.sourceRegion}`;
    case 'locationCheck':
      return `Check: ${action.locationName}`;
    case 'regionMove': {
      const dest = action.destinationRegion;
      const via = action.exitUsed ? ` via ${action.exitUsed}` : '';
      return `Move: ${dest}${via}`;
    }
    default:
      return `${action.type}: ${action.sourceRegion || action.destinationRegion || 'Unknown'}`;
  }
}

/**
 * Truncate a string for narrow display
 * @param {string} str - String to truncate
 * @param {number} maxLen - Maximum length
 * @returns {string} Truncated string
 */
export function truncateDescription(str, maxLen = ACTION_NAME_MAX_CHARS) {
  if (str.length <= maxLen) return str;
  return str.substring(0, maxLen - 1) + '…';
}

/**
 * Calculate predicted real time for an action in seconds
 * Based on loopState tick formula: progressIncrement = (deltaTime / 1000) * (20 / actionCost)
 * So total time = actionCost * 5 / gameSpeed
 * @param {number} actionCost - The mana cost of the action
 * @param {number} gameSpeed - Current game speed multiplier
 * @returns {number} Predicted time in seconds
 */
export function predictedTimeSeconds(actionCost, gameSpeed) {
  if (gameSpeed === Infinity || gameSpeed <= 0 || actionCost <= 0) return 0;
  return (actionCost * 5) / gameSpeed;
}

/**
 * Format time for display
 * @param {number} seconds - Time in seconds
 * @returns {string} Formatted time string
 */
export function formatTime(seconds) {
  if (seconds <= 0) return '0s';
  if (seconds < 60) return `${seconds.toFixed(1)}s`;
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}m ${secs}s`;
}

/**
 * Get CSS class for mana remaining color coding
 * @param {number} remaining - Mana remaining
 * @param {number} max - Maximum mana
 * @returns {string} CSS class name
 */
export function manaColorClass(remaining, max) {
  if (remaining < 0) return 'loop-mana-insufficient';
  const pct = max > 0 ? remaining / max : 0;
  if (pct > 0.5) return 'loop-mana-good';
  if (pct > 0.1) return 'loop-mana-warn';
  return 'loop-mana-low';
}

/**
 * @typedef {Object} ActionAnalysis
 * @property {number} index - Position in the queue
 * @property {number} pathIndex - Path index for tracking
 * @property {string} type - Action type
 * @property {string} description - Full description
 * @property {string} truncatedDescription - Truncated for display
 * @property {string} sourceRegion - Source region (current region for locationCheck/customAction, origin for regionMove)
 * @property {string} destinationRegion - Destination region (only for regionMove)
 * @property {number} baseCost - Base mana cost
 * @property {number} levelDiscount - XP level reduction
 * @property {number} finalCost - Actual mana cost
 * @property {number} manaBeforeAction - Mana before this action
 * @property {number} manaAfterAction - Mana after this action (predicted)
 * @property {number} predictedTime - Predicted real time in seconds
 * @property {boolean} hasInsufficientMana - Will run out of mana
 * @property {boolean} isCompleted - Action is already completed
 * @property {number} progress - Current progress (0-100)
 * @property {string} status - 'pending', 'active', or 'completed'
 */

/**
 * @typedef {Object} QueueAnalysis
 * @property {ActionAnalysis[]} entries - Analysis for each action
 * @property {number} totalCost - Sum of all action costs
 * @property {number} finalMana - Predicted mana after all actions
 * @property {number} startingMana - Mana at start of analysis
 * @property {number} maxMana - Maximum mana capacity
 * @property {number} timestamp - When analysis was performed
 */

/**
 * Analyze the action queue and calculate costs for each action
 * @param {Array} actionQueue - Array of actions from loopState
 * @param {Object} loopState - The loop state instance
 * @param {Object} [gameState] - GameState instance (source of mana fields).
 *   Falls back to loopState.maxMana for legacy callers / test mocks.
 * @returns {QueueAnalysis} Analysis result
 */
export function analyzeQueue(actionQueue, loopState, gameState) {
  if (!actionQueue || !loopState) {
    return {
      entries: [],
      totalCost: 0,
      finalMana: 0,
      startingMana: 0,
      maxMana: 100,
      timestamp: Date.now(),
    };
  }

  const maxMana = gameState ? gameState.maxMana : loopState.maxMana;
  const gameSpeed = loopState.gameSpeed || 10;
  const startingMana = maxMana;
  let currentMana = startingMana;
  let totalCost = 0;
  const entries = [];

  // Determine active action
  const currentActionIndex = loopState.currentActionIndex || 0;
  const isProcessing = loopState.isProcessing || false;

  for (let i = 0; i < actionQueue.length; i++) {
    const action = actionQueue[i];

    // Calculate cost breakdown
    const costData = calculateActionCost(action, loopState);

    // Get description
    const description = getActionDescription(action);
    const truncatedDescription = truncateDescription(description);

    // Calculate mana before/after
    const manaBeforeAction = currentMana;

    // Determine status
    let status = 'pending';
    if (action.completed) {
      status = 'completed';
    } else if (i === currentActionIndex && isProcessing) {
      status = 'active';
    }

    // Mana after action: always deduct full cost so downstream values are stable
    const manaAfterAction = manaBeforeAction - costData.finalCost;

    totalCost += costData.finalCost;
    currentMana = manaAfterAction;

    // Calculate predicted time
    const time = predictedTimeSeconds(costData.finalCost, gameSpeed);

    entries.push({
      index: i,
      pathIndex: action.pathIndex,
      type: action.type,
      description,
      truncatedDescription,
      sourceRegion: action.sourceRegion,
      destinationRegion: action.destinationRegion,
      locationName: action.locationName,

      // Cost breakdown
      baseCost: costData.baseCost,
      levelDiscount: costData.levelDiscount,
      level: costData.level,
      itemPenalties: costData.itemPenalties,
      finalCost: costData.finalCost,

      // Mana tracking
      manaBeforeAction,
      manaAfterAction,

      // Time
      predictedTime: time,

      // Status
      status,
      isDoubledCost: costData.itemPenalties.length > 0,
      hasInsufficientMana: manaAfterAction < 0,
      isCompleted: action.completed || false,
      progress: action.progress || 0,
    });
  }

  return {
    entries,
    totalCost,
    finalMana: currentMana,
    startingMana,
    maxMana,
    timestamp: Date.now(),
  };
}
