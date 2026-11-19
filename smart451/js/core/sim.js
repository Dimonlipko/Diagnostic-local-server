// --- js/core/sim.js ---
// Симулятор машини на рівні тексту ELM327: драйвер не знає, що працює не з адаптером,
// тож демо-режим і тести ганяють той самий код, що й BLE. Кодування кадрів тут
// написане окремо від декодерів, інакше помилка масштабу зникала б у обидва боки.

const hex = (v, n = 2) => v.toString(16).toUpperCase().padStart(n, '0');
const hexBytes = (b) => Array.from(b, (v) => hex(v)).join('');
const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const u16 = (v) => [(v >> 8) & 0xFF, v & 0xFF];
const u32 = (v) => [(v >>> 24) & 0xFF, (v >>> 16) & 0xFF, (v >>> 8) & 0xFF, v & 0xFF];
const text = (s) => Array.from(s, (c) => c.charCodeAt(0));

// Таблиця OCV машини, виміряна 2026-08-06 (CAR_OCV у smart_ed_diag_gui.py).
const OCV = [[285, 0], [300, 1.5], [315, 4.7], [330, 15.4], [345, 52.2], [360, 75.8], [375, 94.7], [390, 100]];

function packVolts(soc) {
    for (let i = 1; i < OCV.length; i++) {
        if (soc <= OCV[i][1]) {
            const [v0, s0] = OCV[i - 1];
            const [v1, s1] = OCV[i];
            return v0 + ((v1 - v0) * (soc - s0)) / (s1 - s0);
        }
    }
    return 390;
}

// Сталий псевдошум: той самий розкид комірок на кожному запуску.
function seeded(seed) {
    let s = seed;
    return () => {
        s = (s * 1664525 + 1013904223) >>> 0;
        return s / 2 ** 32;
    };
}

// Налаштування моста в порядку Due (firmware/bridge/src/settings.cpp): ключ, варіанти
// (null — число), межі, типове значення. Звідси FD02, FD10+i і запис 2E.
const SIM_SETTINGS = [
    ['SRC', 'emulator|twingo_lbc', 0, 1, 1], ['EMUSOC', null, 0, 1000, 500], ['EMUPACKV', null, 0, 4500, 3505],
    ['LBCCAR', 'off|auto|on', 0, 2, 1], ['DASHV', 'real|scale_93|fixed|soc', 0, 3, 3], ['DASHVFIX', null, 0, 4500, 3600],
    ['PRECHG', 'timer|pack|inverter', 0, 2, 2], ['CTSENSE', 'off|on', 0, 1, 1], ['HVIL', 'off|on', 0, 1, 1],
    ['HVILHZ', null, 1, 20000, 88], ['HVILDUTY', null, 1, 99, 50],
    ['CELLPROT', 'off|limit|open', 0, 2, 2], ['CELLHIW', null, 3000, 4200, 4050], ['CELLHI', null, 3000, 4200, 4100],
    ['CELLLOW', null, 2500, 4000, 3200], ['CELLLO', null, 2500, 4000, 3000],
    ['PUMP1', null, 0, 100, 0], ['PUMP2', null, 0, 100, 0], ['PUMPINV', 'off|on', 0, 1, 0],
];

export class SimVehicle {
    constructor({ scenario = 'drive', bridge = false } = {}) {
        this.scenario = scenario;
        this.bridge = bridge;
        this.settings = SIM_SETTINGS.map(([key, labels, min, max, v]) => ({ key, labels, min, max, v }));
        this.soc = 64.2;
        this.startedAt = Date.now();
        this.last = this.startedAt;
        this.odo = 48213;
        this.tripStart = 12.4;
        this.tripReset = 318.7;
        this.energyStart = 2.31;
        this.energyReset = 54.8;
        this.cleared = new Set();
        this._makePack();
        this.step();
    }

    _makePack() {
        const rnd = seeded(451);
        this.cellCount = this.bridge ? 96 : 93;
        this.cellOffset = Array.from({ length: this.cellCount }, () => (rnd() - 0.5) * 16);
        this.cellOffset[41] -= 34;    // слабка комірка, щоб екран було що показати
        this.cellOffset[77] += 12;
        this.cellAs = this.cellOffset.map((o) => Math.round(18600 + o * 26 + (rnd() - 0.5) * 240));
        this.cellRes = this.cellOffset.map((o) => Math.round(1024 - o * 3 + (rnd() - 0.5) * 60));
        this.tempOffset = Array.from({ length: 9 }, () => (rnd() - 0.5) * 3.2);
    }

    setScenario(s) { this.scenario = s; }

    setBridge(on) {
        this.bridge = on;
        this._makePack();
    }

    get awake() { return this.scenario !== 'sleep'; }
    get closed() { return this.scenario === 'drive' || this.scenario === 'charge'; }
    get charging() { return this.scenario === 'charge'; }

    step() {
        const now = Date.now();
        const dt = (now - this.last) / 1000;
        this.last = now;
        const t = (now - this.startedAt) / 1000;

        if (this.scenario === 'drive') {
            this.speed = clamp(46 + 34 * Math.sin(t / 11) + 12 * Math.sin(t / 3.1), 0, 110);
            const accel = 34 * Math.cos(t / 11) / 11 + 12 * Math.cos(t / 3.1) / 3.1;
            this.kw = clamp(this.speed * 0.12 + accel * 3.6 + 0.8, -18, 55);
            this.lv = 14.1;
        } else if (this.scenario === 'charge') {
            this.speed = 0;
            this.kw = -19.6 - Math.sin(t / 7) * 0.3;
            this.lv = 14.0;
        } else {
            this.speed = 0;
            this.kw = 0.2;
            this.lv = 12.4;
        }

        const ocv = packVolts(this.soc);
        const rPack = 0.11;
        const ampsOut = (this.kw * 1000) / ocv;
        this.packV = ocv - ampsOut * rPack;
        this.amps = -ampsOut;                                  // + = заряд
        this.soc = clamp(this.soc + (this.amps * dt) / (53 * 36), 1, 100);

        const dist = (this.speed * dt) / 3600;
        this.tripStart += dist;
        this.tripReset += dist;
        this.energyStart += (Math.max(this.kw, 0) * dt) / 3600;
        this.energyReset += (Math.max(this.kw, 0) * dt) / 3600;
        this.odo += dist;

        this.tMean = 23.5 + Math.min(t / 240, 3) + (this.charging ? 1.2 : 0);
    }

    cellsMv() {
        const base = (this.packV / this.cellCount) * 1000;
        return this.cellOffset.map((o) => base + o - (o < -20 ? this.amps * -0.25 : 0));
    }

    temps() { return this.tempOffset.map((o) => this.tMean + o); }

    frame(id) {
        const d = new Array(8).fill(0);
        const hv = this.closed ? Math.round(this.packV * 10) : 0x1FFF;
        const raw = Math.round(this.amps * 10) + 0x2000;
        switch (id) {
            case 0x518: d[1] = this.charging ? 64 : 0; d[7] = this.closed ? Math.round(this.soc * 2) : 0xFF; break;
            case 0x508: d[2] = ((raw >> 8) & 0x3F) | (this.charging ? 0x40 : 0); d[3] = raw & 0xFF; break;
            case 0x448: [d[6], d[7]] = u16(hv); break;
            case 0x3D5: d[3] = Math.round(this.lv * 10); break;
            case 0x412: {
                const o = Math.floor(this.odo);
                d[2] = Math.floor(o / 65535);
                const rest = o - d[2] * 65535;
                d[3] = rest >> 8;
                d[4] = rest & 0xFF;
                break;
            }
            case 0x512: { const n = new Date(); d[0] = n.getHours(); d[1] = n.getMinutes(); break; }
            case 0x200: [d[2], d[3]] = u16(Math.round(this.speed * 18)); break;
            case 0x318: d[7] = Math.round(this.soc * 1.12); break;
            case 0x3D7: d[0] = this.closed ? 1 : 0; break;
            case 0x168: d[7] = this.charging ? 0x20 : 0; break;
            case 0x408: d[4] = Math.round(11 * 1.8 + 32 + 50); break;
            case 0x3CE:
                [d[0], d[1]] = u16(Math.round(this.energyStart * 100));
                [d[2], d[3]] = u16(Math.round(this.energyReset * 100));
                break;
            case 0x3F2: d[0] = 74 << 1; d[1] = 81 << 1; d[2] = 66 << 1; d[3] = 72 << 1; break;
            case 0x504:
                [d[1], d[2]] = u16(Math.round(this.tripStart * 10));
                [d[4], d[5]] = u16(Math.round(this.tripReset * 10));
                break;
            default: d[0] = id & 0xFF; break;
        }
        return d;
    }

    uds(ecu, req) {
        if (req[0] === 0x19) return this._dtc(ecu);
        if (req[0] === 0x14) {
            this.cleared.add(ecu);
            return [0x54];
        }
        if (req[0] === 0x31) {
            if (!this.bridge || ecu !== 0x7E7 || req[2] !== 0xE0 || req[3] !== 0x14) return [0x7F, 0x31, 0x31];
            this.cleared.add('lbc');
            return [0x71, 0x01, 0xE0, 0x14, 0x00];
        }
        if (req[0] === 0x10) return [0x50, req[1], 0x00, 0x32, 0x01, 0xF4];
        if (req[0] === 0x3E) return [0x7E, 0x00];
        if (req[0] === 0x2E) return this._writeSetting(ecu, req);
        if (req[0] !== 0x22) return [0x7F, req[0], 0x11];
        const did = (req[1] << 8) | req[2];
        const body = this._did(ecu, did);
        if (body === null) return [0x7F, 0x22, 0x31];
        return [0x62, req[1], req[2], ...body];
    }

    _did(ecu, did) {
        if (ecu === 0x7E7) return this._bms(did);
        if (ecu === 0x7E5) return this._cepc(did);
        if (ecu === 0x61A) return this._obl(did);
        return null;
    }

    _bms(did) {
        const t = this.temps();
        const tRaw = (v) => u16(Math.round(v * 100) & 0xFFFF);
        const slots = (vals, conv, total = 200) => {
            const out = [];
            for (let i = 0; i < total; i++) out.push(...(i < vals.length ? u16(conv(vals[i])) : [0xFF, 0xFF]));
            return out;
        };
        switch (did) {
            case 0x0201: {
                const max = Math.max(...t), min = Math.min(...t);
                return [...tRaw(max), ...tRaw(min), ...tRaw(this.tMean), 0x80, 0, 0x80, 0, 0x80, 0, 0x80, 0];
            }
            case 0x0202: {
                const out = [];
                for (let i = 0; i < 30; i++) out.push(...(i < t.length ? tRaw(t[i]) : [0x80, 0]));
                return out;
            }
            case 0x0203: return u16(Math.round(this.amps * 32) & 0xFFFF);
            case 0x0204: {
                const v = u16(Math.round(this.packV * 64));
                const bus = u16(this.closed ? Math.round(this.packV * 64) : 64);
                return [0, 0, 0, 0, ...v, ...bus, ...v];
            }
            case 0x0206: {
                const m = Math.round(this.soc * 1000);
                return [...u32(m - 800), ...u32(m), ...u32(m + 900)];
            }
            case 0x0208: return slots(this.cellsMv(), (mv) => Math.round((mv * 1024) / 1000));
            case 0x0209: return [...u16(4750), 0, 0, 0, 0];
            case 0x0305: return u16(0x4AAC);
            case 0x0307: return u16(12);
            case 0x0309: return u32(40000);
            case 0x030C: return u32(37856);
            case 0x030D: return slots(this.cellRes, (v) => v);
            case 0x0310: return [...new Array(17).fill(0), ...slots(this.cellAs, (v) => v)];
            case 0xD000: return u16(this.closed ? 1850 : 0);
            case 0xD003: return [this.closed ? 2 : 0, this.closed ? 3 : 0, 0, 0];
            case 0xD005: return u16(0);
            case 0xD006: return [0];
            case 0xF190: return text('WMEEJ9AA2DK000451');
            case 0xF100: return text(this.bridge ? 'BMS451EV' : 'BMS451EV_001');
            case 0xF101: return text(this.bridge ? 'DIY' : 'DEUTSCHE ACCUMOTIVE');
            case 0xF150: return text('0126');
            case 0xF154: return text('01');
            case 0xF151: return text('1242');
            case 0xF153: return text('0.01');
            case 0xF155: return text('ACM');
            case 0xF111: return text('4519823100');
            case 0xF121: return text('4519024201');
            case 0xF18C: return text('20130517');
            case 0x0303: return text('S451ED-93S');
            default: return this.bridge ? this._bridge(did) : null;
        }
    }

    _bridge(did) {
        const lbc = (v) => u16(Math.round((v + 40) * 16));
        switch (did) {
            case 0xFD00: return text('1.0.2-due');
            case 0xE019: return this.cleared.has('lbc')
                ? [0x59, 0x02, 0x09]
                : [0x59, 0x02, 0x09, 0x1B, 0x07, 0x15, 0x2F, 0x1B, 0x03, 0x00, 0x08];
            case 0xFD04: {
                const up = Math.round(Date.now() - this.startedAt);
                const p = new Array(47).fill(0);
                p[0] = 2;
                p.splice(2, 4, ...u32(up));
                p[6] = this.closed ? 2 : 0;
                p[8] = this.closed ? 3 : 0;
                p[9] = 0x27;
                p.splice(11, 2, ...u16(40));
                p.splice(45, 2, ...u16(13850));
                return p;
            }
            case 0x9001: return u16(Math.round(this.soc * 100));
            case 0x9002: return u16(Math.round((this.soc - 9) * 100));
            case 0x9003: return u16(9828);
            case 0x9005: return u16(Math.round(this.packV * 10));
            case 0x9007: return u16(Math.round(Math.max(...this.cellsMv()) * 1.024));
            case 0x9009: return u16(Math.round(Math.min(...this.cellsMv()) * 1.024));
            case 0x9012: return lbc(this.tMean);
            case 0x9013: return lbc(this.tMean - 1.5);
            case 0x9014: return lbc(this.tMean + 1.5);
            case 0x9018: return u16(2200);
            case 0x900E: return u16(2500);
            case 0x900F: return u16(5600);
            case 0x901A: return [2];
            case 0x91C8: { const wh = Math.round(this.soc * 216); return [(wh >> 16) & 0xFF, (wh >> 8) & 0xFF, wh & 0xFF]; }
            case 0x91CA: return [this.closed ? 1 : 0];
            case 0x91CB: return [0];
            case 0x91D0: return [this.closed ? 1 : 0];
            case 0x91B7: return lbc(31.5);
            case 0x912B: { const b = new Array(32).fill(0); b[5] = 0x02; b[9] = 0x20; return b; }
            case 0x924F: return u32(Math.round(46.8 * 1024) + 2 ** 31);
            case 0x9250: return u32(Math.round(100.7 * 1024) + 2 ** 31);
            case 0xFD02: return text(this.settings.map((s) => s.key).join(','));
            case 0xFD05: return this._limits();
            default: {
                const s = did >= 0xFD10 ? this.settings[did - 0xFD10] : undefined;
                return s ? text(s.labels ? s.labels.split('|')[s.v] : String(s.v)) : null;
            }
        }
    }

    // 2E FD10+i: текст або один байт-індекс варіанта, як у мосту.
    _writeSetting(ecu, req) {
        const did = (req[1] << 8) | req[2];
        const s = this.bridge && ecu === 0x7E7 && did >= 0xFD10 ? this.settings[did - 0xFD10] : undefined;
        if (!s) return [0x7F, 0x2E, 0x31];
        const data = [...req.slice(3)];
        let v = NaN;
        if (data.length === 1 && data[0] < 0x20) {
            if (s.labels) v = data[0];
        } else {
            const t = String.fromCharCode(...data);
            v = s.labels ? s.labels.split('|').indexOf(t) : /^\d+$/.test(t) ? Number(t) : NaN;
        }
        if (!Number.isInteger(v) || v < s.min || v > s.max) return [0x7F, 0x2E, 0x31];
        s.v = v;
        return [0x6E, req[1], req[2]];
    }

    // 22 FD05: захист комірок і ланцюжок лімітів, той самий розклад, що в include/uds.h.
    _limits() {
        const get = (k) => this.settings.find((s) => s.key === k).v;
        const mv = this.cellsMv();
        const hi = Math.round(Math.max(...mv) / 10) * 10;
        const lo = Math.round(Math.min(...mv) / 10) * 10;
        const ramp = (v, warn, stop) => (v >= stop ? 0 : v <= warn ? 100 : Math.floor(((stop - v) * 100) / (stop - warn)));
        const chg = ramp(hi, get('CELLHIW'), get('CELLHI'));
        const dis = ramp(-lo, -get('CELLLOW'), -get('CELLLO'));
        const pct = (v, p) => u16(Math.round((v * p) / 100));
        return [
            1, get('CELLPROT'), chg === 0 ? 0x10 : 0, chg, dis,
            ...u16(hi), ...u16(lo), ...u16(40),
            ...u16(430), ...u16(720), ...u16(4300), ...u16(7200), ...u16(2200),
            ...pct(1230, chg), ...pct(2060, dis), ...pct(2060, dis), ...pct(2474, chg), ...pct(2475, dis),
        ];
    }

    _cepc(did) {
        const a = (v) => u16(Math.round((v + 819.2) * 10));
        const closed = this.closed;
        const t = this.temps();
        const row = {
            0x5326: u16(Math.round(this.packV * 10)), 0x5324: a(this.amps),
            0x5321: u16(Math.round(this.soc * 10)), 0x530F: u16(3903), 0x5312: u16(2793),
            0x5310: a(30), 0x5311: a(180), 0x5313: u16(closed ? 2 : 0),
            0x5338: [Math.round(Math.max(...t)) + 40, 0], 0x5339: [Math.round(Math.min(...t)) + 40, 0],
            0x5005: [Math.round(this.tMean) + 50, 0], 0x5006: [Math.round((this.tMean - 2 + 40) * 2), 0],
            0x5329: u16(0), 0x532B: u16(1), 0x6010: u16(Math.round(this.soc * 10)),
            0x6014: u16(Math.round(this.soc * 10) + 6), 0x6013: a(this.amps), 0x6012: u16(53),
            0x6308: [8], 0x2022: u16(Math.round(this.lv / 0.00195313)),
            0x2047: u16(Math.round((this.tMean - 3) * 8)), 0x230A: [Math.round(this.tMean + 4 + 50)],
            0x2308: [Math.round(this.lv * 10)], 0x2309: [0, closed ? 12 : 0], 0xD032: [closed ? 102 : 0],
            0xD041: [this.charging ? 90 : 0], 0xD302: [0], 0x6309: u16(1422), 0x630A: u16(312),
            0x6321: u16(84), 0x6303: u32(Math.round(211.5 * 360000)), 0x2041: u16(642), 0x2043: u16(638),
        };
        if (did >= 0x5314 && did <= 0x5334 && !row[did]) return u16(0);
        return row[did] ?? null;
    }

    _obl(did) {
        const on = this.charging;
        const v = (x) => u16(on ? Math.round(x * 10) : 0);
        switch (did) {
            case 0xF111: return text('4519822221');
            case 0x0226: return [0, 0, 0, 0, Math.round(this.lv * 10), ...v(this.packV), ...v(231.2), ...v(229.4), ...v(232.1)];
            case 0x0225: return [...v(54.6), ...v(30.6), ...v(30.8), ...v(30.4), 0, 0, 0, 0, ...v(32), ...v(32)];
            case 0x022A: return [0, 0, 0, 0, 32];
            case 0x0223: return [Math.round(this.tMean + 8) + 40, 70, 71, 73, 72, 70, 69, 74, Math.round(this.tMean + 11) + 40, Math.round(this.tMean + 3) + 40];
            default: return null;
        }
    }

    _dtc(ecu) {
        const records = {
            0x7E7: this.bridge ? [] : [[0xC1, 0xA1, 0x00, 0x2C], [0x0A, 0xA1, 0x00, 0x09], [0x14, 0xF3, 0x12, 0x28]],
            0x7E5: [[0x0A, 0x0E, 0x00, 0x28]],
        }[ecu];
        if (records === undefined) return ecu === 0x7E6 || ecu === 0x61A ? [0x59, 0x02, 0xFF] : null;
        return [0x59, 0x02, 0xFF, ...(this.cleared.has(ecu) ? [] : records.flat())];
    }
}

const STREAM_PERIODS = {
    0x200: 40, 0x318: 200, 0x3CE: 500, 0x3D5: 100, 0x3D7: 100, 0x3F2: 1000, 0x408: 1000,
    0x412: 1000, 0x448: 100, 0x504: 500, 0x508: 40, 0x512: 1000, 0x518: 100, 0x168: 200,
    // чужі кадри: перевіряють, що маска справді фільтрує
    0x509: 50, 0x401: 100, 0x3C4: 80, 0x210: 50,
};

const ECU_RESP = { 0x7E7: 0x7EF, 0x7E5: 0x7ED, 0x7E6: 0x7EE, 0x61A: 0x483 };

export class SimTransport {
    /**
     * @param {object} [o]
     * @param {string} [o.scenario] drive | charge | park | sleep
     * @param {boolean} [o.bridge]  міст Twingo замість заводської BMS
     * @param {number} [o.latency]  затримка BLE, мс
     * @param {number} [o.timeScale] <1 пришвидшує STmin у тестах
     * @param {boolean} [o.noMask]  адаптер не знає ATCF/ATCM
     * @param {boolean} [o.noFcs]   адаптер не знає ATFCS*
     * @param {boolean} [o.shortFcIgnored] ECU ігнорує 3-байтовий FC адаптера
     * @param {boolean} [o.oneCfPerFc]  ELM ловить один CF на команду
     * @param {number} [o.bufferBelow]  BUFFER FULL, якщо STmin менший за значення
     * @param {number} [o.monitorOverflow] після стількох кадрів ATMA → BUFFER FULL
     * @param {number} [o.slowEcu]  цей блок шле 7F xx 78, а відповідь — пізніше за ATST32
     */
    constructor(o = {}) {
        this.o = { latency: 12, timeScale: 1, chunk: 20, ...o };
        this.vehicle = new SimVehicle(o);
        this.onData = null;
        this.closed = false;
        this.input = '';
        this.monitor = null;
        this._reset();
        this.requests = [];
    }

    _reset() {
        this.echo = true;
        this.headers = false;
        this.txId = 0x7DF;
        this.filter = null;
        this.fcsh = null;
        this.fcsd = null;
        this.fcsm = 0;
        this.cfc = true;
        this.pending = null;
        this.longWait = false;
    }

    async write(s) {
        if (this.closed) throw new Error('закрито');
        if (this.monitor) {
            this._stopMonitor();
            return;
        }
        this.input += s;
        let i;
        while ((i = this.input.indexOf('\r')) >= 0) {
            const line = this.input.slice(0, i).trim().toUpperCase().replace(/\s+/g, '');
            this.input = this.input.slice(i + 1);
            this._later(() => this._process(line));
        }
    }

    close() {
        this.closed = true;
        clearInterval(this.monitor);
        this.monitor = null;
    }

    _later(fn, ms = this.o.latency) {
        setTimeout(() => { if (!this.closed) fn(); }, ms);
    }

    _emit(str) {
        const { chunk, latency } = this.o;
        for (let i = 0; i < str.length; i += chunk) {
            const part = str.slice(i, i + chunk);
            this._later(() => this.onData?.(part), latency);
        }
    }

    _reply(...lines) {
        this._emit(`${lines.join('\r')}\r\r>`);
    }

    _process(line) {
        if (!line) { this._emit('>'); return; }
        if (this.echo) this._emit(`${line}\r`);
        if (line.startsWith('AT')) this._at(line.slice(2));
        else if (/^[0-9A-F]+$/.test(line)) this._tx(line);
        else this._reply('?');
    }

    _at(c) {
        const ok = () => this._reply('OK');
        const bad = () => this._reply('?');
        const arg = (p) => parseInt(c.slice(p.length), 16);

        if (c === 'Z') {
            this._reset();
            this._later(() => this._emit('\r\rELM327 v2.1\r\r>'), 300 * this.o.timeScale);
            return;
        }
        if (c === 'E0') { this.echo = false; return ok(); }
        if (c === 'E1') { this.echo = true; return ok(); }
        if (c === 'H1') { this.headers = true; return ok(); }
        if (c === 'I') return this._reply('ELM327 v2.1');
        if (c === 'RV') return this._reply('12.7V');
        if (c === 'CFC0') { this.cfc = false; return ok(); }
        if (c === 'CFC1') { this.cfc = true; return ok(); }
        if (c === 'STFF') { this.longWait = true; return ok(); }
        if (c === 'ST32') { this.longWait = false; return ok(); }
        if (['L0', 'S0', 'SP6', 'AT0', 'AT1', 'CAF0', 'AL'].includes(c)) return ok();
        if (c === 'MA') { this._startMonitor(); return undefined; }
        if (c.startsWith('SH')) { this.txId = arg('SH'); return ok(); }
        if (c.startsWith('CRA')) { this.filter = { id: arg('CRA'), mask: 0x7FF }; return ok(); }
        if (c.startsWith('CF') && !c.startsWith('CFC')) {
            if (this.o.noMask) return bad();
            this.filter = { id: arg('CF'), mask: this.filter?.mask ?? 0x7FF };
            return ok();
        }
        if (c.startsWith('CM')) {
            if (this.o.noMask) return bad();
            this.filter = { id: this.filter?.id ?? 0, mask: arg('CM') };
            return ok();
        }
        if (c.startsWith('FCSH')) {
            if (this.o.noFcs) return bad();
            this.fcsh = arg('FCSH');
            return ok();
        }
        if (c.startsWith('FCSD')) {
            if (this.o.noFcs) return bad();
            this.fcsd = c.slice(4);
            return ok();
        }
        if (c.startsWith('FCSM')) {
            if (this.o.noFcs) return bad();
            this.fcsm = arg('FCSM');
            return ok();
        }
        return bad();
    }

    _passes(id) {
        return !this.filter || (id & this.filter.mask) === (this.filter.id & this.filter.mask);
    }

    _tx(hexText) {
        const bytes = [];
        for (let i = 0; i + 1 < hexText.length; i += 2) bytes.push(parseInt(hexText.substr(i, 2), 16));

        if (bytes[0] >> 4 === 3) return this._flowControl(bytes);

        this.vehicle.step();
        this.requests.push(hexText);
        if (!this.vehicle.awake) return this._reply('NO DATA');

        const payload = bytes.slice(1, 1 + bytes[0]);
        const resp = ECU_RESP[this.txId];
        if (this.txId === this.o.slowEcu && !this.longWait) {
            return this._reply(`${hex(resp, 3)}037F${hex(payload[0])}7800000000`);
        }
        const answer = resp ? this.vehicle.uds(this.txId, payload) : null;
        if (!answer || !this._passes(resp)) return this._reply('NO DATA');

        return this._answer(resp, answer);
    }

    _answer(resp, payload) {
        const id = hex(resp, 3);
        if (payload.length <= 7) {
            const f = [payload.length, ...payload, ...new Array(7 - payload.length).fill(0)];
            return this._reply(`${id}${hexBytes(f)}`);
        }
        const ff = [0x10 | (payload.length >> 8), payload.length & 0xFF, ...payload.slice(0, 6)];
        const rest = payload.slice(6);
        const cfs = [];
        for (let i = 0, seq = 1; i < rest.length; i += 7, seq = (seq + 1) & 0xF) {
            const body = rest.slice(i, i + 7);
            cfs.push([0x20 | seq, ...body, ...new Array(7 - body.length).fill(0)]);
        }
        const lines = [`${id}${hexBytes(ff)}`];

        const autoFc = this.cfc && this.fcsm === 1 && this.fcsh === this.txId && !this.o.shortFcIgnored;
        if (!autoFc) {
            this.pending = { id, cfs, next: 0 };
            return this._reply(...lines);
        }

        const st = parseInt(this.fcsd.slice(4, 6), 16);
        if (this.o.bufferBelow && st < this.o.bufferBelow) {
            for (const cf of cfs.slice(0, 12)) lines.push(`${id}${hexBytes(cf)}`);
            return this._reply(...lines, 'BUFFER FULL');
        }
        for (const cf of cfs) lines.push(`${id}${hexBytes(cf)}`);
        const paced = st * cfs.length * this.o.timeScale;
        this._later(() => this._reply(...lines), paced);
        return undefined;
    }

    _flowControl(fc) {
        const p = this.pending;
        if (!p) return this._reply('NO DATA');
        const bs = fc[1];
        const lines = [];
        const count = bs || (this.o.oneCfPerFc ? 1 : p.cfs.length);
        for (let i = 0; i < count && p.next < p.cfs.length; i++) {
            lines.push(`${p.id}${hexBytes(p.cfs[p.next++])}`);
        }
        // При BS=0 ECU шле далі, а ELM уже не слухає: решта втрачена.
        if (p.next >= p.cfs.length || !bs) this.pending = null;
        return this._reply(...(lines.length ? lines : ['NO DATA']));
    }

    _startMonitor() {
        if (!this.vehicle.awake) {
            this.monitor = setInterval(() => {}, 1000);
            return;
        }
        const due = new Map(Object.keys(STREAM_PERIODS).map((k) => [Number(k), 0]));
        let sent = 0;
        this.monitor = setInterval(() => {
            const now = Date.now();
            this.vehicle.step();
            for (const [id, at] of due) {
                if (now < at || !this._passes(id)) continue;
                due.set(id, now + STREAM_PERIODS[id]);
                this._emit(`${hex(id, 3)}${hexBytes(this.vehicle.frame(id))}\r`);
                if (++sent === this.o.monitorOverflow) {
                    clearInterval(this.monitor);
                    this.monitor = null;
                    this._emit('BUFFER FULL\r\r>');
                    return;
                }
            }
        }, 10);
    }

    _stopMonitor() {
        clearInterval(this.monitor);
        this.monitor = null;
        this._emit('STOPPED\r\r>');
    }
}
