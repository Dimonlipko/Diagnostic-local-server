// --- js/core/devlink.js ---
// Канал налагодження на машині: журнал ELM іде в serve.py, а звідти можна поставити
// читання в чергу, не торкаючись телефона чи ноутбука в салоні. Працює лише на
// localhost. Запити йдуть через elm.uds(), тож захист від запису діє і тут.

import { ECU } from '../proto/dids.js';
import { fromHex, toHex } from './isotp.js';

const POLL_MS = 400;
const FLUSH_MS = 700;

async function runJob(app, job) {
    if (job.type === 'state') {
        const { elm, store, scheduler } = app;
        return {
            connected: !!elm, name: app.transport?.name, link: app.link, page: app.page?.id,
            version: elm?.version, fc: elm?.fcMode, bs: elm?.manualBs, st: elm?.stMin,
            mask: elm?.useMask, stats: elm?.stats, bridge: store.get('is_bridge'),
            retired: scheduler ? [...scheduler.retired] : [],
            values: Object.fromEntries([...store.values].filter(([, e]) => !Array.isArray(e.v)).map(([k, e]) => [k, e.v])),
            dids: Object.fromEntries(store.didStatus),
        };
    }
    if (job.type === 'dom') {
        return {
            matches: [...document.querySelectorAll(job.sel)].slice(0, 40).map((el) => {
                const r = el.getBoundingClientRect();
                return { text: el.textContent.replace(/\s+/g, ' ').trim().slice(0, 120), x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.width), h: Math.round(r.height) };
            }),
            viewport: [innerWidth, innerHeight],
        };
    }
    if (!app.scheduler) throw new Error('адаптер не підключено');

    if (job.type === 'uds') {
        const r = await app.scheduler.run((elm) => elm.uds(ECU[job.ecu], fromHex(job.hex), { timeout: job.timeout ?? 6000 }));
        return { hex: toHex(r), length: r.length };
    }
    if (job.type === 'listen') {
        const ids = new Map();
        const t0 = Date.now();
        const res = await app.scheduler.run((elm) => elm.listen(job.can, job.mask, job.ms, (id, data) => {
            const e = ids.get(id) ?? { n: 0 };
            e.n++;
            e.last = toHex(data);
            ids.set(id, e);
        }));
        const secs = (Date.now() - t0) / 1000;
        return {
            overflow: res.overflow,
            secs,
            ids: Object.fromEntries([...ids].sort((a, b) => a[0] - b[0])
                .map(([id, e]) => [id.toString(16).toUpperCase().padStart(3, '0'), { hz: +(e.n / secs).toFixed(1), last: e.last }])),
        };
    }
    throw new Error(`невідома робота ${job.type}`);
}

export function startDevLink(app) {
    if (!['localhost', '127.0.0.1'].includes(location.hostname)) return;

    let pending = [];
    app.onLog = (line) => pending.push(`${new Date().toISOString().slice(11, 23)} ${line}`);

    const post = (url, body) => fetch(url, { method: 'POST', body }).catch(() => {});
    setInterval(() => {
        if (!pending.length) return;
        const batch = pending;
        pending = [];
        post('/api/log', batch.join('\n'));
    }, FLUSH_MS);

    let busy = false;
    setInterval(async () => {
        if (busy) return;
        busy = true;
        try {
            const r = await fetch('/api/job');
            if (r.status === 200) {
                const job = await r.json();
                let result;
                try {
                    result = { ok: true, ...(await runJob(app, job)) };
                } catch (e) {
                    result = { ok: false, kind: e.kind, nrc: e.nrc, error: e.message };
                }
                await post('/api/result', JSON.stringify({ job, result }));
            }
        } catch { /* сервер без каналу: тихо чекаємо */ }
        busy = false;
    }, POLL_MS);
}
