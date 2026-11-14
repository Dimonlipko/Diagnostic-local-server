// --- js/pages/ident.js ---
import { card } from '../ui/widgets.js';
import { ECU, IDENT_DIDS, NRC_TEXT, hexDump } from '../proto/dids.js';

export async function readVin(ctx) {
    const { scheduler, store } = ctx;
    const r = await scheduler.run((elm) => elm.uds(ECU.BMS, [0x22, 0xF1, 0x90]));
    store.set('vin', IDENT_DIDS[0].decode(r));
}

function kv(rows) {
    return rows.map(([k, v, mono]) => {
        const div = document.createElement('div');
        div.className = 'kv';
        const a = document.createElement('span');
        a.textContent = k;
        const b = document.createElement('b');
        if (mono) b.className = 'mono';
        b.textContent = v;
        div.append(a, b);
        return div;
    });
}

export default {
    id: 'ident',
    title: 'Ідентифікація',
    groups: [],
    polls: [],

    render() {
        return `<div class="grid">
            ${card('Батарея', '<div data-bms><p class="muted">Читаємо…</p></div>', { note: 'BMS 0x7E7' })}
            ${card('Адаптер', `<div data-adapter></div>
                <button type="button" class="btn btn-ghost btn-wide" data-disconnect>Відключити</button>`)}
        </div>`;
    },

    async mount(root, ctx) {
        const { scheduler, elm, transport } = ctx;
        root.querySelector('[data-disconnect]').addEventListener('click', () => ctx.disconnect());
        root.querySelector('[data-adapter]').replaceChildren(...kv([
            ['Пристрій', transport.name ?? 'Демо'],
            ['Прошивка ELM', elm.version || '—'],
            ['FlowControl', elm.fcMode === 'auto' ? 'адаптер' : `ручний, BS=${elm.manualBs}`],
            ['STmin', `${elm.stMin} мс`],
            ['Фільтр кадрів', elm.useMask ? 'маска ATCF/ATCM' : 'ATCRA по одному ID'],
        ]));

        const rows = await scheduler.run(async (e) => {
            const out = [];
            for (const d of IDENT_DIDS) {
                try {
                    const r = await e.uds(ECU.BMS, [0x22, d.did >> 8, d.did & 0xFF]);
                    out.push([d.label, d.decode(r) ?? hexDump(r, 3), true]);
                } catch (err) {
                    out.push([d.label, NRC_TEXT[err.nrc] ?? err.message, false]);
                }
            }
            return out;
        }).catch(() => null);

        const box = root.querySelector('[data-bms]');
        if (box && rows) box.replaceChildren(...kv(rows));
        else if (box) box.textContent = 'Не вдалося прочитати';
    },
};
