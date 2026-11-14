// --- js/core/scheduler.js ---
// Один цикл на адаптер: чергує UDS-опитування активної сторінки з вікнами ATMA.
// ELM327 не вміє робити це одночасно, тож пропускна здатність — спільний бюджет.

import { ECU, POLLS } from '../proto/dids.js';
import { STREAM_GROUPS, decodeFrame } from '../proto/frames.js';

const MONITOR_WINDOW_MS = 220;
const POLLS_PER_TURN = 2;
const ADAPTER_VOLTAGE_MS = 10000;
const MAX_TIMEOUTS = 3;

// Умови, за яких опитувати далі немає сенсу: DID або сервіс не існує.
const NRC_UNSUPPORTED = new Set([0x11, 0x12, 0x31]);
const BACKOFF_SILENT = 4;      // ECU мовчить: шина спить або блоку немає
// CEPC читається і в default-сесії; extended лише якщо він відмовив і користувач дозволив.
const NRC_NEEDS_SESSION = new Set([0x22, 0x33, 0x7E, 0x7F]);
const TESTER_PRESENT_MS = 2500;

// Вага групи = скільки разів вона трапляється в кільці. Важчі групи рівномірно
// розкидані, а не йдуть підряд: інакше швидкі значення оновлювались би ривками.
function interleave(groups) {
    const left = new Map(groups.map((g) => [g, STREAM_GROUPS[g].weight]));
    const ring = [];
    while ([...left.values()].some((n) => n > 0)) {
        for (const g of groups) {
            if (left.get(g) > 0) {
                ring.push(g);
                left.set(g, left.get(g) - 1);
            }
        }
    }
    return ring;
}

export class Scheduler {
    constructor(elm, store, opts = {}) {
        this.elm = elm;
        this.store = store;
        this.onLink = opts.onLink ?? (() => {});
        this.running = false;
        this.loopId = 0;
        this.groups = [];
        this.polls = [];
        this.periods = new Map();
        this.next = new Map();         // poll → час наступного запуску
        this.retired = new Set();       // більше не опитуємо: нема такого DID або once
        this.ring = [];
        this.ringPos = 0;
        this.split = new Set();        // групи, що переповнили буфер: далі по одному ID
        this.bridge = false;
        this.nextVoltage = 0;
        this.timeouts = 0;
        this.silentFrames = 0;
        this.jobs = [];
        this.allowExtended = false;    // перемикач на сторінці CEPC
        this.extended = false;
        this.nextTesterPresent = 0;
    }

    /** Що потрібно поточній сторінці. */
    plan({ groups = [], polls = [] }) {
        this.groups = groups;
        // Елемент — ключ або [ключ, період]: важке читання на чужій сторінці рідше.
        this.periods = new Map(polls.filter(Array.isArray));
        this.polls = polls.map((p) => (Array.isArray(p) ? p[0] : p))
            .filter((p) => POLLS[p] && (!POLLS[p].bridge || this.bridge));
        this.ring = interleave(groups);
        this.ringPos = 0;
        const now = Date.now();
        for (const p of this.polls) if (!this.next.has(p) || this.next.get(p) > now + 500) this.next.set(p, now);
    }

    /** Адаптер перезавантажився сам: конфігурація втрачена, налаштовуємо наново. */
    requestReinit() {
        this.run((elm) => elm.init()).catch(() => {});
    }

    /** Разова робота в черзі циклу, щоб не боротися з ним за адаптер. */
    run(job) {
        return new Promise((resolve, reject) => {
            this.jobs.push({ job, resolve, reject });
        });
    }

    start() {
        if (this.running) return;
        this.running = true;
        this._loop(++this.loopId);
    }

    stop() {
        this.running = false;
        for (const j of this.jobs.splice(0)) j.reject(new Error('зʼєднання закрито'));
    }

    // id захищає від двох циклів: після перепідключення старий ще може чекати таймаут.
    async _loop(id) {
        while (this.running && id === this.loopId) {
            try {
                await this._turn();
                this.timeouts = 0;
            } catch (e) {
                if (!this.running) return;
                await this._recover(e);
            }
        }
    }

    async _turn() {
        const before = this.elm.stats.frames + this.elm.stats.requests;

        while (this.jobs.length) {
            const j = this.jobs.shift();
            try {
                j.resolve(await j.job(this.elm));
            } catch (e) {
                j.reject(e);
            }
        }

        await this._adapterVoltage();
        await this._keepSession();

        let done = 0;
        for (const p of this._duePolls()) {
            if (done++ >= POLLS_PER_TURN) break;
            await this._poll(p);
        }

        if (this.ring.length) await this._streamStep();

        if (this.elm.stats.frames + this.elm.stats.requests === before) {
            await new Promise((r) => setTimeout(r, 80));
        }
    }

    _duePolls() {
        const now = Date.now();
        // Спершу найбільше прострочені відносно свого періоду. Групуємо за ECU:
        // перемикання адреси коштує кілька AT-команд через BLE.
        return this.polls
            .filter((p) => !this.retired.has(p) && (this.next.get(p) ?? 0) <= now)
            .sort((a, b) => POLLS[a].ecu.localeCompare(POLLS[b].ecu)
                || (this.next.get(a) ?? 0) - (this.next.get(b) ?? 0));
    }

    async _poll(key) {
        const def = POLLS[key];
        const every = this.periods.get(key) ?? def.every ?? Infinity;
        this.next.set(key, Date.now() + every);
        try {
            const did = [0x22, def.did >> 8, def.did & 0xFF];
            const resp = await this.elm.uds(ECU[def.ecu], did, { timeout: def.timeout });
            // Між опитуваннями значення живе ~2.5 періоди, разове — поки є зв'язок.
            const ttl = Number.isFinite(every) ? every * 2.5 : Infinity;
            def.apply(resp, (k, v) => this.store.set(k, v, ttl), this.store.get);
            this.store.noteDid(key, true, 'ok');
            this.onLink('uds');
            if (def.once) this.retired.add(key);
        } catch (e) {
            await this._pollFailed(key, def, e);
        }
    }

    async _keepSession() {
        if (!this.extended || Date.now() < this.nextTesterPresent) return;
        this.nextTesterPresent = Date.now() + TESTER_PRESENT_MS;
        try {
            await this.elm.uds(ECU.CEPC, [0x3E, 0x00], { timeout: 500 });
        } catch {
            this.extended = false;
        }
    }

    // Лише на стоянці: extended-сесія блоку приводу в русі — непотрібний ризик.
    async _tryExtended() {
        if (this.extended || !this.allowExtended || (this.store.get('speed') ?? 0) > 0) return false;
        await this.elm.uds(ECU.CEPC, [0x10, 0x03], { timeout: 1000 });
        this.extended = true;
        return true;
    }

    async _pollFailed(key, def, e) {
        if (e.kind === 'nrc') {
            this.store.noteDid(key, false, e.message);
            if (def.ecu === 'CEPC' && NRC_NEEDS_SESSION.has(e.nrc) && await this._tryExtended()) {
                this.next.set(key, 0);
                return;
            }
            if (NRC_UNSUPPORTED.has(e.nrc)) this.retired.add(key);
            return;
        }
        if (e.kind === 'nodata' || e.kind === 'bus' || e.kind === 'partial') {
            this.store.noteDid(key, false, e.message);
            this.next.set(key, Date.now() + (def.every ?? 10000) * BACKOFF_SILENT);
            this.onLink(e.kind === 'bus' ? 'bus' : 'silent');
            return;
        }
        throw e;
    }

    async _streamStep() {
        const g = this.ring[this.ringPos];
        this.ringPos = (this.ringPos + 1) % this.ring.length;

        const ids = STREAM_GROUPS[g].ids;
        const onFrame = (id, data) => {
            this.store.noteFrame(id, data);
            decodeFrame(id, data, this.store.set);
        };

        if (this.split.has(g) || !this.elm.useMask) {
            for (const id of ids) await this.elm.monitor([id], MONITOR_WINDOW_MS, onFrame);
            return;
        }

        const { seen, overflow } = await this.elm.monitor(ids, MONITOR_WINDOW_MS, onFrame);
        if (overflow) this.split.add(g);
        if (seen.size) {
            this.silentFrames = 0;
            this.onLink('frames');
        } else if (++this.silentFrames === this.ring.length) {
            this.onLink('silent');
        }
    }

    async _adapterVoltage() {
        const now = Date.now();
        if (now < this.nextVoltage) return;
        this.nextVoltage = now + ADAPTER_VOLTAGE_MS;
        const v = await this.elm.voltage();
        if (v !== null) this.store.set('obd_v', v);
    }

    async _recover(e) {
        if (e.kind !== 'reset' && ++this.timeouts < MAX_TIMEOUTS) return;
        this.timeouts = 0;
        this.onLink('recovering');
        try {
            await this.elm.init();
            this.onLink('recovered');
        } catch {
            await new Promise((r) => setTimeout(r, 2000));
        }
    }
}
