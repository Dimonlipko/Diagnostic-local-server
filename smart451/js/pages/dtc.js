// --- js/pages/dtc.js ---
import { ECU, NRC_TEXT } from '../proto/dids.js';
import { isRealDtc, lbcDescription, parseDtcList } from '../proto/dtc.js';
import { ICONS } from '../ui/icons.js';

const MAIN = ['BMS', 'CEPC', 'LE', 'OBL'];
const REST = Object.keys(ECU).filter((k) => !MAIN.includes(k));

const hex = (v) => v.toString(16).toUpperCase().padStart(3, '0');

export async function readDtcs(elm, name) {
    const r = await elm.uds(ECU[name], [0x19, 0x02, 0xFF], { timeout: 4000 });
    if (r[0] !== 0x59) throw new Error('неочікувана відповідь');
    return parseDtcList(r);
}

// LBC за мостом: 22 E019 → 62 E0 19 59 02 … (firmware/bridge/README.md).
async function readLbcDtcs(elm) {
    const r = await elm.uds(ECU.BMS, [0x22, 0xE0, 0x19], { timeout: 4000 });
    return parseDtcList(r.slice(3), lbcDescription);
}

/** Сканує блоки, кладе результат у store.dtc і лічильник для плитки. */
export async function sweep(ctx, names, onStep = () => {}) {
    const { scheduler, store } = ctx;
    store.dtcBusy = true;
    for (const name of names) {
        onStep(name);
        const entry = await scheduler.run(async (elm) => {
            try {
                const list = name === 'LBC' ? await readLbcDtcs(elm) : await readDtcs(elm, name);
                return { list };
            } catch (e) {
                return { error: e.kind === 'nodata' ? 'не відповідає' : e.message };
            }
        });
        store.dtc.set(name, entry);
        store.dtcRevision++;
    }
    store.dtcBusy = false;
    const real = [...store.dtc.values()].flatMap((r) => r.list ?? []).filter(isRealDtc);
    store.set('dtc_real', real.length);
}

const titleOf = (name) => ECU[name]?.title ?? 'LBC Twingo';

function ask(title, lines) {
    return new Promise((resolve) => {
        const dlg = document.createElement('dialog');
        dlg.className = 'confirm';
        const h = document.createElement('h2');
        h.textContent = title;
        dlg.append(h);
        for (const text of lines) {
            const p = document.createElement('p');
            p.textContent = text;
            dlg.append(p);
        }
        const bar = document.createElement('div');
        bar.className = 'confirm-bar';
        const no = document.createElement('button');
        no.type = 'button';
        no.className = 'btn';
        no.textContent = 'Скасувати';
        const yes = document.createElement('button');
        yes.type = 'button';
        yes.className = 'btn btn-danger';
        yes.textContent = 'Стерти';
        bar.append(no, yes);
        dlg.append(bar);
        const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
        no.addEventListener('click', () => done(false));
        yes.addEventListener('click', () => done(true));
        dlg.addEventListener('cancel', () => resolve(false));
        document.body.append(dlg);
        dlg.showModal();
        no.focus();           // випадковий Enter не повинен стирати
    });
}

// Причина блокування, або null. Швидкість має бути відома: на стоянці 0x200 дає нуль,
// а її відсутність означає, що стану машини ми просто не знаємо.
function blocked(store) {
    const v = store.fresh('speed');
    if (v === null) return 'Швидкість невідома: стирання доступне лише на стоянці.';
    if (v > 0) return 'Машина рухається: стирання доступне лише на стоянці.';
    return null;
}

function row(d) {
    const li = document.createElement('li');
    li.className = 'dtc';
    if (d.status & 0x01) li.classList.add('dtc-active');
    const code = document.createElement('b');
    code.textContent = d.code;
    const text = document.createElement('span');
    text.textContent = d.text ?? 'Код виробника: опису немає';
    const flags = document.createElement('small');
    flags.textContent = `0x${d.status.toString(16).toUpperCase().padStart(2, '0')} · ${d.flags.join(', ') || 'без прапорців'}`;
    li.append(code, text, flags);
    return li;
}

export default {
    id: 'dtc',
    title: 'Помилки',
    groups: ['drive'],        // швидкість потрібна для дозволу на стирання
    polls: [],

    render() {
        return `<div class="toolbar">
            <button type="button" class="btn" data-read>Прочитати основні</button>
            <button type="button" class="btn btn-ghost" data-all>Усі блоки</button>
            <button type="button" class="btn btn-danger-ghost" data-clear-all>${ICONS.trash}Стерти все</button>
            <label class="switch"><input type="checkbox" data-all-status><span></span><em>Показувати неактивні</em></label>
            <span class="toolbar-note" data-progress></span>
        </div>
        <div class="dtc-list" data-list></div>
        <p class="foot-note">Стирання працює лише на стоянці й після підтвердження. Назви заводських кодів Mercedes зберігаються поза CBF, тому для частини показаний тільки код.</p>`;
    },

    mount(root, ctx) {
        const list = () => [...MAIN, ...(ctx.store.get('is_bridge') ? ['LBC'] : [])];
        const go = async (names) => {
            if (ctx.store.dtcBusy) return;
            const p = root.querySelector('[data-progress]');
            await sweep(ctx, names, (n) => { p.textContent = `Читаємо ${n}…`; }).catch((e) => { p.textContent = e.message; });
            p.textContent = '';
        };
        root.querySelector('[data-read]').addEventListener('click', () => go(list()));
        root.querySelector('[data-all]').addEventListener('click', () => go([...list(), ...REST]));
        root.querySelector('[data-all-status]').addEventListener('change', () => this._draw(root, ctx));
        root.querySelector('[data-clear-all]').addEventListener('click', () => {
            const names = [...ctx.store.dtc].filter(([, r]) => r.list?.length).map(([n]) => n);
            this._clear(root, ctx, names);
        });
        root.querySelector('[data-list]').addEventListener('click', (e) => {
            const b = e.target.closest('[data-clear]');
            if (b) this._clear(root, ctx, [b.dataset.clear]);
        });
        this.drawn = -1;
        if (!ctx.store.dtc.size) go(list());
    },

    update(root, ctx) {
        if (this.drawn === ctx.store.dtcRevision) return;
        this.drawn = ctx.store.dtcRevision;
        this._draw(root, ctx);
    },

    async _clear(root, ctx, names) {
        const { store, scheduler } = ctx;
        const p = root.querySelector('[data-progress]');
        if (!names.length) {
            p.textContent = 'Нема що стирати: спершу прочитайте коди.';
            return;
        }
        const why = blocked(store);
        if (why) {
            p.textContent = why;
            return;
        }

        const count = (n) => store.dtc.get(n)?.list?.length ?? 0;
        const lines = [
            ...names.map((n) => `${titleOf(n)}: кодів ${count(n)}`),
            'Разом із кодами зникнуть збережені умови їх виникнення. Причину це не усуває: активна несправність повернеться.',
        ];
        if (store.fresh('hv_active')) lines.push('HV зараз увімкнено.');
        const title = names.length > 1 ? 'Стерти коди всіх блоків?' : `Стерти коди: ${titleOf(names[0])}?`;
        if (!await ask(title, lines)) return;

        const failed = [];
        for (const name of names) {
            p.textContent = `Стираємо ${titleOf(name)}…`;
            try {
                await scheduler.run((elm) => (name === 'LBC'
                    ? elm.clearDtc(ECU.BMS, { lbc: true })
                    : elm.clearDtc(ECU[name])));
            } catch (e) {
                failed.push(`${titleOf(name)}: ${NRC_TEXT[e.nrc] ?? e.message}`);
            }
        }

        await sweep(ctx, names, (n) => { p.textContent = `Перевіряємо ${n}…`; });
        const left = names.reduce((a, n) => a + count(n), 0);
        const parts = [left ? `Після стирання кодів: ${left}.` : 'Стерто, кодів не лишилось.'];
        if (failed.length) parts.push(`Не стерто: ${failed.join('; ')}.`);
        p.textContent = parts.join(' ');
    },

    _draw(root, { store }) {
        const showAll = root.querySelector('[data-all-status]').checked;
        const box = root.querySelector('[data-list]');
        const cards = [];
        for (const [name, r] of store.dtc) {
            const sec = document.createElement('section');
            sec.className = 'card';
            const head = document.createElement('header');
            head.className = 'card-head';
            const h = document.createElement('h2');
            const ecu = ECU[name];
            h.textContent = ecu ? ecu.title : 'LBC Twingo';
            const note = document.createElement('span');
            note.className = 'card-note';
            head.append(h, note);
            if (r.list?.length) {
                const del = document.createElement('button');
                del.type = 'button';
                del.className = 'btn btn-small btn-danger-ghost';
                del.dataset.clear = name;
                del.innerHTML = ICONS.trash;
                del.append('Стерти');
                head.append(del);
            }
            sec.append(head);

            if (r.error) {
                note.textContent = ecu ? `0x${hex(ecu.req)} · ${r.error}` : r.error;
            } else {
                const shown = showAll ? r.list : r.list.filter(isRealDtc);
                note.textContent = `${shown.length} із ${r.list.length}`;
                if (shown.length) {
                    const ul = document.createElement('ul');
                    ul.append(...shown.map(row));
                    sec.append(ul);
                } else {
                    const ok = document.createElement('p');
                    ok.className = 'dtc-ok';
                    ok.textContent = 'Активних і підтверджених кодів немає';
                    sec.append(ok);
                }
            }
            cards.push(sec);
        }
        box.replaceChildren(...cards);
    },
};
