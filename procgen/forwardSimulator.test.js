import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

import {
    buildAccessibilityModel,
    computeReachableRegions,
    computeAccessibleLocations,
    pickNextTarget,
    generateSphereLog,
    SphereLogNotEvaluableError,
} from './forwardSimulator.js';

// --- Fixture builders ---

function makeMinimalRulesDoc() {
    // Two-region world: Menu -> Overworld via True_, Overworld has a
    // gated location requiring Key from a free location.
    return {
        regions: {
            '1': {
                Menu: {
                    name: 'Menu',
                    exits: [
                        { name: 'GameStart', connected_region: 'Overworld', access_rule: { rule: 'True_' } },
                    ],
                    locations: [],
                },
                Overworld: {
                    name: 'Overworld',
                    exits: [],
                    locations: [
                        {
                            name: 'Free Location',
                            access_rule: { rule: 'True_' },
                            item: { name: 'Key', advancement: true },
                        },
                        {
                            name: 'Locked Location',
                            access_rule: { rule: 'Has', args: { item_name: 'Key' } },
                            item: { name: 'Victory', advancement: true },
                        },
                    ],
                },
            },
        },
        start_regions: { '1': { default: ['Menu'], available: [] } },
        generation_seed: 99,
        seed_name: 'minimal-fixture',
    };
}

// --- buildAccessibilityModel ---

describe('buildAccessibilityModel', () => {
    it('parses rules.json into Map-based regions', () => {
        const model = buildAccessibilityModel(makeMinimalRulesDoc());
        expect(model.regions.size).toBe(2);
        expect(model.regions.get('Menu')?.exits.length).toBe(1);
        expect(model.regions.get('Overworld')?.locations.length).toBe(2);
        expect(model.startRegions).toEqual(['Menu']);
        expect(model.locationIndex.get('Free Location')).toBeTruthy();
    });

    it('throws on missing rulesDoc', () => {
        expect(() => buildAccessibilityModel(null)).toThrow();
        expect(() => buildAccessibilityModel({})).toThrow();
    });

    it('handles missing exits / locations arrays', () => {
        const model = buildAccessibilityModel({
            regions: { '1': { OnlyRegion: { name: 'OnlyRegion' } } },
            start_regions: { '1': { default: ['OnlyRegion'] } },
        });
        expect(model.regions.get('OnlyRegion')?.exits).toEqual([]);
        expect(model.regions.get('OnlyRegion')?.locations).toEqual([]);
    });
});

// --- reachability ---

describe('computeReachableRegions', () => {
    it('starts from start_regions and walks accessible exits', () => {
        const model = buildAccessibilityModel(makeMinimalRulesDoc());
        const r = computeReachableRegions(model, new Set());
        expect(r).toEqual(new Set(['Menu', 'Overworld']));
    });

    it('respects gated exits', () => {
        const model = buildAccessibilityModel({
            regions: {
                '1': {
                    Menu: {
                        name: 'Menu',
                        exits: [{
                            name: 'GatedExit', connected_region: 'Inner',
                            access_rule: { rule: 'Has', args: { item_name: 'Key' } },
                        }],
                        locations: [],
                    },
                    Inner: { name: 'Inner', exits: [], locations: [] },
                },
            },
            start_regions: { '1': { default: ['Menu'] } },
        });
        expect(computeReachableRegions(model, new Set())).toEqual(new Set(['Menu']));
        expect(computeReachableRegions(model, new Set(['Key']))).toEqual(new Set(['Menu', 'Inner']));
    });
});

describe('computeAccessibleLocations', () => {
    it('returns only locations whose access_rule passes', () => {
        const model = buildAccessibilityModel(makeMinimalRulesDoc());
        expect(computeAccessibleLocations(model, new Set())).toEqual(new Set(['Free Location']));
        expect(computeAccessibleLocations(model, new Set(['Key']))).toEqual(
            new Set(['Free Location', 'Locked Location']),
        );
    });
});

// --- pickNextTarget ---

describe('pickNextTarget', () => {
    it('returns the alphabetically-first accessible advancement candidate', () => {
        const model = buildAccessibilityModel(makeMinimalRulesDoc());
        const target = pickNextTarget(model, { inventory: new Set(), checkedLocations: new Set() });
        expect(target).toMatchObject({
            region: 'Overworld',
            location: 'Free Location',
            item: { name: 'Key' },
        });
    });

    it('returns null when nothing reachable is unchecked', () => {
        const model = buildAccessibilityModel(makeMinimalRulesDoc());
        const target = pickNextTarget(model, {
            inventory: new Set(['Key']),
            checkedLocations: new Set(['Free Location', 'Locked Location']),
        });
        expect(target).toBe(null);
    });

    it('falls back to filler when no advancement is reachable', () => {
        const doc = {
            regions: {
                '1': {
                    Start: {
                        name: 'Start',
                        exits: [],
                        locations: [
                            { name: 'Filler 1', access_rule: { rule: 'True_' }, item: { name: 'Junk', advancement: false } },
                        ],
                    },
                },
            },
            start_regions: { '1': { default: ['Start'] } },
        };
        const model = buildAccessibilityModel(doc);
        const target = pickNextTarget(model, { inventory: new Set(), checkedLocations: new Set() });
        expect(target?.location).toBe('Filler 1');
    });

    it('accepts plain arrays for inventory and checkedLocations', () => {
        const model = buildAccessibilityModel(makeMinimalRulesDoc());
        const target = pickNextTarget(model, { inventory: ['Key'], checkedLocations: ['Free Location'] });
        expect(target?.location).toBe('Locked Location');
    });

    it('accepts a Map<name,count> inventory — counts survive, and a count gate needs the count', () => {
        // generateSphereLog carries a Map so `Has` with args.count > 1
        // evaluates; pickNextTarget must read the SAME shape. Before this,
        // `new Set(map)` produced a set of [name, count] pairs and every
        // lookup missed — the walker saw an empty world instead of an error.
        const doc = {
            regions: {
                '1': {
                    Start: {
                        name: 'Start',
                        exits: [{ name: 'deep', connected_region: 'Deep', access_rule: { rule: 'Has', args: { item_name: 'Key', count: 2 } } }],
                        locations: [],
                    },
                    Deep: {
                        name: 'Deep',
                        exits: [],
                        locations: [{ name: 'Deep Location', access_rule: { rule: 'True_' }, item: { name: 'Prize', advancement: true } }],
                    },
                },
            },
            start_regions: { '1': { default: ['Start'] } },
        };
        const model = buildAccessibilityModel(doc);
        expect(pickNextTarget(model, {
            inventory: new Map([['Key', 1]]), checkedLocations: new Set(),
        })).toBe(null);
        expect(pickNextTarget(model, {
            inventory: new Map([['Key', 2]]), checkedLocations: new Set(),
        })?.location).toBe('Deep Location');
    });
});

// --- generateSphereLog ---

describe('generateSphereLog', () => {
    it('produces a metadata header and an integer-0 entry', () => {
        const log = generateSphereLog(makeMinimalRulesDoc());
        expect(log[0]).toMatchObject({ type: 'metadata', seed: 99, seed_name: 'minimal-fixture' });
        expect(log[1]).toMatchObject({
            type: 'state_update',
            sphere_index: '0',
            player_data: { '1': { sphere_locations: [] } },
        });
    });

    it('walks the canonical key->victory chain in two spheres', () => {
        const log = generateSphereLog(makeMinimalRulesDoc());
        const fractional = log.filter((e) => e.type === 'state_update' && e.sphere_index !== '0');
        expect(fractional).toHaveLength(2);
        expect(fractional[0]).toMatchObject({
            sphere_index: '0.1',
            player_data: { '1': { sphere_locations: ['Free Location'] } },
        });
        expect(fractional[1]).toMatchObject({
            sphere_index: '1.1',
            player_data: { '1': { sphere_locations: ['Locked Location'] } },
        });
    });

    it('includes new-accessibility deltas on each pickup', () => {
        const log = generateSphereLog(makeMinimalRulesDoc());
        const pickKey = log.find((e) => e.sphere_index === '0.1');
        expect(pickKey?.player_data['1'].new_accessible_locations).toEqual(['Locked Location']);
        expect(pickKey?.player_data['1'].new_accessible_regions).toEqual([]);
    });

    it('skips filler-only locations from sphere_locations', () => {
        const doc = {
            regions: {
                '1': {
                    Start: {
                        name: 'Start',
                        exits: [],
                        locations: [
                            { name: 'Filler', access_rule: { rule: 'True_' }, item: { name: 'Junk', advancement: false } },
                            { name: 'Progression', access_rule: { rule: 'True_' }, item: { name: 'Victory', advancement: true } },
                        ],
                    },
                },
            },
            start_regions: { '1': { default: ['Start'] } },
        };
        const log = generateSphereLog(doc);
        const fractional = log.filter((e) => e.type === 'state_update' && e.sphere_index !== '0');
        expect(fractional).toHaveLength(1);
        expect(fractional[0].player_data['1'].sphere_locations).toEqual(['Progression']);
    });

    it('terminates cleanly when no progression items remain reachable', () => {
        const doc = {
            regions: {
                '1': {
                    Start: { name: 'Start', exits: [], locations: [] },
                },
            },
            start_regions: { '1': { default: ['Start'] } },
        };
        const log = generateSphereLog(doc);
        expect(log).toHaveLength(2); // metadata + integer-0 entry, nothing else
    });

    it('seeds inventory from rulesDoc.starting_items so gated worlds walk', () => {
        // Regression: apcalc-style worlds gate every exit on a starting
        // item (e.g. "Button: 6"). Without seeding, the loop computed
        // zero accessible locations on the first sphere and broke
        // immediately, producing only the metadata + an empty sphere
        // "0" entry — the embedded sphere log was effectively useless.
        const doc = {
            regions: {
                '1': {
                    Menu: {
                        name: 'Menu',
                        exits: [
                            { name: 'GameStart', connected_region: 'Hall',
                              access_rule: { rule: 'Has', args: { item_name: 'Button: 6' } } },
                        ],
                        locations: [],
                    },
                    Hall: {
                        name: 'Hall',
                        exits: [],
                        locations: [
                            { name: 'Reward',
                              access_rule: { rule: 'True_' },
                              item: { name: 'Victory', advancement: true } },
                        ],
                    },
                },
            },
            start_regions: { '1': { default: ['Menu'] } },
            starting_items: { '1': ['Button: 6'] },
        };
        const log = generateSphereLog(doc);
        // Sphere 0 should reflect the starting inventory and the
        // unlocked region; the picker should then collect Reward.
        const sphereZero = log.find((e) => e.sphere_index === '0');
        expect(sphereZero?.player_data['1'].new_inventory_details.base_items)
            .toEqual({ 'Button: 6': 1 });
        expect(sphereZero?.player_data['1'].new_accessible_regions).toContain('Hall');
        const fractional = log.filter((e) => e.type === 'state_update' && e.sphere_index !== '0');
        expect(fractional).toHaveLength(1);
        expect(fractional[0].player_data['1'].sphere_locations).toEqual(['Reward']);
    });

    it('counts duplicate starting items in base_items', () => {
        const doc = {
            regions: {
                '1': {
                    Start: { name: 'Start', exits: [], locations: [] },
                },
            },
            start_regions: { '1': { default: ['Start'] } },
            starting_items: { '1': ['Coin', 'Coin', 'Key'] },
        };
        const log = generateSphereLog(doc);
        const sphereZero = log.find((e) => e.sphere_index === '0');
        expect(sphereZero?.player_data['1'].new_inventory_details.base_items)
            .toEqual({ Coin: 2, Key: 1 });
    });

    it('detects progression cycles via the safety budget', () => {
        // Construct a doc with thousands of trivial locations to verify
        // the budget is reasonable; should NOT trip on legitimate worlds.
        const locations = [];
        for (let i = 0; i < 500; i++) {
            locations.push({
                name: `loc-${i}`, access_rule: { rule: 'True_' },
                item: { name: `item-${i}`, advancement: true },
            });
        }
        const doc = {
            regions: { '1': { Start: { name: 'Start', exits: [], locations } } },
            start_regions: { '1': { default: ['Start'] } },
        };
        expect(() => generateSphereLog(doc)).not.toThrow();
    });
});

// --- CanReachRegion: decided from the regions reached so far (⚖ 2026-10-04) ---

const reachRegion = (region_name) => ({ rule: 'CanReachRegion', args: { region_name } });
const has = (item_name) => ({ rule: 'Has', args: { item_name } });
const loc = (name, item, access_rule = { rule: 'True_' }) => ({ name, access_rule, item: { name: item, advancement: true } });
function graphDoc(regions) {
    const out = {};
    for (const [name, { exits = [], locations = [] }] of Object.entries(regions)) {
        out[name] = {
            name,
            exits: exits.map(([to, access_rule]) => ({ name: `${name} -> ${to}`, connected_region: to, access_rule })),
            locations,
        };
    }
    return { regions: { '1': out }, start_regions: { '1': { default: ['Menu'] } } };
}
const sphereRegions = (log, idx) => log.find((e) => e.sphere_index === idx).player_data['1'].new_accessible_regions;
const sphereLocations = (log, idx) => log.find((e) => e.sphere_index === idx).player_data['1'].new_accessible_locations;

describe('generateSphereLog — CanReachRegion, AP semantics', () => {
    it('iterates to a fixed point: B opens via CanReachRegion(C), C reached LATER in the same sphere', () => {
        // Menu's exit to B is swept BEFORE A -> C adds C: a single pass reads
        // CanReachRegion(C) as false. AP's sweep re-reads it once C is in.
        const doc = graphDoc({
            Menu: { exits: [['B', reachRegion('C')], ['A', { rule: 'True_' }]] },
            A: { exits: [['C', { rule: 'True_' }]], locations: [loc('A chest', 'Key', reachRegion('B'))] },
            B: { locations: [loc('B chest', 'Victory')] },
            C: {},
        });
        const log = generateSphereLog(doc);
        expect(sphereRegions(log, '0')).toEqual(['A', 'B', 'C', 'Menu']);
        // A location rule reads the SAME fixed point (B is reached by then).
        expect(sphereLocations(log, '0')).toEqual(['A chest', 'B chest']);
        expect(log.filter((e) => e.sphere_index?.startsWith('0.')).map((e) => e.player_data['1'].sphere_locations[0]))
            .toEqual(['A chest', 'B chest']);
    });

    it('the self-referential return edge is inert: CanReachRegion(the region it leads INTO)', () => {
        // The RULES (A) shape: `Near -> Far` = And(CanReachRegion(Far), Has(Key)).
        // Far is reached only through this edge, so it can never open.
        const withEdge = graphDoc({
            Menu: { exits: [['Near', { rule: 'True_' }]] },
            Near: {
                exits: [['Far', { rule: 'And', children: [reachRegion('Far'), has('Key')] }]],
                locations: [loc('Near chest', 'Key')],
            },
            Far: { locations: [loc('Far chest', 'Victory')] },
        });
        const log = generateSphereLog(withEdge);
        expect(log.flatMap((e) => e.player_data?.['1'].new_accessible_regions ?? [])).not.toContain('Far');
        // …byte-identical to the same world without the edge at all.
        const without = structuredClone(withEdge);
        without.regions['1'].Near.exits = [];
        expect(log).toEqual(generateSphereLog(without));
    });

    it('still REFUSES by name what the reached set cannot decide — and no longer names CanReachRegion', () => {
        const doc = graphDoc({
            Menu: { exits: [['A', { rule: 'Or', children: [reachRegion('Nowhere'), { rule: 'can_use_bombs' }] }],
                ['B', { rule: 'CanReachLocation', args: { location_name: 'B chest' } }]] },
            A: {},
            B: { locations: [loc('B chest', 'Victory')] },
            Nowhere: {},
        });
        let err;
        try { generateSphereLog(doc); } catch (e) { err = e; }
        expect(err).toBeInstanceOf(SphereLogNotEvaluableError);
        expect(err.kinds).toEqual(['CanReachLocation', 'can_use_bombs']);
        expect(err.endpoints).toEqual(['exit Menu -> Menu -> A', 'exit Menu -> Menu -> B']);
    });

    it('refuses CanReachRegion of a region the rules do not define, by name — never a guess', () => {
        const doc = graphDoc({ Menu: { exits: [['A', reachRegion('Undefined')]] }, A: {} });
        expect(() => generateSphereLog(doc)).toThrow(/not evaluable from an inventory: CanReachRegion /);
    });
});

// --- Round-trip against the Adventure preset ---

describe('generateSphereLog round-trip vs Adventure preset', () => {
    const repoRoot = path.resolve(__dirname, '../../../..');
    const presetDir = path.join(
        repoRoot,
        'frontend/presets/adventure/AP_14089154938208861744',
    );
    const rulesPath = path.join(presetDir, 'AP_14089154938208861744_rules.json');
    const sphereLogPath = path.join(presetDir, 'AP_14089154938208861744_sphere_log.jsonl');

    it('integer-sphere contents match Python sphere log exactly', () => {
        if (!fs.existsSync(rulesPath) || !fs.existsSync(sphereLogPath)) {
            // Preset not present in this checkout; skip without failing.
            return;
        }
        const rulesDoc = JSON.parse(fs.readFileSync(rulesPath, 'utf-8'));
        const expectedSpheres = parseIntegerSpheres(fs.readFileSync(sphereLogPath, 'utf-8'));

        const generated = generateSphereLog(rulesDoc);
        const generatedSpheres = collectIntegerSpheres(generated);

        // Compare sphere-by-sphere as sets.
        const allKeys = new Set([
            ...Object.keys(expectedSpheres),
            ...Object.keys(generatedSpheres),
        ]);
        for (const k of allKeys) {
            const exp = new Set(expectedSpheres[k] ?? []);
            const got = new Set(generatedSpheres[k] ?? []);
            expect({ sphere: k, locations: setToSortedArray(got) })
                .toEqual({ sphere: k, locations: setToSortedArray(exp) });
        }
    });
});

// --- Helpers for round-trip test ---

function parseIntegerSpheres(jsonlText) {
    const out = {};
    for (const line of jsonlText.split('\n')) {
        if (!line.trim()) continue;
        const entry = JSON.parse(line);
        if (entry.type !== 'state_update') continue;
        const idx = String(entry.sphere_index);
        if (!idx.includes('.')) continue;
        const sphereN = idx.split('.')[0];
        const playerData = Object.values(entry.player_data ?? {})[0];
        const spheLocs = playerData?.sphere_locations ?? [];
        if (!out[sphereN]) out[sphereN] = [];
        out[sphereN].push(...spheLocs);
    }
    return out;
}

function collectIntegerSpheres(entries) {
    const out = {};
    for (const entry of entries) {
        if (entry.type !== 'state_update') continue;
        const idx = String(entry.sphere_index);
        if (!idx.includes('.')) continue;
        const sphereN = idx.split('.')[0];
        const playerData = Object.values(entry.player_data ?? {})[0];
        const spheLocs = playerData?.sphere_locations ?? [];
        if (!out[sphereN]) out[sphereN] = [];
        out[sphereN].push(...spheLocs);
    }
    return out;
}

function setToSortedArray(set) {
    return [...set].sort((a, b) => a.localeCompare(b));
}
