// --- js/pages/cepc.js ---
import { card } from '../ui/widgets.js';
import { CEPC_GROUPS, CEPC_POLLS, CEPC_ROWS } from '../proto/dids.js';
import { formatNumber } from '../proto/params.js';

const hex = (did) => did.toString(16).toUpperCase().padStart(4, '0');
const CONTACTOR = ['розімкнені', 'передзаряд', 'замкнені', 'помилка'];

function show(row, v, status) {
    if (v === null) return status && !status.ok ? status.text : '—';
    if (row.group === 'flags') return v ? 'УВІМКНЕНО' : 'ні';
    if (row.did === 0x5313) return CONTACTOR[v] ?? String(v);
    const digits = row.scale < 0.01 ? 2 : row.scale < 1 ? 1 : 0;
    return `${formatNumber(v, digits)}${row.unit ? ` ${row.unit}` : ''}`;
}

export default {
    id: 'cepc',
    title: 'Блок приводу',
    groups: [],
    polls: CEPC_POLLS,

    render() {
        const blocks = CEPC_GROUPS.map(([g, title]) => {
            const rows = CEPC_ROWS.filter((r) => r.group === g).map((r) => `<tr data-row="${r.key}">
                <td class="mono">${hex(r.did)}</td><th>${r.label}</th><td class="num"></td></tr>`).join('');
            return card(title, `<table class="tbl"><tbody>${rows}</tbody></table>`, { cls: 'wide' });
        }).join('');
        return `<div class="grid">
            ${card('Сесія', `<label class="switch"><input type="checkbox" data-ext><span></span>
                <em>Дозволити extended-сесію, якщо CEPC відмовить (лише на стоянці)</em></label>
                <div class="kv"><span>Поточна сесія</span><b data-session>default</b></div>`, { cls: 'wide' })}
            ${blocks}
        </div>`;
    },

    mount(root, { scheduler }) {
        const box = root.querySelector('[data-ext]');
        box.checked = scheduler.allowExtended;
        box.addEventListener('change', () => { scheduler.allowExtended = box.checked; });
    },

    update(root, { store, scheduler }) {
        root.querySelector('[data-session]').textContent = scheduler.extended ? 'extended' : 'default';
        for (const r of CEPC_ROWS) {
            const tr = root.querySelector(`[data-row="${r.key}"]`);
            const v = store.get(r.key);
            const cell = tr.lastElementChild;
            const text = show(r, v, store.didStatus.get(r.key));
            if (cell.textContent !== text) cell.textContent = text;
            tr.classList.toggle('row-flag', r.group === 'flags' && !!v);
        }
    },
};
