/**
 * substrateInactiveOverlay — shared component shown by a procgen
 * substrate panel when it is NOT the substrate for the current
 * region. Renders a status message plus zero-to-two action buttons.
 *
 * Used by mazeRoom, textAdventureSubstrateWrapper, jtaSubstrateWrapper.
 * Each panel mounts one of these as a sibling of its inner content
 * container and toggles visibility on `procgen:activeSubstrateChanged`
 * (and `gameState:loopModeChanged` for the Loops button).
 *
 * State values (open string enum so loop-mode states can extend later):
 *   - 'wrong-substrate'      — current region uses a different substrate
 *   - 'no-active-substrate'  — current region has no procgen substrate
 *
 * Inputs / API:
 *
 *   const overlay = new SubstrateInactiveOverlay({
 *     onActivateSubstrate: () => { ... },  // called when "Open <Label>" pressed
 *     onActivateLoops:     () => { ... },  // called when "Open Loops" pressed
 *   });
 *   container.appendChild(overlay.root);
 *
 *   overlay.update({
 *     state,            // 'wrong-substrate' | 'no-active-substrate'
 *     activeSubstrate,  // { componentType, label } | null — only used in 'wrong-substrate'
 *     loopModeActive,   // boolean — controls Loops button visibility
 *   });
 *
 *   overlay.setVisible(true|false);
 */

export class SubstrateInactiveOverlay {
    constructor({ onActivateSubstrate, onActivateLoops } = {}) {
        this._onActivateSubstrate = typeof onActivateSubstrate === 'function' ? onActivateSubstrate : null;
        this._onActivateLoops = typeof onActivateLoops === 'function' ? onActivateLoops : null;

        this.root = document.createElement('div');
        this.root.className = 'substrate-inactive-overlay';
        Object.assign(this.root.style, {
            display: 'none',
            position: 'absolute',
            inset: '0',
            background: '#1e1e1e',
            color: '#e0e0e0',
            fontFamily: "'Segoe UI', system-ui, sans-serif",
            fontSize: '13px',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '24px',
            textAlign: 'center',
            gap: '12px',
            zIndex: '10',
        });

        this._message = document.createElement('div');
        this._message.className = 'substrate-inactive-overlay-message';
        this._message.style.maxWidth = '480px';
        this._message.style.lineHeight = '1.4';
        this.root.appendChild(this._message);

        this._buttonRow = document.createElement('div');
        this._buttonRow.className = 'substrate-inactive-overlay-buttons';
        Object.assign(this._buttonRow.style, {
            display: 'flex',
            gap: '8px',
            flexWrap: 'wrap',
            justifyContent: 'center',
        });
        this.root.appendChild(this._buttonRow);

        this._substrateButton = this._makeButton('', () => {
            if (this._onActivateSubstrate) this._onActivateSubstrate();
        });
        this._loopsButton = this._makeButton('Open the Loops panel', () => {
            if (this._onActivateLoops) this._onActivateLoops();
        });
    }

    _makeButton(label, onClick) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.textContent = label;
        Object.assign(btn.style, {
            padding: '6px 14px',
            background: '#2a2a2a',
            color: '#e0e0e0',
            border: '1px solid #444',
            borderRadius: '3px',
            fontSize: '13px',
            cursor: 'pointer',
            fontFamily: 'inherit',
        });
        btn.addEventListener('click', onClick);
        return btn;
    }

    /** Toggle the whole overlay visibility (above the panel contents). */
    setVisible(visible) {
        this.root.style.display = visible ? 'flex' : 'none';
    }

    /**
     * Re-render message + buttons based on current state.
     * Safe to call repeatedly; the DOM is reused.
     */
    update({ state, activeSubstrate, loopModeActive } = {}) {
        if (state === 'wrong-substrate') {
            const label = activeSubstrate?.label ?? 'another substrate';
            this._message.textContent = `Currently playing ${label}.`;
        } else {
            // 'no-active-substrate' (also the fallback for unknown states)
            this._message.textContent = 'No procgen substrate is active for the current region.';
        }

        // Buttons: clear, then re-append in order.
        this._buttonRow.replaceChildren();

        const showSubstrateButton =
            state === 'wrong-substrate' &&
            activeSubstrate &&
            activeSubstrate.componentType &&
            activeSubstrate.label;
        if (showSubstrateButton) {
            this._substrateButton.textContent = `Open the ${activeSubstrate.label} panel`;
            this._buttonRow.appendChild(this._substrateButton);
        }

        if (loopModeActive) {
            this._buttonRow.appendChild(this._loopsButton);
        }
    }
}
