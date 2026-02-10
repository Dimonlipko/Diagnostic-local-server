import { state } from './state.js';
import { logMessage } from './ui.js';


let isWriting = false;

export async function sendCanRequest(canId, data) {
    const writer = state.writer;
    if (!writer) return false;

    const isBle = state.connectionType === 'ble';

    // 1. ЗАМОК (Тільки для BLE)
    // Для Classic ми не блокуємо запити, щоб не переривати паралельні інтервали
    if (isBle && isWriting) {
        await new Promise(r => setTimeout(r, 20));
        if (isWriting) return false; 
    }

    isWriting = true;

    try {
        if (canId) {
            // Оптимізація заголовка ТІЛЬКИ для BLE
            if (!isBle || canId !== state.lastSetHeader) {
                state.lastRequestId = canId;
                await writer.write(`ATSH${canId}\r`);
                
                // Classic: 20мс (як було), BLE: 60мс (для стабільності)
                await new Promise(r => setTimeout(r, isBle ? 60 : 20));
                
                if (isBle) state.lastSetHeader = canId;
            }
        }

        // 2. ВІДПРАВКА ДАНИХ
        await writer.write(`${data}\r`);
        
        // 3. ПАУЗА ПІСЛЯ ЗАПИТУ
        // Classic: твої робочі 50мс
        // BLE: ТІЛЬКИ 20мс (решту часу ми чекаємо в реактивній черзі)
        const postWait = isBle ? 20 : 50; 
        await new Promise(r => setTimeout(r, postWait));
        
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