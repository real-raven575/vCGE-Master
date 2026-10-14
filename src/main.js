/**
 * vCard Generator Engine (vCGE) - Master Integration Controller
 * Created by raven575, Gemini & Claude
 *
 * Wires the modules together over the shared event bus:
 *   MOD03 camera / upload -> MOD04 OCR -> MOD05 mapper -> MOD06 card view -> MOD07 vCard + QR
 *   -> MOD02 vault (encrypted persistence) and MOD08 egress (every outbound action).
 * MOD01 is imported first so its network gatekeeper is installed before any other module code runs.
 */
import './modules/mod01-shell/shell.js';
import { initTheme } from './modules/mod01-shell/themeManager.js';
import { globalEventBus, Events } from './share/eventBus.js';
import { secureVault } from './modules/mod02-vault/vault.js';
import { TTLMemoryStreamManager } from './modules/mod02-vault/ttlManager.js';
import { getDeviceSecret, deleteDeviceSecret, isKeychainAvailable } from './modules/mod02-vault/keychain.js';
import { KDF_KEYCHAIN } from './modules/mod02-vault/vault.js';
import { isPasskeySupported, createPasskey, getPasskeySecret } from './modules/mod02-vault/passkey.js';
import { SessionPin, QUICK_UNLOCK_SECONDS, MIN_PIN_LENGTH, MAX_PIN_ATTEMPTS } from './modules/mod02-vault/sessionPin.js';
import { maskSecretInputs } from './modules/mod02-vault/secretInputs.js';
import { VCGEActiveCamera } from './modules/mod03-camera/camera.js';
import { CropEditor } from './modules/mod03-camera/cropEditor.js';
import { executeOCRScan } from './modules/mod04-ocr/ocrWorker.js';
import { ContactFormMapper, LINE_ROLES } from './modules/mod05-form/formMapper.js';
import { PHONE_TYPES, EMAIL_TYPES, WEBSITE_TYPES } from './share/contactOptions.js';
import { AddressAutocompleteEngine } from './modules/mod05-form/addressAutocomplete.js';
import { CardView } from './modules/mod06-gui/card3dView.js';
import { vcgeQREngine } from './modules/mod07-qr/qrGenerator.js';
import { egressController } from './modules/mod08-egress/egressController.js';

const $ = (id) => document.getElementById(id);
const MIN_PASSPHRASE_LENGTH = 8;
const SAVE_DEBOUNCE_MS = 400;
const IDLE_PURGE_SECONDS = 120;
// Plaintext keys written by builds before the vault was wired in; removed on every start.
const LEGACY_PLAINTEXT_KEYS = ['vcge_contact_state', 'vcge_state', 'vcge_prefs'];

const formMapper = new ContactFormMapper();
const cardView = new CardView({ onChange: refresh, addressEngine: new AddressAutocompleteEngine(), formMapper });
const camera = new VCGEActiveCamera();
const cropEditor = new CropEditor();

// 'quick': the card is hidden after an idle lock but the vault key is still in memory, so the session PIN can resume it.
let storageMode = 'locked'; // 'locked' | 'quick' | 'vault' | 'memory'
let vaultModalMode = 'passphrase'; // 'create' | 'passphrase' | 'pin'
let saveTimer = null;
let quickSetupDismissed = false;

// 120-second TTL on everything held in RAM: any user activity restarts it; on expiry the volatile state is purged.
const idleTtl = new TTLMemoryStreamManager(IDLE_PURGE_SECONDS, () => purgeVolatileState('idle'));
// After an idle lock with a session PIN set, the vault key is kept for 5 minutes; then the vault locks fully.
const quickUnlockTtl = new TTLMemoryStreamManager(QUICK_UNLOCK_SECONDS, () => lockVault('quick unlock expired'));
const sessionPin = new SessionPin();

// ---- Contact pipeline ------------------------------------------------------------------------------------------

function refresh(contact = cardView.getContact()) {
    const vcard = vcgeQREngine.generateVCard30(contact);
    cardView.render(contact);
    // The QR payload omits the photo: base64 images exceed QR capacity.
    const qrOk = vcgeQREngine.renderQRCode($('qrCanvas'), vcgeQREngine.generateVCard30({ ...contact, avatarBase64: null }), { size: 320 });
    $('qrNotice').classList.toggle('hidden', qrOk);
    egressController.setPayload(vcard, contact);
    globalEventBus.publish(Events.CONTACT_UPDATED, { timestamp: Date.now() });
    scheduleSave(contact);
}

function scheduleSave(contact) {
    if (storageMode !== 'vault') return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => persist(contact), SAVE_DEBOUNCE_MS);
}

async function persist(contact) {
    if (storageMode !== 'vault') return;
    try {
        await secureVault.encryptAndStore(contact);
        globalEventBus.publish(Events.VAULT_SAVED, { timestamp: Date.now() });
    } catch (e) {
        console.error('[vCGE] Vault save failed:', e);
        cardView.showToast('Could not save to the vault (storage full or vault locked).');
    }
}

// ---- Vault (MOD02) ---------------------------------------------------------------------------------------------

const minutes = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function setVaultIndicator() {
    const el = $('vaultStateIndicator');
    const states = {
        vault: [secureVault.kdf === KDF_KEYCHAIN ? 'UNLOCKED / AES-256 + OS keychain' : 'UNLOCKED / AES-256 (saving)', 'text-emerald-500'],
        quick: [`LOCKED (PIN for ${minutes(quickUnlockTtl.getRemainingTime())})`, 'text-amber-500'],
        memory: ['NOT SAVED (memory only)', 'text-amber-500'],
        locked: ['LOCKED', 'text-slate-400']
    };
    const [text, color] = states[storageMode];
    el.textContent = text;
    el.className = `text-xs font-mono ${color}`;
    setVaultBadge();
    $('lockVaultBtn').classList.toggle('hidden', storageMode !== 'vault');
    renderQuickUnlockPanel();
}

// Header badge: UNLOCKED only while the vault key is in use; a quick lock or memory-only mode reads as LOCKED.
function setVaultBadge() {
    const unlocked = storageMode === 'vault';
    $('vaultBadgeText').textContent = unlocked ? 'Vault: UNLOCKED' : 'Vault: LOCKED';
    $('vaultBadge').className = `flex text-xs px-2.5 py-1 rounded-full items-center gap-1.5 border ${unlocked
        ? 'bg-emerald-50 text-emerald-700 border-emerald-200 dark:bg-emerald-950 dark:text-emerald-400 dark:border-emerald-800/50'
        : 'bg-slate-100 text-slate-600 border-slate-200 dark:bg-slate-800 dark:text-slate-300 dark:border-slate-700'}`;
    $('vaultBadgeDot').className = `w-1.5 h-1.5 rounded-full ${unlocked ? 'bg-emerald-500' : 'bg-slate-400'}`;
}

// Security panel: session PIN state and the enrolled passkeys (vault mode only).
function renderQuickUnlockPanel() {
    $('quickUnlockPanel').classList.toggle('hidden', storageMode !== 'vault');
    $('sessionPinStatus').textContent = sessionPin.isSet() ? 'Session PIN: set' : 'Session PIN: not set';
    $('setSessionPinBtn').textContent = sessionPin.isSet() ? 'Change' : 'Set PIN';
    $('clearSessionPinBtn').classList.toggle('hidden', !sessionPin.isSet());
    const supported = isPasskeySupported();
    $('addPasskeyBtn').classList.toggle('hidden', !supported);
    $('passkeyUnsupported').classList.toggle('hidden', supported);
    const items = secureVault.passkeySlots().map((slot, i) => {
        const li = document.createElement('li');
        li.className = 'flex items-center justify-between gap-2';
        const name = document.createElement('span');
        name.id = `passkeyName${i}`;
        name.className = 'truncate';
        name.textContent = `🔑 ${slot.label}`;
        const remove = document.createElement('button');
        remove.type = 'button';
        remove.id = `passkeyRemove${i}`;
        remove.className = 'shrink-0 hover:text-rose-500';
        remove.textContent = 'Remove';
        remove.addEventListener('click', () => {
            if (!confirm(`Remove the passkey "${slot.label}"? It will no longer unlock this vault.`)) return;
            secureVault.removePasskeySlot(slot.id);
            globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: 'Passkey removed', timestamp: Date.now() });
            renderQuickUnlockPanel();
        });
        li.append(name, remove);
        return li;
    });
    $('passkeyList').replaceChildren(...items);
}

function setVaultModalMode(mode) {
    vaultModalMode = mode;
    const creating = mode === 'create', pin = mode === 'pin';
    const passkeys = !creating && isPasskeySupported() && secureVault.passkeySlots().length > 0;
    $('vaultModalTitle').textContent = creating ? 'Create your encrypted vault' : pin ? 'Locked' : 'Unlock your vault';
    $('vaultModalHint').textContent = creating
        ? `Choose a passphrase (at least ${MIN_PASSPHRASE_LENGTH} characters). Your card is encrypted on this device with AES-256; the passphrase cannot be recovered.`
        : pin
            ? `Hidden after ${IDLE_PURGE_SECONDS / 60} minutes without activity. Enter your session PIN to continue${passkeys ? ', or use a passkey' : ''}.`
            : `Enter your passphrase${passkeys ? ' or use a passkey' : ''} to decrypt your saved card on this device.`;
    $('vaultPinRow').classList.toggle('hidden', !pin);
    $('quickUnlockCountdown').classList.toggle('hidden', !pin);
    $('vaultPassphraseRow').classList.toggle('hidden', pin);
    $('vaultConfirmRow').classList.toggle('hidden', !creating);
    $('vaultUsePassphraseBtn').classList.toggle('hidden', !pin);
    $('vaultPasskeyBtn').classList.toggle('hidden', !passkeys);
    $('vaultPasskeyHint').classList.toggle('hidden', !passkeys);
    $('vaultUnlockBtn').textContent = creating ? 'Create vault' : 'Unlock';
    $('vaultError').textContent = '';
    $('vaultPin').value = '';
    $('vaultPassphrase').value = '';
    $('vaultPassphraseConfirm').value = '';
    updateQuickUnlockCountdown();
    $(pin ? 'vaultPin' : 'vaultPassphrase').focus();
}

function openVaultModal() {
    $('vaultModal').classList.remove('hidden');
    setVaultModalMode(!secureVault.hasStoredVault() ? 'create' : storageMode === 'quick' ? 'pin' : 'passphrase');
}

function updateQuickUnlockCountdown() {
    if (storageMode !== 'quick') return;
    $('quickUnlockCountdown').textContent = `PIN unlock available for ${minutes(quickUnlockTtl.getRemainingTime())}; then the passphrase is needed.`;
}

// Desktop (Tauri): the device key held in the OS keychain, when this vault is bound to it (or is being created).
async function deviceSecretFor(creating) {
    if (!isKeychainAvailable() || !(creating || secureVault.requiresDeviceKey())) return { deviceSecret: null, keychainError: null };
    try {
        return { deviceSecret: await getDeviceSecret(creating), keychainError: null };
    } catch (e) {
        console.error('[vCGE] OS keychain unavailable:', e);
        return { deviceSecret: null, keychainError: String(e) };
    }
}

function keychainMessage(keychainError) {
    if (keychainError && keychainError.includes('DEVICE_KEY_MISSING')) {
        return 'This vault\'s device key is missing from the OS keychain (was the vault copied from another device?).';
    }
    return keychainError
        ? `This vault is bound to the OS keychain, which is unavailable: ${keychainError}`
        : 'This vault was created in the desktop app and is bound to its OS keychain.';
}

async function submitVault(event) {
    event.preventDefault();
    if (vaultModalMode === 'pin') return submitPin();
    const passphrase = $('vaultPassphrase').value;
    const creating = vaultModalMode === 'create';
    const fail = (msg) => { $('vaultError').textContent = msg; };

    if (creating) {
        if (passphrase.length < MIN_PASSPHRASE_LENGTH) return fail(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
        if (passphrase !== $('vaultPassphraseConfirm').value) return fail('The passphrases do not match.');
    }

    const { deviceSecret, keychainError } = await deviceSecretFor(creating);
    const result = await secureVault.initialize(passphrase, deviceSecret);
    if (!result.success && result.error === 'ERR_KEYCHAIN_REQUIRED') return fail(keychainMessage(keychainError));
    if (!result.success) return fail('Wrong passphrase.');
    await finishUnlock(creating ? 'created' : 'passphrase', { keychainFallback: creating && !!keychainError });
}

async function submitPin() {
    const fail = (msg) => { $('vaultError').textContent = msg; };
    const { result, attemptsLeft } = await sessionPin.verify($('vaultPin').value);
    if (result === 'ok') return finishUnlock('session PIN');
    if (result === 'locked_out') {
        lockVault('too many wrong PINs');
        return fail(`${MAX_PIN_ATTEMPTS} wrong PINs: the vault is locked. Use the passphrase${secureVault.passkeySlots().length ? ' or a passkey' : ''}.`);
    }
    if (result === 'not_set') {
        lockVault('session PIN missing');
        return;
    }
    $('vaultPin').value = '';
    fail(`Wrong PIN. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`);
}

async function unlockWithPasskey() {
    const fail = (msg) => { $('vaultError').textContent = msg; };
    fail('');
    const { deviceSecret, keychainError } = await deviceSecretFor(false);
    if (secureVault.requiresDeviceKey() && !deviceSecret) return fail(keychainMessage(keychainError));
    let secret;
    try {
        secret = await getPasskeySecret(secureVault.passkeyPrfSalts());
    } catch (e) {
        return fail(e.code === 'CANCELLED' ? 'Passkey cancelled.' : `Passkey unlock failed: ${e.message}`);
    }
    const result = await secureVault.unlockWithPasskey(secret.id, secret.prfOutput, deviceSecret);
    secret.prfOutput.fill(0);
    if (!result.success) return fail(result.error === 'ERR_PASSKEY_UNKNOWN' ? 'That passkey is not enrolled for this vault.' : 'That passkey could not unlock this vault.');
    await finishUnlock('passkey');
}

// Shared by every unlock method: load the saved card, start saving, re-arm the idle timer.
async function finishUnlock(method, { keychainFallback = false } = {}) {
    const creating = method === 'created';
    try {
        const saved = await secureVault.retrieveAndDecrypt();
        if (saved) cardView.setContact(saved);
    } catch (e) {
        lockVault('saved card unreadable');
        $('vaultError').textContent = 'The saved card could not be decrypted.';
        return;
    }
    quickUnlockTtl.stop();
    storageMode = 'vault';
    $('vaultPin').value = '';
    $('vaultPassphrase').value = '';
    $('vaultPassphraseConfirm').value = '';
    $('vaultModal').classList.add('hidden');
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_UNLOCKED, { created: creating, method, timestamp: Date.now() });
    refresh();
    armIdleTtl();
    if (creating) await persist(cardView.getContact());
    if (keychainFallback) {
        cardView.showToast('OS keychain unavailable: vault protected by passphrase only.');
    } else {
        cardView.showToast(creating ? 'Vault created. Changes are saved encrypted.' : `Vault unlocked (${method}).`);
    }
    // With a passkey enrolled the PIN offer is not shown on its own (the passkey is already the quick way back in);
    // Security → Quick unlock still sets one.
    if (method !== 'session PIN' && !sessionPin.isSet() && !quickSetupDismissed && secureVault.passkeySlots().length === 0) openQuickSetup();
}

function continueWithoutSaving() {
    // From a quick lock, drop the retained key first: memory-only mode never holds a vault key.
    quickUnlockTtl.stop();
    sessionPin.clear();
    secureVault.lock();
    storageMode = 'memory';
    $('vaultModal').classList.add('hidden');
    cardView.clear();
    refresh();
    setVaultIndicator();
    armIdleTtl();
    cardView.showToast('Working in memory only. Nothing will be saved.');
}

// ---- Quick unlock setup: session PIN and passkeys -------------------------------------------------------------

function openQuickSetup() {
    $('quickSetupHint').textContent = `After ${IDLE_PURGE_SECONDS / 60} minutes without activity the card is hidden. This PIN (at least ${MIN_PIN_LENGTH} characters) brings it back for up to ${QUICK_UNLOCK_SECONDS / 60} minutes; after that, or after ${MAX_PIN_ATTEMPTS} wrong tries, the passphrase is needed. It is forgotten when you lock, reload or close the app.`;
    $('quickSetupPasskeyHint').classList.toggle('hidden', !isPasskeySupported() || secureVault.passkeySlots().length > 0);
    $('quickSetupError').textContent = '';
    $('sessionPinInput').value = '';
    $('quickSetupModal').classList.remove('hidden');
    $('sessionPinInput').focus();
}

async function saveSessionPin(event) {
    event.preventDefault();
    const pin = $('sessionPinInput').value;
    if (pin.length < MIN_PIN_LENGTH) {
        $('quickSetupError').textContent = `Use at least ${MIN_PIN_LENGTH} characters.`;
        return;
    }
    await sessionPin.set(pin);
    $('sessionPinInput').value = '';
    $('quickSetupModal').classList.add('hidden');
    globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: 'Session PIN set', timestamp: Date.now() });
    renderQuickUnlockPanel();
    cardView.showToast(`Session PIN set: it unlocks for ${QUICK_UNLOCK_SECONDS / 60} minutes after an idle lock.`);
}

function skipQuickSetup() {
    quickSetupDismissed = true;
    $('sessionPinInput').value = '';
    $('quickSetupModal').classList.add('hidden');
}

function clearSessionPin() {
    sessionPin.clear();
    globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: 'Session PIN removed', timestamp: Date.now() });
    renderQuickUnlockPanel();
}

function defaultPasskeyName() {
    const ua = navigator.userAgent;
    const device = /iPhone/.test(ua) ? 'iPhone' : /iPad/.test(ua) ? 'iPad' : /Android/.test(ua) ? 'Android' : /Mac/.test(ua) ? 'Mac'
        : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'This device';
    return `${device} passkey`;
}

function openPasskeyModal() {
    $('passkeyLabel').value = defaultPasskeyName();
    $('passkeyPassphrase').value = '';
    $('passkeyError').textContent = '';
    $('passkeyModal').classList.remove('hidden');
    $('passkeyPassphrase').focus();
}

function closePasskeyModal() {
    $('passkeyPassphrase').value = '';
    $('passkeyModal').classList.add('hidden');
}

// The PIN and passkey dialogs belong to an unlocked vault: any lock or wipe closes them.
function closeQuickUnlockDialogs() {
    $('sessionPinInput').value = '';
    $('quickSetupModal').classList.add('hidden');
    closePasskeyModal();
}

async function addPasskey(event) {
    event.preventDefault();
    const fail = (msg) => { $('passkeyError').textContent = msg; };
    const label = $('passkeyLabel').value.trim() || defaultPasskeyName();
    const { deviceSecret, keychainError } = await deviceSecretFor(false);
    if (secureVault.requiresDeviceKey() && !deviceSecret) return fail(keychainMessage(keychainError));
    const exported = await secureVault.exportDataKey($('passkeyPassphrase').value, deviceSecret);
    if (!exported.success) return fail('That is not the vault passphrase. Use the passphrase you created the vault with, not the session PIN.');
    $('passkeySaveBtn').disabled = true;
    try {
        const passkey = await createPasskey(label);
        await secureVault.addPasskeySlot(exported.dataKey, { id: passkey.id, label, prfSalt: passkey.prfSalt }, passkey.prfOutput, deviceSecret);
        passkey.prfOutput.fill(0);
    } catch (e) {
        console.warn('[vCGE] Passkey not added:', e);
        return fail(e.code === 'CANCELLED' ? 'Passkey cancelled.'
            : e.code === 'PRF_UNSUPPORTED' ? 'This device or passkey provider cannot unlock an encrypted vault (it lacks the PRF feature). Try another device, browser or a security key.'
                : `Could not add the passkey: ${e.message}`);
    } finally {
        exported.dataKey.fill(0);
        $('passkeySaveBtn').disabled = false;
    }
    closePasskeyModal();
    globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: `Passkey added (${label})`, timestamp: Date.now() });
    renderQuickUnlockPanel();
    cardView.showToast('Passkey added: use it to unlock this vault.');
}

// ---- Ephemeral memory lifecycle (TTL purge + startup residue check) -------------------------------------------

function purgeStartupResidue() {
    LEGACY_PLAINTEXT_KEYS.forEach(key => localStorage.removeItem(key));
}

function armIdleTtl() {
    if (storageMode !== 'vault' && storageMode !== 'memory') return;
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
    clearCapturedImages();
    globalEventBus.publish(Events.MEMORY_PURGED, { reason, timestamp: Date.now() });
    if (storageMode === 'vault' && sessionPin.isSet()) {
        quickLock();
    } else if (storageMode === 'vault') {
        lockVault(reason);
    } else {
        cardView.clear();
        refresh();
    }
    cardView.showToast(`Cleared after ${IDLE_PURGE_SECONDS / 60} minutes without activity.`);
}

function updatePurgeCountdown() {
    const el = $('purgeCountdown');
    el.textContent = storageMode === 'quick' ? `Quick unlock ends in ${quickUnlockTtl.getRemainingTime()} s`
        : idleTtl.timerId ? `Auto-clear in ${idleTtl.getRemainingTime()} s` : 'Auto-clear idle';
    if (storageMode === 'quick') {
        setVaultIndicator();
        updateQuickUnlockCountdown();
    }
}

// Idle lock with a session PIN: the card is cleared from the page, the vault key stays in memory for 5 minutes.
function quickLock() {
    clearTimeout(saveTimer);
    idleTtl.stop();
    closeQuickUnlockDialogs();
    storageMode = 'quick';
    quickUnlockTtl.startStream(null);
    cardView.clear();
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_QUICK_LOCKED, { seconds: QUICK_UNLOCK_SECONDS, timestamp: Date.now() });
    openVaultModal();
}

// Full lock: drops the vault key and the session PIN.
function lockVault(reason = 'manual') {
    clearTimeout(saveTimer);
    idleTtl.stop();
    quickUnlockTtl.stop();
    sessionPin.clear();
    closeQuickUnlockDialogs();
    clearCapturedImages();
    secureVault.lock();
    storageMode = 'locked';
    cardView.clear();
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_LOCKED, { reason, timestamp: Date.now() });
    openVaultModal();
}

function wipeVault() {
    if (!confirm('Permanently delete the encrypted vault and clear the card? This cannot be undone.')) return;
    clearTimeout(saveTimer);
    idleTtl.stop();
    quickUnlockTtl.stop();
    sessionPin.clear();
    closeQuickUnlockDialogs();
    clearCapturedImages();
    secureVault.zeroFillWipe();
    deleteDeviceSecret().catch(e => console.error('[vCGE] Could not delete the keychain device key:', e));
    storageMode = 'locked';
    cardView.clear();
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_WIPED, { timestamp: Date.now() });
    openVaultModal();
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
        text.addEventListener('input', () => { line.text = text.value; renderOcrSummary(); });
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
        return row;
    });
    $('ocrLines').replaceChildren(...rows);
    renderOcrSummary();
}

async function runOcr() {
    if (!$('reviewImage').src) return;
    showRetakePrompt(false);
    $('runOcrBtn').disabled = true;
    $('runOcrBtn').textContent = 'Extracting…';
    try {
        const { text, lines } = await executeOCRScan(cropEditor.getCroppedImage());
        ocrReview = { lines: formMapper.classifyLines(lines && lines.length ? lines : text), fields: null };
        renderOcrLines();
        showReviewStep('text');
    } catch (e) {
        console.error('[vCGE] OCR failed:', e);
        if (e && e.code === 'OCR_UNREADABLE') {
            showRetakePrompt(true);
        } else if (e && e.code === 'OCR_UNAVAILABLE') {
            closeReviewDialog();
            cardView.showToast('The OCR engine could not start, so your form was not changed. Type the details in, or try again.');
        } else {
            cardView.showToast('Could not read that image.');
        }
    } finally {
        $('runOcrBtn').disabled = false;
        $('runOcrBtn').textContent = 'Extract fields';
    }
}

function applyOcrReview() {
    if (!ocrReview) return;
    const { fields, lines } = ocrReview;
    lastScan = lines.map(line => ({ ...line }));
    $('reopenScanBtn').classList.remove('hidden');
    closeReviewDialog();
    cardView.changeWithUndo('Form filled. Please check the details.', () => cardView.mergeContact(fields));
}

// Opens the review step again with the last scan's lines (as last edited), without running OCR again.
function reopenLastScan() {
    if (!lastScan) return;
    ocrReview = { lines: lastScan.map(line => ({ ...line })), fields: null };
    renderOcrLines();
    $('ocrBackBtn').classList.toggle('hidden', !$('reviewImage').getAttribute('src'));
    showReviewStep('text');
    $('cropReviewModal').classList.remove('hidden');
}

function forgetLastScan() {
    lastScan = null;
    $('reopenScanBtn').classList.add('hidden');
}

function wireIntake() {
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
    $('rotatePhotoBtn').addEventListener('click', () => { showRetakePrompt(false); cropEditor.rotate(); });
    $('cancelReviewBtn').addEventListener('click', closeReviewDialog);
    $('ocrCancelBtn').addEventListener('click', closeReviewDialog);
    $('ocrBackBtn').addEventListener('click', () => showReviewStep('photo'));
    $('applyOcrBtn').addEventListener('click', applyOcrReview);
    $('reopenScanBtn').addEventListener('click', reopenLastScan);
    // Retake: with the camera open, close the dialog so the user can capture again; otherwise pick another photo
    // (on phones the picker also offers the camera).
    $('retakePhotoBtn').addEventListener('click', () => {
        closeReviewDialog();
        if ($('cameraPanel').classList.contains('hidden')) $('imageUpload').click();
        else cardView.showToast('Hold the card steady and capture again.');
    });
    // A new photo starts over at step 1 and drops any text extracted from the previous one (the camera reopens the dialog).
    globalEventBus.subscribe(Events.IMAGE_CAPTURED, () => { showRetakePrompt(false); closeReviewDialog(); forgetLastScan(); $('ocrBackBtn').classList.remove('hidden'); });
}

// ---- Egress (MOD08 only) ---------------------------------------------------------------------------------------

function wireEgress() {
    $('downloadVcfBtn').addEventListener('click', () => egressController.downloadVcf());
    $('exportQrBtn').addEventListener('click', () => egressController.exportQRPNG($('qrCanvas')));
    $('emailBtn').addEventListener('click', () => egressController.triggerEmailShare());
    $('smsBtn').addEventListener('click', () => egressController.triggerSmsShare());
    $('printCardBtn').addEventListener('click', () => egressController.triggerPhysicalPrint($('qrCanvas')));
    $('shareNativeBtn').addEventListener('click', async () => {
        const result = await egressController.triggerQuickShare();
        if (result && result.method === 'clipboard_fallback') cardView.showToast('vCard copied to the clipboard.');
        else if (result && result.reason === 'clipboard_unavailable') cardView.showToast('Sharing is not available on this device.');
    });
}

// ---- Audit trail (telemetry visibility) ------------------------------------------------------------------------

function wireAuditLog() {
    const list = $('auditLog');
    const describe = {
        [Events.EXPORT_DISPATCHED]: (d) => `MOD08 egress: ${d.method}`,
        [Events.EGRESS_BLOCKED]: (d) => `Blocked ${d.api} → ${d.url}`,
        [Events.VAULT_UNLOCKED]: (d) => (d.created ? 'Vault created' : `Vault unlocked (${d.method})`),
        [Events.VAULT_LOCKED]: (d) => `Vault locked${d.reason && d.reason !== 'manual' ? ` (${d.reason})` : ''}`,
        [Events.VAULT_QUICK_LOCKED]: (d) => `Card hidden; session PIN unlocks for ${d.seconds / 60} min`,
        [Events.VAULT_UNLOCK_METHOD_CHANGED]: (d) => d.change,
        [Events.VAULT_WIPED]: () => 'Vault wiped',
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
    purgeStartupResidue();
    maskSecretInputs();
    initTheme($('themeToggle'));
    cardView.init();
    wireAuditLog();
    wireIntake();
    wireEgress();
    $('vaultForm').addEventListener('submit', submitVault);
    $('vaultSkipBtn').addEventListener('click', continueWithoutSaving);
    $('lockVaultBtn').addEventListener('click', () => lockVault());
    $('vaultPasskeyBtn').addEventListener('click', unlockWithPasskey);
    $('vaultUsePassphraseBtn').addEventListener('click', () => setVaultModalMode('passphrase'));
    $('quickSetupForm').addEventListener('submit', saveSessionPin);
    $('quickSetupSkipBtn').addEventListener('click', skipQuickSetup);
    $('setSessionPinBtn').addEventListener('click', openQuickSetup);
    $('clearSessionPinBtn').addEventListener('click', clearSessionPin);
    $('addPasskeyBtn').addEventListener('click', openPasskeyModal);
    $('passkeyForm').addEventListener('submit', addPasskey);
    $('passkeyCancelBtn').addEventListener('click', closePasskeyModal);
    $('wipeVaultBtn').addEventListener('click', wipeVault);
    $('clearFormBtn').addEventListener('click', () => cardView.changeWithUndo('Form cleared.', () => cardView.clear()));
    ['pointerdown', 'keydown', 'input'].forEach(type => document.addEventListener(type, armIdleTtl, true));
    setInterval(updatePurgeCountdown, 1000);
    refresh();
    setVaultIndicator();
    updatePurgeCountdown();
    openVaultModal();
}

boot();
