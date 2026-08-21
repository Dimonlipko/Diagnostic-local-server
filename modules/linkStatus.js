// --- modules/linkStatus.js ---
// Єдина точка виявлення втрати звʼязку з адаптером для обох транспортів
// (WebSerial і WebBluetooth). Раніше кожен з них при відвалі адаптера просто
// писав помилку в лог, лишаючи state.isConnected = true — UI показував
// підключення, якого вже не було, а опитування крутилось у порожнечу.

import { state } from './state.js';
import { logMessage, updateConnectionTabs } from './ui.js';
import { stopAllPolling } from './pollingManager.js';

// Скільки терпіти тишу від адаптера ПІСЛЯ надісланої команди.
// ELM327 на ATST32 відповідає за ~200 мс навіть як NO DATA / CAN ERROR,
// тож 6 с — це вже не «шина мовчить», а «адаптера немає».
const RX_SILENCE_MS = 6000;

let watchdogTimer = null;
let lastRxAt = 0;
let lastTxAt = 0;
let graceUntil = 0;

// Тишу оголосив watchdog, а не подія від'єднання — отже це лише припущення,
// і його треба відкликати, щойно від адаптера знову підуть дані.
let awaitingRecovery = false;

export function noteRxActivity() {
    lastRxAt = Date.now();
    if (awaitingRecovery) recoverLink();
}

export function noteTxActivity() {
    lastTxAt = Date.now();
}

/**
 * @param {number} graceMs — скільки терпіти тишу на старті. Потрібно там, де
 *        мовчання очікуване: після OTA ECU перезавантажується в новий застосунок
 *        і кілька секунд фізично не може відповідати.
 */
export function startLinkWatchdog(graceMs = 0) {
    stopLinkWatchdog();
    lastRxAt = Date.now();
    lastTxAt = 0;
    graceUntil = Date.now() + graceMs;

    watchdogTimer = setInterval(() => {
        if (!state.isConnected) return;
        if (Date.now() < graceUntil) return;

        // Тиша рахується лише коли ми справді щось спитали і не дочекались.
        // Без цієї умови простій без опитування давав би хибну тривогу.
        if (lastTxAt <= lastRxAt) return;
        if (Date.now() - lastRxAt < RX_SILENCE_MS) return;

        handleLinkLost(`адаптер не відповідає понад ${RX_SILENCE_MS / 1000} с`, true);
    }, 1000);
}

/**
 * Дані пішли після того, як watchdog поспішив із вироком. Повертаємо стан і
 * опитування — інакше хибне спрацювання вимагало б ручного перепідключення,
 * хоча адаптер увесь час був живий.
 */
function recoverLink() {
    awaitingRecovery = false;
    if (state.isConnected) return;

    state.isConnected = true;
    logMessage('✓ Звʼязок з адаптером відновлено.');
    updateConnectionTabs();
    startLinkWatchdog();

    const connectButton = document.getElementById('connectButton');
    if (connectButton) connectButton.textContent = 'Відключити';

    // Опитування зупинилось разом із хибним вироком — перезапускаємо сторінку
    const activePageButton = document.querySelector('.sidebar .nav-button.active[data-page-file]');
    if (activePageButton) activePageButton.click();
}

export function stopLinkWatchdog() {
    if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
    }
    awaitingRecovery = false;
}

/**
 * Викликається при будь-якому виявленні обриву: подія відключення пристрою,
 * помилка циклу читання або мовчання по watchdog. Ідемпотентна.
 *
 * @param {boolean} recoverable — вирок винесено за мовчанням, а не за подією
 *        від'єднання. Такий стан скасовується сам, щойно підуть дані.
 */
export function handleLinkLost(reason, recoverable = false) {
    if (!state.isConnected) return; // вже оброблено або ще не підключались

    state.isConnected = false;
    stopLinkWatchdog();
    awaitingRecovery = recoverable;
    stopAllPolling();

    logMessage(`⚠ Звʼязок з адаптером втрачено: ${reason}`);
    updateConnectionTabs();

    const connectButton = document.getElementById('connectButton');
    if (connectButton) connectButton.textContent = 'Підключити';
}
