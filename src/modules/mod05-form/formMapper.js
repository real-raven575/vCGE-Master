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
     * @param {string} rawText
     * @returns {{ text: string, role: string }[]} One entry per non-empty line, in card order.
     */
    classifyLines(rawText) {
        const lines = String(rawText || '').split('\n')
            .map(l => l.replace(/[“”]/g, '"').replace(/[‘’]/g, "'").replace(/\s+/g, ' ').trim())
            .filter(l => l.length > 0)
            .map(text => ({ text, ...splitLabel(text), role: null }));
        const free = (line) => line.role === null;

        // Email (labels E/Email, or anything with an @ or an OCR look-alike of it)
        let email = '';
        for (const line of lines) {
            email = findEmail(line.label === 'email' ? line.body : line.text);
            if (email) { line.role = 'email'; break; }
        }

        // Web address (label W/Web, or a domain with a known ending; www/http not required)
        let website = '';
        for (const line of lines) {
            if (!free(line)) continue;
            website = findWebsite(line.body, line.label === 'web');
            if (website) { line.role = 'website'; break; }
        }

        // Phones: buildFields sorts work / mobile / fax by label
        lines.forEach(line => { if (free(line) && findPhones(line.body).length) line.role = 'phone'; });

        // Address: City, ST ZIP (comma optional, state as code or full name, OCR slips repaired); street above it
        for (let i = 0; i < lines.length; i++) {
            if (!free(lines[i])) continue;
            const csz = findCityStateZip(lines[i].text);
            if (!csz) continue;
            if (csz.street) { lines[i].role = 'address'; break; }
            lines[i].role = 'cityStateZip';
            // street is the nearest free line above that starts with a number (plus a "Suite ..." line between them)
            for (let j = i - 1; j >= Math.max(0, i - 2); j--) {
                if (!free(lines[j])) continue;
                if (isUnitLine(lines[j].text) && j - 1 >= 0 && free(lines[j - 1]) && looksLikeStreet(lines[j - 1].text, true)) {
                    lines[j].role = lines[j - 1].role = 'street'; break;
                }
                if (looksLikeStreet(lines[j].text, true)) { lines[j].role = 'street'; break; }
            }
            break;
        }
        if (!lines.some(l => l.role === 'street' || l.role === 'address')) {
            const street = lines.find(l => free(l) && looksLikeStreet(l.text, false));
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
            const words = line.text.split(' ');
            let score = 1 - index * 0.05;
            if (local) {
                const first = words[0].toLowerCase().replace(/[^a-z]/g, ''), last = words[words.length - 1].toLowerCase().replace(/[^a-z]/g, '');
                if ((last.length > 1 && local.includes(last)) || (first.length > 2 && local.includes(first))) score += 3;
                else if (local === (first[0] || '') + last || local === first + (last[0] || '')) score += 3;
            }
            if (TITLE_WORDS.test(line.text) || TAGLINE_START.test(line.text) || COMPANY_SUFFIX.test(line.text)) score -= 3;
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
        if (title && title.score > 0) title.line.role = 'jobTitle';

        // Company: suffixes (Inc, LLC...) or a match with the web/email domain. Without a convincing line, buildFields
        // derives the company from the domain; a weak line is used only when there is no domain either.
        const domain = companyDomain(website, email).name;
        let org = null;
        lines.forEach(line => {
            if (!free(line) || /[@]/.test(line.text) || !isWordy(line.text)) return;
            let score = 1;
            if (COMPANY_SUFFIX.test(line.text)) score += 3;
            if (domain && domainMatches(line.text, domain)) score += 4;
            if (TAGLINE_START.test(line.text)) score -= 3;
            if (!org || score > org.score) org = { line, score };
        });
        if (org && (org.score >= 2 || (!domain && org.score > 0))) org.line.role = 'organization';

        return lines.map(({ text, role }) => ({ text, role: role || 'ignore' }));
    }

    /**
     * Step 2: builds contact fields from lines and their roles (as chosen by classifyLines or by the user).
     * @param {{ text: string, role: string }[]} lines
     * @returns {{ fields: Object, derived: Object }} `derived` names fields that were worked out rather than read,
     *          e.g. { organization: 'web address' } when the company comes from the domain.
     */
    buildFields(lines) {
        const fields = {
            firstName: '', lastName: '', phoneWork: '', phoneMobile: '', email: '', website: '',
            organization: '', jobTitle: '', street: '', city: '', state: '', zip: '', country: 'United States', notes: ''
        };
        const derived = {};
        const streets = [], notes = [], unlabelled = [];
        const setOnce = (key, value) => { if (value && !fields[key]) fields[key] = value; };

        for (const { text, role } of lines || []) {
            const t = String(text || '').replace(/\s+/g, ' ').trim();
            if (!t) continue;
            const { label, body } = splitLabel(t);
            switch (role) {
                case 'name': {
                    if (fields.firstName) break;
                    const words = t.split(' ');
                    fields.firstName = words[0];
                    fields.lastName = words.slice(1).join(' ');
                    break;
                }
                case 'jobTitle': setOnce('jobTitle', t); break;
                case 'organization': setOnce('organization', t); break;
                case 'email': setOnce('email', findEmail(t) || body); break;
                case 'website': setOnce('website', findWebsite(body, true) || body); break;
                case 'phone':
                    findPhones(body).forEach(({ number, label: inline }) => {
                        const kind = inline || label;
                        if (kind === 'fax') return;
                        if (kind === 'mobile' && !fields.phoneMobile) fields.phoneMobile = number;
                        else if (kind === 'work' && !fields.phoneWork) fields.phoneWork = number;
                        else unlabelled.push(number);
                    });
                    break;
                case 'phoneWork': setOnce('phoneWork', (findPhones(body)[0] || {}).number || body); break;
                case 'phoneMobile': setOnce('phoneMobile', (findPhones(body)[0] || {}).number || body); break;
                case 'street': streets.push(t); break;
                case 'cityStateZip': {
                    const csz = findCityStateZip(t);
                    if (csz) { setOnce('city', csz.city); setOnce('state', csz.state); setOnce('zip', csz.zip); if (csz.street) streets.push(csz.street); }
                    else if (/^\d{5}(?:-\d{4})?$/.test(t)) setOnce('zip', t);
                    else setOnce('city', t);
                    break;
                }
                case 'address': {
                    const csz = findCityStateZip(t);
                    if (csz) { streets.push(csz.street); setOnce('city', csz.city); setOnce('state', csz.state); setOnce('zip', csz.zip); }
                    else streets.push(t);
                    break;
                }
                case 'notes': notes.push(t); break;
                default: break;   // 'ignore'
            }
        }
        unlabelled.forEach(n => {
            if (!fields.phoneWork) fields.phoneWork = n;
            else if (!fields.phoneMobile) fields.phoneMobile = n;
        });
        fields.street = streets.filter(Boolean).join(', ');
        fields.notes = notes.join('\n');

        if (!fields.organization) {
            const domain = companyDomain(fields.website, fields.email);
            if (domain.name) { fields.organization = domain.name; derived.organization = domain.from; }
        }

        // OCR spacing is noisy ("+1(312) 555-0147"); normalise numbers the country's formatter recognises.
        const fmt = this.countryFormats[fields.country];
        if (fmt) {
            fields.phoneWork = fields.phoneWork && this.formatPhone(fields.phoneWork, fmt);
            fields.phoneMobile = fields.phoneMobile && this.formatPhone(fields.phoneMobile, fmt);
        }
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
    ['name', 'Name'], ['jobTitle', 'Job title'], ['organization', 'Company'], ['phone', 'Phone (auto by label)'],
    ['phoneWork', 'Work phone'], ['phoneMobile', 'Mobile phone'], ['email', 'Email'], ['website', 'Website'],
    ['street', 'Street'], ['cityStateZip', 'City / State / ZIP'], ['address', 'Whole address'], ['notes', 'Notes'], ['ignore', 'Ignore']
]);

// ---- Context clues for parseOCRText ----------------------------------------------------------------------------

// Web endings recognised without "www."/"http" (generic, US government/education, and common country codes).
const TLDS = 'com|net|org|edu|gov|mil|int|io|co|us|biz|info|me|app|dev|ai|tech|online|site|store|shop|pro|law|health|' +
    'ca|uk|de|fr|au|nz|in|jp|mx|br|nl|es|it|ch|se|no|dk|fi|ie|be|at|eu|za|sg|hk|cn|kr|tv|cc';
const WEB_RE = new RegExp(`^(?:https?:\\/\\/)?(?:www\\.)?[a-z0-9][a-z0-9-]*(?:\\.[a-z0-9-]+)*\\.(?:${TLDS})(?:\\/\\S*)?$`, 'i');
const EMAIL_TLD_RE = new RegExp(`^(?:[a-z0-9-]+\\.)+(?:${TLDS}|[a-z]{2,})$`, 'i');

const TITLE_WORDS = new RegExp('\\b(?:' + [
    'owner', 'co-?owner', 'founder', 'co-?founder', 'president', 'vice president', 'vp', 'svp', 'evp', 'ceo', 'cto', 'cfo', 'coo', 'cio', 'cmo', 'cso',
    'chief', 'chair(?:man|woman|person)?', 'director', 'manager', 'gm', 'head of', 'lead', 'principal', 'partner', 'managing partner',
    'associate', 'officer', 'supervisor', 'superintendent', 'administrator', 'coordinator', 'executive', 'secretary', 'treasurer',
    'engineer', 'developer', 'architect', 'designer', 'analyst', 'scientist', 'technician', 'specialist', 'consultant', 'advisor', 'adviser',
    'representative', 'rep', 'agent', 'broker', 'realtor', 'attorney', 'lawyer', 'counsel', 'paralegal', 'accountant', 'cpa', 'auditor',
    'physician', 'doctor', 'dr\\.?', 'nurse', 'rn', 'dds', 'dentist', 'pharmacist', 'therapist', 'professor', 'teacher', 'instructor',
    'sales', 'marketing', 'account executive', 'recruiter', 'editor', 'writer', 'producer', 'photographer', 'artist', 'chef', 'pastor',
    'intern', 'assistant', 'clerk', 'estimator', 'inspector', 'foreman', 'contractor', 'electrician', 'plumber', 'mechanic'
].join('|') + ')\\b', 'i');
const COMPANY_SUFFIX = /\b(?:inc|incorporated|llc|l\.l\.c|llp|ltd|limited|corp|corporation|co|company|plc|gmbh|pllc|pc|group|holdings|associates|partners|enterprises|industries|solutions|systems|technologies|technology|consulting|services|agency|studio|labs?|bank|university|college|institute|clinic|hospital)\b\.?/i;
const TAGLINE_START = /^(?:your|our|the|we|where|making|helping|serving|for all|since)\b/i;
const STREET_WORDS = /\b(?:st|street|ave|avenue|rd|road|blvd|boulevard|dr|drive|ln|lane|ct|court|way|pl|place|pkwy|parkway|hwy|highway|cir|circle|ter|terrace|trl|trail|sq|square|pike|row|loop|plaza|ste|suite|unit|floor|fl|bldg|building)\b\.?/i;
const PO_BOX = /^(?:p\.?\s?o\.?\s?box|post office box)\s*\d+/i;

const US_STATES = {
    AL: 'alabama', AK: 'alaska', AZ: 'arizona', AR: 'arkansas', CA: 'california', CO: 'colorado', CT: 'connecticut', DE: 'delaware',
    DC: 'district of columbia', FL: 'florida', GA: 'georgia', HI: 'hawaii', ID: 'idaho', IL: 'illinois', IN: 'indiana', IA: 'iowa',
    KS: 'kansas', KY: 'kentucky', LA: 'louisiana', ME: 'maine', MD: 'maryland', MA: 'massachusetts', MI: 'michigan', MN: 'minnesota',
    MS: 'mississippi', MO: 'missouri', MT: 'montana', NE: 'nebraska', NV: 'nevada', NH: 'new hampshire', NJ: 'new jersey',
    NM: 'new mexico', NY: 'new york', NC: 'north carolina', ND: 'north dakota', OH: 'ohio', OK: 'oklahoma', OR: 'oregon',
    PA: 'pennsylvania', RI: 'rhode island', SC: 'south carolina', SD: 'south dakota', TN: 'tennessee', TX: 'texas', UT: 'utah',
    VT: 'vermont', VA: 'virginia', WA: 'washington', WV: 'west virginia', WI: 'wisconsin', WY: 'wyoming', PR: 'puerto rico'
};
const STATE_BY_NAME = Object.fromEntries(Object.entries(US_STATES).map(([code, name]) => [name, code]));
const STATE_NAMES_RE = Object.values(US_STATES).sort((a, b) => b.length - a.length).join('|');
// Personal mail providers: their domain says nothing about the company.
const FREE_MAIL = /^(?:gmail|googlemail|yahoo|ymail|outlook|hotmail|live|msn|aol|icloud|me|mac|protonmail|proton|gmx|mail|comcast|att|sbcglobal|verizon|charter|cox|zoho|yandex)$/i;

// Line labels printed in front of contact details ("E jdoe@...", "Tel: ...", "M 555...", "W example.com").
const LABELS = [
    ['email', /^(?:e-?mail|email|e)\s*[:.\-]?\s+(?=\S*[@©®])/i],
    ['web', /^(?:web(?:site)?|url|w|www)\s*[:.\-]?\s+(?=\S+\.\S)/i],
    ['mobile', /^(?:mobile|mob|cell(?:ular)?|m|c)\s*[:.\-]?\s*(?=[+(\d])/i],
    ['fax', /^(?:fax|f)\s*[:.\-]?\s*(?=[+(\d])/i],
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
    const t = text.replace(/[©®]/g, '@').replace(/\s*\(\s*at\s*\)\s*|\s*\[\s*at\s*\]\s*/gi, '@');
    const m = t.match(/([A-Za-z0-9._%+-]+)\s*@\s*([A-Za-z0-9-]+(?:\s*[.,]\s*[A-Za-z0-9-]+|\s+[A-Za-z]{2,6}\b)*)/);
    if (!m) return '';
    const domain = m[2].replace(/\s*[.,]\s*/g, '.').replace(/\s+/g, '.').replace(/\.+$/, '');
    if (!EMAIL_TLD_RE.test(domain)) return '';
    return `${m[1]}@${domain}`;
}

/** Finds a web address in a line: with or without www/http, as long as it ends in a known web ending (+ optional path). */
function findWebsite(text, labelled) {
    for (const raw of text.split(' ')) {
        const token = raw.replace(/^[^A-Za-z0-9]+/, '').replace(/[\\|,;)\]]+$/, '').replace(/\.$/, '');
        if (token.includes('@') || token.length < 4) continue;
        if (WEB_RE.test(token)) return token;
        if (labelled && /^[a-z0-9-]+(?:\.[a-z0-9-]+)+(?:\/\S*)?$/i.test(token)) return token;
    }
    return '';
}

/** All US-style phone numbers in a line, each with a label written just before it ("T 269...  M 269..."). */
function findPhones(text) {
    const out = [];
    const re = /(?:\b(tel|phone|ph|office|direct|main|work|mobile|mob|cell|fax|t|p|o|d|m|c|f)\s*[:.\-]?\s*)?(\+?1[\s.\-]*)?(\(?\d{3}\)?[\s.\-]*\d{3}[\s.\-]*\d{4})(\s*(?:x|ext\.?|#)\s*\d{1,6})?/gi;
    let m;
    while ((m = re.exec(text))) {
        const digits = (m[2] || '').replace(/\D/g, '') + m[3].replace(/\D/g, '');
        if (digits.length !== 10 && !(digits.length === 11 && digits[0] === '1')) continue;
        const word = (m[1] || '').toLowerCase();
        const label = /^(?:mobile|mob|cell|m|c)$/.test(word) ? 'mobile' : /^(?:fax|f)$/.test(word) ? 'fax' : word ? 'work' : null;
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

function isUnitLine(text) {
    return /^(?:suite|ste|unit|floor|fl|bldg|building|room|rm|#)\b\.?\s*\S+$/i.test(text);
}

/** A street starts with a house number and has a street word (Road, Ave, Suite...), or is a PO Box. */
function looksLikeStreet(text, nextToCityLine) {
    if (PO_BOX.test(text)) return true;
    if (!/^\d{1,6}[A-Za-z]?\s+[A-Za-z]/.test(text) || /@/.test(text)) return false;
    return STREET_WORDS.test(text) || (nextToCityLine && text.split(' ').length >= 2 && !/\d{3}[\s.\-]\d{3}/.test(text));
}

/** 2-3 words, each capitalised letters (allowing . ' -), as names are printed. */
function isNameShaped(text) {
    const words = text.split(' ');
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
    const line = squash(text), dom = squash(domain);
    if (!line || !dom) return false;
    const first = squash(text.split(' ')[0]);
    return line === dom || line.startsWith(dom) || dom.startsWith(line) || (first.length >= 4 && dom.startsWith(first));
}
