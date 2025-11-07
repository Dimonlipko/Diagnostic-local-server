import { state } from './state.js';
import { logMessage } from './ui.js'; // ДОДАНО ІМПОРТ

/**
 * УНІВЕРСАЛЬНА функція відправки CAN-запиту
 */
export async function sendCanRequest(canId, data) {
    if (!state.writer) {
        logMessage('ПОМИЛКА: Адаптер не підключено.');
        return false;
    }
    
    try {
        if (state.adapterType === 'elm327') {
            await sendCanRequest_ELM327(canId, data);
        } else if (state.adapterType === 'slcan') {
            await sendCanRequest_SLCAN(canId, data);
        } else {
            logMessage(`ПОМИЛКА: Невідомий тип адаптера: ${state.adapterType}`);
            return false;
        }
        return true;
    } catch (e) {
        logMessage(`Помилка відправки: ${e.message}`);
        return false;
    }
}

/**
 * Відправка для ELM327
 */
async function sendCanRequest_ELM327(canId, data) {
    // Зберігаємо ID запиту для парсингу відповіді
    state.lastRequestId = canId.toUpperCase();
    
    await state.writer.write(`ATSH ${canId}\r`);
    await new Promise(resolve => setTimeout(resolve, 10));
    await state.writer.write(`${data}\r`);
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
    // Прибираємо промпт на початку
    let cleanLine = line;
    if (cleanLine.startsWith('>')) {
        cleanLine = cleanLine.substring(1).trim();
    }
    
    // Ігноруємо службові повідомлення
    if (!cleanLine || 
        cleanLine === 'OK' || 
        cleanLine === '?' || 
        cleanLine.includes('ELM327') || 
        cleanLine.startsWith('V') || 
        cleanLine === 'SEARCHING...' ||
        cleanLine.startsWith('NO DATA')) {
        return null;
    }
    
    logMessage(`[PARSE TRY] Adapter: ${state.adapterType} | Line: "${cleanLine}"`);
    
    if (state.adapterType === 'slcan') {
        const result = parseCanResponse_SLCAN(cleanLine);
        if (result) logMessage(`[SLCAN ✓] ID: ${result.id}, Data: ${result.data}`);
        return result;
    } else if (state.adapterType === 'elm327') {
        const result = parseCanResponse_ELM327(cleanLine);
        if (result) logMessage(`[ELM ✓] ID: ${result.id}, Data: ${result.data}`);
        return result;
    }
    
    return null;
}

/**
 * Парсинг для SLCAN
 */
function parseCanResponse_SLCAN(line) {
    if (line.startsWith('t')) {
        const id = line.substring(1, 4).toUpperCase();
        const dlc = parseInt(line.substring(4, 5), 16);
        const data = line.substring(5, 5 + dlc * 2).toUpperCase();
        logMessage(`[SLCAN PARSE] ID: ${id}, DLC: ${dlc}, Data: ${data}`);
        return { id, data };
    }
    return null;
}

/**
 * Парсинг для ELM327
 */
function parseCanResponse_ELM327(line) {
    // Прибираємо можливий промпт ">" на початку
    let cleanLine = line;
    if (cleanLine.startsWith('>')) {
        cleanLine = cleanLine.substring(1).trim();
    }
    
    // Якщо рядок порожній після очищення - ігноруємо
    if (!cleanLine) return null;
    
    const parts = cleanLine.split(' ');
    logMessage(`[ELM PARSE] Parts: ${JSON.stringify(parts)}, Length: ${parts.length}`);
    
    // Формат 1: "7BB 07 62 03 01 ..." (ID + дані з пробілами, заголовки увімкнені)
    if (parts.length > 2 && parts[0].length === 3 && /^[0-9A-F]{3}$/i.test(parts[0])) {
        const id = parts[0].toUpperCase();
        const data = parts.slice(1).join('').toUpperCase();
        logMessage(`[ELM PARSE ✓] ID: ${id}, Data: ${data}`);
        return { id, data };
    }
    
    // Формат 2: "7BB07620301..." (ID + дані без пробілів)
    if (parts.length === 1 && cleanLine.length > 3 && /^[0-9A-F]{3}/i.test(cleanLine.substring(0, 3))) {
        const id = cleanLine.substring(0, 3).toUpperCase();
        const data = cleanLine.substring(3).toUpperCase();
        logMessage(`[ELM PARSE NO SPACE ✓] ID: ${id}, Data: ${data}`);
        return { id, data };
    }
    
    // Формат 3: "62 03 01 FF FF..." (тільки дані, без ID - використовуємо останній запитуваний ID)
    // Це відбувається, коли заголовки не працюють
    if (parts.length > 1 && /^[0-9A-F]{2}$/i.test(parts[0])) {
        // Використовуємо ID з останнього запиту (зберігаємо в state)
        if (state.lastRequestId) {
            const data = cleanLine.split(' ').join('').toUpperCase();
            logMessage(`[ELM PARSE NO HEADER ✓] Використовую ID з запиту: ${state.lastRequestId}, Data: ${data}`);
            
            // Мапінг: запит до 79B -> відповідь від 7BB
            const responseId = mapRequestToResponseId(state.lastRequestId);
            return { id: responseId, data };
        } else {
            logMessage(`[ELM PARSE ✗] Дані без ID, але немає інформації про останній запит`);
        }
    }
    
    logMessage(`[ELM PARSE ✗] Не вдалося розпізнати формат`);
    return null;
}

/**
 * Мапить ID запиту на ID відповіді
 * Наприклад: 79B (запит) -> 7BB (відповідь)
 */
function mapRequestToResponseId(requestId) {
    // Загальне правило: для діагностичних запитів 0x7XY -> відповідь 0x7(X+8)Y
    // 79B -> 7BB, 79A -> 7BA, тощо
    const match = requestId.match(/^7([0-9A-F])([0-9A-F])$/i);
    if (match) {
        const x = parseInt(match[1], 16);
        const y = match[2];
        const responseX = (x + 8).toString(16).toUpperCase();
        return `7${responseX}${y.toUpperCase()}`;
    }
    
    // Якщо не вдалося розпізнати - повертаємо як є
    return requestId;
}