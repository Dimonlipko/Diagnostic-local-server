// --- modules/elmInit.js ---
// Канонічна послідовність налаштування ELM327 і автоматичне відновлення.
//
// Адаптер може злетіти в дефолти посеред сесії: просадка живлення, внутрішній
// ресет, перепідключення BLE-модуля. Ознака — він починає повертати ехо
// відправлених команд (ATE1) і перестає віддавати кадри 0x7BB. Watchdog
// звʼязку такого не ловить: байти ж ідуть, просто не ті.
//
// Логер передається параметром — модуль навмисно не імпортує ui.js, щоб не
// плодити цикл ui -> canProtocol -> elmInit -> ui.

import { state } from './state.js';

export const ELM_INIT_COMMANDS = [
    { cmd: 'ATE0',     desc: 'Вимкнення ехо',                     wait: 500 },
    { cmd: 'ATL0',     desc: 'Вимкнення переносів (Linefeeds)',   wait: 300 },
    { cmd: 'ATH1',     desc: 'Заголовки (ID) ON',                 wait: 300 },
    { cmd: 'ATS0',     desc: 'Пробіли OFF',                       wait: 100 },
    { cmd: 'ATSP6',    desc: 'Встановлення протоколу CAN',        wait: 400 },
    { cmd: 'ATCAF0',   desc: 'CAN Auto Formatting OFF',           wait: 300 },
    { cmd: 'ATAL',     desc: 'Allow Long messages',               wait: 300 },
    { cmd: 'ATCRA7BB', desc: 'CAN Receive Address = 7BB',         wait: 300 },
    { cmd: 'ATSH79B',  desc: 'Встановлення ID запиту',            wait: 300 },
    { cmd: 'ATST32',   desc: 'Timeout 200ms (для ISO-TP CF)',     wait: 100 }
];

const REINIT_COOLDOWN_MS = 20000;

let reinitInProgress = false;
let lastReinitAt = 0;

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

/**
 * Проганяє послідовність налаштування через поточний state.writer.
 * @param {Object} options — { reset: спершу ATZ, log: функція логування }
 */
export async function runElmInit({ reset = false, log = null } = {}) {
    if (!state.writer) throw new Error('Немає writer для ініціалізації ELM');

    if (reset) {
        if (log) log('[INIT] Скидання адаптера (ATZ)...');
        await state.writer.write('ATZ\r');
        await sleep(1200);
    }

    for (const item of ELM_INIT_COMMANDS) {
        if (log) log(`[INIT] ${item.desc}...`);
        await state.writer.write(`${item.cmd}\r`);
        await sleep(item.wait);
    }

    // Кеш останнього ATSH більше не відповідає адаптеру, поки ми його не
    // перевстановили — після init він гарантовано 79B.
    state.lastSetHeader = '79B';
}

/**
 * Відновлення після втрати конфігурації. Ідемпотентне, з кулдауном: якщо
 * адаптер помер остаточно, немає сенсу ганяти init щосекунди.
 * @returns {Promise<boolean>} чи виконувалась спроба
 */
export async function reinitAdapter(reason, log = null) {
    if (reinitInProgress) return false;
    if (!state.isConnected || !state.writer) return false;
    if (Date.now() - lastReinitAt < REINIT_COOLDOWN_MS) return false;

    reinitInProgress = true;
    lastReinitAt = Date.now();

    // Опитування на час init глушимо, щоб UDS-запити не перемішувались із
    // AT-командами. pollingManager береться з window — статичний імпорт створив
    // би цикл canProtocol -> elmInit -> pollingManager -> canProtocol.
    const poller = (typeof window !== 'undefined') ? window.pollingManager : null;
    if (poller) poller.stopAllPolling();

    try {
        if (log) log(`⚠ Переініціалізація адаптера: ${reason}`);
        await runElmInit({ log });
        if (log) log('✓ Адаптер переналаштовано.');

        // Повертаємо опитування поточної сторінки
        const activePageButton = (typeof document !== 'undefined')
            ? document.querySelector('.sidebar .nav-button.active[data-page-file]')
            : null;
        if (activePageButton) activePageButton.click();

        return true;
    } catch (e) {
        if (log) log(`Не вдалось переналаштувати адаптер: ${e.message}`);
        return false;
    } finally {
        reinitInProgress = false;
    }
}

/** Скидає кулдаун — щоб свіже підключення могло відновлюватись одразу. */
export function resetReinitState() {
    lastReinitAt = 0;
    reinitInProgress = false;
}
