// --- app.js (ПОВНІСТЮ ОНОВЛЕНИЙ) ---

import { state } from './modules/state.js';
import { DEFAULT_PAGE } from './modules/config.js';
import { setLanguage, initLanguageSwitcher } from './modules/translator.js';
import { initNavigation, loadPage, initPageEventListeners, logMessage } from './modules/ui.js';
import { connectAdapter, disconnectAdapter } from './modules/webSerial.js';
import { sendCanRequest } from './modules/canProtocol.js'; 
import { connectBleAdapter } from './modules/webBluetooth.js'; // Використовуємо універсальну функцію

// ===============================================
// БЛОК ДЛЯ ЗАПИСУ ДАНИХ
// ===============================================

/**
 * Форматує значення від користувача у готове CAN-повідомлення.
 */
function formatCanMessage(param, value) {
    if (!window.PARAMETER_REGISTRY) {
        logMessage("ПОМИЛКА: Внутрішня: PARAMETER_REGISTRY не знайдено.");
        return null;
    }

    const config = window.PARAMETER_REGISTRY[param]?.writeConfig;
    if (!config) {
        logMessage(`ПОМИЛКА: Не знайдено 'writeConfig' для "${param}"`);
        return null;
    }

    let numericValue = parseFloat(value); 
    if (isNaN(numericValue)) {
        logMessage(`ПОМИЛКА: Значення "${value}" для "${param}" не є числом.`);
        return null;
    }

    if (config.multiplier) {
        numericValue = Math.round(numericValue * config.multiplier);
    }

    let hexValue;
    const totalHexLength = config.bytes * 2; 

    if (config.signed) {
        const mask = Math.pow(2, config.bytes * 8) - 1;
        hexValue = (numericValue & mask).toString(16);
    } else {
        if (numericValue < 0) {
            logMessage(`ПОМИЛКА: "${param}" не приймає від'ємні значення.`);
            return null;
        }
        hexValue = numericValue.toString(16);
    }

    const paddedHexValue = hexValue.padStart(totalHexLength, '0');
    
    if (paddedHexValue.length > totalHexLength) {
        logMessage(`ПОМИЛКА: Значення ${numericValue} завелике для ${config.bytes} байт.`);
        return null;
    }
    
    const finalData = config.dataPrefix + paddedHexValue;
    
    return {
        canId: config.canId,
        data: finalData.toUpperCase()
    };
}

/**
 * РЕАЛЬНИЙ обробник для onWrite
 */
async function handleWrite(paramKey, value) {
    if (!state.isConnected) {
        logMessage("ПОМИЛKA: Адаптер не підключено.");
        return;
    }
    
    logMessage(`Спроба запису: ${paramKey} = ${value}`);
    const canMessage = formatCanMessage(paramKey, value);
    
    if (!canMessage) return;
    
    try {
        const success = await sendCanRequest(canMessage.canId, canMessage.data); 
        if (success) {
            logMessage(`[WRITE ✓] ${paramKey} = ${value} (CAN: ${canMessage.data})`);
        } else {
            logMessage(`[WRITE ✗] Помилка відправки для ${paramKey}`);
        }
    } catch (e) {
        logMessage(`[WRITE ✗] Критична помилка відправки: ${e.message}`);
    }
}

// ===============================================
// ІНІЦІАЛІЗАЦІЯ ТА ОБРОБНИКИ UI
// ===============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM завантажено, ініціалізація...');

    initLanguageSwitcher();
    initNavigation();

    // Ініціалізація подій для сторінок (Кнопки запису, Термінал тощо)
    initPageEventListeners({
        onWrite: handleWrite,
        onToggle: (param, val) => logMessage(`Заглушка: onToggle ${param}=${val}`),
        
        onTerminalSend: async (command) => {
            if (!state.isConnected) {
                logMessage("ПОМИЛКА: Адаптер не підключено.");
                return;
            }

            const writer = state.writer || state.bleWriter;
            if (writer) {
                try {
                    // Перериваємо поточну операцію адаптера
                    await writer.write('\r'); 
                    await new Promise(r => setTimeout(r, 100));

                    logMessage(`> ${command.toUpperCase()}`);
                    
                    // Вимикаємо ехо перед відправкою для чистоти терміналу
                    await writer.write('ATE0\r');
                    await new Promise(r => setTimeout(r, 50));
                    
                    await writer.write(command.toUpperCase() + '\r');
                } catch (err) {
                    logMessage(`ПОМИЛКА ТЕРМІНАЛУ: ${err.message}`);
                }
            }
        }
    });

    // --- КЕРУВАННЯ ПІДКЛЮЧЕННЯМ (НОВЕ: 2 іконки) ---

    const btnSerial = document.getElementById('btnConnectSerial');
    const btnBle = document.getElementById('btnConnectBle');

    // Функція оновлення вигляду іконок
    function updateUIConnectionState(activeType) {
        if (btnSerial) btnSerial.classList.toggle('active', activeType === 'serial');
        if (btnBle) btnBle.classList.toggle('active', activeType === 'ble');
    }

    // Обробник для USB / Serial
    if (btnSerial) {
        btnSerial.addEventListener('click', async () => {
            if (state.isConnected) {
                await disconnectAdapter();
                updateUIConnectionState(null);
                return;
            }
            try {
                logMessage("Запуск Web Serial...");
                const success = await connectAdapter();
                if (success) updateUIConnectionState('serial');
            } catch (err) {
                logMessage(`ПОМИЛКА Serial: ${err.message}`);
            }
        });
    }

    // Обробник для Bluetooth BLE
    if (btnBle) {
        btnBle.addEventListener('click', async () => {
            if (state.isConnected) {
                // Універсальне відключення
                if (state.connectionType === 'ble') {
                    // Якщо у тебе є метод bluetoothManager.disconnect() - виклич його тут
                    state.isConnected = false; 
                } else {
                    await disconnectAdapter();
                }
                updateUIConnectionState(null);
                return;
            }
            try {
                logMessage("Запуск BLE...");
                const success = await connectBleAdapter();
                if (success) updateUIConnectionState('ble');
            } catch (err) {
                logMessage(`ПОМИЛКА BLE: ${err.message}`);
            }
        });
    }

    // --- ЗАВАНТАЖЕННЯ СТОРІНОК ТА МОВИ ---

    const savedLang = localStorage.getItem('appLanguage') || 'uk';
    setLanguage(savedLang);

    const defaultNavButton = document.querySelector(`[data-page-file="${DEFAULT_PAGE}"]`);
    if (defaultNavButton) {
        defaultNavButton.classList.add('active');
        loadPage(DEFAULT_PAGE);
    }
});