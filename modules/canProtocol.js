import { state } from './state.js';
import { logMessage } from './ui.js';

/**
 * УНІВЕРСАЛЬНА функція відправки CAN-запиту
 */
let isWriting = false; 

/**
 * Універсальна функція відправки CAN-запиту.
 * Забезпечує послідовність операцій для BLE та Serial.
 */
export async function sendCanRequest(canId, data) {
    const writer = state.writer;
    if (!writer) return false;

    // Простий замок: якщо лінія зайнята, чекаємо трохи
    if (isWriting) {
        await new Promise(r => setTimeout(r, 50));
        if (isWriting) return false; 
    }

    isWriting = true;

    try {
        if (canId) {
            
            state.lastRequestId = canId;
            // Встановлюємо ID (ATSH)
            await writer.write(`ATSH${canId}\r`);
            // Пауза для BLE, щоб адаптер встиг змінити заголовок
            await new Promise(r => setTimeout(r, state.connectionType === 'ble' ? 100 : 20));
        }

        // Відправляємо дані (PID)
        await writer.write(`${data}\r`);
        
        // Даємо адаптеру час обробити команду перед наступним запитом
        await new Promise(r => setTimeout(r, state.connectionType === 'ble' ? 150 : 50));
        
        return true;
    } catch (e) {
        console.error(`[Protocol] Помилка запису:`, e);
        return false;
    } finally {
        isWriting = false; 
    }
}

/**
 * Головна функція парсингу, яка об’єднує термінал та логіку даних
 */
export function parseCanResponse(line) {
    let cleanLine = line.trim();
    if (cleanLine.startsWith('>')) {
        cleanLine = cleanLine.substring(1).trim();
    }
    if (!cleanLine) return null;

    // Перевірка активної сторінки для фільтрації RAW логів
    const isTerminalPage = !!document.querySelector('.terminal-container') || 
                          !!document.getElementById('terminal-output');

    // Викликаємо твій оригінальний парсер
    const parsed = parseCanResponse_ELM327(cleanLine);

    // У терміналі показуємо все, що НЕ є розпізнаним CAN-пакетом
    if (isTerminalPage && !parsed) {
        logMessage(`[RAW IN]: ${cleanLine}`);
    }

    return parsed;
}

/**
 * Твій оригінальний парсер ELM327
 */
function parseCanResponse_ELM327(line) {
    const clean = line.replace(/\s+/g, '').replace('>', '').trim().toUpperCase();
    if (!clean || clean === "OK" || clean === "STOPPED") return null;

    // 🔍 DEBUG: Вхідні дані
    console.log(`[DEBUG RAW IN]: "${clean}" | Len: ${clean.length}`);

    // Ігноруємо ЕХО
    if (clean.startsWith('22') || clean.startsWith('AT')) {
        console.log(`[DEBUG PARSER]: Ігноруємо ЕХО запиту/команди: ${clean}`);
        return null;
    }

    let id = "";
    let data = "";

    // Формат: "7BB07620301..." (Злитий з ID)
    if (clean.length > 3 && clean.startsWith('7')) {
        id = clean.substring(0, 3);
        data = clean.substring(3);
        console.log(`[DEBUG PARSER]: Формат з ID -> ID: ${id}, Data: ${data}`);
    } 
    // Формат: "620301..." (Без ID)
    else if (clean.startsWith('62')) {
        if (state.lastRequestId) {
            id = (state.lastRequestId === '79B') ? '7BB' : state.lastRequestId;
            data = clean;
            console.log(`[DEBUG PARSER]: Формат без ID -> Підставлено: ${id}, Data: ${data}`);
        } else {
            console.warn(`[DEBUG PARSER]: FAIL - Прийшло '62', але lastRequestId порожній!`);
            return null;
        }
    }

    if (id && data) return { id, data };
    return null;
}