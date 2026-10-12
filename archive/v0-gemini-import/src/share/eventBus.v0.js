/**
 * vCGE (vCard Generator Engine) - Pub/Sub Event Broker (`eventBus.js`)
 * Project Overseer Authorized Production Build
 * Attributions: Created by raven575 and Gemini
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

export const globalEventBus = new EventBus();