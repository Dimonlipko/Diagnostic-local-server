import { state } from './state.js';
import { logMessage } from './ui.js';


let isWriting = false;

// === ISO-TP Multi-Frame стан ===
const isotpState = {
    active: false,
    canId: '',
    expectedLength: 0,
    buffer: '',
    timeout: null,
    needsFC: false,
    nextSeq: 0
};

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
            state.lastRequestId = canId;
            // Оптимізація заголовка ТІЛЬКИ для BLE
            if (!isBle || canId !== state.lastSetHeader) {
                await writer.write(`ATSH${canId}\r`);
                
                // Classic: 20мс (як було), BLE: 60мс (для стабільності)
                await new Promise(r => setTimeout(r, isBle ? 60 : 20));
                
                if (isBle) state.lastSetHeader = canId;
            }
        }

        // 2. ВІДПРАВКА ДАНИХ (ATCAF0: додаємо PCI байт вручну)
        const pciHex = (data.length / 2).toString(16).padStart(2, '0');
        await writer.write(`${pciHex}${data}\r`);
        console.log(`[Protocol] >>> SEND: ${pciHex}${data}`);
        
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
 * Парсер ELM327 з підтримкою ISO-TP Multi-Frame
 */
function parseCanResponse_ELM327(line) {
    const clean = line.replace(/\s+/g, '').replace('>', '').trim().toUpperCase();
    if (!clean || clean === "OK" || clean === "STOPPED" || clean === "NODATA" || clean === "NO DATA" || clean === "CANERROR" || clean === "?" || clean === "BUFFERFULL") return null;

    console.log(`[DEBUG RAW IN]: "${clean}" | Len: ${clean.length}`);

    // Ігноруємо ЕХО команд (запити без CAN ID префіксу)
    if (clean.startsWith('AT') ||
        clean.startsWith('22') ||
        clean.startsWith('30') ||
        (clean.startsWith('21') && clean.length <= 8) ||
        (clean.startsWith('02') && clean.length <= 8) ||
        (clean.startsWith('03') && clean.length <= 12)) {
        console.log(`[DEBUG PARSER]: Ігноруємо ЕХО: ${clean}`);
        return null;
    }

    let id = "";
    let data = "";

    // Формат: "7BB07620301..." (З CAN ID)
    if (clean.length > 3 && clean.startsWith('7')) {
        id = clean.substring(0, 3);
        data = clean.substring(3);
    }
    // Формат без ID: "620301..." або "6141..."
    else if (clean.startsWith('62') || clean.startsWith('61')) {
        if (state.lastRequestId) {
            id = (state.lastRequestId === '79B') ? '7BB' : state.lastRequestId;
            data = clean;
        } else {
            return null;
        }
    }

    if (!id || !data || data.length < 2) return null;

    // === ISO-TP Multi-Frame обробка ===
    const firstNibble = parseInt(data.charAt(0), 16);

    // --- First Frame: 1XXX (перший ніббл = 1) ---
    if (firstNibble === 1 && data.length >= 8) {
        const byte0 = parseInt(data.substring(0, 2), 16);
        const byte1 = parseInt(data.substring(2, 4), 16);
        const totalLength = ((byte0 & 0x0F) << 8) | byte1;

        // Payload FF = все після 4 hex символів (2 байти заголовку FF)
        const payloadHex = data.substring(4);

        isotpState.active = true;
        isotpState.canId = id;
        isotpState.expectedLength = totalLength;
        isotpState.buffer = payloadHex;
        isotpState.nextSeq = 1;

        console.log(`[ISO-TP] First Frame: id=${id}, totalLength=${totalLength}, ffPayload=${payloadHex.length / 2} bytes`);

        // ATFCSM1 повинен відправити FC автоматично, але як fallback
        // ми відправимо FC вручну коли ELM закінчить прийом (readLoop/BLE handler)
        isotpState.needsFC = true;

        // Таймаут безпеки: скидаємо стан якщо CF не прийшли
        if (isotpState.timeout) clearTimeout(isotpState.timeout);
        isotpState.timeout = setTimeout(() => {
            if (isotpState.active) {
                console.warn('[ISO-TP] Таймаут очікування CF - скидання');
                isotpState.active = false;
                isotpState.needsFC = false;
                isotpState.buffer = '';
            }
        }, 5000);

        return null; // Чекаємо на Consecutive Frames
    }

    // --- Consecutive Frame: 2X (перший ніббл = 2) ---
    if (firstNibble === 2 && isotpState.active && id === isotpState.canId) {
        // Перевірка послідовності (другий ніббл = sequence 0-F)
        const seqNum = parseInt(data.charAt(1), 16);
        if (seqNum !== isotpState.nextSeq) {
            console.error(`[ISO-TP] SEQ MISMATCH! Очікується ${isotpState.nextSeq.toString(16)}, отримано ${seqNum.toString(16)} — скидання збірки`);
            if (isotpState.timeout) clearTimeout(isotpState.timeout);
            isotpState.active = false;
            isotpState.needsFC = false;
            isotpState.buffer = '';
            return null;
        }
        isotpState.nextSeq = (seqNum + 1) & 0x0F; // 0→1→...→F→0 (wrap)

        // Payload CF = все після 2 hex символів (1 байт заголовку CF)
        const payloadHex = data.substring(2);
        isotpState.buffer += payloadHex;

        // Скидаємо таймаут при кожному CF (збірка може тривати довго з manual FC)
        if (isotpState.timeout) clearTimeout(isotpState.timeout);
        isotpState.timeout = setTimeout(() => {
            if (isotpState.active) {
                console.warn('[ISO-TP] Таймаут очікування CF - скидання');
                isotpState.active = false;
                isotpState.needsFC = false;
                isotpState.buffer = '';
            }
        }, 5000);

        const receivedBytes = isotpState.buffer.length / 2;
        console.log(`[ISO-TP] CF: отримано ${receivedBytes}/${isotpState.expectedLength} bytes`);

        if (receivedBytes < isotpState.expectedLength) {
            // Збірка не завершена — потрібен ще один FC для наступного CF (BS=1 ping-pong)
            isotpState.needsFC = true;
        }

        if (receivedBytes >= isotpState.expectedLength) {
            // Збірка завершена! Формуємо дані як для single-frame
            const completePayload = isotpState.buffer.substring(0, isotpState.expectedLength * 2);

            // Додаємо фейковий PCI байт (довжина) для сумісності з handleCanResponse
            const pciHex = isotpState.expectedLength.toString(16).padStart(2, '0').toUpperCase();
            const assembledData = pciHex + completePayload;

            // Скидаємо стан
            if (isotpState.timeout) clearTimeout(isotpState.timeout);
            isotpState.active = false;
            isotpState.needsFC = false;
            isotpState.buffer = '';

            console.log(`[ISO-TP] Збірка завершена! ${isotpState.expectedLength} bytes, assembledData length=${assembledData.length}`);
            return { id, data: assembledData };
        }

        return null; // Чекаємо на наступні CF
    }

    // --- Single Frame: звичайна відповідь ---
    return { id, data };
}

/**
 * Перевірка чи ISO-TP збірка активна (для watchdog в pollingManager)
 */
export function isIsotpActive() {
    return isotpState.active;
}

/**
 * Відправка ручного Flow Control (fallback якщо ATFCSM1 не спрацював)
 * Викликається з readLoop/BLE handler коли ELM закінчив прийом даних
 * FC = 30 00 00 00 00 00 00 00 (CTS, BS=0, STmin=0)
 */
export async function sendPendingFlowControl() {
    if (!isotpState.needsFC || !isotpState.active) return false;
    isotpState.needsFC = false;

    const writer = state.writer;
    if (!writer) return false;

    try {
        // FC: CTS (30), BS=1 (01) — ECU відправляє 1 CF і чекає наступний FC
        // Ping-pong: FC→CF→FC→CF→... поки збірка не завершена
        await writer.write('3001000000000000\r');
        console.log(`[ISO-TP] FC відправлено (BS=1), буфер: ${isotpState.buffer.length/2}/${isotpState.expectedLength} bytes`);
        return true;
    } catch (e) {
        console.error('[ISO-TP] Помилка відправки FC:', e);
        return false;
    }
}