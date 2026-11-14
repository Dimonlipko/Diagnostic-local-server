// --- js/core/ble.js ---
// Транспорт Web Bluetooth для ELM327. Розвідка GATT перенесена з
// Diagnostic-local-server/modules/webBluetooth.js, де вона відпрацьована на клонах.

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

// Web Bluetooth віддає лише сервіси, перелічені тут або у filters, тож список повний.
const KNOWN_SERVICES = [
    0xFFF0,                                   // vLinker, більшість дешевих клонів
    0xFFE0,                                   // HM-10 / Vgate iCar Pro BLE
    0xFFE5,                                   // HM-10 із роздільним write-сервісом
    0x18F0,                                   // частина OBDII BLE модулів
    0xFEE7,                                   // Telink-клони
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e',   // Nordic UART Service
];

// Дешеві клони часто не кладуть UUID сервісу в рекламу, тож фільтр за сервісами їх
// не бачить. Для них шукаємо ще й за початком назви.
const NAME_PREFIXES = ['OBD', 'ELM', 'Vgate', 'vLink', 'V-LINK', 'IOS-Vlink', 'Android-Vlink',
    'VEEPEAK', 'LELink', 'KONNWEI', 'Viecar', 'iCar', 'Carista'];

// Порядок перебору на запис: спершу канонічні UART-характеристики.
const WRITE_PREFERENCE = ['fff2', 'ffe1', 'ffe9', '2af1', 'fff1', '6e400002'];

// Поки обрана notify говорить, пакети з інших вважаються дублями того ж UART.
const RX_STICKY_MS = 2000;
const MTU_PAYLOAD = 20;

const shortUuid = (ch) => (ch.uuid.startsWith('0000') ? ch.uuid.slice(4, 8) : ch.uuid.split('-')[0]);

export class BleTransport {
    static get available() {
        return typeof navigator !== 'undefined' && !!navigator.bluetooth;
    }

    /** Показує вибір пристрою; виклик лише з обробника кліку. */
    static async pick(log, { all = false } = {}) {
        const device = await navigator.bluetooth.requestDevice(all
            ? { acceptAllDevices: true, optionalServices: KNOWN_SERVICES }
            : {
                filters: [
                    ...KNOWN_SERVICES.map((s) => ({ services: [s] })),
                    ...NAME_PREFIXES.map((namePrefix) => ({ namePrefix })),
                ],
                optionalServices: KNOWN_SERVICES,
            });
        const t = new BleTransport(device, log);
        await t.open();
        return t;
    }

    constructor(device, log = () => {}) {
        this.device = device;
        this.log = log;
        this.onData = null;
        this.onClose = null;
        this.write = this.write.bind(this);
        this.channel = null;
        this.rxChar = null;
        this.lastRxAt = 0;
        this.probe = null;
        this.intentional = false;
        this.decoder = new TextDecoder();
        this._disconnected = () => {
            if (!this.intentional) this.onClose?.();
        };
        device.addEventListener('gattserverdisconnected', this._disconnected);
    }

    get name() { return this.device.name ?? 'BLE'; }

    async open() {
        this.channel = null;
        this.rxChar = null;
        const server = await this.device.gatt.connect();

        // Різні ревізії клонів кладуть UART на різні сервіси й міняють місцями
        // notify/write, тому профіль визначаємо, а не припускаємо.
        const services = await server.getPrimaryServices();
        const chars = [];
        for (const svc of services) chars.push(...await svc.getCharacteristics());
        this.log(`GATT: ${services.length} сервісів, ${chars.length} характеристик`);

        const notify = chars.filter((c) => c.properties.notify || c.properties.indicate);
        if (!notify.length) throw new Error('немає характеристики з notify — це не UART-профіль');

        const candidates = [];
        for (const ch of chars) {
            if (ch.properties.writeWithoutResponse) candidates.push({ char: ch, mode: 'writeNR' });
            if (ch.properties.write) candidates.push({ char: ch, mode: 'write' });
        }
        if (!candidates.length) throw new Error('немає характеристики для запису');
        const rank = (c) => {
            const i = WRITE_PREFERENCE.indexOf(shortUuid(c.char));
            return i < 0 ? 99 : i;
        };
        candidates.sort((a, b) => rank(a) - rank(b));

        // Слухаємо всі notify: stopNotifications() на клонах гасить CCCD назавжди.
        let active = null;
        const onValue = (event) => {
            const ch = event.target;
            if (this.rxChar && ch !== this.rxChar) {
                if (Date.now() - this.lastRxAt < RX_STICKY_MS) return;
                this.rxChar = ch;
            }
            this.lastRxAt = Date.now();
            active = ch;
            const text = this.decoder.decode(ch.value);
            if (this.probe !== null) this.probe += text;
            else this.onData?.(text);
        };
        for (const ch of notify) {
            await ch.startNotifications();
            ch.addEventListener('characteristicvaluechanged', onValue);
        }
        await sleep(500);   // GATT стабілізується не миттєво

        let chosen = null;
        for (let pass = 0; pass < 2 && !chosen; pass++) {
            if (pass) await sleep(1000);   // частина клонів прокидається із запізненням
            for (const c of candidates) {
                if (await this._probe(c)) {
                    chosen = c;
                    break;
                }
                await sleep(150);
            }
        }
        if (!chosen) throw new Error('жодна характеристика не відповіла на ATI');
        this.log(`канал: ${shortUuid(chosen.char)} ${chosen.mode}`);

        this.channel = chosen;
        if (active && notify.length > 1) {
            this.rxChar = active;
            this.lastRxAt = Date.now();
        }
    }

    async _probe(candidate) {
        this.probe = '';
        try {
            await this._raw(candidate, 'ATI\r');
        } catch {
            this.probe = null;
            return false;
        }
        const deadline = Date.now() + 1500;
        while (Date.now() < deadline && !this.probe.includes('>')) await sleep(50);
        const heard = this.probe.trim().length > 0;
        this.probe = null;
        return heard;
    }

    // MTU за замовчуванням 23 байти, 20 корисних.
    async _raw(c, text) {
        const data = new TextEncoder().encode(text);
        for (let i = 0; i < data.length; i += MTU_PAYLOAD) {
            const part = data.slice(i, i + MTU_PAYLOAD);
            if (c.mode === 'writeNR') await c.char.writeValueWithoutResponse(part);
            else await c.char.writeValueWithResponse(part);
            if (data.length > MTU_PAYLOAD) await sleep(10);
        }
    }

    async write(text) {
        if (!this.channel) throw new Error('канал не відкрито');
        // GATT busy на клонах минає за частки секунди
        for (let left = 3; ; left--) {
            try {
                return await this._raw(this.channel, text);
            } catch (e) {
                if (left <= 1 || !this.device.gatt.connected) throw e;
                await sleep(150);
            }
        }
    }

    async close() {
        this.intentional = true;
        this.device.removeEventListener('gattserverdisconnected', this._disconnected);
        if (this.device.gatt.connected) this.device.gatt.disconnect();
    }
}
