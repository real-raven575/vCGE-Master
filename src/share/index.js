/**
 * vCGE (vCard Generator Engine) - Main Export Barrel (`index.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575, Team vCGE (Claude) & Gemini
 */

export { globalEventBus, EventBus, Events } from './eventBus.js';
export { createEmptyContact, normalizeContact, validateContact, ContactSchemaVersion, CONTACT_FIELDS, CONTACT_LIST_FIELDS } from './cardSchema.js';
export * from './contactOptions.js';
export { CryptoUtils } from './cryptoUtils.js';
export { RegexMatchers } from './regexMatchers.js';
export { formatVCard, escapeVCardText, foldVCardLines, categoryTags } from './vcardFormatter.js';
