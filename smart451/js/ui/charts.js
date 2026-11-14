// --- js/ui/charts.js ---
// Графіки без бібліотек. Кольори беруться з CSS-токенів під час малювання, тож зміна
// теми не вимагає перебудови. Підписи й значення — кольором тексту, не кольором серії.

import { formatNumber } from '../proto/params.js';

const FONT = '12px Roboto, system-ui, sans-serif';

function css(el, name) {
    return getComputedStyle(el).getPropertyValue(name).trim();
}

// Канва в реальних пікселях: на екранах 3× інакше лінії розмиваються.
function fit(canvas) {
    const r = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const w = Math.round(r.width * dpr);
    const h = Math.round(r.height * dpr);
    if (canvas.width !== w || canvas.height !== h) {
        canvas.width = w;
        canvas.height = h;
    }
    const ctx = canvas.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    return { ctx, w: r.width, h: r.height };
}

function niceStep(range, target) {
    const raw = range / target;
    const mag = 10 ** Math.floor(Math.log10(raw));
    const n = raw / mag;
    return (n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10) * mag;
}

function ticks(min, max, target = 4) {
    const step = niceStep(max - min || 1, target);
    const out = [];
    for (let v = Math.ceil(min / step) * step; v <= max + step * 1e-6; v += step) out.push(v);
    return { values: out, step };
}

function tipPosition(tip, wrap, x, y) {
    const box = wrap.getBoundingClientRect();
    const tw = tip.offsetWidth;
    const left = x + 12 + tw > box.width ? x - tw - 12 : x + 12;
    tip.style.transform = `translate(${Math.max(0, left)}px, ${Math.max(0, y - 8)}px)`;
}

function tipRow(value, label, color) {
    const row = document.createElement('div');
    row.className = 'tip-row';
    if (color) {
        const key = document.createElement('span');
        key.className = 'tip-key';
        key.style.background = color;
        row.append(key);
    }
    const b = document.createElement('b');
    b.textContent = value;
    const s = document.createElement('span');
    s.textContent = label;
    row.append(b, s);
    return row;
}

export class LineChart {
    /**
     * @param {HTMLElement} wrap
     * @param {object} o
     * @param {{key:string,label:string,token:string}[]} o.series
     * @param {string} o.unit
     * @param {number} [o.digits]
     * @param {boolean} [o.zero] завжди показувати нуль на шкалі
     */
    constructor(wrap, o) {
        this.wrap = wrap;
        this.o = { digits: 1, zero: false, ...o };
        this.canvas = wrap.querySelector('canvas');
        this.tip = wrap.querySelector('.chart-tip');
        this.windowMs = 5 * 60 * 1000;
        this.hover = null;
        this.onMove = (e) => {
            const r = this.canvas.getBoundingClientRect();
            this.hover = { x: e.clientX - r.left, y: e.clientY - r.top };
            this.draw(this.store);
        };
        this.onLeave = () => {
            this.hover = null;
            this.tip.hidden = true;
            this.draw(this.store);
        };
        this.canvas.addEventListener('pointermove', this.onMove);
        this.canvas.addEventListener('pointerdown', this.onMove);
        this.canvas.addEventListener('pointerleave', this.onLeave);
    }

    draw(store) {
        this.store = store;
        const { ctx, w, h } = fit(this.canvas);
        if (!w) return;
        ctx.clearRect(0, 0, w, h);

        const now = Date.now();
        const t0 = now - this.windowMs;
        const lines = this.o.series.map((s) => ({
            ...s,
            color: css(this.wrap, s.token),
            pts: (store.history.get(s.key) ?? []).filter((p) => p.t >= t0),
        }));

        const all = lines.flatMap((l) => l.pts.map((p) => p.v));
        const ink = css(this.wrap, '--text-3');
        const grid = css(this.wrap, '--line');

        if (!all.length) {
            ctx.fillStyle = ink;
            ctx.font = FONT;
            ctx.textAlign = 'center';
            ctx.fillText('Чекаємо на дані…', w / 2, h / 2);
            return;
        }

        let min = Math.min(...all);
        let max = Math.max(...all);
        if (this.o.zero) { min = Math.min(min, 0); max = Math.max(max, 0); }
        if (max - min < (this.o.minSpan ?? 1)) {
            const mid = (max + min) / 2;
            min = mid - (this.o.minSpan ?? 1) / 2;
            max = mid + (this.o.minSpan ?? 1) / 2;
        }
        const yt = ticks(min, max);
        min = Math.min(min, yt.values[0]);
        max = Math.max(max, yt.values[yt.values.length - 1]);

        const pad = { l: 44, r: 14, t: 10, b: 22 };
        const X = (t) => pad.l + ((t - t0) / this.windowMs) * (w - pad.l - pad.r);
        const Y = (v) => h - pad.b - ((v - min) / (max - min)) * (h - pad.t - pad.b);

        ctx.font = FONT;
        ctx.lineWidth = 1;
        ctx.strokeStyle = grid;
        ctx.fillStyle = ink;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        const yd = yt.step < 1 ? 1 : 0;
        for (const v of yt.values) {
            const y = Math.round(Y(v)) + 0.5;
            ctx.beginPath();
            ctx.moveTo(pad.l, y);
            ctx.lineTo(w - pad.r, y);
            ctx.stroke();
            ctx.fillText(formatNumber(v, yd), pad.l - 8, y);
        }

        ctx.textAlign = 'center';
        ctx.textBaseline = 'alphabetic';
        const minutes = this.windowMs / 60000;
        for (let m = 0; m <= minutes; m += minutes <= 2 ? 1 : minutes <= 5 ? 1 : 5) {
            const x = X(now - m * 60000);
            ctx.fillText(m === 0 ? 'зараз' : `−${m} хв`, Math.min(x, w - 22), h - 6);
        }

        for (const l of lines) {
            if (!l.pts.length) continue;
            // Обрив у даних показуємо розривом: лінія через паузу вигадала б значення.
            const gap = Math.max(4000, this.windowMs / 40);
            ctx.lineWidth = 2;
            ctx.lineJoin = 'round';
            ctx.lineCap = 'round';
            ctx.strokeStyle = l.color;
            ctx.beginPath();
            l.pts.forEach((p, i) => {
                const prev = l.pts[i - 1];
                if (!prev || p.t - prev.t > gap) ctx.moveTo(X(p.t), Y(p.v));
                else ctx.lineTo(X(p.t), Y(p.v));
            });
            ctx.stroke();

            if (lines.length === 1) {
                const base = Y(this.o.zero ? 0 : min);
                ctx.globalAlpha = 0.1;
                ctx.fillStyle = l.color;
                ctx.beginPath();
                ctx.moveTo(X(l.pts[0].t), base);
                l.pts.forEach((p) => ctx.lineTo(X(p.t), Y(p.v)));
                ctx.lineTo(X(l.pts[l.pts.length - 1].t), base);
                ctx.closePath();
                ctx.fill();
                ctx.globalAlpha = 1;
            }

            const end = l.pts[l.pts.length - 1];
            ctx.fillStyle = css(this.wrap, '--card');
            ctx.beginPath();
            ctx.arc(X(end.t), Y(end.v), 6, 0, Math.PI * 2);
            ctx.fill();
            ctx.fillStyle = l.color;
            ctx.beginPath();
            ctx.arc(X(end.t), Y(end.v), 4, 0, Math.PI * 2);
            ctx.fill();
        }

        if (this.hover) this._crosshair(ctx, lines, X, Y, t0, pad, h, w);
    }

    _crosshair(ctx, lines, X, Y, t0, pad, h, w) {
        const hx = Math.min(Math.max(this.hover.x, pad.l), w - pad.r);
        const t = t0 + ((hx - pad.l) / (w - pad.l - pad.r)) * this.windowMs;
        ctx.strokeStyle = css(this.wrap, '--text-3');
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(Math.round(hx) + 0.5, pad.t);
        ctx.lineTo(Math.round(hx) + 0.5, h - pad.b);
        ctx.stroke();

        this.tip.replaceChildren();
        let any = false;
        for (const l of lines) {
            if (!l.pts.length) continue;
            const p = l.pts.reduce((a, b) => (Math.abs(b.t - t) < Math.abs(a.t - t) ? b : a));
            this.tip.append(tipRow(`${formatNumber(p.v, this.o.digits)} ${this.o.unit}`, l.label, l.color));
            any = true;
        }
        if (!any) return;
        this.tip.hidden = false;
        tipPosition(this.tip, this.wrap, hx, this.hover.y);
    }

    destroy() {
        this.canvas.removeEventListener('pointermove', this.onMove);
        this.canvas.removeEventListener('pointerdown', this.onMove);
        this.canvas.removeEventListener('pointerleave', this.onLeave);
    }
}

// Дуга SOC 270°. Тонке кільце з заокругленими кінцями; число всередині — головне.
export function socArc(pct) {
    const r = 92;
    const c = 2 * Math.PI * r;
    const sweep = 0.75;
    const fill = Math.max(0, Math.min(1, (pct ?? 0) / 100)) * sweep * c;
    return { dash: `${fill} ${c}`, track: `${sweep * c} ${c}` };
}
