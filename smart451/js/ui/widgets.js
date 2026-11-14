// --- js/ui/widgets.js ---
// Шаблони спільних блоків. Тут лише статична розмітка: усе, що прийшло з ECU,
// потрапляє в DOM через textContent у bindValues().

import { PARAMS, formatValue } from '../proto/params.js';

export function stat(key, { label, big = false } = {}) {
    const p = PARAMS[key] ?? {};
    return `<div class="stat${big ? ' stat-big' : ''}" data-stat="${key}" title="${p.src ?? ''}">
        <span class="stat-label">${label ?? p.label ?? key}</span>
        <span class="stat-value"><b data-k="${key}">—</b>${p.unit ? `<i>${p.unit}</i>` : ''}</span>
    </div>`;
}

export const stats = (...keys) => `<div class="stats">${keys.map((k) => stat(k)).join('')}</div>`;

export function card(title, body, { note = '', cls = '' } = {}) {
    return `<section class="card ${cls}">
        ${title ? `<header class="card-head"><h2>${title}</h2>${note ? `<span class="card-note">${note}</span>` : ''}</header>` : ''}
        ${body}
    </section>`;
}

export function chart(id) {
    return `<div class="chart" data-chart="${id}">
        <canvas></canvas><div class="chart-tip" hidden></div>
    </div>`;
}

export function legend(items) {
    return `<div class="legend">${items.map(([label, token]) =>
        `<span><i style="background:var(${token})"></i>${label}</span>`).join('')}</div>`;
}

export function meter(key, label, { max = 100 } = {}) {
    return `<div class="meter" data-meter="${key}" data-max="${max}">
        <div class="meter-head"><span>${label}</span><b data-k="${key}">—</b></div>
        <div class="meter-track"><span></span></div>
    </div>`;
}

export const windowPicker = () => `<div class="seg" role="group" aria-label="Вікно графіка" data-window>
    <button type="button" data-min="2">2 хв</button>
    <button type="button" data-min="5" class="on">5 хв</button>
    <button type="button" data-min="15">15 хв</button>
</div>`;

export function bindWindowPicker(root, charts) {
    const box = root.querySelector('[data-window]');
    if (!box) return;
    box.addEventListener('click', (e) => {
        const b = e.target.closest('button');
        if (!b) return;
        box.querySelectorAll('button').forEach((x) => x.classList.toggle('on', x === b));
        for (const c of charts) c.windowMs = Number(b.dataset.min) * 60000;
    });
}

/** Оновлює всі значення на сторінці; застарілі гасне, а не лишаються як живі. */
export function bindValues(root, store) {
    for (const el of root.querySelectorAll('[data-k]')) {
        const key = el.dataset.k;
        const text = formatValue(key, store.get(key));
        if (el.textContent !== text) el.textContent = text;
        el.closest('.stat')?.classList.toggle('stale', store.isStale(key));
    }
    for (const m of root.querySelectorAll('[data-meter]')) {
        const v = store.get(m.dataset.meter);
        const pct = v === null ? 0 : Math.max(0, Math.min(100, (v / Number(m.dataset.max)) * 100));
        m.querySelector('.meter-track span').style.width = `${pct}%`;
    }
}
