/**
 * vCGE-MOD03: the shutter click (raven575, 2026-10-24: the one sound in vCGE)
 *
 * A quiet "tk-chk" under 0.08 s, made here from a short burst of noise: no sound file, no internet. It plays only when
 * the shutter takes a photo: never on an upload, never on its own, never looping, at a fifth of full volume at most.
 * Phones in Japan and South Korea play a shutter sound by carrier rule, so vCGE is ready for them.
 * On an iPhone with the silent switch on, Safari mutes sounds from web pages, so the click cannot be forced there.
 */
export const CLICK_MS = 80;       // the whole click, both taps, ends inside this
export const CLICK_PEAK = 0.2;    // the loudest it gets (1 is full volume)
// Two soft taps: the bright "tk" of the shutter opening, then the lower "chk" of it closing
export const CLICK_TAPS = [
    { at: 0, ms: 18, hz: 3200, gain: CLICK_PEAK },
    { at: 0.035, ms: 40, hz: 1800, gain: CLICK_PEAK * 0.8 },
];

let audio = null;

// Sound can only start from a press, so the shutter's press calls this first; later calls reuse the same player.
export function readyClick(win = globalThis) {
    if (audio) {
        if (audio.state === 'suspended' && audio.resume) audio.resume().catch(() => {});
        return audio;
    }
    const Player = win.AudioContext || win.webkitAudioContext;
    if (!Player) return null;
    try { audio = new Player(); } catch { audio = null; }
    return audio;
}

// Plays one click; returns false (and stays silent) when the browser has no sound or refuses it.
export function playShutterClick(ac = readyClick()) {
    if (!ac) return false;
    try {
        const t0 = ac.currentTime, rate = ac.sampleRate;
        const noise = ac.createBuffer(1, Math.ceil(rate * CLICK_MS / 1000), rate);
        const data = noise.getChannelData(0);
        for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
        for (const tap of CLICK_TAPS) {
            const start = t0 + tap.at, end = start + tap.ms / 1000;
            const source = ac.createBufferSource(), band = ac.createBiquadFilter(), level = ac.createGain();
            source.buffer = noise; source.loop = false;
            band.type = 'bandpass'; band.frequency.value = tap.hz; band.Q.value = 1.2;
            level.gain.setValueAtTime(0, start);
            level.gain.linearRampToValueAtTime(tap.gain, start + 0.002);
            level.gain.exponentialRampToValueAtTime(0.0001, end);
            source.connect(band); band.connect(level); level.connect(ac.destination);
            source.start(start); source.stop(end);
        }
        return true;
    } catch {
        return false;
    }
}
