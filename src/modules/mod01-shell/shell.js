/**
 * vCGE-MOD01: Container Shell & Security Gatekeeper
 * Created by raven575, Gemini & Claude
 *
 * The network lock itself is netLock.js, a classic script index.html loads before every other script, and
 * workerGuard.js inside the OCR worker. This module, imported first by src/main.js, puts the lock's blocks on the event
 * bus for the audit log and reports if the lock is missing. It also opens the welcome pop-up (welcome.js) as vCGE starts.
 */
import { globalEventBus, Events } from '../../share/eventBus.js';
import { showWelcome } from './welcome.js';

// Action-level gatekeeper: outbound intents must be dispatched by vCGE-MOD08.
export function enforceGatekeeper(sourceModule, action) {
    const unauthorizedDirectEgress = ['FETCH_EXTERNAL_API', 'SOCKET_CONNECT', 'UNAUTHORIZED_FILE_DROP'];
    if (unauthorizedDirectEgress.includes(action)) {
        console.warn(`[Gatekeeper BLOCK] Unauthorized egress attempt blocked from ${sourceModule} performing ${action}`);
        return false;
    }
    return true;
}

// True when netLock.js has wrapped the page's network APIs.
export const netLockInstalled = () => !!(window.fetch && window.fetch[Symbol.for('vcge.netLock')]);

if (!netLockInstalled()) console.error('[Gatekeeper] netLock.js is not loaded: only the CSP is blocking network egress.');

// Blocks carry only the API and the scheme + host, never the blocked URL's path or query.
window.addEventListener('vcge:egress-blocked', (e) => {
    const { api, url, timestamp } = e.detail || {};
    globalEventBus.publish(Events.EGRESS_BLOCKED, { api, url, timestamp });
});

// Every new session opens on the welcome pop-up (START NOW or the tour). Nothing records that it was seen.
showWelcome();
