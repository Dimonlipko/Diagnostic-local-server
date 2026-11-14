// --- js/core/recorder.js ---
// Запис живих значень у CSV для розбору на десктопі. Раз на секунду: історія по шині
// швидша за це все одно не приходить через BLE.

const SAMPLE_MS = 1000;
const MAX_ROWS = 6 * 3600;

const isScalar = (v) => v !== null && ['number', 'boolean', 'string'].includes(typeof v);

export class Recorder {
    constructor(store) {
        this.store = store;
        this.rows = [];
        this.columns = new Set();
        this.timer = null;
    }

    get active() { return this.timer !== null; }
    get size() { return this.rows.length; }

    start() {
        this.rows = [];
        this.columns = new Set();
        this.timer = setInterval(() => this._sample(), SAMPLE_MS);
    }

    _sample() {
        const row = { t: new Date().toISOString() };
        for (const [k, e] of this.store.values) {
            if (!isScalar(e.v)) continue;
            this.columns.add(k);
            row[k] = e.v;
        }
        this.rows.push(row);
        if (this.rows.length >= MAX_ROWS) this.rows.shift();
    }

    stop() {
        clearInterval(this.timer);
        this.timer = null;
        const cols = ['t', ...this.columns];
        const esc = (v) => {
            if (v === undefined) return '';
            const s = String(v);
            return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
        };
        const lines = [cols.join(','), ...this.rows.map((r) => cols.map((c) => esc(r[c])).join(','))];
        return new Blob([lines.join('\n')], { type: 'text/csv' });
    }
}
