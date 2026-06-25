/**
 * Tiny procedural sound system — no audio files. Each effect is a short
 * WebAudio blip, so the whole game stays a single self-contained page. All
 * sounds route through one gain node that the mute toggle silences.
 *
 * This is intentionally a thin "hook" layer: call `audio.play('couple')` from
 * game events. Swapping in sampled audio later only means changing `play`.
 */
export class AudioManager {
    constructor() {
        this.enabled = true;
        this.ctx = null;
        this.master = null;
    }
    /** Lazily create the AudioContext (must follow a user gesture on most browsers). */
    ensure() {
        if (this.ctx)
            return this.ctx;
        try {
            const Ctor = window.AudioContext ?? window.webkitAudioContext;
            this.ctx = new Ctor();
            this.master = this.ctx.createGain();
            this.master.gain.value = 0.5;
            this.master.connect(this.ctx.destination);
        }
        catch {
            this.ctx = null;
        }
        return this.ctx;
    }
    setEnabled(on) {
        this.enabled = on;
    }
    /** A single enveloped oscillator note. */
    note(freq, start, dur, type, peak) {
        const ctx = this.ctx;
        if (!ctx || !this.master)
            return;
        const osc = ctx.createOscillator();
        const g = ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, start);
        g.gain.setValueAtTime(0, start);
        g.gain.linearRampToValueAtTime(peak, start + 0.01);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.connect(g);
        g.connect(this.master);
        osc.start(start);
        osc.stop(start + dur + 0.02);
    }
    /** A short filtered white-noise burst — for impacts (the crash). */
    noise(start, dur, peak, lowpassHz) {
        const ctx = this.ctx;
        if (!ctx || !this.master)
            return;
        const n = Math.max(1, Math.floor(ctx.sampleRate * dur));
        const buf = ctx.createBuffer(1, n, ctx.sampleRate);
        const data = buf.getChannelData(0);
        for (let i = 0; i < n; i++)
            data[i] = Math.random() * 2 - 1;
        const src = ctx.createBufferSource();
        src.buffer = buf;
        const lp = ctx.createBiquadFilter();
        lp.type = 'lowpass';
        lp.frequency.value = lowpassHz;
        const g = ctx.createGain();
        g.gain.setValueAtTime(peak, start);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        src.connect(lp);
        lp.connect(g);
        g.connect(this.master);
        src.start(start);
        src.stop(start + dur + 0.02);
    }
    play(sfx) {
        if (!this.enabled)
            return;
        const ctx = this.ensure();
        if (!ctx)
            return;
        if (ctx.state === 'suspended')
            void ctx.resume();
        const t = ctx.currentTime;
        switch (sfx) {
            case 'lay':
                this.note(520, t, 0.05, 'triangle', 0.18);
                break;
            case 'erase':
                this.note(300, t, 0.06, 'triangle', 0.16);
                break;
            case 'start':
                this.note(160, t, 0.12, 'sawtooth', 0.2);
                this.note(240, t + 0.08, 0.12, 'sawtooth', 0.16);
                break;
            case 'couple':
                this.note(392, t, 0.07, 'square', 0.18);
                this.note(523, t + 0.06, 0.1, 'square', 0.18);
                break;
            case 'button':
                this.note(660, t, 0.05, 'square', 0.16);
                break;
            case 'arrive':
                this.note(523, t, 0.09, 'triangle', 0.2);
                break;
            case 'win':
                [523, 659, 784, 1047].forEach((f, i) => this.note(f, t + i * 0.1, 0.18, 'triangle', 0.22));
                break;
            case 'lose':
                this.note(330, t, 0.18, 'sawtooth', 0.2);
                this.note(220, t + 0.12, 0.28, 'sawtooth', 0.2);
                break;
            case 'clack':
                // a soft low "tk" — quiet so it pleasantly keeps time, not annoying
                this.note(150, t, 0.03, 'square', 0.05);
                this.note(110, t + 0.018, 0.03, 'square', 0.045);
                break;
            case 'whistle': {
                // two-tone steam toot
                this.note(740, t, 0.22, 'triangle', 0.13);
                this.note(560, t, 0.22, 'sine', 0.09);
                this.note(900, t + 0.16, 0.16, 'triangle', 0.1);
                break;
            }
            case 'crash':
                this.noise(t, 0.34, 0.4, 1700); // gravelly impact
                this.note(80, t, 0.26, 'sawtooth', 0.32); // low thud underneath
                this.note(120, t + 0.04, 0.18, 'sawtooth', 0.18);
                break;
        }
    }
}
//# sourceMappingURL=sound.js.map