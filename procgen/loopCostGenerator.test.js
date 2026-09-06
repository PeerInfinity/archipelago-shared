/**
 * `loopCostGenerator` — the `loop_costs` BLOCK producer.
 *
 * ⚖ Since 2026-09-06 there is ONE cost model (`loopCostPlanner.js`), and this
 * module's job is (a) drive it over a rules.json-derived topology and (b) apply
 * the WRITE-BY-CLASS rule. Every number below was DERIVED by running the model,
 * with the derivation written out beside it — the old generator's own algorithm
 * (a maxMana/2 split across a BFS path) is gone, and so are its numbers.
 *
 * ⛓ That the pipeline's block and the RUNTIME planner's plan are the same bytes
 * is not asserted here — it is `scripts/procgen/check-loop-costs-one-model.mjs`,
 * over five real documents.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    generateLoopCosts,
    classifyRegion,
    classifyRegions,
    writeCostsByClass,
    topologyFromRulesJson,
    topologyFromStaticData,
    regionSubstratesFromRulesJson,
    REGION_CLASS,
    DEFAULT_REGION_COST,
    DEFAULT_LOCATION_COST,
    DEFAULT_TIME_DRAIN_PER_SECOND,
    _internal,
} from './loopCostGenerator.js';
import { substrateRegistry } from './substrateRegistry.js';

function makeRules(regions, startRegion) {
    return {
        regions: { '1': regions },
        start_regions: { '1': { default: [startRegion] } },
    };
}

function stateUpdate(sphereIndex, sphereLocations, itemsReceived = 0) {
    return {
        type: 'state_update',
        sphere_index: sphereIndex,
        player_data: {
            '1': {
                sphere_locations: sphereLocations,
                new_inventory_details: itemsReceived > 0
                    ? { base_items: { 'Item': itemsReceived } }
                    : { base_items: {} },
            },
        },
    };
}

/** A location the planner will actually queue (a null/0 id is auto-collected). */
const loc = (name) => ({ name, id: 1000 });

describe('loopCostGenerator — the block shape', () => {
    it('produces cost data with the canonical shape', () => {
        const rules = makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: { exits: [], locations: [loc('Loc1')] },
        }, 'Menu');
        const sphereLog = [stateUpdate(0, ['Loc1'])];

        const costs = generateLoopCosts({ rulesJson: rules, sphereLog });

        expect(costs.version).toBe('1.0');
        expect(costs.regions).toBeDefined();
        expect(costs.locations).toBeDefined();
        expect(costs.defaultRegionCost).toBe(DEFAULT_REGION_COST);
        expect(costs.defaultLocationCost).toBe(DEFAULT_LOCATION_COST);
        expect(costs.regions.Menu.moveCost).toBe(0); // start region is free
    });

    it('start region always has moveCost 0', () => {
        const rules = makeRules({
            Start: { exits: [], locations: [] },
        }, 'Start');
        const costs = generateLoopCosts({ rulesJson: rules, sphereLog: [] });
        expect(costs.regions.Start).toEqual({ moveCost: 0, xpEffect: 'cost' });
    });
});

describe('loopCostGenerator — the planner\'s numbers', () => {
    it('prices a chain just-in-time, after the traversal to each region is paid', () => {
        // Path: Menu → A → B → C, target = Loc in C. The model assigns a
        // region's moveCost when the walk FIRST needs it, out of the mana left
        // after getting there, split across the uncosted regions still ahead:
        //   max(1, floor(manaRemaining / 2 / uncostedRemaining))
        // and then explores at 2× that cost until the budget is gone. So each
        // later region is priced out of a budget the earlier ones have already
        // eaten into — the point of the model (⚖ "what the player can afford by
        // the time they get there"), and the reason a flat maxMana/2 split gave
        // a different answer for every region past the first.
        const rules = makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: { exits: [{ name: 'to_b', connected_region: 'B' }], locations: [] },
            B: { exits: [{ name: 'to_c', connected_region: 'C' }], locations: [] },
            C: { exits: [], locations: [loc('Loc')] },
        }, 'Menu');
        const sphereLog = [stateUpdate(0, ['Loc'])];

        const costs = generateLoopCosts({ rulesJson: rules, sphereLog });

        expect(costs.regions.A.moveCost).toBe(16);
        expect(costs.regions.B.moveCost).toBe(21);
        expect(costs.regions.C.moveCost).toBe(31);
        expect(costs.locations.Loc).toBe(63);
    });

    it('prices a location at what is left when the walk arrives', () => {
        // Menu (free) → A. A is priced 50 = floor(100/2/1); its single explore
        // costs 2×50 and empties the loop. The CHECK loop starts fresh at 100,
        // the move out of Menu is free, so the location is floor(100) = 100.
        const rules = makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: { exits: [], locations: [loc('Loc')] },
        }, 'Menu');
        const sphereLog = [stateUpdate(0, ['Loc'])];

        const costs = generateLoopCosts({ rulesJson: rules, sphereLog });
        expect(costs.regions.A.moveCost).toBe(50);
        expect(costs.locations.Loc).toBe(100);
    });

    it('clamps a region cost to a minimum of 1', () => {
        // startingMaxMana = 1 → floor(1/2/1) = 0, clamped to 1. The location
        // then prices at floor(1 × 2) = 2 through the defaults fill, because a
        // 1-mana loop cannot pay the 2-mana explore that would reach it.
        const rules = makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: { exits: [], locations: [loc('Loc')] },
        }, 'Menu');
        const sphereLog = [stateUpdate(0, ['Loc'])];
        const costs = generateLoopCosts({ rulesJson: rules, sphereLog, startingMaxMana: 1 });
        expect(costs.regions.A.moveCost).toBe(1);
        expect(costs.locations.Loc).toBe(2);
    });

    it('items received in a sphere bump maxMana for the next iteration', () => {
        const rules = makeRules({
            Menu: {
                exits: [
                    { name: 'to_a', connected_region: 'A' },
                    { name: 'to_b', connected_region: 'B' },
                ],
                locations: [],
            },
            A: { exits: [], locations: [loc('Loc1')] },
            B: { exits: [], locations: [loc('Loc2')] },
        }, 'Menu');
        const sphereLog = [
            stateUpdate(0, ['Loc1'], 3), // 3 items received → maxMana += 30
            stateUpdate(1, ['Loc2']),
        ];
        const costs = generateLoopCosts({ rulesJson: rules, sphereLog });

        // Sphere 0: maxMana 100 → A 50, Loc1 = floor(100)
        expect(costs.regions.A.moveCost).toBe(50);
        expect(costs.locations.Loc1).toBe(100);
        // Sphere 1: maxMana 130 → B = floor(130/2) = 65, Loc2 = floor(130)
        expect(costs.regions.B.moveCost).toBe(65);
        expect(costs.locations.Loc2).toBe(130);
    });

    it('phantom entries (no location, just items) still boost maxMana', () => {
        const rules = makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: { exits: [], locations: [loc('Loc')] },
        }, 'Menu');
        const sphereLog = [
            stateUpdate(0, [], 5), // phantom: 5 items, no locations
            stateUpdate(1, ['Loc']),
        ];
        const costs = generateLoopCosts({ rulesJson: rules, sphereLog });

        // After the phantom: maxMana 150 → A = floor(150/2) = 75, Loc = 150
        expect(costs.regions.A.moveCost).toBe(75);
        expect(costs.locations.Loc).toBe(150);
    });
});

describe('loopCostGenerator — defaults for what the sphere log never reached', () => {
    it('uncovered regions flood-fill from their highest costed neighbour', () => {
        const rules = makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: {
                exits: [
                    { name: 'to_b', connected_region: 'B' },
                    { name: 'to_orphan', connected_region: 'Orphan' },
                ],
                locations: [loc('Loc')],
            },
            B: { exits: [], locations: [] },
            Orphan: { exits: [], locations: [] }, // never visited in sphere log
        }, 'Menu');
        const sphereLog = [stateUpdate(0, ['Loc'])];

        const costs = generateLoopCosts({ rulesJson: rules, sphereLog });
        // Orphan is uncovered. Its only neighbour (A) has a moveCost.
        expect(costs.regions.Orphan.moveCost).toBe(costs.regions.A.moveCost);
    });

    it('uncovered regions with no costed neighbours get defaultRegionCost', () => {
        const rules = makeRules({
            Menu: { exits: [], locations: [] },
            Orphan: { exits: [], locations: [] }, // disconnected
        }, 'Menu');
        const costs = generateLoopCosts({ rulesJson: rules, sphereLog: [] });
        expect(costs.regions.Orphan.moveCost).toBe(DEFAULT_REGION_COST);
    });

    it('uncovered locations are priced at their region cost × the explore multiplier', () => {
        const rules = makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: { exits: [], locations: [loc('Visited'), loc('Unvisited')] },
        }, 'Menu');
        const sphereLog = [stateUpdate(0, ['Visited'])];
        const costs = generateLoopCosts({ rulesJson: rules, sphereLog });
        // A costs 50, so an unvisited location in it is 50 × 2.
        expect(costs.regions.A.moveCost).toBe(50);
        expect(costs.locations.Unvisited).toBe(100);
    });
});

describe('loopCostGenerator — regionXpEffect option', () => {
    it("defaults to 'cost' on every region entry and at the block root", () => {
        const rules = makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: { exits: [], locations: [loc('Loc')] },
        }, 'Menu');
        const costs = generateLoopCosts({ rulesJson: rules, sphereLog: [] });
        expect(costs.defaultRegionXpEffect).toBe('cost');
        for (const entry of Object.values(costs.regions)) {
            expect(entry.xpEffect).toBe('cost');
        }
    });

    it('stamps the supplied effect on every region', () => {
        const rules = makeRules({
            Menu: {
                exits: [
                    { name: 'to_a', connected_region: 'A' },
                    { name: 'to_b', connected_region: 'B' },
                ],
                locations: [],
            },
            A: { exits: [], locations: [loc('Loc1')] },
            B: { exits: [], locations: [] },
        }, 'Menu');
        const sphereLog = [stateUpdate(0, ['Loc1'])];
        const costs = generateLoopCosts({
            rulesJson: rules,
            sphereLog,
            regionXpEffect: 'none',
        });
        expect(costs.defaultRegionXpEffect).toBe('none');
        // Path-assigned region (A) and default-filled region (B)
        // both pick up the effect.
        expect(costs.regions.A.xpEffect).toBe('none');
        expect(costs.regions.B.xpEffect).toBe('none');
        expect(costs.regions.Menu.xpEffect).toBe('none');
    });

    it('falls back to default when given an unknown effect', () => {
        const rules = makeRules({
            Menu: { exits: [], locations: [] },
        }, 'Menu');
        const costs = generateLoopCosts({
            rulesJson: rules,
            sphereLog: [],
            regionXpEffect: 'wibble',
        });
        expect(costs.defaultRegionXpEffect).toBe('cost');
        expect(costs.regions.Menu.xpEffect).toBe('cost');
    });
});

describe('loopCostGenerator — error handling', () => {
    it('throws when rulesJson is missing', () => {
        expect(() => generateLoopCosts({ sphereLog: [] })).toThrow();
    });
    it('throws when sphereLog is not an array', () => {
        expect(() => generateLoopCosts({ rulesJson: makeRules({ Menu: {} }, 'Menu'), sphereLog: 'nope' })).toThrow();
    });
    it('throws when no regions exist for the player', () => {
        expect(() => generateLoopCosts({ rulesJson: { regions: {} }, sphereLog: [] })).toThrow();
    });
});

describe('loopCostGenerator — the topology adapters', () => {
    const RULES = {
        ...makeRules({
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: {
                exits: [{ name: 'to_b', connected_region: 'B' }],
                locations: [
                    { name: 'Chest', id: 7 },
                    { name: 'Prize', id: null },
                    { name: 'Flag', id: 9, item: { name: 'EventItem' } },
                ],
            },
            B: { exits: [], locations: [] },
        }, 'Menu'),
        items: { '1': { EventItem: { name: 'EventItem', event: true } } },
        preset_sidecars: { '1': { A: { substrate: 'maze' } } },
    };

    it('reads regions, exits, adjacency and the start region out of a rules.json', () => {
        const topo = topologyFromRulesJson(RULES, '1');
        expect(topo.startRegion).toBe('Menu');
        expect([...topo.regions.keys()].sort()).toEqual(['A', 'B', 'Menu']);
        expect(topo.regions.get('A').locations).toEqual(['Chest', 'Prize', 'Flag']);
        expect(topo.regions.get('Menu').exits).toEqual(['to_a']);
        expect(topo.adjacency.get('Menu')).toEqual([{ region: 'A', exitName: 'to_a' }]);
        expect(topo.adjacency.get('B')).toEqual([]);
    });

    it('carries each location\'s region, id and EVENT flag — three things the walk reads', () => {
        // The event flag lives on the ITEM, not the location: the state manager
        // derives `eventLocations` from `items[player][name].event === true`, so
        // the rules.json adapter derives it the same way or the two paths would
        // classify a location differently.
        const topo = topologyFromRulesJson(RULES, '1');
        expect(topo.locations.get('Chest')).toEqual({ region: 'A', id: 7, isEvent: false });
        expect(topo.locations.get('Prize')).toEqual({ region: 'A', id: null, isEvent: false });
        expect(topo.locations.get('Flag')).toEqual({ region: 'A', id: 9, isEvent: true });
    });

    it('reads the region → substrate map out of preset_sidecars', () => {
        expect([...regionSubstratesFromRulesJson(RULES, '1')]).toEqual([['A', 'maze']]);
        expect(regionSubstratesFromRulesJson({}, '1').size).toBe(0);
    });

    it('builds the SAME shape from a state manager\'s static data', () => {
        const staticData = {
            regions: new Map([
                ['Menu', { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] }],
                ['A', { exits: [], locations: [{ name: 'Chest' }] }],
            ]),
            locations: new Map([['Chest', { region: 'A', id: 7 }]]),
            eventLocations: {},
        };
        const topo = topologyFromStaticData(staticData, { startRegions: ['Menu'] });
        expect(topo.startRegion).toBe('Menu');
        expect(topo.regions.get('A').locations).toEqual(['Chest']);
        expect(topo.adjacency.get('Menu')).toEqual([{ region: 'A', exitName: 'to_a' }]);
        expect(topo.locations.get('Chest')).toEqual({ region: 'A', id: 7, isEvent: false });
        // Static data carries no preset_sidecars, so the caller supplies them —
        // and an absent map means every region is coarse.
        expect(topo.regionSubstrates.size).toBe(0);
        const withSubs = topologyFromStaticData(staticData, null,
            { regionSubstrates: new Map([['A', 'maze']]) });
        expect(withSubs.regionSubstrates.get('A')).toBe('maze');
    });
});

describe('loopCostGenerator — WRITE BY CLASS (⚖ i, user 2026-09-06)', () => {
    // Each fixture below mirrors a REAL registry declaration, measured off the
    // substrate's own library file. The classification is the only thing that
    // decides whether a region's simulated numbers reach the block at all.
    function reg(id, extra) {
        substrateRegistry.register({
            id, label: id, panelComponentType: 'p', loadRegionEvent: `${id}:load`,
            ...extra,
        });
    }
    const registerSummary = (id = 'summary_sub') =>
        reg(id, { loopSupport: { manual: true, summaryRecording: true } });
    /** jta / omsi: a recorder AND a shared-mana declaration, no delegation. */
    const registerNative = (id = 'native_sub') =>
        reg(id, { takeLastRecording: () => null, sharing: { mana: {} } });
    /** maze: a recorder AND shared mana, but it DELEGATES the loop action. */
    const registerDelegating = (id = 'maze_like') =>
        reg(id, { takeLastRecording: () => null, sharing: { mana: { loopActionDelegation: true } } });
    /** text_adventure: shared mana, NO recorder. */
    const registerTextLike = (id = 'ta_like') => reg(id, { sharing: { mana: {} } });

    beforeEach(() => { substrateRegistry.clear?.(); });
    afterEach(() => { substrateRegistry.clear?.(); });

    describe('classifyRegion', () => {
        it('no substrate at all ⇒ COARSE', () => {
            expect(classifyRegion(null)).toBe(REGION_CLASS.COARSE);
        });

        it('an UNREGISTERED substrate ⇒ COARSE (the safe direction)', () => {
            // A headless run that never imported the libraries must not silently
            // zero out every cost.
            expect(classifyRegion('never_registered')).toBe(REGION_CLASS.COARSE);
        });

        it('summaryRecording ⇒ SUMMARY (runner, bounce)', () => {
            registerSummary();
            expect(classifyRegion('summary_sub')).toBe(REGION_CLASS.SUMMARY);
        });

        it('a recorder + shared mana ⇒ NATIVE (jta, omsi)', () => {
            registerNative();
            expect(classifyRegion('native_sub')).toBe(REGION_CLASS.NATIVE);
        });

        it('⚠ a recorder + shared mana + loopActionDelegation ⇒ COARSE, not NATIVE (maze)', () => {
            // maze DOES declare sharing.mana, so "a recorder that is a mana
            // declarer" would sweep it into NATIVE and delete every maze region's
            // moveCost — which is the number `mazeRoomUI._perTileMoveCost`
            // divides by `longestShortestPath`. The delegation flag is what
            // separates "charges its own pool" from "hands the action back".
            registerDelegating();
            expect(classifyRegion('maze_like')).toBe(REGION_CLASS.COARSE);
        });

        it('⚠ shared mana WITHOUT a recorder ⇒ COARSE (text_adventure)', () => {
            // isManaDeclarer('text_adventure') is TRUE, and text adventure prices
            // its three coarse actions straight out of the block. The recorder
            // test is what excludes it.
            registerTextLike();
            expect(classifyRegion('ta_like')).toBe(REGION_CLASS.COARSE);
        });
    });

    describe('the block a class produces', () => {
        const RULES = {
            Menu: { exits: [{ name: 'to_a', connected_region: 'A' }], locations: [] },
            A: {
                exits: [{ name: 'to_b', connected_region: 'B' }],
                locations: [loc('Loc1')],
            },
            B: { exits: [], locations: [loc('Loc2')] },
        };
        const withSidecars = (sidecars) => ({
            ...makeRules(RULES, 'Menu'),
            preset_sidecars: { '1': sidecars },
        });
        const LOG = [stateUpdate(0, ['Loc1']), stateUpdate(1, ['Loc2'])];

        it('SUMMARY: a drain rate and NOTHING else — no moveCost, no location costs', () => {
            // ⛔ THE MUTANT ROW. A build that writes a `moveCost` onto a summary
            // region reds here: a per-action cost would be charged ON TOP of the
            // time drain (M5, user 2026-07-23).
            registerSummary();
            registerTextLike();
            const costs = generateLoopCosts({
                rulesJson: withSidecars({
                    A: { substrate: 'summary_sub' },
                    B: { substrate: 'ta_like' },
                }),
                sphereLog: LOG,
            });

            expect(costs.regions.A.timeDrainPerSecond).toBe(DEFAULT_TIME_DRAIN_PER_SECOND);
            expect(costs.regions.A.moveCost).toBeUndefined();
            expect(costs.locations.Loc1).toBeUndefined();

            // The coarse region beside it is costed exactly as before.
            expect(typeof costs.regions.B.moveCost).toBe('number');
            expect(typeof costs.locations.Loc2).toBe('number');
        });

        it('SUMMARY: an EXPLICIT cost in the INPUT block is passed through verbatim', () => {
            registerSummary();
            const rules = withSidecars({ A: { substrate: 'summary_sub' } });
            rules.loop_costs = {
                regions: { A: { moveCost: 7, timeDrainPerSecond: 3 } },
                locations: { Loc1: 11 },
            };
            const costs = generateLoopCosts({ rulesJson: rules, sphereLog: LOG });
            expect(costs.regions.A.moveCost).toBe(7);
            expect(costs.regions.A.timeDrainPerSecond).toBe(3);
            expect(costs.locations.Loc1).toBe(11);
        });

        it('NATIVE: no region entry and no location entries at all (jta, omsi)', () => {
            registerNative();
            const costs = generateLoopCosts({
                rulesJson: withSidecars({ A: { substrate: 'native_sub' } }),
                sphereLog: LOG,
            });
            expect(costs.regions.A).toBeUndefined();
            expect(costs.locations.Loc1).toBeUndefined();
            // The coarse sibling still gets its numbers.
            expect(typeof costs.regions.B.moveCost).toBe('number');
            expect(typeof costs.locations.Loc2).toBe('number');
        });

        it('DELEGATING (maze): full coarse numbers — the runtime divides them per tile', () => {
            registerDelegating();
            const costs = generateLoopCosts({
                rulesJson: withSidecars({ A: { substrate: 'maze_like' } }),
                sphereLog: LOG,
            });
            expect(typeof costs.regions.A.moveCost).toBe('number');
            expect(costs.regions.A.moveCost).toBeGreaterThan(0);
            expect(typeof costs.locations.Loc1).toBe('number');
        });

        it('time-prices a summary START region, but a NATIVE start region still gets moveCost 0', () => {
            // The start region's 0 is a RULE, not a price — the HOST's queue reads
            // it for the first regionMove out of the start — so it survives the
            // native class. A summary start region keeps the drain, as before.
            registerSummary();
            registerNative();
            const summaryStart = generateLoopCosts({
                rulesJson: withSidecars({ Menu: { substrate: 'summary_sub' } }),
                sphereLog: LOG,
            });
            expect(summaryStart.regions.Menu.timeDrainPerSecond).toBe(DEFAULT_TIME_DRAIN_PER_SECOND);
            expect(summaryStart.regions.Menu.moveCost).toBeUndefined();

            const nativeStart = generateLoopCosts({
                rulesJson: withSidecars({ Menu: { substrate: 'native_sub' } }),
                sphereLog: LOG,
            });
            expect(nativeStart.regions.Menu).toEqual({ moveCost: 0, xpEffect: 'cost' });
        });

        it('is inert without preset sidecars', () => {
            registerSummary();
            const costs = generateLoopCosts({
                rulesJson: makeRules(RULES, 'Menu'),
                sphereLog: LOG,
            });
            expect(typeof costs.regions.A.moveCost).toBe('number');
        });

        it('classifyRegions covers every region the topology knows', () => {
            registerNative();
            const topo = topologyFromRulesJson(
                withSidecars({ A: { substrate: 'native_sub' } }), '1');
            const classes = classifyRegions(topo);
            expect([...classes.keys()].sort()).toEqual(['A', 'B', 'Menu']);
            expect(classes.get('A')).toBe(REGION_CLASS.NATIVE);
            expect(classes.get('B')).toBe(REGION_CLASS.COARSE);
        });

        it('writeCostsByClass falls back to defaultRegionCost for a coarse region the plan missed', () => {
            const topo = topologyFromRulesJson(makeRules(RULES, 'Menu'), '1');
            const out = writeCostsByClass(
                { regions: {}, locations: {}, defaultRegionCost: DEFAULT_REGION_COST },
                {
                    topology: topo,
                    regionClasses: classifyRegions(topo),
                    xpEffect: 'cost',
                });
            expect(out.regions.A).toEqual({ moveCost: DEFAULT_REGION_COST, xpEffect: 'cost' });
            expect(out.regions.Menu).toEqual({ moveCost: 0, xpEffect: 'cost' });
        });
    });
});

describe('loopCostGenerator — _internal', () => {
    it('exposes the classification pieces the block rests on', () => {
        expect(Object.keys(_internal).sort()).toEqual([
            'classifyRegion', 'classifyRegions', 'normalizeRegionXpEffect',
            'resolveStartRegion', 'writeCostsByClass',
        ]);
    });

    it('resolveStartRegion prefers the declared start, then the first region', () => {
        const { resolveStartRegion } = _internal;
        const regions = { Menu: {}, A: {} };
        expect(resolveStartRegion({ start_regions: { 1: { default: ['A'] } } }, regions, '1')).toBe('A');
        expect(resolveStartRegion({ start_regions: { 1: ['A'] } }, regions, '1')).toBe('A');
        // A declared region that does not exist falls back rather than lying.
        expect(resolveStartRegion({ start_regions: { 1: { default: ['Nope'] } } }, regions, '1')).toBe('Menu');
        expect(resolveStartRegion({}, {}, '1')).toBeNull();
    });
});
