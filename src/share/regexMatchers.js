/**
 * vCGE (vCard Generator Engine) - Universal RegEx Heuristics (`regexMatchers.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575 and Gemini
 *
 * Shared regex constants. OCR text-to-contact mapping lives in MOD05 (ContactFormMapper).
 */

export const RegexMatchers = {
    email: /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
    phone: /(?:\+?(\d{1,3}))?[-. (]*(\d{3})[-. )]*(\d{3})[-. ]*(\d{4})(?: *x(\d+))?/g,
    url: /https?:\/\/(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{1,256}\.[a-zA-Z0-9()]{1,6}\b(?:[-a-zA-Z0-9()@:%_\+.~#?&//=]*)/g,
    zipCode: /\b\d{5}(?:-\d{4})?\b|[A-Z]\d[A-Z] \d[A-Z]\d/g
};