// --- js/core/store.js ---
// Живі значення й історія для графіків. Сторінки не підписуються на окремі ключі:
// UI перемальовується за таймером, а тут лише лічильник змін.

const HISTORY_MS = 15 * 60 * 1000;
const HISTORY_STEP_MS = 400;          // частіше точки графіку не додають сенсу
const DEFAULT_TTL_MS = 12000;         // кадри шини; UDS передає свій період

export class Store {
    constructor() {
        this.values = new Map();      // key → { v, t }
        this.history = new Map();     // key → [{ t, v }]
        this.frames = new Map();      // id → { data, t, count, first }
        this.didStatus = new Map();   // poll → { ok, text, t }
        this.dtc = new Map();         // блок → { list } | { error }
        this.dtcRevision = 0;         // екран перемальовується, коли список змінився
        this.dtcBusy = false;
        this.revision = 0;
        this.set = this.set.bind(this);
        this.get = this.get.bind(this);
        this.fresh = this.fresh.bind(this);
    }

    set(key, v, ttl = DEFAULT_TTL_MS) {
        const t = Date.now();
        this.values.set(key, { v, t, ttl });
        this.revision++;
        if (typeof v === 'number' && Number.isFinite(v)) this._remember(key, v, t);
    }

    _remember(key, v, t) {
        let h = this.history.get(key);
        if (!h) this.history.set(key, (h = []));
        const last = h[h.length - 1];
        if (last && t - last.t < HISTORY_STEP_MS) {
            last.v = v;
            return;
        }
        h.push({ t, v });
        while (h.length && t - h[0].t > HISTORY_MS) h.shift();
    }

    get(key) {
        return this.values.get(key)?.v ?? null;
    }

    /** Значення лишилось із минулого: нове мало вже прийти, а його нема. */
    isStale(key) {
        const e = this.values.get(key);
        return !!e && Date.now() - e.t > e.ttl;
    }

    /** Значення для розрахунків: застаріле дало б вигадану, але живу на вигляд цифру. */
    fresh(key) {
        return this.isStale(key) ? null : this.get(key);
    }

    noteFrame(id, data) {
        const now = Date.now();
        const f = this.frames.get(id);
        if (f) {
            f.data = data;
            f.count++;
            f.t = now;
        } else {
            this.frames.set(id, { data, t: now, count: 1, first: now });
        }
        this.revision++;
    }

    noteDid(poll, ok, text) {
        this.didStatus.set(poll, { ok, text, t: Date.now() });
    }

    clear() {
        this.values.clear();
        this.history.clear();
        this.frames.clear();
        this.didStatus.clear();
        this.dtc.clear();
        this.revision++;
    }
}
