import { state } from './state.js';
import { BAUD_RATE } from './config.js';
import { logMessage, updateUI } from './ui.js';

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
async function detectAdapterType() {
    // Очищуємо буфер
    lineBuffer = "";
    
    // ========================================
    // КРОК 1: Перевірка ELM327 через ATI
    // ========================================
    logMessage("Крок 1: Перевірка ELM327 'ATI'...");
    await state.writer.write("ATI\r");
    
    const { value: v1, timeout: t1 } = await readWithTimeout(2000);
    
    if (v1 && !t1) {
        const cleaned = v1.trim().toUpperCase();
        logMessage(`Відповідь на 'ATI': [${cleaned}]`);
        
        // Перевіряємо чи це ELM (може бути ELM327, ELM v1.5 тощо)
        if (cleaned.includes('ELM')) {
            logMessage("✓ Виявлено ELM327 адаптер!");
            return 'elm327';
        }
    }
    
    // ========================================
    // КРОК 2: Якщо не ELM - перевіряємо slcan через V
    // ========================================
    logMessage("Крок 2: Перевірка slcan 'V'...");
    await state.writer.write("V\r");
    
    const { value: v2, timeout: t2 } = await readWithTimeout(1500);
    
    if (v2 && !t2) {
        const cleaned = v2.trim();
        logMessage(`Відповідь на 'V': [${cleaned}]`);
        
        // Якщо БУДЬ-ЯКА відповідь є - це slcan
        if (cleaned.length > 0) {
            logMessage("✓ Виявлено slcan адаптер!");
            return 'slcan';
        }
    }
    
    // ========================================
    // Адаптер не виявлено
    // ========================================
    logMessage("❌ Адаптер не виявлено. Немає відповіді.");
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
            await state.writer.write("ATE0\r");   // Вимкнути ехо
        }
        
        // --- ЗМІНА: Встановлюємо протокол і заголовки. Прибираємо ATMA. ---
        logMessage('Встановлюємо 500 кбіт/с (ATSP6)...');
        await state.writer.write("ATSP6\r");  // Протокол 6 = 500kbit/s, 11-bit ID
        
        logMessage('Вмикаємо заголовки (ATH1)...');
        await state.writer.write("ATH1\r");   // Показувати ID у відповідях
        
        // await state.writer.write("ATMA\r"); // БІЛЬШЕ НЕ ПОТРІБНО
        logMessage('ELM327 налаштовано для опитування.');
        // --- КІНЕЦЬ ЗМІНИ ---
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

/**
 * Головний цикл читання (без змін)
 */
async function readLoop() {
    try {
        while (true) {
            if (!state.reader) break;

            // --- (без змін) ---
            const { value, done } = await state.reader.read(); // value - це Uint8Array
            if (done) { 
                if (state.reader) state.reader.releaseLock(); 
                break; 
            }

            // --- (без змін) ---
            const textChunk = new TextDecoder().decode(value, {stream: true});
            lineBuffer += textChunk;
            
            // --- (без змін) ---
            let lines = lineBuffer.split(/\r\n|\r|\n/);
            
            lineBuffer = lines.pop() || ""; 

            // --- (без змін) ---
            for (const line of lines) {
                if (line) parseData(line.trim()); // Обробляємо кожний повний рядок
            }
            // --- (без змін) ---
        }
    } catch (error) {
        logMessage(`Помилка читання: ${error.message}`);
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

// --- НОВА ФУНКЦІЯ: Цикл опитування ---
/**
 * Запускає цикл опитування (request-response) кожні 500мс
 */
function startDataPolling() {
    // Зупиняємо старий таймер, якщо він є
    if (state.dataPollingTimer) {
        clearInterval(state.dataPollingTimer);
    }
    
    logMessage("Запускаємо цикл опитування інвертора (500ms)...");

    state.dataPollingTimer = setInterval(async () => {
        // Переконуємось, що ми підключені
        if (!state.writer) {
            clearInterval(state.dataPollingTimer);
            state.dataPollingTimer = null;
            return;
        }

        // Надсилаємо запит в залежності від типу адаптера
        if (state.adapterType === 'elm327') {
            // Згідно з вашим кодом: ID 79b, 4 байти 03 22 03 01
            await state.writer.write("ATSH 79B\r"); // Встановити заголовок (ID)
            await state.writer.write("03220301\r"); // Надіслати 4 байти даних
        } 
        else if (state.adapterType === 'slcan') {
            // 't' + '79B' (ID) + '4' (DLC) + '03220301' (Data)
            await state.writer.write("t79B403220301\r");
        }

    }, 500); // Повторювати кожні 500мс
}
// --- КІНЕЦЬ НОВОЇ ФУНКЦІЇ ---


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
        
        // --- ЗМІНА: Запускаємо цикл опитування ---
        startDataPolling();
        // --- КІНЕЦЬ ЗМІНИ ---
        
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
    
    // Зупиняємо опитування
    if (state.dataPollingTimer) {
        clearInterval(state.dataPollingTimer);
        state.dataPollingTimer = null;
    }
    
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

