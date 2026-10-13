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

let storageMode = 'locked'; // 'locked' | 'vault' | 'memory'
let saveTimer = null;

// 120-second TTL on everything held in RAM: any user activity restarts it; on expiry the volatile state is purged.
const idleTtl = new TTLMemoryStreamManager(IDLE_PURGE_SECONDS, () => purgeVolatileState('idle'));

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

function setVaultIndicator() {
    const el = $('vaultStateIndicator');
    const states = {
        vault: [secureVault.kdf === KDF_KEYCHAIN ? 'UNLOCKED / AES-256 + OS keychain' : 'UNLOCKED / AES-256 (saving)', 'text-emerald-500'],
        memory: ['NOT SAVED (memory only)', 'text-amber-500'],
        locked: ['LOCKED', 'text-slate-400']
    };
    const [text, color] = states[storageMode];
    el.textContent = text;
    el.className = `text-xs font-mono ${color}`;
    $('lockVaultBtn').classList.toggle('hidden', storageMode !== 'vault');
}

function openVaultModal() {
    const creating = !secureVault.hasStoredVault();
    $('vaultModalTitle').textContent = creating ? 'Create your encrypted vault' : 'Unlock your vault';
    $('vaultModalHint').textContent = creating
        ? `Choose a passphrase (at least ${MIN_PASSPHRASE_LENGTH} characters). Your card is encrypted on this device with AES-256; the passphrase cannot be recovered.`
        : 'Enter your passphrase to decrypt your saved card on this device.';
    $('vaultConfirmRow').classList.toggle('hidden', !creating);
    $('vaultUnlockBtn').textContent = creating ? 'Create vault' : 'Unlock';
    $('vaultError').textContent = '';
    $('vaultPassphrase').value = '';
    $('vaultPassphraseConfirm').value = '';
    $('vaultModal').classList.remove('hidden');
    $('vaultPassphrase').focus();
}

async function submitVault(event) {
    event.preventDefault();
    const passphrase = $('vaultPassphrase').value;
    const creating = !secureVault.hasStoredVault();
    const fail = (msg) => { $('vaultError').textContent = msg; };

    if (creating) {
        if (passphrase.length < MIN_PASSPHRASE_LENGTH) return fail(`Use at least ${MIN_PASSPHRASE_LENGTH} characters.`);
        if (passphrase !== $('vaultPassphraseConfirm').value) return fail('The passphrases do not match.');
    }

    // Desktop (Tauri): bind the vault to a device key held in the OS keychain.
    let deviceSecret = null;
    let keychainError = null;
    if (isKeychainAvailable() && (creating || secureVault.requiresDeviceKey())) {
        try {
            deviceSecret = await getDeviceSecret(creating);
        } catch (e) {
            keychainError = String(e);
            console.error('[vCGE] OS keychain unavailable:', e);
        }
    }

    const result = await secureVault.initialize(passphrase, deviceSecret);
    if (!result.success && result.error === 'ERR_KEYCHAIN_REQUIRED') {
        if (keychainError && keychainError.includes('DEVICE_KEY_MISSING')) {
            return fail('This vault\'s device key is missing from the OS keychain (was the vault copied from another device?).');
        }
        return fail(keychainError
            ? `This vault is bound to the OS keychain, which is unavailable: ${keychainError}`
            : 'This vault was created in the desktop app and is bound to its OS keychain.');
    }
    if (!result.success) return fail('Could not derive a key from that passphrase.');

    try {
        const saved = await secureVault.retrieveAndDecrypt();
        if (saved) cardView.setContact(saved);
    } catch (e) {
        secureVault.lock();
        return fail('Wrong passphrase.');
    }

    storageMode = 'vault';
    $('vaultPassphrase').value = '';
    $('vaultPassphraseConfirm').value = '';
    $('vaultModal').classList.add('hidden');
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_UNLOCKED, { created: creating, timestamp: Date.now() });
    refresh();
    armIdleTtl();
    if (creating) await persist(cardView.getContact());
    if (creating && keychainError) {
        cardView.showToast('OS keychain unavailable: vault protected by passphrase only.');
    } else {
        cardView.showToast(creating ? 'Vault created. Changes are saved encrypted.' : 'Vault unlocked.');
    }
}

function continueWithoutSaving() {
    storageMode = 'memory';
    $('vaultModal').classList.add('hidden');
    setVaultIndicator();
    armIdleTtl();
    cardView.showToast('Working in memory only. Nothing will be saved.');
}

// ---- Ephemeral memory lifecycle (TTL purge + startup residue check) -------------------------------------------

function purgeStartupResidue() {
    LEGACY_PLAINTEXT_KEYS.forEach(key => localStorage.removeItem(key));
}

function armIdleTtl() {
    if (storageMode === 'locked') return;
    // The snapshot is zero-filled on expiry (best effort: JS strings are immutable, so the DOM is cleared too).
    idleTtl.startStream(cardView.getContact());
}

function clearCapturedImages() {
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
    if (storageMode === 'vault') {
        lockVault();
    } else {
        cardView.clear();
        refresh();
    }
    cardView.showToast(`Cleared after ${IDLE_PURGE_SECONDS / 60} minutes without activity.`);
}

function updatePurgeCountdown() {
    const el = $('purgeCountdown');
    el.textContent = idleTtl.timerId ? `Auto-clear in ${idleTtl.getRemainingTime()} s` : 'Auto-clear idle';
}

function lockVault() {
    clearTimeout(saveTimer);
    idleTtl.stop();
    clearCapturedImages();
    secureVault.lock();
    storageMode = 'locked';
    cardView.clear();
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_LOCKED, { timestamp: Date.now() });
    openVaultModal();
}

function wipeVault() {
    if (!confirm('Permanently delete the encrypted vault and clear the card? This cannot be undone.')) return;
    clearTimeout(saveTimer);
    idleTtl.stop();
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
let ocrReview = null;   // { lines: [{ text, role }], fields } while the review step is open

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
        const { text } = await executeOCRScan(cropEditor.getCroppedImage());
        ocrReview = { lines: formMapper.classifyLines(text), fields: null };
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
    cardView.mergeContact(ocrReview.fields);
    closeReviewDialog();
    cardView.showToast('Form filled. Please check the details.');
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
    // Retake: with the camera open, close the dialog so the user can capture again; otherwise pick another photo
    // (on phones the picker also offers the camera).
    $('retakePhotoBtn').addEventListener('click', () => {
        closeReviewDialog();
        if ($('cameraPanel').classList.contains('hidden')) $('imageUpload').click();
        else cardView.showToast('Hold the card steady and capture again.');
    });
    // A new photo starts over at step 1 and drops any text extracted from the previous one (the camera reopens the dialog).
    globalEventBus.subscribe(Events.IMAGE_CAPTURED, () => { showRetakePrompt(false); closeReviewDialog(); });
}

// ---- Egress (MOD08 only) ---------------------------------------------------------------------------------------

function wireEgress() {
    $('downloadVcfBtn').addEventListener('click', () => egressController.downloadVcf());
    $('exportQrBtn').addEventListener('click', () => egressController.exportQRPNG($('qrCanvas')));
    $('emailBtn').addEventListener('click', () => egressController.triggerEmailShare());
    $('smsBtn').addEventListener('click', () => egressController.triggerSmsShare());
    $('printCardBtn').addEventListener('click', () => egressController.triggerPhysicalPrint());
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
        [Events.VAULT_UNLOCKED]: (d) => (d.created ? 'Vault created' : 'Vault unlocked'),
        [Events.VAULT_LOCKED]: () => 'Vault locked',
        [Events.VAULT_WIPED]: () => 'Vault wiped',
        [Events.OCR_TEXT_EXTRACTED]: () => 'OCR text extracted',
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
    initTheme($('themeToggle'));
    cardView.init();
    wireAuditLog();
    wireIntake();
    wireEgress();
    $('vaultForm').addEventListener('submit', submitVault);
    $('vaultSkipBtn').addEventListener('click', continueWithoutSaving);
    $('lockVaultBtn').addEventListener('click', lockVault);
    $('wipeVaultBtn').addEventListener('click', wipeVault);
    ['pointerdown', 'keydown', 'input'].forEach(type => document.addEventListener(type, armIdleTtl, true));
    setInterval(updatePurgeCountdown, 1000);
    refresh();
    setVaultIndicator();
    updatePurgeCountdown();
    openVaultModal();
}

boot();
