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
    // 💡 ОЧИЩЕННЯ: Видаляємо пробіли та ">" одразу для всього рядка
    const clean = line.replace(/>/g, '').replace(/\s+/g, '').trim().toUpperCase();

    if (!clean || clean.length < 4) return null;

    // Якщо це відповідь з ID (напр. "7BB620304...")
    if (clean.length > 3 && /^[0-9A-F]+$/i.test(clean)) {
        const possibleId = clean.substring(0, 3);
        const data = clean.substring(3);
        
        // Перевіряємо, чи це справді схоже на відповідь (починається з 62 або 41)
        if (data.startsWith('62') || data.startsWith('41')) {
            return { id: possibleId, data: data };
        }
    }
    
    // Якщо ID немає в рядку, використовуємо останній запитаний ID зі state
    if (clean.startsWith('62') || clean.startsWith('41')) {
        const responseId = (state.lastRequestId === '79B') ? '7BB' : (state.lastRequestId || '7BB');
        return { id: responseId, data: clean };
    }

    return null;
}