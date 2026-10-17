/**
 * vCGE (vCard Generator Engine) - Pub/Sub Event Broker (`eventBus.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575, Gemini & Claude
 */

export class EventBus {
    constructor() {
        this.listeners = new Map();
    }

    subscribe(event, callback) {
        if (!this.listeners.has(event)) {
            this.listeners.set(event, []);
        }
        this.listeners.get(event).push(callback);
        return () => this.unsubscribe(event, callback);
    }

    unsubscribe(event, callback) {
        if (!this.listeners.has(event)) return;
        const filtered = this.listeners.get(event).filter(cb => cb !== callback);
        this.listeners.set(event, filtered);
    }

    publish(event, data) {
        if (!this.listeners.has(event)) return;
        for (const callback of this.listeners.get(event)) {
            try {
                callback(data);
            } catch (err) {
                console.error(`[vCGE-EventBus] Error executing listener for event "${event}":`, err);
            }
        }
    }
}

// Single application-wide bus. All modules publish and subscribe through these event names.
export const Events = Object.freeze({
    CONTACT_UPDATED: 'CONTACT_UPDATED',
    IMAGE_CAPTURED: 'IMAGE_CAPTURED',
    OCR_TEXT_EXTRACTED: 'OCR_TEXT_EXTRACTED',
    VAULT_UNLOCKED: 'VAULT_UNLOCKED',
    VAULT_QUICK_LOCKED: 'VAULT_QUICK_LOCKED',
    VAULT_UNLOCK_METHOD_CHANGED: 'VAULT_UNLOCK_METHOD_CHANGED',
    VAULT_WIPED: 'VAULT_WIPED',
    EXPORT_DISPATCHED: 'EXPORT_DISPATCHED',
    MEMORY_PURGED: 'MEMORY_PURGED',
    EGRESS_BLOCKED: 'EGRESS_BLOCKED',
    CARD_CHANGED: 'CARD_CHANGED',     // MOD01 deck: { from, to } card names only, a hand-off signal
    SETTINGS_WIPE_REQUESTED: 'SETTINGS_WIPE_REQUESTED'   // MOD02 wipe dialog: the person ticked "Also delete my saved settings"; MOD01 clears its own entry
});

export const globalEventBus = new EventBus();