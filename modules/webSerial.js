// webSerisl.js

import { state } from './state.js';
import { BAUD_RATE } from './config.js';
// 💡 ВИПРАВЛЕНО: Додано logMessage до імпорту (він використовувався, але не імпортувався)
import { logMessage, updateUI } from './ui.js'; 
import { parseCanResponse } from './canProtocol.js';
import { handleCanResponse, stopAllPolling } from './pollingManager.js';

let lineBuffer = "";

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
    
    logMessage("Крок 0: Спроба вимкнути ехо (ATE0)...");
    await state.writer.write("ATE0\r");
    
    const { value: v0, timeout: t0 } = await readWithTimeout(1500);
    
    if (v0 && !t0) {
        const cleaned = v0.trim().toUpperCase();
        logMessage(`Відповідь на 'ATE0': [${cleaned}]`);
        
        if (cleaned.includes('OK')) {
            logMessage("✓ Виявлено ELM327 адаптер (ехо вимкнено)!");
            state.echoOff = true;
            return 'elm327';
        }
        
        if (cleaned.includes('?')) {
            logMessage("ELM327 відповів '?' - спробуємо ATI...");
        }
    }
    
    logMessage("Крок 1: Перевірка ELM327 'ATI'...");
    await state.writer.write("ATI\r");
    
    const { value: v1, timeout: t1 } = await readWithTimeout(2000);
    
    if (v1 && !t1) {
        let cleaned = v1.trim().toUpperCase();
        cleaned = cleaned.replace(/^ATI[\r\n]*/, '');
        
        logMessage(`Відповідь на 'ATI': [${cleaned}]`);
        
        if (cleaned.includes('ELM327')) {
            logMessage("✓ Виявлено ELM327 адаптер!");
            return 'elm327';
        }
    }
    
    logMessage("Крок 2: Перевірка slcan 'V'...");
    await state.writer.write("V\r");
    
    const { value: v2, timeout: t2 } = await readWithTimeout(1500);
    
    if (v2 && !t2) {
        let cleaned = v2.trim().toUpperCase();
        cleaned = cleaned.replace(/^V[\r\n]*/, '');
        
        logMessage(`Відповідь на 'V': [${cleaned}]`);
        
        if (cleaned.includes('ELM327')) {
            logMessage("✓ Виявлено ELM327 адаптер!");
            return 'elm327';
        }
        
        if (cleaned.length > 0 && cleaned.length < 20 && !cleaned.includes('ELM')) {
            if (/^[A-Z0-9]+$/.test(cleaned)) {
                logMessage("✓ Виявлено slcan адаптер!");
                return 'slcan';
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
        
        if (!state.echoOff) {
            logMessage('Вимикаємо ехо (ATE0)...');
            await state.writer.write("ATE0\r");
            await new Promise(resolve => setTimeout(resolve, 100));
        }
        
        logMessage('Скидаємо налаштування (ATZ)...');
        await state.writer.write("ATZ\r");
        await new Promise(resolve => setTimeout(resolve, 1500)); 
        
        logMessage('Вимикаємо пробіли (ATS0)...');
        await state.writer.write("ATS0\r");
        await new Promise(resolve => setTimeout(resolve, 100));
        
        logMessage('Встановлюємо 500 кбіт/с (ATSP6)...');
        await state.writer.write("ATSP6\r");
        await new Promise(resolve => setTimeout(resolve, 100));
        
        logMessage('Вмикаємо заголовки (ATH1)...');
        await state.writer.write("ATH1\r");
        await new Promise(resolve => setTimeout(resolve, 100));
        
        logMessage('Вимикаємо адаптивний таймінг (ATAT0)...');
        await state.writer.write("ATAT0\r");
        await new Promise(resolve => setTimeout(resolve, 100));
        
        logMessage('ELM327 налаштовано для опитування.');
    }
}

// ... (Ваша стара parseData не використовується, це окей) ...

async function readLoop() {
    try {
        logMessage("=== ЦИКЛ ЧИТАННЯ ЗАПУЩЕНО ===");
        
        while (true) {
            if (!state.reader) {
                logMessage("Reader відсутній, виходимо з циклу");
                break;
            }
            
            const { value, done } = await state.reader.read();
            
            if (done) {
                logMessage("Читання завершено (done=true)");
                // 💡 ВИПРАВЛЕНО: 'releaseLock' тут не потрібен, 
                // він має бути в 'disconnectAdapter' ПІСЛЯ 'cancel()'
                // if (state.reader) state.reader.releaseLock(); 
                break;
            }
            
            if (!value) {
                continue; 
            }
            
            const textChunk = new TextDecoder().decode(value, {stream: true});
            lineBuffer += textChunk;
            
            let lines = lineBuffer.split(/\r\n|\r|\n/);
            lineBuffer = lines.pop() || "";
            
            for (const line of lines) {
                if (!line) continue;
                
                const trimmedLine = line.trim();
                const parsed = parseCanResponse(trimmedLine);
                
                if (parsed) {
                    handleCanResponse(parsed.id, parsed.data);
                    
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
        }
    } catch (error) {
        // 💡 ВИПРАВЛЕНО: 'AbortError' - це очікувана помилка при 'cancel()'. 
        // Ми її просто ігноруємо, а не логуємо як помилку.
        if (error.name !== 'AbortError') {
            logMessage(`[ERROR] Помилка читання: ${error.message}`);
            console.error(error);
        }
    } finally {
        // 💡 ВИПРАВЛЕНО: 'releaseLock' має бути тут, у 'finally'.
        // Це гарантує, що порт звільниться, навіть якщо сталася помилка.
        if (state.reader) {
            state.reader.releaseLock();
            logMessage("Reader замок відпущено.");
        }
    }
}

// ... (formatCanMessage залишається БЕЗ ЗМІН) ...
function formatCanMessage(param, value) {
    if (!window.PARAMETER_REGISTRY) {
        logMessage("ПОМИЛКА: Внутрішня: PARAMETER_REGISTRY не знайдено.");
        console.error("[Formatter] PARAMETER_REGISTRY не знайдено у 'window'!");
        return null;
    }
    const config = window.PARAMETER_REGISTRY[param]?.writeConfig;
    if (!config) {
        logMessage(`ПОМИЛКА: Не знайдено 'writeConfig' для "${param}"`);
        return null;
    }
    let numericValue = parseInt(value, 10);
    if (isNaN(numericValue)) {
        logMessage(`ПОМИЛКА: Значення "${value}" для "${param}" не є числом.`);
        return null;
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
        const maxValue = Math.pow(2, config.bytes * 8) - 1;
        if (numericValue > maxValue) {
             logMessage(`ПОПЕРЕДЖЕННЯ: Значення ${numericValue} завелике для "${param}", буде обрізане.`);
             hexValue = (numericValue & maxValue).toString(16);
        } else {
             hexValue = numericValue.toString(16);
        }
    }
    const paddedHexValue = hexValue.padStart(totalHexLength, '0');
    const finalData = config.dataPrefix + paddedHexValue;
    
    return {
        canId: config.canId,
        data: finalData.toUpperCase()
    };
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
    
    const statusAdapter = document.getElementById('statusAdapter');
    
    try {
        logMessage('Очікуємо вибору COM-порту...');
        const port = await navigator.serial.requestPort();
        
        await port.open({ baudRate: BAUD_RATE, dataTerminalReady: true });
        
        state.port = port; 
        if (statusAdapter) statusAdapter.classList.add('connected');
        logMessage(`Порт відкрито. Швидкість: ${BAUD_RATE}`);
        
        const textEncoder = new TextEncoderStream();
        state.writer = textEncoder.writable.getWriter();
        textEncoder.readable.pipeTo(port.writable);
        
        state.reader = port.readable.getReader(); 

        state.adapterType = await detectAdapterType();
        if (state.adapterType === 'unknown') throw new Error('Не вдалося визначити тип адаптера.');

        await initializeAdapter();

        // 💡 ВИПРАВЛЕНО: Проблема 1 - повідомляємо додатку, що ми підключені!
        state.isConnected = true;
        logMessage("✓ Стан: Підключено.");
        
        // Запускаємо цикл читання в останню чергу
        readLoop(); 
        
        // 💡 ДОДАНО: Оновлюємо кнопку, щоб вона показувала "Відключити"
        document.getElementById('connectButton').textContent = 'Відключити';
        
        // 💡 ДОДАНО: Запускаємо опитування (або перезавантажуємо сторінку, щоб воно запустилось)
        // Це змусить pollingManager почати працювати одразу
        const activePageButton = document.querySelector('.sidebar .nav-button.active[data-page-file]');
        if (activePageButton) {
            logMessage("Перезапуск опитування для поточної сторінки...");
            // Ми "клікаємо" на активну кнопку, щоб перезавантажити сторінку і запустити опитування
            activePageButton.click();
        }

    } catch (error) {
        logMessage(`Помилка: ${error.message}`);
        
        stopAllPolling();

        // 💡 ВИПРАВЛЕНО: Переконуємось, що стан скинуто
        state.isConnected = false;

        // Важливо очистити все, якщо підключення не вдалося
        if(state.reader) {
            try { await state.reader.cancel(); } catch(e) {}
        }
        if(state.writer) {
            try { await state.writer.close(); } catch(e) {}
        }
        if(state.port) {
            try { await state.port.close(); } catch(e) {}
        }
        
        if (statusAdapter) statusAdapter.classList.remove('connected');
        state.port = null;
        state.reader = null;
        state.writer = null;

        // 💡 ДОДАНО: Скидаємо текст кнопки
        document.getElementById('connectButton').textContent = 'Підключити';
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


/**
 * 💡 ВИПРАВЛЕНО: Проблема 2 - Повністю перероблена функція відключення
 */
export async function disconnectAdapter() {
    logMessage("Відключення...");
    
    // 1. Зупиняємо всі таймери опитування
    stopAllPolling();
    
    // 2. Скасовуємо reader. Це змусить readLoop() вийти
    //    і виконати 'finally { releaseLock() }'
    if (state.reader) {
        try {
            await state.reader.cancel();
            // Ми не робимо releaseLock() тут! 'readLoop' зробить це за нас.
            // Чекаємо, доки 'closed' підтвердить, що 'finally' спрацював
            await state.reader.closed.catch(() => {});
        } catch (error) { 
            logMessage(`Помилка при скасуванні reader: ${error.message}`); 
        }
    }
    
    // 3. Закриваємо writer
    if (state.writer) {
        try {
            await state.writer.close();
            // 'releaseLock()' тут не існує, це була помилка
        } catch (error) { 
            logMessage(`Помилка при закритті writer: ${error.message}`); 
        }
    }
    
    // 4. Тільки ТЕПЕР, коли потоки звільнені, закриваємо порт
    if (state.port) {
        try {
            await state.port.close();
        } catch (error) { 
            logMessage(`Помилка при закритті порту: ${error.message}`); 
        }
    }
    
    // 5. Скидаємо ВЕСЬ стан
    state.port = null;
    state.reader = null;
    state.writer = null;
    state.adapterType = 'unknown';
    state.isConnected = false; // 💡 ВАЖЛИВО!

    // 6. Оновлюємо UI
    const statusAdapter = document.getElementById('statusAdapter');
    if (statusAdapter) statusAdapter.classList.remove('connected');
    
    document.getElementById('connectButton').textContent = 'Підключити';
    
    logMessage("Адаптер відключено.");
}