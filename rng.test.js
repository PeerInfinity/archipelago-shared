import { describe, it, expect } from 'vitest';

import { createRng } from './rng.js';

describe('createRng getState/setState', () => {
    it('two streams with the same seed share the same initial state', () => {
        expect(createRng(1).getState()).toBe(createRng(1).getState());
        expect(createRng(1).getState()).not.toBe(createRng(2).getState());
    });

    it('restoring a snapshot reproduces the exact subsequent sequence', () => {
        const a = createRng(42);
        // Advance a few draws, then snapshot mid-stream.
        a.next(); a.next(); a.next();
        const snapshot = a.getState();
        const tail = [a.next(), a.next(), a.next(), a.next()];

        // A fresh stream restored to the snapshot must reproduce the tail.
        const b = createRng(0);
        b.setState(snapshot);
        expect([b.next(), b.next(), b.next(), b.next()]).toEqual(tail);
    });

    it('getState reflects state advancing as the stream is consumed', () => {
        const r = createRng(7);
        const s0 = r.getState();
        r.next();
        const s1 = r.getState();
        expect(s1).not.toBe(s0);
    });

    it('setState round-trips through JSON (serialisable across processes)', () => {
        const a = createRng(123);
        a.shuffle([1, 2, 3, 4, 5]); // consume an arbitrary amount
        const serialised = JSON.stringify({ s: a.getState() });

        const b = createRng(0);
        b.setState(JSON.parse(serialised).s);
        // Both streams now diverge identically.
        expect(b.next()).toBe(a.next());
        expect(b.randint(0, 1000)).toBe(a.randint(0, 1000));
    });

    it('setState coerces to a 32-bit integer (matches the seed coercion)', () => {
        const r = createRng(0);
        r.setState(1.9);          // truncates via | 0
        const viaFloat = r.getState();
        r.setState(1);
        expect(viaFloat).toBe(r.getState());
    });
});
