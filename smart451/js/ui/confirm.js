// --- js/ui/confirm.js ---
// Модальне підтвердження перед дією, що щось змінює в машині. Текст іде через
// textContent: у рядках бувають значення, прочитані з ECU.

/**
 * @param {string} title
 * @param {string[]} lines
 * @param {{yes?: string}} [o]  підпис кнопки дії
 * @returns {Promise<boolean>}
 */
export function ask(title, lines, { yes = 'Так' } = {}) {
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
        const ok = document.createElement('button');
        ok.type = 'button';
        ok.className = 'btn btn-danger';
        ok.textContent = yes;
        bar.append(no, ok);
        dlg.append(bar);
        const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
        no.addEventListener('click', () => done(false));
        ok.addEventListener('click', () => done(true));
        dlg.addEventListener('cancel', () => resolve(false));
        document.body.append(dlg);
        dlg.showModal();
        no.focus();           // випадковий Enter не повинен підтверджувати
    });
}

/** Причина заборони змін на ходу, або null. Невідома швидкість — теж заборона. */
export function blockedWhileMoving(store, what) {
    const v = store.fresh('speed');
    if (v === null) return `Швидкість невідома: ${what} доступне лише на стоянці.`;
    if (v > 0) return `Машина рухається: ${what} доступне лише на стоянці.`;
    return null;
}
