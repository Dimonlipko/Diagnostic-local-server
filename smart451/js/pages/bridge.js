// --- js/pages/bridge.js ---
// Екран моста Twingo. З'являється, лише якщо BMS відповіла на 22 FD00.
import { card, stats } from '../ui/widgets.js';
import { ask, blockedWhileMoving } from '../ui/confirm.js';
import { ECU, NRC_TEXT, POLLS, ascii } from '../proto/dids.js';

const RESET = ['живлення', 'backup', 'watchdog', 'програмний', 'NRST'];
const CONTACTOR = ['розімкнені', 'передзаряд', 'замкнені'];
const FLAGS = [
    [0x01, 'шина Smart'], [0x02, 'кадри LBC'], [0x04, 'LBC на зв\'язку'], [0x08, 'образ не підтверджено'],
    [0x10, 'HVIL'], [0x20, 'запалювання'], [0x40, 'живлення втримане'], [0x80, 'плата спить'],
];

// Захист комірок моста: FD05 і налаштування CELL* (firmware/bridge/README.md).
const CP_MODES = ['вимкнений', 'лише ліміти', 'ліміти й розмикання'];
const CP_LABELS = ['off', 'limit', 'open'];      // як міст друкує CELLPROT
const CP_FLAGS = [
    [0x01, 'немає даних комірок', 'chip-warn'], [0x02, 'верх: спрацював', 'chip-crit'],
    [0x04, 'низ: спрацював', 'chip-crit'], [0x08, 'HV відхилено', 'chip-crit'],
    [0x10, 'заряд завершено', 'chip-good'],
];
// Ключ, підпис, межі моста в мВ (src/settings.cpp).
const CP_FIELDS = [
    ['CELLHIW', 'Верх: зниження заряду від', 3000, 4200],
    ['CELLHI', 'Верх: стоп заряду', 3000, 4200],
    ['CELLLOW', 'Низ: зниження потужності від', 2500, 4000],
    ['CELLLO', 'Низ: стоп розряду', 2500, 4000],
];
const CP_KEYS = ['CELLPROT', ...CP_FIELDS.map(([k]) => k)];
const volts = (mv) => (mv / 1000).toFixed(3);

export const BRIDGE_POLLS = Object.entries(POLLS).filter(([, p]) => p.bridge).map(([k]) => k);

function chipsInto(box, value, table) {
    if (value === null || box.dataset.v === String(value)) return;
    box.dataset.v = String(value);
    box.replaceChildren(...table.filter(([bit]) => value & bit).map(([, text, cls = 'chip-info']) => {
        const c = document.createElement('span');
        c.className = `chip ${cls}`;
        c.textContent = text;
        return c;
    }));
}

function decimalUptime(s) {
    if (s === null) return '—';
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    return `${h} год ${String(m).padStart(2, '0')} хв`;
}

export default {
    id: 'bridge',
    title: 'Міст Twingo',
    groups: ['drive'],        // швидкість потрібна для дозволу на зміну порогів
    polls: BRIDGE_POLLS,

    render() {
        return `<div class="grid">
            ${card('Міст', `<div class="kv"><span>Прошивка</span><b class="mono" data-fw>—</b></div>
                <div class="kv"><span>Час роботи</span><b data-up>—</b></div>
                <div class="kv"><span>Останній скид</span><b data-reset>—</b></div>
                <div class="kv"><span>Контактори</span><b data-ct>—</b></div>
                <div class="chips" data-flags></div>
                ${stats('br_ign_v', 'br_lbc_age')}`, { note: 'FD00, FD04 · є лише на Due' })}
            ${card('Захист комірок', `<div class="kv"><span>Діє зараз</span><b data-cp-mode>—</b></div>
                <div class="chips" data-cp-flags></div>
                ${stats('br_cp_cmax', 'br_cp_cmin', 'br_cp_chg', 'br_cp_dis')}
                <div class="form-row">
                    <span class="form-label">Режим</span>
                    <div class="seg" role="group" aria-label="Режим захисту" data-cp-modes>
                        <button type="button" data-v="0" disabled>Вимк.</button>
                        <button type="button" data-v="1" disabled>Ліміти</button>
                        <button type="button" data-v="2" disabled>Розмикання</button>
                    </div>
                </div>
                <div class="fields">${CP_FIELDS.map(([key, label, min, max]) => `<label class="field">
                    <span>${label}, В</span>
                    <input type="number" inputmode="decimal" step="0.01" min="${min / 1000}" max="${max / 1000}" data-cp="${key}" disabled>
                </label>`).join('')}</div>
                <div class="form-row">
                    <button type="button" class="btn" data-cp-read>Прочитати</button>
                    <button type="button" class="btn btn-primary" data-cp-save disabled>Зберегти</button>
                    <span class="toolbar-note" data-cp-msg></span>
                </div>
                <p class="form-hint">«Розмикання»: якщо зарядник або навантаження не слухаються ліміту, міст відмовляє в HV. Лише в P і з вимкненим запаленням; на ходу тільки ріже ліміти.</p>`,
            { note: 'FD05 · CELLPROT, CELLHIW…CELLLO' })}
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

    async mount(root, ctx) {
        this.cp = null;
        this.cpMode = null;
        root.querySelector('[data-cp-read]').addEventListener('click', () => this._cpLoad(root, ctx));
        root.querySelector('[data-cp-save]').addEventListener('click', () => this._cpSave(root, ctx));
        root.querySelector('[data-cp-modes]').addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b || b.disabled) return;
            this.cpMode = Number(b.dataset.v);
            this._cpShowMode(root);
        });

        const r = await ctx.scheduler.run((elm) => elm.uds(ECU.BMS, [0x22, 0xFD, 0x00])).catch(() => null);
        const el = root.querySelector('[data-fw]');
        if (el && r) el.textContent = ascii(r);
        await this._cpLoad(root, ctx);
    },

    /** Читає CELLPROT і пороги: індекси з 22 FD02, значення з 22 FD10+i. */
    async _cpLoad(root, { scheduler }) {
        const msg = root.querySelector('[data-cp-msg]');
        msg.textContent = 'Читаємо пороги…';
        try {
            this.cp = await scheduler.run(async (elm) => {
                const keys = ascii(await elm.uds(ECU.BMS, [0x22, 0xFD, 0x02])).split(',');
                const out = {};
                for (const key of CP_KEYS) {
                    const index = keys.indexOf(key);
                    if (index < 0) throw new Error(`міст не знає ${key}, потрібна новіша прошивка`);
                    const did = 0xFD10 + index;
                    out[key] = { index, text: ascii(await elm.uds(ECU.BMS, [0x22, did >> 8, did & 0xFF])) };
                }
                return out;
            });
        } catch (e) {
            msg.textContent = `Не прочитано: ${NRC_TEXT[e.nrc] ?? e.message}`;
            return false;
        }
        for (const [key] of CP_FIELDS) {
            const el = root.querySelector(`[data-cp="${key}"]`);
            el.value = volts(Number(this.cp[key].text));
            el.disabled = false;
            el.removeAttribute('aria-invalid');
        }
        this.cpMode = CP_LABELS.indexOf(this.cp.CELLPROT.text);
        for (const b of root.querySelectorAll('[data-cp-modes] button')) b.disabled = false;
        this._cpShowMode(root);
        root.querySelector('[data-cp-save]').disabled = false;
        msg.textContent = '';
        return true;
    },

    _cpShowMode(root) {
        for (const b of root.querySelectorAll('[data-cp-modes] button')) {
            b.classList.toggle('on', Number(b.dataset.v) === this.cpMode);
        }
    },

    async _cpSave(root, ctx) {
        const { store, scheduler } = ctx;
        const msg = root.querySelector('[data-cp-msg]');
        if (!this.cp) {
            msg.textContent = 'Спершу прочитайте пороги.';
            return;
        }
        const why = blockedWhileMoving(store, 'редагування порогів');
        if (why) {
            msg.textContent = why;
            return;
        }

        const want = {};
        for (const [key, label, min, max] of CP_FIELDS) {
            const el = root.querySelector(`[data-cp="${key}"]`);
            const mv = Math.round(Number(el.value.replace(',', '.')) * 1000);
            const bad = !el.value || !Number.isFinite(mv) || mv < min || mv > max;
            el.setAttribute('aria-invalid', String(bad));
            if (bad) {
                msg.textContent = `${label}: від ${volts(min)} до ${volts(max)} В.`;
                return;
            }
            want[key] = mv;
        }
        const order = [
            [want.CELLHIW < want.CELLHI, 'Зниження заряду має починатися нижче за стоп заряду.'],
            [want.CELLLOW > want.CELLLO, 'Зниження потужності має починатися вище за стоп розряду.'],
            [want.CELLLOW < want.CELLHIW, 'Нижні пороги мають бути нижчими за верхні.'],
        ].find(([ok]) => !ok);
        if (order) {
            msg.textContent = order[1];
            return;
        }

        const changes = [];
        const oldMode = CP_LABELS.indexOf(this.cp.CELLPROT.text);
        if (this.cpMode !== oldMode) {
            changes.push({ key: 'CELLPROT', value: this.cpMode, expect: CP_LABELS[this.cpMode],
                line: `Режим: ${CP_MODES[oldMode] ?? this.cp.CELLPROT.text} → ${CP_MODES[this.cpMode]}` });
        }
        for (const [key, label] of CP_FIELDS) {
            const old = Number(this.cp[key].text);
            if (want[key] !== old) {
                changes.push({ key, value: String(want[key]), expect: String(want[key]),
                    line: `${label}: ${volts(old)} → ${volts(want[key])} В` });
            }
        }
        if (!changes.length) {
            msg.textContent = 'Змін немає.';
            return;
        }

        const lines = changes.map((c) => c.line);
        if (this.cpMode === 0 && oldMode !== 0) {
            lines.push('Захист вимкнеться: міст перестане обмежувати заряд і розряд за напругою комірок.');
        }
        if (want.CELLHI > 4100) {
            lines.push('Стоп заряду вище 4.100 В: менший запас до стелі комірок LG, яку ще ніхто не перевіряв.');
        }
        lines.push('Діє одразу й зберігається в мосту.');
        if (!await ask('Змінити захист комірок?', lines, { yes: 'Записати' })) return;

        const failed = [];
        for (const c of changes) {
            msg.textContent = `Записуємо ${c.key}…`;
            try {
                await scheduler.run((elm) => elm.writeBridgeSetting(ECU.BMS, this.cp[c.key].index, c.value));
            } catch (e) {
                failed.push(`${c.key}: ${NRC_TEXT[e.nrc] ?? e.message}`);
            }
        }
        // Що міст має насправді, показує лише нове читання.
        if (!await this._cpLoad(root, ctx)) return;
        const off = changes.filter((c) => this.cp[c.key].text !== c.expect).map((c) => c.key);
        const parts = [];
        if (failed.length) parts.push(`Не записано: ${failed.join('; ')}.`);
        if (off.length) parts.push(`Міст має інше значення: ${off.join(', ')}.`);
        msg.textContent = parts.length ? parts.join(' ') : 'Записано, перечитано з моста.';
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

        chipsInto(root.querySelector('[data-flags]'), g('br_flags'), FLAGS);

        const mode = store.fresh('br_cp_mode');
        root.querySelector('[data-cp-mode]').textContent = mode === null ? '—' : CP_MODES[mode] ?? String(mode);
        chipsInto(root.querySelector('[data-cp-flags]'), store.fresh('br_cp_flags'), CP_FLAGS);
    },
};
