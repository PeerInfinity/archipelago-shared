/**
 * Touch input synthesis for substrate game pages (runner plan §4.7 +
 * §6 sibling task). Strictly INPUT SYNTHESIS: pointer handlers set the
 * same held-state input flags the keyboard sets, so physics, solvers,
 * verifiers, rules, and bot-merge semantics are all untouched — a
 * touch zone is just another key.
 *
 * Split for testability (vitest runs in a node environment):
 * - createTouchTracker(zones, flags): the pure core — a pointer-id ->
 *   zone state machine over NORMALIZED container coordinates. A flag
 *   is held while ANY active pointer holds a zone carrying it
 *   (multi-touch safe: jump + drop simultaneously, two thumbs on one
 *   zone, releases only clear their own pointer).
 * - installTouchControls({...}): the thin DOM binder — one pointer
 *   listener set on the container (zones resolve by hitTest, FIRST
 *   match wins, so list small buttons before full-panel zones) plus
 *   purely visual translucent zone overlays (pointer-events: none).
 *
 * Visibility: shown on coarse-pointer devices or when the embedding
 * host says so — resolveTouchOverride() reads a `touch` URL param
 * (standalone/dev), and hosts can pass an explicit boolean through
 * configure params; both override the media query.
 *
 * Zone shape:
 *   { id, flag, hitTest(nx, ny), css?, label? }
 * `flag` names the input field to hold; `hitTest` takes coordinates
 * normalized to [0,1] within the container; `css` positions the
 * visual overlay (absolute within the container); `label` is drawn
 * centered in the overlay.
 */

/** Pure pointer-tracking core. Mutates (and returns) `flags`. */
export function createTouchTracker(zones, flags = {}) {
    const active = new Map(); // pointerId -> zone

    for (const zone of zones) flags[zone.flag] = false;

    const refresh = () => {
        for (const zone of zones) {
            let held = false;
            for (const z of active.values()) {
                if (z.flag === zone.flag) { held = true; break; }
            }
            flags[zone.flag] = held;
        }
    };

    return {
        flags,
        down(pointerId, nx, ny) {
            const zone = zones.find((z) => z.hitTest(nx, ny));
            if (!zone) return null;
            active.set(pointerId, zone);
            refresh();
            return zone;
        },
        up(pointerId) {
            const zone = active.get(pointerId) ?? null;
            active.delete(pointerId);
            refresh();
            return zone;
        },
        cancel(pointerId) {
            return this.up(pointerId);
        },
        activeCount() {
            return active.size;
        },
    };
}

/**
 * Parse a `touch` URL parameter into an override boolean or null
 * (null = no override, fall back to the media query / host signal).
 */
export function resolveTouchOverride(search) {
    const raw = new URLSearchParams(search ?? '').get('touch');
    if (raw === null) return null;
    return !(raw === '0' || raw === 'false');
}

/** Should the touch controls be shown? Explicit override wins;
 *  otherwise coarse-pointer detection. */
export function shouldShowTouchControls({ override = null, matchMediaFn } = {}) {
    if (override !== null && override !== undefined) return !!override;
    if (typeof matchMediaFn !== 'function') return false;
    return !!matchMediaFn('(pointer: coarse)').matches;
}

/**
 * DOM binder. Returns { visible, tracker, destroy }. When not visible
 * (fine-pointer desktop, no override) it installs nothing and the
 * flags object is left untouched.
 *
 * The container must be position:relative (the overlays are absolute)
 * and should wrap the canvas exactly — normalized coordinates come
 * from its bounding rect.
 */
export function installTouchControls({
    container,
    zones,
    flags,
    override = null,
    win = typeof window !== 'undefined' ? window : null,
} = {}) {
    const visible = shouldShowTouchControls({
        override,
        matchMediaFn: win?.matchMedia?.bind(win),
    });
    if (!visible || !container) {
        return { visible: false, tracker: null, destroy() {} };
    }

    const tracker = createTouchTracker(zones, flags);
    container.style.touchAction = 'none';

    const overlays = [];
    for (const zone of zones) {
        if (!zone.css) continue;
        const el = container.ownerDocument.createElement('div');
        el.className = `touch-zone touch-zone-${zone.id}`;
        Object.assign(el.style, {
            position: 'absolute',
            pointerEvents: 'none', // visual only — input lands on the container
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            background: 'rgba(255,255,255,0.05)',
            border: '1px solid rgba(255,255,255,0.15)',
            borderRadius: '8px',
            color: 'rgba(255,255,255,0.35)',
            font: '12px ui-monospace, monospace',
            userSelect: 'none',
        }, zone.css);
        if (zone.label) el.textContent = zone.label;
        container.appendChild(el);
        overlays.push(el);
    }

    const norm = (e) => {
        const rect = container.getBoundingClientRect();
        return [
            rect.width ? (e.clientX - rect.left) / rect.width : 0,
            rect.height ? (e.clientY - rect.top) / rect.height : 0,
        ];
    };
    const onDown = (e) => {
        const [nx, ny] = norm(e);
        if (tracker.down(e.pointerId, nx, ny)) {
            container.setPointerCapture?.(e.pointerId);
            e.preventDefault();
        }
    };
    const onUp = (e) => { tracker.up(e.pointerId); };
    const onCancel = (e) => { tracker.cancel(e.pointerId); };
    container.addEventListener('pointerdown', onDown);
    container.addEventListener('pointerup', onUp);
    container.addEventListener('pointercancel', onCancel);

    return {
        visible: true,
        tracker,
        destroy() {
            container.removeEventListener('pointerdown', onDown);
            container.removeEventListener('pointerup', onUp);
            container.removeEventListener('pointercancel', onCancel);
            for (const el of overlays) el.remove();
        },
    };
}
