/**
 * vCGE-MOD02: Ghost on the lock screen (cute round V1-V3, raven575 2026-10-21)
 * Created by raven575, Team vCGE (Claude) & Gemini
 *
 * V1: a small Ghost the Raccoon peeks over the PIN box and covers its eyes with its paws while a PIN is being typed
 * ("not looking!"); the box empty again (unlocked, wrong PIN, opened), the paws come down.
 * V2: the PIN box shows four paw prints, filled one per digit typed; the box itself and what screen readers hear are
 * unchanged (a password field of 4 digits).
 * V3: the lock ring is a ringed raccoon tail: dark bands over the ring, masked by the same countdown, so the bands go
 * as the time runs out (main.js moves both rings).
 * All of it is drawing only: nothing is stored, nothing is announced, no sound, no flashing. The paws' one 0.4 s move
 * is instant under "reduce motion" (vault.css), the filled paws differ from empty ones by shape (filled vs outline),
 * not colour, and the plain edition shows none of it (plain dots and the plain ring, as before).
 */
import { PIN_LENGTH } from './sessionPin.js';

const $ = (id) => document.getElementById(id);

/** Puts the paws and Ghost's eyes in step with the PIN box. Call after anything sets #vaultPin's value. */
export function syncLockFace() {
    const input = $('vaultPin');
    if (!input) return 0;
    const typed = Math.min(PIN_LENGTH, input.value.length);
    const paws = $('vaultPinPaws');
    if (paws) paws.dataset.filled = String(typed);
    const modal = $('vaultModal');
    if (modal) modal.dataset.peek = typed > 0 ? 'covered' : 'open';
    return typed;
}

