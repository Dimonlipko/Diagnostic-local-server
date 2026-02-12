// socMapPage.js - Обробка сторінки SOC Map

import { state } from './state.js';
import { logMessage } from './ui.js';
import { sendCanRequest } from './canProtocol.js';

/**
 * Конвертує число в hex рядок з ведучими нулями
 * @param {number} num - Число для конвертації
 * @param {number} bytes - Кількість байтів
 * @returns {string} - Hex рядок
 */
function toHex(num, bytes = 1) {
    return num.toString(16).toUpperCase().padStart(bytes * 2, '0');
}

/**
 * Відправляє команду запису калібрування SOC
 * @param {number} value - Значення (0 або 1)
 * @returns {Promise<boolean>}
 */
async function writeCalibrationMode(value) {
    if (!state.isConnected || !state.writer) {
        logMessage('ПОМИЛКА: Адаптер не підключено');
        return false;
    }

    try {
        const hexValue = toHex(value);
        const command = `2e0113${hexValue}`;

        logMessage(`Запис режиму калібрування: ${value === 1 ? 'ON' : 'OFF'}`);
        await sendCanRequest('79B', command);

        // Затримка для обробки
        await new Promise(resolve => setTimeout(resolve, 100));

        return true;
    } catch (error) {
        logMessage(`Помилка запису калібрування: ${error.message}`);
        return false;
    }
}

/**
 * Відправляє команду запису SOC значення
 * @param {number} socLevel - Рівень SOC (0-10, де 10 = 100%)
 * @param {number} voltage - Напруга в мВ
 * @returns {Promise<boolean>}
 */
async function writeSOCValue(socLevel, voltage) {
    if (!state.isConnected || !state.writer) {
        logMessage('ПОМИЛКА: Адаптер не підключено');
        return false;
    }

    try {
        // Формуємо команду: 2e011200-2e01120a
        const levelHex = socLevel < 10 ? `0${socLevel}` : `0a`;

        // Напруга - 2 байти (big endian)
        const voltageHigh = Math.floor(voltage / 256);
        const voltageLow = voltage % 256;
        const voltageHex = toHex(voltageHigh) + toHex(voltageLow);

        const command = `2e0112${levelHex}${voltageHex}`;

        logMessage(`Запис SOC ${socLevel * 10}%: ${voltage} mV (команда: ${command})`);
        await sendCanRequest('79B', command);

        // Затримка для обробки
        await new Promise(resolve => setTimeout(resolve, 100));

        return true;
    } catch (error) {
        logMessage(`Помилка запису SOC ${socLevel * 10}%: ${error.message}`);
        return false;
    }
}

/**
 * Обробник кнопки запису режиму калібрування
 */
async function handleWriteCalibration() {
    const select = document.getElementById('writeCalibrationMode');
    if (!select) return;

    const value = parseInt(select.value);
    const success = await writeCalibrationMode(value);

    if (success) {
        logMessage(`Режим калібрування успішно записано: ${value === 1 ? 'ON' : 'OFF'}`);
    } else {
        logMessage('Помилка запису режиму калібрування');
    }
}

/**
 * Обробник кнопки запису SOC значення
 * @param {number} socLevel - Рівень SOC (0-10)
 */
async function handleWriteSOC(socLevel) {
    const input = document.getElementById(`writeSOC${socLevel * 10}Input`);
    if (!input) return;

    const voltage = parseInt(input.value);

    if (isNaN(voltage)) {
        logMessage(`ПОМИЛКА: Введіть коректне значення напруги для SOC ${socLevel * 10}%`);
        return;
    }

    if (voltage < 0 || voltage > 65535) {
        logMessage(`ПОМИЛКА: Напруга має бути в діапазоні 0-65535 mV`);
        return;
    }

    const success = await writeSOCValue(socLevel, voltage);

    if (success) {
        logMessage(`SOC ${socLevel * 10}% успішно записано: ${voltage} mV`);
        input.value = ''; // Очищаємо поле після запису
    } else {
        logMessage(`Помилка запису SOC ${socLevel * 10}%`);
    }
}

/**
 * Ініціалізує обробники подій для сторінки SOC Map
 */
export function initSocMapPage() {
    // Обробник кнопки запису калібрування
    const calibrationBtn = document.getElementById('writeCalibrationBtn');
    if (calibrationBtn) {
        calibrationBtn.addEventListener('click', handleWriteCalibration);
    }

    // Обробники кнопок запису SOC значень
    for (let i = 0; i <= 10; i++) {
        const btn = document.getElementById(`writeSOC${i * 10}Btn`);
        if (btn) {
            btn.addEventListener('click', () => handleWriteSOC(i));
        }
    }
}

/**
 * Очищує стан сторінки SOC Map
 */
export function cleanupSocMapPage() {
    // Очищаємо поля вводу
    for (let i = 0; i <= 10; i++) {
        const input = document.getElementById(`writeSOC${i * 10}Input`);
        if (input) input.value = '';
    }
}
