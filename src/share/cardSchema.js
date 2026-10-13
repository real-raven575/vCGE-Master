/**
 * vCGE (vCard Generator Engine) - Contact Schema & Validation (`cardSchema.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575, Gemini & Claude
 */
import { DEFAULT_COUNTRY } from './contactOptions.js';

export const ContactSchemaVersion = "3.1";

// Canonical single-value contact fields shared by every module (form inputs use these names as element IDs).
export const CONTACT_FIELDS = Object.freeze([
    'namePrefix', 'firstName', 'middleName', 'lastName', 'nameSuffix', 'organization', 'jobTitle',
    'addressType', 'street', 'unitType', 'unitNumber', 'city', 'state', 'zip', 'country',
    'nickname', 'birthday', 'notes'
]);

// Typed lists: each entry is { type, value } with a type from contactOptions (PHONE_TYPES, EMAIL_TYPES, WEBSITE_TYPES).
export const CONTACT_LIST_FIELDS = Object.freeze(['phones', 'emails', 'websites']);

export function createEmptyContact() {
    const contact = {
        id: crypto.randomUUID ? crypto.randomUUID() : 'vcge-' + Date.now(),
        avatarBase64: null,
        themePalette: 'ocean',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
    CONTACT_FIELDS.forEach(f => { contact[f] = ''; });
    CONTACT_LIST_FIELDS.forEach(f => { contact[f] = []; });
    contact.addressType = 'work';
    contact.country = DEFAULT_COUNTRY;
    return contact;
}

/**
 * Brings a contact saved in an older layout up to date (schema 3.0 had phoneWork, phoneMobile, email and website
 * as single fields). Returns a new object; unknown keys are kept, list entries without a value are dropped.
 */
export function normalizeContact(contact = {}) {
    const c = { ...contact };
    const legacy = (key, list, type) => {
        if (typeof c[key] === 'string' && c[key].trim()) {
            c[list] = Array.isArray(c[list]) ? c[list] : [];
            if (!c[list].some(e => e.value === c[key].trim())) c[list].push({ type, value: c[key].trim() });
        }
        delete c[key];
    };
    legacy('phoneWork', 'phones', 'work');
    legacy('phoneMobile', 'phones', 'mobile');
    legacy('email', 'emails', 'work');
    legacy('website', 'websites', 'work');
    CONTACT_LIST_FIELDS.forEach(f => {
        c[f] = (Array.isArray(c[f]) ? c[f] : [])
            .map(e => ({ type: String(e && e.type || 'other'), value: String(e && e.value || '').trim() }))
            .filter(e => e.value);
    });
    CONTACT_FIELDS.forEach(f => { if (typeof c[f] !== 'string') c[f] = c[f] == null ? '' : String(c[f]); });
    if (!c.addressType) c.addressType = 'work';
    if (!c.country) c.country = DEFAULT_COUNTRY;
    return c;
}

export function validateContact(contact) {
    const errors = [];
    if (!contact.firstName || !contact.firstName.trim()) {
        errors.push("First Name is required.");
    }
    if (!contact.lastName || !contact.lastName.trim()) {
        errors.push("Last Name is required.");
    }
    (contact.emails || []).forEach(({ value }) => {
        if (value && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)) errors.push(`Invalid email address format: ${value}`);
    });
    return {
        isValid: errors.length === 0,
        errors
    };
}
