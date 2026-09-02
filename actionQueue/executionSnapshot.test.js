// ExecutionSnapshot — the frozen "current list" jta executes on.
// Part of the shared actionQueue package's first tests (slice Q-a).
import { describe, it, expect } from 'vitest';
import { ActionQueue } from './actionQueue.js';
import { ActionState } from './actionTypes.js';
import { ExecutionSnapshot } from './executionSnapshot.js';

const move = (dir, extra = {}) => ({
    actionType: 'move', actionId: dir, substrate: 'maze', loops: 1, ...extra,
});

describe('ExecutionSnapshot over the queue', () => {
    it('fromQueue DROPS disabled entries', () => {
        const q = new ActionQueue();
        q.add(move('N'));
        q.add(move('E', { disabled: true }));
        const snap = ExecutionSnapshot.fromQueue(q);
        expect(snap.getEntries().map(e => e.actionId)).toEqual(['N']);
    });

    it('appendFromQueue is idempotent and preserves existing state', () => {
        const q = new ActionQueue();
        const first = q.add(move('N'));
        const snap = ExecutionSnapshot.fromQueue(q);
        snap.updateStatus(first.entryId, { state: ActionState.COMPLETED });
        q.add(move('E'));
        snap.appendFromQueue(q);
        snap.appendFromQueue(q);
        expect(snap.length).toBe(2);
        expect(snap.getStatus(first.entryId).state).toBe(ActionState.COMPLETED);
    });

    it('its actuals merge the same way, and reset clears them', () => {
        const q = new ActionQueue();
        const e = q.add(move('N'));
        const snap = ExecutionSnapshot.fromQueue(q);
        snap.updateStatus(e.entryId, { actuals: { energyBefore: 100 } });
        snap.updateStatus(e.entryId, { state: ActionState.COMPLETED, actuals: { energyAfter: 40 } });
        expect(snap.getStatus(e.entryId).actuals).toEqual({ energyBefore: 100, energyAfter: 40 });
        expect(snap.getStatus(e.entryId).state).toBe(ActionState.COMPLETED);
        snap.reset();
        expect(snap.getStatus(e.entryId).actuals).toBeUndefined();
    });
});
