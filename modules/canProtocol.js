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
    const clean = line.replace('>', '').trim();

    if (clean.startsWith('ATSH') || clean.match(/^[0-9A-F]{6,}$/i)) {
        if (clean.match(/^[0-9A-F]{6}$/i)) return null; 
    }
    
    const parts = clean.split(' ');
    
    // Формат 1: "7BB 62 03 01 ..."
    if (parts.length >= 2 && parts[0].length === 3 && /^[0-9A-F]{3}$/i.test(parts[0])) {
        return { id: parts[0].toUpperCase(), data: parts.slice(1).join('').toUpperCase() };
    }
    
    // Формат 2: "7BB62030101..."
    if (parts.length === 1 && clean.length > 3) {
        const possibleId = clean.substring(0, 3).toUpperCase();
        if (/^[0-9A-F]{3}$/i.test(possibleId)) {
            return { id: possibleId, data: clean.substring(3).toUpperCase() };
        }
    }
    
    // Формат 3: "62 03 01..." (без ID)
    if (parts.length >= 2 && /^[0-9A-F]{2}$/i.test(parts[0]) && /^[0-9A-F]{2}$/i.test(parts[1])) {
        if (state.lastRequestId) {
            const data = clean.split(' ').join('').toUpperCase();
            const responseId = (state.lastRequestId === '79B') ? '7BB' : state.lastRequestId;
            return { id: responseId, data: data };
        }
    }
    
    return null;
}