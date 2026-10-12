/**
 * vCGE (vCard Generator Engine) - Main Export Barrel (`index.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575 and Gemini
 */

export { globalEventBus, EventBus } from './eventBus.js';
export { createEmptyContact, validateContact, ContactSchemaVersion } from './cardSchema.js';
export { CryptoUtils } from './cryptoUtils.js';
export { RegexMatchers } from './regexMatchers.js';
export { formatVCard } from './vcardFormatter.js';