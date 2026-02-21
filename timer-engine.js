/**
 * High-Precision Timer Engine
 * Uses performance.now() and requestAnimationFrame instead of setInterval
 */

class TimerEngine {
    constructor(onTick, onEnd) {
        this.onTick = onTick; // Callback fired every frame
        this.onEnd = onEnd;   // Callback when stopped

        this.state = 'idle'; // idle | running | paused

        this.startPerf = null;
        this.endPerf = null;
        this.startTimestamp = null; // ISO string

        this.pauseStartPerf = null;
        this.totalPausePerf = 0;

        this.targetSeconds = 0;
        this.animationFrameId = null;

        // Callbacks for specific events
        this.onTargetReached = null;
        this.onPreAlert = null;

        this.hasReachedTarget = false;
        this.hasFiredPreAlert = false;
        this.preAlertSec = 0;
    }

    setTarget(seconds, preAlertSec = 0) {
        this.targetSeconds = seconds;
        this.preAlertSec = preAlertSec;
    }

    start() {
        if (this.state === 'running') return;

        if (this.state === 'idle') {
            this.startPerf = performance.now();
            this.startTimestamp = new Date().toISOString();
            this.totalPausePerf = 0;
            this.hasReachedTarget = false;
            this.hasFiredPreAlert = false;
        } else if (this.state === 'paused') {
            this.totalPausePerf += (performance.now() - this.pauseStartPerf);
            this.pauseStartPerf = null;
        }

        this.state = 'running';
        this.tick();
    }

    pause() {
        if (this.state !== 'running') return;
        this.state = 'paused';
        this.pauseStartPerf = performance.now();
        cancelAnimationFrame(this.animationFrameId);
    }

    stop(manualEnd = true, notes = '') {
        if (this.state === 'idle') return null;

        if (this.state === 'running') {
            this.endPerf = performance.now();
            cancelAnimationFrame(this.animationFrameId);
        } else if (this.state === 'paused') {
            this.endPerf = this.pauseStartPerf; // Stop exactly when paused
        }

        this.state = 'idle';
        const endTimestamp = new Date().toISOString();

        const durationSec = (this.endPerf - this.startPerf - this.totalPausePerf) / 1000;
        const overrunSec = durationSec - this.targetSeconds;
        const finalRemainingSec = this.targetSeconds - durationSec;

        const runData = {
            runId: 'run-' + Date.now(),
            startTimestamp: this.startTimestamp,
            endTimestamp,
            durationSec,
            targetSeconds: this.targetSeconds,
            overrunSec,
            finalRemainingSec,
            manualEnd,
            notes
        };

        if (this.onEnd) this.onEnd(runData);
        return runData;
    }

    tick = () => {
        if (this.state !== 'running') return;

        const now = performance.now();
        const elapsedSec = (now - this.startPerf - this.totalPausePerf) / 1000;
        const remainingSec = this.targetSeconds - elapsedSec;
        const isOverrun = remainingSec <= 0;

        // Fire pre-alert
        if (!this.hasFiredPreAlert && this.preAlertSec > 0 && remainingSec <= this.preAlertSec && remainingSec > 0) {
            this.hasFiredPreAlert = true;
            if (this.onPreAlert) this.onPreAlert();
        }

        // Fire target reached
        if (!this.hasReachedTarget && isOverrun) {
            this.hasReachedTarget = true;
            if (this.onTargetReached) this.onTargetReached();
        }

        if (this.onTick) {
            this.onTick({
                elapsedSec,
                remainingSec,
                isOverrun,
                formattedDisplay: this.formatDisplay(Math.abs(remainingSec), isOverrun)
            });
        }

        this.animationFrameId = requestAnimationFrame(this.tick);
    }

    formatDisplay(secAbs, isOverrun) {
        const sign = isOverrun ? '-' : '';

        let hours = Math.floor(secAbs / 3600);
        let minutes = Math.floor((secAbs % 3600) / 60);
        let seconds = (secAbs % 60);

        // Format to s.ss
        const sStr = seconds < 10 ? '0' + seconds.toFixed(2) : seconds.toFixed(2);
        const mStr = minutes.toString().padStart(2, '0');

        if (hours > 0) {
            const hStr = hours.toString().padStart(2, '0');
            return `${sign}${hStr}:${mStr}:${sStr}`;
        }

        return `${sign}${mStr}:${sStr}`;
    }
}
