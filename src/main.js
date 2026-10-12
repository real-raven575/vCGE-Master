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
import { executeOCRScan } from './modules/mod04-ocr/ocrWorker.js';
import { ContactFormMapper } from './modules/mod05-form/formMapper.js';
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
    $('cropReviewModal').classList.add('hidden');
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

async function runOcr() {
    const image = $('reviewImage').src;
    if (!image) return;
    $('runOcrBtn').disabled = true;
    $('runOcrBtn').textContent = 'Extracting…';
    try {
        const { text, simulated } = await executeOCRScan(image);
        cardView.mergeContact(formMapper.parseOCRText(text));
        $('cropReviewModal').classList.add('hidden');
        cardView.showToast(simulated
            ? 'OCR engine (Tesseract.js) could not start: sample text was used, not your image.'
            : 'Fields extracted. Please review them.');
    } catch (e) {
        console.error('[vCGE] OCR failed:', e);
        cardView.showToast('Could not read that image.');
    } finally {
        $('runOcrBtn').disabled = false;
        $('runOcrBtn').textContent = 'Extract fields';
    }
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
    $('cancelReviewBtn').addEventListener('click', () => $('cropReviewModal').classList.add('hidden'));
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
        [Events.OCR_TEXT_EXTRACTED]: (d) => `OCR text extracted${d.simulated ? ' (simulated)' : ''}`,
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
