// --- js/main.js ---
import { BleTransport } from './core/ble.js';
import { Elm } from './core/elm.js';
import { Scheduler } from './core/scheduler.js';
import { SimTransport } from './core/sim.js';
import { Store } from './core/store.js';
import { Recorder } from './core/recorder.js';
import { derive } from './core/derive.js';
import { startDevLink } from './core/devlink.js';
import { ECU } from './proto/dids.js';
import { ICONS } from './ui/icons.js';
import { bindValues } from './ui/widgets.js';

import home from './pages/home.js';
import battery from './pages/battery.js';
import cells from './pages/cells.js';
import temps from './pages/temps.js';
import charge from './pages/charge.js';
import drive from './pages/drive.js';
import cepc from './pages/cepc.js';
import cool from './pages/cool.js';
import dtc, { sweep } from './pages/dtc.js';
import ident, { readVin } from './pages/ident.js';
import bus from './pages/bus.js';
import bridge from './pages/bridge.js';

const PAGES = [home, battery, cells, temps, charge, drive, cepc, cool, dtc, ident, bus, bridge];
const PAGE_ICON = { temps: 'temp' };

const UI_TICK_MS = 250;
const LOG_LINES = 300;
const RECONNECT_TRIES = 3;
// Окремий блок мовчить постійно (зарядник спить, коли заряду нема), тож «шина мовчить»
// лише тоді, коли не відповідає нічого.
const SILENCE_MS = 5000;

const LINK_TEXT = {
    connecting: 'Підключення',
    online: 'На зв\'язку',
    silent: 'Шина мовчить',
    bus: 'Немає шини',
    recovering: 'Відновлення',
    lost: 'Зв\'язок втрачено',
};

const app = {
    store: new Store(),
    elm: null,
    transport: null,
    scheduler: null,
    recorder: null,
    page: null,
    root: null,
    link: 'connecting',
    log: [],
    sim: null,
    bridgeKnown: false,
    wakeLock: null,
    timer: null,
    lastGood: 0,
    logLines: () => app.log,
};

app.recorder = new Recorder(app.store);

// Для налагодження на машині: стан драйвера й журнал доступні з консолі браузера.
window.smartDiag = app;

const $ = (sel, el = document) => el.querySelector(sel);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function logLine(dir, text) {
    const mark = { tx: '→', rx: '←', info: '·' }[dir] ?? '·';
    app.log.push(`${mark} ${text}`);
    if (app.log.length > LOG_LINES) app.log.shift();
    app.onLog?.(`${mark} ${text}`);
}

// --- екран підключення -------------------------------------------------------

function landing(message = '') {
    const supported = BleTransport.available;
    document.title = 'Smart 451 ED';
    $('#app').innerHTML = `<main class="landing">
        <div class="landing-card">
            <img class="landing-logo" src="assets/logo-mark-white.svg" alt="E-Engines" data-logo>
            <h1>Smart 451 ED</h1>
            <p class="landing-sub">Діагностика батареї й приводу через OBD: UDS-параметри та потік шини</p>
            <button type="button" class="btn btn-primary" data-ble ${supported ? '' : 'disabled'}>${ICONS.ble}Підключити ELM327</button>
            <button type="button" class="btn btn-ghost" data-demo>${ICONS.play}Демо без машини</button>
            <button type="button" class="link-btn" data-ble-all ${supported ? '' : 'hidden'}>Адаптера нема в списку? Показати всі пристрої</button>
            <p class="landing-msg" data-msg role="status"></p>
            <ol class="stages" data-stages hidden></ol>
            ${supported ? '' : `<p class="landing-note">Цей браузер не має Web Bluetooth. Потрібен Chrome або Edge на Android чи комп'ютері, сторінка має відкриватись через https або localhost.</p>`}
            <p class="landing-foot">Адаптер — ELM327 BLE, у розетці OBD, запалювання увімкнене. Застосунок читає дані; змінити може лише коди помилок, після підтвердження.</p>
        </div>
    </main>`;
    const msg = $('[data-msg]');
    msg.textContent = message;
    $('[data-ble]').addEventListener('click', () => connectBle());
    $('[data-ble-all]').addEventListener('click', () => connectBle({ all: true }));
    $('[data-demo]').addEventListener('click', () => connectDemo());
}

function stage(text) {
    const list = $('[data-stages]');
    if (!list) return;
    list.hidden = false;
    const li = document.createElement('li');
    li.textContent = text;
    list.append(li);
}

function failed(e) {
    if (e?.name === 'NotFoundError') {            // користувач закрив вибір пристрою
        landing();
        return;
    }
    landing(`Не вдалося підключитись: ${e?.message ?? e}`);
}

async function connectBle(opts = {}) {
    $('[data-msg]').textContent = '';
    try {
        stage('Пошук адаптера');
        const t = await BleTransport.pick((s) => logLine('info', s), opts);
        stage(`Підключено ${t.name}`);
        t.onClose = () => connectionLost();
        await start(t);
    } catch (e) {
        failed(e);
    }
}

async function connectDemo(opts = {}) {
    try {
        const t = new SimTransport({ scenario: 'drive', ...opts });
        t.name = 'Демо';
        app.sim = t;
        await start(t);
    } catch (e) {
        failed(e);
    }
}

async function start(transport) {
    app.transport = transport;
    app.store.clear();
    app.elm = new Elm(transport, {
        log: logLine,
        onReset: () => app.scheduler?.requestReinit(),
    });
    await app.elm.init(stage);
    stage(app.elm.version || 'ELM327');

    app.scheduler = new Scheduler(app.elm, app.store, { onLink });
    await detectBridge();

    shell();
    app.scheduler.start();
    route();
    clearInterval(app.timer);
    app.timer = setInterval(tick, UI_TICK_MS);
    keepScreenOn();
    background();
}

// Міст відповідає на FD00, заводська BMS дає 7F 22 31, спляча шина мовчить.
async function detectBridge() {
    try {
        await app.elm.uds(ECU.BMS, [0x22, 0xFD, 0x00]);
        setBridge(true);
        app.bridgeKnown = true;
    } catch (e) {
        if (e.kind === 'nrc') {
            setBridge(false);
            app.bridgeKnown = true;
        }
    }
}

function setBridge(on) {
    app.scheduler.bridge = on;
    app.store.set('is_bridge', on);
}

async function background() {
    await readVin(app).catch(() => {});
    const list = ['BMS', 'CEPC', 'LE', 'OBL', ...(app.store.get('is_bridge') ? ['LBC'] : [])];
    // Якщо вже відкрито екран помилок, він сам читає ті самі блоки.
    if (!app.store.dtcBusy) await sweep(app, list).catch(() => {});
}

function onLink(event) {
    if (event === 'uds' || event === 'frames' || event === 'recovered') {
        app.lastGood = Date.now();
        setLink('online');
        if (!app.bridgeKnown && event === 'uds') {
            app.bridgeKnown = true;
            app.scheduler.run((elm) => elm.uds(ECU.BMS, [0x22, 0xFD, 0x00]))
                .then(() => { setBridge(true); route(); }, () => setBridge(false));
        }
    } else if (event !== 'silent' || Date.now() - app.lastGood > SILENCE_MS) {
        setLink(event);
    }
}

function setLink(state) {
    if (app.link === state) return;
    app.link = state;
    const pill = $('[data-link]');
    if (!pill) return;
    pill.dataset.state = state;
    $('[data-link-text]').textContent = LINK_TEXT[state] ?? state;
}

async function connectionLost() {
    setLink('lost');
    app.scheduler.stop();
    for (let i = 1; i <= RECONNECT_TRIES; i++) {
        await sleep(1500 * i);
        try {
            await app.transport.open();
            await app.elm.init();
            app.scheduler.start();
            setLink('online');
            return;
        } catch (e) {
            logLine('info', `перепідключення: ${e.message}`);
        }
    }
    await app.disconnect('Зв\'язок із адаптером втрачено');
}

app.disconnect = async (message = '') => {
    app.scheduler?.stop();
    app.scheduler = null;
    clearInterval(app.timer);
    app.page?.unmount?.();
    app.page = null;
    app.root = null;
    await app.wakeLock?.release?.().catch(() => {});
    await app.transport?.close?.();
    app.transport = null;
    app.sim = null;
    history.replaceState(null, '', location.pathname);
    landing(message);
    syncLogos();
};

async function keepScreenOn() {
    try {
        app.wakeLock = await navigator.wakeLock?.request('screen');
    } catch { /* екран просто згасне за налаштуваннями системи */ }
}

document.addEventListener('visibilitychange', () => {
    if (!document.hidden && app.transport) keepScreenOn();
});

// --- оболонка ----------------------------------------------------------------

function shell() {
    const rail = PAGES.filter((p) => p.id !== 'bridge' || app.store.get('is_bridge'))
        .map((p) => `<a href="#/${p.id === 'home' ? '' : p.id}" data-nav="${p.id}">${ICONS[PAGE_ICON[p.id] ?? p.id]}<span>${p.title}</span></a>`)
        .join('');

    $('#app').innerHTML = `<div class="layout">
        <aside class="rail">
            <a class="brand" href="#/"><img src="assets/logo-mark-white.svg" alt="" data-logo><span>Smart<b>ED</b></span></a>
            <nav data-rail>${rail}</nav>
            <p class="rail-foot">E-Engines</p>
        </aside>
        <div class="main">
            <header class="topbar">
                <a class="icon-btn back" href="#/" aria-label="На головну" data-back>${ICONS.back}</a>
                <a class="brand brand-top" href="#/" data-brand-top><img src="assets/logo-mark-white.svg" alt="" data-logo></a>
                <h1 data-title></h1>
                <div class="link" data-link data-state="connecting"><i></i><span data-link-text>${LINK_TEXT.connecting}</span></div>
                <button type="button" class="icon-btn" data-rec aria-label="Запис у CSV" title="Запис у CSV">${ICONS.rec}</button>
                <button type="button" class="icon-btn" data-theme-btn aria-label="Змінити тему" title="Змінити тему"></button>
            </header>
            ${app.sim ? demoBar() : ''}
            <main class="page" id="page"></main>
        </div>
    </div>`;

    app.root = $('#page');
    themeButton();
    $('[data-theme-btn]').addEventListener('click', toggleTheme);
    $('[data-rec]').addEventListener('click', toggleRecording);
    if (app.sim) bindDemo();
    syncLogos();
}

function demoBar() {
    const now = app.sim.vehicle.scenario;
    const buttons = [['drive', 'Їзда'], ['charge', 'Заряд'], ['park', 'Стоянка'], ['sleep', 'Сон']]
        .map(([s, t]) => `<button type="button" data-s="${s}"${s === now ? ' class="on"' : ''}>${t}</button>`).join('');
    return `<div class="demo">
        <b>Демо</b>
        <div class="seg" data-scenario>${buttons}</div>
        <label class="switch"><input type="checkbox" data-sim-bridge><span></span><em>Міст Twingo</em></label>
    </div>`;
}

function bindDemo() {
    const seg = $('[data-scenario]');
    seg.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        seg.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        app.sim.vehicle.setScenario(b.dataset.s);
    });
    const box = $('[data-sim-bridge]');
    box.checked = app.sim.vehicle.bridge;
    box.addEventListener('change', async () => {
        app.sim.vehicle.setBridge(box.checked);
        setBridge(box.checked);
        app.scheduler.retired.clear();
        shell();
        route();
    });
}

function route() {
    const id = location.hash.replace(/^#\/?/, '') || 'home';
    const page = PAGES.find((p) => p.id === id) ?? home;
    if (page === bridge && !app.store.get('is_bridge')) {
        location.hash = '';
        return;
    }
    app.page?.unmount?.();
    app.page = page;

    const isHome = page === home;
    $('[data-back]').hidden = isHome;
    $('[data-brand-top]').hidden = !isHome;
    $('[data-title]').textContent = isHome ? 'Smart 451 ED' : page.title;
    document.title = isHome ? 'Smart 451 ED' : `${page.title} · Smart 451 ED`;
    for (const a of document.querySelectorAll('[data-nav]')) {
        a.classList.toggle('on', a.dataset.nav === page.id);
    }

    app.root.innerHTML = page.render(app);
    app.root.scrollTop = 0;
    window.scrollTo(0, 0);
    page.mount?.(app.root, app);
    app.scheduler.plan(page);
    tick();
}

function tick() {
    if (document.hidden || !app.page || !app.root) return;
    derive(app.store);
    bindValues(app.root, app.store);
    app.page.update?.(app.root, app);

    const rec = $('[data-rec]');
    if (rec) rec.classList.toggle('rec-on', app.recorder.active);
}

function toggleRecording() {
    const r = app.recorder;
    if (!r.active) {
        r.start();
        return;
    }
    const blob = r.stop();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `smart451-${new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
}

function currentTheme() {
    return document.documentElement.dataset.theme === 'light' ? 'light' : 'dark';
}

function syncLogos() {
    const src = currentTheme() === 'light' ? 'assets/logo-mark-dark.svg' : 'assets/logo-mark-white.svg';
    for (const img of document.querySelectorAll('[data-logo]')) img.src = src;
}

function themeButton() {
    $('[data-theme-btn]').innerHTML = currentTheme() === 'light' ? ICONS.moon : ICONS.sun;
}

function toggleTheme() {
    const next = currentTheme() === 'light' ? 'dark' : 'light';
    document.documentElement.dataset.theme = next;
    try { localStorage.setItem('theme', next); } catch { /* приватне вікно */ }
    themeButton();
    syncLogos();
}

window.addEventListener('hashchange', () => { if (app.scheduler) route(); });

if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
}

landing();
syncLogos();
startDevLink(app);

const params = new URLSearchParams(location.search);
if (params.has('demo')) {
    connectDemo({ scenario: params.get('demo') || 'drive', bridge: params.has('bridge') });
}
