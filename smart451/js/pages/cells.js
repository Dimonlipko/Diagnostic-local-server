// --- js/pages/cells.js ---
// Карта комірок: таблиця як heatmap у CanZE, але з номером у кожній клітинці.
// Колір — відхилення від середнього по паку; значення читається прямо з клітинки.
import { card } from '../ui/widgets.js';
import { cellStats } from '../proto/dids.js';
import { formatNumber } from '../proto/params.js';

// floor — мінімальна межа шкали кольору. Без неї здоровий пак із розкидом 5 мВ
// фарбувався б так само яскраво, як пак із проблемною коміркою.
const VIEWS = {
    mv: {
        key: 'cells_mv', poll: 'bms_cells', title: 'Напруга', unit: 'В', devUnit: 'мВ', floor: 15, note: 'DID 0208',
        show: (v) => formatNumber(v / 1000, 3), dev: (d) => formatNumber(d, 0),
    },
    ah: {
        key: 'cells_ah', poll: 'bms_cell_cap', title: 'Ємність', unit: 'А·год', devUnit: 'А·год', floor: 0.5, note: 'DID 0310',
        show: (v) => formatNumber(v, 2), dev: (d) => formatNumber(d, 2),
    },
    res: {
        key: 'cells_res', poll: 'bms_res', title: 'Опір', unit: 'відн.', devUnit: 'відн.', floor: 20, note: 'DID 030D',
        show: (v) => formatNumber(v, 0), dev: (d) => formatNumber(d, 0),
    },
};

const MAX_TINT = 62;      // % кольору в клітинці: більше — і текст стає нечитабельним

const signed = (d, text) => (d > 0 ? `+${text}` : text);

function summaryStat(label, value, unit, sub = '') {
    const box = document.createElement('div');
    box.className = 'stat';
    const l = document.createElement('span');
    l.className = 'stat-label';
    l.textContent = sub ? `${label} · №${sub}` : label;
    const v = document.createElement('span');
    v.className = 'stat-value';
    const b = document.createElement('b');
    b.textContent = value;
    const i = document.createElement('i');
    i.textContent = unit;
    v.append(b, i);
    box.append(l, v);
    return box;
}

export default {
    id: 'cells',
    title: 'Комірки',
    groups: [],
    polls: ['bms_cells', 'bms_res', 'bms_cell_cap', 'lbc_balance'],

    render() {
        const tabs = Object.entries(VIEWS).map(([id, v], i) =>
            `<button type="button" data-view="${id}"${i ? '' : ' class="on"'}>${v.title}</button>`).join('');
        return `<div class="grid">
            ${card('', `<header class="card-head"><div class="seg" data-views>${tabs}</div><span class="card-note" data-note></span></header>
                <div class="cellsum" data-sum></div>
                <div class="cellmap" data-map></div>
                <div class="cell-legend" data-legend></div>
                <p class="cell-pick" data-pick></p>`, { cls: 'wide' })}
        </div>`;
    },

    mount(root) {
        this.view = 'mv';
        this.drawn = null;
        this.picked = null;
        root.querySelector('[data-views]').addEventListener('click', (e) => {
            const b = e.target.closest('button');
            if (!b) return;
            this.view = b.dataset.view;
            root.querySelectorAll('[data-views] button').forEach((x) => x.classList.toggle('on', x === b));
            this.drawn = null;
        });
        root.querySelector('[data-map]').addEventListener('click', (e) => {
            const c = e.target.closest('.cell');
            if (!c) return;
            this.picked = Number(c.dataset.i);
            this.drawn = null;
        });
    },

    update(root, { store }) {
        const v = VIEWS[this.view];
        const vals = store.get(v.key);
        const entry = store.values.get(v.key);
        const map = root.querySelector('[data-map]');
        const age = entry ? Math.round((Date.now() - entry.t) / 1000) : null;
        root.querySelector('[data-note]').textContent = age === null ? v.note : `${v.note} · оновлено ${age} с тому`;
        map.classList.toggle('cellmap-stale', store.isStale(v.key));

        if (!vals?.length) {
            const st = store.didStatus.get(v.poll);
            const text = st && !st.ok ? `Немає даних: ${st.text}` : 'Читаємо комірки…';
            if (map.textContent !== text) map.textContent = text;
            root.querySelector('[data-sum]').replaceChildren();
            root.querySelector('[data-legend]').replaceChildren();
            root.querySelector('[data-pick]').textContent = '';
            this.drawn = null;
            return;
        }

        const bal = store.get('lbc_balance');
        const sig = `${this.view}:${entry.t}:${bal?.length}:${this.picked}`;
        if (sig === this.drawn) return;
        this.drawn = sig;

        const s = cellStats(vals);
        const marks = new Set(this.view === 'mv' ? bal ?? [] : []);
        this._summary(root, v, s);
        this._map(map, vals, v, s, marks);
        this._legend(root, v, s, marks.size > 0);
        this._pick(root, vals, v, s);
    },

    _summary(root, v, s) {
        root.querySelector('[data-sum]').replaceChildren(
            summaryStat('Найнижча', v.show(s.min), v.unit, s.minAt + 1),
            summaryStat('Найвища', v.show(s.max), v.unit, s.maxAt + 1),
            summaryStat('Розкид', v.dev(s.delta), v.devUnit),
            summaryStat('Середня', v.show(s.mean), v.unit),
        );
    },

    _scale(v, s) {
        return Math.max(v.floor, s.max - s.mean, s.mean - s.min);
    },

    _map(map, vals, v, s, marks) {
        // Пак Twingo — 8 модулів по 12, заводський Smart — 3 по 31.
        const size = vals.length === 96 ? 12 : 31;
        const scale = this._scale(v, s);
        const modules = [];
        for (let first = 0; first < vals.length; first += size) {
            const box = document.createElement('section');
            box.className = 'cellmod';
            const h = document.createElement('h3');
            h.textContent = `Модуль ${first / size + 1}`;
            const grid = document.createElement('div');
            grid.className = `cellgrid cellgrid-${size}`;
            for (let i = first; i < Math.min(first + size, vals.length); i++) {
                grid.append(this._cell(i, vals[i], v, s, scale, marks.has(i)));
            }
            box.append(h, grid);
            modules.push(box);
        }
        map.replaceChildren(...modules);
    },

    _cell(i, val, v, s, scale, balancing) {
        const d = val - s.mean;
        const c = document.createElement('button');
        c.type = 'button';
        c.className = `cell ${d >= 0 ? 'cell-hi' : 'cell-lo'}`;
        c.dataset.i = i;
        c.style.setProperty('--mix', `${Math.round(Math.min(1, Math.abs(d) / scale) * MAX_TINT)}%`);
        c.setAttribute('aria-label', `Комірка ${i + 1}: ${v.show(val)} ${v.unit}`);
        if (i === this.picked) c.classList.add('on');

        const n = document.createElement('span');
        n.textContent = `${i + 1}`;
        if (i === s.minAt) { n.textContent += ' ▼'; c.classList.add('cell-mark'); }
        if (i === s.maxAt) { n.textContent += ' ▲'; c.classList.add('cell-mark'); }
        const b = document.createElement('b');
        b.textContent = v.show(val);
        c.append(n, b);
        if (balancing) c.append(document.createElement('i'));
        return c;
    },

    _legend(root, v, s, balancing) {
        const scale = this._scale(v, s);
        const box = root.querySelector('[data-legend]');
        const low = document.createElement('span');
        low.textContent = `−${v.dev(scale)} ${v.devUnit}`;
        const bar = document.createElement('i');
        bar.className = 'cell-scale';
        const high = document.createElement('span');
        high.textContent = `+${v.dev(scale)} ${v.devUnit}`;
        const marks = document.createElement('span');
        marks.className = 'cell-legend-marks';
        marks.textContent = `від середнього · ▼ найнижча · ▲ найвища${balancing ? ' · ● балансується' : ''}`;
        box.replaceChildren(low, bar, high, marks);
    },

    _pick(root, vals, v, s) {
        const line = root.querySelector('[data-pick]');
        const i = this.picked;
        if (i === null || i >= vals.length) {
            line.textContent = 'Натисніть на комірку, щоб побачити відхилення від середнього.';
            return;
        }
        const d = vals[i] - s.mean;
        line.textContent = `Комірка ${i + 1}: ${v.show(vals[i])} ${v.unit}, ${signed(d, v.dev(d))} ${v.devUnit} від середнього`;
    },
};
