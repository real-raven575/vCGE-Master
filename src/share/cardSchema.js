/**
 * vCGE (vCard Generator Engine) - Contact Schema & Validation (`cardSchema.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575, Gemini & Claude
 */

export const ContactSchemaVersion = "3.0";

// Canonical contact fields shared by every module (form inputs use these names as element IDs).
export const CONTACT_FIELDS = Object.freeze([
    'firstName', 'lastName', 'organization', 'jobTitle', 'phoneWork', 'phoneMobile', 'email', 'website',
    'street', 'city', 'state', 'zip', 'country', 'nickname', 'birthday', 'notes'
]);

export function createEmptyContact() {
    return {
        id: crypto.randomUUID ? crypto.randomUUID() : 'vcge-' + Date.now(),
        firstName: '',
        lastName: '',
        organization: '',
        jobTitle: '',
        phoneWork: '',
        phoneMobile: '',
        email: '',
        website: '',
        street: '',
        city: '',
        state: '',
        zip: '',
        country: 'United States',
        nickname: '',
        birthday: '',
        notes: '',
        avatarBase64: null,
        themePalette: 'ocean',
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
    };
}

export function validateContact(contact) {
    const errors = [];
    if (!contact.firstName || !contact.firstName.trim()) {
        errors.push("First Name is required.");
    }
    if (!contact.lastName || !contact.lastName.trim()) {
        errors.push("Last Name is required.");
    }
    if (contact.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(contact.email)) {
        errors.push("Invalid email address format.");
    }
    return {
        isValid: errors.length === 0,
        errors
    };
}