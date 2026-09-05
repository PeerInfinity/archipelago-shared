import { describe, it, expect } from 'vitest';

import {
    spatialCore,
    itemBasedPlacer,
    ruleGatePlacer,
    tileGridPathExtractor,
    tileGridDeserializer,
    tileGridSerializer,
} from './adapterPrimitives.js';
import {
    generateRegionCore,
    placeFromItems,
    placeFromRules,
    extractPathsAndObstacles,
    deserializeMazeWorld,
} from '../../mazeRoom/mazeRoomEngine.js';
import { serializeMazeWorld } from '../../mazeRoom/mazeSerializer.js';

// The adapter-primitives catalog is the substrate-neutral surface
// that registry entries compose from. Confirming each export resolves
// to the right underlying implementation guards against silent
// renames or wiring mistakes — substrates depend on these handles
// staying stable, and the registry-by-id dispatch in the procgen
// pipeline trusts the catalog to mean what it says.

describe('adapterPrimitives', () => {
    it('exposes spatialCore as the maze generateRegionCore', () => {
        expect(spatialCore).toBe(generateRegionCore);
    });

    it('exposes itemBasedPlacer as the maze placeFromItems', () => {
        expect(itemBasedPlacer).toBe(placeFromItems);
    });

    it('exposes ruleGatePlacer as the maze placeFromRules', () => {
        expect(ruleGatePlacer).toBe(placeFromRules);
    });

    it('exposes tileGridPathExtractor as the maze extractPathsAndObstacles', () => {
        expect(tileGridPathExtractor).toBe(extractPathsAndObstacles);
    });

    it('exposes tileGridDeserializer as the maze deserializeMazeWorld', () => {
        expect(tileGridDeserializer).toBe(deserializeMazeWorld);
    });

    it('exposes tileGridSerializer as the maze serializeMazeWorld', () => {
        expect(tileGridSerializer).toBe(serializeMazeWorld);
    });

    /**
     * ⛓ H3b. The pairing is the point: `tileGridSerializer` and
     * `tileGridDeserializer` are exact inverses, and until 2026-09-05 this
     * catalog took them from two DIFFERENT modules in two different repos'
     * worth of layering — the serializer from `procgenPipeline/`, the
     * deserializer from `mazeRoom/`. A row that only checks each handle
     * against its own import cannot see that split reappear, because a
     * re-pointed import would move both sides of its own assertion. This row
     * reads the SPECIFIER out of the source instead.
     */
    it('⛔ both halves of the round trip come from the same module', async () => {
        const { readFileSync } = await import('node:fs');
        const { fileURLToPath } = await import('node:url');
        const src = readFileSync(fileURLToPath(new URL('./adapterPrimitives.js', import.meta.url)), 'utf8');
        const specs = [...src.matchAll(/^\s*(?:import|export)\b[^'"]*from\s*['"]([^'"]+)['"]/gm)]
            .map((m) => m[1]);
        expect(specs.length, 'the scan found no specifiers — it lost its subject').toBeGreaterThan(0);
        expect(specs.some((sp) => sp.includes('procgenPipeline/')),
            `adapterPrimitives.js reaches into the pipeline: ${specs.join(', ')}`).toBe(false);
        expect(specs).toContain('../../mazeRoom/mazeSerializer.js');
        expect(specs).toContain('../../mazeRoom/mazeRoomEngine.js');
    });
});
