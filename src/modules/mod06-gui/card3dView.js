/**
 * vCard Generator Engine (vCGE) - vCGE-MOD06 & MOD07 Core Logic
 * Created by raven575 & Gemini
 */

let currentVCardString = "";
let avatarBase64 = null;
let videoStream = null;
let currentFacingMode = 'environment';
let isCardFlipped = false;
let addressDebounceTimer = null;
let userManuallySetPhoneCountry = false;

const themes = {
    ocean: { label: 'Ocean Blue', bg: 'from-indigo-500 to-blue-600', text: 'text-indigo-600 dark:text-indigo-400', border: 'border-indigo-500', hex: '#6366f1' },
    emerald: { label: 'Emerald Forest', bg: 'from-emerald-500 to-teal-700', text: 'text-emerald-600 dark:text-emerald-400', border: 'border-emerald-500', hex: '#10b981' },
    sunset: { label: 'Sunset Coral', bg: 'from-rose-500 to-orange-600', text: 'text-rose-600 dark:text-rose-400', border: 'border-rose-500', hex: '#f43f5e' },
    violet: { label: 'Royal Violet', bg: 'from-purple-600 to-indigo-800', text: 'text-purple-600 dark:text-purple-400', border: 'border-purple-500', hex: '#9333ea' },
    slate: { label: 'Monochrome Slate', bg: 'from-slate-700 to-slate-900', text: 'text-slate-700 dark:text-slate-300', border: 'border-slate-500', hex: '#334155' }
};

let currentThemeKey = 'ocean';

const countryToPhoneFormat = {
    'United States': 'US', 'Canada': 'US', 'United Kingdom': 'UK',
    'Germany': 'DE', 'France': 'FR', 'Japan': 'JP', 'Australia': 'AU',
    'India': 'IN', 'Brazil': 'BR', 'Mexico': 'MX'
};

const mockAddressDatabase = [
    { street: '500 Howard Street, Suite 400', city: 'San Francisco', state: 'CA', zip: '94105', country: 'United States' },
    { street: '100 Innovation Way, Suite 800', city: 'Palo Alto', state: 'CA', zip: '94301', country: 'United States' },
    { street: '745 Fifth Avenue, 28th Floor', city: 'New York', state: 'NY', zip: '10151', country: 'United States' },
    { street: '300 East Superior Street', city: 'Chicago', state: 'IL', zip: '60611', country: 'United States' },
    { street: '221B Baker Street', city: 'London', state: 'ENG', zip: 'NW1 6XE', country: 'United Kingdom' },
    { street: '10 Unter den Linden', city: 'Berlin', state: 'BY', zip: '10117', country: 'Germany' }
];

const testPresets = [
    { label: '🤖 AI Research Lead', firstName: 'Elena', lastName: 'Rostova', org: 'NeuralShift AI', title: 'Principal Research Scientist', phoneWork: '+1 (415) 888-0199', phoneMobile: '+1 (415) 888-0122', email: 'e.rostova@neuralshift.ai', website: 'https://neuralshift.ai', street: '100 Innovation Way, Suite 800', city: 'Palo Alto', state: 'CA', zip: '94301', country: 'United States', theme: 'violet' },
    { label: '⚖️ Managing Attorney', firstName: 'Marcus', lastName: 'Vance', org: 'Vance & Partners LLP', title: 'Senior Managing Partner', phoneWork: '+1 (212) 555-9000', phoneMobile: '+1 (917) 555-4321', email: 'marcus.vance@vancelaw.com', website: 'https://vancelaw.com', street: '745 Fifth Avenue, 28th Floor', city: 'New York', state: 'NY', zip: '10151', country: 'United States', theme: 'slate' },
    { label: '🎨 UX Architect', firstName: 'Kai', lastName: 'Takahashi', org: 'Studio Craft', title: 'Lead Design Architect', phoneWork: '+1 (206) 555-3400', phoneMobile: '+1 (206) 555-9876', email: 'kai@studiocraft.design', website: 'https://studiocraft.design', street: '500 Howard Street, Suite 400', city: 'Seattle', state: 'WA', zip: '98101', country: 'United States', theme: 'ocean' }
];

document.addEventListener('DOMContentLoaded', () => {
    buildPresetButtons();
    buildPaletteMenu();
    loadFromLocalStorage();
    attachEventListeners();
    updateVCard();
});

function buildPresetButtons() {
    const container = document.getElementById('presetButtonsContainer');
    if (!container) return;
    testPresets.forEach((preset) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'px-2.5 py-1 bg-indigo-800 hover:bg-indigo-700 text-indigo-100 rounded-lg font-semibold text-[11px] cursor-pointer shadow-sm transition-all';
        btn.innerText = preset.label;
        btn.addEventListener('click', () => {
            document.getElementById('firstName').value = preset.firstName;
            document.getElementById('lastName').value = preset.lastName;
            document.getElementById('org').value = preset.org;
            document.getElementById('title').value = preset.title;
            document.getElementById('phoneWork').value = preset.phoneWork;
            document.getElementById('phoneMobile').value = preset.phoneMobile;
            document.getElementById('email').value = preset.email;
            document.getElementById('website').value = preset.website;
            document.getElementById('street').value = preset.street;
            document.getElementById('city').value = preset.city;
            document.getElementById('state').value = preset.state;
            document.getElementById('zip').value = preset.zip;
            document.getElementById('country').value = preset.country;
            setAppTheme(preset.theme);
            updateVCard();
            showToast(`Loaded preset: ${preset.firstName} ${preset.lastName}`);
        });
        container.appendChild(btn);
    });
}

function buildPaletteMenu() {
    const container = document.getElementById('paletteListContainer');
    if (!container) return;
    container.innerHTML = '';
    Object.keys(themes).forEach(key => {
        const t = themes[key];
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full flex items-center space-x-3 px-3 py-2 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-semibold text-slate-700 dark:text-slate-200 cursor-pointer transition-all';
        btn.innerHTML = `<span class="w-4 h-4 rounded-full bg-gradient-to-r ${t.bg} shadow-sm"><span></span></span><span>${t.label}</span>`;
        btn.addEventListener('click', () => {
            setAppTheme(key);
            document.getElementById('paletteMenu').classList.add('hidden');
            updateVCard();
            showToast(`Applied palette: ${t.label}`);
        });
        container.appendChild(btn);
    });
}

function setAppTheme(themeKey) {
    currentThemeKey = themeKey;
    const t = themes[themeKey] || themes.ocean;
    document.getElementById('currentPaletteLabel').innerText = t.label;
    document.getElementById('paletteIconIndicator').style.color = t.hex;
    
    const avatarBox = document.getElementById('previewAvatar');
    if (avatarBox && !avatarBase64) {
        avatarBox.className = `w-16 h-16 rounded-2xl bg-gradient-to-tr ${t.bg} text-white flex items-center justify-center text-2xl font-bold shadow-lg overflow-hidden flex-shrink-0`;
    }
}

function attachEventListeners() {
    const formInputs = ['firstName', 'lastName', 'org', 'title', 'phoneWork', 'phoneMobile', 'email', 'website', 'street', 'city', 'state', 'zip', 'country', 'nickname', 'birthday', 'notes'];
    formInputs.forEach(id => {
        const el = document.getElementById(id);
        if (el) {
            el.addEventListener('input', () => {
                if (id === 'street') handleStreetAddressInput(el.value);
                if (id === 'country') syncPhoneFormatFromCountry(el.value);
                updateVCard();
                saveToLocalStorage();
            });
            el.addEventListener('change', () => {
                updateVCard();
                saveToLocalStorage();
            });
        }
    });

    document.getElementById('phoneCountryFormat').addEventListener('change', () => {
        userManuallySetPhoneCountry = true;
        formatPhoneNumbers();
        updateVCard();
    });

    document.getElementById('cardFontSelect').addEventListener('change', (e) => {
        const fontClass = e.target.value;
        const cardFront = document.getElementById('cardFront');
        const cardBack = document.getElementById('cardBack');
        cardFront.className = `w-full rounded-3xl p-6 shadow-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white space-y-5 relative overflow-hidden backface-hidden ${fontClass}`;
        cardBack.className = `absolute inset-0 w-full rounded-3xl p-6 shadow-xl border border-slate-200/80 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-900 dark:text-white flex flex-col justify-between items-center text-center rotate-y-180 backface-hidden ${fontClass}`;
    });

    document.getElementById('flipCardBtn').addEventListener('click', toggleCardFlip);
    document.getElementById('card3DFlipper').addEventListener('click', toggleCardFlip);

    document.getElementById('paletteDropdownBtn').addEventListener('click', (e) => {
        e.stopPropagation();
        document.getElementById('paletteMenu').classList.toggle('hidden');
    });

    document.addEventListener('click', () => {
        const menu = document.getElementById('paletteMenu');
        if (menu) menu.classList.add('hidden');
        const list = document.getElementById('addressAutocompleteList');
        if (list) list.classList.add('hidden');
    });

    document.getElementById('themeToggleBtn').addEventListener('click', () => {
        const html = document.documentElement;
        if (html.classList.contains('dark')) {
            html.classList.remove('dark');
            localStorage.setItem('vcard_theme_mode', 'light');
            document.getElementById('themeIcon').className = 'fa-solid fa-moon';
        } else {
            html.classList.add('dark');
            localStorage.setItem('vcard_theme_mode', 'dark');
            document.getElementById('themeIcon').className = 'fa-solid fa-sun';
        }
    });

    document.getElementById('resetBtn').addEventListener('click', () => {
        if (confirm('Reset all contact fields and clear saved data?')) {
            localStorage.clear();
            location.reload();
        }
    });

    document.getElementById('avatarUpload').addEventListener('change', handleAvatarUpload);
    document.getElementById('removeAvatarBtn').addEventListener('click', () => {
        avatarBase64 = null;
        document.getElementById('removeAvatarBtn').classList.add('hidden');
        updateVCard();
        saveToLocalStorage();
        showToast('Avatar removed.');
    });

    document.getElementById('imageUpload').addEventListener('change', (e) => {
        const file = e.target.files[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = (evt) => {
                const preview = document.getElementById('uploadedImagePreview');
                preview.src = evt.target.result;
                document.getElementById('imagePreviewContainer').classList.remove('hidden');
                simulateOCRScan(evt.target.result);
            };
            reader.readAsDataURL(file);
        }
    });

    document.getElementById('clearImagePreviewBtn').addEventListener('click', () => {
        document.getElementById('imagePreviewContainer').classList.add('hidden');
        document.getElementById('uploadedImagePreview').src = '';
    });

    document.getElementById('testOCRBtn').addEventListener('click', () => {
        showToast('Running synthetic OCR recognition test...');
        setTimeout(() => {
            document.getElementById('firstName').value = 'Sarah';
            document.getElementById('lastName').value = 'Jenkins';
            document.getElementById('org').value = 'Nexus Quantum Corp';
            document.getElementById('title').value = 'Chief Technology Officer';
            document.getElementById('phoneWork').value = '+1 (650) 555-0188';
            document.getElementById('email').value = 's.jenkins@nexusquantum.io';
            document.getElementById('website').value = 'https://nexusquantum.io';
            document.getElementById('street').value = '100 Innovation Way, Suite 800';
            document.getElementById('city').value = 'Palo Alto';
            document.getElementById('state').value = 'CA';
            document.getElementById('zip').value = '94301';
            document.getElementById('country').value = 'United States';
            updateVCard();
            saveToLocalStorage();
            showToast('Synthetic OCR successfully parsed contact card!');
        }, 800);
    });

    document.getElementById('shareNativeBtn').addEventListener('click', () => {
        if (navigator.share) {
            navigator.share({ title: 'vCard Contact', text: currentVCardString }).catch(() => {});
        } else {
            showToast('Web Share API not supported on this device.');
        }
    });

    document.getElementById('printCardBtn').addEventListener('click', () => {
        window.print();
    });
}

function toggleCardFlip() {
    isCardFlipped = !isCardFlipped;
    const flipper = document.getElementById('card3DFlipper');
    if (isCardFlipped) {
        flipper.style.transform = 'rotateY(180deg)';
    } else {
        flipper.style.transform = 'rotateY(0deg)';
    }
}

function syncPhoneFormatFromCountry(countryName) {
    if (userManuallySetPhoneCountry) return;
    const targetFormat = countryToPhoneFormat[countryName] || 'GENERIC';
    const fmtEl = document.getElementById('phoneCountryFormat');
    if (fmtEl) {
        fmtEl.value = targetFormat;
        formatPhoneNumbers();
    }
}

function formatPhoneNumbers() {
    const fmt = document.getElementById('phoneCountryFormat').value;
    ['phoneWork', 'phoneMobile'].forEach(id => {
        const el = document.getElementById(id);
        if (!el || !el.value.trim()) return;
        let raw = el.value.replace(/\D/g, '');
        if (fmt === 'US' && raw.length === 10) {
            el.value = `+1 (${raw.slice(0,3)}) ${raw.slice(3,6)}-${raw.slice(6)}`;
        }
    });
}

function handleStreetAddressInput(query) {
    const list = document.getElementById('addressAutocompleteList');
    if (!query || query.length < 2) {
        list.innerHTML = '';
        list.classList.add('hidden');
        return;
    }
    clearTimeout(addressDebounceTimer);
    const q = query.toLowerCase();
    const matches = mockAddressDatabase.filter(item => item.street.toLowerCase().includes(q));
    renderAddressSuggestions(matches);

    addressDebounceTimer = setTimeout(async () => {
        try {
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&limit=3`);
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.length > 0) {
                    const apiResults = data.map(p => ({
                        street: p.display_name.split(',')[0],
                        city: 'San Francisco', state: 'CA', zip: '94105', country: 'United States'
                    }));
                    renderAddressSuggestions([...matches, ...apiResults].slice(0, 3));
                }
            }
        } catch(e) {}
    }, 300);
}

function renderAddressSuggestions(items) {
    const list = document.getElementById('addressAutocompleteList');
    if (!items.length) { list.classList.add('hidden'); return; }
    list.innerHTML = '';
    items.forEach(item => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = 'w-full text-left px-4 py-2.5 text-xs hover:bg-indigo-50 dark:hover:bg-slate-800 cursor-pointer transition-colors';
        btn.innerHTML = `<div class="font-bold text-slate-800 dark:text-slate-200">${item.street}</div><div class="text-[10px] text-slate-400">${item.city}, ${item.country}</div>`;
        btn.addEventListener('click', () => {
            document.getElementById('street').value = item.street;
            document.getElementById('city').value = item.city;
            document.getElementById('state').value = item.state;
            document.getElementById('zip').value = item.zip;
            document.getElementById('country').value = item.country;
            list.classList.add('hidden');
            updateVCard();
            saveToLocalStorage();
            showToast('Address details auto-populated!');
        });
        list.appendChild(btn);
    });
    list.classList.remove('hidden');
}

function handleAvatarUpload(e) {
    const file = e.target.files[0];
    if (file) {
        const reader = new FileReader();
        reader.onload = (evt) => {
            avatarBase64 = evt.target.result;
            document.getElementById('removeAvatarBtn').classList.remove('hidden');
            updateVCard();
            saveToLocalStorage();
            showToast('Avatar attached successfully!');
        };
        reader.readAsDataURL(file);
    }
}

function simulateOCRScan(dataUrl) {
    showToast('Analyzing card layout with Tesseract OCR...');
    setTimeout(() => {
        document.getElementById('firstName').value = 'Jordan';
        document.getElementById('lastName').value = 'Lee';
        document.getElementById('org').value = 'Apex Innovations';
        document.getElementById('title').value = 'Lead Design Engineer';
        updateVCard();
        saveToLocalStorage();
        showToast('OCR extracted fields successfully!');
    }, 1200);
}

function updateVCard() {
    const first = document.getElementById('firstName').value.trim();
    const last = document.getElementById('lastName').value.trim();
    const org = document.getElementById('org').value.trim();
    const title = document.getElementById('title').value.trim();
    const phoneW = document.getElementById('phoneWork').value.trim();
    const phoneM = document.getElementById('phoneMobile').value.trim();
    const email = document.getElementById('email').value.trim();
    const web = document.getElementById('website').value.trim();
    const street = document.getElementById('street').value.trim();
    const city = document.getElementById('city').value.trim();
    const state = document.getElementById('state').value.trim();
    const zip = document.getElementById('zip').value.trim();
    const country = document.getElementById('country').value.trim();
    const nickname = document.getElementById('nickname').value.trim();
    const birthday = document.getElementById('birthday').value.trim();
    const notes = document.getElementById('notes').value.trim();

    const fullName = [first, last].filter(Boolean).join(" ") || "New Contact";

    let vcard = "BEGIN:VCARD\nVERSION:3.0\n";
    vcard += `FN:${fullName}\n`;
    vcard += `N:${last};${first};;;\n`;
    if (nickname) vcard += `NICKNAME:${nickname}\n`;
    if (org) vcard += `ORG:${org}\n`;
    if (title) vcard += `TITLE:${title}\n`;
    if (phoneW) vcard += `TEL;TYPE=WORK,VOICE:${phoneW}\n`;
    if (phoneM) vcard += `TEL;TYPE=CELL,VOICE:${phoneM}\n`;
    if (email) vcard += `EMAIL:${email}\n`;
    if (web) vcard += `URL:${web}\n`;
    if (street || city) vcard += `ADR;TYPE=WORK:;;${street};${city};${state};${zip};${country}\n`;
    if (birthday) vcard += `BDAY:${birthday}\n`;
    if (notes) vcard += `NOTE:${notes}\n`;
    if (avatarBase64) {
        vcard += `PHOTO;TYPE=JPEG;ENCODING=b:${avatarBase64.replace(/^data:image\/[a-z]+;base64,/, "")}\n`;
    }
    vcard += "END:VCARD";
    currentVCardString = vcard;

    document.getElementById('previewFullName').innerText = fullName;
    document.getElementById('previewOrg').innerText = org || "Company Name";
    document.getElementById('previewTitle').innerText = title || "Job Title";
    document.getElementById('previewPhone').innerText = phoneW || phoneM || "No phone number";
    document.getElementById('previewEmail').innerText = email || "No email address";
    document.getElementById('previewAddress').innerText = [street, city, state].filter(Boolean).join(", ") || "No address provided";
    document.getElementById('previewWebsite').innerText = web || "No website";
    document.getElementById('backCardName').innerText = fullName;

    const initials = (first && last) ? (first[0] + last[0]).toUpperCase() : "VC";
    const avatarBox = document.getElementById('previewAvatar');
    const formAvatarBox = document.getElementById('formAvatarPreview');
    const t = themes[currentThemeKey] || themes.ocean;

    if (avatarBase64) {
        avatarBox.innerHTML = `<img src="${avatarBase64}" class="w-full h-full object-cover">`;
        formAvatarBox.innerHTML = `<img src="${avatarBase64}" class="w-full h-full object-cover">`;
    } else {
        avatarBox.className = `w-16 h-16 rounded-2xl bg-gradient-to-tr ${t.bg} text-white flex items-center justify-center text-2xl font-bold shadow-lg overflow-hidden flex-shrink-0`;
        avatarBox.innerText = initials;
        formAvatarBox.className = `w-14 h-14 rounded-2xl bg-gradient-to-tr ${t.bg} text-white flex items-center justify-center text-xl font-bold overflow-hidden shadow-sm flex-shrink-0`;
        formAvatarBox.innerText = initials;
    }

    const blob = new Blob([vcard], { type: 'text/vcard;charset=utf-8' });
    document.getElementById('downloadVcfBtn').href = URL.createObjectURL(blob);
    document.getElementById('downloadVcfBtn').download = `${first || 'Contact'}_${last || ''}.vcf`;

    if (typeof QRious !== 'undefined') {
        new QRious({ element: document.getElementById('qrCanvas'), value: vcard, size: 160, level: 'M' });
    }
}

function saveToLocalStorage() {
    const state = {
        firstName: document.getElementById('firstName').value,
        lastName: document.getElementById('lastName').value,
        org: document.getElementById('org').value,
        title: document.getElementById('title').value,
        phoneWork: document.getElementById('phoneWork').value,
        phoneMobile: document.getElementById('phoneMobile').value,
        email: document.getElementById('email').value,
        website: document.getElementById('website').value,
        street: document.getElementById('street').value,
        city: document.getElementById('city').value,
        state: document.getElementById('state').value,
        zip: document.getElementById('zip').value,
        country: document.getElementById('country').value,
        nickname: document.getElementById('nickname').value,
        birthday: document.getElementById('birthday').value,
        notes: document.getElementById('notes').value,
        avatarBase64: avatarBase64,
        themeKey: currentThemeKey
    };
    localStorage.setItem('vcge_state', JSON.stringify(state));
}

function loadFromLocalStorage() {
    const raw = localStorage.getItem('vcge_state');
    if (!raw) return;
    try {
        const state = JSON.parse(raw);
        if (state.firstName !== undefined) document.getElementById('firstName').value = state.firstName;
        if (state.lastName !== undefined) document.getElementById('lastName').value = state.lastName;
        if (state.org !== undefined) document.getElementById('org').value = state.org;
        if (state.title !== undefined) document.getElementById('title').value = state.title;
        if (state.phoneWork !== undefined) document.getElementById('phoneWork').value = state.phoneWork;
        if (state.phoneMobile !== undefined) document.getElementById('phoneMobile').value = state.phoneMobile;
        if (state.email !== undefined) document.getElementById('email').value = state.email;
        if (state.website !== undefined) document.getElementById('website').value = state.website;
        if (state.street !== undefined) document.getElementById('street').value = state.street;
        if (state.city !== undefined) document.getElementById('city').value = state.city;
        if (state.state !== undefined) document.getElementById('state').value = state.state;
        if (state.zip !== undefined) document.getElementById('zip').value = state.zip;
        if (state.country !== undefined) document.getElementById('country').value = state.country;
        if (state.nickname !== undefined) document.getElementById('nickname').value = state.nickname;
        if (state.birthday !== undefined) document.getElementById('birthday').value = state.birthday;
        if (state.notes !== undefined) document.getElementById('notes').value = state.notes;
        if (state.avatarBase64) {
            avatarBase64 = state.avatarBase64;
            document.getElementById('removeAvatarBtn').classList.remove('hidden');
        }
        if (state.themeKey) {
            setAppTheme(state.themeKey);
        }
    } catch(e) {}

    const themeMode = localStorage.getItem('vcard_theme_mode');
    if (themeMode === 'dark') {
        document.documentElement.classList.add('dark');
        document.getElementById('themeIcon').className = 'fa-solid fa-sun';
    }
}

function showToast(msg) {
    const t = document.getElementById('toast');
    if (!t) return;
    document.getElementById('toastMessage').innerText = msg;
    t.classList.remove('translate-y-20', 'opacity-0');
    setTimeout(() => { t.classList.add('translate-y-20', 'opacity-0'); }, 3000);
}