// --- js/pages/bridge.js ---
// Екран моста Twingo. З'являється, лише якщо BMS відповіла на 22 FD00.
import { card, stats } from '../ui/widgets.js';
import { ECU, POLLS, ascii } from '../proto/dids.js';

const RESET = ['живлення', 'backup', 'watchdog', 'програмний', 'NRST'];
const CONTACTOR = ['розімкнені', 'передзаряд', 'замкнені'];
const FLAGS = [
    [0x01, 'шина Smart'], [0x02, 'кадри LBC'], [0x04, 'LBC на зв\'язку'], [0x08, 'образ не підтверджено'],
    [0x10, 'HVIL'], [0x20, 'запалювання'], [0x40, 'живлення втримане'], [0x80, 'плата спить'],
];

export const BRIDGE_POLLS = Object.entries(POLLS).filter(([, p]) => p.bridge).map(([k]) => k);

function decimalUptime(s) {
    if (s === null) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h} год ${String(m).padStart(2, '0')} хв`;
}

export default {
    id: 'bridge',
    title: 'Міст Twingo',
    groups: [],
    polls: BRIDGE_POLLS,

    render() {
        return `<div class="grid">
            ${card('Міст', `<div class="kv"><span>Прошивка</span><b class="mono" data-fw>—</b></div>
                <div class="kv"><span>Час роботи</span><b data-up>—</b></div>
                <div class="kv"><span>Останній скид</span><b data-reset>—</b></div>
                <div class="kv"><span>Контактори</span><b data-ct>—</b></div>
                <div class="chips" data-flags></div>
                ${stats('br_ign_v', 'br_lbc_age')}`, { note: 'FD00, FD04 · є лише на Due' })}
            ${card('LBC: заряд', stats('lbc_soc', 'lbc_usable', 'lbc_soh', 'lbc_energy', 'lbc_v'))}
            ${card('LBC: комірки', stats('lbc_cmin', 'lbc_cmax', 'lbc_balance_n', 'lbc_bal_ah', 'lbc_bal_h'))}
            ${card('LBC: температури', stats('lbc_tmin', 'lbc_tavg', 'lbc_tmax', 'lbc_cpu_t'))}
            ${card('LBC: межі', stats('lbc_pchg', 'lbc_pregen', 'lbc_pdis'))}
            ${card('LBC: реле', `<div class="kv"><span>Головне, запит</span><b data-rl="lbc_relay_main">—</b></div>
                <div class="kv"><span>Передзаряд, запит</span><b data-rl="lbc_relay_pre">—</b></div>
                <div class="kv"><span>Зворотний зв'язок</span><b data-rl="lbc_relay_fb">—</b></div>
                <div class="kv"><span>Інтерлок</span><b data-ilock>—</b></div>`)}
        </div>
        <p class="foot-note">Поки LBC спить (запалювання вимкнене), проксі-запити 9xxx отримують відмову 7F xx 22.</p>`;
    },

    async mount(root, { scheduler }) {
        const r = await scheduler.run((elm) => elm.uds(ECU.BMS, [0x22, 0xFD, 0x00])).catch(() => null);
        const el = root.querySelector('[data-fw]');
        if (el && r) el.textContent = ascii(r);
    },

    update(root, { store }) {
        const g = store.get;
        root.querySelector('[data-up]').textContent = decimalUptime(g('br_uptime_s'));
        const reset = g('br_reset');
        root.querySelector('[data-reset]').textContent = reset === null ? '—' : RESET[reset] ?? String(reset);
        const ct = store.fresh('br_ct_state');
        root.querySelector('[data-ct]').textContent = ct === null ? '—' : CONTACTOR[ct] ?? String(ct);
        const il = store.fresh('lbc_ilock');
        root.querySelector('[data-ilock]').textContent = il === null ? '—' : il === 2 ? 'замкнений' : il === 1 ? 'РОЗІМКНЕНИЙ' : String(il);
        for (const el of root.querySelectorAll('[data-rl]')) {
            const v = store.fresh(el.dataset.rl);
            el.textContent = v === null ? '—' : v ? 'так' : 'ні';
        }

        const flags = g('br_flags');
        const box = root.querySelector('[data-flags]');
        if (flags !== null && box.dataset.v !== String(flags)) {
            box.dataset.v = String(flags);
            box.replaceChildren(...FLAGS.filter(([bit]) => flags & bit).map(([, text]) => {
                const c = document.createElement('span');
                c.className = 'chip chip-info';
                c.textContent = text;
                return c;
            }));
        }
    },
};
