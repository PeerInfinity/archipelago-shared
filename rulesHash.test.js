import { describe, it, expect, beforeEach } from 'vitest';

import { hashRulesData, clearRulesHashCache } from './rulesHash.js';

describe('hashRulesData', () => {
    beforeEach(() => clearRulesHashCache());

    it('returns null for null/undefined', () => {
        expect(hashRulesData(null)).toBeNull();
        expect(hashRulesData(undefined)).toBeNull();
    });

    it('returns an 8-char lowercase hex string', () => {
        const hash = hashRulesData({ foo: 'bar' });
        expect(hash).toMatch(/^[0-9a-f]{8}$/);
    });

    it('returns the same hash for the same object reference (cache hit)', () => {
        const data = { foo: 'bar' };
        const h1 = hashRulesData(data);
        const h2 = hashRulesData(data);
        expect(h1).toBe(h2);
    });

    it('returns the same hash for equivalent but distinct objects', () => {
        // Object-identity cache misses, but the stringification matches.
        const h1 = hashRulesData({ foo: 'bar', n: 1 });
        const h2 = hashRulesData({ foo: 'bar', n: 1 });
        expect(h1).toBe(h2);
    });

    it('returns different hashes for distinguishable rule sets', () => {
        const h1 = hashRulesData({ regions: { 1: ['A'] } });
        const h2 = hashRulesData({ regions: { 1: ['B'] } });
        expect(h1).not.toBe(h2);
    });

    it('clearRulesHashCache forces a recompute on next call', () => {
        const data = { foo: 'bar' };
        const h1 = hashRulesData(data);
        clearRulesHashCache();
        // Same input → same hash, but cache miss means we re-stringify.
        const h2 = hashRulesData(data);
        expect(h2).toBe(h1);
    });
});
