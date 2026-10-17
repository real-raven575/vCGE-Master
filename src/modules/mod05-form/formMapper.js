/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD05: Contact Form & Auto-Mapper
 * Scope: Regex heuristics, OCR text parsing, field mapping, and international phone formatting.
 */

import { NAME_PREFIXES, NAME_SUFFIXES, REGIONS, DEFAULT_COUNTRY, SOCIAL_HOSTS, splitStreetUnit, websiteTypeFor, socialProfileUrl } from '../../share/contactOptions.js';

export class ContactFormMapper {
    constructor() {
        this.countryFormats = {
            'United States': 'US',
            'Canada': 'US',
            'United Kingdom': 'UK',
            'Germany': 'DE',
            'France': 'FR',
            'Japan': 'JP',
            'Australia': 'AU',
            'India': 'IN',
            'Brazil': 'BR',
            'Mexico': 'MX'
        };
    }

    /**
     * Maps raw OCR text from a business card to contact fields (canonical names from share/cardSchema.js CONTACT_FIELDS).
     * Same as buildFields(classifyLines(rawText)).fields: the review screen uses those two steps directly.
     * @param {string} rawText - Raw text extracted from OCR.
     * @returns {Object} Mapped contact fields.
     */
    parseOCRText(rawText) {
        return this.buildFields(this.classifyLines(rawText)).fields;
    }

    /**
     * Step 1: decides what each OCR line is (one of LINE_ROLES) by context clues instead of "first rule that matches
     * wins": line labels (E, T, M, W, Fax...), email and web-address shapes that survive common OCR slips, street words,
     * City/State/ZIP, job-title vocabulary, company suffixes, and cross-checks between lines (name vs. email username,
     * company vs. email/web domain).
     * An icon found in front of a line (MOD04 iconDetector) is one more clue: a phone, mobile, fax or home icon acts as
     * that label, an envelope or globe marks the email or web line, a pin or building the address, a social logo the
     * profile (even a bare "@handle"). A label written in the text wins over the icon, and so does the text's own shape.
     * The OCR's close second guesses for a letter (MOD04 `alts`) settle what the photo alone can't, such as a capital I
     * and a lowercase l drawn as the same bar (see applySecondGuesses).
     * @param {string|{ text: string, icon?: string, alts?: { at: number, chars: string[] }[] }[]} input - Raw OCR text,
     *        or OCR lines with their icons and second guesses.
     * @returns {{ text: string, role: string, icon: string|null }[]} One entry per non-empty line, in card order.
     */
    classifyLines(input) {
        const raw = Array.isArray(input) ? input : String(input || '').split('\n').map(text => ({ text, icon: null }));
        const lines = raw
            .map(l => ({ text: applySecondGuesses(String(l.text || ''), l.alts).replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim(), icon: l.icon || null, unsure: Array.isArray(l.unsure) && l.unsure.length > 0 }))
            .filter(l => l.text.length > 0)
            .map(({ text, icon, unsure }) => {
                const parsed = splitLabel(text);
                return { text, icon, unsure, ...parsed, label: parsed.label || ICON_LABEL[icon] || null, role: null };
            });
        const free = (line) => line.role === null;

        // Emails (labels E/Email, or anything with an @ or an OCR look-alike of it); the first one feeds the name check
        let email = '';
        for (const line of lines) {
            const found = findEmail(line.label === 'email' ? line.body : line.text);
            if (found) { line.role = 'email'; email = email || found; }
        }

        // Web addresses (label W/Web, or a domain with a known ending; www/http not required); the first non-social one
        // feeds the company check
        let website = '';
        for (const line of lines) {
            if (!free(line)) continue;
            const found = findWebsite(line.body, line.label === 'web' || SOCIAL_HOSTS[line.icon] !== undefined, line.label === 'web');
            if (found) { line.role = 'website'; if (!website && !websiteTypeFor(found)) website = found; }
            // A bare handle next to a social logo ("@studiocraft", "in/janedoe") is that profile.
            else if (SOCIAL_HOSTS[line.icon] && socialProfileUrl(line.icon, line.body)) line.role = 'website';
        }

        // Phones: one labelled number gets its type as the role (shown in the review picker); unlabelled numbers and
        // lines with several numbers stay 'phone' and buildFields sorts them (work first, then mobile).
        lines.forEach(line => {
            if (!free(line)) return;
            const phones = findPhones(line.body);
            if (!phones.length) return;
            const kind = phones.length === 1 ? phones[0].label || line.label : null;
            line.role = PHONE_ROLE[kind] || 'phone';
        });

        // Address: City, ST ZIP (comma optional, state as code or full name, OCR slips repaired); street above it
        for (let i = 0; i < lines.length; i++) {
            if (!free(lines[i])) continue;
            const csz = findAddressLine(lines[i].text);
            if (!csz) continue;
            if (csz.street) { lines[i].role = 'address'; break; }
            lines[i].role = 'cityStateZip';
            // street is the nearest free line above that starts with a number (plus a "Suite ..." line between them)
            for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
                if (!free(lines[j])) continue;
                if (isUnitLine(lines[j].text) && j - 1 >= 0 && free(lines[j - 1]) && looksLikeStreet(lines[j - 1].text, true)) {
                    lines[j].role = 'unit'; lines[j - 1].role = 'street'; break;
                }
                if (looksLikeStreet(lines[j].text, true)) { lines[j].role = 'street'; break; }
            }
            break;
        }
        if (!lines.some(l => l.role === 'street' || l.role === 'address')) {
            const street = lines.find(l => free(l) && looksLikeStreet(l.text, l.icon === 'address'));
            if (street) street.role = 'street';
        }
        if (!lines.some(l => l.role === 'cityStateZip' || l.role === 'address')) {
            const zipLine = lines.find(l => free(l) && /^\d{5}(?:-\d{4})?$/.test(l.text));
            if (zipLine) zipLine.role = 'cityStateZip';
        }

        // Name: 2-3 capitalised words; strongest clue is a match with the email username
        const local = (email.split('@')[0] || '').toLowerCase().replace(/[^a-z]/g, '');
        let best = null;
        lines.forEach((line, index) => {
            if (!free(line) || !isNameShaped(line.text)) return;
            const core = splitNameAffixes(line.text).core;
            const words = core.split(' ');
            let score = 1 - index * 0.05;
            if (local) {
                const first = words[0].toLowerCase().replace(/[^a-z]/g, ''), last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '');
                if ((last.length > 1 && local.includes(last)) || (first.length > 2 && local.includes(first))) score += 3;
                else if (local === (first[0] || '') + last || local === first + (last[0] || '')) score += 3;
            }
            if (TITLE_WORDS.test(core) || TAGLINE_START.test(core) || COMPANY_SUFFIX.test(core)) score -= 3;
            if (!best || score > best.score) best = { line, index, score };
        });
        if (best && best.score > 0) best.line.role = 'name';

        // Job title: title vocabulary, preferring the line next to the name; taglines ("Your ...") are not titles
        let title = null;
        lines.forEach((line, index) => {
            if (!free(line) || !TITLE_WORDS.test(line.text) || /[@\d]/.test(line.text)) return;
            let score = 2;
            if (best && best.score > 0 && Math.abs(index - best.index) === 1) score += 2;
            if (TAGLINE_START.test(line.text)) score -= 3;
            if (!title || score > title.score) title = { line, score };
        });
        if (title && title.score > 0) { title.line.role = 'jobTitle'; title.line.text = fixTitleSpelling(title.line.text); }

        // Company: suffixes (Inc, LLC...) or a match with the web/email domain. Without a convincing line, buildFields
        // derives the company from the domain; a weak line is used only when there is no domain either.
        const domain = companyDomain(website, email).name;
        let org = null;
        lines.forEach(line => {
            if (!free(line) || /[@]/.test(line.text) || !isWordy(line.text)) return;
            // A slogan ("Your Technology Advisor") is not the company, whatever words it contains.
            if (SLOGAN_START.test(line.text) && !(domain && domainMatches(line.text, domain))) return;
            let score = 1;
            if (COMPANY_SUFFIX.test(line.text)) score += 3;
            if (domain && domainMatches(line.text, domain)) score += 4;
            if (TAGLINE_START.test(line.text)) score -= 3;
            if (!org || score > org.score) org = { line, score };
        });
        if (org && (org.score >= 2 || (!domain && org.score > 0))) org.line.role = 'organization';

        // A web path ending in the card's own state code, its I read as a bar ("Kalamazoom\" on a Michigan card), ends
        // in that code ("KalamazooMI").
        const place = lines.map(l => (l.role === 'cityStateZip' || l.role === 'address') && { line: l, ...findAddressLine(l.text) }).find(a => a && a.state) || {};
        const state = place.state;
        if (state) lines.forEach(l => { if (l.role === 'website') l.body = endWithStateCode(l.body, state); });

        // Lines to check before filling (shown under the line in the review box): a ZIP code the card's state doesn't use,
        // and lines with words the OCR was unsure of (MOD04 `unsure`). Phone numbers are checked by their own shape.
        if (place.line && place.country === DEFAULT_COUNTRY && !zipFitsState(place.zip, state)) {
            place.line.check = `${place.zip} is not a ${REGION_NAME[state] || state} ZIP code. Please check it.`;
        }
        lines.forEach(l => {
            if (!l.check && l.unsure && l.role && !PHONE_ROLES.has(l.role) && l.role !== 'phone') l.check = 'The reader was not sure of some letters here. Please check them.';
        });

        // The review box shows the value that will be filled: no line label ("E", "T", "w"...), the label having set the
        // role, and email and web addresses with their OCR slips repaired. Lines with several numbers keep their labels.
        // An email domain one or two OCR slips away from the web address takes the web address's spelling.
        const site = (lines.map(l => l.role === 'website' && reviewText(l)).find(w => w && !websiteTypeFor(w))) || '';
        return lines.map(line => ({
            text: line.role === 'email' ? matchEmailToWebsite(reviewText(line), site, true) : reviewText(line), role: line.role || 'ignore', icon: line.icon,
            ...(line.check ? { check: line.check } : {})
        }));
    }

    /**
     * Step 2: builds contact fields from lines and their roles (as chosen by classifyLines or by the user).
     * @param {{ text: string, role: string }[]} lines
     * @returns {{ fields: Object, derived: Object }} `derived` names fields that were worked out rather than read,
     *          e.g. { organization: 'web address' } when the company comes from the domain.
     */
    buildFields(lines) {
        const fields = {
            namePrefix: '', firstName: '', middleName: '', lastName: '', nameSuffix: '', organization: '', jobTitle: '',
            phones: [], emails: [], websites: [],
            addressType: 'work', street: '', unitType: '', unitNumber: '', city: '', state: '', zip: '', country: DEFAULT_COUNTRY, notes: ''
        };
        const derived = {};
        const streets = [], units = [], notes = [], unlabelled = [], emailValues = [];
        const setOnce = (key, value) => { if (value && !fields[key]) fields[key] = value; };
        const addPhone = (type, number) => { if (number && !fields.phones.some(p => p.value === number)) fields.phones.push({ type, value: number }); };
        let addressFound = false;
        const setAddress = (a) => {
            // The first City/State/ZIP line found also decides the country (US or Canada).
            if (!addressFound && a.country) fields.country = a.country;
            addressFound = true;
            setOnce('city', a.city); setOnce('state', a.state); setOnce('zip', a.zip);
            if (a.street) streets.push(a.street);
        };

        for (const { text, role, icon } of lines || []) {
            const t = String(text || '').replace(/\s+/g, ' ').trim();
            if (!t) continue;
            const parsed = splitLabel(t);
            const body = parsed.body, label = parsed.label || ICON_LABEL[icon] || null;
            switch (role) {
                case 'name':
                    if (!fields.firstName) Object.assign(fields, parseName(t));
                    break;
                case 'jobTitle': setOnce('jobTitle', t); break;
                case 'organization': setOnce('organization', t); break;
                case 'email': emailValues.push(findEmail(t) || body); break;
                case 'website': {
                    const social = SOCIAL_HOSTS[icon] ? icon : null;
                    const site = findWebsite(body, true, label === 'web') || (social && socialProfileUrl(social, body)) || body;
                    if (!fields.websites.some(w => w.value === site)) fields.websites.push({ type: websiteTypeFor(site) || social || 'work', value: site });
                    break;
                }
                case 'phone':
                    findPhones(body).forEach(({ number, label: inline }) => {
                        const kind = inline || label;
                        if (kind === 'fax') addPhone('workFax', number);
                        else if (kind === 'mobile' || kind === 'home' || kind === 'work') addPhone(kind, number);
                        else unlabelled.push(number);
                    });
                    break;
                case 'phoneWork': addPhone('work', (findPhones(body)[0] || {}).number || body); break;
                case 'phoneMobile': addPhone('mobile', (findPhones(body)[0] || {}).number || body); break;
                case 'phoneHome': addPhone('home', (findPhones(body)[0] || {}).number || body); break;
                case 'phoneFax': addPhone('workFax', (findPhones(body)[0] || {}).number || body); break;
                case 'street': streets.push(t); break;
                case 'unit': units.push(t); break;
                case 'cityStateZip': {
                    const a = findAddressLine(t);
                    if (a) setAddress(a);
                    else if (/^\d{5}(?:-\d{4})?$/.test(t)) setOnce('zip', t);
                    else setOnce('city', t);
                    break;
                }
                case 'address': {
                    const a = findAddressLine(t);
                    if (a) setAddress(a); else streets.push(t);
                    break;
                }
                case 'notes': notes.push(t); break;
                default: break;   // 'ignore'
            }
        }
        // Unlabelled numbers: work first, then mobile, then other.
        unlabelled.forEach(n => {
            const has = (type) => fields.phones.some(p => p.type === type);
            addPhone(!has('work') ? 'work' : !has('mobile') ? 'mobile' : 'other', n);
        });

        // Street and unit: "4120 Lakeshore Road, Suite 405" or a separate "Suite 405" line.
        const split = splitStreetUnit(streets.filter(Boolean).join(', '));
        fields.street = split.street;
        const unit = units.length ? splitStreetUnit(units.join(' ')) : split;
        fields.unitType = unit.unitType;
        fields.unitNumber = unit.unitNumber;
        fields.notes = notes.join('\n');

        if (!fields.organization) {
            const domain = companyDomain((fields.websites.find(w => !websiteTypeFor(w.value)) || {}).value, emailValues[0]);
            if (domain.name) { fields.organization = domain.name; derived.organization = domain.from; }
        }
        // Emails: personal mail providers are Personal, everything else Work.
        const site = (fields.websites.find(w => !websiteTypeFor(w.value)) || {}).value;
        emailValues.filter(Boolean).map(value => matchEmailToWebsite(value, site)).forEach(value => {
            if (fields.emails.some(e => e.value === value)) return;
            const host = (value.split('@')[1] || '').split('.');
            const name = host.length > 2 && host[host.length - 2].length <= 3 ? host[host.length - 3] : host[host.length - 2];
            fields.emails.push({ type: FREE_MAIL.test(name || '') ? 'personal' : 'work', value });
        });

        // OCR spacing is noisy ("+1(312) 555-0147"); normalise numbers the country's formatter recognises.
        const fmt = this.countryFormats[fields.country];
        if (fmt) fields.phones.forEach(p => { p.value = this.formatPhone(p.value, fmt); });
        return { fields, derived };
    }

    /**
     * Formats phone numbers according to the selected country standard.
     * @param {string} rawNumber - Raw phone string.
     * @param {string} formatType - Format key ('US', 'UK', 'DE', etc.).
     * @returns {string} Formatted phone string.
     */
    formatPhone(rawNumber, formatType = 'US') {
        let digits = rawNumber.replace(/\D/g, '');
        if (!digits) return rawNumber;

        if (formatType === 'US') {
            if (digits.length === 10) {
                return `+1 (${digits.slice(0,3)}) ${digits.slice(3,6)}-${digits.slice(6)}`;
            } else if (digits.length === 11 && digits.startsWith('1')) {
                return `+1 (${digits.slice(1,4)}) ${digits.slice(4,7)}-${digits.slice(7)}`;
            }
        } else if (formatType === 'UK') {
            if (digits.startsWith('44')) digits = digits.slice(2);
            if (digits.length >= 10) {
                return `+44 ${digits.slice(0,2)} ${digits.slice(2,6)} ${digits.slice(6)}`;
            }
        } else if (formatType === 'DE') {
            if (digits.startsWith('49')) digits = digits.slice(2);
            return `+49 ${digits.slice(0,3)} ${digits.slice(3)}`;
        }
        return rawNumber;
    }
}

/** Line roles offered in the OCR review screen, in display order: [role, label]. */
export const LINE_ROLES = Object.freeze([
    ['name', 'Name'], ['jobTitle', 'Job title'], ['organization', 'Company'], ['phone', 'Phone (type from label)'],
    ['phoneWork', 'Work phone'], ['phoneMobile', 'Mobile phone'], ['phoneHome', 'Home phone'], ['phoneFax', 'Fax'],
    ['email', 'Email'], ['website', 'Website / social'], ['street', 'Street'], ['unit', 'Apt / suite / unit'],
    ['cityStateZip', 'City / State / ZIP'], ['address', 'Whole address'], ['notes', 'Notes'], ['ignore', 'Ignore']
]);

// ---- Context clues for parseOCRText ----------------------------------------------------------------------------

// Web endings recognised without "www."/"http" (generic, US government/education, and common country codes).
const TLDS = 'com|net|org|edu|gov|mil|int|io|co|us|biz|info|me|app|dev|ai|tech|online|site|store|shop|pro|law|health|' +
    'ca|uk|de|fr|au|nz|in|jp|mx|br|nl|es|it|ch|se|no|dk|fi|ie|be|at|eu|za|sg|hk|cn|kr|tv|cc';
const WEB_RE = new RegExp(`^(?:https?:\\/\\/)?(?:www\\.)?[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})(?:\\/\\S*)?$`, 'i');
const EMAIL_TLD_RE = new RegExp(`^(?:[a-z0-9-]+\\.)+(?:${TLDS}|[a-z]{2,})$`, 'i');

const TITLE_TERMS = [
    'owner', 'co-?owner', 'founder', 'co-?founder', 'president', 'vice president', 'vp', 'svp', 'evp', 'ceo', 'cto', 'cfo', 'coo', 'cio', 'cmo', 'cso',
    'chief', 'chair(?:man|woman|person)?', 'director', 'manager', 'gm', 'head of', 'lead', 'principal', 'partner', 'managing partner',
    'associate', 'officer', 'supervisor', 'superintendent', 'administrator', 'coordinator', 'executive', 'secretary', 'treasurer',
    'engineer', 'developer', 'architect', 'designer', 'analyst', 'scientist', 'technician', 'specialist', 'consultant', 'advisor', 'adviser',
    'representative', 'rep', 'agent', 'broker', 'realtor', 'attorney', 'lawyer', 'counsel', 'paralegal', 'accountant', 'cpa', 'auditor',
    'physician', 'doctor', 'dr\\.?', 'nurse', 'rn', 'dds', 'dentist', 'pharmacist', 'therapist', 'professor', 'teacher', 'instructor',
    'sales', 'marketing', 'account executive', 'recruiter', 'editor', 'writer', 'producer', 'photographer', 'artist', 'chef', 'pastor',
    'intern', 'assistant', 'clerk', 'estimator', 'inspector', 'foreman', 'contractor', 'electrician', 'plumber', 'mechanic'
];
const TITLE_WORDS = new RegExp('\\b(?:' + TITLE_TERMS.join('|') + ')\\b', 'i');
// Words a job title is spelled with, for repairing OCR slips in them (see fixTitleSpelling): the plain title words
// above plus the words around them ("General Manager", "Senior Vice President").
const TITLE_SPELLING = new Set([...TITLE_TERMS.filter(t => /^[a-z]+$/.test(t)), ...[
    'general', 'senior', 'junior', 'deputy', 'regional', 'national', 'global', 'international', 'district', 'branch', 'area',
    'operations', 'office', 'technology', 'information', 'business', 'development', 'customer', 'service', 'services',
    'project', 'product', 'program', 'account', 'human', 'resources', 'finance', 'financial', 'leader', 'member', 'staff',
    'store', 'creative', 'technical', 'medical', 'legal', 'client', 'community', 'relations', 'communications', 'research',
    'quality', 'safety', 'security', 'support', 'systems', 'network', 'software', 'hardware', 'field', 'education',
    'public', 'affairs', 'digital', 'media', 'content', 'strategy', 'planning', 'events', 'managing', 'chairman',
    'chairwoman', 'chairperson', 'owner', 'founder'
]]);
const COMPANY_SUFFIX = /\b(?:inc|incorporated|llc|l\.l\.c|llp|ltd|limited|corp|corporation|co|company|plc|gmbh|pllc|pc|group|holdings|associates|partners|enterprises|industries|solutions|systems|technologies|technology|consulting|services|agency|studio|labs?|bank|university|college|institute|clinic|hospital)\b\.?/i;
const TAGLINE_START = /^(?:your|our|the|we|where|making|helping|serving|for all|since)\b/i;
const SLOGAN_START = /^(?:your|our|we|where|making|helping|serving|for all|since)\b/i;   // "The ..." can be a company name
const STREET_WORDS = /\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail|sq|square|pike|row|loop|plaza|ste|suite|unit|floor|fl|bldg|building)\b\.?/i;
const PO_BOX = /^(?:p\.?\s?o\.?\s?box|post office box)\s*\d+/i;

// US states and Canadian provinces come from the shared region lists (share/contactOptions.js).
const US_STATES = Object.fromEntries(REGIONS['United States'].regions.map(([code, name]) => [code, name.toLowerCase()]));
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name, code]));
const STATE_NAMES_RE = Object.values(US_STATES).sort((a, b) => b.length - a.length).map(n => n.replace(/\./g, '\\.')).join('|');
const CA_PROVINCES = Object.fromEntries(REGIONS['Canada'].regions.map(([code, name]) => [code, name.toLowerCase()]));
const PROVINCE_BY_NAME = Object.fromEntries(Object.entries(CA_PROVINCES).map(([code, name]) => [name, code]));
const PROVINCE_NAMES_RE = Object.values(CA_PROVINCES).sort((a, b) => b.length - a.length).join('|');
// Personal mail providers: their domain says nothing about the company.
const FREE_MAIL = /^(?:gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|mac|protonmail|proton|gmx|mail|comcast|att|sbcglobal|verizon|charter|cox|zoho|yandex)$/i;

// What an icon in front of a line means when the text carries no label of its own (MOD04 iconDetector classes).
const ICON_LABEL = { phone: 'work', mobile: 'mobile', fax: 'fax', home: 'home', email: 'email', web: 'web' };
// Review-picker role for a phone line whose type is known.
const PHONE_ROLE = { work: 'phoneWork', mobile: 'phoneMobile', home: 'phoneHome', fax: 'phoneFax' };

/** OCR reads the I (or l) inside an address as "\" or "|": "BrightPath\T.com" -> "BrightPathIT.com". Only between letters or digits. */
function repairAddressText(text) {
    return text.replace(/(?<=[A-Za-z0-9])[\\|](?=[A-Za-z0-9])/g, 'I');
}

/**
 * Many card fonts draw a capital I and a lowercase l or i as the same bar. Inside a web or email address, a letter the
 * OCR also read as "I" (MOD04 second guesses: [{ at, chars }]) becomes "I" when it follows a letter and comes before a
 * capital: "TeamLogiciT.com" -> "TeamLogicIT.com". Everywhere else the OCR's pick stands.
 */
function applySecondGuesses(text, alts) {
    if (!Array.isArray(alts) || !alts.length) return text;
    const out = text.split('');
    for (const { at, chars } of alts) {
        if (!Array.isArray(chars) || out[at] !== chars[0] || chars[0] === 'I' || !chars.includes('I')) continue;
        if (!/[A-Za-z]/.test(out[at - 1] || '') || !/[A-Z]/.test(out[at + 1] || '')) continue;
        const start = text.lastIndexOf(' ', at) + 1, end = text.indexOf(' ', at);
        const token = text.slice(start, end < 0 ? text.length : end);
        if (/@/.test(token) || WEB_RE.test(token.replace(/[^A-Za-z0-9]+$/, '')) || /\.[A-Za-z]{2,}\//.test(token)) out[at] = 'I';
    }
    return out.join('');
}

/** ".../Kalamazoom\" with MI as the card's state -> ".../KalamazooMI": only when the path ends in a bar OCR made of an I. */
function endWithStateCode(text, state) {
    return text.replace(/(\/[A-Za-z-]{3,})([A-Za-z])([\\|!1])(?=\s|$)/, (m, path, letter, bar) => (normaliseState(letter + bar) === state ? path + state : m));
}

/** The "/" after a web ending read as a bar: "TeamLogicIT.comIKalamazoo" -> "TeamLogicIT.com/Kalamazoo" (bar before a capital). */
function repairSlash(text) {
    return text.replace(SLASH_AS_BAR, '$1/');
}
const SLASH_AS_BAR = new RegExp(`(?<=[A-Za-z0-9])(\\.(?:${TLDS}))[Il1|!\\\\](?=[A-Z][a-z])`, 'g');

/**
 * OCR slips in a job title's words, repaired against the title vocabulary (TITLE_SPELLING): vowels read as other vowels
 * ("Ganaral" -> "General", at most 2) or one dropped letter ("Manger" -> "Manager"). Only words of 5+ letters, and only
 * when exactly one title word fits; the word's capitals are kept.
 */
function fixTitleSpelling(text) {
    const VOWEL = /[aeiou]/;
    const fits = (read, word) => {
        if (word.length === read.length) {
            let diffs = 0;
            for (let i = 0; i < word.length; i++) {
                if (read[i] === word[i]) continue;
                if (!VOWEL.test(read[i]) || !VOWEL.test(word[i]) || ++diffs > 2) return false;
            }
            return diffs > 0;
        }
        return word.length === read.length + 1 && [...word].some((_, i) => word.slice(0, i) + word.slice(i + 1) === read);
    };
    return text.replace(/[A-Za-z]{5,}/g, (read) => {
        const lower = read.toLowerCase();
        if (TITLE_SPELLING.has(lower)) return read;
        const found = [...TITLE_SPELLING].filter(word => fits(lower, word));
        if (found.length !== 1) return read;
        const word = found[0];
        if (read === read.toUpperCase()) return word.toUpperCase();
        return /^[A-Z]/.test(read) ? word[0].toUpperCase() + word.slice(1) : word;
    });
}

// First three digits of the ZIP codes each state uses (USPS ranges; a few areas are shared across a state line).
const ZIP_PREFIXES = {
    AL: [[350, 369]], AK: [[995, 999]], AZ: [[850, 865]], AR: [[716, 729], [755, 755]], CA: [[900, 961]], CO: [[800, 816]],
    CT: [[60, 69]], DE: [[197, 199]], DC: [[200, 205], [569, 569]], FL: [[320, 349]], GA: [[300, 319], [398, 399]],
    HI: [[967, 968]], ID: [[832, 838]], IL: [[600, 629]], IN: [[460, 479]], IA: [[500, 528]], KS: [[660, 679]],
    KY: [[400, 427]], LA: [[700, 714]], ME: [[39, 49]], MD: [[206, 219]], MA: [[10, 27], [55, 55]], MI: [[480, 499]],
    MN: [[550, 567]], MS: [[386, 397]], MO: [[630, 658]], MT: [[590, 599]], NE: [[680, 693]], NV: [[889, 898]],
    NH: [[30, 38]], NJ: [[70, 89]], NM: [[870, 884]], NY: [[100, 149], [5, 5], [63, 63]], NC: [[270, 289]], ND: [[580, 588]],
    OH: [[430, 459]], OK: [[730, 749]], OR: [[970, 979]], PA: [[150, 196]], RI: [[28, 29]], SC: [[290, 299]],
    SD: [[570, 577]], TN: [[370, 385]], TX: [[733, 733], [750, 799], [885, 885]], UT: [[840, 847]], VT: [[50, 59]],
    VA: [[201, 201], [220, 246]], WA: [[980, 994]], WV: [[247, 268]], WI: [[530, 549]], WY: [[820, 831]],
    PR: [[6, 9]], VI: [[8, 8]], GU: [[969, 969]], AS: [[967, 967]], MP: [[969, 969]]
};
const REGION_NAME = Object.fromEntries(REGIONS['United States'].regions);

/** Does this ZIP belong to the state? A state without a known range is not questioned. */
function zipFitsState(zip, state) {
    const ranges = ZIP_PREFIXES[state];
    if (!ranges || !/^\d{5}/.test(String(zip || ''))) return true;
    const prefix = Number(String(zip).slice(0, 3));
    return ranges.some(([from, to]) => prefix >= from && prefix <= to);
}

/** What the review box shows for a classified line (see the end of classifyLines). */
function reviewText({ text, body, label, role, icon }) {
    if (role === 'email') return findEmail(body) || findEmail(text) || repairAddressText(body);
    if (role === 'website') return findWebsite(body, label === 'web' || SOCIAL_HOSTS[icon] !== undefined, label === 'web') || repairAddressText(body);
    if (PHONE_ROLES.has(role)) return body;
    return text;
}
const PHONE_ROLES = new Set(Object.values(PHONE_ROLE));

/**
 * OCR slips in an email domain ("TeamlLogiciT.com", "TeamlogicIT.com") are fixed from the web address on the same card
 * ("TeamLogicIT.com"): same ending, a name of 6+ letters, at most 2 letters different. Anything further apart is
 * taken to be a different domain and left alone. Capitals alone are changed only with `capitals` (the review box).
 */
function matchEmailToWebsite(email, website, capitals = false) {
    const at = String(email || '').lastIndexOf('@');
    const siteHost = String(website || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    if (at < 1 || !siteHost) return email;
    const mailHost = email.slice(at + 1);
    // Same domain but for capitals ("TeamlogicIT.com"): in the review box, the web address's spelling when it has capitals
    // of its own. Text the user typed (buildFields) keeps its capitals.
    if (mailHost.toLowerCase() === siteHost.toLowerCase()) return capitals && /[A-Z]/.test(siteHost) ? email.slice(0, at + 1) + siteHost : email;
    const split = (host) => { const i = host.lastIndexOf('.'); return [host.slice(0, i).toLowerCase(), host.slice(i + 1).toLowerCase()]; };
    const [mailName, mailEnd] = split(mailHost), [siteName, siteEnd] = split(siteHost);
    if (mailEnd !== siteEnd || siteName.length < 6 || editDistance(mailName, siteName) > 2) return email;
    return email.slice(0, at + 1) + siteHost;
}

function editDistance(a, b) {
    let prev = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
        const row = [i];
        for (let j = 1; j <= b.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        prev = row;
    }
    return prev[b.length];
}

// Line labels printed in front of contact details ("E jdoe@...", "Tel: ...", "M 555...", "W example.com").
const LABELS = [
    ['email', /^(?:e-?mail|email|e)\s*[:.\-]?\s+(?=\S*[@©®])/i],
    ['web', /^(?:web(?:site)?|url|w|www)\s*[:.\-]?\s+(?=\S+\.\S)/i],
    ['mobile', /^(?:mobile|mob|cell(?:ular)?|m|c)\s*[:.\-]?\s*(?=[+(\d])/i],
    ['fax', /^(?:fax|f)\s*[:.\-]?\s*(?=[+(\d])/i],
    ['home', /^(?:home|res(?:idence)?|h)\s*[:.\-]?\s*(?=[+(\d])/i],
    ['work', /^(?:tel(?:ephone)?|phone|ph|office|off|direct|main|work|t|p|o|d)\s*[:.\-]?\s*(?=[+(\d])/i]
];

function splitLabel(text) {
    for (const [label, re] of LABELS) {
        const m = text.match(re);
        if (m) return { label, body: text.slice(m[0].length).trim() };
    }
    return { label: null, body: text };
}

/** Finds an email, repairing common OCR slips: "©"/"®" for "@", spaces around "@" or ".", a space where the dot was. */
function findEmail(text) {
    const t = repairAddressText(text).replace(/[©®]/g, '@').replace(/\s*\(\s*at\s*\)\s*|\s*\[\s*at\s*\]\s*/gi, '@');
    const m = t.match(/([A-Za-z0-9._%+-]+)\s*@\s*([A-Za-z0-9-]+(?:\s*[.,]\s*[A-Za-z0-9-]+|\s+[A-Za-z]{2,6}\b)*)/);
    if (!m) return '';
    const domain = m[2].replace(/\s*[.,]\s*/g, '.').replace(/\s+/g, '.').replace(/\.+$/, '');
    if (!EMAIL_TLD_RE.test(domain)) return '';
    return `${m[1]}@${domain}`;
}

/**
 * Finds a web address in a line: with or without www/http, as long as it ends in a known web ending (+ optional path).
 * On a labelled web line, one word after a bare domain is its path: OCR reads "example.com/Chicago" as "example.com Chicago".
 */
function findWebsite(text, labelled, joinPath = labelled) {
    const tokens = repairSlash(repairAddressText(text)).split(' ');
    for (let i = 0; i < tokens.length; i++) {
        const token = tokens[i].replace(/^[^A-Za-z0-9]+/, '').replace(/[\\|,;)\]]+$/, '').replace(/\.$/, '');
        if (token.includes('@') || token.length < 4) continue;
        if (!WEB_RE.test(token) && !(labelled && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(token))) continue;
        const next = tokens.slice(i + 1);
        if (joinPath && next.length === 1 && /^[A-Za-z0-9-]{2,}$/.test(next[0]) && !token.includes('/')) return `${token}/${next[0]}`;
        return token;
    }
    return '';
}

/** All US-style phone numbers in a line, each with a label written just before it ("T 269...  M 269..."). */
function findPhones(text) {
    const out = [];
    const re = /(?:\b(tel|phone|ph|office|direct|main|work|mobile|mob|cell|fax|home|t|p|o|d|m|c|f|h)\s*[:.\-]?\s*)?(\+?1[\s.\-]*)?(\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4})(\s*(?:x|ext\.?|#)\s*\d{1,6})?/gi;
    let m;
    while ((m = re.exec(text))) {
        const digits = (m[2] || '').replace(/\D/g, '') + m[3].replace(/\D/g, '');
        if (digits.length !== 10 && !(digits.length === 11 && digits[0] === '1')) continue;
        const word = (m[1] || '').toLowerCase();
        const label = /^(?:mobile|mob|cell|m|c)$/.test(word) ? 'mobile' : /^(?:fax|f)$/.test(word) ? 'fax'
            : /^(?:home|h)$/.test(word) ? 'home' : word ? 'work' : null;
        out.push({ number: ((m[2] || '') + m[3] + (m[4] || '')).trim(), label });
    }
    return out;
}

/** OCR often reads the I of a state code as \ | l 1 or !, and O as 0. */
function normaliseState(token) {
    const t = token.replace(/\.$/, '');
    if (t.length > 2) return STATE_BY_NAME[t.toLowerCase()] || '';
    const upper = t.toUpperCase();
    if (US_STATES[upper]) return upper;
    // Repair only codes that are not already valid (IL, AL, FL keep their L).
    const repaired = upper.replace(/[\\|L1!]/g, 'I').replace(/0/g, 'O').replace(/5/g, 'S');
    return US_STATES[repaired] ? repaired : '';
}

/** "Springfield, IL 62701", "Springfield IL 62701", "Springfield, Illinois 62701", or a whole address on one line. */
function findCityStateZip(text) {
    const re = new RegExp(`^(.*?)[,\\s]+(${STATE_NAMES_RE}|[A-Za-z][A-Za-z\\\\|1!0]\\.?)[,\\s]+(\\d{5}(?:-\\d{4})?)\\b`, 'i');
    const m = text.match(re);
    if (!m) return null;
    const state = normaliseState(m[2]);
    if (!state) return null;
    const parts = m[1].split(',').map(p => p.trim()).filter(Boolean);
    const city = (parts.pop() || '').replace(/^[^A-Za-z]+/, '');
    if (!/^[A-Za-z][A-Za-z .'-]*$/.test(city)) return null;
    const street = parts.length && /^\d/.test(parts[0]) ? parts.join(', ') : '';
    return { city, state, zip: m[3], street };
}

/** "Toronto, ON M5H 2N2", "Toronto Ontario M5H2N2", or a whole Canadian address on one line. */
function findCanadianCityProvince(text) {
    const re = new RegExp(`^(.*?)[,\\s]+(${PROVINCE_NAMES_RE}|[A-Za-z]{2}\\.?)[,\\s]+([A-Za-z]\\d[A-Za-z])\\s?(\\d[A-Za-z]\\d)\\b`, 'i');
    const m = text.match(re);
    if (!m) return null;
    const token = m[2].replace(/\.$/, '');
    const state = token.length > 2 ? PROVINCE_BY_NAME[token.toLowerCase()] : (CA_PROVINCES[token.toUpperCase()] ? token.toUpperCase() : '');
    if (!state) return null;
    const parts = m[1].split(',').map(p => p.trim()).filter(Boolean);
    const city = (parts.pop() || '').replace(/^[^A-Za-z]+/, '');
    if (!/^[A-Za-z][A-Za-z .'-]*$/.test(city)) return null;
    const street = parts.length && /^\d/.test(parts[0]) ? parts.join(', ') : '';
    return { city, state, zip: `${m[3]} ${m[4]}`.toUpperCase(), street, country: 'Canada' };
}

/** US first, then Canada. */
function findAddressLine(text) {
    const us = findCityStateZip(text);
    return us ? { ...us, country: DEFAULT_COUNTRY } : findCanadianCityProvince(text);
}

function isUnitLine(text) {
    return /^(?:suite|ste|unit|floor|fl|bldg|building|room|rm|#)\b\.?\s*\S+$/i.test(text);
}

/** A street starts with a house number and has a street word (Road, Ave, Suite...), or is a PO Box. */
function looksLikeStreet(text, nextToCityLine) {
    if (PO_BOX.test(text)) return true;
    // House number, then the street name (which may itself be numbered: "1201 3rd Avenue").
    if (!/^\d{1,6}[A-Za-z]?\s+(?:\d{1,3}(?:st|nd|rd|th)\s+)?[A-Za-z]/i.test(text) || /@/.test(text)) return false;
    return STREET_WORDS.test(text) || (nextToCityLine && text.split(' ').length >= 2 && !/\d{3}[\s.\-]\d{3}/.test(text));
}

const affix = (list) => new RegExp(`^(?:${list.map(a => a.replace(/\./g, '')).join('|')})\\.?$`, 'i');
const PREFIX_RE = affix(NAME_PREFIXES), SUFFIX_RE = affix(NAME_SUFFIXES);

/** "Dr. Jane Q. Roe, PhD" -> { prefix: 'Dr.', core: 'Jane Q. Roe', suffix: 'PhD' } (prefix/suffix written as listed). */
function splitNameAffixes(text) {
    let words = text.replace(/,/g, ' , ').split(' ').filter(Boolean);
    let prefix = '', suffix = '';
    const canonical = (word, list) => list.find(a => a.replace(/\./g, '').toLowerCase() === word.replace(/\./g, '').toLowerCase()) || word;
    if (words.length > 2 && PREFIX_RE.test(words[0])) prefix = canonical(words.shift(), NAME_PREFIXES);
    while (words.length && words[words.length - 1] === ',') words.pop();
    if (words.length > 2 && SUFFIX_RE.test(words[words.length - 1])) suffix = canonical(words.pop(), NAME_SUFFIXES);
    words = words.filter(w => w !== ',');
    return { prefix, core: words.join(' '), suffix };
}

/** Name parts from a name line: 3 words are first, middle, last; 2 words first and last. */
function parseName(text) {
    const { prefix, core, suffix } = splitNameAffixes(text);
    const words = core.split(' ').filter(Boolean);
    return {
        namePrefix: prefix, firstName: words[0] || '', middleName: words.length > 2 ? words.slice(1, -1).join(' ') : '',
        lastName: words.length > 1 ? words[words.length - 1] : '', nameSuffix: suffix
    };
}

/** 2-3 words, each capitalised letters (allowing . ' -), as names are printed (prefix and suffix aside). */
function isNameShaped(text) {
    const words = splitNameAffixes(text).core.split(' ');
    if (words.length < 2 || words.length > 3) return false;
    return words.every(w => /^[A-Z][a-zA-Z.'\-]*$/.test(w) && /[a-z]/.test(w) || /^[A-Z]\.?$/.test(w));
}

/** A line made of real words (not logo debris such as "ya O/" or "ro. (CET"). */
function isWordy(text) {
    const chars = text.replace(/\s/g, '');
    const letters = (chars.match(/[A-Za-z]/g) || []).length;
    return chars.length >= 3 && letters / chars.length >= 0.8 && /[A-Za-z]{3,}/.test(text) && !/[()\/\\|{}<>]/.test(text);
}

/** Company name from the web address (preferred) or the email domain, unless it is a personal mail provider. */
function companyDomain(website, email) {
    const fromSite = String(website || '').replace(/^https?:\/\//i, '').replace(/^www\./i, '').split('/')[0];
    const fromMail = (String(email || '').split('@')[1] || '');
    for (const [host, from] of [[fromSite, 'web address'], [fromMail, 'email']]) {
        const labels = host.split('.').filter(Boolean);
        if (labels.length < 2) continue;
        const name = labels[labels.length - 2].length <= 3 && labels.length > 2 ? labels[labels.length - 3] : labels[labels.length - 2];
        if (name && !FREE_MAIL.test(name)) return { name, from };
    }
    return { name: '', from: '' };
}

/** "Northwind Systems" matches northwind.com; "Apex Innovations" matches apexinnovations.io. */
function domainMatches(text, domain) {
    const squash = (s) => s.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/[il1|]/g, 'l');
    text = text.replace(/^the\s+/i, '');   // "The Home Depot" matches homedepot.com
    const line = squash(text), dom = squash(domain);
    if (!line || !dom) return false;
    const first = squash(text.split(' ')[0]);
    return line === dom || line.startsWith(dom) || dom.startsWith(line) || (first.length >= 4 && dom.startsWith(first));
}
