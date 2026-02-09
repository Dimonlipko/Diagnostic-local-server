import { state } from './state.js';
import { logMessage } from './ui.js';

/**
 * УНІВЕРСАЛЬНА функція відправки CAN-запиту
 */
let isWriting = false; 

/**
 * Універсальна функція відправки CAN-запиту.
 * Забезпечує послідовність операцій для BLE та Serial. */

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
            // 💡 ЗАПАМ'ЯТОВУЄМО ID: Це критично для Android, щоб парсер знав, 
            // що відповідь "62..." належить саме цьому блоку (напр. 7BB)
            state.lastRequestId = canId;

            // Встановлюємо ID (ATSH)
            await writer.write(`ATSH${canId}\r`);
            
            // Оптимізація: 80мс зазвичай достатньо для зміни заголовка в BLE
            await new Promise(r => setTimeout(r, state.connectionType === 'ble' ? 80 : 20));
        }

        // Відправляємо дані (PID)
        await writer.write(`${data}\r`);
        
        // Оптимізація: зменшуємо до 120мс для BLE (замість 150)
        await new Promise(r => setTimeout(r, state.connectionType === 'ble' ? 120 : 50));
        
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
    // 1. Очищуємо все: пробіли, переноси, символи ELM
    const clean = line.replace(/>/g, '').replace(/\s+/g, '').trim().toUpperCase();

    // Ігноруємо технічні повідомлення
    if (!clean || clean.length < 4 || clean === "OK") return null;

    // 2. Сценарій А: Відповідь з заголовком (напр. "7BB620304...")
    // Перевіряємо, чи починається з 7xx і чи після нього йде 62 або 41
    if (clean.length >= 5) {
        const possibleId = clean.substring(0, 3);
        const possibleData = clean.substring(3);
        
        if ((possibleId.startsWith('7')) && (possibleData.startsWith('62') || possibleData.startsWith('41'))) {
            return { id: possibleId, data: possibleData };
        }
    }
    
    // 3. Сценарій Б: Відповідь БЕЗ заголовка (напр. "620304...")
    // Це те, що ми бачили на твоїх скріншотах з Android
    if (clean.startsWith('62') || clean.startsWith('41')) {
        // Визначаємо ID на основі останнього запиту
        const responseId = (state.lastRequestId === '79B') ? '7BB' : (state.lastRequestId || '7BB');
        
        return { id: responseId, data: clean };
    }

    return null;
}