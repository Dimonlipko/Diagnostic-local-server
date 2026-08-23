import { state } from './state.js';
import { logMessage } from './ui.js';


import { reinitAdapter } from './elmInit.js';

let rawFrameConsumer = null;
export function setRawFrameConsumer(fn) { rawFrameConsumer = fn; }

// --- Виявлення злетілої конфігурації адаптера --------------------------------
// При ATE0 адаптер НЕ МАЄ повертати надіслане. Якщо повертає — на ньому знову
// ATE1, тобто конфігурацію збито, і разом з нею зникли ATH1/ATCRA/ATSH. Запити
// після цього йдуть у нікуди назавжди: watchdog бачить трафік і вважає звʼязок
// живим, хоч усе, що приходить, — наші ж команди.
const ECHO_STRIKES_TO_REINIT = 3;

let recentSends = [];
let echoStrikes = 0;

function rememberSend(payload) {
    recentSends.push(payload);
    if (recentSends.length > 4) recentSends.shift();
}

function looksLikeOwnEcho(clean) {
    return recentSends.includes(clean);
}

function noteEcho() {
    if (++echoStrikes < ECHO_STRIKES_TO_REINIT) return;
    echoStrikes = 0;
    recentSends = [];
    reinitAdapter('адаптер повертає ехо команд (ATE0 злетів)', logMessage);
}

// === Prompt-gate ===
// ELM327 приймає нову команду лише після того, як віддав '>'. Команда, надіслана
// поки він ще опитує шину, на оригіналі дає '?' або STOPPED, а на клонах — ERR9x
// і внутрішній ресет, після якого ехо вмикається назад і сесія мертва до
// перепідключення вручну. Фіксовані паузи цього не гарантували: DID, який ECU не
// віддає, тримає адаптер зайнятим повний ATST32 (200 мс), а наступний запит ішов
// уже через 20.
let promptReady = true;
let promptWaiters = [];
let lastSendAt = 0;
let missedPrompts = 0;

// AT-команди ELM виконує локально й відповідає одразу; запит на шину чекає
// відповіді ECU або власного таймауту ATST32=200 мс, тож запас більший.
const AT_PROMPT_TIMEOUT = 400;
const DATA_PROMPT_TIMEOUT = 700;

// Кожен '>' у вхідному потоці — дозвіл на наступну команду.
export function notePrompt() {
    promptReady = true;
    const waiters = promptWaiters;
    promptWaiters = [];
    for (const w of waiters) w();
}

// Після конекту й після OTA адаптер конфігурується в обхід черги — стан gate
// треба привести до реальності, інакше перший запит чекатиме неіснуючий '>'.
export function resetPromptGate() {
    lastSendAt = 0;
    missedPrompts = 0;
    echoStrikes = 0;
    recentSends = [];
    notePrompt();
}

// Скільки минуло з останньої відправленої команди. Watchdog у pollingManager
// використовує це, щоб не штовхати чергу поверх запиту, який ще в польоті.
export function msSinceLastSend() {
    return lastSendAt ? Date.now() - lastSendAt : Infinity;
}

function awaitPrompt(timeoutMs) {
    if (promptReady) return Promise.resolve(true);

    return new Promise(resolve => {
        let settled = false;
        const waiter = () => {
            if (settled) return;
            settled = true;
            clearTimeout(timer);
            resolve(true);
        };
        const timer = setTimeout(() => {
            if (settled) return;
            settled = true;
            promptWaiters = promptWaiters.filter(w => w !== waiter);
            resolve(false);
        }, timeoutMs);
        promptWaiters.push(waiter);
    });
}

// Єдина точка запису в адаптер для всього, що йде через чергу запитів.
async function writeGated(writer, text, timeoutMs) {
    const gotPrompt = await awaitPrompt(timeoutMs);
    if (!gotPrompt) {
        // Мертвий адаптер дає промах на КОЖНІЙ команді — друкуємо перший і далі
        // раз на десять, інакше консоль стає нечитабельною саме тоді, коли її
        // читають.
        if (missedPrompts++ % 10 === 0) {
            console.log(`[Protocol] '>' не дочекались за ${timeoutMs} мс, шлемо ${text.trim()}`);
        }
    } else {
        missedPrompts = 0;
    }
    promptReady = false;
    lastSendAt = Date.now();
    await writer.write(text);
}

// Серіалізація всіх запитів: polling, разові читання, SOC-мапа. Раніше замок
// існував лише для BLE й при зайнятості ПРОПУСКАВ запит, а для Web Serial його
// не було зовсім — два драйвери черги (onComplete і watchdog) писали в адаптер
// одночасно.
let txChain = Promise.resolve();

// === ISO-TP Multi-Frame стан ===
const isotpState = {
    active: false,
    canId: '',
    expectedLength: 0,
    buffer: '',
    timeout: null,
    needsFC: false,
    nextSeq: 0,
    fcFallback: null
};

export function sendCanRequest(canId, data) {
    // Стаємо в чергу незалежно від результату попереднього запиту: помилка
    // одного не має зупиняти решту.
    const run = () => doSendCanRequest(canId, data);
    txChain = txChain.then(run, run);
    return txChain;
}

async function doSendCanRequest(canId, data) {
    const writer = state.writer;
    if (!writer) return false;

    // Черга могла набратись до того, як звʼязок обірвався. Кидати ці запити в
    // мертвий транспорт немає сенсу: кожен дає промах промпта плюс виняток від
    // GATT, і лог тоне в сотнях однакових рядків.
    if (!state.isConnected) return false;

    // Під час переініціалізації адаптер отримує ATZ і всю AT-послідовність повз
    // чергу — UDS-запит, що вклинився б між ними, зіпсував би налаштування.
    if (state.reinitInProgress) return false;

    const isBle = state.connectionType === 'ble';

    try {
        if (canId) {
            state.lastRequestId = canId;
            // Заголовок не переставляємо, якщо він уже той самий (економія на BLE,
            // де кожна команда коштує окремого GATT-запису).
            if (!isBle || canId !== state.lastSetHeader) {
                await writeGated(writer, `ATSH${canId}\r`, AT_PROMPT_TIMEOUT);
                if (isBle) state.lastSetHeader = canId;
            }
        }

        // ATCAF0: PCI-байт додаємо вручну.
        const pciHex = (data.length / 2).toString(16).padStart(2, '0');
        rememberSend(`${pciHex}${data}`.toUpperCase());
        await writeGated(writer, `${pciHex}${data}\r`, DATA_PROMPT_TIMEOUT);
        console.log(`[Protocol] >>> SEND: ${pciHex}${data}`);

        return true;
    } catch (e) {
        console.error(`[Protocol] Помилка запису:`, e);
        return false;
    }
}

/**
 * Головна функція парсингу, яка об'єднує термінал та логіку даних
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

    // ERR9x — внутрішня помилка клона, після якої він перезавантажується і
    // повертається в дефолти (ехо ON, ATH/ATCRA/ATSH скинуті). Однозначніший і
    // швидший сигнал, ніж рахувати ехо: реагуємо з першої появи.
    if (/^ERR\d/.test(clean)) {
        console.warn(`[Protocol] Адаптер повідомив ${clean}`);
        echoStrikes = 0;
        recentSends = [];
        reinitAdapter(`адаптер повідомив ${clean}`, logMessage);
        return null;
    }

    // Ігноруємо ЕХО команд (запити без CAN ID префіксу)
    if (clean.startsWith('AT') ||
        clean.startsWith('22') ||
        clean.startsWith('30') ||
        (clean.startsWith('21') && clean.length <= 8) ||
        (clean.startsWith('02') && clean.length <= 8) ||
        (clean.startsWith('03') && clean.length <= 12)) {
        console.log(`[DEBUG PARSER]: Ігноруємо ЕХО: ${clean}`);
        // Дослівне повернення нашого ж запиту — доказ, що ATE0 злетів.
        if (looksLikeOwnEcho(clean)) noteEcho();
        return null;
    }

    let id = "";
    let data = "";

    // Формат: "7BB07620301..." (З CAN ID)
    if (clean.length > 3 && clean.startsWith('7')) {
        id = clean.substring(0, 3);
        data = clean.substring(3);
        echoStrikes = 0; // кадр з заголовком — ATH1 і ATE0 на місці
    }
    // Raw CAN frame з CCS-контролера (CANopen SDO відповідь 0x580+nodeId, типово 0x596).
    // Парсер UDS не знає, що з ним робити — віддаємо споживачу (canopenSdo.js).
    else if (clean.length >= 19 && (clean.startsWith('5') || clean.startsWith('6'))) {
        const fid = clean.substring(0, 3);
        const fdata = clean.substring(3);
        if (rawFrameConsumer) {
            try { rawFrameConsumer(fid, fdata); } catch (e) { console.warn('[rawFrame]', e); }
        }
        return null;
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

        // ми відправимо FC вручну коли ELM закінчить прийом (readLoop/BLE handler)
        isotpState.needsFC = true;

        // Таймаут безпеки: скидаємо стан якщо CF не прийшли
        if (isotpState.timeout) clearTimeout(isotpState.timeout);
        isotpState.timeout = setTimeout(() => {
            if (isotpState.active) {
                console.warn('[ISO-TP] Таймаут очікування CF - скидання');
                if (isotpState.fcFallback) { clearTimeout(isotpState.fcFallback); isotpState.fcFallback = null; }
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
            const gap = (seqNum - isotpState.nextSeq + 16) % 16;
            if (gap > 4) {
                // Занадто великий розрив — скидаємо збірку
                console.error(`[ISO-TP] SEQ gap=${gap} занадто великий — скидання збірки`);
                if (isotpState.timeout) clearTimeout(isotpState.timeout);
                if (isotpState.fcFallback) { clearTimeout(isotpState.fcFallback); isotpState.fcFallback = null; }
                isotpState.active = false;
                isotpState.needsFC = false;
                isotpState.buffer = '';
                return null;
            }
            // Невеликий розрив (1-4 CF) — заповнюємо нулями і продовжуємо
            console.warn(`[ISO-TP] Пропущено ${gap} CF (очікувався ${isotpState.nextSeq.toString(16)}, прийшов ${seqNum.toString(16)}) — заповнюємо нулями`);
            isotpState.buffer += '00'.repeat(7 * gap);
        }
        isotpState.nextSeq = (seqNum + 1) & 0x0F; // 0→1→...→F→0 (wrap)

        // CF прийшов — fallback не потрібен
        if (isotpState.fcFallback) {
            clearTimeout(isotpState.fcFallback);
            isotpState.fcFallback = null;
        }

        // Payload CF = все після 2 hex символів (1 байт заголовку CF)
        const payloadHex = data.substring(2);
        isotpState.buffer += payloadHex;

        // Скидаємо таймаут при кожному CF (збірка може тривати довго з manual FC)
        if (isotpState.timeout) clearTimeout(isotpState.timeout);
        isotpState.timeout = setTimeout(() => {
            if (isotpState.active) {
                console.warn('[ISO-TP] Таймаут очікування CF - скидання');
                if (isotpState.fcFallback) { clearTimeout(isotpState.fcFallback); isotpState.fcFallback = null; }
                isotpState.active = false;
                isotpState.needsFC = false;
                isotpState.buffer = '';
            }
        }, 5000);

        const receivedBytes = isotpState.buffer.length / 2;
        console.log(`[ISO-TP] CF: отримано ${receivedBytes}/${isotpState.expectedLength} bytes`);

        if (receivedBytes < isotpState.expectedLength) {
            // ECU + BLE-ELM віддають рівно 1 CF на 1 FC (BLE-ELM слухає шину
            // тільки поки веб пише команду). Тому BS=1 ping-pong: після кожного
            // CF просимо наступний. БЕЗ 400 мс BS=0-fallback — саме зайвий другий
            // FC при BLE-затримці десинхронізував ECU і губив ~кожен 9-й кадр.
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
            if (isotpState.fcFallback) { clearTimeout(isotpState.fcFallback); isotpState.fcFallback = null; }
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
 * Відправка ручного Flow Control
 * Викликається з readLoop/BLE handler коли ELM закінчив прийом даних
 * FC = 30 01 00 00 00 00 00 00 (CTS, BS=1, STmin=0) — строгий ping-pong, без fallback
 */
export async function sendPendingFlowControl() {
    if (!isotpState.needsFC || !isotpState.active) return false;
    isotpState.needsFC = false;

    const writer = state.writer;
    if (!writer) return false;

    // Скидаємо попередній fallback
    if (isotpState.fcFallback) {
        clearTimeout(isotpState.fcFallback);
        isotpState.fcFallback = null;
    }

    try {
        // FC: CTS (30), BS=1 (01), STmin=0 — ECU віддає 1 CF і чекає наступний FC.
        // Жодного BS=0-fallback: зайвий другий FC десинхронізує ECU → втрати кадрів.
        // Черга обходиться свідомо: FC має піти негайно, поки ECU чекає, — але
        // gate про це знати мусить, інакше наступний запит вийде поверх нього.
        promptReady = false;
        lastSendAt = Date.now();
        await writer.write('3001000000000000\r');
        console.log(`[ISO-TP] FC відправлено (BS=1), буфер: ${isotpState.buffer.length/2}/${isotpState.expectedLength} bytes`);
        return true;
    } catch (e) {
        console.error('[ISO-TP] Помилка відправки FC:', e);
        return false;
    }
}
