/**
 * loopCostPlanner — **THE loop-cost algorithm.** One model, pure, over a
 * TOPOLOGY rather than over a state manager or a rules.json.
 *
 * ── ⚖ WHY THIS FILE EXISTS ────────────────────────────────────────────
 *
 * Until 2026-09-06 the tree had two live cost models that disagreed on nearly
 * every number: `shared/procgen/loopCostGenerator.js` (the procgen pipeline's,
 * a maxMana/2 split per BFS path) and `loopsCostDebugger/costPlanner.js` (what
 * the RUNTIME ran — the Loops panel's Generate Costs and the auto-generate on
 * entering loop mode). Side by side over five documents they agreed only on
 * the start region and the first priced region.
 *
 * ⚖ The user ruled (2026-09-06): *"Let's make the planner the official
 * algorithm, but let's make the default location cost 10, not 100."* So the
 * planner's model moved HERE and the generator's was deleted. The purpose the
 * user stated for the whole thing: *"simulate a full playthrough, following the
 * sphere log, and assigning costs for each region based on what the player can
 * afford by the time they get there."*
 *
 * ── THE MODEL, IN FOUR LINES ──────────────────────────────────────────
 *
 * Each planned STEP is one action queue = one loop = one mana budget.
 *   1. Path from the start region to the sphere entry's location's region.
 *   2. EXPLORE phase — one loop per unexplored region on the path. The
 *      region's moveCost is assigned JUST IN TIME, after the traversal to it
 *      has been paid: `max(1, floor(manaRemaining / 2 / uncostedRemaining))`.
 *      Explore actions then run until the budget is gone, at
 *      DEFAULT_EXPLORE_MULTIPLIER × the region's cost, XP-discounted.
 *   3. CHECK phase — traverse, then price the location at
 *      `max(1, floor(manaRemaining))` and check it.
 *   4. DEFAULTS — regions the sphere log never reached flood-fill from their
 *      highest costed neighbour; locations get their region's cost ×
 *      DEFAULT_EXPLORE_MULTIPLIER.
 * A move costs the SOURCE region's moveCost, so leaving the start region
 * (moveCost 0) is always free. Items received raise maxMana for later loops.
 *
 * ── ⛓ THE TOPOLOGY IS THE SEAM ────────────────────────────────────────
 *
 * The planner never touches a state manager, a registry or a rules.json. It
 * reads ONE object (see `@typedef CostTopology`), built two ways:
 *
 *   topologyFromRulesJson(rulesJson, playerId)   — pure; the pipeline's path.
 *   topologyFromStaticData(staticData, snapshot) — the debugger's path, over
 *                                                  `getStaticData()` +
 *                                                  `getLatestStateSnapshot()`.
 *
 * Both produce the SAME shape, so nothing re-implements the parse and the two
 * callers provably plan the same walk. ⚠ The brief for this slice specified the
 * topology as `{startRegion, regions: Map<name,{locations,exits}>, adjacency}`;
 * that is not enough. `_beginEntry` also needs, per LOCATION, its parent region
 * (to path to), its `id` (null/0 ⇒ auto-collected, no queue needed) and whether
 * its item is an EVENT — and the defaults fill skips events but NOT id-null
 * locations, so the two predicates are genuinely different and both are carried.
 *
 * ── ⛔ NOT A UI, NOT AN APP MODULE ────────────────────────────────────
 *
 * No DOM, no eventBus of its own (one may be INJECTED), no centralRegistry, no
 * substrateRegistry. The write-by-class rule that decides which regions get
 * entries at all lives one layer up, in `loopCostGenerator.js`, because it is
 * the only part that needs the registry.
 */

import {
  proposedLinearFinalCost,
  levelFromXP,
  calculateXPGain,
} from './xpFormulas.js';
import {
  DEFAULT_EXPLORE_MULTIPLIER,
  DEFAULT_MANA_PER_ITEM,
  DEFAULT_REGION_COST,
  DEFAULT_LOCATION_COST,
  DEFAULT_STARTING_MAX_MANA,
} from './loopCostDefaults.js';

/**
 * @typedef {Object} CostTopologyRegion
 * @property {string[]} locations  location names the region contains
 * @property {string[]} exits      exit NAMES (discoverables, not targets)
 *
 * @typedef {Object} CostTopologyLocation
 * @property {string} region          the containing region's name
 * @property {number|null} id         the AP location id; null/0 ⇒ auto-collected
 * @property {boolean} isEvent        the location's item carries `event: true`
 *
 * @typedef {Object} CostTopology
 * @property {string|null} startRegion
 * @property {Map<string, CostTopologyRegion>} regions
 * @property {Map<string, CostTopologyLocation>} locations
 * @property {Map<string, Array<{region: string, exitName: string}>>} adjacency
 * @property {Map<string, string>} regionSubstrates  region name → substrate id
 */

/** An empty topology — a planner with nothing to plan against. */
export function emptyTopology() {
  return {
    startRegion: null,
    regions: new Map(),
    locations: new Map(),
    adjacency: new Map(),
    regionSubstrates: new Map(),
  };
}

// =========================================================================
// Topology adapters
// =========================================================================

/** The declared start region for a slot, or the first region in the map. */
export function resolveStartRegion(rulesJson, regions, playerId) {
  const startField = rulesJson?.start_regions?.[playerId];
  let declared = null;
  if (Array.isArray(startField?.default)) declared = startField.default[0];
  else if (Array.isArray(startField)) declared = startField[0];
  if (declared && regions[declared]) return declared;
  const keys = Object.keys(regions);
  return keys.length > 0 ? keys[0] : null;
}

/** region name → substrate id, from the document's own preset sidecars. */
export function regionSubstratesFromRulesJson(rulesJson, playerId) {
  const out = new Map();
  const sidecars = rulesJson?.preset_sidecars?.[playerId];
  if (!sidecars || typeof sidecars !== 'object') return out;
  for (const [regionName, entry] of Object.entries(sidecars)) {
    if (entry?.substrate) out.set(regionName, entry.substrate);
  }
  return out;
}

/**
 * Build a topology straight from a rules.json — the PURE path, used by
 * `generateLoopCosts` at pipeline build time and by any headless caller.
 *
 * @param {Object} rulesJson
 * @param {string} playerId
 * @returns {CostTopology}
 */
export function topologyFromRulesJson(rulesJson, playerId) {
  const src = rulesJson?.regions?.[playerId] ?? {};
  const itemsByName = rulesJson?.items?.[playerId] ?? {};
  const topo = emptyTopology();
  topo.startRegion = resolveStartRegion(rulesJson, src, playerId);
  topo.regionSubstrates = regionSubstratesFromRulesJson(rulesJson, playerId);

  for (const [name, data] of Object.entries(src)) {
    const locationNames = [];
    for (const loc of data?.locations ?? []) {
      const locName = typeof loc === 'string' ? loc : loc?.name;
      if (!locName) continue;
      locationNames.push(locName);
      // `eventLocations` in the state manager is derived from the ITEM's
      // `event` flag (initialization.js: "Must explicitly check === true"),
      // not from the location — so it is derived the same way here.
      const itemName = typeof loc === 'string' ? null : loc?.item?.name;
      topo.locations.set(locName, {
        region: name,
        id: typeof loc === 'string' ? null : (loc?.id ?? null),
        isEvent: !!itemName && itemsByName?.[itemName]?.event === true,
      });
    }
    const exitNames = [];
    const neighbours = [];
    for (const exit of data?.exits ?? []) {
      const target = exit?.connected_region;
      const exitName = exit?.name || exit?.exit_name
        || `${name} -> ${target}`;
      exitNames.push(exitName);
      if (target) neighbours.push({ region: target, exitName });
    }
    topo.regions.set(name, { locations: locationNames, exits: exitNames });
    topo.adjacency.set(name, neighbours);
  }
  // A region named only as an exit TARGET still needs an adjacency slot.
  for (const neighbours of [...topo.adjacency.values()]) {
    for (const n of neighbours) {
      if (!topo.adjacency.has(n.region)) topo.adjacency.set(n.region, []);
    }
  }
  return topo;
}

/**
 * Build a topology from a state manager's static data — the APPLIED-STATE and
 * WORKING-COPY path (`loopsCostDebugger/documentStateManager.js` yields exactly
 * these two reads for a document nobody has applied).
 *
 * ⚠ `regionSubstrates` is NOT derivable from static data: the state manager
 * does not carry `preset_sidecars`, and the runtime answers "which substrate is
 * region X" through `procgenPlayer.getRegionInfo`. So the caller supplies it —
 * an APP-layer lookup this module must not reach for. Omitted ⇒ every region
 * classifies as coarse, which is what the debugger did before this rung and is
 * the safe direction.
 *
 * @param {Object} staticData `{regions: Map, locations: Map, eventLocations}`
 * @param {Object} [snapshot] `{startRegions}` from getLatestStateSnapshot()
 * @param {Object} [opts]
 * @param {Map<string,string>} [opts.regionSubstrates]
 * @returns {CostTopology}
 */
export function topologyFromStaticData(staticData, snapshot = null, opts = {}) {
  const topo = emptyTopology();
  if (opts.regionSubstrates instanceof Map) {
    topo.regionSubstrates = opts.regionSubstrates;
  }
  if (!staticData?.regions) return topo;

  for (const [name, data] of staticData.regions.entries()) {
    const exitNames = [];
    const neighbours = [];
    for (const exit of data?.exits ?? []) {
      const target = exit?.connected_region;
      const exitName = exit?.name || exit?.exit_name || `${name} -> ${target}`;
      exitNames.push(exitName);
      if (target) neighbours.push({ region: target, exitName });
    }
    topo.regions.set(name, {
      locations: (data?.locations ?? []).map((l) => l?.name).filter(Boolean),
      exits: exitNames,
    });
    topo.adjacency.set(name, neighbours);
  }
  for (const neighbours of [...topo.adjacency.values()]) {
    for (const n of neighbours) {
      if (!topo.adjacency.has(n.region)) topo.adjacency.set(n.region, []);
    }
  }

  if (staticData.locations) {
    for (const [locName, locData] of staticData.locations.entries()) {
      topo.locations.set(locName, {
        region: locData?.parent_region || locData?.region || null,
        id: locData?.id ?? null,
        isEvent: !!staticData.eventLocations?.[locName],
      });
    }
  }

  const startRegions = snapshot?.startRegions || [];
  topo.startRegion = (Array.isArray(startRegions) ? startRegions[0] : null)
    || (topo.regions.size > 0 ? topo.regions.keys().next().value : null);
  return topo;
}

// =========================================================================
// SimulatedState
// =========================================================================

export class SimulatedState {
  constructor(startRegion, maxMana, topology) {
    this.currentMana = maxMana;
    this.maxMana = maxMana;
    this.regionXP = new Map();
    this.exploredRegions = new Set();
    this.discoveredLocations = new Map();
    this.discoveredExits = new Map();
    this.checkedLocations = new Set();
    this.assignedRegionCosts = new Map();
    this.assignedLocationCosts = new Map();

    // Region contents come from the topology, already normalised to names.
    this.regionContents = new Map();
    for (const [name, data] of (topology?.regions ?? new Map()).entries()) {
      this.regionContents.set(name, {
        locations: [...(data.locations || [])],
        exits: [...(data.exits || [])],
      });
    }

    // Start region: cost 0, fully explored
    if (startRegion) {
      this.assignedRegionCosts.set(startRegion, { moveCost: 0 });
      this._markFullyExplored(startRegion);
    }
  }

  _markFullyExplored(regionName) {
    const contents = this.regionContents.get(regionName);
    if (contents) {
      this.discoveredLocations.set(regionName, new Set(contents.locations));
      this.discoveredExits.set(regionName, new Set(contents.exits));
    }
    this.exploredRegions.add(regionName);
  }

  isRegionFullyExplored(regionName) {
    return this.exploredRegions.has(regionName);
  }

  getDiscoveredCount(regionName) {
    const locs = this.discoveredLocations.get(regionName)?.size || 0;
    const exits = this.discoveredExits.get(regionName)?.size || 0;
    return locs + exits;
  }

  getTotalDiscoverables(regionName) {
    const contents = this.regionContents.get(regionName);
    if (!contents) return 0;
    return contents.locations.length + contents.exits.length;
  }

  getUndiscoveredCount(regionName) {
    return this.getTotalDiscoverables(regionName) - this.getDiscoveredCount(regionName);
  }

  /** Discover the next undiscovered location or exit. Returns { type, name } or null. */
  discoverNext(regionName) {
    const contents = this.regionContents.get(regionName);
    if (!contents) return null;

    const discoveredLocs = this.discoveredLocations.get(regionName) || new Set();
    const discoveredExits = this.discoveredExits.get(regionName) || new Set();

    for (const loc of contents.locations) {
      if (!discoveredLocs.has(loc)) {
        discoveredLocs.add(loc);
        this.discoveredLocations.set(regionName, discoveredLocs);
        if (this.getUndiscoveredCount(regionName) === 0) {
          this.exploredRegions.add(regionName);
        }
        return { type: 'location', name: loc };
      }
    }
    for (const exit of contents.exits) {
      if (!discoveredExits.has(exit)) {
        discoveredExits.add(exit);
        this.discoveredExits.set(regionName, discoveredExits);
        if (this.getUndiscoveredCount(regionName) === 0) {
          this.exploredRegions.add(regionName);
        }
        return { type: 'exit', name: exit };
      }
    }
    return null;
  }

  snapshot() {
    return {
      currentMana: this.currentMana,
      maxMana: this.maxMana,
      regionXP: new Map(
        [...this.regionXP.entries()].map(([k, v]) => [k, { ...v }])
      ),
      exploredRegions: new Set(this.exploredRegions),
      discoveredLocations: new Map(
        [...this.discoveredLocations.entries()].map(([k, v]) => [k, new Set(v)])
      ),
      discoveredExits: new Map(
        [...this.discoveredExits.entries()].map(([k, v]) => [k, new Set(v)])
      ),
      checkedLocations: new Set(this.checkedLocations),
      assignedRegionCosts: new Map(
        [...this.assignedRegionCosts.entries()].map(([k, v]) => [k, { ...v }])
      ),
      assignedLocationCosts: new Map(this.assignedLocationCosts),
    };
  }

  resetManaToMax() { this.currentMana = this.maxMana; }
  deductMana(amount) { this.currentMana -= amount; }

  getRegionXP(regionName) {
    return this.regionXP.get(regionName) || { xp: 0, level: 0 };
  }

  addXP(regionName, amount) {
    const current = this.getRegionXP(regionName);
    const newXP = current.xp + amount;
    const newLevel = levelFromXP(newXP);
    this.regionXP.set(regionName, { xp: newXP, level: newLevel });
  }

  getRegionCost(regionName) {
    return this.assignedRegionCosts.get(regionName)?.moveCost ?? null;
  }

  getLocationCost(locationName) {
    return this.assignedLocationCosts.get(locationName) ?? null;
  }
}

// =========================================================================
// CostPlanner
// =========================================================================

export class CostPlanner {
  /**
   * @param {Object} [args]
   * @param {CostTopology} [args.topology]  what to plan against
   * @param {Object} [args.eventBus]        optional; publishes step events
   * @param {string} [args.playerId]        the sphere-log slice to read
   * @param {number} [args.startingMaxMana]
   * @param {number} [args.manaPerItem]
   */
  constructor({
    topology = null,
    eventBus = null,
    playerId = null,
    startingMaxMana = DEFAULT_STARTING_MAX_MANA,
    manaPerItem = DEFAULT_MANA_PER_ITEM,
  } = {}) {
    this.eventBus = eventBus || null;
    this.startingMaxMana = startingMaxMana;
    this.manaPerItem = manaPerItem;

    this._topology = topology || emptyTopology();
    this._simState = null;
    this._entries = [];
    this._plannedSteps = [];
    this._startRegion = null;
    this._isLoaded = false;
    this._sphereLog = null;           // Retained so reset() can re-derive entries

    // State machine
    this._currentEntryIndex = 0;
    this._currentEntry = null;
    this._phase = null;               // 'EXPLORE' or 'CHECK'
    this._currentPath = null;
    this._regionsToExplore = [];
    this._currentExploreRegionIdx = 0;
    this._pendingCostAssignments = []; // Cost assignments for next step's reasoning
    this._defaultsAssigned = false;
    this._skippedEventEntries = 0;    // Count of event locations skipped (auto-collected)
    this._skippedForeignEntries = 0;  // Sphere-log locations absent from THIS player's world
    this._truncated = null;           // { limit, scope } when a plan guard tripped

    // Player-slice diagnostics, filled by _extractLocationEntries
    this._playerId = playerId === null || playerId === undefined
      ? null : String(playerId);
    this._playerIdError = null;
    this._logDiagnostics = null;

    // Verification mode
    this._mode = 'plan';              // 'plan' or 'verify'
    this._loadedCostData = null;      // Cost data to verify against
  }

  /** Replace what the planner plans against. Drops any loaded plan. */
  setTopology(topology) {
    this._topology = topology || emptyTopology();
    this._sphereLog = null;
    this._entries = [];
    this._plannedSteps = [];
    this._isLoaded = false;
    this._simState = null;
    this._startRegion = null;
    this._mode = 'plan';
    this._loadedCostData = null;
  }

  getTopology() { return this._topology; }

  loadSphereLog(sphereLog) {
    this._sphereLog = sphereLog;
    this._entries = this._extractLocationEntries(sphereLog);
    this._mode = 'plan';
    this._loadedCostData = null;
    this._deriveTopology();
    this._resetPlanningState();
    this._isLoaded = true;

    return {
      entryCount: this._entries.length,
      startRegion: this._startRegion,
      playerId: this._playerId,
      playerIdError: this._playerIdError,
      diagnostics: this._logDiagnostics,
    };
  }

  /**
   * Re-read the topology before a (re)plan. A subclass that owns a live source
   * (the debugger's state manager) overrides `_refreshTopology` so `reset()`
   * picks up a rules reload instead of replanning against the previous world.
   * @private
   */
  _deriveTopology() {
    this._refreshTopology();
    this._startRegion = this._topology.startRegion;
  }

  /** Hook: rebuild `this._topology` from whatever the caller owns. */
  // eslint-disable-next-line class-methods-use-this
  _refreshTopology() { /* static topology by default */ }

  /** Hook: which slice of the sphere log to read. */
  _resolvePlayerId() { return this._playerId; }

  /** @private Clear everything the state machine accumulates across a run. */
  _resetPlanningState() {
    this._plannedSteps = [];
    this._currentEntryIndex = 0;
    this._currentEntry = null;
    this._phase = null;
    this._currentPath = null;
    this._regionsToExplore = [];
    this._currentExploreRegionIdx = 0;
    this._pendingCostAssignments = [];
    this._defaultsAssigned = false;
    this._skippedEventEntries = 0;
    this._skippedForeignEntries = 0;
    this._truncated = null;

    this._simState = new SimulatedState(
      this._startRegion, this.startingMaxMana, this._topology);
  }

  /**
   * Load sphere log in verification mode.
   * Uses provided cost data for all mana calculations instead of generating costs.
   * Each step compares loaded costs against what the formula would have assigned.
   * @param {Array} sphereLog - Raw sphere log data
   * @param {Object} costData - Cost data to verify (from costDataManager)
   * @returns {Object} Load result
   */
  loadSphereLogForVerification(sphereLog, costData) {
    const result = this.loadSphereLog(sphereLog);
    this._mode = 'verify';
    this._loadedCostData = costData;

    // In verify mode, pre-load ALL region costs from the cost data into simState
    // so mana calculations use the loaded costs throughout
    if (costData?.regions) {
      for (const [regionName, data] of Object.entries(costData.regions)) {
        if (!this._simState.assignedRegionCosts.has(regionName)) {
          this._simState.assignedRegionCosts.set(regionName, { moveCost: data.moveCost });
        }
      }
    }

    return result;
  }

  /** @returns {'plan'|'verify'} Current operating mode */
  getMode() { return this._mode; }

  /**
   * Plan one action queue (one loop). Returns StepReasoning or null if done.
   */
  planNextStep() {
    if (!this._isLoaded) return null;

    // Start a new sphere entry if needed (skip entries with missing locations/paths)
    while (!this._currentEntry) {
      if (this._currentEntryIndex >= this._entries.length) {
        // All entries done — assign defaults if not yet done (skip in verify mode)
        if (!this._defaultsAssigned) {
          if (this._mode === 'verify') {
            this._defaultsAssigned = true;
            return null;
          }
          return this._planDefaultsStep();
        }
        return null;
      }
      this._beginEntry(this._entries[this._currentEntryIndex]);
    }

    let step;
    if (this._phase === 'EXPLORE') {
      step = this._planExploreLoop();
    } else if (this._phase === 'CHECK') {
      step = this._planCheckLoop();
    }

    if (step) {
      this._plannedSteps.push(step);
      this.eventBus?.publish('loopsCostDebugger:stepPlanned', {
        step,
        stepIndex: step.stepIndex,
      });
    }

    return step;
  }

  /**
   * Plan all remaining steps for the current sphere entry.
   * That means all EXPLORE loops plus the final CHECK loop.
   */
  planCurrentSphere() {
    if (!this._isLoaded || this.isComplete()) return [];

    const newSteps = [];
    const limit = 1000;
    let guard = limit;

    while (guard-- > 0) {
      const step = this.planNextStep();
      if (!step) break;
      newSteps.push(step);
      // CHECK is always the last step for a sphere entry
      if (step.phase === 'CHECK') break;
    }

    if (guard < 0) this._truncated = { limit, scope: 'sphere' };

    return newSteps;
  }

  planAll() {
    const newSteps = [];
    const limit = 10000;
    let guard = limit;
    while (guard-- > 0) {
      const step = this.planNextStep();
      if (!step) break;
      newSteps.push(step);
    }

    if (guard < 0) this._truncated = { limit, scope: 'all' };

    this.eventBus?.publish('loopsCostDebugger:allPlanned', {
      steps: this._plannedSteps,
      total: this._entries.length,
      truncated: this._truncated,
    });

    return newSteps;
  }

  /**
   * Return to the pre-planning state. Re-derives the entries, start region and
   * topology as well: the world may have changed (player switch, rules reload)
   * since the log was loaded, and replanning against the previous world's
   * topology silently produced costs for a game that isn't loaded.
   */
  reset() {
    if (!this._isLoaded) return;

    if (this._sphereLog) {
      this._entries = this._extractLocationEntries(this._sphereLog);
    }
    this._deriveTopology();
    this._resetPlanningState();

    // Re-apply loaded costs in verify mode
    if (this._mode === 'verify' && this._loadedCostData?.regions) {
      for (const [regionName, data] of Object.entries(this._loadedCostData.regions)) {
        if (!this._simState.assignedRegionCosts.has(regionName)) {
          this._simState.assignedRegionCosts.set(regionName, { moveCost: data.moveCost });
        }
      }
      // Reset verify tracking
      this._simState._verifyAssigned = new Set();
    }

    this.eventBus?.publish('loopsCostDebugger:reset', {});
  }

  getPlannedSteps() { return this._plannedSteps; }
  getCurrentStepIndex() { return this._plannedSteps.length; }
  getTotalEntries() { return this._entries.length; }
  getSkippedEventEntries() { return this._skippedEventEntries; }

  /** Sphere-log locations skipped because they are not in this player's world. */
  getSkippedForeignEntries() { return this._skippedForeignEntries; }

  /** Entries that name a location (i.e. excluding the phantom item-only ones). */
  getLocationEntryCount() {
    return this._entries.filter(e => e.locationName).length;
  }

  /** The player id the loaded log was sliced for, or null when unresolved. */
  getPlayerId() { return this._playerId; }

  /**
   * What the last load saw in the log:
   *   { playerId, availablePlayers, stateUpdateCount, matchedCount, error }
   * `error` is set when no player id could be resolved at all.
   */
  getLogDiagnostics() { return this._logDiagnostics; }

  /** { limit, scope } when a planning guard cut the run short, else null. */
  getTruncation() { return this._truncated; }

  /**
   * Why the planned costs must NOT be stamped into the live cost store, or
   * null when the plan is legitimate. A player/seed mismatch otherwise looks
   * exactly like a small world: every location falls through to defaults.
   * @returns {string|null}
   */
  getPlanRejectionReason() {
    if (!this._isLoaded) return 'No sphere log loaded.';

    if (this._playerIdError) return this._playerIdError;

    const d = this._logDiagnostics;
    if (this._entries.length === 0) {
      if (d && d.stateUpdateCount > 0) {
        return `Sphere log has no data for player ${d.playerId} — ` +
          `available players: [${d.availablePlayers.join(', ') || 'none'}]. ` +
          `The loaded rules and the sphere log disagree about which player this is.`;
      }
      return 'Sphere log contained no usable entries.';
    }

    const locationEntries = this.getLocationEntryCount();
    if (locationEntries > 0 && this._skippedForeignEntries >= locationEntries) {
      return `All ${locationEntries} sphere-log locations are missing from this ` +
        `player's world (player ${this._playerId}) — wrong player or wrong seed.`;
    }

    return null;
  }

  isComplete() {
    const entriesDone = this._currentEntryIndex >= this._entries.length && !this._currentEntry;
    return entriesDone && (this._defaultsAssigned || this._mode === 'verify');
  }
  isLoaded() { return this._isLoaded; }
  getSimulatedState() { return this._simState?.snapshot() || null; }

  /**
   * Get aggregate verification statistics across all planned steps.
   * Only meaningful in verify mode.
   */
  getVerificationSummary() {
    if (this._mode !== 'verify') return null;

    const comparisons = [];
    let manaDeficitCount = 0;
    let totalRegionDelta = 0;
    let totalLocationDelta = 0;
    let regionCompareCount = 0;
    let locationCompareCount = 0;

    for (const step of this._plannedSteps) {
      if (step.simulatedResults.manaRemaining < 0) manaDeficitCount++;

      for (const ca of (step.costAssignments || [])) {
        if (!ca.verification) continue;
        const v = ca.verification;
        const absDelta = Math.abs(v.delta);
        const pct = v.simulatedCost > 0 ? (absDelta / v.simulatedCost * 100) : 0;

        comparisons.push({ ...ca, deltaPct: pct });

        if (ca.type === 'region') {
          totalRegionDelta += absDelta;
          regionCompareCount++;
        } else {
          totalLocationDelta += absDelta;
          locationCompareCount++;
        }
      }
    }

    const avgRegionDelta = regionCompareCount > 0 ? totalRegionDelta / regionCompareCount : 0;
    const avgLocationDelta = locationCompareCount > 0 ? totalLocationDelta / locationCompareCount : 0;
    const exactMatches = comparisons.filter(c => c.verification.delta === 0).length;
    const closeMatches = comparisons.filter(c => Math.abs(c.verification.delta) <= 5 && c.verification.delta !== 0).length;
    const farMatches = comparisons.filter(c => Math.abs(c.verification.delta) > 5).length;

    return {
      totalComparisons: comparisons.length,
      exactMatches,
      closeMatches,
      farMatches,
      avgRegionDelta,
      avgLocationDelta,
      manaDeficitCount,
      comparisons,
    };
  }

  /**
   * The planned costs, in the `loop_costs` block's own shape.
   *
   * ⛔ **RAW — no write-by-class rule applied.** Every planned region gets a
   * `moveCost` here, including regions whose substrate runs its own economy.
   * `loopCostGenerator.writeCostsByClass` is what turns this into the block a
   * world actually ships; it is one layer up because it is the only part that
   * needs the substrate registry.
   */
  getCostData() {
    if (!this._simState) return null;
    const costs = {
      version: '1.0',
      generatedAt: new Date().toISOString(),
      generatedFrom: 'loopsCostDebugger',
      regions: {},
      locations: {},
      defaultRegionCost: DEFAULT_REGION_COST,
      defaultLocationCost: DEFAULT_LOCATION_COST,
    };
    for (const [region, data] of this._simState.assignedRegionCosts) {
      costs.regions[region] = { moveCost: data.moveCost };
    }
    for (const [location, cost] of this._simState.assignedLocationCosts) {
      costs.locations[location] = cost;
    }

    // If defaults haven't been assigned via planning yet, do it now
    if (!this._defaultsAssigned) {
      this._assignDefaultCosts(costs);
    }

    return costs;
  }

  /**
   * Assign costs to regions and locations not visited during planning.
   *
   * Regions: BFS flood-fill from costed regions through the adjacency graph.
   * Each uncosted region gets the cost of its nearest costed neighbor.
   *
   * Locations: their containing region's moveCost × DEFAULT_EXPLORE_MULTIPLIER,
   * matching the explore cost ratio. Falls back to defaultRegionCost.
   */
  _assignDefaultCosts(costs) {
    const topo = this._topology;
    if (!topo?.regions) return;

    // --- Assign uncosted regions using highest costed neighbor ---
    if (topo.regions.size > 0) {
      // Build full (bidirectional) neighbor set per region
      const allNeighbors = new Map();
      for (const regionName of topo.regions.keys()) {
        allNeighbors.set(regionName, new Set());
      }
      for (const [regionName, neighbors] of topo.adjacency.entries()) {
        for (const neighbor of neighbors) {
          if (!allNeighbors.has(regionName)) allNeighbors.set(regionName, new Set());
          if (!allNeighbors.has(neighbor.region)) allNeighbors.set(neighbor.region, new Set());
          allNeighbors.get(regionName).add(neighbor.region);
          allNeighbors.get(neighbor.region).add(regionName);
        }
      }

      // Iteratively assign: each pass assigns uncosted regions that have
      // at least one costed neighbor, using the highest neighbor cost.
      // Repeat until no more assignments are made.
      let changed = true;
      while (changed) {
        changed = false;
        for (const regionName of topo.regions.keys()) {
          if (costs.regions[regionName]) continue;

          let highestCost = 0;
          for (const neighborName of (allNeighbors.get(regionName) || [])) {
            const neighborCost = costs.regions[neighborName]?.moveCost;
            if (neighborCost != null && neighborCost > highestCost) {
              highestCost = neighborCost;
            }
          }

          if (highestCost > 0) {
            costs.regions[regionName] = { moveCost: highestCost };
            changed = true;
          }
        }
      }

      // Any remaining disconnected regions get the default
      for (const regionName of topo.regions.keys()) {
        if (!costs.regions[regionName]) {
          costs.regions[regionName] = { moveCost: costs.defaultRegionCost };
        }
      }
    }

    // --- Assign uncosted locations based on their region's cost ---
    for (const [locationName, locData] of topo.locations.entries()) {
      if (costs.locations[locationName] != null) continue;
      // Skip event locations — they are auto-collected for free.
      // ⚠ NOT the same predicate as `_beginEntry`'s auto-collect test, which
      // also excludes id null/0. Both are preserved as they were.
      if (locData.isEvent) continue;

      const regionCost = costs.regions[locData.region]?.moveCost ?? costs.defaultRegionCost;
      // Location cost ~ DEFAULT_EXPLORE_MULTIPLIER × region cost, matching the
      // explore cost ratio.
      costs.locations[locationName] = Math.max(1, regionCost * DEFAULT_EXPLORE_MULTIPLIER);
    }
  }

  // =========================================================================
  // State machine
  // =========================================================================

  _beginEntry(entry) {
    // Phantom entry: no location to check, just apply mana boost from received items
    if (!entry.locationName) {
      if (entry.itemsReceived > 0) {
        this._simState.maxMana += entry.itemsReceived * this.manaPerItem;
        this._simState.resetManaToMax();
      }
      this._currentEntryIndex++;
      return;
    }

    const locationData = this._topology.locations.get(entry.locationName);
    const targetRegion = locationData?.region || null;
    entry._targetRegion = targetRegion;

    if (!targetRegion) {
      // Location not in this game's static data (belongs to another player) — skip
      // but still apply any mana boost from items received. Counted: when this
      // is most or all of the log the plan is worthless, and it used to be
      // indistinguishable from a genuinely small world.
      this._skippedForeignEntries++;
      if (entry.itemsReceived > 0) {
        this._simState.maxMana += entry.itemsReceived * this.manaPerItem;
        this._simState.resetManaToMax();
      }
      this._currentEntryIndex++;
      return;
    }

    // Skip auto-collected locations — event locations (item has event flag) and
    // local item locations (id: null/0, e.g. dungeon prizes, activation spots)
    // are auto-collected for free when their region is accessible, so no action
    // queue is needed. Still update sim state so max mana reflects items received.
    const isAutoCollected = locationData.isEvent
      || locationData.id === null || locationData.id === 0;
    if (isAutoCollected) {
      this._simState.checkedLocations.add(entry.locationName);
      if (entry.itemsReceived > 0) {
        this._simState.maxMana += entry.itemsReceived * this.manaPerItem;
        this._simState.resetManaToMax();
      }
      this._skippedEventEntries++;
      this._currentEntryIndex++;
      return;
    }

    const pathResult = this._findPath(this._startRegion, targetRegion);
    if (!pathResult) {
      this._currentEntryIndex++;
      return;
    }

    this._currentEntry = entry;
    this._currentPath = pathResult;

    // Get non-start regions in path
    const pathRegions = pathResult.steps
      .map(s => s.region)
      .filter(r => r !== this._startRegion);

    // NOTE: Region costs are NOT assigned here. They are assigned just-in-time
    // during each loop, after path traversal costs are deducted, so the formula
    // uses the actual remaining mana rather than max mana.
    this._pendingCostAssignments = [];

    // Identify regions needing exploration (in path order)
    this._regionsToExplore = pathRegions.filter(r =>
      !this._simState.isRegionFullyExplored(r)
    );
    this._currentExploreRegionIdx = 0;

    this._phase = this._regionsToExplore.length > 0 ? 'EXPLORE' : 'CHECK';
  }

  _advanceToNextEntry() {
    this._currentEntryIndex++;
    this._currentEntry = null;
    this._phase = null;
    this._currentPath = null;
    this._regionsToExplore = [];
    this._pendingCostAssignments = [];
  }

  // =========================================================================
  // Explore loop: discover locations/exits in a region
  // =========================================================================

  _planExploreLoop() {
    const entry = this._currentEntry;
    const exploreRegion = this._regionsToExplore[this._currentExploreRegionIdx];
    const stateBefore = this._simState.snapshot();
    const notes = [];
    const costAssignments = [];

    let manaRemaining = this._simState.currentMana;
    const queue = [];
    const xpGained = {};

    // Traverse path to reach the explore region.
    // Move cost = SOURCE region's moveCost (discounted by source's level).
    const pathSteps = this._currentPath.steps;
    const exploreIdx = pathSteps.findIndex(s => s.region === exploreRegion);

    for (let i = 0; i < exploreIdx; i++) {
      const fromRegion = pathSteps[i].region;
      const toRegion = pathSteps[i + 1].region;

      const regionCost = this._simState.getRegionCost(fromRegion) || 0;
      const regionXP = this._simState.getRegionXP(fromRegion);
      const moveCost = proposedLinearFinalCost(regionCost, regionXP.level);

      queue.push({
        type: 'move', from: fromRegion, to: toRegion,
        exitUsed: pathSteps[i + 1].exitUsed,
        baseCost: regionCost, level: regionXP.level, cost: moveCost,
      });
      manaRemaining -= moveCost;

      if (moveCost > 0) {
        const xp = calculateXPGain('regionMove', moveCost);
        xpGained[fromRegion] = (xpGained[fromRegion] || 0) + xp;
        this._simState.addXP(fromRegion, xp);
      }
    }

    // Assign cost to explore region just-in-time (after traversal costs deducted)
    if (this._mode === 'verify') {
      // In verify mode, region cost was pre-loaded. Compute what formula would have assigned.
      // Only compare once per region (first encounter).
      if (!this._simState._verifyAssigned) this._simState._verifyAssigned = new Set();
      if (!this._simState._verifyAssigned.has(exploreRegion)) {
        const loadedCost = this._simState.getRegionCost(exploreRegion) || 0;
        const fullPathRegions = this._currentPath.steps.map(s => s.region);
        const uncostedRemaining = fullPathRegions.filter(r =>
          r !== this._startRegion && !this._simState._verifyAssigned.has(r)
        ).length || 1;
        const simulatedCost = Math.max(1, Math.floor(manaRemaining / 2 / uncostedRemaining));

        this._simState._verifyAssigned.add(exploreRegion);

        costAssignments.push({
          type: 'region', name: exploreRegion,
          cost: loadedCost,
          formula: `loaded: ${loadedCost} (formula would assign: ${simulatedCost})`,
          verification: { loadedCost, simulatedCost, delta: loadedCost - simulatedCost },
        });
      }
    } else if (this._simState.getRegionCost(exploreRegion) === null) {
      // Count uncosted regions remaining in the full path (from here onward)
      const fullPathRegions = this._currentPath.steps.map(s => s.region);
      const uncostedRemaining = fullPathRegions.filter(r =>
        r !== this._startRegion && this._simState.getRegionCost(r) === null
      ).length;

      const cost = Math.max(1, Math.floor(manaRemaining / 2 / uncostedRemaining));
      const formula = `max(1, floor(${fmtNum(manaRemaining)} / 2 / ${uncostedRemaining})) = ${cost}`;

      this._simState.assignedRegionCosts.set(exploreRegion, { moveCost: cost });
      costAssignments.push({ type: 'region', name: exploreRegion, cost, formula });
    }

    // Explore actions until mana runs out
    const discoveries = [];
    const regionCost = this._simState.getRegionCost(exploreRegion) || 10;

    while (manaRemaining > 0 && this._simState.getUndiscoveredCount(exploreRegion) > 0) {
      const regionXP = this._simState.getRegionXP(exploreRegion);
      const exploreCost = proposedLinearFinalCost(
        regionCost * DEFAULT_EXPLORE_MULTIPLIER, regionXP.level);

      if (manaRemaining < exploreCost) {
        notes.push(`Not enough mana for next explore (need ${fmtNum(exploreCost)}, have ${fmtNum(manaRemaining)})`);
        break;
      }

      const discovered = this._simState.discoverNext(exploreRegion);
      if (!discovered) break;

      queue.push({
        type: 'explore', region: exploreRegion,
        discovered,
        baseCost: regionCost * DEFAULT_EXPLORE_MULTIPLIER,
        level: regionXP.level, cost: exploreCost,
      });
      manaRemaining -= exploreCost;
      discoveries.push(discovered);

      const xp = calculateXPGain('customAction', exploreCost);
      xpGained[exploreRegion] = (xpGained[exploreRegion] || 0) + xp;
      this._simState.addXP(exploreRegion, xp);
    }

    if (discoveries.length === 0) {
      notes.push('No explores completed - path traversal consumed all available mana');
    }

    const manaConsumed = stateBefore.currentMana - manaRemaining;

    // Explore progress
    const discoveredCount = this._simState.getDiscoveredCount(exploreRegion);
    const totalDiscoverables = this._simState.getTotalDiscoverables(exploreRegion);

    // Check if region is fully explored
    if (this._simState.isRegionFullyExplored(exploreRegion)) {
      notes.push(`${exploreRegion} fully explored! (${totalDiscoverables}/${totalDiscoverables})`);
      this._currentExploreRegionIdx++;

      if (this._currentExploreRegionIdx >= this._regionsToExplore.length) {
        this._phase = 'CHECK';
        notes.push('All regions in path explored. Ready for location check.');
      }
    } else {
      notes.push(`${exploreRegion}: ${discoveredCount}/${totalDiscoverables} discovered`);
    }

    // Reset mana for next loop
    this._simState.resetManaToMax();

    return {
      stepIndex: this._plannedSteps.length,
      sphereIndex: entry.sphereIndex,
      sphereEntryIndex: this._currentEntryIndex,
      phase: 'EXPLORE',
      mode: this._mode,
      locationName: entry.locationName,
      targetRegion: exploreRegion,
      stateBefore,
      path: {
        from: this._startRegion,
        to: exploreRegion,
        steps: pathSteps.slice(0, exploreIdx + 1),
      },
      costAssignments,
      queue,
      discoveries,
      exploreProgress: {
        discovered: discoveredCount,
        total: totalDiscoverables,
        remaining: totalDiscoverables - discoveredCount,
      },
      simulatedResults: {
        manaConsumed,
        manaRemaining,
        xpGained,
      },
      stateAfter: this._simState.snapshot(),
      notes,
    };
  }

  // =========================================================================
  // Check loop: move to location and check it
  // =========================================================================

  _planCheckLoop() {
    const entry = this._currentEntry;
    const targetRegion = entry._targetRegion;
    const stateBefore = this._simState.snapshot();
    const notes = [];
    const costAssignments = [];

    let manaRemaining = this._simState.currentMana;
    const queue = [];
    const xpGained = {};

    // Traverse path to target region.
    // Move cost = SOURCE region's moveCost.
    const pathSteps = this._currentPath.steps;
    for (let i = 0; i < pathSteps.length - 1; i++) {
      const fromRegion = pathSteps[i].region;
      const toRegion = pathSteps[i + 1].region;

      const regionCost = this._simState.getRegionCost(fromRegion) || 0;
      const regionXP = this._simState.getRegionXP(fromRegion);
      const moveCost = proposedLinearFinalCost(regionCost, regionXP.level);

      queue.push({
        type: 'move', from: fromRegion, to: toRegion,
        exitUsed: pathSteps[i + 1].exitUsed,
        baseCost: regionCost, level: regionXP.level, cost: moveCost,
      });
      manaRemaining -= moveCost;

      if (moveCost > 0) {
        const xp = calculateXPGain('regionMove', moveCost);
        xpGained[fromRegion] = (xpGained[fromRegion] || 0) + xp;
        this._simState.addXP(fromRegion, xp);
      }
    }

    // Assign location cost after traversal
    let locationCost;
    if (this._mode === 'verify') {
      // Use loaded cost, compare against what formula would have assigned
      locationCost = this._loadedCostData?.locations?.[entry.locationName] ?? Math.max(1, Math.floor(manaRemaining));
      const simulatedCost = Math.max(1, Math.floor(manaRemaining));
      this._simState.assignedLocationCosts.set(entry.locationName, locationCost);
      costAssignments.push({
        type: 'location', name: entry.locationName,
        cost: locationCost,
        formula: `loaded: ${locationCost} (formula would assign: ${simulatedCost})`,
        verification: { loadedCost: locationCost, simulatedCost, delta: locationCost - simulatedCost },
      });
    } else {
      locationCost = Math.max(1, Math.floor(manaRemaining));
      const locationFormula = `max(1, floor(${fmtNum(manaRemaining)})) = ${locationCost}`;
      this._simState.assignedLocationCosts.set(entry.locationName, locationCost);
      costAssignments.push({
        type: 'location', name: entry.locationName,
        cost: locationCost, formula: locationFormula,
      });
    }

    // Check location
    const regionXP = this._simState.getRegionXP(targetRegion);
    const checkCost = proposedLinearFinalCost(locationCost, regionXP.level);

    queue.push({
      type: 'locationCheck',
      location: entry.locationName, region: targetRegion,
      baseCost: locationCost, level: regionXP.level, cost: checkCost,
    });
    manaRemaining -= checkCost;

    const locXP = calculateXPGain('locationCheck', checkCost);
    xpGained[targetRegion] = (xpGained[targetRegion] || 0) + locXP;
    this._simState.addXP(targetRegion, locXP);

    const manaConsumed = stateBefore.currentMana - manaRemaining;

    if (manaRemaining < 0) {
      notes.push(`Mana deficit: ${fmtNum(Math.abs(manaRemaining))} (consumed ${fmtNum(manaConsumed)} with ${fmtNum(stateBefore.currentMana)} available)`);
    }

    this._simState.checkedLocations.add(entry.locationName);
    // Mana boost from items received (may be 0 if item went to another player)
    if (entry.itemsReceived > 0) {
      this._simState.maxMana += entry.itemsReceived * this.manaPerItem;
    }
    this._simState.resetManaToMax();

    // Advance to next sphere entry
    this._advanceToNextEntry();

    return {
      stepIndex: this._plannedSteps.length,
      sphereIndex: entry.sphereIndex,
      sphereEntryIndex: this._currentEntryIndex - 1,
      phase: 'CHECK',
      mode: this._mode,
      locationName: entry.locationName,
      targetRegion,
      stateBefore,
      path: {
        from: this._startRegion,
        to: targetRegion,
        steps: pathSteps,
      },
      costAssignments,
      queue,
      simulatedResults: {
        manaConsumed,
        manaRemaining,
        xpGained,
      },
      stateAfter: this._simState.snapshot(),
      notes,
    };
  }

  // =========================================================================
  // Defaults step: assign costs to unvisited regions/locations
  // =========================================================================

  _planDefaultsStep() {
    const stateBefore = this._simState.snapshot();
    const costAssignments = [];

    // Build a temporary costs object with current assignments
    const currentCosts = {
      regions: {}, locations: {},
      defaultRegionCost: DEFAULT_REGION_COST,
      defaultLocationCost: DEFAULT_LOCATION_COST,
    };
    for (const [region, data] of this._simState.assignedRegionCosts) {
      currentCosts.regions[region] = { moveCost: data.moveCost };
    }
    for (const [location, cost] of this._simState.assignedLocationCosts) {
      currentCosts.locations[location] = cost;
    }

    // Run the default assignment logic on the temp object
    this._assignDefaultCosts(currentCosts);

    // Record new region assignments and apply to simState
    for (const [regionName, data] of Object.entries(currentCosts.regions)) {
      if (!this._simState.assignedRegionCosts.has(regionName)) {
        this._simState.assignedRegionCosts.set(regionName, { moveCost: data.moveCost });
        costAssignments.push({
          type: 'region', name: regionName, cost: data.moveCost,
          formula: `highest neighbor cost or default (${currentCosts.defaultRegionCost})`,
        });
      }
    }

    // Assign uncosted locations and apply to simState
    for (const [locationName, locData] of this._topology.locations.entries()) {
      if (this._simState.assignedLocationCosts.has(locationName)) continue;
      // Skip event locations — they are auto-collected for free
      if (locData.isEvent) continue;
      const regionCost = currentCosts.regions[locData.region]?.moveCost
        ?? currentCosts.defaultRegionCost;
      const locationCost = Math.max(1, regionCost * DEFAULT_EXPLORE_MULTIPLIER);
      this._simState.assignedLocationCosts.set(locationName, locationCost);
      costAssignments.push({
        type: 'location', name: locationName, cost: locationCost,
        formula: `region cost (${regionCost}) × ${DEFAULT_EXPLORE_MULTIPLIER}`,
      });
    }

    this._defaultsAssigned = true;

    const notes = [];
    const regionCount = costAssignments.filter(a => a.type === 'region').length;
    const locationCount = costAssignments.filter(a => a.type === 'location').length;
    if (regionCount > 0) notes.push(`Assigned default costs to ${regionCount} unvisited regions`);
    if (locationCount > 0) notes.push(`Assigned default costs to ${locationCount} unvisited locations`);
    if (costAssignments.length === 0) notes.push('All regions and locations already have costs assigned');

    const step = {
      stepIndex: this._plannedSteps.length,
      sphereIndex: null,
      sphereEntryIndex: null,
      phase: 'DEFAULTS',
      locationName: null,
      targetRegion: null,
      stateBefore,
      path: null,
      costAssignments,
      queue: [],
      simulatedResults: { manaConsumed: 0, manaRemaining: 0, xpGained: {} },
      stateAfter: this._simState.snapshot(),
      notes,
    };

    this._plannedSteps.push(step);
    this.eventBus?.publish('loopsCostDebugger:stepPlanned', { step, stepIndex: step.stepIndex });
    return step;
  }

  // =========================================================================
  // Sphere log parsing
  // =========================================================================

  _extractLocationEntries(sphereLog) {
    const entries = [];
    const playerId = this._resolvePlayerId();
    this._playerId = playerId;
    this._playerIdError = null;

    const availablePlayers = new Set();
    let stateUpdateCount = 0;
    let matchedCount = 0;

    if (!playerId) {
      // No '1' fallback: planning the wrong player's slice produces a plausible
      // but wrong cost set instead of an error.
      this._playerIdError =
        'Cannot plan costs: no current player id (sphereState has none and the ' +
        'loaded rules carry no playerId). Load a rules file first.';
      this._logDiagnostics = {
        playerId: null,
        availablePlayers: [],
        stateUpdateCount: 0,
        matchedCount: 0,
        error: this._playerIdError,
      };
      return entries;
    }

    for (const logEntry of sphereLog) {
      if (logEntry.type !== 'state_update') continue;
      stateUpdateCount++;
      for (const key of Object.keys(logEntry.player_data || {})) {
        availablePlayers.add(key);
      }

      const playerData = logEntry.player_data?.[playerId];
      if (!playerData) continue;
      matchedCount++;

      const sphereLocations = playerData.sphere_locations || [];
      const newRegions = playerData.new_accessible_regions || [];

      // Count items received by this player in this sphere (from any source)
      const baseItems = playerData.new_inventory_details?.base_items || {};
      const itemsReceived = Object.values(baseItems).reduce((sum, count) => sum + count, 0);

      for (let i = 0; i < sphereLocations.length; i++) {
        entries.push({
          sphereIndex: logEntry.sphere_index,
          locationName: sphereLocations[i],
          newAccessibleRegions: newRegions,
          // Distribute items received across the locations in this sphere;
          // grant all on the last location so mana boost happens after all checks
          itemsReceived: (i === sphereLocations.length - 1) ? itemsReceived : 0,
        });
      }

      // If this player received items but checked no locations in this sphere
      // (items came from other players), create a phantom entry for the mana boost
      if (sphereLocations.length === 0 && itemsReceived > 0) {
        entries.push({
          sphereIndex: logEntry.sphere_index,
          locationName: null,
          newAccessibleRegions: newRegions,
          itemsReceived,
        });
      }
    }

    this._logDiagnostics = {
      playerId,
      availablePlayers: [...availablePlayers].sort((a, b) => Number(a) - Number(b)),
      stateUpdateCount,
      matchedCount,
      error: null,
    };

    return entries;
  }

  // =========================================================================
  // Pathfinding (simplified BFS on the topology)
  // =========================================================================

  _findPath(from, to) {
    const adjacency = this._topology?.adjacency;
    if (!adjacency) return null;
    if (from === to) {
      return { steps: [{ region: from, exitUsed: null }], length: 0 };
    }

    const queue = [{ region: from, path: [{ region: from, exitUsed: null }] }];
    const visited = new Set([from]);

    while (queue.length > 0) {
      const { region, path } = queue.shift();
      const neighbors = adjacency.get(region) || [];

      for (const neighbor of neighbors) {
        if (visited.has(neighbor.region)) continue;
        visited.add(neighbor.region);

        const newPath = [...path, { region: neighbor.region, exitUsed: neighbor.exitName }];

        if (neighbor.region === to) {
          return { steps: newPath, length: newPath.length - 1 };
        }

        queue.push({ region: neighbor.region, path: newPath });
      }
    }

    return null;
  }
}

function fmtNum(n) {
  if (n === null || n === undefined) return '?';
  return Number(n).toFixed(1);
}

export default CostPlanner;
