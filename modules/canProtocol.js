import { state } from './state.js';
import { logMessage } from './ui.js';

/**
 * УНІВЕРСАЛЬНА функція відправки CAN-запиту
 */
export async function sendCanRequest(canId, data) {
    // 💡 Вибираємо активний writer: або від Serial, або від Bluetooth
    const writer = state.writer || state.bleWriter;

    if (!writer) {
        logMessage('ПОМИЛКА: Адаптер не підключено (немає writer).');
        return false;
    }
    
    try {
        if (state.adapterType === 'elm327') {
            // Передаємо обраний writer у функцію ELM327
            await sendCanRequest_ELM327(canId, data, writer);
        } else if (state.adapterType === 'slcan') {
            await sendCanRequest_SLCAN(canId, data, writer);
        }
        return true;
    } catch (e) {
        logMessage(`Помилка відправки: ${e.message}`);
        return false;
    }
}

// Оновлюємо внутрішню функцію, щоб вона приймала writer як аргумент
async function sendCanRequest_ELM327(canId, data, writer) {
    state.lastRequestId = canId.toUpperCase();
    
    // Тепер запис іде в той канал, який ми вибрали вище
    await writer.write(`ATSH${canId}\r`);
    await new Promise(resolve => setTimeout(resolve, 15)); // Трохи більше часу для BLE
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
    // Прибираємо промпт на початку
    let cleanLine = line;
    if (cleanLine.startsWith('>')) {
        cleanLine = cleanLine.substring(1).trim();
    }
    
    // РОЗШИРЕНИЙ ФІЛЬТР службових повідомлень
    if (!cleanLine || 
        cleanLine === 'OK' || 
        cleanLine === '?' || 
        cleanLine.includes('ELM327') || 
        cleanLine.startsWith('V') || 
        cleanLine === 'SEARCHING...' ||
        cleanLine.startsWith('NO DATA') ||
        cleanLine.startsWith('CAN ERROR') ||
        cleanLine.startsWith('BUS INIT') ||
        cleanLine.startsWith('UNABLE') ||
        // ДОДАНО: Фільтруємо AT-команди
        cleanLine.startsWith('AT') ||
        cleanLine.match(/^[A-Z]{2,}[0-9]*$/)) { // Команди типу ATZ, ATE0, ATSP6, тощо
        return null;
    }
    
    // logMessage(`[PARSE TRY] Adapter: ${state.adapterType} | Line: "${cleanLine}"`);
    
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
        return { id, data };
    }
    return null;
}

/**
 * Парсинг для ELM327
 */
function parseCanResponse_ELM327(line) {
    // Перевіряємо чи це не ехо нашої команди
    if (line.startsWith('ATSH') || line.match(/^[0-9A-F]{6,}$/i)) {
        // Це або команда ATSH, або hex дані що ми відправили
        // Якщо це тільки hex (наш запит) - ігноруємо
        if (line.match(/^[0-9A-F]{6}$/i)) {
            return null; // Це ехо нашого запиту типу "220301"
        }
    }
    
    const parts = line.split(' ');
    // logMessage(`[ELM PARSE] Parts: ${JSON.stringify(parts)}, Length: ${parts.length}`);
    
    // Формат 1: "7BB 62 03 01 ..." (ID + дані з пробілами, заголовки працюють)
    if (parts.length >= 2 && parts[0].length === 3 && /^[0-9A-F]{3}$/i.test(parts[0])) {
        const id = parts[0].toUpperCase();
        const data = parts.slice(1).join('').toUpperCase();
        // logMessage(`[ELM PARSE ✓] ID: ${id}, Data: ${data}`);
        return { id, data };
    }
    
    // Формат 2: "7BB62030101..." (ID + дані без пробілів)
    if (parts.length === 1 && line.length > 3) {
        // Перевіряємо чи перші 3 символи - це валідний ID
        const possibleId = line.substring(0, 3).toUpperCase();
        if (/^[0-9A-F]{3}$/i.test(possibleId)) {
            const data = line.substring(3).toUpperCase();
            // logMessage(`[ELM PARSE NO SPACE ✓] ID: ${possibleId}, Data: ${data}`);
            return { id: possibleId, data };
        }
    }
    
    // Формат 3: "62 03 01 FF FF..." (тільки дані, без ID - заголовки не працюють)
    if (parts.length >= 2 && /^[0-9A-F]{2}$/i.test(parts[0]) && /^[0-9A-F]{2}$/i.test(parts[1])) {
        if (state.lastRequestId) {
            const data = line.split(' ').join('').toUpperCase();
            // logMessage(`[ELM PARSE NO HEADER ✓] ID: ${mapRequestToResponseId(state.lastRequestId)}, Data: ${data}`);
            
            const responseId = mapRequestToResponseId(state.lastRequestId);
            return { id: responseId, data };
        }
    }
    
    // logMessage(`[ELM PARSE ✗] Не вдалося розпізнати формат`);
    return null;
}

/**
 * Мапить ID запиту на ID відповіді
 */
function mapRequestToResponseId(requestId) {
    // Для діагностичних запитів: 0x7XY -> відповідь 0x7(X+8)Y
    // 79B -> 7BB
    const match = requestId.match(/^7([0-9A-F])([0-9A-F])$/i);
    if (match) {
        const x = parseInt(match[1], 16);
        const y = match[2];
        const responseX = (x + 8).toString(16).toUpperCase();
        return `7${responseX}${y.toUpperCase()}`;
    }
    
    return requestId;
}