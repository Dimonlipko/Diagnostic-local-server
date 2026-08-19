// webSerisl.js

import { state } from './state.js';
import { BAUD_RATE } from './config.js';
// 💡 ВИПРАВЛЕНО: Додано logMessage до імпорту (він використовувався, але не імпортувався)
import { logMessage, updateUI } from './ui.js'; 
import { parseCanResponse, sendPendingFlowControl } from './canProtocol.js';
import { handleCanResponse, stopAllPolling } from './pollingManager.js';
import { updateConnectionTabs } from './ui.js';
import {
    noteRxActivity, noteTxActivity,
    startLinkWatchdog, stopLinkWatchdog, handleLinkLost
} from './linkStatus.js';

let lineBuffer = "";

// Фізичне від'єднання USB-адаптера WebSerial повідомляє окремою подією.
// Без неї обрив помічався б лише коли читання впаде або настане таймаут.
if ('serial' in navigator) {
    navigator.serial.addEventListener('disconnect', (event) => {
        if (state.port && event.target === state.port) {
            handleLinkLost("USB-адаптер від'єднано");
        }
    });
}

// ... (Функції readWithTimeout, detectAdapterType, initializeAdapter залишаються БЕЗ ЗМІН) ...
// ... (Вони у вас реалізовані добре) ...


// --- (Копіюю ваші функції звідси для повноти) ---

async function readWithTimeout(timeoutMs) {
    const startTime = Date.now();
    let fullResponse = "";
    
    while (Date.now() - startTime < timeoutMs) {
        let timeoutId;
        const timeoutPromise = new Promise((resolve) => {
            const remaining = timeoutMs - (Date.now() - startTime);
            timeoutId = setTimeout(() => resolve({ value: null, done: false, timeout: true }), remaining);
        });
        
        const readPromise = state.reader.read();
        const result = await Promise.race([readPromise, timeoutPromise]);
        clearTimeout(timeoutId);

        if (result.timeout) {
            if (fullResponse.length > 0) {
                return { value: fullResponse, done: false, timeout: false };
            }
            return { value: null, done: false, timeout: true };
        }

        if (result.value) {
            const decodedValue = new TextDecoder().decode(result.value);
            fullResponse += decodedValue;
            
            if (decodedValue.includes('\r') || decodedValue.includes('\n') || decodedValue.includes('>')) {
                return { value: fullResponse, done: false, timeout: false };
            }
            
            continue;
        }
        
        if (result.done) {
            return { value: fullResponse.length > 0 ? fullResponse : null, done: true, timeout: false };
        }
    }
    
    if (fullResponse.length > 0) {
        return { value: fullResponse, done: false, timeout: false };
    }
    return { value: null, done: false, timeout: true };
}

async function detectAdapterType() {
    lineBuffer = "";
    
    // КРОК 0: Спробуємо вимкнути ехо
    logMessage("Крок 0: Спроба вимкнути ехо (ATE0)...");
    await state.writer.write("ATE0\r");
    
    const { value: v0, timeout: t0 } = await readWithTimeout(2000); // ЗБІЛЬШЕНО таймаут
    
    if (v0 && !t0) {
        let cleaned = v0.trim().toUpperCase();
        // ВИПРАВЛЕНО: Прибираємо ехо команди
        cleaned = cleaned.replace(/^ATE0[\r\n]*/g, '').replace(/[\r\n]*ATE0$/g, '');
        cleaned = cleaned.trim();
        
        logMessage(`Відповідь на 'ATE0': [${cleaned}]`);
        
        if (cleaned.includes('OK')) {
            logMessage("✓ Виявлено ELM327 адаптер (ехо вимкнено)!");
            state.echoOff = true;
            return 'elm327';
        }
    }
    
    // Додаткова затримка перед наступною командою
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // КРОК 1: Перевірка ELM327 через ATI
    logMessage("Крок 1: Перевірка ELM327 'ATI'...");
    await state.writer.write("ATI\r");
    
    const { value: v1, timeout: t1 } = await readWithTimeout(2000); // ЗБІЛЬШЕНО таймаут
    
    if (v1 && !t1) {
        let cleaned = v1.trim().toUpperCase();
        // ВИПРАВЛЕНО: Прибираємо всі входження "ATI" та "OK"
        cleaned = cleaned.replace(/^ATI[\r\n]*/g, '').replace(/[\r\n]*ATI$/g, '');
        cleaned = cleaned.replace(/^OK[\r\n]*/g, '').replace(/[\r\n]*OK$/g, '');
        cleaned = cleaned.replace(/^>+/g, '').replace(/>+$/g, '');
        cleaned = cleaned.trim();
        
        logMessage(`Відповідь на 'ATI': [${cleaned}]`);
        
        if (cleaned.includes('ELM327') || cleaned.includes('ELM')) {
            logMessage("✓ Виявлено ELM327 адаптер!");
            return 'elm327';
        }
        
        // Якщо є "OK" але немає "ELM" - все одно це ELM
        if (cleaned === '' && v1.includes('OK')) {
            logMessage("✓ Виявлено ELM327 адаптер (за 'OK')!");
            return 'elm327';
        }
    }
    
    await new Promise(resolve => setTimeout(resolve, 200));
    
    // КРОК 2: Перевірка slcan через V
    logMessage("Крок 2: Перевірка slcan 'V'...");
    await state.writer.write("V\r");
    
    const { value: v2, timeout: t2 } = await readWithTimeout(1500);
    
    if (v2 && !t2) {
        let cleaned = v2.trim().toUpperCase();
        cleaned = cleaned.replace(/^V[\r\n]*/g, '').replace(/[\r\n]*V$/g, '');
        cleaned = cleaned.replace(/^>+/g, '').replace(/>+$/g, '');
        cleaned = cleaned.trim();
        
        logMessage(`Відповідь на 'V': [${cleaned}]`);
        
        if (cleaned.includes('ELM327')) {
            logMessage("✓ Виявлено ELM327 адаптер!");
            return 'elm327';
        }
        
        // slcan відповідає коротко
        if (cleaned.length > 0 && cleaned.length < 20 && !cleaned.includes('ELM')) {
            if (/^[A-Z0-9]+$/.test(cleaned)) {
                logMessage("✓ Виявлено slcan адаптер!");
                return 'slcan';
            }
        }
        
        // Якщо тільки ">" або порожньо - можливо ELM не відповів, спробуємо ще раз
        if (cleaned === '' || cleaned === '>') {
            logMessage("Порожня відповідь, остання спроба через ATZ...");
            
            await new Promise(resolve => setTimeout(resolve, 200));
            await state.writer.write("ATZ\r");
            
            const { value: v3, timeout: t3 } = await readWithTimeout(3000);
            
            if (v3 && !t3) {
                let cleaned3 = v3.trim().toUpperCase();
                logMessage(`Відповідь на 'ATZ': [${cleaned3}]`);
                
                if (cleaned3.includes('ELM')) {
                    logMessage("✓ Виявлено ELM327 адаптер (через ATZ)!");
                    return 'elm327';
                }
            }
        }
    }
    
    logMessage("❌ Адаптер не виявлено.");
    return 'unknown';
}

async function initializeAdapter() {
    if (state.adapterType === 'slcan') {
        logMessage('Ініціалізація slcan...');
        await state.writer.write("C\r");
        await state.writer.write("O\r");
        logMessage('slcan канал відкрито.');
    } else if (state.adapterType === 'elm327') {
        logMessage('Ініціалізація ELM327...');
        
        logMessage('Скидаємо налаштування (ATZ)...');
        await state.writer.write("ATZ\r");
        await new Promise(resolve => setTimeout(resolve, 1500)); 

        logMessage('Вимикаємо ехо (ATE0)...');
        await state.writer.write("ATE0\r");
        await new Promise(resolve => setTimeout(resolve, 100));
        
        logMessage('Вимикаємо пробіли (ATS0)...');
        await state.writer.write("ATS0\r");
        await new Promise(resolve => setTimeout(resolve, 100));

        logMessage('Встановлюємо 500 кбіт/с (ATSP6)...');
        await state.writer.write("ATSP6\r");
        await new Promise(resolve => setTimeout(resolve, 100));

        logMessage('Вмикаємо заголовки (ATH1)...');
        await state.writer.write("ATH1\r");
        await new Promise(resolve => setTimeout(resolve, 100));

        logMessage('CAN Auto Formatting OFF (ATCAF0)...');
        await state.writer.write("ATCAF0\r");
        await new Promise(resolve => setTimeout(resolve, 100));

        logMessage('Allow Long messages (ATAL)...');
        await state.writer.write("ATAL\r");
        await new Promise(resolve => setTimeout(resolve, 100));

        logMessage('CAN Receive Address = 7BB (ATCRA7BB)...');
        await state.writer.write("ATCRA7BB\r");
        await new Promise(resolve => setTimeout(resolve, 100));

        logMessage('Timeout 200ms (ATST32)...');
        await state.writer.write("ATST32\r");
        await new Promise(resolve => setTimeout(resolve, 100));

        logMessage('ELM327 налаштовано для опитування.');
    }
}

async function readLoop() {
    try {
        logMessage("=== ЦИКЛ ЧИТАННЯ ЗАПУЩЕНО ===");

        while (state.isConnected) {
            if (!state.reader) break;

            const { value, done } = await state.reader.read();

            if (done) {
                logMessage("Читання завершено");
                break;
            }

            if (!value) continue;

            noteRxActivity();

            // Декодуємо отримані байти у текст
            const textChunk = new TextDecoder().decode(value, {stream: true});
            lineBuffer += textChunk;

            // Розбиваємо буфер на рядки за символами переносу
            let lines = lineBuffer.split(/\r\n|\r|\n/);
            lineBuffer = lines.pop() || ""; // Залишаємо незавершений рядок у буфері

            let promptReady = false;

            for (const line of lines) {
                if (!line) continue;

                // Перевіряємо чи є ">" (ELM327 завершив прийом, готовий до команди)
                if (line.includes('>')) {
                    promptReady = true;
                }

                const trimmedLine = line.replace(/>/g, '').trim();
                if (!trimmedLine) continue;

                // Передаємо рядок у парсер canProtocol.js
                const parsed = parseCanResponse(trimmedLine);

                if (parsed) {
                    // Якщо парсер повернув об'єкт {id, data}, передаємо в pollingManager
                    handleCanResponse(parsed.id, parsed.data);

                    // Візуальна індикація активності
                    const statusCar = document.getElementById('statusCar');
                    if (statusCar) {
                        statusCar.classList.add('receiving');
                        clearTimeout(state.carStatusTimeout);
                        state.carStatusTimeout = setTimeout(() => {
                            statusCar.classList.remove('receiving');
                        }, 500);
                    }
                }
            }

            // Перевіряємо залишок буфера на ">"
            if (lineBuffer.includes('>')) {
                promptReady = true;
                const remaining = lineBuffer.replace(/>/g, '').trim();
                if (remaining) {
                    const parsed = parseCanResponse(remaining);
                    if (parsed) {
                        handleCanResponse(parsed.id, parsed.data);
                    }
                }
                lineBuffer = "";
            }

            // ISO-TP: відправляємо FC ТІЛЬКИ коли ELM327 готовий (">" отримано)
            // Без ">" ELM327 ще в режимі прийому CAN — команда буде втрачена
            if (promptReady) {
                await sendPendingFlowControl();
            }
        }
    } catch (error) {
        if (error.name !== 'AbortError' && state.isConnected) {
            logMessage(`Помилка читання: ${error.message}`);
            handleLinkLost(error.message);
        }
    } finally {
        // Вихід із циклу при state.isConnected === true означає, що читання
        // обірвалось само (адаптер від'єднали), а не через disconnectAdapter().
        if (state.isConnected) {
            handleLinkLost('потік читання завершився');
        }

        if (state.reader) {
            try {
                state.reader.releaseLock();
                logMessage("Reader відпущено.");
            } catch (e) {}
        }
    }
}

/**
 * Головна функція підключення
 */
export async function connectAdapter() {
    if (state.port) {
        logMessage("Порт вже відкритий. Виконуємо відключення...");
        await disconnectAdapter(); 
        return; 
    }
    
    if (!('serial' in navigator)) {
        logMessage('Помилка: Ваш браузер не підтримує WebSerial API.');
        return;
    }
    
    try {
        logMessage('Очікуємо вибору COM-порту...');
        const port = await navigator.serial.requestPort();

        await port.open({ baudRate: BAUD_RATE, dataTerminalReady: true });

        state.port = port;
        state.connectionType = 'serial'; // 💡 ДОДАНО: Чітка ідентифікація типу підключення

        logMessage(`Порт відкрито. Швидкість: ${BAUD_RATE}`);
        
        // Налаштування потоку запису (Writer)
        const textEncoder = new TextEncoderStream();
        const rawWriter = textEncoder.writable.getWriter();
        textEncoder.readable.pipeTo(port.writable);

        // Обгортка над writer: фіксує момент TX для watchdog-а звʼязку.
        // Інтерфейс сумісний з попереднім (використовуються лише write/close).
        state.writer = {
            write: (text) => {
                noteTxActivity();
                return rawWriter.write(text);
            },
            close: () => rawWriter.close(),
            releaseLock: () => rawWriter.releaseLock()
        };
        
        // Налаштування потоку читання (Reader)
        state.reader = port.readable.getReader(); 

        // Визначаємо та ініціалізуємо адаптер
        state.adapterType = await detectAdapterType();
        if (state.adapterType === 'unknown') throw new Error('Не вдалося визначити тип адаптера.');

        await initializeAdapter();

        state.isConnected = true; // 💡 ПІДТВЕРДЖЕННЯ: Тепер state.isConnected стає true лише після повної готовності
        startLinkWatchdog();
        logMessage("✓ Стан: Підключено.");

        updateConnectionTabs();
        
        readLoop(); 
        
        const connectButton = document.getElementById('connectButton');
        if (connectButton) connectButton.textContent = 'Відключити';
        
        const activePageButton = document.querySelector('.sidebar .nav-button.active[data-page-file]');
        if (activePageButton) {
            logMessage("Перезапуск опитування для поточної сторінки...");
            activePageButton.click();
        }

    } catch (error) {
        logMessage(`Помилка: ${error.message}`);
        
        stopAllPolling();
        state.isConnected = false;

        if(state.reader) {
            try { await state.reader.cancel(); } catch(e) {}
        }
        if(state.writer) {
            try { await state.writer.close(); } catch(e) {}
        }
        if(state.port) {
            try { await state.port.close(); } catch(e) {}
        }

        state.port = null;
        state.reader = null;
        state.writer = null;

        const connectButton = document.getElementById('connectButton');
        if (connectButton) connectButton.textContent = 'Підключити';
    }
}

/**
 * Універсальна функція для надсилання CAN-повідомлення
 */
export async function sendCanMessage(paramName, value) {
    // 💡 ВИПРАВЛЕНО: Проблема 3 - 'sendCanMessage' була зламана
    // Тепер вона працює аналогічно до 'sendCanRequest' з 'canProtocol.js'

    if (!state.isConnected || !state.writer) { // Використовуємо наш новий прапорець
        logMessage('ПОМИЛКА: Адаптер не підключено.');
        return;
    }
    
    const canMessage = formatCanMessage(paramName, value);
    if (!canMessage) {
        logMessage(`ПОМИЛКА: Не вдалося відформатувати CAN для ${paramName}=${value}`);
        return;
    }

    // 'canMessage' це { canId: "79B", data: "2E0304000A" }
    logMessage(`ВІДПРАВКА: ${paramName}=${value} (CAN: ${canMessage.data})`);

    try {
        if (state.adapterType === 'elm327') {
            // ELM вимагає спочатку встановити ID, потім дані
            await state.writer.write(`ATSH${canMessage.canId}\r`);
            await new Promise(resolve => setTimeout(resolve, 10)); // Маленька затримка
            await state.writer.write(`${canMessage.data}\r`);
        } else if (state.adapterType === 'slcan') {
            // slcan приймає все одразу
            const dlc = (canMessage.data.length / 2).toString(16);
            const message = `t${canMessage.canId}${dlc}${canMessage.data}\r`;
            await state.writer.write(message);
        }
        return true;
    } catch (e) {
        logMessage(`Помилка відправки: ${e.message}`);
        return false;
    }
}

export async function disconnectAdapter() {
    logMessage("Відключення...");
    
    // 1. Встановлюємо прапорець, що відключаємось (щоб readLoop зупинився)
    state.isConnected = false;

    // 2. Зупиняємо всі таймери опитування
    stopLinkWatchdog();
    stopAllPolling();
    
    // 3. Закриваємо writer СПОЧАТКУ (це важливо!)
    if (state.writer) {
        try {
            await state.writer.close();
            logMessage("Writer закрито.");
        } catch (error) { 
            logMessage(`Помилка writer: ${error.message}`); 
        }
        state.writer = null;
    }
    
    // 4. ПОТІМ скасовуємо reader
    if (state.reader) {
        try {
            await state.reader.cancel();
            logMessage("Reader скасовано.");
        } catch (error) { 
            logMessage(`Помилка reader: ${error.message}`); 
        }
        state.reader = null;
    }
    
    // 5. Чекаємо трохи, щоб все встигло закритись
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // 6. ТЕПЕР закриваємо порт
    if (state.port) {
        try {
            await state.port.close();
            logMessage("Порт закрито.");
        } catch (error) { 
            logMessage(`Помилка порту: ${error.message}`); 
        }
        state.port = null;
    }
    
    // 7. Скидаємо стан
    state.adapterType = 'unknown';

    // 8. Оновлюємо UI
    const connectButton = document.getElementById('connectButton');
    if (connectButton) connectButton.textContent = 'Підключити';

    logMessage("✓ Адаптер відключено.");
}