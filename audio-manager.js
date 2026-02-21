/**
 * Audio & Vibrate Manager
 */

const AudioManager = {
    ctx: null,
    enabled: false,

    init() {
        if (this.ctx) return;
        try {
            const AudioContext = window.AudioContext || window.webkitAudioContext;
            this.ctx = new AudioContext();
        } catch (e) {
            console.warn("WebAudio API not supported");
        }
    },

    enable() {
        this.init();
        if (this.ctx && this.ctx.state === 'suspended') {
            this.ctx.resume();
        }
        this.enabled = true;
    },

    playBuiltin(type = 'chime1') {
        if (!this.enabled || !this.ctx) return;

        const t = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();

        osc.connect(gain);
        gain.connect(this.ctx.destination);

        if (type === 'chime1') {
            // Simple 2-tone chime
            osc.type = 'sine';
            osc.frequency.setValueAtTime(880, t); // A5
            gain.gain.setValueAtTime(0, t);
            gain.gain.linearRampToValueAtTime(0.5, t + 0.05);
            gain.gain.exponentialRampToValueAtTime(0.01, t + 0.4);

            osc.frequency.setValueAtTime(1046.5, t + 0.4); // C6
            gain.gain.setValueAtTime(0.5, t + 0.4);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 1.2);

            osc.start(t);
            osc.stop(t + 1.2);
        } else {
            // Default single tone
            osc.type = 'triangle';
            osc.frequency.setValueAtTime(1000, t);
            gain.gain.setValueAtTime(0.1, t);
            gain.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
            osc.start(t);
            osc.stop(t + 0.5);
        }
    },

    vibrate(pattern) {
        if ('vibrate' in navigator) {
            navigator.vibrate(pattern);
        }
    }
};
