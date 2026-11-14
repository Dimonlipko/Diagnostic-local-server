// --- js/pages/bus.js ---
import { card } from '../ui/widgets.js';
import { ECU, NRC_TEXT, ascii, hexDump } from '../proto/dids.js';
import { FRAMES } from '../proto/frames.js';
import { PARAMS, formatValue } from '../proto/params.js';
import { fromHex } from '../core/isotp.js';

const hex3 = (v) => v.toString(16).toUpperCase().padStart(3, '0');

function cells(tr, values) {
    tr.replaceChildren(...values.map((v) => {
        const td = document.createElement('td');
        td.textContent = v;
        return td;
    }));
}

export default {
    id: 'bus',
    title: 'Шина',
    groups: ['power', 'hv', 'drive', 'body', 'state'],
    polls: [],

    render() {
        const ecus = Object.entries(ECU).map(([k, e]) =>
            `<option value="${k}">${k} · ${e.title}</option>`).join('');
        return `<div class="seg seg-page" data-tabs>
            <button type="button" data-tab="frames" class="on">Кадри</button>
            <button type="button" data-tab="params">Усі параметри</button>
            <button type="button" data-tab="console">Запит</button>
            <button type="button" data-tab="log">Журнал ELM</button>
        </div>
        <div data-pane="frames">${card('', `<table class="tbl tbl-mono"><thead><tr><th>ID</th><th>Дані</th><th>Гц</th><th>Вік, с</th><th>Значення</th></tr></thead>
            <tbody data-frames></tbody></table>`)}</div>
        <div data-pane="params" hidden>${card('', `<table class="tbl"><thead><tr><th>Параметр</th><th>Значення</th><th>Джерело</th></tr></thead>
            <tbody data-params></tbody></table>`)}</div>
        <div data-pane="console" hidden>${card('Читання за DID', `<form class="console" data-form>
            <select data-ecu>${ecus}</select>
            <input data-did placeholder="DID, напр. F190" maxlength="4" spellcheck="false" autocomplete="off" aria-label="DID" required pattern="[0-9A-Fa-f]{4}">
            <button class="btn" type="submit">Прочитати</button>
        </form><pre class="console-out" data-out>Лише читання: сервіс 22.</pre>`)}</div>
        <div data-pane="log" hidden>${card('', '<pre class="console-out console-log" data-log></pre>')}</div>`;
    },

    mount(root, { scheduler }) {
        this.tab = 'frames';
        root.querySelector('[data-tabs]').addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            this.tab = b.dataset.tab;
            root.querySelectorAll('[data-tabs] button').forEach((x) => x.classList.toggle('on', x === b));
            root.querySelectorAll('[data-pane]').forEach((p) => { p.hidden = p.dataset.pane !== this.tab; });
        });

        root.querySelector('[data-form]').addEventListener('submit', async (e) => {
            e.preventDefault();
            const out = root.querySelector('[data-out]');
            const name = root.querySelector('[data-ecu]').value;
            const did = fromHex(root.querySelector('[data-did]').value.toUpperCase());
            out.textContent = 'Запит…';
            try {
                const r = await scheduler.run((elm) => elm.uds(ECU[name], [0x22, did[0], did[1]], { timeout: 6000 }));
                out.textContent = `${r.length} байт\n${hexDump(r)}\n\nASCII: ${ascii(r)}`;
            } catch (err) {
                const why = NRC_TEXT[err.nrc] ? ` (${NRC_TEXT[err.nrc]})` : '';
                out.textContent = `${err.message}${why}`;
            }
        });
    },

    update(root, ctx) {
        if (this.tab === 'frames') this._frames(root, ctx.store);
        if (this.tab === 'params') this._params(root, ctx.store);
        if (this.tab === 'log') root.querySelector('[data-log]').textContent = ctx.logLines().join('\n');
    },

    _frames(root, store) {
        const now = Date.now();
        const body = root.querySelector('[data-frames]');
        const ids = [...store.frames.keys()].sort((a, b) => a - b);
        const rows = ids.map((id) => {
            const f = store.frames.get(id);
            const secs = (f.t - f.first) / 1000;
            const tr = document.createElement('tr');
            cells(tr, [`0x${hex3(id)}`, hexDump(f.data), secs > 1 ? (f.count / secs).toFixed(1) : '—',
                ((now - f.t) / 1000).toFixed(1), FRAMES[id]?.name ?? '']);
            return tr;
        });
        body.replaceChildren(...rows);
    },

    _params(root, store) {
        const body = root.querySelector('[data-params]');
        const keys = [...store.values.keys()].filter((k) => PARAMS[k]).sort();
        body.replaceChildren(...keys.map((k) => {
            const p = PARAMS[k];
            const tr = document.createElement('tr');
            cells(tr, [p.label, `${formatValue(k, store.get(k))}${p.unit ? ` ${p.unit}` : ''}`, p.src]);
            return tr;
        }));
    },
};
