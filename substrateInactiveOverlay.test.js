import { describe, it, expect, beforeEach, afterEach } from 'vitest';

// Vitest runs under the 'node' environment; the overlay is a pure DOM
// widget. Install a minimal document shim — same pattern as
// playbackControlBar.test.js — so the same tests verify wiring rather
// than just construction.

class FakeElement {
    constructor(tag) {
        this.tagName = tag.toUpperCase();
        this.children = [];
        this.style = {};
        this._listeners = {};
        this.parentNode = null;
        this.type = '';
        this.textContent = '';
        this.className = '';
    }
    appendChild(child) {
        child.parentNode = this;
        this.children.push(child);
        return child;
    }
    replaceChildren(...nodes) {
        for (const child of this.children) child.parentNode = null;
        this.children = [];
        for (const node of nodes) this.appendChild(node);
    }
    addEventListener(name, fn) {
        if (!this._listeners[name]) this._listeners[name] = [];
        this._listeners[name].push(fn);
    }
    click() {
        for (const fn of this._listeners.click ?? []) fn();
    }
    querySelectorAll(selector) {
        const target = selector.toUpperCase();
        return this.children.filter((c) => c.tagName === target);
    }
}

const fakeDocument = {
    createElement(tag) { return new FakeElement(tag); },
};

let originalDocument;

beforeEach(() => {
    originalDocument = globalThis.document;
    globalThis.document = fakeDocument;
});

afterEach(() => {
    globalThis.document = originalDocument;
});

// Import AFTER the document shim is set up the first time.
const { SubstrateInactiveOverlay } = await import('./substrateInactiveOverlay.js');

function buttonLabels(overlay) {
    return overlay._buttonRow.querySelectorAll('button').map((b) => b.textContent);
}

describe('SubstrateInactiveOverlay', () => {
    let overlay;
    let substrateClicks;
    let loopsClicks;

    beforeEach(() => {
        substrateClicks = 0;
        loopsClicks = 0;
        overlay = new SubstrateInactiveOverlay({
            onActivateSubstrate: () => { substrateClicks += 1; },
            onActivateLoops: () => { loopsClicks += 1; },
        });
    });

    it('starts hidden', () => {
        expect(overlay.root.style.display).toBe('none');
    });

    it('setVisible(true) shows the overlay, setVisible(false) hides it', () => {
        overlay.setVisible(true);
        expect(overlay.root.style.display).toBe('flex');
        overlay.setVisible(false);
        expect(overlay.root.style.display).toBe('none');
    });

    describe('state: wrong-substrate', () => {
        beforeEach(() => {
            overlay.update({
                state: 'wrong-substrate',
                activeSubstrate: { componentType: 'mazeRoomPanel', label: 'Maze' },
                loopModeActive: false,
            });
        });

        it('shows the active-substrate label in the message', () => {
            expect(overlay._message.textContent).toBe('Currently playing Maze.');
        });

        it('shows an "Open the Maze panel" button', () => {
            expect(buttonLabels(overlay)).toEqual(['Open the Maze panel']);
        });

        it('clicking the substrate button fires onActivateSubstrate', () => {
            overlay._buttonRow.querySelectorAll('button')[0].click();
            expect(substrateClicks).toBe(1);
            expect(loopsClicks).toBe(0);
        });

        it('with loopModeActive=true also shows the Loops button', () => {
            overlay.update({
                state: 'wrong-substrate',
                activeSubstrate: { componentType: 'mazeRoomPanel', label: 'Maze' },
                loopModeActive: true,
            });
            expect(buttonLabels(overlay)).toEqual([
                'Open the Maze panel',
                'Open the Loops panel',
            ]);
        });

        it('Loops button click fires onActivateLoops', () => {
            overlay.update({
                state: 'wrong-substrate',
                activeSubstrate: { componentType: 'mazeRoomPanel', label: 'Maze' },
                loopModeActive: true,
            });
            overlay._buttonRow.querySelectorAll('button')[1].click();
            expect(loopsClicks).toBe(1);
            expect(substrateClicks).toBe(0);
        });
    });

    describe('state: no-active-substrate', () => {
        beforeEach(() => {
            overlay.update({
                state: 'no-active-substrate',
                activeSubstrate: null,
                loopModeActive: false,
            });
        });

        it('shows the no-active-substrate message', () => {
            expect(overlay._message.textContent).toBe(
                'No procgen substrate is active for the current region.',
            );
        });

        it('renders no buttons when loop mode is inactive', () => {
            expect(buttonLabels(overlay)).toEqual([]);
        });

        it('shows only the Loops button when loop mode is active', () => {
            overlay.update({
                state: 'no-active-substrate',
                activeSubstrate: null,
                loopModeActive: true,
            });
            expect(buttonLabels(overlay)).toEqual(['Open the Loops panel']);
        });
    });

    it('update() is idempotent — repeated calls do not duplicate buttons', () => {
        const payload = {
            state: 'wrong-substrate',
            activeSubstrate: { componentType: 'mazeRoomPanel', label: 'Maze' },
            loopModeActive: true,
        };
        overlay.update(payload);
        overlay.update(payload);
        overlay.update(payload);
        expect(buttonLabels(overlay)).toEqual([
            'Open the Maze panel',
            'Open the Loops panel',
        ]);
    });

    it('omits the substrate button when activeSubstrate is missing fields', () => {
        overlay.update({
            state: 'wrong-substrate',
            activeSubstrate: { componentType: 'mazeRoomPanel' }, // no label
            loopModeActive: false,
        });
        expect(buttonLabels(overlay)).toEqual([]);
    });
});
