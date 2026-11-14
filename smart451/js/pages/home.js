// --- js/pages/home.js ---
import { ICONS } from '../ui/icons.js';
import { socArc } from '../ui/charts.js';
import { stat } from '../ui/widgets.js';
import { formatNumber } from '../proto/params.js';

const num = (v, d = 0) => (v === null ? '—' : formatNumber(v, d));
const POWER_SCALE_KW = 60;

// Плитка показує головне значення розділу прямо на головному екрані.
const TILES = [
    ['battery', 'Батарея', (g) => (g('soh') === null ? 'SOC, напруга, струм' : `SOH ${num(g('soh'))} % · ${num(g('cap_ah'), 1)} А·год`)],
    ['cells', 'Комірки', (g) => (g('cell_delta') === null ? 'Напруга, ємність, опір' : `Розкид ${num(g('cell_delta'))} мВ · ${num(g('cell_count'))} шт.`)],
    ['temps', 'Температури', (g) => (g('t_min') === null ? 'Модулі й контур' : `${num(g('t_min'))}…${num(g('t_max'))} °C`)],
    ['charge', 'Заряджання', (g, s) => (s.fresh('charging') ? `Іде заряд · ${num(Math.abs(g('power_kw') ?? 0), 1)} кВт` : 'Не заряджається')],
    ['drive', 'Їзда', (g) => (g('range_km') === null ? 'Швидкість, витрата' : `${num(g('speed'))} км/год · запас ${num(g('range_km'))} км`)],
    ['cepc', 'Блок приводу', () => 'Що машина прийняла від BMS'],
    ['cool', 'Охолодження', (g) => (g('cool_temp') === null ? 'Контур, помпи, нагрівач' : `Рідина ${num(g('cool_temp'))} °C`)],
    ['dtc', 'Помилки', (g) => {
        const n = g('dtc_real');
        if (n === null) return 'Читаємо…';
        return n ? `Активних і підтверджених: ${n}` : 'Немає активних';
    }],
    ['ident', 'Ідентифікація', (g) => g('vin') ?? 'VIN, версії, адаптер'],
    ['bus', 'Шина', (_, s) => `${s.frames.size} ID у потоці`],
    ['bridge', 'Міст Twingo', (g) => (g('lbc_soc') === null ? 'LBC, балансування' : `LBC ${num(g('lbc_soc'), 1)} %`)],
];

export default {
    id: 'home',
    title: 'Огляд',
    groups: ['power', 'hv', 'drive', 'body', 'state'],
    polls: ['bms_soc', 'bms_temps', 'bms_cap', ['bms_hv', 5000], ['bms_cells', 30000]],

    render({ store }) {
        const arc = socArc(0);
        const tiles = TILES.filter(([id]) => id !== 'bridge' || store.get('is_bridge'))
            .map(([id, title]) => `<a class="tile" href="#/${id}">
                <span class="tile-icon">${ICONS[id === 'temps' ? 'temp' : id]}</span>
                <span class="tile-text"><b>${title}</b><span data-tile="${id}"></span></span>
            </a>`).join('');

        return `<section class="hero">
            <div class="soc">
                <svg viewBox="0 0 220 220" role="img" aria-label="Рівень заряду">
                    <defs><linearGradient id="soc-grad" x1="0" y1="1" x2="1" y2="0">
                        <stop offset="0" stop-color="var(--accent-deep)"/><stop offset="1" stop-color="var(--accent)"/>
                    </linearGradient></defs>
                    <circle class="soc-track" cx="110" cy="110" r="92" stroke-dasharray="${arc.track}" transform="rotate(135 110 110)"/>
                    <circle class="soc-fill" cx="110" cy="110" r="92" stroke-dasharray="${arc.dash}" transform="rotate(135 110 110)"/>
                </svg>
                <div class="soc-center">
                    <span class="soc-label">Заряд</span>
                    <span class="soc-num"><b data-soc>—</b><i>%</i></span>
                    <span class="soc-sub" data-soc-sub></span>
                </div>
            </div>
            <div class="hero-side">
                <div class="chips" data-chips></div>
                <div class="flow" aria-label="Потік потужності">
                    <div class="flow-head">
                        <span>Розряд</span>
                        <b class="flow-value"><span data-k="power_kw">—</span> кВт</b>
                        <span>Заряд</span>
                    </div>
                    <div class="flow-track"><span class="flow-mid"></span><span class="flow-fill" data-flow></span></div>
                </div>
                <div class="stats">
                    ${stat('hv_main')}${stat('amps')}${stat('speed')}${stat('range_km')}${stat('lv')}${stat('obd_v')}
                </div>
            </div>
        </section>
        <nav class="tiles" aria-label="Розділи">${tiles}</nav>`;
    },

    update(root, { store }) {
        const g = store.get;
        const f = store.fresh;
        const soc = g('soc_main');
        root.querySelector('[data-soc]').textContent = soc === null ? '—' : formatNumber(soc, 1);
        root.querySelector('.soc-fill').setAttribute('stroke-dasharray', socArc(soc).dash);

        const parts = [];
        if (g('soc_dash') !== null) parts.push(`приборка ${num(g('soc_dash'), 1)} %`);
        if (g('range_km') !== null) parts.push(`${num(g('range_km'))} км`);
        root.querySelector('[data-soc-sub]').textContent = parts.join(' · ');

        const kw = f('power_kw') ?? 0;
        const half = Math.min(Math.abs(kw) / POWER_SCALE_KW, 1) * 50;
        const flow = root.querySelector('[data-flow]');
        flow.style.width = `${half}%`;
        flow.style.left = kw < 0 ? `${50 - half}%` : '50%';
        flow.classList.toggle('flow-out', kw < 0);

        const chips = root.querySelector('[data-chips]');
        const want = [
            f('hv_active') === null ? ['off', 'HV: нема даних'] : f('hv_active') ? ['good', 'HV увімкнено'] : ['off', 'HV вимкнено'],
            f('charging') ? ['good', 'Заряджається'] : f('charge_port') ? ['info', 'Порт відкрито'] : null,
            g('is_bridge') ? ['info', 'Міст Twingo'] : null,
        ].filter(Boolean);
        const sig = JSON.stringify(want);
        if (chips.dataset.sig !== sig) {
            chips.dataset.sig = sig;
            chips.replaceChildren(...want.map(([tone, text]) => {
                const c = document.createElement('span');
                c.className = `chip chip-${tone}`;
                c.textContent = text;
                return c;
            }));
        }

        for (const [id, , sub] of TILES) {
            const el = root.querySelector(`[data-tile="${id}"]`);
            if (el) el.textContent = sub(g, store);
        }
    },
};
