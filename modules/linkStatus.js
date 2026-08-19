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

export function noteRxActivity() {
    lastRxAt = Date.now();
}

export function noteTxActivity() {
    lastTxAt = Date.now();
}

export function startLinkWatchdog() {
    stopLinkWatchdog();
    lastRxAt = Date.now();
    lastTxAt = 0;

    watchdogTimer = setInterval(() => {
        if (!state.isConnected) return;

        // Тиша рахується лише коли ми справді щось спитали і не дочекались.
        // Без цієї умови простій без опитування давав би хибну тривогу.
        if (lastTxAt <= lastRxAt) return;
        if (Date.now() - lastRxAt < RX_SILENCE_MS) return;

        handleLinkLost(`адаптер не відповідає понад ${RX_SILENCE_MS / 1000} с`);
    }, 1000);
}

export function stopLinkWatchdog() {
    if (watchdogTimer) {
        clearInterval(watchdogTimer);
        watchdogTimer = null;
    }
}

/**
 * Викликається при будь-якому виявленні обриву: подія відключення пристрою,
 * помилка циклу читання або мовчання по watchdog. Ідемпотентна.
 */
export function handleLinkLost(reason) {
    if (!state.isConnected) return; // вже оброблено або ще не підключались

    state.isConnected = false;
    stopLinkWatchdog();
    stopAllPolling();

    logMessage(`⚠ Звʼязок з адаптером втрачено: ${reason}`);
    updateConnectionTabs();

    const connectButton = document.getElementById('connectButton');
    if (connectButton) connectButton.textContent = 'Підключити';
}
