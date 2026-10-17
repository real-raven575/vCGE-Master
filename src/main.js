/**
 * vCard Generator Engine (vCGE) - Master Integration Controller
 * Created by raven575, Gemini & Claude
 *
 * Wires the modules together over the shared event bus:
 *   MOD03 camera / upload -> MOD04 OCR -> MOD05 mapper -> MOD06 card view -> MOD07 vCard + QR
 *   -> MOD02 temporary vault (memory only) and MOD08 egress (every outbound action).
 * MOD01's network lock (netLock.js) is loaded by index.html before every other script; shell.js, imported first, reports its blocks
 * and starts the postcard deck (deck.js): this controller moves the deck to the card a step lands on and hands the deck its
 * hooks (toast, wipe, cancel, QR flip) so MOD01 never imports another module.
 * Nothing is stored: leaving or reloading the page, or 7 minutes without activity, wipes it. With a session PIN set,
 * the screen turning off or 2 idle minutes lock the card (fingerprint, face or PIN brings it back) and 7 minutes after
 * the lock it is wiped; without one, 30 s out of view or 2 idle minutes wipe it. MOD02's padlock plays at every
 * hand-off between cards and its hold-to-wipe dialog sits behind every red trash button.
 */
import './modules/mod01-shell/shell.js';
import { initSettings } from './modules/mod01-shell/settings.js';
import { go as showCard, use as useDeck, closeSheet } from './modules/mod01-shell/deck.js';
import { globalEventBus, Events } from './share/eventBus.js';
import { CONTACT_FIELDS, CONTACT_LIST_FIELDS, createEmptyContact } from './share/cardSchema.js';
import { temporaryVault, deleteLegacyVault } from './modules/mod02-vault/vault.js';
import { TTLMemoryStreamManager } from './modules/mod02-vault/ttlManager.js';
import { deleteDeviceSecret } from './modules/mod02-vault/keychain.js';
import { SessionPin, RESET_SECONDS, PIN_LENGTH, MAX_PIN_ATTEMPTS, isValidPin } from './modules/mod02-vault/sessionPin.js';
import { BiometricUnlock, biometricAvailable } from './modules/mod02-vault/biometric.js';
import { maskSecretInputs } from './modules/mod02-vault/secretInputs.js';
import { LockHandoff } from './modules/mod02-vault/lockHandoff.js';
import { WipeDialog } from './modules/mod02-vault/wipeDialog.js';
import { VCGEActiveCamera } from './modules/mod03-camera/camera.js';
import { CropEditor } from './modules/mod03-camera/cropEditor.js';
import { executeOCRScan, shutdownOCREngine, readProgress } from './modules/mod04-ocr/ocrWorker.js';
import { ContactFormMapper, LINE_ROLES } from './modules/mod05-form/formMapper.js';
import { PHONE_TYPES, EMAIL_TYPES, WEBSITE_TYPES } from './share/contactOptions.js';
import { AddressAutocompleteEngine } from './modules/mod05-form/addressAutocomplete.js';
import { CardView } from './modules/mod06-gui/card3dView.js';
import { vcgeQREngine } from './modules/mod07-qr/qrGenerator.js';
import { egressController } from './modules/mod08-egress/egressController.js';

const $ = (id) => document.getElementById(id);
const IDLE_PURGE_SECONDS = 120;
// Without a session PIN, out of view (another app, another tab, screen off) for this long wipes everything.
// With one, going out of view locks the card at once instead.
const HIDDEN_WIPE_SECONDS = 30;
// The page going out of view this soon after the app opened the photo picker or a share action is that picker or
// share sheet, so the 2-minute idle rule applies instead of the 30-second one.
const EXTERNAL_APP_GRACE_MS = 5000;
// Plaintext keys written by builds before the vault was wired in; removed on every start.
const LEGACY_PLAINTEXT_KEYS = ['vcge_contact_state', 'vcge_state', 'vcge_prefs'];

const formMapper = new ContactFormMapper();
const cardView = new CardView({ onChange: refresh, addressEngine: new AddressAutocompleteEngine(), formMapper });
const camera = new VCGEActiveCamera();
const cropEditor = new CropEditor();

// 'open': the card is on the page. 'quick': hidden after a lock and held in the temporary vault until the session PIN
// or biometric brings it back (until 7 minutes have passed without activity).
let vaultMode = 'open';
let holding = null;          // Promise from temporaryVault.hold() while a quick lock seals the card
let hiddenDeadline = 0;      // wall-clock time at which a page that is out of view gets wiped (no PIN; 0 = none)
let resetDeadline = 0;       // wall-clock time at which 7 minutes without activity wipe everything (0 = none)
let externalAppUntil = 0;    // until then, the page going out of view is the picker or share sheet the app opened
let leaveGuardArmed = false; // an extra history entry is in place, so Back asks before leaving
let leaving = false;

// 120-second TTL on everything held in RAM: any user activity restarts it; on expiry the card is locked (PIN set) or wiped.
const idleTtl = new TTLMemoryStreamManager(IDLE_PURGE_SECONDS, () => purgeVolatileState('idle'));
const sessionPin = new SessionPin();
const biometric = new BiometricUnlock();
const lockHandoff = new LockHandoff();
// Every red trash button, the Vault page's wipe button and "Wipe and start over" on the lock screen: hold Yes 1.5 s, then wipe and reload.
// Saying No counts as activity. Deleting the saved settings is a signal the dialog publishes; Shell clears its own entry.
const wipeDialog = new WipeDialog({ onWipe: () => wipeSession('wipe button'), onCancel: () => { markActivity(); updateTimerStrip(); } });
let biometricSupported = false;

// ---- Contact pipeline ------------------------------------------------------------------------------------------

function refresh(contact = cardView.getContact()) {
    const vcard = vcgeQREngine.generateVCard30(contact);
    cardView.render(contact);
    // An empty card shows the blank placeholder (never a scannable code) until a field has something in it.
    // The QR payload omits the photo: base64 images exceed QR capacity.
    const hasDetails = vcgeQREngine.hasDetails(contact);
    if (!hasDetails) vcgeQREngine.renderPlaceholder($('qrCanvas'), 320);
    const qrOk = hasDetails && vcgeQREngine.renderQRCode($('qrCanvas'), vcgeQREngine.generateVCard30({ ...contact, avatarBase64: null }), { size: 320 });
    $('qrNotice').classList.toggle('hidden', qrOk || !hasDetails);
    egressController.setPayload(vcard, contact, { qrReal: qrOk, hasDetails });
    globalEventBus.publish(Events.CONTACT_UPDATED, { timestamp: Date.now() });
}

// ---- Temporary vault (MOD02): memory only ----------------------------------------------------------------------

const minutes = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
const resetRemaining = () => (resetDeadline ? Math.max(0, Math.ceil((resetDeadline - Date.now()) / 1000)) : 0);

function setVaultIndicator() {
    const el = $('vaultStateIndicator');
    const [text, color] = vaultMode === 'quick'
        ? [`LOCKED (resets in ${minutes(resetRemaining())})`, 'text-amber-500']
        : ['UNLOCKED / memory only', 'text-emerald-500'];
    el.textContent = text;
    el.className = `text-xs font-mono ${color}`;
    setVaultBadge();
    $('lockVaultBtn').classList.toggle('hidden', vaultMode !== 'open' || !sessionPin.isSet());
    renderQuickUnlockPanel();
    updateTimerStrip();
}

// Header badge: UNLOCKED while the card is on the page, LOCKED while it is held behind the session PIN.
function setVaultBadge() {
    const unlocked = vaultMode === 'open';
    $('vaultBadgeText').textContent = unlocked ? 'Vault: UNLOCKED' : 'Vault: LOCKED';
    $('vaultBadge').className = `flex text-xs px-2.5 py-1 rounded-full items-center gap-1.5 border ${unlocked
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800/50'
        : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`;
    $('vaultBadgeDot').className = `w-1.5 h-1.5 rounded-full ${unlocked ? 'bg-emerald-500' : 'bg-slate-400'}`;
}

// Security panel: session PIN and biometric state.
function renderQuickUnlockPanel() {
    $('quickUnlockPanel').classList.toggle('hidden', vaultMode !== 'open');
    $('sessionPinStatus').textContent = sessionPin.isSet() ? 'Session PIN: set' : 'Session PIN: not set';
    $('setSessionPinBtn').textContent = sessionPin.isSet() ? 'Change' : 'Set PIN';
    $('clearSessionPinBtn').classList.toggle('hidden', !sessionPin.isSet());
    $('vaultLockNowBtn').classList.toggle('hidden', !sessionPin.isSet());
    // Biometric is offered once a PIN is set (the PIN stays the fallback) and only where the device can check it.
    $('biometricRow').classList.toggle('hidden', !biometricSupported || !sessionPin.isSet());
    $('biometricStatus').textContent = biometric.isEnrolled() ? 'Face ID / fingerprint: on' : 'Face ID / fingerprint: off';
    $('addBiometricBtn').classList.toggle('hidden', biometric.isEnrolled());
    $('clearBiometricBtn').classList.toggle('hidden', !biometric.isEnrolled());
}

function openPinModal(reason) {
    const bio = biometric.isEnrolled();
    $('vaultModalHint').textContent = `${reason === 'out of view' ? 'Locked while the screen was off or another app was in front.'
        : `Locked after ${IDLE_PURGE_SECONDS / 60} minutes without activity.`} ${bio ? 'Use your fingerprint or face, or type your PIN.' : `Enter your ${PIN_LENGTH}-digit PIN to continue, or start over to wipe it.`}`;
    $('vaultError').textContent = '';
    $('vaultPin').value = '';
    // Fingerprint or face first and big when it is on; then no keyboard pops up on its own. Without it the PIN box takes focus.
    $('vaultBiometricBtn').classList.toggle('hidden', !bio);
    $('vaultOr').classList.toggle('hidden', !bio);
    $('vaultModal').classList.remove('hidden');
    updateQuickUnlockCountdown();
    if (bio) $('vaultBiometricBtn').focus(); else $('vaultPin').focus();
}

// A phone keyboard can cover the lower half of the lock screen: the PIN box it opened for stays in view.
function keepPinInView() {
    requestAnimationFrame(() => $('vaultPin').scrollIntoView({ block: 'center', behavior: 'smooth' }));
}

function closePinModal() {
    $('vaultPin').value = '';
    $('vaultModal').classList.add('hidden');
}

// Lock screen: a calm green ring empties toward the 7-minute reset, with the time left in its middle.
const LOCK_RING_LENGTH = 2 * Math.PI * 52;   // circumference of #vaultLockRing (r = 52)
function updateQuickUnlockCountdown() {
    if (vaultMode !== 'quick') return;
    const left = resetRemaining();
    $('vaultLockRingTime').textContent = minutes(left);
    $('vaultLockRing').setAttribute('stroke-dashoffset', (LOCK_RING_LENGTH * (1 - left / RESET_SECONDS)).toFixed(2));
    $('quickUnlockCountdown').textContent = `Your card is safe. Without activity, everything resets in ${minutes(left)}; then the card is wiped.`;
}

// Strip under the header: time until the open card locks (PIN set) or is cleared (no PIN). Any tap refills it. The
// last 20 seconds turn it amber (never red) and show one quiet note; it never flashes or makes a sound.
const TIMER_WARN_SECONDS = 20;
const TIMER_CALM = ['bg-white/90', 'text-slate-600', 'border-slate-200', 'dark:bg-slate-900/90', 'dark:text-slate-300', 'dark:border-slate-800'];
const TIMER_WARN = ['bg-amber-50/95', 'text-amber-800', 'border-amber-200', 'dark:bg-amber-950/90', 'dark:text-amber-300', 'dark:border-amber-800/60'];
const NOTE_HIDDEN = ['invisible', 'opacity-0', '-translate-y-1'];
function updateTimerStrip() {
    const remaining = idleTtl.getRemainingTime();
    const show = vaultMode === 'open' && remaining > 0 && hasWork();
    $('vaultTimerStrip').classList.toggle('hidden', !show);
    const warn = show && remaining <= TIMER_WARN_SECONDS;
    NOTE_HIDDEN.forEach(c => $('vaultTimerNote').classList.toggle(c, !warn));
    if (!show) return;
    $('vaultTimerLabel').textContent = sessionPin.isSet() ? 'Locks in' : 'Clears in';
    $('vaultTimerTime').textContent = minutes(remaining);
    $('vaultTimerBar').style.transform = `scaleX(${remaining / IDLE_PURGE_SECONDS})`;
    TIMER_CALM.forEach(c => $('vaultTimerBand').classList.toggle(c, !warn));
    TIMER_WARN.forEach(c => $('vaultTimerBand').classList.toggle(c, warn));
    $('vaultTimerBar').classList.toggle('bg-brand-500', !warn);
    $('vaultTimerBar').classList.toggle('bg-amber-500', warn);
}

let checkingPin = false;
async function submitPin(event) {
    if (event) event.preventDefault();
    if (checkingPin) return;
    checkingPin = true;
    let check;
    try {
        check = await sessionPin.verify($('vaultPin').value);
    } finally {
        checkingPin = false;
    }
    const { result, attemptsLeft } = check;
    if (result === 'ok') return quickUnlock('session PIN');
    if (result === 'locked_out') return wipeSession('too many wrong PINs', `${MAX_PIN_ATTEMPTS} wrong PINs: the card was wiped.`);
    if (result === 'not_set') return wipeSession('session PIN missing');
    $('vaultPin').value = '';
    $('vaultError').textContent = `Wrong PIN. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`;
}

// Lock with a session PIN (idle, screen off, or the Lock button): the card and the scan in progress leave the page and
// are held, encrypted, in the temporary vault until the PIN or biometric brings them back, or the 7-minute reset.
function quickLock(reason = 'idle') {
    if (vaultMode !== 'open') return;
    const payload = { contact: cardView.getContact(), scan: scanSnapshot() };
    idleTtl.stop();
    resetDeadline = Date.now() + RESET_SECONDS * 1000;   // the 7 minutes run from the lock (raven575, 2026-10-17)
    closeQuickUnlockDialogs();
    clearCapturedImages();
    holding = temporaryVault.hold(payload).catch(e => { console.error('[vCGE] Could not hold the card:', e); return false; });
    vaultMode = 'quick';
    cardView.clear();
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_QUICK_LOCKED, { reason, scanKept: !!payload.scan, timestamp: Date.now() });
    openPinModal(reason);
}

async function quickUnlock(method) {
    const sealed = await holding;
    let held = null;
    try {
        held = sealed === false ? null : await temporaryVault.release();
    } catch (e) {
        console.error('[vCGE] Held card unreadable:', e);
    }
    holding = null;
    if (vaultMode !== 'quick') return;   // wiped while unlocking
    if (!held) {
        // The lock could not keep the card: say so instead of opening an empty card as if nothing happened.
        return wipeSession('held card lost', 'The locked card could not be read back, so it was wiped.');
    }
    vaultMode = 'open';
    closePinModal();
    if (held.contact) cardView.setContact(held.contact);
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_UNLOCKED, { method, timestamp: Date.now() });
    markActivity();
    restoreScan(held.scan);
    cardView.showToast(`Unlocked (${method}).`);
}

async function unlockWithBiometric() {
    if (vaultMode !== 'quick' || !biometric.isEnrolled()) return;
    $('vaultError').textContent = '';
    if (await biometric.verify()) return quickUnlock('biometric');
    if (vaultMode === 'quick') $('vaultError').textContent = 'Face or fingerprint not confirmed. Use your PIN.';
}

// Unlock as soon as the 4th digit is typed: no extra tap.
function onPinInput() {
    const input = $('vaultPin');
    input.value = input.value.replace(/[^0-9]/g, '').slice(0, PIN_LENGTH);
    if (input.value.length === PIN_LENGTH) submitPin();
}

// Wipes everything: the card, the photo and scan, the Undo copy, the held card and the session PIN.
// The page stays usable with an empty card.
function wipeSession(reason, message = null) {
    idleTtl.stop();
    hiddenDeadline = 0;
    resetDeadline = 0;
    sessionPin.clear();
    biometric.clear();
    temporaryVault.wipe();
    holding = null;
    closeQuickUnlockDialogs();
    closePinModal();
    $('leaveModal').classList.add('hidden');
    clearCapturedImages();
    vaultMode = 'open';
    cardView.clear();
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_WIPED, { reason, timestamp: Date.now() });
    if (message) cardView.showToast(message);
    if (reason !== 'cancel' && reason !== 'left the page') showCard('capture');
}

function wipeVault() {
    wipeDialog.open();
}

// ---- Session PIN setup -----------------------------------------------------------------------------------------

function openQuickSetup() {
    $('quickSetupHint').textContent = `Choose a ${PIN_LENGTH}-digit PIN for this session. When the screen turns off or after ${IDLE_PURGE_SECONDS / 60} minutes without activity, the card is locked and the PIN brings it back. After ${RESET_SECONDS / 60} minutes without activity, or ${MAX_PIN_ATTEMPTS} wrong tries, everything is wiped. The PIN is forgotten when you leave or reload.`;
    $('quickSetupError').textContent = '';
    $('sessionPinInput').value = '';
    $('quickSetupModal').classList.remove('hidden');
    $('sessionPinInput').focus();
}

async function saveSessionPin(event) {
    event.preventDefault();
    const pin = $('sessionPinInput').value;
    if (!isValidPin(pin)) {
        $('quickSetupError').textContent = `Use exactly ${PIN_LENGTH} digits.`;
        return;
    }
    await sessionPin.set(pin);
    $('sessionPinInput').value = '';
    $('quickSetupModal').classList.add('hidden');
    globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: 'Session PIN set', timestamp: Date.now() });
    setVaultIndicator();
    cardView.showToast('Session PIN set: the card now locks instead of being wiped when the screen turns off.');
}

function closeQuickSetup() {
    $('sessionPinInput').value = '';
    $('quickSetupModal').classList.add('hidden');
}

function clearSessionPin() {
    sessionPin.clear();
    biometric.clear();   // biometric needs the PIN as its fallback
    globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: 'Session PIN removed', timestamp: Date.now() });
    setVaultIndicator();
}

async function addBiometric() {
    if (!sessionPin.isSet()) return;
    expectExternalApp();   // the device's own face or fingerprint sheet comes to the front
    try {
        await biometric.enroll();
        // Only a check that passes right now turns it on: a device that enrols but cannot sign is not "on".
        expectExternalApp();
        if (!(await biometric.verify())) { biometric.clear(); throw new Error('BIOMETRIC_CHECK_FAILED'); }
        globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: 'Face ID / fingerprint added', timestamp: Date.now() });
        cardView.showToast('Face ID / fingerprint added for this session.');
    } catch (e) {
        const why = e && e.name && e.name !== 'Error' ? e.name : (e && e.message) || 'unknown error';
        console.warn('[vCGE] Biometric not added:', why);
        cardView.showToast(`Face ID / fingerprint was not added (${why}). The PIN still works.`);
    }
    setVaultIndicator();
}

function clearBiometric() {
    biometric.clear();
    globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: 'Face ID / fingerprint removed', timestamp: Date.now() });
    setVaultIndicator();
}

// The PIN setup dialog belongs to an open card: any lock or wipe closes it.
function closeQuickUnlockDialogs() {
    closeQuickSetup();
}

// ---- Ephemeral memory lifecycle (TTL purge + startup residue check) -------------------------------------------

function purgeStartupResidue() {
    LEGACY_PLAINTEXT_KEYS.forEach(key => localStorage.removeItem(key));
    const legacy = deleteLegacyVault();
    if (!legacy) return;
    globalEventBus.publish(Events.VAULT_WIPED, { reason: 'copy saved by an older build', timestamp: Date.now() });
    // Desktop: that vault was bound to a device key in the OS keychain, which nothing uses any more.
    if (legacy.keychainBound) deleteDeviceSecret().catch(e => console.error('[vCGE] Could not delete the old keychain device key:', e));
}

function armIdleTtl() {
    if (vaultMode !== 'open') return;
    // The snapshot is zero-filled on expiry (best effort: JS strings are immutable, so the DOM is cleared too).
    idleTtl.startStream(cardView.getContact());
}

// Drops the photo and everything taken from it or kept for convenience (review text, last scan, Undo copy).
function clearCapturedImages() {
    forgetLastScan();
    cardView.forgetUndo();
    egressController.clearPrintSheet();
    camera.stopCamera();
    camera.capturedImageDataUrl = null;
    $('cameraPanel').classList.add('hidden');
    $('reviewImage').removeAttribute('src');
    closeReviewDialog();
    const capture = $('captureCanvas');
    capture.width = 0;
    capture.height = 0;
}

function purgeVolatileState(reason) {
    idleTtl.stop();
    globalEventBus.publish(Events.MEMORY_PURGED, { reason, timestamp: Date.now() });
    if (sessionPin.isSet()) {
        quickLock();
        cardView.showToast(`Hidden after ${IDLE_PURGE_SECONDS / 60} minutes without activity.`);
    } else {
        wipeSession(reason, `Wiped after ${IDLE_PURGE_SECONDS / 60} minutes without activity.`);
    }
}

function updatePurgeCountdown() {
    const el = $('purgeCountdown');
    el.textContent = vaultMode === 'quick' ? `Resets in ${resetRemaining()} s`
        : idleTtl.timerId ? `Auto-clear in ${idleTtl.getRemainingTime()} s` : 'Auto-clear idle';
    if (vaultMode === 'quick') {
        setVaultIndicator();
        updateQuickUnlockCountdown();
    } else {
        updateTimerStrip();
    }
}

// ---- Leaving the page: Back guard, wipe on leave, wipe after 30 s out of view ---------------------------------

// True when wiping would lose something: a card being filled in, a photo or scan, or a card held behind the PIN.
function hasWork() {
    if (vaultMode === 'quick' || $('reviewImage').getAttribute('src') || lastScan) return true;
    const contact = cardView.getContact(), empty = createEmptyContact();
    return !!contact.avatarBase64 || CONTACT_FIELDS.some(f => (contact[f] || '') !== (empty[f] || ''))
        || CONTACT_LIST_FIELDS.some(f => contact[f].length > 0);
}

// Back (button or swipe) first lands on an extra history entry, so the app can ask before the card is wiped.
// Browsers skip history entries added without a user gesture, so the entry is added on a tap or key press.
function armLeaveGuard() {
    if (leaveGuardArmed || leaving || !$('leaveModal').classList.contains('hidden')) return;
    if (navigator.userActivation && !navigator.userActivation.isActive) return;
    history.pushState({ vcgeLeaveGuard: true }, '');
    leaveGuardArmed = true;
}

function onPopState(event) {
    if (event.state && event.state.vcgeLeaveGuard) {   // Forward onto the guard entry again
        leaveGuardArmed = true;
        return;
    }
    if (leaving || !leaveGuardArmed) return;
    leaveGuardArmed = false;
    if (!hasWork()) return leavePage();
    $('leaveModal').classList.remove('hidden');
}

function stayOnPage() {
    $('leaveModal').classList.add('hidden');
    armLeaveGuard();
}

function leavePage() {
    leaving = true;
    wipeSession('left the page');
    history.back();
}

// Closing, reloading or navigating away (including into the back/forward cache): wipe before the page goes.
function onPageHide() {
    wipeSession('left the page');
}

function onPageShow(event) {
    if (!event.persisted) return;
    // Restored from the back/forward cache: it was wiped when it was left.
    leaving = false;
    leaveGuardArmed = false;
    cardView.showToast('Everything was wiped when you left the page.');
}

function onVisibilityChange() {
    if (document.visibilityState === 'hidden') {
        hiddenDeadline = 0;
        if (Date.now() < externalAppUntil) return;   // the photo picker or share sheet the app opened
        // With a PIN: lock at once, so nothing is on screen when the phone wakes. Without one: wipe after 30 s.
        if (sessionPin.isSet()) {
            if (vaultMode === 'open' && hasWork()) quickLock('out of view');
        } else {
            hiddenDeadline = Date.now() + HIDDEN_WIPE_SECONDS * 1000;
        }
    } else {
        // Phones freeze timers in the background, so the deadlines are checked as the page comes back.
        checkResetDeadline();
        checkHiddenDeadline();
        hiddenDeadline = 0;
    }
}

function checkHiddenDeadline() {
    if (!hiddenDeadline || Date.now() < hiddenDeadline) return;
    hiddenDeadline = 0;
    wipeSession(`out of view for ${HIDDEN_WIPE_SECONDS} s`, `Wiped: the app was out of view for more than ${HIDDEN_WIPE_SECONDS} seconds.`);
}

// 7 minutes without activity while the card is open, or 7 minutes after a lock: everything is wiped.
function checkResetDeadline() {
    if (!resetDeadline || Date.now() < resetDeadline) return;
    resetDeadline = 0;
    if (hasWork()) wipeSession(`${RESET_SECONDS / 60} minutes without activity`, `Reset: ${RESET_SECONDS / 60} minutes without activity, so everything was wiped.`);
}

// Activity while the card is open restarts the idle lock and the 7-minute reset. Typing at the lock screen does not.
function markActivity() {
    if (vaultMode !== 'open') return;
    armIdleTtl();
    resetDeadline = Date.now() + RESET_SECONDS * 1000;
}

// The app is about to open the photo picker or a share action (another app may come to the front).
function expectExternalApp() {
    externalAppUntil = Date.now() + EXTERNAL_APP_GRACE_MS;
}

function onActivity() {
    markActivity();
    armLeaveGuard();
    if (vaultMode === 'open') updateTimerStrip();
}

// ---- Intake: camera / upload (MOD03) -> OCR (MOD04) -> mapper (MOD05) -----------------------------------------

// Retake prompt in the review dialog (shown when a photo is too blurry or unclear to read).
function showRetakePrompt(show) {
    $('ocrRetakeNotice').classList.toggle('hidden', !show);
    $('retakePhotoBtn').classList.toggle('hidden', !show);
    $('runOcrBtn').classList.toggle('hidden', show);
}

// Labels for the "Will fill" summary of the review step.
const FIELD_LABELS = {
    namePrefix: 'Prefix', firstName: 'First name', middleName: 'Middle name', lastName: 'Last name', nameSuffix: 'Suffix',
    jobTitle: 'Job title', organization: 'Company', phones: 'Phone', emails: 'Email', websites: 'Website',
    street: 'Street', unitType: 'Unit type', unitNumber: 'Unit number', city: 'City', state: 'State / region', zip: 'Postal code',
    country: 'Country', notes: 'Notes'
};
const TYPE_LABELS = { phones: PHONE_TYPES, emails: EMAIL_TYPES, websites: WEBSITE_TYPES };
// Names of the icons MOD04 can recognise in front of a line (shown in the review step).
const ICON_NAMES = {
    phone: 'Phone icon', mobile: 'Mobile icon', email: 'Email icon', web: 'Web icon', address: 'Address icon', home: 'Home icon',
    fax: 'Fax icon', linkedin: 'LinkedIn logo', x: 'X logo', facebook: 'Facebook logo', instagram: 'Instagram logo',
    github: 'GitHub logo', youtube: 'YouTube logo', tiktok: 'TikTok logo'
};
let ocrReview = null;   // { lines: [{ text, role }], fields } while the review step is open
let lastScan = null;    // the reviewed lines of the last filled scan, for "Reopen last scan" (memory only)

function showReviewStep(step) {
    $('ocrStepPhoto').classList.toggle('hidden', step !== 'photo');
    $('ocrStepText').classList.toggle('hidden', step !== 'text');
}

// Closes the dialog and drops the extracted text (it is contact data, so it is not kept around).
function closeReviewDialog() {
    $('cropReviewModal').classList.add('hidden');
    $('ocrTimeoutModal').classList.add('hidden');
    showReviewStep('photo');
    ocrReview = null;
    $('ocrLines').replaceChildren();
    $('ocrSummary').replaceChildren();
}

function renderOcrSummary() {
    const { fields, derived } = formMapper.buildFields(ocrReview.lines);
    ocrReview.fields = fields;
    const entry = (label, value) => {
        const dt = document.createElement('dt');
        dt.className = 'text-slate-500 dark:text-slate-400';
        dt.textContent = label;
        const dd = document.createElement('dd');
        dd.className = 'min-w-0 break-words';
        dd.textContent = value;
        return [dt, dd];
    };
    // Country is only shown when the card says something other than the default.
    const items = Object.keys(FIELD_LABELS).flatMap(k => {
        if (TYPE_LABELS[k]) {
            return fields[k].flatMap(({ type, value }) => {
                const typeLabel = (TYPE_LABELS[k].find(([v]) => v === type) || [, type])[1];
                return entry(`${FIELD_LABELS[k]} (${typeLabel})`, value);
            });
        }
        if (!fields[k] || (k === 'country' && fields.country === 'United States')) return [];
        return entry(FIELD_LABELS[k], fields[k] + (derived[k] ? ` (from ${derived[k]})` : ''));
    });
    if (!items.length) {
        const dd = document.createElement('dd');
        dd.className = 'col-span-2 text-slate-500 dark:text-slate-400';
        dd.textContent = 'Nothing yet: choose what the lines are.';
        items.push(dd);
    }
    $('ocrSummary').replaceChildren(...items);
}

// One row per OCR line: editable text + role picker. Built with DOM nodes, never HTML strings (OCR text is untrusted).
function renderOcrLines() {
    const rows = ocrReview.lines.map((line, i) => {
        const row = document.createElement('div');
        row.className = 'flex gap-2 items-center';
        const text = document.createElement('input');
        text.type = 'text';
        text.id = `ocrLineText${i}`;
        text.className = 'field-input flex-1 min-w-0';
        text.value = line.text;
        text.setAttribute('aria-label', `Line ${i + 1} text`);
        // MOD05 asks for a check: a ZIP the state doesn't use, or letters the reader was unsure of.
        const note = document.createElement('p');
        text.addEventListener('input', () => {
            line.text = text.value;
            // Edited means checked: the note to check this line goes away.
            if (line.check) { delete line.check; text.classList.remove('border-amber-500', 'dark:border-amber-400'); text.removeAttribute('aria-describedby'); note.remove(); }
            renderOcrSummary();
        });
        const role = document.createElement('select');
        role.id = `ocrLineRole${i}`;
        role.className = 'field-input w-44 shrink-0';
        role.setAttribute('aria-label', `Line ${i + 1} is`);
        LINE_ROLES.forEach(([value, label]) => role.add(new Option(label, value, false, value === line.role)));
        role.addEventListener('change', () => { line.role = role.value; renderOcrSummary(); });
        if (line.icon && ICON_NAMES[line.icon]) {
            const chip = document.createElement('span');
            chip.id = `ocrLineIcon${i}`;
            chip.className = 'shrink-0 text-[10px] font-semibold px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400';
            chip.textContent = ICON_NAMES[line.icon];
            chip.title = 'Icon seen in front of this line';
            row.append(chip);
        }
        row.append(text, role);
        if (!line.check) return row;
        note.id = `ocrLineCheck${i}`;
        note.className = 'text-xs text-amber-600 dark:text-amber-400 pl-1';
        note.textContent = line.check;
        text.classList.add('border-amber-500', 'dark:border-amber-400');
        text.setAttribute('aria-describedby', note.id);
        const wrap = document.createElement('div');
        wrap.className = 'space-y-0.5';
        wrap.append(row, note);
        return wrap;
    });
    $('ocrLines').replaceChildren(...rows);
    renderOcrSummary();
}

// Reading progress: the bar fills fast, then slower than real time, and is full when the 60 s read limit runs out.
const ocrProgress = {
    timer: null,
    set(fraction) {
        const pct = Math.round(fraction * 100);
        $('ocrProgressFill').style.width = `${pct}%`;
        $('ocrProgressBar').setAttribute('aria-valuenow', String(pct));
    },
    show() {
        this.stop(); this.set(0);
        $('ocrProgressLabel').textContent = 'Extracting…';
        $('ocrPhotoActions').classList.add('hidden');
        $('ocrProgress').classList.remove('hidden');
    },
    // 'starting': the bar waits at 0 while the reader loads; 'reading': it starts filling.
    status(status) {
        $('ocrProgressLabel').textContent = status === 'starting' ? 'Preparing the reader…' : 'Extracting…';
        if (status !== 'reading' || this.timer) return;
        const started = Date.now();
        this.timer = setInterval(() => this.set(readProgress(Date.now() - started)), 100);
    },
    stop() { clearInterval(this.timer); this.timer = null; },
    hide() {
        this.stop();
        $('ocrProgress').classList.add('hidden');
        $('ocrPhotoActions').classList.remove('hidden');
    }
};
let ocrStoppedByUser = false;

async function runOcr() {
    if (!$('reviewImage').src) return;
    showRetakePrompt(false);
    ocrStoppedByUser = false;
    $('runOcrBtn').disabled = true;
    $('runOcrBtn').textContent = 'Extracting…';
    ocrProgress.show();
    try {
        // The first scan (and the first after a wipe) starts the reader from ~7 MB of bundled files: say so.
        const onStatus = (status) => {
            $('runOcrBtn').textContent = status === 'starting' ? 'Preparing the reader…' : 'Extracting…';
            ocrProgress.status(status);
        };
        const { text, lines } = await executeOCRScan(cropEditor.getCroppedImage(), { onStatus });
        // Finished early: the bar fills up before the review step opens.
        ocrProgress.stop(); ocrProgress.set(1);
        await new Promise(res => setTimeout(res, 250));
        if ($('cropReviewModal').classList.contains('hidden')) return;   // closed by a wipe meanwhile
        ocrReview = { lines: formMapper.classifyLines(lines && lines.length ? lines : text), fields: null };
        renderOcrLines();
        showReviewStep('text');
    } catch (e) {
        if (e && e.code === 'OCR_CANCELLED') {
            // Cancel: back to the photo, ready to extract again or take a new one. A wipe already cleared the dialog.
            if (ocrStoppedByUser) $('retakePhotoBtn').classList.remove('hidden');
            return;
        }
        console.error('[vCGE] OCR failed:', e);
        if (e && e.code === 'OCR_UNREADABLE') {
            showRetakePrompt(true);
        } else if (e && e.code === 'OCR_TIMEOUT') {
            // The reader was restarted; the photo stays for Try Again.
            ocrProgress.stop(); ocrProgress.set(1);
            $('ocrTimeoutModal').classList.remove('hidden');
            $('ocrTryAgainBtn').focus();
        } else if (e && e.code === 'OCR_UNAVAILABLE') {
            closeReviewDialog();
            cardView.showToast('The OCR engine could not start, so your form was not changed. Type the details in, or try again.');
        } else {
            cardView.showToast('Could not read that image.');
        }
    } finally {
        ocrProgress.hide();
        $('runOcrBtn').disabled = false;
        $('runOcrBtn').textContent = 'Extract fields';
    }
}

// Cancel while reading: the reader is stopped at once (MOD04 drops it and anything it read).
function stopOcr() {
    ocrStoppedByUser = true;
    shutdownOCREngine();
}

// After a timeout: Try Again reads the same photo with a fresh reader; Cancel goes back to the photo step.
function closeTimeoutPrompt(retry) {
    $('ocrTimeoutModal').classList.add('hidden');
    if (retry) runOcr();
    else $('retakePhotoBtn').classList.remove('hidden');
}

function applyOcrReview() {
    if (!ocrReview) return;
    const { fields, lines } = ocrReview;
    lastScan = lines.map(line => ({ ...line }));
    $('reopenScanBtn').classList.remove('hidden');
    closeReviewDialog();
    cardView.changeWithUndo('Form filled. Please check the details.', () => cardView.mergeContact(fields));
    showCard('fields');
}

// Opens the review step again with the last scan's lines (as last edited), without running OCR again.
function reopenLastScan() {
    if (!lastScan) return;
    ocrReview = { lines: lastScan.map(line => ({ ...line })), fields: null };
    renderOcrLines();
    $('ocrBackBtn').classList.toggle('hidden', !$('reviewImage').getAttribute('src'));
    showReviewStep('text');
    $('cropReviewModal').classList.remove('hidden');
    showCard('read');
}

function forgetLastScan() {
    lastScan = null;
    $('reopenScanBtn').classList.add('hidden');
}

// What a quick lock keeps of the scan in progress: the photo, the open review step and the last scan.
function scanSnapshot() {
    const photo = $('reviewImage').getAttribute('src') || null;
    const open = !$('cropReviewModal').classList.contains('hidden');
    const review = open ? { lines: ocrReview && !$('ocrStepText').classList.contains('hidden') ? ocrReview.lines.map(line => ({ ...line })) : null } : null;
    if (!review && !lastScan) return null;
    return { photo, review, lastScan };
}


// Puts a scan held through a quick lock back: the review dialog at the step it was on, and "Reopen last scan".
function restoreScan(scan) {
    if (!scan) return;
    if (scan.photo) {
        camera.capturedImageDataUrl = scan.photo;
        $('reviewImage').src = scan.photo;
    }
    if (scan.lastScan) {
        lastScan = scan.lastScan;
        $('reopenScanBtn').classList.remove('hidden');
    }
    if (!scan.review) return;
    if (scan.review.lines) {
        ocrReview = { lines: scan.review.lines, fields: null };
        renderOcrLines();
        showReviewStep('text');
    } else {
        showReviewStep('photo');
    }
    $('ocrBackBtn').classList.toggle('hidden', !scan.photo);
    $('cropReviewModal').classList.remove('hidden');
    showCard('read');
}

function wireIntake() {
    $('imageUpload').addEventListener('click', expectExternalApp);
    $('imageUpload').addEventListener('change', (e) => {
        camera.handleGalleryUpload(e.target.files[0]);
        e.target.value = '';
    });
    $('startCameraBtn').addEventListener('click', async () => {
        $('cameraPanel').classList.remove('hidden');
        await camera.initCamera();
    });
    $('captureBtn').addEventListener('click', () => camera.captureFrame());
    $('switchCameraBtn').addEventListener('click', () => camera.switchCamera());
    $('stopCameraBtn').addEventListener('click', () => {
        camera.stopCamera();
        $('cameraPanel').classList.add('hidden');
    });
    $('runOcrBtn').addEventListener('click', runOcr);
    $('ocrStopBtn').addEventListener('click', stopOcr);
    $('ocrTryAgainBtn').addEventListener('click', () => closeTimeoutPrompt(true));
    $('ocrTimeoutCancelBtn').addEventListener('click', () => closeTimeoutPrompt(false));
    $('rotatePhotoBtn').addEventListener('click', () => { showRetakePrompt(false); cropEditor.rotate(); });
    $('cancelReviewBtn').addEventListener('click', () => { closeReviewDialog(); showCard('capture'); });
    $('ocrCancelBtn').addEventListener('click', () => { closeReviewDialog(); showCard('capture'); });
    $('ocrBackBtn').addEventListener('click', () => showReviewStep('photo'));
    $('applyOcrBtn').addEventListener('click', applyOcrReview);
    $('reopenScanBtn').addEventListener('click', reopenLastScan);
    // Retake: with the camera open, close the dialog so the user can capture again; otherwise pick another photo
    // (on phones the picker also offers the camera).
    $('retakePhotoBtn').addEventListener('click', () => {
        closeReviewDialog();
        showCard('capture');
        if ($('cameraPanel').classList.contains('hidden')) $('imageUpload').click();
        else cardView.showToast('Hold the card steady and capture again.');
    });
    // A new photo starts over at step 1 and drops any text extracted from the previous one (the camera reopens the dialog).
    globalEventBus.subscribe(Events.IMAGE_CAPTURED, () => { showRetakePrompt(false); closeReviewDialog(); forgetLastScan(); $('ocrBackBtn').classList.remove('hidden'); showCard('read'); });
}

// ---- Egress (MOD08 only) ---------------------------------------------------------------------------------------

function wireEgress() {
    // A share or download may bring another app to the front: the 2-minute idle rule applies, not the screen-off lock or 30 s wipe.
    ['downloadVcfBtn', 'exportQrBtn', 'emailBtn', 'smsBtn', 'printCardBtn', 'shareNativeBtn', 'copyVcardBtn']
        .forEach(id => $(id).addEventListener('click', expectExternalApp, true));
    $('downloadVcfBtn').addEventListener('click', () => egressController.downloadVcf());
    $('exportQrBtn').addEventListener('click', () => {
        const result = egressController.exportQRPNG($('qrCanvas'));
        if (result.reason === 'empty') cardView.showToast('Add a contact first.');
        else if (result.reason === 'qr_too_large') cardView.showToast('Too much information for one QR code: use .vcf or Share instead.');
    });
    $('emailBtn').addEventListener('click', () => egressController.triggerEmailShare());
    $('smsBtn').addEventListener('click', () => egressController.triggerSmsShare());
    $('printCardBtn').addEventListener('click', () => {
        if (egressController.triggerPhysicalPrint($('qrCanvas')).reason === 'empty') cardView.showToast('Add a contact first.');
    });
    $('shareNativeBtn').addEventListener('click', async () => {
        const result = await egressController.triggerQuickShare();
        if (result && result.reason === 'share_unavailable') cardView.showToast('Sharing is not available here: use .vcf, Email or Copy.');
        else if (result && result.reason === 'share_failed') cardView.showToast('Sharing did not work: use .vcf, Email or Copy.');
    });
    // Copy only on request: the clipboard is outside the app, so a wipe cannot clear it.
    $('copyVcardBtn').addEventListener('click', async () => {
        const result = await egressController.copyVCard();
        if (result.success) cardView.showToast('vCard copied. The clipboard is not cleared when vCGE wipes.');
        else if (result.reason === 'clipboard_unavailable') cardView.showToast('Copying is not available on this device.');
    });
}

// ---- Audit trail (telemetry visibility) ------------------------------------------------------------------------

function wireAuditLog() {
    const list = $('auditLog');
    const describe = {
        [Events.EXPORT_DISPATCHED]: (d) => `MOD08 egress: ${d.method}`,
        [Events.EGRESS_BLOCKED]: (d) => `Blocked ${d.api} → ${d.url}`,
        [Events.VAULT_UNLOCKED]: (d) => `Vault unlocked (${d.method})`,
        [Events.VAULT_QUICK_LOCKED]: (d) => `Card${d.scanKept ? ' and scan' : ''} hidden behind the PIN (${d.reason})`,
        [Events.VAULT_UNLOCK_METHOD_CHANGED]: (d) => d.change,
        [Events.VAULT_WIPED]: (d) => `Vault wiped${d.reason && d.reason !== 'wipe button' ? ` (${d.reason})` : ''}`,
        [Events.OCR_TEXT_EXTRACTED]: (d) => `OCR text extracted${d.icons ? ` (${d.icons} icon${d.icons === 1 ? '' : 's'} recognised)` : ''}`,
        [Events.MEMORY_PURGED]: (d) => `RAM purged (${d.reason})`
    };
    Object.entries(describe).forEach(([event, fmt]) => {
        globalEventBus.subscribe(event, (data) => {
            const li = document.createElement('li');
            li.textContent = `${new Date().toLocaleTimeString()}  ${fmt(data || {})}`;
            list.prepend(li);
            while (list.children.length > 8) list.lastChild.remove();
        });
    });
}

// ---- Boot ------------------------------------------------------------------------------------------------------

function boot() {
    maskSecretInputs();
    initSettings();          // the one saved entry: hand, colour-blind mode, theme, font
    // MOD01's deck talks to the other modules only through these hooks (and the CARD_CHANGED signal on the bus).
    useDeck({
        toast: (message) => cardView.showToast(message),
        wipe: () => wipeVault(),
        cancel: () => wipeSession('cancel'),
        showQr: () => cardView.setFlipped(true)
    });
    cardView.init();
    lockHandoff.init();      // follows the deck's CARD_CHANGED signal
    wipeDialog.init();
    wireAuditLog();
    purgeStartupResidue();
    wireIntake();
    wireEgress();
    $('vaultForm').addEventListener('submit', submitPin);
    $('vaultPin').addEventListener('input', onPinInput);
    $('vaultBiometricBtn').addEventListener('click', unlockWithBiometric);
    $('vaultPin').addEventListener('focus', keepPinInView);
    $('vaultStartOverBtn').addEventListener('click', wipeVault);
    $('lockVaultBtn').addEventListener('click', () => { if (sessionPin.isSet()) quickLock('Lock button'); });
    $('vaultLockNowBtn').addEventListener('click', () => { if (sessionPin.isSet()) { closeSheet('vaultPage'); quickLock('Lock button'); } });
    $('quickSetupForm').addEventListener('submit', saveSessionPin);
    $('quickSetupSkipBtn').addEventListener('click', closeQuickSetup);
    $('setSessionPinBtn').addEventListener('click', openQuickSetup);
    $('clearSessionPinBtn').addEventListener('click', clearSessionPin);
    $('addBiometricBtn').addEventListener('click', addBiometric);
    $('clearBiometricBtn').addEventListener('click', clearBiometric);
    $('wipeVaultBtn').addEventListener('click', wipeVault);
    $('vaultTimerKeepBtn').addEventListener('click', () => { markActivity(); updateTimerStrip(); });
    $('leaveStayBtn').addEventListener('click', stayOnPage);
    $('leaveConfirmBtn').addEventListener('click', leavePage);
    $('clearFormBtn').addEventListener('click', () => cardView.changeWithUndo('Form cleared.', () => cardView.clear()));
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    ['pointerdown', 'pointerup', 'keydown', 'input'].forEach(type => document.addEventListener(type, onActivity, true));
    setInterval(() => { updatePurgeCountdown(); checkHiddenDeadline(); checkResetDeadline(); }, 1000);
    refresh();
    setVaultIndicator();
    updatePurgeCountdown();
    biometricAvailable().then(ok => { biometricSupported = ok; setVaultIndicator(); });
}

boot();
