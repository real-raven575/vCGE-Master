/**
 * vCGE-MOD01: the picture drop-down (raven575, 2026-11-10: "the drop-down menus cannot be plain. They have to indicate
 * what you are selecting ... and it has to be big enough on phones to be able to do with your fingers").
 * Created by raven575, Herd of Helpers (claude) & gemini
 *
 * pictureSelect(select, { render }) dresses an ordinary <select>: a button shows a picture of the pick and its name, and
 * a tap opens a list of big rows (52 px or more), each with its own picture and an optional hint line. The <select>
 * stays in the page, out of sight, and keeps its id, value and change event, so every module reads it as before.
 *
 *   render(value, el, option)  fills `el` (an empty preview box) for one value: a swatch, a canvas, an <img>. Optional.
 *   option.dataset.hint        a small second line under the name.
 *   option.disabled + dataset.reason   greyed out and not pickable, with the reason as its second line.
 *   <optgroup label>           a heading row in the list.
 *
 * Keyboard and screen readers: the button has aria-haspopup="listbox"; the list is a listbox with options. Arrow keys,
 * Home and End move, Enter or Space picks, Escape closes and returns to the button. A tap outside closes it.
 * Shared with MOD07 (Checkers) for the QR looks. Nothing is stored.
 */
let uid = 0;

export function pictureSelect(select, { render = null } = {}) {
    if (!select) return null;
    if (select._picture) return select._picture;
    const doc = select.ownerDocument;
    const el = (tag, cls) => { const n = doc.createElement(tag); if (cls) n.className = cls; return n; };
    const id = `pick${++uid}`;

    const wrap = el('div', 'vcge-pick');
    const btn = el('button', 'vcge-pick-btn');
    btn.type = 'button';
    btn.setAttribute('aria-haspopup', 'listbox');
    btn.setAttribute('aria-expanded', 'false');
    btn.setAttribute('aria-controls', `${id}-list`);
    const label = select.getAttribute('aria-label');
    const prev = el('span', 'vcge-pick-prev'), text = el('span', 'vcge-pick-text'), name = el('b'), hint = el('small');
    const chev = el('span', 'vcge-pick-chev');
    prev.setAttribute('aria-hidden', 'true'); chev.setAttribute('aria-hidden', 'true');
    text.append(name, hint);
    btn.append(prev, text, chev);
    const list = el('ul', 'vcge-pick-list');
    list.id = `${id}-list`;
    list.setAttribute('role', 'listbox');
    if (label) list.setAttribute('aria-label', label);
    list.hidden = true;
    wrap.append(btn, list);

    select.classList.add('vcge-pick-native');
    select.setAttribute('aria-hidden', 'true');
    select.tabIndex = -1;
    select.after(wrap);

    const paint = (box, value, option) => { box.replaceChildren(); if (render) render(value, box, option); };
    const current = () => select.options[select.selectedIndex] || null;

    const refresh = () => {
        const o = current();
        name.textContent = o ? o.textContent : '';
        hint.textContent = o?.dataset.hint || '';
        hint.hidden = !hint.textContent;
        btn.setAttribute('aria-label', `${label ? `${label}: ` : ''}${name.textContent}`);
        paint(prev, o ? o.value : '', o);
        btn.disabled = select.disabled;
        list.querySelectorAll('[role="option"]').forEach(li => li.setAttribute('aria-selected', String(li.dataset.value === select.value)));
    };

    const rows = () => [...list.querySelectorAll('[role="option"]:not([aria-disabled="true"])')];
    const build = () => {
        list.replaceChildren();
        const addRow = (o) => {
            const li = el('li', 'vcge-pick-row');
            li.setAttribute('role', 'option');
            li.id = `${id}-o${list.children.length}`;
            li.dataset.value = o.value;
            li.tabIndex = -1;
            const box = el('span', 'vcge-pick-prev'), t = el('span', 'vcge-pick-text'), b = el('b'), s = el('small');
            box.setAttribute('aria-hidden', 'true');
            b.textContent = o.textContent;
            s.textContent = o.disabled ? (o.dataset.reason || 'Not available') : (o.dataset.hint || '');
            t.append(b); if (s.textContent) t.append(s);
            li.append(box, t);
            if (o.disabled) li.setAttribute('aria-disabled', 'true');
            paint(box, o.value, o);
            li.addEventListener('click', () => { if (!o.disabled) choose(o.value); });
            list.append(li);
        };
        for (const child of select.children) {
            if (child.tagName === 'OPTGROUP') {
                const head = el('li', 'vcge-pick-head');
                head.setAttribute('role', 'presentation');
                head.textContent = child.label;
                list.append(head);
                [...child.children].forEach(addRow);
            } else if (child.tagName === 'OPTION' && !(child.value === '' && child.disabled === false && child.hidden)) addRow(child);
        }
        refresh();
    };

    const open = () => {
        if (select.disabled) return;
        build();
        list.hidden = false;
        btn.setAttribute('aria-expanded', 'true');
        wrap.classList.add('is-open');
        const on = rows().find(li => li.dataset.value === select.value) || rows()[0];
        on?.focus();
        doc.addEventListener('pointerdown', outside, true);
    };
    const close = (focusBtn = true) => {
        if (list.hidden) return;
        list.hidden = true;
        btn.setAttribute('aria-expanded', 'false');
        wrap.classList.remove('is-open');
        doc.removeEventListener('pointerdown', outside, true);
        if (focusBtn) btn.focus();
    };
    const outside = (e) => { if (!wrap.contains(e.target)) close(false); };
    const choose = (value) => {
        const changed = select.value !== value;
        select.value = value;
        close();
        if (changed) select.dispatchEvent(new Event('change', { bubbles: true }));
        refresh();
    };

    btn.addEventListener('click', () => (list.hidden ? open() : close()));
    btn.addEventListener('keydown', (e) => { if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); open(); } });
    list.addEventListener('keydown', (e) => {
        const all = rows(), at = all.indexOf(doc.activeElement);
        const go = (i) => { e.preventDefault(); all[Math.max(0, Math.min(all.length - 1, i))]?.focus(); };
        if (e.key === 'ArrowDown') go(at + 1);
        else if (e.key === 'ArrowUp') go(at - 1);
        else if (e.key === 'Home') go(0);
        else if (e.key === 'End') go(all.length - 1);
        else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); if (at >= 0) choose(all[at].dataset.value); }
        else if (e.key === 'Escape') { e.preventDefault(); close(); }
        else if (e.key === 'Tab') close(false);
    });
    select.addEventListener('change', refresh);

    build();
    const api = { refresh, rebuild: build, open, close: () => close(false), button: btn, list };
    select._picture = api;
    return api;
}
