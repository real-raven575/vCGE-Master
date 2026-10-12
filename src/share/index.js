/**
 * vCGE (vCard Generator Engine) - Main Export Barrel (`index.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575, Gemini & Claude
 */

export { globalEventBus, EventBus, Events } from './eventBus.js';
export { createEmptyContact, validateContact, ContactSchemaVersion, CONTACT_FIELDS } from './cardSchema.js';
export { CryptoUtils } from './cryptoUtils.js';
export { RegexMatchers } from './regexMatchers.js';
export { formatVCard, escapeVCardText } from './vcardFormatter.js';