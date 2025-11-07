import { state } from './state.js';
import { BAUD_RATE } from './config.js';
import { logMessage, updateUI } from './ui.js';
import { parseCanResponse } from './canProtocol.js';
import { handleCanResponse, startPollingForPage } from './pollingManager.js';


// --- Буфер для неповних рядків (без змін) ---
let lineBuffer = "";
// --- КІНЕЦЬ ---

/**
 * Читання з порту з таймаутом (без змін)
 */
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

        // Якщо таймаут - повертаємо те, що встигли зібрати
        if (result.timeout) {
            if (fullResponse.length > 0) {
                return { value: fullResponse, done: false, timeout: false };
            }
            return { value: null, done: false, timeout: true };
        }

        // Якщо є дані - додаємо до буфера
        if (result.value) {
            const decodedValue = new TextDecoder().decode(result.value);
            fullResponse += decodedValue;
            
            // Якщо прийшов символ переносу рядка - відповідь завершена
            if (decodedValue.includes('\r') || decodedValue.includes('\n') || decodedValue.includes('>')) {
                return { value: fullResponse, done: false, timeout: false };
            }
            
            // Продовжуємо читати
            continue;
        }
        
        if (result.done) {
            return { value: fullResponse.length > 0 ? fullResponse : null, done: true, timeout: false };
        }
    }
    
    // Таймаут вийшов, повертаємо те, що є
    if (fullResponse.length > 0) {
        return { value: fullResponse, done: false, timeout: false };
    }
    return { value: null, done: false, timeout: true };
}

/**
 * Опитує пристрій для визначення типу (slcan або elm327) (без змін)
 */
/**
 * Опитує пристрій для визначення типу (slcan або elm327)
 */
/**
 * Опитує пристрій для визначення типу (slcan або elm327)
 * ПОКРАЩЕНА ВЕРСІЯ: спочатку вимикаємо ехо ELM
 */
async function detectAdapterType() {
    lineBuffer = "";
    
    // ========================================
    // КРОК 0: Спробуємо вимкнути ехо (якщо це ELM)
    // ========================================
    logMessage("Крок 0: Спроба вимкнути ехо (ATE0)...");
    await state.writer.write("ATE0\r");
    
    const { value: v0, timeout: t0 } = await readWithTimeout(1500);
    
    if (v0 && !t0) {
        const cleaned = v0.trim().toUpperCase();
        logMessage(`Відповідь на 'ATE0': [${cleaned}]`);
        
        // Якщо є OK - це точно ELM327
        if (cleaned.includes('OK')) {
            logMessage("✓ Виявлено ELM327 адаптер (ехо вимкнено)!");
            state.echoOff = true;
            return 'elm327';
        }
        
        // Якщо є "?" - це теж ELM (просто з помилкою)
        if (cleaned.includes('?')) {
            logMessage("ELM327 відповів '?' - спробуємо ATI...");
            // Продовжуємо перевірку
        }
    }
    
    // ========================================
    // КРОК 1: Перевірка ELM327 через ATI
    // ========================================
    logMessage("Крок 1: Перевірка ELM327 'ATI'...");
    await state.writer.write("ATI\r");
    
    const { value: v1, timeout: t1 } = await readWithTimeout(2000);
    
    if (v1 && !t1) {
        // Видаляємо можливе ехо команди
        let cleaned = v1.trim().toUpperCase();
        // Прибираємо "ATI" з початку, якщо воно є
        cleaned = cleaned.replace(/^ATI[\r\n]*/, '');
        
        logMessage(`Відповідь на 'ATI': [${cleaned}]`);
        
        if (cleaned.includes('ELM327')) {
            logMessage("✓ Виявлено ELM327 адаптер!");
            return 'elm327';
        }
    }
    
    // ========================================
    // КРОК 2: Перевірка slcan через V
    // ========================================
    logMessage("Крок 2: Перевірка slcan 'V'...");
    await state.writer.write("V\r");
    
    const { value: v2, timeout: t2 } = await readWithTimeout(1500);
    
    if (v2 && !t2) {
        let cleaned = v2.trim().toUpperCase();
        // Прибираємо можливе ехо "V"
        cleaned = cleaned.replace(/^V[\r\n]*/, '');
        
        logMessage(`Відповідь на 'V': [${cleaned}]`);
        
        // Якщо знову бачимо ELM327 - це ELM
        if (cleaned.includes('ELM327')) {
            logMessage("✓ Виявлено ELM327 адаптер!");
            return 'elm327';
        }
        
        // slcan відповідає типу: V1013, 1210, тощо (без "V" на початку після очищення)
        // або просто цифри/літери
        if (cleaned.length > 0 && cleaned.length < 20 && !cleaned.includes('ELM')) {
            // Додаткова перевірка: чи це схоже на версію slcan
            if (/^[A-Z0-9]+$/.test(cleaned)) {
                logMessage("✓ Виявлено slcan адаптер!");
                return 'slcan';
            }
        }
    }
    
    logMessage("❌ Адаптер не виявлено.");
    return 'unknown';
}
/**
 * Надсилає команди ініціалізації
 */
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
        await new Promise(resolve => setTimeout(resolve, 1500)); // Чекаємо перезавантаження
        
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

/**
 * Парсить рядок даних
 */
function parseData(line) {
    let isValidCanMessage = false;
    let id, dlc, data;

    // Ігноруємо службові відповіді
    if (line.startsWith('OK') || line.startsWith('?') || line.includes('ELM327') || line.startsWith('V') || line.trim() === '>' || line.trim() === 'SEARCHING...') {
        logMessage(`SVC: ${line}`);
        return;
    }
    
    // Парсинг slcan
    if (state.adapterType === 'slcan' && line.startsWith('t')) {
        id = line.substring(1, 4).toUpperCase();
        dlc = parseInt(line.substring(4, 5), 16);
        data = line.substring(5, 5 + dlc * 2);
        logMessage(`[SLCAN] ID: ${id} | DLC: ${dlc} | Data: ${data}`);
        isValidCanMessage = true;
    } 
    // --- ЗМІНА: Оновлена логіка парсингу ELM з заголовками ---
    else if (state.adapterType === 'elm327') {
        const parts = line.split(' ');
        // Очікуємо відповідь типу "7BB 07 62 03 01 ..."
        // Перевіряємо, що перший елемент - 3-значний ID
        if (parts.length > 2 && parts[0].length === 3) { 
            id = parts[0].toUpperCase(); // Це буде ID відповіді, напр. '7BB'
            data = parts.slice(1).join(''); // '07620301...'
            logMessage(`[ELM-POLL] ID: ${id} | Data: ${data}`);
            isValidCanMessage = true;
        } else {
            // Логуємо "шум", який не є CAN-відповіддю
            logMessage(`[ELM-NOISE]: ${line}`);
        }
    }
    // --- КІНЕЦЬ ЗМІНИ ---

    // Якщо успішно розпарсили, оновлюємо UI та індикатор
    if (isValidCanMessage) {
        const statusCar = document.getElementById('statusCar');
        if (statusCar) {
            statusCar.classList.add('receiving');
            clearTimeout(state.carStatusTimeout);
            state.carStatusTimeout = setTimeout(() => statusCar.classList.remove('receiving'), 500); // Індикатор згасне через 0.5с
        }
        updateUI(id, data);
    }
}


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
                if (state.reader) state.reader.releaseLock();
                break;
            }
            
            if (!value) {
                continue; // Пропускаємо порожні читання
            }
            
            const textChunk = new TextDecoder().decode(value, {stream: true});
            
            // ДЕТАЛЬНЕ ЛОГУВАННЯ
            logMessage(`[RAW CHUNK] Довжина: ${textChunk.length} | Hex: ${Array.from(value).map(b => b.toString(16).padStart(2, '0')).join(' ')}`);
            logMessage(`[RAW TEXT] "${textChunk}"`);
            
            lineBuffer += textChunk;
            
            let lines = lineBuffer.split(/\r\n|\r|\n/);
            lineBuffer = lines.pop() || "";
            
            logMessage(`[LINES] Знайдено ${lines.length} рядків, буфер: "${lineBuffer}"`);
            
            for (const line of lines) {
                if (!line) continue;
                
                const trimmedLine = line.trim();
                logMessage(`[PARSE] Обробка рядка: "${trimmedLine}"`);
                
                // Парсимо відповідь
                const parsed = parseCanResponse(trimmedLine);
                
                if (parsed) {
                    logMessage(`[PARSED ✓] ID: ${parsed.id} | Data: ${parsed.data}`);
                    
                    // Передаємо в менеджер опитування
                    handleCanResponse(parsed.id, parsed.data);
                    
                    // Оновлюємо індикатор активності
                    const statusCar = document.getElementById('statusCar');
                    if (statusCar) {
                        statusCar.classList.add('receiving');
                        clearTimeout(state.carStatusTimeout);
                        state.carStatusTimeout = setTimeout(() => {
                            statusCar.classList.remove('receiving');
                        }, 500);
                    }
                } else {
                    logMessage(`[PARSED ✗] Рядок не розпізнано: "${trimmedLine}"`);
                }
            }
        }
    } catch (error) {
        logMessage(`[ERROR] Помилка читання: ${error.message}`);
        console.error(error);
        if (state.reader) state.reader.releaseLock();
    }
}

/**
 * Форматує CAN-повідомлення для відправки (без змін)
 */
function formatCanMessage(param, value) {
// ... (Ця функція залишається без змін) ...
    logMessage(`Заглушка: ${param} = ${value}. Потрібна реалізація formatCanMessage.`);
    return null;
}

/**
 * Головна функція підключення
 */
export async function connectAdapter() {
    // --- ЗМІНА: Зупиняємо опитування перед новим підключенням ---
    if (state.dataPollingTimer) {
        clearInterval(state.dataPollingTimer);
        state.dataPollingTimer = null;
    }
    // --- КІНЕЦЬ ЗМІНИ ---

    // --- ЗМІНА: Додаємо перевірку, чи порт вже існує (для відключення) ---
    if (state.port) {
        logMessage("Порт вже відкритий. Виконуємо відключення...");
        await disconnectAdapter(); // Викликаємо нову функцію відключення
        return; // Виходимо. Наступний клік підключить знову.
    }
    // --- КІНЕЦЬ ЗМІНИ ---
    
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
        
        // --- (без змін) ---
        const textEncoder = new TextEncoderStream();
        state.writer = textEncoder.writable.getWriter(); // <-- ПРОПУЩЕНИЙ РЯДОК
        textEncoder.readable.pipeTo(port.writable);    // <-- ПРОПУЩЕНИЙ РЯДОК
        
        // --- (без змін) ---
        state.reader = port.readable.getReader(); // <-- ЧИТАЄМО СИРІ БАЙТИ
        // --- (без змін) ---

        state.adapterType = await detectAdapterType();
        if (state.adapterType === 'unknown') throw new Error('Не вдалося визначити тип адаптера.');

        await initializeAdapter();
        readLoop(); // Запускаємо цикл читання
        
    } catch (error) {
        logMessage(`Помилка: ${error.message}`);
        
        // --- ЗМІНА: Зупиняємо опитування при помилці ---
        if (state.dataPollingTimer) {
            clearInterval(state.dataPollingTimer);
            state.dataPollingTimer = null;
        }
        // --- КІНЕЦЬ ЗМІНИ ---

        if(state.reader) state.reader.releaseLock();
        if (statusAdapter) statusAdapter.classList.remove('connected');
        state.port = null;
        state.reader = null;
        state.writer = null;
    }
}

/**
 * Універсальна функція для надсилання CAN-повідомлення (без змін)
 */
export async function sendCanMessage(paramName, value) {
    if (!state.writer) {
        logMessage('ПОМИЛКА: Адаптер не підключено.');
        return;
    }
    const canMessage = formatCanMessage(paramName, value);
    if (canMessage) {
        logMessage(`ВІДПРАВКА: ${canMessage} (для ${paramName}=${value})`);
        await state.writer.write(canMessage + '\r');
        // --- (без змін) ---
    } else {
        logMessage(`ПОМИЛКА: Не вдалося відформатувати CAN для ${paramName}=${value}`);
    }
}

// --- НОВА ФУНКЦІЯ: Відключення ---
/**
 * Коректно закриває порт та зупиняє цикли
 */
export async function disconnectAdapter() {
    logMessage("Відключення...");
    
    
    // Зупиняємо цикл читання (readLoop)
    if (state.reader) {
        try {
            await state.reader.cancel();
            state.reader.releaseLock();
        } catch (error) { logMessage(`Помилка при закритті reader: ${error.message}`); }
    }
    
    // Закриваємо writer
    if (state.writer) {
        try {
            await state.writer.close();
            state.writer.releaseLock();
        } catch (error) { logMessage(`Помилка при закритті writer: ${error.message}`); }
    }
    
    // Закриваємо порт
    if (state.port) {
        try {
            await state.port.close();
        } catch (error) { logMessage(`Помилка при закритті порту: ${error.message}`); }
    }
    
    // Скидаємо стан
    state.port = null;
    state.reader = null;
    state.writer = null;
    state.adapterType = 'unknown';

    const statusAdapter = document.getElementById('statusAdapter');
    if (statusAdapter) statusAdapter.classList.remove('connected');
    logMessage("Адаптер відключено.");
}
// --- КІНЕЦЬ НОВОЇ ФУНКЦІЇ ---

