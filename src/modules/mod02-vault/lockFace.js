/**
 * vCGE-MOD02: Ghost on the lock screen (cute round V1-V3, raven575 2026-10-21)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * V1: a small Ghost the Raccoon over the PIN box shows one face per digit typed (raven575, 2026-10-22): eyes open but
 * looking away ("not watching"), a paw over one eye, both paws, a wink with an eyebrow raised, then sunglasses. With the
 * right PIN the sunglasses stay on for a moment and the lock screen dissolves (farewell()); a wrong PIN or an emptied box
 * goes back to looking away.
 * V2: the PIN box shows four paw prints, filled one per digit typed; the box itself and what screen readers hear are
 * unchanged (a password field of 4 digits).
 * V3: the lock ring is a ringed raccoon tail: dark bands over the ring, masked by the same countdown, so the bands go
 * as the time runs out (main.js moves both rings).
 * All of it is drawing only: nothing is stored, nothing is announced, no sound, no flashing. Every move is instant and
 * there is no dissolve under "reduce motion" (vault.css), the filled paws differ from empty ones by shape (filled vs outline),
 * not colour, and the plain edition shows none of it (plain dots and the plain ring, as before).
 */
import { PIN_LENGTH } from './sessionPin.js';

const $ = (id) => document.getElementById(id);

/** Ghost's face for 0, 1, 2, 3 and 4 digits typed. */
export const FACES = ['away', 'one', 'both', 'wink', 'shades'];
/** How long the sunglasses stay on and the lock screen takes to dissolve (vault.css: 45 % hold, then the fade). */
export const FAREWELL_MS = 1000;

/** Puts the paws and Ghost's eyes in step with the PIN box. Call after anything sets #vaultPin's value. */
export function syncLockFace() {
    const input = $('vaultPin');
    if (!input) return 0;
    const typed = Math.min(PIN_LENGTH, input.value.length);
    const paws = $('vaultPinPaws');
    if (paws) paws.dataset.filled = String(typed);
    const modal = $('vaultModal');
    if (modal) modal.dataset.face = FACES[typed];
    return typed;
}

/**
 * The right PIN: resolves once Ghost's sunglasses have been seen and the lock screen has dissolved (FAREWELL_MS). At once
 * in the plain edition and under "reduce motion", where there is no dissolve. The caller unlocks after it.
 */
export function farewell() {
    const modal = $('vaultModal');
    const still = document.documentElement.dataset.edition === 'plain'
        || (typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches);
    if (!modal || still) return Promise.resolve();
    modal.classList.add('vault-dissolve');
    return new Promise((resolve) => setTimeout(resolve, FAREWELL_MS));
}

