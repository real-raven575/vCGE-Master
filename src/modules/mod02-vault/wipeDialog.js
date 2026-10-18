/**
 * vCGE-MOD02: hold-to-wipe (redesign step 3)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * The red trash button on every card (and the Vault page's wipe button) opens one question: "Are you sure you want to
 * wipe everything and start over?" with a box, "Also delete my saved settings", unticked by default; ticking it asks
 * "Are you sure?" once more before it counts. Yes is green and must be held for HOLD_MS: while held it fills from light
 * to dark green, then a small light sweeps under it, the vault wipes and the page reloads. Letting go early cancels. No
 * is red and one tap (or a sideways swipe of the box, or Esc) closes it, returns you to where you were, and counts as
 * activity for the idle timer. In colour-blind mode (html[data-cb="1"], set by Shell's settings) the words "Hold to
 * wipe" and a fill bar say what the colours say, so colour is never the only cue.
 *
 * The dialog carries no data. Deleting the saved settings is a signal on the bus (SETTINGS_WIPE_REQUESTED): Shell
 * owns the settings entry and clears it; Vault never touches another module's storage.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';

export const HOLD_MS = 1500;             // how long Yes must be held
export const SWEEP_MS = 320;             // the light sweep after the hold completes
export const SWIPE_PX = 80;              // a sideways swipe this long over the box is No

/** Hold progress 0..1 for a press that began at startedAt, read at now. */
export function holdProgress(startedAt, now, holdMs = HOLD_MS) {
    if (!startedAt) return 0;
    return Math.min(1, Math.max(0, (now - startedAt) / holdMs));
}

const colourBlind = () => typeof document !== 'undefined' && document.documentElement.dataset.cb === '1';

// Starts the page fresh after a wipe by loading the same address in place of the current history entry. A plain
// location.reload() of the Back guard's entry hangs WebKit (Safari's engine) on the second wipe: a probe on
// Playwright's WebKit, desktop and iPhone 15, hung in round 2 with location.reload, while location.replace ran three
// rounds and kept the guard entry (2026-10-18). The address without its #part, so a hash cannot turn it into a scroll.
export function startFresh() {
    location.replace(location.href.split('#')[0]);
}

export class WipeDialog {
    /**
     * @param {{ onWipe: (opts: { deleteSettings: boolean }) => void, onCancel?: () => void, reload?: () => void,
     *           now?: () => number, isColourBlind?: () => boolean }} opts
     */
    constructor({ onWipe, onCancel = () => {}, reload = startFresh, now = () => performance.now(), isColourBlind = colourBlind }) {
        this.onWipe = onWipe; this.onCancel = onCancel; this.reload = reload; this.now = now; this.isColourBlind = isColourBlind;
        this.root = null; this.startedAt = 0; this.raf = 0; this.done = false; this.settingsConfirmed = false; this.opener = null;
    }

    init(doc = document) {
        if (this.root) return;
        const root = doc.createElement('div');
        root.id = 'wipeDialog';
        root.className = 'wipe-dialog hidden';
        root.innerHTML = `
        <div class="wipe-box" role="alertdialog" aria-modal="true" aria-labelledby="wipeTitle" aria-describedby="wipeHint">
            <h2 id="wipeTitle">Are you sure you want to wipe everything and start over?</h2>
            <p id="wipeHint">The card, the photo and the scan are cleared from memory and the page starts fresh. Nothing was ever saved.</p>
            <label class="wipe-settings"><input id="wipeSettingsBox" type="checkbox"> <span>Also delete my saved settings</span></label>
            <div id="wipeSettingsConfirm" class="wipe-settings-confirm hidden" role="group" aria-labelledby="wipeSettingsConfirmText">
                <span id="wipeSettingsConfirmText">Are you sure? Your hand, colour, theme and font choices go too.</span>
                <span class="wipe-settings-confirm-btns">
                    <button id="wipeSettingsYesBtn" type="button" class="wipe-mini">Yes, delete them</button>
                    <button id="wipeSettingsNoBtn" type="button" class="wipe-mini">Keep them</button>
                </span>
            </div>
            <div class="wipe-actions">
                <button id="wipeNoBtn" type="button" class="wipe-no">No</button>
                <button id="wipeYesBtn" type="button" class="wipe-yes" aria-describedby="wipeHoldHint">
                    <span id="wipeYesFill" class="wipe-yes-fill" aria-hidden="true"></span>
                    <span class="wipe-yes-sweep" aria-hidden="true"></span>
                    <span class="wipe-yes-label"><span id="wipeYesText">Yes</span><small id="wipeHoldHint">hold 1.5 s</small></span>
                </button>
            </div>
            <div id="wipeHoldBar" class="wipe-hold-bar hidden" role="progressbar" aria-label="Hold to wipe" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span></span></div>
        </div>`;
        doc.body.append(root);
        this.root = root;
        const $ = (id) => root.querySelector('#' + id);
        this.el = { box: $('wipeSettingsBox'), confirm: $('wipeSettingsConfirm'), yes: $('wipeYesBtn'), no: $('wipeNoBtn'), fill: $('wipeYesFill'),
            text: $('wipeYesText'), bar: $('wipeHoldBar'), barFill: root.querySelector('#wipeHoldBar span') };

        this.el.no.addEventListener('click', () => this.cancel());
        this.el.box.addEventListener('change', () => {
            this.settingsConfirmed = false;
            this.el.confirm.classList.toggle('hidden', !this.el.box.checked);
        });
        $('wipeSettingsYesBtn').addEventListener('click', () => { this.settingsConfirmed = true; this.el.confirm.classList.add('hidden'); });
        $('wipeSettingsNoBtn').addEventListener('click', () => { this.el.box.checked = false; this.settingsConfirmed = false; this.el.confirm.classList.add('hidden'); });

        // Yes: hold with a finger, a mouse or Space / Enter. A long press on a phone must not open the context menu.
        const yes = this.el.yes;
        yes.addEventListener('contextmenu', (e) => e.preventDefault());
        yes.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            try { yes.setPointerCapture(e.pointerId); } catch (_) { /* a synthetic pointer: the release still reaches the button */ }
            this.beginHold();
        });
        ['pointerup', 'pointercancel', 'lostpointercapture'].forEach(t => yes.addEventListener(t, () => this.endHold()));
        yes.addEventListener('keydown', (e) => { if ((e.key === ' ' || e.key === 'Enter') && !e.repeat) { e.preventDefault(); this.beginHold(); } });
        yes.addEventListener('keyup', (e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); this.endHold(); } });
        yes.addEventListener('click', (e) => e.preventDefault());    // the hold decides, not a click

        // A sideways swipe over the box is No. Esc is No.
        let start = null;
        root.addEventListener('pointerdown', (e) => { start = e.target.closest('#wipeYesBtn') ? null : { x: e.clientX, y: e.clientY }; });
        root.addEventListener('pointerup', (e) => {
            if (!start) return;
            const dx = e.clientX - start.x, dy = e.clientY - start.y; start = null;
            if (Math.abs(dx) >= SWIPE_PX && Math.abs(dx) > Math.abs(dy) * 1.5) this.cancel();
        });
        root.addEventListener('click', (e) => { if (e.target === root) this.cancel(); });
        // Esc is No for this dialog alone: it must not also close the sheet (Vault page) underneath.
        root.addEventListener('keydown', (e) => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.cancel(); } });
    }

    isOpen() { return !!this.root && !this.root.classList.contains('hidden'); }

    open() {
        if (!this.root || this.done) return;
        this.opener = document.activeElement;
        this.el.box.checked = false; this.settingsConfirmed = false; this.el.confirm.classList.add('hidden');
        this.resetHold();
        const cb = this.isColourBlind();
        this.root.classList.toggle('is-cb', cb);
        this.el.text.textContent = cb ? 'Hold to wipe' : 'Yes';
        this.el.bar.classList.toggle('hidden', !cb);
        this.root.classList.remove('hidden');
        this.el.no.focus();
    }

    cancel() {
        if (!this.isOpen() || this.done) return;
        this.resetHold();
        this.root.classList.add('hidden');
        if (this.opener && this.opener.focus) this.opener.focus();
        this.onCancel();
    }

    beginHold() {
        if (this.startedAt || this.done) return;
        this.startedAt = this.now();
        this.root.dataset.hold = 'holding';
        const step = () => {
            const p = holdProgress(this.startedAt, this.now());
            this.paint(p);
            if (p >= 1) { this.complete(); return; }
            this.raf = requestAnimationFrame(step);
        };
        this.raf = requestAnimationFrame(step);
    }

    endHold() {
        if (!this.startedAt || this.done) return;
        this.resetHold();           // let go early: nothing happens
    }

    resetHold() {
        cancelAnimationFrame(this.raf); this.raf = 0; this.startedAt = 0;
        delete this.root.dataset.hold;
        this.paint(0);
    }

    paint(p) {
        const pct = `${Math.round(p * 100)}%`;
        this.el.fill.style.width = pct;
        this.el.barFill.style.width = pct;
        this.el.bar.setAttribute('aria-valuenow', String(Math.round(p * 100)));
        this.root.style.setProperty('--wipe-p', p.toFixed(3));
    }

    complete() {
        cancelAnimationFrame(this.raf); this.raf = 0;
        this.done = true;
        this.paint(1);
        this.root.dataset.hold = 'done';
        const deleteSettings = this.el.box.checked && this.settingsConfirmed;
        setTimeout(() => {
            try {
                this.onWipe({ deleteSettings });
                if (deleteSettings) globalEventBus.publish(Events.SETTINGS_WIPE_REQUESTED, { timestamp: Date.now() });
            } finally {
                this.reload();
            }
        }, SWEEP_MS);
    }
}
