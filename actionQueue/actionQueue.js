// ActionQueue - ordered list of actions with cursor, status tracking,
// change notification and serialization.
//
// Two roles in one class:
//   * the AUTHORING list a panel edits (add / remove / reorder / undo), and
//   * the LIVE queue a substrate executes (cursor, statuses, stepOne).
// The maze's live queue is the first real user of the second role; jta's
// executor runs on a frozen ExecutionSnapshot instead, which is why the cursor
// rules below were never exercised before.
import {
    ActionState,
    ACTION_QUEUE_FORMAT,
    assertEntry,
    mergeStatus,
    normalizeEntry,
} from './actionTypes.js';

export class ActionQueue {
    /** @type {import('./actionTypes.js').QueueEntry[]} */
    #entries = [];

    /** @type {Map<string, import('./actionTypes.js').ActionStatus>} */
    #statuses = new Map();

    /** @type {number} Index of the currently executing entry */
    #cursor = 0;

    /** @type {boolean} */
    #running = false;

    /** @type {object|null} Serialized snapshot for single-level undo */
    #lastSnapshot = null;

    /** @type {Set<Function>} Change listeners (see subscribe) */
    #listeners = new Set();

    /** @type {number} Nesting depth of #batch, so one mutation = one emit */
    #batchDepth = 0;

    /** @type {boolean} A mutation happened while batched */
    #batchDirty = false;

    /**
     * @returns {import('./actionTypes.js').QueueEntry[]} Shallow copy of entries
     */
    getEntries() {
        return [...this.#entries];
    }

    /**
     * @returns {number}
     */
    get length() {
        return this.#entries.length;
    }

    /**
     * @returns {number}
     */
    get cursor() {
        return this.#cursor;
    }

    /**
     * @returns {boolean}
     */
    get running() {
        return this.#running;
    }

    set running(value) {
        this.#running = !!value;
    }

    // ---------------------------------------------------------------
    // Change notification (LIVE-queue surface)
    // ---------------------------------------------------------------

    /**
     * Subscribe to queue changes. The listener runs after EVERY mutating
     * method: add, remove, removeAt, reorder, updateEntry, updateStatus,
     * clear, deserialize, undoLast, advance, reset, stepOne, drainPending.
     * A composite operation (stepOne) emits ONCE, not once per inner step.
     * @param {Function} listener
     * @returns {Function} unsubscribe
     */
    subscribe(listener) {
        if (typeof listener !== 'function') return () => {};
        this.#listeners.add(listener);
        return () => { this.#listeners.delete(listener); };
    }

    #emit() {
        if (this.#batchDepth > 0) {
            this.#batchDirty = true;
            return;
        }
        for (const listener of [...this.#listeners]) {
            try { listener(this); } catch { /* isolate a bad listener */ }
        }
    }

    /** Run `fn` with inner emits collapsed into one at the end. */
    #batch(fn) {
        this.#batchDepth++;
        try {
            return fn();
        } finally {
            this.#batchDepth--;
            if (this.#batchDepth === 0 && this.#batchDirty) {
                this.#batchDirty = false;
                this.#emit();
            }
        }
    }

    /**
     * Get the entry currently under the cursor, or null if queue is exhausted
     * @returns {import('./actionTypes.js').QueueEntry|null}
     */
    currentEntry() {
        if (this.#cursor >= this.#entries.length) return null;
        return this.#entries[this.#cursor];
    }

    /**
     * Add an entry to the end (or at a specific index) of the queue.
     *
     * ⛔ An insert BEFORE the cursor is refused by name: those entries have
     * already run ("the done region"), so inserting there would silently
     * change what the cursor points at. Inserting AT the cursor is legal —
     * the new entry becomes the next one to run.
     *
     * @param {Partial<import('./actionTypes.js').QueueEntry>} entry
     * @param {number} [atIndex] - Optional insertion index
     * @returns {import('./actionTypes.js').QueueEntry} The created entry
     */
    add(entry, atIndex) {
        if (atIndex !== undefined && atIndex !== null && atIndex < this.#cursor) {
            throw new RangeError(
                `ActionQueue.add: atIndex ${atIndex} is inside the done region `
                + `(cursor ${this.#cursor}) — entries before the cursor have already run`,
            );
        }
        const full = normalizeEntry(entry, { mintId: true });
        assertEntry(full, 'ActionQueue.add');
        this.recordLast();
        if (atIndex !== undefined && atIndex !== null
            && atIndex >= 0 && atIndex <= this.#entries.length) {
            this.#entries.splice(atIndex, 0, full);
        } else {
            this.#entries.push(full);
        }
        this.#statuses.set(full.entryId, {
            entryId: full.entryId,
            state: ActionState.PENDING,
            loopsCompleted: 0,
        });
        this.#emit();
        return full;
    }

    /**
     * Remove an entry by entryId
     * @param {string} entryId
     * @returns {boolean}
     */
    remove(entryId) {
        const idx = this.#entries.findIndex(e => e.entryId === entryId);
        if (idx === -1) return false;
        this.recordLast();
        this.#entries.splice(idx, 1);
        this.#statuses.delete(entryId);
        // Adjust cursor if needed
        if (idx < this.#cursor) {
            this.#cursor--;
        }
        this.#emit();
        return true;
    }

    /**
     * Remove the entry at an index (the Backspace affordance of a live queue).
     * @param {number} index
     * @returns {boolean}
     */
    removeAt(index) {
        const entry = this.#entries[index];
        if (!entry) return false;
        return this.remove(entry.entryId);
    }

    /**
     * Move an entry from one index to another.
     *
     * ⛔ Refused by name when either end is inside the done region: a move
     * across the cursor rewrites history. A move among PENDING entries leaves
     * the cursor on the same entry it was on.
     * @param {number} fromIndex
     * @param {number} toIndex
     */
    reorder(fromIndex, toIndex) {
        if (fromIndex < 0 || fromIndex >= this.#entries.length) return;
        if (toIndex < 0 || toIndex >= this.#entries.length) return;
        if (fromIndex < this.#cursor || toIndex < this.#cursor) {
            throw new RangeError(
                `ActionQueue.reorder: ${fromIndex} → ${toIndex} crosses the done region `
                + `(cursor ${this.#cursor}) — entries before the cursor have already run`,
            );
        }
        this.recordLast();
        const [entry] = this.#entries.splice(fromIndex, 1);
        this.#entries.splice(toIndex, 0, entry);
        this.#emit();
    }

    /**
     * Update properties of an entry by entryId. The entry is re-normalized, so
     * a rider passed here lands in `params` and the key order stays canonical.
     * @param {string} entryId
     * @param {Partial<import('./actionTypes.js').QueueEntry>} changes
     * @returns {boolean}
     */
    updateEntry(entryId, changes) {
        const idx = this.#entries.findIndex(e => e.entryId === entryId);
        if (idx === -1) return false;
        this.recordLast();
        const merged = normalizeEntry({ ...this.#entries[idx], ...changes, entryId });
        assertEntry(merged, 'ActionQueue.updateEntry');
        this.#entries[idx] = merged;
        this.#emit();
        return true;
    }

    /**
     * Get the status of an entry
     * @param {string} entryId
     * @returns {import('./actionTypes.js').ActionStatus|undefined}
     */
    getStatus(entryId) {
        return this.#statuses.get(entryId);
    }

    /**
     * Update the status of an entry. An `actuals` object MERGES into the
     * existing one rather than replacing it — a substrate fills it in several
     * passes (before / after / retroactively from authoritative state).
     * @param {string} entryId
     * @param {Partial<import('./actionTypes.js').ActionStatus>} update
     */
    updateStatus(entryId, update) {
        const status = this.#statuses.get(entryId);
        if (!status) return;
        mergeStatus(status, update);
        this.#emit();
    }

    /**
     * Advance the cursor to the next non-disabled entry.
     * Marks skipped disabled entries.
     * @returns {import('./actionTypes.js').QueueEntry|null} Next entry, or null if exhausted
     */
    advance() {
        return this.#batch(() => {
            this.#cursor++;
            this.#emit();
            while (this.#cursor < this.#entries.length) {
                const entry = this.#entries[this.#cursor];
                if (!entry.disabled) {
                    return entry;
                }
                this.updateStatus(entry.entryId, { state: ActionState.SKIPPED });
                this.#cursor++;
            }
            return null;
        });
    }

    /**
     * Run the entry under the cursor through `executor`, record the outcome and
     * advance — the ONE step a live-queue driver takes.
     *
     * A throwing executor leaves the entry FAILED with the message and STILL
     * advances the cursor: whether to stop is the driver's call (the maze stops
     * at the first refused move; a tolerant driver may continue).
     *
     * @param {(entry: import('./actionTypes.js').QueueEntry) => any} [executor]
     * @returns {{entry: object, state: string, error: string|null, result: any}|null}
     *   null when the queue is already exhausted.
     */
    stepOne(executor) {
        return this.#batch(() => {
            const entry = this.currentEntry();
            if (!entry) return null;
            this.updateStatus(entry.entryId, { state: ActionState.ACTIVE });
            let result;
            let error = null;
            try {
                result = typeof executor === 'function' ? executor(entry) : undefined;
            } catch (err) {
                error = (err && err.message) ? err.message : String(err);
            }
            if (error === null) {
                this.updateStatus(entry.entryId, {
                    state: ActionState.COMPLETED,
                    loopsCompleted: entry.loops,
                });
            } else {
                this.updateStatus(entry.entryId, { state: ActionState.FAILED, error });
            }
            this.advance();
            return {
                entry,
                state: error === null ? ActionState.COMPLETED : ActionState.FAILED,
                error,
                result,
            };
        });
    }

    /**
     * Advance to the end without running anything — the "give up on the rest"
     * move a driver makes when the run is over.
     * @returns {number} How many entries the cursor passed
     */
    drainPending() {
        return this.#batch(() => {
            const before = this.#cursor;
            while (this.#cursor < this.#entries.length) this.advance();
            return this.#cursor - before;
        });
    }

    /**
     * Reset the queue: move cursor to 0, reset all statuses to PENDING
     */
    reset() {
        this.#batch(() => {
            this.#cursor = 0;
            this.#running = false;
            for (const status of this.#statuses.values()) {
                status.state = ActionState.PENDING;
                status.loopsCompleted = 0;
                status.error = undefined;
                status.actuals = undefined;
            }
            this.#emit();
            // Skip initial disabled entries
            if (this.#entries.length > 0 && this.#entries[0].disabled) {
                this.updateStatus(this.#entries[0].entryId, { state: ActionState.SKIPPED });
                this.advance();
            }
        });
    }

    /**
     * Clear all entries and statuses
     */
    clear() {
        this.recordLast();
        this.#entries = [];
        this.#statuses.clear();
        this.#cursor = 0;
        this.#running = false;
        this.#emit();
    }

    /**
     * Check if the queue is exhausted (cursor past end)
     * @returns {boolean}
     */
    isExhausted() {
        return this.#cursor >= this.#entries.length;
    }

    /**
     * A frozen read of entries + their statuses — what an icon row or a
     * cross-substrate viewer renders without being able to mutate the queue.
     * @returns {{cursor:number, running:boolean, entries: object[]}}
     */
    snapshot() {
        const entries = this.#entries.map((e) => {
            const view = { ...e };
            if (view.params) view.params = Object.freeze({ ...view.params });
            view.status = Object.freeze({ ...(this.#statuses.get(e.entryId) ?? {}) });
            return Object.freeze(view);
        });
        return Object.freeze({
            cursor: this.#cursor,
            running: this.#running,
            entries: Object.freeze(entries),
        });
    }

    /**
     * Serialize to a plain object for storage.
     *
     * `{ids:false}` drops `entryId` — the RECORDING form. Entry ids are
     * wall-clock derived, so a recording that carried them could never be
     * byte-identical to a second capture of the same visit, which is what the
     * saved-queue store's duplicate detection compares.
     * @param {{ids?: boolean}} [opts]
     * @returns {{format: string, entries: object[]}}
     */
    serialize({ ids = true } = {}) {
        return {
            format: ACTION_QUEUE_FORMAT,
            entries: this.#entries.map((e) => {
                const copy = { ...e };
                if (!ids) delete copy.entryId;
                if (copy.params) copy.params = { ...copy.params };
                return copy;
            }),
        };
    }

    /**
     * Load from serialized data (does not record an undo snapshot).
     *
     * Accepts the `{format, entries}` envelope and, for queues stored before
     * the envelope existed, a bare `{entries}` — read as actionQueue/1. Any
     * OTHER format is refused by name rather than normalized into garbage.
     * @param {object} data
     */
    deserialize(data) {
        const format = data?.format;
        if (format !== undefined && format !== ACTION_QUEUE_FORMAT) {
            throw new Error(
                `ActionQueue.deserialize: unknown format '${format}' `
                + `(expected '${ACTION_QUEUE_FORMAT}')`,
            );
        }
        this.#batch(() => {
            this.#entries = [];
            this.#statuses.clear();
            this.#cursor = 0;
            this.#running = false;
            if (data && Array.isArray(data.entries)) {
                for (const entry of data.entries) {
                    this.#install(entry);
                }
            }
            this.#emit();
        });
    }

    /** Normalize, validate and append one entry with a PENDING status. */
    #install(entry) {
        const full = normalizeEntry(entry, { mintId: true });
        assertEntry(full, 'ActionQueue.deserialize');
        this.#entries.push(full);
        this.#statuses.set(full.entryId, {
            entryId: full.entryId,
            state: ActionState.PENDING,
            loopsCompleted: 0,
        });
    }

    /**
     * Snapshot the current state for single-level undo.
     * Called automatically before mutating operations.
     */
    recordLast() {
        this.#lastSnapshot = {
            entries: this.#entries.map(e => ({ ...e })),
        };
    }

    /**
     * Undo the last mutation. Toggles: calling twice restores the state before undo.
     * @returns {boolean} True if undo was performed
     */
    undoLast() {
        if (!this.#lastSnapshot) return false;
        return this.#batch(() => {
            const current = {
                entries: this.#entries.map(e => ({ ...e })),
            };
            // Restore without triggering recordLast (use the internal installer)
            this.#entries = [];
            this.#statuses.clear();
            this.#cursor = 0;
            this.#running = false;
            for (const entry of this.#lastSnapshot.entries) {
                this.#install(entry);
            }
            this.#lastSnapshot = current; // swap so undo toggles
            this.#emit();
            return true;
        });
    }

    /**
     * Find the index of an entry by entryId
     * @param {string} entryId
     * @returns {number} Index, or -1 if not found
     */
    findIndex(entryId) {
        return this.#entries.findIndex(e => e.entryId === entryId);
    }
}
