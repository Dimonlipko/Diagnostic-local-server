import { state } from './state.js';
import { logMessage } from './ui.js';

/**
 * УНІВЕРСАЛЬНА функція відправки CAN-запиту
 */
export async function sendCanRequest(canId, data) {
    // 1. Отримуємо актуальний writer зі стану
    const writer = state.writer || state.bleWriter;

    // 2. Перевірка наявності writer перед спробою запису
    if (!writer) {
        console.error("[Protocol] Помилка: Writer не знайдено в state.");
        return false;
    }
    
    try {
        // 3. Якщо передано canId, встановлюємо заголовок (для ELM327)
        if (canId) {
            state.lastRequestId = canId.toUpperCase();
            await writer.write(`ATSH${canId}\r`);
            
            // Маленька затримка між командами для стабільності
            const delay = state.connectionType === 'ble' ? 50 : 20;
            await new Promise(resolve => setTimeout(resolve, delay));
        }
        
        // 4. Відправляємо основні дані
        await writer.write(`${data}\r`);
        return true;
    } catch (e) {
        // Виводимо помилку в лог інтерфейсу
        if (typeof logMessage === 'function') {
            logMessage(`Помилка відправки: ${e.message}`);
        }
        console.error(`[Protocol] Помилка запису:`, e);
        return false;
    }
}

/**
 * Відправка для ELM327
 */
async function sendCanRequest_ELM327(canId, data, writer) {
    // Якщо canId передано (запит до авто), встановлюємо заголовок
    if (canId) {
        state.lastRequestId = canId.toUpperCase();
        await writer.write(`ATSH${canId}\r`);
        const delay = state.connectionType === 'ble' ? 30 : 15;
        await new Promise(resolve => setTimeout(resolve, delay));
    }
    
    // Відправляємо самі дані (або пряму команду терміналу)
    await writer.write(`${data}\r`);
}

/**
 * Відправка для SLCAN
 */
async function sendCanRequest_SLCAN(canId, data) {
    const dlc = (data.length / 2).toString(16);
    const message = `t${canId}${dlc}${data}\r`;
    await state.writer.write(message);
}

/**
 * УНІВЕРСАЛЬНА функція парсингу CAN-відповіді
 */
export function parseCanResponse(line) {
    let cleanLine = line.trim();
    if (cleanLine.startsWith('>')) {
        cleanLine = cleanLine.substring(1).trim();
    }
    if (!cleanLine) return null;

    // 1. Визначаємо, чи ми на сторінці терміналу
    const isTerminalPage = !!document.querySelector('.terminal-container') || 
                          !!document.getElementById('terminal-output');

    // 2. Викликаємо твій детальний парсер для перевірки на CAN-пакет
    const parsed = parseCanResponse_ELM327(cleanLine);

    // 3. ЛОГІКА ТЕРМІНАЛУ:
    // Показуємо в терміналі тільки те, що НЕ є CAN-пакетом (команди, вольтаж, помилки)
    if (isTerminalPage && !parsed) {
        logMessage(`[RAW IN]: ${cleanLine}`);
    }

    return parsed;
}

/**
 * Твій перевірений парсер ELM327 (інтегрований)
 */
function parseCanResponse_ELM327(line) {
    // Очищаємо від можливих залишків промпта для надійності
    const clean = line.replace('>', '').trim();

    // Перевіряємо чи це не ехо нашої команди
    if (clean.startsWith('ATSH') || clean.match(/^[0-9A-F]{6,}$/i)) {
        if (clean.match(/^[0-9A-F]{6}$/i)) {
            return null; // Це ехо запиту типу "220301"
        }
    }
    
    const parts = clean.split(' ');
    
    // Формат 1: "7BB 62 03 01 ..." (ID + дані з пробілами)
    if (parts.length >= 2 && parts[0].length === 3 && /^[0-9A-F]{3}$/i.test(parts[0])) {
        const id = parts[0].toUpperCase();
        const data = parts.slice(1).join('').toUpperCase();
        return { id, data };
    }
    
    // Формат 2: "7BB62030101..." (ID + дані без пробілів)
    if (parts.length === 1 && clean.length > 3) {
        const possibleId = clean.substring(0, 3).toUpperCase();
        if (/^[0-9A-F]{3}$/i.test(possibleId)) {
            const data = clean.substring(3).toUpperCase();
            return { id: possibleId, data };
        }
    }
    
    // Формат 3: "62 03 01 FF FF..." (без ID, базуємось на lastRequestId)
    if (parts.length >= 2 && /^[0-9A-F]{2}$/i.test(parts[0]) && /^[0-9A-F]{2}$/i.test(parts[1])) {
        if (state.lastRequestId) {
            const data = clean.split(' ').join('').toUpperCase();
            const responseId = mapRequestToResponseId(state.lastRequestId);
            return { id: responseId, data };
        }
    }
    
    return null;
}

/**
 * Допоміжна функція для мапінгу ID (якщо вона у тебе була)
 */
function mapRequestToResponseId(reqId) {
    // Наприклад, запит 79B -> відповідь 7BB
    if (reqId === '79B') return '7BB';
    if (reqId === '7E0') return '7E8';
    return reqId; 
}