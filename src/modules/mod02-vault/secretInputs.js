/**
 * vCGE-MOD02: secret inputs (vault passphrase and session PIN boxes)
 * Created by raven575, Gemini & Claude
 *
 * Browsers offer to save anything typed into a password field, and Chrome ignores autocomplete="off" there.
 * Where the browser can mask a plain text field (CSS text-security), the vault's secret boxes become masked text
 * fields, so no password manager treats the dialogs as a login form. Elsewhere they stay password fields: masking
 * matters more than the save prompt. The markup also asks keyboards not to capitalise, correct or learn the text.
 */

const SECRET_INPUT_IDS = ['vaultPassphrase', 'vaultPassphraseConfirm', 'vaultPin', 'sessionPinInput', 'passkeyPassphrase'];

export function canMaskTextInputs() {
    return typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-text-security', 'disc');
}

/** Runs once at startup, before anything is typed. Returns true when the boxes were converted. */
export function maskSecretInputs(doc = document) {
    if (!canMaskTextInputs()) return false;
    SECRET_INPUT_IDS.forEach((id) => {
        const input = doc.getElementById(id);
        if (!input) return;
        input.type = 'text';
        input.style.webkitTextSecurity = 'disc';
    });
    return true;
}
