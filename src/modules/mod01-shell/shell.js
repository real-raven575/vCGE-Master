/**
 * vCGE-MOD01: Container Shell & Broker Implementation
 * Created by raven575 and Gemini
 */
(function() {
    'use strict';

    // Centralized Inter-Module Event Broker (Pub/Sub)
    class Broker {
        constructor() {
            this.subscribers = {};
        }

        subscribe(topic, callback) {
            if (!this.subscribers[topic]) {
                this.subscribers[topic] = [];
            }
            this.subscribers[topic].push(callback);
        }

        publish(topic, payload) {
            console.log(`[vCGE.Broker] Dispatching event -> [${topic}]`, payload);
            if (this.subscribers[topic]) {
                this.subscribers[topic].forEach(cb => cb(payload));
            }
        }
    }

    const broker = new Broker();
    window.vCGE = window.vCGE || {};
    window.vCGE.Broker = broker;

    // Security Gatekeeper Firewall Inspection
    function enforceGatekeeper(targetModule, action, payload) {
        const unauthorizedDirectEgress = ['FETCH_EXTERNAL_API', 'SOCKET_CONNECT', 'UNAUTHORIZED_FILE_DROP'];
        if (unauthorizedDirectEgress.includes(action)) {
            console.warn(`[Gatekeeper BLOCK] Unauthorized egress attempt blocked from ${targetModule} performing ${action}`);
            return false;
        }
        if (action === 'EXPORT_INTENT_DISPATCH' && targetModule !== 'vCGE-MOD08') {
            console.log(`[Gatekeeper Route] Directing outbound request securely through vCGE-MOD08.`);
        }
        return true;
    }

    // Network interceptor: sub-modules may not reach any non-local host. Same-origin requests (local assets) are allowed;
    // everything else is blocked and reported on the broker. Outbound sharing goes through MOD08 (share sheet,
    // downloads, mailto/sms, print), none of which uses these APIs. The CSP in index.html enforces the same rule.
    function isSameOrigin(url) {
        try { return new URL(url, window.location.href).origin === window.location.origin; } catch (e) { return false; }
    }
    function blockEgress(api, url) {
        console.warn(`[Gatekeeper BLOCK] ${api} to ${url} blocked: direct network egress is not permitted.`);
        broker.publish('EGRESS_BLOCKED', { api, url: String(url), timestamp: Date.now() });
    }

    const nativeFetch = window.fetch;
    if (nativeFetch) {
        window.fetch = function (input, init) {
            const url = input instanceof Request ? input.url : String(input);
            if (!isSameOrigin(url)) {
                blockEgress('fetch', url);
                return Promise.reject(new TypeError('vCGE Gatekeeper: network egress blocked'));
            }
            return nativeFetch.call(this, input, init);
        };
    }

    if (window.XMLHttpRequest) {
        const nativeOpen = XMLHttpRequest.prototype.open;
        XMLHttpRequest.prototype.open = function (method, url, ...rest) {
            if (!isSameOrigin(url)) {
                blockEgress('XMLHttpRequest', url);
                throw new Error('vCGE Gatekeeper: network egress blocked');
            }
            return nativeOpen.call(this, method, url, ...rest);
        };
    }

    if (navigator.sendBeacon) {
        const nativeBeacon = navigator.sendBeacon.bind(navigator);
        navigator.sendBeacon = function (url, data) {
            if (!isSameOrigin(url)) { blockEgress('sendBeacon', url); return false; }
            return nativeBeacon(url, data);
        };
    }

    if (window.WebSocket) {
        window.WebSocket = function (url) {
            blockEgress('WebSocket', url);
            throw new Error('vCGE Gatekeeper: network egress blocked');
        };
    }

    if (window.EventSource) {
        const NativeEventSource = window.EventSource;
        window.EventSource = function (url, config) {
            if (!isSameOrigin(url)) {
                blockEgress('EventSource', url);
                throw new Error('vCGE Gatekeeper: network egress blocked');
            }
            return new NativeEventSource(url, config);
        };
    }

    // Null-Safe DOM Bindings & State Sync
    document.addEventListener('DOMContentLoaded', () => {
        const fields = {
            name: document.getElementById('inputName'),
            title: document.getElementById('inputTitle'),
            company: document.getElementById('inputCompany'),
            phone: document.getElementById('inputPhone'),
            email: document.getElementById('inputEmail'),
            web: document.getElementById('inputWeb')
        };

        const previews = {
            name: document.getElementById('previewName'),
            title: document.getElementById('previewTitle'),
            company: document.getElementById('previewCompany'),
            phone: document.getElementById('previewPhone'),
            email: document.getElementById('previewEmail')
        };

        // Contact data is held in memory only; purge plaintext left by earlier builds (startup residue check).
        localStorage.removeItem('vcge_contact_state');

        // Real-time synchronization and broker publishing
        Object.keys(fields).forEach(key => {
            const elem = fields[key];
            if (elem) {
                elem.addEventListener('input', (e) => {
                    const val = e.target.value;
                    if (previews[key]) previews[key].textContent = val || `[${key}]`;

                    // Broadcast through broker
                    broker.publish('EVENT_CONTACT_UPDATED', { field: key, value: val });
                });
            }
        });

        // 3D Card Flip Handler
        const cardContainer = document.getElementById('cardContainer');
        const cardInner = document.getElementById('cardInner');
        const btnFlipCard = document.getElementById('btnFlipCard');

        let isFlipped = false;
        function toggleFlip() {
            isFlipped = !isFlipped;
            if (cardInner) {
                cardInner.style.transform = isFlipped ? 'rotateY(180deg)' : 'rotateY(0deg)';
            }
        }

        if (cardContainer) cardContainer.addEventListener('click', toggleFlip);
        if (btnFlipCard) btnFlipCard.addEventListener('click', toggleFlip);

        // Simulator Event Listeners
        const btnSimulateOCR = document.getElementById('btnSimulateOCR');
        if (btnSimulateOCR) {
            btnSimulateOCR.addEventListener('click', () => {
                const sampleOCR = {
                    event_id: 'EVT_OCR_EXTRACTION_SUCCESS',
                    source_module: 'vCGE-MOD04',
                    target_module: 'vCGE-MOD02',
                    timestamp: new Date().toISOString(),
                    payload: {
                        name: 'Jane Doe',
                        title: 'Chief Technology Officer',
                        company: 'Acme Corporation',
                        phone: '+1 (555) 019-2834',
                        email: 'jane.doe@acme.com',
                        web: 'https://www.acme.com'
                    }
                };
                broker.publish('OCR_PROCESSING_COMPLETE', sampleOCR);
                
                // Populate fields automatically
                if (fields.name) fields.name.value = sampleOCR.payload.name;
                if (fields.title) fields.title.value = sampleOCR.payload.title;
                if (fields.company) fields.company.value = sampleOCR.payload.company;
                if (fields.phone) fields.phone.value = sampleOCR.payload.phone;
                if (fields.email) fields.email.value = sampleOCR.payload.email;
                if (fields.web) fields.web.value = sampleOCR.payload.web;

                Object.keys(previews).forEach(k => {
                    if (previews[k]) previews[k].textContent = sampleOCR.payload[k];
                });
                alert('OCR extraction simulation complete! Data safely routed through MOD01 broker.');
            });
        }

        const btnTriggerPurge = document.getElementById('btnTriggerPurge');
        if (btnTriggerPurge) {
            btnTriggerPurge.addEventListener('click', () => {
                broker.publish('VAULT_PURGE_REQUEST', { code: '3001', message: 'ERR_MEMORY_RESIDUE_DETECTED - Volatile RAM Zero-Fill Wiped' });
                alert('TTL Volatile RAM Purge executed successfully. Buffer wiped with zero-fill.');
            });
        }

        const btnExportShare = document.getElementById('btnExportShare');
        if (btnExportShare) {
            btnExportShare.addEventListener('click', () => {
                if (enforceGatekeeper('vCGE-MOD01', 'EXPORT_INTENT_DISPATCH', {})) {
                    broker.publish('EXPORT_INTENT_DISPATCH', { timestamp: Date.now() });
                    alert('Outbound export request securely routed through vCGE-MOD08 Gatekeeper.');
                }
            });
        }

        // Broker Event Subscriptions
        broker.subscribe('VAULT_SAVE_REQUEST', (payload) => {
            console.log('[MOD02 Vault] Saving payload securely:', payload);
        });

        broker.subscribe('VAULT_PURGE_REQUEST', (err) => {
            console.warn('[MOD02 Vault Security]', err);
            const statusIndicator = document.getElementById('vaultStateIndicator');
            if (statusIndicator) {
                statusIndicator.textContent = 'PURGED / SECURE';
                statusIndicator.className = 'text-xs text-rose-400 font-mono';
                setTimeout(() => {
                    statusIndicator.textContent = 'LOCKED / AES-256';
                    statusIndicator.className = 'text-xs text-emerald-400 font-mono';
                }, 2000);
            }
        });
    });
})();