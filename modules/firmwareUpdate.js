// firmwareUpdate.js - Модуль для оновлення прошивки ECU через CAN

import { state } from './state.js';
import { logMessage } from './ui.js';

/**
 * Конфігурація для оновлення прошивки
 */
const FIRMWARE_CONFIG = {
    canRequestId: '79B',     // CAN ID для відправки запитів
    canResponseId: '7BB',    // CAN ID для отримання відповідей
    deviceToken: 'CAFEFACE', // Токен пристрою (за замовчуванням)
    bootloaderDelay: 5000,   // Затримка для перезавантаження (мс)
    blockSize: 4,            // Розмір блоку даних (байти)
    delayBetweenBlocks: 20   // Затримка між блоками (мс)
};

/**
 * Інвертує порядок байтів у hex рядку
 * Наприклад: "DEADBEEF" -> "EFBEADDE"
 * @param {string} hexString - Hex рядок (парна кількість символів)
 * @returns {string} - Інвертований hex рядок
 */
function invertBytes(hexString) {
    const bytes = [];
    for (let i = 0; i < hexString.length; i += 2) {
        bytes.push(hexString.substring(i, i + 2));
    }
    return bytes.reverse().join('');
}

/**
 * Конвертує число у hex рядок з ведучими нулями
 * @param {number} num - Число для конвертації
 * @param {number} bytes - Кількість байтів
 * @returns {string} - Hex рядок
 */
function toHex(num, bytes = 1) {
    return num.toString(16).toUpperCase().padStart(bytes * 2, '0');
}

/**
 * Відправляє raw CAN команду через ELM327
 * @param {string} canId - CAN ID (наприклад, "79B")
 * @param {string} data - Hex дані для відправки
 * @returns {Promise<boolean>} - true якщо успішно
 */
async function sendRawCan(canId, data) {
    if (!state.writer || !state.isConnected) {
        throw new Error('Адаптер не підключено');
    }

    try {
        // Встановлюємо CAN ID
        await state.writer.write(`ATSH${canId}\r`);
        await new Promise(resolve => setTimeout(resolve, 10));

        // Відправляємо дані
        await state.writer.write(`${data}\r`);
        await new Promise(resolve => setTimeout(resolve, FIRMWARE_CONFIG.delayBetweenBlocks));

        return true;
    } catch (error) {
        console.error('Помилка відправки CAN:', error);
        return false;
    }
}

/**
 * Ініціалізує режим оновлення прошивки
 * - Вимикає ISOTP
 * - Дозволяє 8-байтні пакети
 * @returns {Promise<boolean>}
 */
async function initializeFirmwareMode() {
    if (!state.writer || !state.isConnected) {
        throw new Error('Адаптер не підключено');
    }

    try {
        logMessage('Ініціалізація режиму оновлення...');

        // Вимикаємо ISOTP (CAN Auto Formatting)
        await state.writer.write('ATCAF0\r');
        await new Promise(resolve => setTimeout(resolve, 100));
        logMessage('ISOTP вимкнено (ATCAF0)');

        // Дозволяємо 8-байтні пакети (Allow Long)
        await state.writer.write('ATAL\r');
        await new Promise(resolve => setTimeout(resolve, 100));
        logMessage('8-байтні пакети дозволено (ATAL)');

        return true;
    } catch (error) {
        logMessage(`Помилка ініціалізації: ${error.message}`);
        return false;
    }
}

/**
 * Відновлює нормальний режим роботи адаптера
 * @returns {Promise<boolean>}
 */
async function restoreNormalMode() {
    if (!state.writer || !state.isConnected) {
        return false;
    }

    try {
        logMessage('Відновлення нормального режиму...');

        // Вмикаємо ISOTP назад
        await state.writer.write('ATCAF1\r');
        await new Promise(resolve => setTimeout(resolve, 100));

        // Скидаємо налаштування
        await state.writer.write('ATD\r');
        await new Promise(resolve => setTimeout(resolve, 100));

        logMessage('Нормальний режим відновлено');
        return true;
    } catch (error) {
        logMessage(`Помилка відновлення: ${error.message}`);
        return false;
    }
}

/**
 * Відправляє команду входу в bootloader
 * @param {string} deviceToken - Токен пристрою (hex)
 * @returns {Promise<boolean>}
 */
async function enterBootloaderMode(deviceToken) {
    try {
        // Формуємо пакет для входу в bootloader
        // Формат: DEADBEEF (інвертований) + TOKEN (інвертований)
        const bootCommand = invertBytes('DEADBEEF');
        const tokenInverted = invertBytes(deviceToken);
        const payload = bootCommand + tokenInverted;

        logMessage(`Вхід в режим bootloader...`);
        logMessage(`Payload: ${payload}`);

        // Відправляємо команду
        const success = await sendRawCan(FIRMWARE_CONFIG.canRequestId, payload);

        if (!success) {
            throw new Error('Не вдалося відправити команду bootloader');
        }

        logMessage(`Очікування перезавантаження пристрою (${FIRMWARE_CONFIG.bootloaderDelay / 1000} сек)...`);
        await new Promise(resolve => setTimeout(resolve, FIRMWARE_CONFIG.bootloaderDelay));

        return true;
    } catch (error) {
        logMessage(`Помилка входу в bootloader: ${error.message}`);
        return false;
    }
}

/**
 * Відправляє блок даних прошивки
 * @param {number} blockNumber - Номер блоку (починаючи з 0)
 * @param {Uint8Array} blockData - Дані блоку (4 байти, доповнені нулями якщо менше)
 * @returns {Promise<boolean>}
 */
async function sendFirmwareBlock(blockNumber, blockData) {
    try {
        // Адреса блоку
        const addrLow = blockNumber % 256;      // Молодший байт адреси
        const addrHigh = Math.floor(blockNumber / 256); // Старший байт адреси

        // Формуємо пакет: FF ADDRL ADDRH BYTE0 BYTE1 BYTE2 BYTE3
        let packet = 'FF' + toHex(addrLow) + toHex(addrHigh);

        // Додаємо дані блоку (4 байти)
        for (let i = 0; i < 4; i++) {
            const byte = i < blockData.length ? blockData[i] : 0;
            packet += toHex(byte);
        }

        // Відправляємо блок
        return await sendRawCan(FIRMWARE_CONFIG.canRequestId, packet);
    } catch (error) {
        console.error(`Помилка відправки блоку ${blockNumber}:`, error);
        return false;
    }
}

/**
 * Завершує процес оновлення прошивки
 * @returns {Promise<boolean>}
 */
async function finalizeFirmwareUpdate() {
    try {
        // Відправляємо фінальну команду: C0DEFADE (інвертовану)
        const finalCommand = invertBytes('C0DEFADE');

        logMessage('Завершення оновлення прошивки...');
        logMessage(`Final command: ${finalCommand}`);

        const success = await sendRawCan(FIRMWARE_CONFIG.canRequestId, finalCommand);

        if (!success) {
            throw new Error('Не вдалося відправити фінальну команду');
        }

        return true;
    } catch (error) {
        logMessage(`Помилка завершення: ${error.message}`);
        return false;
    }
}

/**
 * Головна функція оновлення прошивки
 * @param {Uint8Array} firmwareData - Дані прошивки (.bin файл)
 * @param {Function} progressCallback - Callback для оновлення прогресу (blockNumber, totalBlocks)
 * @param {string} deviceToken - Токен пристрою (опціонально)
 * @returns {Promise<boolean>}
 */
export async function updateFirmware(firmwareData, progressCallback = null, deviceToken = null) {
    const token = deviceToken || FIRMWARE_CONFIG.deviceToken;
    const totalBlocks = Math.ceil(firmwareData.length / FIRMWARE_CONFIG.blockSize);

    try {
        // Крок 1: Ініціалізація режиму оновлення
        logMessage('=== ПОЧАТОК ОНОВЛЕННЯ ПРОШИВКИ ===');
        logMessage(`Розмір прошивки: ${firmwareData.length} байт`);
        logMessage(`Кількість блоків: ${totalBlocks}`);

        const initSuccess = await initializeFirmwareMode();
        if (!initSuccess) {
            throw new Error('Не вдалося ініціалізувати режим оновлення');
        }

        // Крок 2: Вхід в bootloader
        const bootSuccess = await enterBootloaderMode(token);
        if (!bootSuccess) {
            throw new Error('Не вдалося увійти в режим bootloader');
        }

        // Крок 3: Відправка блоків прошивки
        logMessage('Відправка прошивки...');

        for (let blockNum = 0; blockNum < totalBlocks; blockNum++) {
            const offset = blockNum * FIRMWARE_CONFIG.blockSize;
            const blockData = firmwareData.slice(offset, offset + FIRMWARE_CONFIG.blockSize);

            const success = await sendFirmwareBlock(blockNum, blockData);

            if (!success) {
                throw new Error(`Помилка відправки блоку ${blockNum}`);
            }

            // Оновлюємо прогрес
            if (progressCallback) {
                progressCallback(blockNum + 1, totalBlocks);
            }

            // Логуємо прогрес кожні 100 блоків
            if ((blockNum + 1) % 100 === 0) {
                const percent = ((blockNum + 1) / totalBlocks * 100).toFixed(1);
                logMessage(`Прогрес: ${blockNum + 1}/${totalBlocks} блоків (${percent}%)`);
            }
        }

        logMessage(`Всі блоки відправлено: ${totalBlocks}/${totalBlocks}`);

        // Крок 4: Завершення оновлення
        const finalizeSuccess = await finalizeFirmwareUpdate();
        if (!finalizeSuccess) {
            throw new Error('Не вдалося завершити оновлення');
        }

        // Крок 5: Відновлення нормального режиму
        await restoreNormalMode();

        logMessage('=== ОНОВЛЕННЯ ЗАВЕРШЕНО УСПІШНО ===');
        return true;

    } catch (error) {
        logMessage(`ПОМИЛКА ОНОВЛЕННЯ: ${error.message}`);

        // Спробуємо відновити нормальний режим навіть у разі помилки
        try {
            await restoreNormalMode();
        } catch (e) {
            console.error('Не вдалося відновити нормальний режим:', e);
        }

        return false;
    }
}

/**
 * Оновлює конфігурацію оновлення
 * @param {Object} config - Об'єкт з параметрами конфігурації
 */
export function setFirmwareConfig(config) {
    if (config.canRequestId) FIRMWARE_CONFIG.canRequestId = config.canRequestId;
    if (config.canResponseId) FIRMWARE_CONFIG.canResponseId = config.canResponseId;
    if (config.deviceToken) FIRMWARE_CONFIG.deviceToken = config.deviceToken;
}

/**
 * Повертає поточну конфігурацію
 * @returns {Object}
 */
export function getFirmwareConfig() {
    return { ...FIRMWARE_CONFIG };
}
