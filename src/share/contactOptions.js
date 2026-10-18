/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Team vCGE (Claude) & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-SHARE: the choices offered in the contact form (and understood by the OCR mapper and vCard builder).
 * One source of truth: [value, label] pairs, plus per-country region lists.
 */

// Suggestions only: the form accepts any prefix/suffix typed in.
export const NAME_PREFIXES = Object.freeze(['Mr.', 'Mrs.', 'Ms.', 'Mx.', 'Dr.', 'Prof.', 'Rev.', 'Hon.']);
export const NAME_SUFFIXES = Object.freeze(['Jr.', 'Sr.', 'II', 'III', 'IV', 'PhD', 'MD', 'DDS', 'Esq.', 'CPA']);
export const UNIT_TYPES = Object.freeze(['Apt', 'Suite', 'Unit', 'Lot', 'Floor', 'Building', 'Room', 'PO Box']);

export const ADDRESS_TYPES = Object.freeze([['work', 'Work'], ['home', 'Home'], ['other', 'Other']]);

export const PHONE_TYPES = Object.freeze([
    ['mobile', 'Mobile'], ['work', 'Work'], ['home', 'Home'], ['main', 'Main'],
    ['workFax', 'Work fax'], ['homeFax', 'Home fax'], ['pager', 'Pager'], ['other', 'Other']
]);
export const EMAIL_TYPES = Object.freeze([['work', 'Work'], ['personal', 'Personal'], ['other', 'Other']]);

// Social types carry the hosts that identify them (used by the OCR mapper) and the name used in the vCard.
export const WEBSITE_TYPES = Object.freeze([
    ['work', 'Work'], ['personal', 'Personal'], ['blog', 'Blog'], ['portfolio', 'Portfolio'], ['other', 'Other'],
    ['linkedin', 'LinkedIn'], ['x', 'X / Twitter'], ['facebook', 'Facebook'], ['instagram', 'Instagram'],
    ['github', 'GitHub'], ['youtube', 'YouTube'], ['tiktok', 'TikTok'], ['reddit', 'Reddit']
]);
export const SOCIAL_HOSTS = Object.freeze({
    linkedin: ['linkedin.com'], x: ['x.com', 'twitter.com'], facebook: ['facebook.com', 'fb.com', 'fb.me'],
    instagram: ['instagram.com'], github: ['github.com'], youtube: ['youtube.com', 'youtu.be'], tiktok: ['tiktok.com'],
    reddit: ['reddit.com']
});

export const DEFAULT_COUNTRY = 'United States';

// Countries with a fixed list of regions get a picker; every other country gets a free-text region box.
export const REGIONS = Object.freeze({
    'United States': {
        label: 'State', postalLabel: 'ZIP', regions: [
            ['AL', 'Alabama'], ['AK', 'Alaska'], ['AZ', 'Arizona'], ['AR', 'Arkansas'], ['CA', 'California'], ['CO', 'Colorado'],
            ['CT', 'Connecticut'], ['DE', 'Delaware'], ['DC', 'District of Columbia'], ['FL', 'Florida'], ['GA', 'Georgia'],
            ['HI', 'Hawaii'], ['ID', 'Idaho'], ['IL', 'Illinois'], ['IN', 'Indiana'], ['IA', 'Iowa'], ['KS', 'Kansas'],
            ['KY', 'Kentucky'], ['LA', 'Louisiana'], ['ME', 'Maine'], ['MD', 'Maryland'], ['MA', 'Massachusetts'],
            ['MI', 'Michigan'], ['MN', 'Minnesota'], ['MS', 'Mississippi'], ['MO', 'Missouri'], ['MT', 'Montana'],
            ['NE', 'Nebraska'], ['NV', 'Nevada'], ['NH', 'New Hampshire'], ['NJ', 'New Jersey'], ['NM', 'New Mexico'],
            ['NY', 'New York'], ['NC', 'North Carolina'], ['ND', 'North Dakota'], ['OH', 'Ohio'], ['OK', 'Oklahoma'],
            ['OR', 'Oregon'], ['PA', 'Pennsylvania'], ['RI', 'Rhode Island'], ['SC', 'South Carolina'], ['SD', 'South Dakota'],
            ['TN', 'Tennessee'], ['TX', 'Texas'], ['UT', 'Utah'], ['VT', 'Vermont'], ['VA', 'Virginia'], ['WA', 'Washington'],
            ['WV', 'West Virginia'], ['WI', 'Wisconsin'], ['WY', 'Wyoming'], ['PR', 'Puerto Rico'], ['GU', 'Guam'],
            ['VI', 'U.S. Virgin Islands'], ['AS', 'American Samoa'], ['MP', 'Northern Mariana Islands']
        ]
    },
    'Canada': {
        label: 'Province / territory', postalLabel: 'Postal code', regions: [
            ['AB', 'Alberta'], ['BC', 'British Columbia'], ['MB', 'Manitoba'], ['NB', 'New Brunswick'],
            ['NL', 'Newfoundland and Labrador'], ['NS', 'Nova Scotia'], ['NT', 'Northwest Territories'], ['NU', 'Nunavut'],
            ['ON', 'Ontario'], ['PE', 'Prince Edward Island'], ['QC', 'Quebec'], ['SK', 'Saskatchewan'], ['YT', 'Yukon']
        ]
    },
    'Mexico': {
        label: 'State', postalLabel: 'Postal code', regions: [
            ['AGU', 'Aguascalientes'], ['BCN', 'Baja California'], ['BCS', 'Baja California Sur'], ['CAM', 'Campeche'],
            ['CHP', 'Chiapas'], ['CHH', 'Chihuahua'], ['CMX', 'Ciudad de México'], ['COA', 'Coahuila'], ['COL', 'Colima'],
            ['DUR', 'Durango'], ['GUA', 'Guanajuato'], ['GRO', 'Guerrero'], ['HID', 'Hidalgo'], ['JAL', 'Jalisco'],
            ['MEX', 'Estado de México'], ['MIC', 'Michoacán'], ['MOR', 'Morelos'], ['NAY', 'Nayarit'], ['NLE', 'Nuevo León'],
            ['OAX', 'Oaxaca'], ['PUE', 'Puebla'], ['QUE', 'Querétaro'], ['ROO', 'Quintana Roo'], ['SLP', 'San Luis Potosí'],
            ['SIN', 'Sinaloa'], ['SON', 'Sonora'], ['TAB', 'Tabasco'], ['TAM', 'Tamaulipas'], ['TLA', 'Tlaxcala'],
            ['VER', 'Veracruz'], ['YUC', 'Yucatán'], ['ZAC', 'Zacatecas']
        ]
    },
    'Australia': {
        label: 'State / territory', postalLabel: 'Postcode', regions: [
            ['ACT', 'Australian Capital Territory'], ['NSW', 'New South Wales'], ['NT', 'Northern Territory'],
            ['QLD', 'Queensland'], ['SA', 'South Australia'], ['TAS', 'Tasmania'], ['VIC', 'Victoria'], ['WA', 'Western Australia']
        ]
    }
});

// Region/postal labels for countries without a picker.
export const REGION_LABELS = Object.freeze({ 'United Kingdom': { label: 'County (optional)', postalLabel: 'Postcode' } });
export const DEFAULT_REGION_LABELS = Object.freeze({ label: 'Region', postalLabel: 'Postal code' });

export function regionLabels(country) {
    return REGIONS[country] || REGION_LABELS[country] || DEFAULT_REGION_LABELS;
}

// English short names (ISO 3166-1), alphabetical.
export const COUNTRIES = Object.freeze([
    'Afghanistan', 'Albania', 'Algeria', 'Andorra', 'Angola', 'Antigua and Barbuda', 'Argentina', 'Armenia', 'Australia',
    'Austria', 'Azerbaijan', 'Bahamas', 'Bahrain', 'Bangladesh', 'Barbados', 'Belarus', 'Belgium', 'Belize', 'Benin', 'Bhutan',
    'Bolivia', 'Bosnia and Herzegovina', 'Botswana', 'Brazil', 'Brunei', 'Bulgaria', 'Burkina Faso', 'Burundi', 'Cabo Verde',
    'Cambodia', 'Cameroon', 'Canada', 'Central African Republic', 'Chad', 'Chile', 'China', 'Colombia', 'Comoros', 'Congo',
    'Costa Rica', 'Côte d\'Ivoire', 'Croatia', 'Cuba', 'Cyprus', 'Czechia', 'Democratic Republic of the Congo', 'Denmark',
    'Djibouti', 'Dominica', 'Dominican Republic', 'Ecuador', 'Egypt', 'El Salvador', 'Equatorial Guinea', 'Eritrea', 'Estonia',
    'Eswatini', 'Ethiopia', 'Fiji', 'Finland', 'France', 'Gabon', 'Gambia', 'Georgia', 'Germany', 'Ghana', 'Greece', 'Grenada',
    'Guatemala', 'Guinea', 'Guinea-Bissau', 'Guyana', 'Haiti', 'Honduras', 'Hong Kong', 'Hungary', 'Iceland', 'India',
    'Indonesia', 'Iran', 'Iraq', 'Ireland', 'Israel', 'Italy', 'Jamaica', 'Japan', 'Jordan', 'Kazakhstan', 'Kenya', 'Kiribati',
    'Kosovo', 'Kuwait', 'Kyrgyzstan', 'Laos', 'Latvia', 'Lebanon', 'Lesotho', 'Liberia', 'Libya', 'Liechtenstein', 'Lithuania',
    'Luxembourg', 'Macao', 'Madagascar', 'Malawi', 'Malaysia', 'Maldives', 'Mali', 'Malta', 'Marshall Islands', 'Mauritania',
    'Mauritius', 'Mexico', 'Micronesia', 'Moldova', 'Monaco', 'Mongolia', 'Montenegro', 'Morocco', 'Mozambique', 'Myanmar',
    'Namibia', 'Nauru', 'Nepal', 'Netherlands', 'New Zealand', 'Nicaragua', 'Niger', 'Nigeria', 'North Korea', 'North Macedonia',
    'Norway', 'Oman', 'Pakistan', 'Palau', 'Palestine', 'Panama', 'Papua New Guinea', 'Paraguay', 'Peru', 'Philippines',
    'Poland', 'Portugal', 'Qatar', 'Romania', 'Russia', 'Rwanda', 'Saint Kitts and Nevis', 'Saint Lucia',
    'Saint Vincent and the Grenadines', 'Samoa', 'San Marino', 'São Tomé and Príncipe', 'Saudi Arabia', 'Senegal', 'Serbia',
    'Seychelles', 'Sierra Leone', 'Singapore', 'Slovakia', 'Slovenia', 'Solomon Islands', 'Somalia', 'South Africa',
    'South Korea', 'South Sudan', 'Spain', 'Sri Lanka', 'Sudan', 'Suriname', 'Sweden', 'Switzerland', 'Syria', 'Taiwan',
    'Tajikistan', 'Tanzania', 'Thailand', 'Timor-Leste', 'Togo', 'Tonga', 'Trinidad and Tobago', 'Tunisia', 'Türkiye',
    'Turkmenistan', 'Tuvalu', 'Uganda', 'Ukraine', 'United Arab Emirates', 'United Kingdom', 'United States', 'Uruguay',
    'Uzbekistan', 'Vanuatu', 'Vatican City', 'Venezuela', 'Vietnam', 'Yemen', 'Zambia', 'Zimbabwe'
]);

const UNIT_ALIASES = {
    apt: 'Apt', apartment: 'Apt', suite: 'Suite', ste: 'Suite', unit: 'Unit', lot: 'Lot', floor: 'Floor', fl: 'Floor',
    building: 'Building', bldg: 'Building', room: 'Room', rm: 'Room', studio: 'Studio'
};

/**
 * Splits a unit off a street line: "4120 Lakeshore Road, Suite 405" -> { street: '4120 Lakeshore Road',
 * unitType: 'Suite', unitNumber: '405' }. Also "#12", "28th Floor", a unit on its own ("Suite 300") and PO Boxes.
 */
export function splitStreetUnit(text) {
    const t = String(text || '').trim();
    const tidy = (street) => String(street || '').trim().replace(/,$/, '');
    let m = t.match(/^(?:p\.?\s?o\.?\s?box|post office box)\s*#?\s*([A-Za-z0-9-]+)$/i);
    if (m) return { street: '', unitType: 'PO Box', unitNumber: m[1] };
    m = t.match(/^(?:(.*?)[,\s]+)?(\d+)(?:st|nd|rd|th)\s+floor$/i);
    if (m) return { street: tidy(m[1]), unitType: 'Floor', unitNumber: m[2] };
    // A unit number has a digit in it, or is a single letter ("Suite 405", "Apt 4B", "Unit C"; not "Unit Road").
    m = t.match(/^(?:(.*?)[,\s]+)?\b(apt|apartment|suite|ste|unit|lot|floor|fl|building|bldg|room|rm|studio)\b\.?\s*#?\s*(\d[A-Za-z0-9-]*%?|[A-Za-z]\d*)$/i);
    if (m) return { street: tidy(m[1]), unitType: UNIT_ALIASES[m[2].toLowerCase()], unitNumber: m[3] };
    m = t.match(/^(?:(.*?)[,\s]+)?#\s*([A-Za-z0-9-]+)$/);
    if (m) return { street: tidy(m[1]), unitType: 'Unit', unitNumber: m[2] };
    return { street: t, unitType: '', unitNumber: '' };
}

/** 'linkedin', 'x', ... when a web address is a known social profile, else ''. */
export function websiteTypeFor(url) {
    const host = String(url || '').toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').split(/[/?#]/)[0];
    for (const [type, hosts] of Object.entries(SOCIAL_HOSTS)) {
        if (hosts.some(h => host === h || host.endsWith('.' + h))) return type;
    }
    return '';
}

const SOCIAL_URL = {
    linkedin: 'https://www.linkedin.com/in/', x: 'https://x.com/', facebook: 'https://facebook.com/', instagram: 'https://instagram.com/',
    github: 'https://github.com/', youtube: 'https://youtube.com/@', tiktok: 'https://tiktok.com/@', reddit: 'https://www.reddit.com/user/'
};

/** Profile link from a bare handle next to a social logo: ('instagram', '@studiocraft') -> 'https://instagram.com/studiocraft'. */
export function socialProfileUrl(type, handle) {
    const h = String(handle || '').trim().replace(/^@/, '').replace(/^(?:in|company|u|user)\//i, '').replace(/^\//, '');
    return SOCIAL_URL[type] && /^[A-Za-z0-9._-]{2,}$/.test(h) ? SOCIAL_URL[type] + h : '';
}
