/**
 * vCard Generator Engine (vCGE)
 * Copyright (c) 2026 raven575, Gemini & Claude
 *
 * Repository: https://github.com/real-raven575/vCGE-Master
 * This source code is licensed under the MIT License found in the
 * LICENSE file in the root directory of this source tree.
 */

/**
 * vCGE-MOD05: Predictive Address Autocomplete Suite
 * Scope: Local offline address database lookup. No network calls (offline-first, sole-egress rule).
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
            { street: 'Friedrichstraße 44', city: 'Berlin', state: 'BE', zip: '10117', country: 'Germany' },
            { street: '75 Avenue des Champs-Élysées', city: 'Paris', state: 'IDF', zip: '75008', country: 'France' }
        ];
    }

    /**
     * Searches the local address database for suggestions.
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

        return localMatches.slice(0, 5);
    }
}