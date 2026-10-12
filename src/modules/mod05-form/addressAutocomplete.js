/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575 & Gemini
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD05: Predictive Address Autocomplete Suite
 * Scope: Local offline address database lookup & OpenStreetMap Nominatim API integration.
 */

export class AddressAutocompleteEngine {
    constructor() {
        this.mockDatabase = [
            { street: '500 Howard Street, Suite 400', city: 'San Francisco', state: 'CA', zip: '94105', country: 'United States' },
            { street: '100 Innovation Way, Suite 800', city: 'Palo Alto', state: 'CA', zip: '94301', country: 'United States' },
            { street: '745 Fifth Avenue, 28th Floor', city: 'New York', state: 'NY', zip: '10151', country: 'United States' },
            { street: '300 East Superior Street', city: 'Chicago', state: 'IL', zip: '60611', country: 'United States' },
            { street: '1201 3rd Ave, Studio 12', city: 'Seattle', state: 'WA', zip: '98101', country: 'United States' },
            { street: '100 Queen Street West', city: 'Toronto', state: 'ON', zip: 'M5H 2N2', country: 'Canada' },
            { street: '221B Baker Street', city: 'London', state: 'ENG', zip: 'NW1 6XE', country: 'United Kingdom' },
            { street: 'Friedrichstraße 44', city: 'Berlin', state: 'BY', zip: '10117', country: 'Germany' },
            { street: '75 Avenue des Champs-Élysées', city: 'Paris', state: 'IDF', zip: '75008', country: 'France' }
        ];
    }

    /**
     * Searches local mock database and queries OpenStreetMap Nominatim for address suggestions.
     * @param {string} query - User input string.
     * @returns {Promise<Array>} Array of matched address objects.
     */
    async search(query) {
        if (!query || query.length < 2) return [];

        const qLower = query.toLowerCase();
        const localMatches = this.mockDatabase.filter(item =>
            item.street.toLowerCase().includes(qLower) ||
            item.city.toLowerCase().includes(qLower)
        );

        try {
            const resp = await fetch(`https://nominatim.openstreetmap.org/search?format=json&q=${encodeURIComponent(query)}&addressdetails=1&limit=4`);
            if (resp.ok) {
                const data = await resp.json();
                if (data && data.length > 0) {
                    const apiResults = data.map(place => {
                        const addr = place.address || {};
                        const streetNum = addr.house_number || '';
                        const road = addr.road || addr.pedestrian || place.display_name.split(',')[0];
                        const fullStreet = [streetNum, road].filter(Boolean).join(' ') || place.display_name;

                        return {
                            street: fullStreet,
                            city: addr.city || addr.town || addr.village || '',
                            state: addr.state || '',
                            zip: addr.postcode || '',
                            country: addr.country || 'United States'
                        };
                    });

                    const merged = [...localMatches, ...apiResults];
                    return Array.from(new Set(merged.map(a => a.street))).map(str => merged.find(a => a.street === str)).slice(0, 5);
                }
            }
        } catch (e) {
            // Fallback to local matches if network fetch fails
        }

        return localMatches.slice(0, 5);
    }
}