/**
 * vCard Generator Engine (vCGE) - Master Integration Controller
 * Created by raven575, Gemini & Claude
 *
 * Wires the modules together over the shared event bus:
 *   MOD03 camera / upload -> MOD04 OCR -> MOD05 mapper -> MOD06 card view -> MOD07 vCard + QR
 *   -> MOD02 temporary vault (memory only) and MOD08 egress (every outbound action).
 * MOD01 is imported first so its network gatekeeper is installed before any other module code runs.
 * Nothing is stored: leaving or reloading the page, 30 s out of view, or 2 minutes idle without a session PIN wipes it.
 */
import './modules/mod01-shell/shell.js';
import { initTheme } from './modules/mod01-shell/themeManager.js';
import { globalEventBus, Events } from './share/eventBus.js';
import { CONTACT_FIELDS, CONTACT_LIST_FIELDS, createEmptyContact } from './share/cardSchema.js';
import { temporaryVault, deleteLegacyVault } from './modules/mod02-vault/vault.js';
import { TTLMemoryStreamManager } from './modules/mod02-vault/ttlManager.js';
import { deleteDeviceSecret } from './modules/mod02-vault/keychain.js';
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
const IDLE_PURGE_SECONDS = 120;
// Out of view (another app, another tab, screen off) for this long wipes everything.
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

// 'open': the card is on the page. 'quick': hidden after an idle lock and held in the temporary vault until the
// session PIN brings it back (for up to 5 minutes).
let vaultMode = 'open';
let holding = null;          // Promise from temporaryVault.hold() while a quick lock seals the card
let hiddenDeadline = 0;      // wall-clock time at which a page that is out of view gets wiped (0 = none)
let externalAppUntil = 0;    // until then, the page going out of view is the picker or share sheet the app opened
let leaveGuardArmed = false; // an extra history entry is in place, so Back asks before leaving
let leaving = false;

// 120-second TTL on everything held in RAM: any user activity restarts it; on expiry the volatile state is purged.
const idleTtl = new TTLMemoryStreamManager(IDLE_PURGE_SECONDS, () => purgeVolatileState('idle'));
// After an idle lock with a session PIN set, the card is held for 5 minutes; then it is wiped.
const quickUnlockTtl = new TTLMemoryStreamManager(QUICK_UNLOCK_SECONDS, () => wipeSession('quick unlock expired',
    `The PIN window ended after ${QUICK_UNLOCK_SECONDS / 60} minutes: the card was wiped.`));
const sessionPin = new SessionPin();

// ---- Contact pipeline ------------------------------------------------------------------------------------------

function refresh(contact = cardView.getContact()) {
    const vcard = vcgeQREngine.generateVCard30(contact);
    cardView.render(contact);
    // The QR payload omits the photo: base64 images exceed QR capacity.
    const qrOk = vcgeQREngine.renderQRCode($('qrCanvas'), vcgeQREngine.generateVCard30({ ...contact, avatarBase64: null }), { size: 320 });
    $('qrNotice').classList.toggle('hidden', qrOk);
    egressController.setPayload(vcard, contact, { qrReal: qrOk });
    globalEventBus.publish(Events.CONTACT_UPDATED, { timestamp: Date.now() });
}

// ---- Temporary vault (MOD02): memory only ----------------------------------------------------------------------

const minutes = (seconds) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

function setVaultIndicator() {
    const el = $('vaultStateIndicator');
    const [text, color] = vaultMode === 'quick'
        ? [`LOCKED (PIN for ${minutes(quickUnlockTtl.getRemainingTime())})`, 'text-amber-500']
        : ['UNLOCKED / memory only', 'text-emerald-500'];
    el.textContent = text;
    el.className = `text-xs font-mono ${color}`;
    setVaultBadge();
    $('lockVaultBtn').classList.toggle('hidden', vaultMode !== 'open' || !sessionPin.isSet());
    renderQuickUnlockPanel();
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

// Security panel: session PIN state.
function renderQuickUnlockPanel() {
    $('quickUnlockPanel').classList.toggle('hidden', vaultMode !== 'open');
    $('sessionPinStatus').textContent = sessionPin.isSet() ? 'Session PIN: set' : 'Session PIN: not set';
    $('setSessionPinBtn').textContent = sessionPin.isSet() ? 'Change' : 'Set PIN';
    $('clearSessionPinBtn').classList.toggle('hidden', !sessionPin.isSet());
}

function openPinModal() {
    $('vaultModalHint').textContent = `Hidden after ${IDLE_PURGE_SECONDS / 60} minutes without activity. Enter your session PIN to continue, or start over to wipe it.`;
    $('vaultError').textContent = '';
    $('vaultPin').value = '';
    $('vaultModal').classList.remove('hidden');
    updateQuickUnlockCountdown();
    $('vaultPin').focus();
}

function closePinModal() {
    $('vaultPin').value = '';
    $('vaultModal').classList.add('hidden');
}

function updateQuickUnlockCountdown() {
    if (vaultMode !== 'quick') return;
    $('quickUnlockCountdown').textContent = `PIN unlock available for ${minutes(quickUnlockTtl.getRemainingTime())}; then the card is wiped.`;
}

async function submitPin(event) {
    event.preventDefault();
    const { result, attemptsLeft } = await sessionPin.verify($('vaultPin').value);
    if (result === 'ok') return quickUnlock();
    if (result === 'locked_out') return wipeSession('too many wrong PINs', `${MAX_PIN_ATTEMPTS} wrong PINs: the card was wiped.`);
    if (result === 'not_set') return wipeSession('session PIN missing');
    $('vaultPin').value = '';
    $('vaultError').textContent = `Wrong PIN. ${attemptsLeft} ${attemptsLeft === 1 ? 'try' : 'tries'} left.`;
}

// Idle lock with a session PIN: the card and the scan in progress leave the page and are held, encrypted, in the
// temporary vault for 5 minutes.
function quickLock() {
    const payload = { contact: cardView.getContact(), scan: scanSnapshot() };
    idleTtl.stop();
    closeQuickUnlockDialogs();
    clearCapturedImages();
    holding = temporaryVault.hold(payload).catch(e => { console.error('[vCGE] Could not hold the card:', e); return false; });
    vaultMode = 'quick';
    quickUnlockTtl.startStream(null);
    cardView.clear();
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_QUICK_LOCKED, { seconds: QUICK_UNLOCK_SECONDS, scanKept: !!payload.scan, timestamp: Date.now() });
    openPinModal();
}

async function quickUnlock() {
    await holding;
    let held = null;
    try {
        held = await temporaryVault.release();
    } catch (e) {
        console.error('[vCGE] Held card unreadable:', e);
    }
    holding = null;
    quickUnlockTtl.stop();
    vaultMode = 'open';
    closePinModal();
    if (held && held.contact) cardView.setContact(held.contact);
    refresh();
    setVaultIndicator();
    globalEventBus.publish(Events.VAULT_UNLOCKED, { method: 'session PIN', timestamp: Date.now() });
    armIdleTtl();
    restoreScan(held && held.scan);
    cardView.showToast('Unlocked (session PIN).');
}

// Wipes everything: the card, the photo and scan, the Undo copy, the held card and the session PIN.
// The page stays usable with an empty card.
function wipeSession(reason, message = null) {
    idleTtl.stop();
    quickUnlockTtl.stop();
    hiddenDeadline = 0;
    sessionPin.clear();
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
}

function wipeVault() {
    if (!confirm('Wipe the card, the photo and everything held in memory? This cannot be undone.')) return;
    wipeSession('wipe button', 'Wiped. Nothing is kept.');
}

// ---- Session PIN setup -----------------------------------------------------------------------------------------

function openQuickSetup() {
    $('quickSetupHint').textContent = `After ${IDLE_PURGE_SECONDS / 60} minutes without activity the card is hidden. This PIN (at least ${MIN_PIN_LENGTH} characters) brings it back for up to ${QUICK_UNLOCK_SECONDS / 60} minutes; after that, or after ${MAX_PIN_ATTEMPTS} wrong tries, the card is wiped. Without a PIN it is wiped straight away. The PIN is forgotten when you leave or reload.`;
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
    setVaultIndicator();
    cardView.showToast(`Session PIN set: it unlocks for ${QUICK_UNLOCK_SECONDS / 60} minutes after an idle lock.`);
}

function closeQuickSetup() {
    $('sessionPinInput').value = '';
    $('quickSetupModal').classList.add('hidden');
}

function clearSessionPin() {
    sessionPin.clear();
    globalEventBus.publish(Events.VAULT_UNLOCK_METHOD_CHANGED, { change: 'Session PIN removed', timestamp: Date.now() });
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
    el.textContent = vaultMode === 'quick' ? `Quick unlock ends in ${quickUnlockTtl.getRemainingTime()} s`
        : idleTtl.timerId ? `Auto-clear in ${idleTtl.getRemainingTime()} s` : 'Auto-clear idle';
    if (vaultMode === 'quick') {
        setVaultIndicator();
        updateQuickUnlockCountdown();
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
        hiddenDeadline = Date.now() < externalAppUntil ? 0 : Date.now() + HIDDEN_WIPE_SECONDS * 1000;
    } else {
        // Phones freeze timers in the background, so the deadline is checked as the page comes back.
        checkHiddenDeadline();
        hiddenDeadline = 0;
    }
}

function checkHiddenDeadline() {
    if (!hiddenDeadline || Date.now() < hiddenDeadline) return;
    hiddenDeadline = 0;
    wipeSession(`out of view for ${HIDDEN_WIPE_SECONDS} s`, `Wiped: the app was out of view for more than ${HIDDEN_WIPE_SECONDS} seconds.`);
}

// The app is about to open the photo picker or a share action (another app may come to the front).
function expectExternalApp() {
    externalAppUntil = Date.now() + EXTERNAL_APP_GRACE_MS;
}

function onActivity() {
    armIdleTtl();
    armLeaveGuard();
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
    // A share or download may bring another app to the front: the 2-minute idle rule applies, not the 30-second one.
    ['downloadVcfBtn', 'exportQrBtn', 'emailBtn', 'smsBtn', 'printCardBtn', 'shareNativeBtn', 'copyVcardBtn']
        .forEach(id => $(id).addEventListener('click', expectExternalApp, true));
    $('downloadVcfBtn').addEventListener('click', () => egressController.downloadVcf());
    $('exportQrBtn').addEventListener('click', () => {
        if (!egressController.exportQRPNG($('qrCanvas'))) cardView.showToast('Too much information for one QR code: use .vcf or Share instead.');
    });
    $('emailBtn').addEventListener('click', () => egressController.triggerEmailShare());
    $('smsBtn').addEventListener('click', () => egressController.triggerSmsShare());
    $('printCardBtn').addEventListener('click', () => egressController.triggerPhysicalPrint($('qrCanvas')));
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
        [Events.VAULT_QUICK_LOCKED]: (d) => `Card${d.scanKept ? ' and scan' : ''} hidden; session PIN unlocks for ${d.seconds / 60} min`,
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
    initTheme($('themeToggle'));
    cardView.init();
    wireAuditLog();
    purgeStartupResidue();
    wireIntake();
    wireEgress();
    $('vaultForm').addEventListener('submit', submitPin);
    $('vaultStartOverBtn').addEventListener('click', () => wipeSession('start over', 'Wiped. Starting over.'));
    $('lockVaultBtn').addEventListener('click', () => { if (sessionPin.isSet()) quickLock(); });
    $('quickSetupForm').addEventListener('submit', saveSessionPin);
    $('quickSetupSkipBtn').addEventListener('click', closeQuickSetup);
    $('setSessionPinBtn').addEventListener('click', openQuickSetup);
    $('clearSessionPinBtn').addEventListener('click', clearSessionPin);
    $('wipeVaultBtn').addEventListener('click', wipeVault);
    $('leaveStayBtn').addEventListener('click', stayOnPage);
    $('leaveConfirmBtn').addEventListener('click', leavePage);
    $('clearFormBtn').addEventListener('click', () => cardView.changeWithUndo('Form cleared.', () => cardView.clear()));
    window.addEventListener('popstate', onPopState);
    window.addEventListener('pagehide', onPageHide);
    window.addEventListener('pageshow', onPageShow);
    document.addEventListener('visibilitychange', onVisibilityChange);
    ['pointerdown', 'pointerup', 'keydown', 'input'].forEach(type => document.addEventListener(type, onActivity, true));
    setInterval(() => { updatePurgeCountdown(); checkHiddenDeadline(); }, 1000);
    refresh();
    setVaultIndicator();
    updatePurgeCountdown();
}

boot();
