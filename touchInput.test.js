/**
 * touchInput pure core — pointer-id tracking, multi-touch flag
 * semantics, zone resolution order, override/media visibility.
 * (The DOM binder is exercised by the game pages' Playwright
 * hasTouch verifications, not here — node environment.)
 */

import { describe, it, expect } from 'vitest';
import {
    createTouchTracker,
    resolveTouchOverride,
    shouldShowTouchControls,
} from './touchInput.js';

// runner-shaped zones: corner drop button FIRST (small zones before
// full-panel zones — first hitTest match wins), whole panel = jump
const dropZone = {
    id: 'drop', flag: 'drop',
    hitTest: (nx, ny) => nx > 0.8 && ny > 0.75,
};
const jumpZone = {
    id: 'jump', flag: 'jump',
    hitTest: () => true,
};
const ZONES = [dropZone, jumpZone];

describe('createTouchTracker', () => {
    it('press edge sets the flag; release clears it', () => {
        const t = createTouchTracker(ZONES, {});
        expect(t.down(1, 0.4, 0.4)).toBe(jumpZone);
        expect(t.flags.jump).toBe(true);
        expect(t.flags.drop).toBe(false);
        t.up(1);
        expect(t.flags.jump).toBe(false);
    });

    it('resolves overlapping zones by order (button over panel)', () => {
        const t = createTouchTracker(ZONES, {});
        expect(t.down(1, 0.9, 0.9)).toBe(dropZone);
        expect(t.flags.drop).toBe(true);
        expect(t.flags.jump).toBe(false);
    });

    it('multi-touch: jump + drop held by different pointers, released independently', () => {
        const t = createTouchTracker(ZONES, {});
        t.down(1, 0.3, 0.3);   // thumb 1: jump
        t.down(2, 0.95, 0.95); // thumb 2: drop
        expect(t.flags).toEqual({ drop: true, jump: true });
        t.up(1);
        expect(t.flags).toEqual({ drop: true, jump: false });
        t.up(2);
        expect(t.flags).toEqual({ drop: false, jump: false });
    });

    it('two pointers on one zone: the flag holds until BOTH release', () => {
        const t = createTouchTracker(ZONES, {});
        t.down(1, 0.2, 0.2);
        t.down(2, 0.6, 0.6);
        t.up(1);
        expect(t.flags.jump).toBe(true);
        t.up(2);
        expect(t.flags.jump).toBe(false);
    });

    it('pointercancel behaves like release; misses and stray ups are no-ops', () => {
        const t = createTouchTracker(ZONES, {});
        t.down(7, 0.5, 0.5);
        expect(t.cancel(7)).toBe(jumpZone);
        expect(t.flags.jump).toBe(false);
        expect(t.up(99)).toBe(null); // never down
        const only = createTouchTracker([dropZone], {});
        expect(only.down(1, 0.1, 0.1)).toBe(null); // outside every zone
        expect(only.flags.drop).toBe(false);
        expect(only.activeCount()).toBe(0);
    });

    it('shares the caller flags object (the page keys/input object)', () => {
        const keys = { left: false, right: false };
        const t = createTouchTracker([
            { id: 'l', flag: 'left', hitTest: (nx) => nx < 0.5 },
            { id: 'r', flag: 'right', hitTest: (nx) => nx >= 0.5 },
        ], keys);
        t.down(1, 0.8, 0.5);
        expect(keys.right).toBe(true);
        expect(t.flags).toBe(keys);
    });
});

describe('visibility', () => {
    it('resolveTouchOverride parses the touch URL param', () => {
        expect(resolveTouchOverride('')).toBe(null);
        expect(resolveTouchOverride('?foo=1')).toBe(null);
        expect(resolveTouchOverride('?touch=1')).toBe(true);
        expect(resolveTouchOverride('?touch=true')).toBe(true);
        expect(resolveTouchOverride('?touch')).toBe(true);
        expect(resolveTouchOverride('?touch=0')).toBe(false);
        expect(resolveTouchOverride('?touch=false')).toBe(false);
    });

    it('shouldShowTouchControls: override wins, else coarse pointer, else off', () => {
        const coarse = (q) => ({ matches: q === '(pointer: coarse)' });
        const fine = () => ({ matches: false });
        expect(shouldShowTouchControls({ override: true, matchMediaFn: fine })).toBe(true);
        expect(shouldShowTouchControls({ override: false, matchMediaFn: coarse })).toBe(false);
        expect(shouldShowTouchControls({ override: null, matchMediaFn: coarse })).toBe(true);
        expect(shouldShowTouchControls({ override: null, matchMediaFn: fine })).toBe(false);
        expect(shouldShowTouchControls({})).toBe(false); // no DOM at all
    });
});
