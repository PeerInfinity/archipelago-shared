// Package tests for the shared actionQueue format (maze-lab arms, slice Q-a).
//
// The package had ZERO tests before this slice; every row below pins one of
// the ten format changes named in NewDocs/plans/maze-lab-arms-plan.md §23.1.
import { describe, it, expect, vi } from 'vitest';
import { ActionQueue } from './actionQueue.js';
import {
    ACTION_QUEUE_FORMAT,
    ActionState,
    assertEntry,
    normalizeEntry,
    validateEntry,
} from './actionTypes.js';

const move = (dir, extra = {}) => ({
    actionType: 'move', actionId: dir, substrate: 'maze', loops: 1, ...extra,
});

describe('normalizeEntry — the ONE field list (A2)', () => {
    it('keeps an unknown key as a param instead of dropping it', () => {
        const e = normalizeEntry({ actionType: 'clickTask', actionId: 'Wander', loopsType: 'actions' });
        expect(e.params).toEqual({ loopsType: 'actions' });
        expect(e.loopsType).toBeUndefined();
    });

    it('merges explicit params with folded riders', () => {
        const e = normalizeEntry({ actionType: 'x', params: { a: 1 }, zoneId: 3 });
        expect(e.params).toEqual({ a: 1, zoneId: 3 });
    });

    it('mints an id only when asked (A1)', () => {
        expect(normalizeEntry({ actionType: 'x' }).entryId).toBeUndefined();
        expect(normalizeEntry({ actionType: 'x' }, { mintId: true }).entryId).toMatch(/^aq_/);
    });

    it('KEEPS an id that is already there — a legacy stored entry still loads', () => {
        const legacy = { entryId: 'aq_1700000000000_7', actionType: 'useItem', actionId: 3, label: 'Food', loops: 2, disabled: false };
        expect(normalizeEntry(legacy, { mintId: true }).entryId).toBe('aq_1700000000000_7');
        expect(normalizeEntry(legacy).label).toBe('Food');
    });

    it('defaults loops and disabled, and nulls a missing actionId', () => {
        expect(normalizeEntry({ actionType: 'wait' })).toEqual({
            actionType: 'wait', actionId: null, loops: 1, disabled: false,
        });
    });
});

describe('params are key-sorted, so identical content is byte-identical (A3)', () => {
    it('serializes two orderings the same', () => {
        const a = new ActionQueue();
        const b = new ActionQueue();
        a.add({ actionType: 'x', params: { b: 1, a: 2 } });
        b.add({ actionType: 'x', params: { a: 2, b: 1 } });
        const strip = (q) => JSON.stringify(q.serialize({ ids: false }));
        expect(strip(a)).toBe(strip(b));
    });

    it('puts the declared fields in a FIXED order regardless of input order', () => {
        const one = normalizeEntry({ disabled: false, loops: 2, actionId: 'N', actionType: 'move', substrate: 'maze' });
        const two = normalizeEntry({ substrate: 'maze', actionType: 'move', actionId: 'N', loops: 2, disabled: false });
        expect(JSON.stringify(one)).toBe(JSON.stringify(two));
        expect(Object.keys(one)).toEqual(['substrate', 'actionType', 'actionId', 'loops', 'disabled']);
    });
});

describe('substrate is optional and carried (A4)', () => {
    it('an entry without one is legal', () => {
        expect(validateEntry(normalizeEntry({ actionType: 'move' }))).toBeNull();
    });
    it('a stamped one survives the queue', () => {
        const q = new ActionQueue();
        q.add(move('N'));
        expect(q.getEntries()[0].substrate).toBe('maze');
    });
});

describe('the serialization envelope (A5)', () => {
    it('serialize tags the format', () => {
        const q = new ActionQueue();
        q.add(move('N'));
        expect(q.serialize().format).toBe(ACTION_QUEUE_FORMAT);
    });

    it('serialize({ids:false}) drops entry ids; the default keeps them', () => {
        const q = new ActionQueue();
        q.add(move('N'));
        expect(q.serialize().entries[0].entryId).toMatch(/^aq_/);
        expect(q.serialize({ ids: false }).entries[0].entryId).toBeUndefined();
    });

    it('accepts a legacy bare {entries} as actionQueue/1', () => {
        const q = new ActionQueue();
        q.deserialize({ entries: [{ actionType: 'move', actionId: 'N', loops: 1, disabled: false }] });
        expect(q.length).toBe(1);
    });

    it('REFUSES an unknown format, naming what it got and what it wants', () => {
        const q = new ActionQueue();
        expect(() => q.deserialize({ format: 'mazeQueue/3', entries: [] }))
            .toThrow(/unknown format 'mazeQueue\/3'.*expected 'actionQueue\/1'/);
    });

    it('round-trips through serialize → deserialize → serialize byte-identically', () => {
        const q = new ActionQueue();
        q.add(move('N', { params: { z: 1, a: 2 } }));
        q.add({ actionType: 'wait', loops: 3, substrate: 'maze' });
        const first = q.serialize();
        const q2 = new ActionQueue();
        q2.deserialize(first);
        expect(JSON.stringify(q2.serialize())).toBe(JSON.stringify(first));
    });
});

describe('assertEntry refuses by field name (A6)', () => {
    const cases = [
        ['actionType', { actionType: 3, loops: 1, disabled: false }, /actionType must be a non-empty string \(got number 3\)/],
        ['actionType empty', { actionType: '', loops: 1, disabled: false }, /actionType must be a non-empty string/],
        ['loops', { actionType: 'move', loops: 1.5, disabled: false }, /loops must be an integer >= 0 when present \(got number 1.5\)/],
        ['loops negative', { actionType: 'move', loops: -1, disabled: false }, /loops must be an integer >= 0 when present/],
        ['disabled', { actionType: 'move', loops: 1, disabled: 'no' }, /disabled must be a boolean when present/],
        ['params', { actionType: 'move', loops: 1, disabled: false, params: [1] }, /params must be a plain object/],
        ['substrate', { actionType: 'move', loops: 1, disabled: false, substrate: 7 }, /substrate must be a string/],
        ['entryId', { actionType: 'move', loops: 1, disabled: false, entryId: 7 }, /entryId must be a string/],
        ['label', { actionType: 'move', loops: 1, disabled: false, label: 7 }, /label must be a string/],
        ['group', { actionType: 'move', loops: 1, disabled: false, group: 7 }, /group must be a string/],
        ['not an object', 'nope', /entry must be a plain object/],
    ];
    for (const [name, entry, re] of cases) {
        it(`refuses a bad ${name}`, () => {
            expect(() => assertEntry(entry)).toThrow(re);
            expect(validateEntry(entry)).toMatch(re);
        });
    }

    it('allows loops: 0 — omsi records a 0-rep plan entry deliberately', () => {
        expect(validateEntry({ actionType: 'clickTask', loops: 0, disabled: false })).toBeNull();
    });

    it('an ABSENT loops / disabled is legal — a raw recording omits them and the defaults fill in', () => {
        expect(validateEntry({ actionType: 'useItem', actionId: 1 })).toBeNull();
        expect(normalizeEntry({ actionType: 'useItem', actionId: 1 }))
            .toMatchObject({ loops: 1, disabled: false });
    });

    it('add and deserialize both refuse', () => {
        const q = new ActionQueue();
        expect(() => q.add({ actionId: 'N' })).toThrow(/ActionQueue.add: actionType/);
        expect(() => q.deserialize({ entries: [{ actionId: 'N' }] })).toThrow(/ActionQueue.deserialize: actionType/);
    });
});

describe('cursor maintenance (A7)', () => {
    const three = () => {
        const q = new ActionQueue();
        q.add(move('N')); q.add(move('E')); q.add(move('S'));
        return q;
    };

    it('add REFUSES an insert into the done region, by name', () => {
        const q = three();
        q.advance(); q.advance(); // cursor 2
        expect(() => q.add(move('W'), 1))
            .toThrow(/atIndex 1 is inside the done region \(cursor 2\)/);
    });

    it('add AT the cursor is legal and becomes the next entry to run', () => {
        const q = three();
        q.advance(); // cursor 1, currently 'E'
        q.add(move('W'), 1);
        expect(q.cursor).toBe(1);
        expect(q.currentEntry().actionId).toBe('W');
    });

    it('add past the cursor leaves the cursor on the same entry', () => {
        const q = three();
        q.advance();
        const before = q.currentEntry();
        q.add(move('W'), 3);
        expect(q.currentEntry()).toBe(before);
    });

    it('reorder REFUSES a move across the cursor, by name', () => {
        const q = three();
        q.advance(); // cursor 1
        expect(() => q.reorder(2, 0)).toThrow(/crosses the done region \(cursor 1\)/);
        expect(() => q.reorder(0, 2)).toThrow(/crosses the done region \(cursor 1\)/);
    });

    it('reorder among pending entries keeps the cursor on the same entry', () => {
        const q = three();
        q.add(move('W'));
        q.advance(); // cursor 1 → 'E'
        const current = q.currentEntry();
        q.reorder(2, 3);
        expect(q.cursor).toBe(1);
        expect(q.currentEntry()).toBe(current);
    });

    it('remove keeps its cursor adjustment', () => {
        const q = three();
        q.advance(); q.advance(); // cursor 2 → 'S'
        const current = q.currentEntry();
        q.remove(q.getEntries()[0].entryId);
        expect(q.cursor).toBe(1);
        expect(q.currentEntry()).toBe(current);
    });

    it('removeAt is sugar over remove', () => {
        const q = three();
        expect(q.removeAt(1)).toBe(true);
        expect(q.getEntries().map(e => e.actionId)).toEqual(['N', 'S']);
        expect(q.removeAt(9)).toBe(false);
    });
});

describe('undo keeps riders and toggles', () => {
    it("an omsi rider survives add → undoLast → undoLast → serialize", () => {
        const q = new ActionQueue();
        q.add({ actionType: 'clickTask', actionId: 'Wander', loopsType: 'actions', loops: 2 });
        q.add({ actionType: 'clickTask', actionId: 'Smash Pots' });
        q.undoLast();
        q.undoLast();
        const entries = q.serialize({ ids: false }).entries;
        expect(entries).toHaveLength(2);
        expect(entries[0].params).toEqual({ loopsType: 'actions' });
    });

    it('undoLast toggles', () => {
        const q = new ActionQueue();
        q.add(move('N'));
        q.add(move('E'));
        expect(q.length).toBe(2);
        q.undoLast();
        expect(q.length).toBe(1);
        q.undoLast();
        expect(q.length).toBe(2);
    });
});

describe('the LIVE-queue surface (A10)', () => {
    it('subscribe fires once per mutation', () => {
        const q = new ActionQueue();
        const seen = vi.fn();
        const off = q.subscribe(seen);
        q.add(move('N'));                                   // 1
        q.add(move('E'));                                   // 2
        q.updateEntry(q.getEntries()[0].entryId, { loops: 2 }); // 3
        q.reorder(0, 1);                                    // 4
        q.removeAt(1);                                      // 5
        q.advance();                                        // 6
        q.reset();                                          // 7
        q.clear();                                          // 8
        expect(seen).toHaveBeenCalledTimes(8);
        off();
        q.add(move('S'));
        expect(seen).toHaveBeenCalledTimes(8);
    });

    it('stepOne is ONE emit even though it touches status twice and advances', () => {
        const q = new ActionQueue();
        q.add(move('N'));
        const seen = vi.fn();
        q.subscribe(seen);
        q.stepOne(() => {});
        expect(seen).toHaveBeenCalledTimes(1);
    });

    it('stepOne runs the current entry, COMPLETES it and advances', () => {
        const q = new ActionQueue();
        q.add(move('N', { loops: 2 }));
        q.add(move('E'));
        const ran = [];
        const out = q.stepOne((e) => { ran.push(e.actionId); return 'ok'; });
        expect(ran).toEqual(['N']);
        expect(out.state).toBe(ActionState.COMPLETED);
        expect(out.result).toBe('ok');
        expect(out.error).toBeNull();
        const status = q.getStatus(q.getEntries()[0].entryId);
        expect(status.state).toBe(ActionState.COMPLETED);
        expect(status.loopsCompleted).toBe(2);
        expect(q.cursor).toBe(1);
    });

    it('a THROWING executor leaves FAILED with the message and the cursor ADVANCED', () => {
        const q = new ActionQueue();
        q.add(move('N'));
        q.add(move('E'));
        const out = q.stepOne(() => { throw new Error('wall to the north'); });
        expect(out.state).toBe(ActionState.FAILED);
        expect(out.error).toBe('wall to the north');
        const status = q.getStatus(q.getEntries()[0].entryId);
        expect(status.state).toBe(ActionState.FAILED);
        expect(status.error).toBe('wall to the north');
        // The caller decides whether to stop — the queue does not decide for it.
        expect(q.cursor).toBe(1);
    });

    it('stepOne on an exhausted queue is null and runs nothing', () => {
        const q = new ActionQueue();
        const exec = vi.fn();
        expect(q.stepOne(exec)).toBeNull();
        expect(exec).not.toHaveBeenCalled();
    });

    it('drainPending advances to the end and reports how far', () => {
        const q = new ActionQueue();
        q.add(move('N')); q.add(move('E')); q.add(move('S'));
        expect(q.drainPending()).toBe(3);
        expect(q.isExhausted()).toBe(true);
    });

    it('snapshot is entries + statuses, frozen', () => {
        const q = new ActionQueue();
        q.add(move('N', { params: { a: 1 } }));
        q.stepOne(() => {});
        const snap = q.snapshot();
        expect(Object.isFrozen(snap)).toBe(true);
        expect(Object.isFrozen(snap.entries)).toBe(true);
        expect(Object.isFrozen(snap.entries[0])).toBe(true);
        expect(Object.isFrozen(snap.entries[0].params)).toBe(true);
        expect(snap.cursor).toBe(1);
        expect(snap.entries[0].status.state).toBe(ActionState.COMPLETED);
    });

    it('advance SKIPS disabled entries', () => {
        const q = new ActionQueue();
        q.add(move('N'));
        q.add(move('E', { disabled: true }));
        q.add(move('S'));
        q.advance();
        expect(q.currentEntry().actionId).toBe('S');
        expect(q.getStatus(q.getEntries()[1].entryId).state).toBe(ActionState.SKIPPED);
    });
});

describe('status actuals MERGE across passes (A9)', () => {
    it('a later partial update does not drop an earlier field', () => {
        const q = new ActionQueue();
        const e = q.add(move('N'));
        q.updateStatus(e.entryId, { actuals: { energyBefore: 100 } });
        q.updateStatus(e.entryId, { actuals: { energyAfter: 80 } });
        expect(q.getStatus(e.entryId).actuals).toEqual({ energyBefore: 100, energyAfter: 80 });
    });

    it('reset clears them', () => {
        const q = new ActionQueue();
        const e = q.add(move('N'));
        q.updateStatus(e.entryId, { actuals: { energyBefore: 100 } });
        q.reset();
        expect(q.getStatus(e.entryId).actuals).toBeUndefined();
    });
});
