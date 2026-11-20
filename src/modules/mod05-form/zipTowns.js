/**
 * vCGE-MOD05: the town a US ZIP code belongs to, read from the bundled table (src/vendor/zip-towns/, built by
 * scripts/zip-towns.mjs). On the device only: the table is one of the app's own files, loaded once after start.
 *
 * Why (raven575's iPad run, 2026-11-20): the reader often gets the ZIP code right and slips on a letter or two of the
 * town ("Potage" for "Portage"). A town one or two letters away from the ZIP's own town is taken to be that town.
 * A town further away is left as read: many ZIP codes serve more than one town name, and the table keeps one.
 */

/** Reads the table string into a lookup: zip ('49024') -> { town, state }. */
export function parseZipTowns(data) {
    const [townPart = '', entryPart = ''] = String(data || '').split('\n');
    const towns = townPart ? townPart.split('|') : [];
    const byZip = new Map();
    let zip = 0, town = -1;
    for (const entry of entryPart.split(' ')) {
        if (!entry) continue;
        const [gap, idx] = entry.split(':');
        zip += parseInt(gap, 36);
        if (idx !== undefined) town = parseInt(idx, 36);
        if (towns[town]) byZip.set(String(zip).padStart(5, '0'), towns[town]);
    }
    return {
        size: byZip.size,
        /** { town, state } for a ZIP code ('49024' or '49024-1234'), or null */
        lookup(code) {
            const key = String(code || '').trim().slice(0, 5);
            const hit = /^\d{5}$/.test(key) && byZip.get(key);
            if (!hit) return null;
            const comma = hit.lastIndexOf(',');
            return { town: hit.slice(0, comma), state: hit.slice(comma + 1) };
        }
    };
}

/** Letters apart (insert, delete, swap one letter), ignoring capitals and dots. */
export function townDistance(a, b) {
    const x = String(a).toLowerCase().replace(/[.\s]+/g, ' ').trim(), y = String(b).toLowerCase().replace(/[.\s]+/g, ' ').trim();
    let prev = Array.from({ length: y.length + 1 }, (_, j) => j);
    for (let i = 1; i <= x.length; i++) {
        const row = [i];
        for (let j = 1; j <= y.length; j++) row[j] = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
        prev = row;
    }
    return prev[y.length];
}

/**
 * The town to fill for what the reader saw: the ZIP's own town when the read town is one letter away (two for a town of
 * eight letters or more) and the state matches; otherwise the town as read. Capitals follow the card (all caps stays).
 * @returns {{ town: string, fixed: boolean }}
 */
export function fixTown(table, { city, state, zip }) {
    const read = String(city || '').trim();
    const hit = table && read ? table.lookup(zip) : null;
    if (!hit || (state && hit.state !== state)) return { town: read, fixed: false };
    const apart = townDistance(read, hit.town);
    const allowed = hit.town.replace(/[^A-Za-z]/g, '').length >= 8 ? 2 : 1;
    if (apart === 0 || apart > allowed) return { town: read, fixed: false };
    const town = read === read.toUpperCase() && /[A-Z]/.test(read) ? hit.town.toUpperCase() : hit.town;
    return { town, fixed: true };
}
