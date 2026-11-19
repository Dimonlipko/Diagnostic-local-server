// --- js/core/elm.js ---
// Драйвер ELM327 поверх будь-якого транспорту { write(text), onData, close() }.
//
// Режим — той, що працює в CanZE: ATCAF0 (PCI і доповнення до 8 байт додаємо самі,
// ATMA віддає сирі кадри) + свій FlowControl через ATFCSM1. Адаптер відповідає на
// First Frame сам, без подорожі через BLE, тож 400 байт комірок приходять за ~1 с.
// Якщо ECU на такий FC мовчить (клон шле короткий кадр), переходимо на ручний FC
// із 8-байтовим кадром — це спосіб, перевірений у Diagnostic-local-server.

import { IsoTpRx, classifyLine, parseFrame, toHex } from './isotp.js';
import { maskFor } from '../proto/frames.js';

const hex3 = (v) => v.toString(16).toUpperCase().padStart(3, '0');
const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// STmin ED_BMSdiag (0x14 = 20 мс) відпрацьовано на справжніх BMS. Далі — лише вгору:
// BUFFER FULL означає, що BLE не встигає за шиною.
const STMIN_STEPS = [0x14, 0x1E, 0x28, 0x3C];

const CLEAR_ALL = [0x14, 0xFF, 0xFF, 0xFF];     // ClearDiagnosticInformation
const CLEAR_LBC = [0x31, 0x01, 0xE0, 0x14];     // міст: routine E014 → LBC 14 FF FF FF
const CLEAR_TIMEOUT = 5000;

// Налаштування моста: 2E FD10+i, лише в extended-сесії (firmware/bridge/include/uds.h).
const SESSION_EXTENDED = [0x10, 0x03];
const SETTING_DID_FIRST = 0xFD10;
const SETTING_DID_LAST = 0xFD2F;
const SETTING_TIMEOUT = 3000;

const AT_TIMEOUT = 1200;
const DEFAULT_UDS_TIMEOUT = 1500;
// У фоновій вкладці Chrome запускає таймери раз на секунду, тож запас має це покривати.
const STOP_TIMEOUT = 1800;

// uds() лише читає. Перевірка на рівні драйвера, а не UI: жоден екран, консоль чи
// майбутній код не зможе відправити через нього запис, routine чи перепрошивку.
// Винятки — clearDtc() і writeBridgeSetting() нижче, обидва з фіксованим форматом.
const READ_ONLY = [
    (b) => b[0] === 0x22,                                  // ReadDataByIdentifier
    (b) => b[0] === 0x19,                                  // ReadDTCInformation
    (b) => b[0] === 0x3E,                                  // TesterPresent
    (b) => b[0] === 0x10 && (b[1] === 0x01 || b[1] === 0x03),  // default / extended
];

export class ElmError extends Error {
    constructor(kind, message) {
        super(message);
        this.kind = kind;    // timeout | nodata | nrc | bus | partial | reset | denied
    }
}

export class Elm {
    /**
     * @param {{write: function(string): Promise, onData: function, close: function}} transport
     * @param {{log?: function(string, string), onReset?: function}} [opts]
     */
    constructor(transport, opts = {}) {
        this.t = transport;
        this.log = opts.log ?? (() => {});
        this.onReset = opts.onReset ?? (() => {});
        this.buf = '';
        this.wait = null;
        this.chain = Promise.resolve();
        this.txId = null;
        this.filter = null;
        this.stIndex = 0;
        this.fcMode = 'auto';     // auto | manual
        this.manualBs = 0;        // 0: один FC на всю відповідь; 1: FC на кожен CF
        this.useMask = true;
        this.slowWait = false;
        this.version = '';
        this.stats = { frames: 0, requests: 0, bytes: 0, lastRtt: 0 };
        transport.onData = (text) => this._rx(text);
    }

    get stMin() { return STMIN_STEPS[this.stIndex]; }

    // Усі операції йдуть по одній: ELM приймає наступну команду лише після '>'.
    // Команда поверх зайнятого адаптера на клонах дає ERR9x і внутрішній ресет.
    _exclusive(fn) {
        const run = () => fn();
        const next = this.chain.then(run, run);
        this.chain = next.catch(() => {});
        return next;
    }

    _rx(text) {
        this.stats.bytes += text.length;
        this.buf += text.replace(/\0/g, '');
        let i;
        while ((i = this.buf.search(/[\r\n>]/)) >= 0) {
            const ch = this.buf[i];
            const line = this.buf.slice(0, i).trim();
            this.buf = this.buf.slice(i + 1);
            if (line) this._line(line);
            if (ch === '>') this._prompt();
        }
    }

    _line(line) {
        this.log('rx', line);
        const w = this.wait;
        if (!w) {
            // Адаптер заговорив сам: це банер після ресету живлення.
            if (classifyLine(line) === 'reset') this.onReset(line);
            return;
        }
        w.lines.push(line);
        w.onLine?.(line);
    }

    _prompt() {
        const w = this.wait;
        if (!w) return;
        this.wait = null;
        clearTimeout(w.timer);
        w.resolve(w.lines);
    }

    _send(text, timeout, onLine) {
        return new Promise((resolve, reject) => {
            const timer = setTimeout(() => {
                this.wait = null;
                reject(new ElmError('timeout', `немає '>' на ${text}`));
            }, timeout);
            this.wait = { lines: [], resolve, onLine, timer };
            this.buf = '';
            this.log('tx', text);
            Promise.resolve(this.t.write(`${text}\r`)).catch((e) => {
                clearTimeout(timer);
                this.wait = null;
                reject(new ElmError('timeout', e.message));
            });
        });
    }

    async _at(cmd, timeout = AT_TIMEOUT) {
        const lines = await this._send(cmd, timeout);
        const bad = lines.some((l) => l.trim() === '?');
        return { ok: !bad, lines };
    }

    async _atOk(cmd) {
        const r = await this._at(cmd);
        if (!r.ok) throw new ElmError('reset', `адаптер не прийняв ${cmd}`);
        return r;
    }

    /** Повна ініціалізація. Викликається при підключенні й після ресету адаптера. */
    init(progress = () => {}) {
        return this._exclusive(async () => {
            this.txId = null;
            this.filter = null;
            progress('Скидання адаптера');
            await this._at('ATZ', 3000).catch(() => {});
            await sleep(200);
            await this._at('ATE0').catch(() => {});

            progress('Налаштування ELM327');
            for (const cmd of ['ATL0', 'ATS0', 'ATH1', 'ATSP6', 'ATAT1', 'ATST32', 'ATCAF0', 'ATAL']) {
                await this._at(cmd);
            }
            const ver = await this._at('ATI');
            this.version = ver.lines.find((l) => /ELM|STN|OBD/i.test(l)) ?? ver.lines[0] ?? '';

            await this._configureFlowControl('7E7');

            // Частина клонів не знає ATCF/ATCM; тоді лише ATCRA і кадри по одному ID.
            this.useMask = (await this._at('ATCF7EF')).ok && (await this._at('ATCM7FF')).ok;
            if (!this.useMask) await this._atOk('ATCRA7EF');
            this.filter = { id: 0x7EF, mask: 0x7FF };

            await this._atOk('ATSH7E7');
            this.txId = 0x7E7;
        });
    }

    async _configureFlowControl(txHex) {
        const fc = [
            `ATFCSH${txHex}`,
            `ATFCSD3000${hex2(this.stMin)}`,
            'ATFCSM1',
        ];
        for (const cmd of fc) {
            if (!(await this._at(cmd)).ok) {
                this.fcMode = 'manual';
                this.log('info', 'адаптер не вміє ATFCS*, ручний FlowControl');
                break;
            }
        }
        // ATZ повертає ATCFC1. Якби адаптер теж слав FC, ECU отримав би два поспіль.
        if (this.fcMode === 'manual') await this._at('ATCFC0');
    }

    async _select(ecu) {
        if (this.txId !== ecu.req) {
            await this._atOk(`ATSH${hex3(ecu.req)}`);
            if (this.fcMode === 'auto') await this._atOk(`ATFCSH${hex3(ecu.req)}`);
            this.txId = ecu.req;
        }
        await this._setFilter(ecu.resp, 0x7FF);
    }

    async _setFilter(id, mask) {
        if (this.filter?.id === id && this.filter?.mask === mask) return;
        if (this.useMask) {
            // Кожна команда — окремий обмін через BLE, тож шлемо лише те, що змінилось.
            if (this.filter?.id !== id) await this._atOk(`ATCF${hex3(id)}`);
            if (this.filter?.mask !== mask) await this._atOk(`ATCM${hex3(mask)}`);
        } else {
            await this._atOk(`ATCRA${hex3(id)}`);
        }
        this.filter = { id, mask };
    }

    /**
     * Один UDS-запит. Повертає відповідь від 0x62/0x59/… або кидає ElmError.
     * @param {{req:number, resp:number}} ecu
     * @param {number[]|Uint8Array} bytes  сервіс + параметри, ≤ 7 байт
     */
    uds(ecu, bytes, { timeout = DEFAULT_UDS_TIMEOUT } = {}) {
        if (!READ_ONLY.some((ok) => ok(bytes))) {
            return Promise.reject(new ElmError('denied', `запит ${toHex(bytes)} не є читанням`));
        }
        return this._request(ecu, bytes, timeout);
    }

    /**
     * Стирає всі коди блока. Результат перевіряється новим читанням, не тут.
     * @param {{req:number, resp:number}} ecu
     * @param {{lbc?: boolean}} [o]  коди LBC за мостом замість кодів самого блока
     */
    async clearDtc(ecu, { lbc = false } = {}) {
        const r = await this._request(ecu, lbc ? CLEAR_LBC : CLEAR_ALL, CLEAR_TIMEOUT);
        const expected = lbc ? 0x71 : 0x54;
        if (r[0] !== expected) throw new ElmError('partial', `неочікувана відповідь ${toHex(r)}`);
    }

    /**
     * Записує одне налаштування моста Twingo. Лише BMS-адреса моста й діапазон
     * FD10…FD2F; значення — до 4 цифр або індекс варіанта < 0x20 (BOOL/ENUM), тож
     * запит завжди вміщається в один кадр. Діапазон перевіряє міст (7F 2E 31).
     * Результат перевіряється новим читанням, не тут.
     * @param {{req:number, resp:number}} ecu  ECU.BMS
     * @param {number} index  позиція ключа у списку 22 FD02
     * @param {string|number} value  '4100' або індекс варіанта
     */
    async writeBridgeSetting(ecu, index, value) {
        const did = SETTING_DID_FIRST + index;
        if (ecu.req !== 0x7E7 || !Number.isInteger(index) || index < 0 || did > SETTING_DID_LAST) {
            throw new ElmError('denied', `налаштування ${index} поза FD10…FD2F`);
        }
        let data;
        if (typeof value === 'number') {
            if (!Number.isInteger(value) || value < 0 || value >= 0x20) throw new ElmError('denied', `індекс ${value}`);
            data = [value];
        } else {
            if (!/^\d{1,4}$/.test(value)) throw new ElmError('denied', `значення «${value}»`);
            data = [...value].map((c) => c.charCodeAt(0));
        }
        const s = await this._request(ecu, SESSION_EXTENDED, DEFAULT_UDS_TIMEOUT);
        if (s[0] !== 0x50) throw new ElmError('partial', `неочікувана відповідь ${toHex(s)}`);
        const r = await this._request(ecu, [0x2E, did >> 8, did & 0xFF, ...data], SETTING_TIMEOUT);
        if (r[0] !== 0x6E) throw new ElmError('partial', `неочікувана відповідь ${toHex(r)}`);
    }

    _request(ecu, bytes, timeout) {
        return this._exclusive(async () => {
            await this._select(ecu);
            const t0 = Date.now();
            let result = null;
            try {
                for (let attempt = 0; attempt < 3 && !result; attempt++) {
                    result = await this._transact(ecu, bytes, timeout);
                }
            } finally {
                await this._patient(false);
            }
            this.stats.requests++;
            this.stats.lastRtt = Date.now() - t0;
            if (!result) throw new ElmError('partial', 'відповідь неповна після повторів');
            return result;
        });
    }

    // Адаптивний таймінг ELM стискає очікування під швидкі відповіді, і після 7F xx 78
    // адаптер віддає '>' раніше, ніж ECU закінчить. Цей запит чекаємо повну секунду.
    async _patient(on) {
        if (this.slowWait === on) return;
        this.slowWait = on;
        await this._at(on ? 'ATAT0' : 'ATAT1');
        await this._at(on ? 'ATSTFF' : 'ATST32');
    }

    // null = варто повторити (режим уже підкоригований).
    async _transact(ecu, bytes, timeout) {
        const frame = new Uint8Array(8);
        frame[0] = bytes.length;
        frame.set(bytes, 1);

        const rx = new IsoTpRx(ecu.resp);
        const state = await this._collect(toHex(frame), timeout, rx);

        if (rx.nrc) throw this._nrc(rx.nrc);
        if (rx.payload) return rx.payload;
        if (state.reset) throw new ElmError('reset', 'адаптер перезавантажився');

        if (state.buffer) {
            if (this.stIndex + 1 < STMIN_STEPS.length) {
                this.stIndex++;
                if (this.fcMode === 'auto') await this._atOk(`ATFCSD3000${hex2(this.stMin)}`);
                this.log('info', `BUFFER FULL → STmin ${this.stMin} мс`);
                return null;
            }
            throw new ElmError('partial', 'BUFFER FULL на найбільшому STmin');
        }

        if (rx.started) {
            if (this.fcMode === 'auto' && rx.cfCount === 0) {
                // First Frame прийшов, а CF ні: ECU не прийняв FC від адаптера.
                this.fcMode = 'manual';
                await this._at('ATCFC0');
                this.log('info', 'FC адаптера не діє, ручний FlowControl');
                return null;
            }
            if (this.fcMode === 'manual') return this._manualFlow(rx, timeout);
            return null;
        }

        if (rx.pending) {
            await this._patient(true);
            return null;
        }
        if (state.bus) throw new ElmError('bus', 'адаптер не бачить шину');
        throw new ElmError('nodata', 'ECU не відповів');
    }

    async _manualFlow(rx, timeout) {
        const deadline = Date.now() + timeout;
        while (!rx.done && Date.now() < deadline) {
            const before = rx.have;
            const fc = `30${hex2(this.manualBs)}${hex2(this.manualBs ? 0 : this.stMin)}0000000000`;
            await this._collect(fc, timeout, rx);
            if (rx.broken || (this.manualBs === 0 && !rx.done)) {
                if (this.manualBs === 0) {
                    // ELM замовк посеред відповіді. Ping-pong повільний, але надійний.
                    this.manualBs = 1;
                    this.log('info', 'FC BS=0 рветься, переходимо на BS=1');
                }
                return null;
            }
            if (rx.have === before) break;
        }
        if (rx.nrc) throw this._nrc(rx.nrc);
        return rx.payload;
    }

    async _collect(text, timeout, rx) {
        const state = { buffer: false, bus: false, reset: false };
        const lines = await this._send(text, timeout);
        for (const line of lines) {
            const f = parseFrame(line);
            if (f) { rx.push(f); continue; }
            switch (classifyLine(line)) {
                case 'buffer': state.buffer = true; break;
                case 'bus': state.bus = true; break;
                case 'reset': case 'echo': state.reset = true; break;
                default: break;
            }
        }
        return state;
    }

    _nrc({ sid, code }) {
        const e = new ElmError('nrc', `NRC ${hex2(code)} на сервіс ${hex2(sid)}`);
        e.nrc = code;
        return e;
    }

    /**
     * Слухає шину через ATMA, доки не побачить усі `ids` або не вийде вікно.
     * @returns {{seen:Set<number>, overflow:boolean}}
     */
    monitor(ids, windowMs, onFrame) {
        const { id, mask } = maskFor(ids);
        const single = ids.length === 1 || !this.useMask;
        return this.listen(single ? ids[0] : id, single ? 0x7FF : mask, windowMs, onFrame, ids);
    }

    /** ATMA з довільною маскою. Без `ids` слухає все вікно. */
    listen(id, mask, windowMs, onFrame, ids = []) {
        return this._exclusive(async () => {
            await this._setFilter(id, mask);

            const seen = new Set();
            let overflow = false;
            let stopped = false;
            let timer = null;

            const stop = () => {
                if (stopped) return;
                stopped = true;
                clearTimeout(timer);
                // Будь-який символ перериває ATMA; '\r' не шлемо: він повторив би команду.
                Promise.resolve(this.t.write('x')).catch(() => {});
            };

            const onLine = (line) => {
                const f = parseFrame(line);
                if (f) {
                    this.stats.frames++;
                    onFrame(f.id, f.data);
                    if (ids.includes(f.id)) seen.add(f.id);
                    if (ids.length && seen.size === ids.length) stop();
                } else if (classifyLine(line) === 'buffer') {
                    // ELM уже зупинився сам. Символ зупинки лишився б у його вводі
                    // й перетворив наступну команду на '?'.
                    overflow = true;
                    stopped = true;
                    clearTimeout(timer);
                }
            };

            const done = this._send('ATMA', windowMs + STOP_TIMEOUT, onLine);
            timer = setTimeout(stop, windowMs);
            try {
                await done;
            } finally {
                clearTimeout(timer);
            }
            return { seen, overflow };
        });
    }

    /** Напруга на OBD-роз'ємі. Вимірює сам адаптер, тож працює і при сплячій шині. */
    voltage() {
        return this._exclusive(async () => {
            const { lines } = await this._at('ATRV');
            const m = /([\d.]+)\s*V?/i.exec(lines.join(' '));
            return m ? parseFloat(m[1]) : null;
        });
    }

    async close() {
        await this.t.close?.();
    }
}
