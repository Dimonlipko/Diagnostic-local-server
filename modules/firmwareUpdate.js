// firmwareUpdate.js — OTA прошивки Leaf_V4 ECU по CAN через ELM327
//
// Протокол — той самий, що в референсному хості Leaf_V4/tools/can_flash.py
// (див. Leaf_V4/docs/ota-flashing-guide.md, розділ «CAN-протокол»):
//
//   START  EF BE AD DE CE FA FE CA        -> ack AD DE AF DE …  | 03 … = NOT PARKED
//   DATA   FF loLo loHi b0 b1 b2 b3 00    -> echo loLo loHi (2 байти)
//   END    DE FA DE C0 <CRC32 LE>         -> статус (5 байт): <r> c0 c1 c2 c3
//
// Браузер приймає ВЖЕ ЗАШИФРОВАНИЙ образ (той самий, що йде на шину з
// can_flash.py) — ключ AES сюди не потрапляє. Наслідок: CRC32 у END-кадрі
// рахується над padded ПЛЕЙНТЕКСТОМ, тож із самого шифротексту він
// невиводимий і має приїхати ззовні — заголовком контейнера або вручну.
//
// Два незалежні таргети: застосунок на 0x79B (ECU ребутиться в бутлоадер)
// і сам бутлоадер на 0x7E4 (приймає живий застосунок, без ребуту).

import { state } from './state.js';
import { logMessage } from './ui.js';
import { stopAllPolling } from './pollingManager.js';
import { startLinkWatchdog, stopLinkWatchdog } from './linkStatus.js';

export const OTA_TARGETS = {
    app:  { txId: '79B', unit: 0x00, reboots: true },
    boot: { txId: '7E4', unit: 0x01, reboots: false }
};

const RX_ID = '7BB';
const STATUS_ID = '6A0';        // хост-броадкаст прогресу для інших блоків на шині
const PAGE_SIZE = 256;
const MAX_BYTES = 262144;       // 16-бітний індекс блоку × 4 байти

const FW_START = 'EFBEADDECEFAFECA';
const FW_START_ACK = [0xAD, 0xDE, 0xAF, 0xDE];
const FW_END_MARKER = 'DEFADEC0';

const PHASE = { START: 1, PROGRESS: 2, END_OK: 3, END_FAIL: 4 };

// Таймінги. ELM327 тримає лінію до ATST-таймауту, тож він домінує у вартості
// блоку — звідси коротке ATST для потоку і довше для фінального статусу.
const FIRMWARE_CONFIG = {
    elmStreamSt: '08',      // ATST08 ≈ 32 мс — таймаут ELM під час стріму
    elmNormalSt: '32',      // повертаємо штатне значення з init адаптера
    blockTimeoutMs: 400,
    blockRetries: 5,
    startTimeoutMs: 1500,
    startAttempts: 10,
    bootWaitMs: 2000,
    endTimeoutMs: 4000,
    cmdTimeoutMs: 1000,
    statusEveryPct: 5       // як часто броадкастити 0x6A0 (кожен % — задорого через ELM)
};

let cancelRequested = false;
let otaActive = false;

// --- Утримання системи в активному стані --------------------------------------
// Заливка триває десятки хвилин без жодного вводу від користувача, тож екран
// встиг би заснути, а разом із ним — і сторінка з потоком OTA.

let wakeLock = null;

async function onVisibilityChange() {
    if (!otaActive) return;

    if (document.visibilityState === 'hidden') {
        // Браузер тротлить таймери у фонових вкладках — lockstep-потік із них
        // фактично зупиняється. Wake Lock тут не рятує, потрібна увага людини.
        logMessage('⚠ Вкладку сховано — браузер уповільнює таймери. ' +
                   'Поверни її на передній план, інакше заливка стане.');
        return;
    }

    // Wake Lock автоматично знімається, щойно вкладка ховається — беремо знову
    if (!wakeLock) {
        try {
            wakeLock = await navigator.wakeLock.request('screen');
        } catch (e) { /* не критично */ }
    }
}

async function acquireWakeLock() {
    document.addEventListener('visibilitychange', onVisibilityChange);

    if (!('wakeLock' in navigator)) {
        logMessage('⚠ Wake Lock недоступний — вимкни сон системи вручну ' +
                   '(macOS: caffeinate -dims).');
        return;
    }

    try {
        wakeLock = await navigator.wakeLock.request('screen');
        wakeLock.addEventListener('release', () => { wakeLock = null; });
        logMessage('Екран утримується активним на час заливки (Wake Lock).');
    } catch (e) {
        logMessage(`⚠ Wake Lock не отримано (${e.message}) — вимкни сон вручну.`);
    }
}

async function releaseWakeLock() {
    document.removeEventListener('visibilitychange', onVisibilityChange);
    if (!wakeLock) return;

    try {
        await wakeLock.release();
    } catch (e) { /* уже знято */ }
    wakeLock = null;
}

// --- Приймання сирих кадрів -------------------------------------------------
// Під час OTA штатний UDS/ISO-TP парсер обходиться: тут потрібні сирі кадри
// 0x7BB довільної довжини (ack блоку — це взагалі 2 байти).

let rxBuffer = '';
let frameQueue = [];
let notify = null;

function sinkChunk(text) {
    rxBuffer += text;

    let idx;
    while ((idx = rxBuffer.search(/[\r\n>]/)) >= 0) {
        const line = rxBuffer.slice(0, idx).trim();
        rxBuffer = rxBuffer.slice(idx + 1);
        if (line) frameQueue.push(line.replace(/\s+/g, '').toUpperCase());
    }

    if (notify) notify();
}

function parseFrame(line) {
    // Очікуємо "7BB" + парну кількість hex-символів. Усе інше (OK, NO DATA,
    // CAN ERROR, ехо команд) — не кадр.
    if (!line.startsWith(RX_ID)) return null;
    const body = line.slice(RX_ID.length);
    if (body.length === 0 || body.length % 2 !== 0 || /[^0-9A-F]/.test(body)) return null;

    const bytes = [];
    for (let i = 0; i < body.length; i += 2) {
        bytes.push(parseInt(body.substr(i, 2), 16));
    }
    return bytes;
}

function flushRx() {
    rxBuffer = '';
    frameQueue = [];
}

async function waitForFrame(predicate, timeoutMs) {
    const deadline = Date.now() + timeoutMs;

    for (;;) {
        while (frameQueue.length) {
            const bytes = parseFrame(frameQueue.shift());
            if (bytes && predicate(bytes)) return bytes;
        }

        const remaining = deadline - Date.now();
        if (remaining <= 0) return null;

        await new Promise((resolve) => {
            const timer = setTimeout(() => { notify = null; resolve(); },
                                     Math.min(remaining, 25));
            notify = () => { clearTimeout(timer); notify = null; resolve(); };
        });
    }
}

// --- Низькорівневий ELM -----------------------------------------------------

function toHex(num, bytes = 1) {
    return num.toString(16).toUpperCase().padStart(bytes * 2, '0');
}

async function elmWrite(text) {
    if (!state.writer || !state.isConnected) {
        throw new Error('Адаптер не підключено');
    }
    await state.writer.write(`${text}\r`);
}

/** AT-команда: шлемо і даємо ELM час відпрацювати (відповідь нам не потрібна). */
async function elmCommand(cmd) {
    flushRx();
    await elmWrite(cmd);
    await waitForFrame(() => false, 120); // просто пауза на обробку
}

/** Шле кадр даних і чекає на кадр 0x7BB, що задовольняє predicate. */
async function sendFrame(hex, predicate, timeoutMs) {
    flushRx();
    await elmWrite(hex);
    return await waitForFrame(predicate, timeoutMs);
}

/**
 * Броадкаст статусу OTA на 0x6A0 — його шле ХОСТ, а не ECU, тому він переживає
 * ребути ECU і працює навіть зі старим бутлоадером. Інші блоки (приборка)
 * по ньому входять в обмежений режим. Best-effort: помилка тут не валить заливку.
 */
async function broadcastStatus(target, phase, pct) {
    try {
        await elmCommand(`ATSH${STATUS_ID}`);
        flushRx();
        await elmWrite(`${toHex(target.unit)}${toHex(phase)}${toHex(pct & 0xFF)}0000000000`);
        await waitForFrame(() => false, 80);
        await elmCommand(`ATSH${target.txId}`);
    } catch (e) {
        console.warn('OTA status broadcast failed:', e.message);
    }
}

// --- Підготовка образу ------------------------------------------------------

/**
 * Контейнер OTA — щоб шифрований образ, його CRC і призначення їхали одним
 * файлом (пакує can_flash.py --pack):
 *   0  : магія "LEAFOTA1"               8 Б
 *   8  : CRC32 padded-плейнтексту (LE)  4 Б
 *   12 : довжина шифротексту (LE)       4 Б
 *   16 : таргет: 0 = app, 1 = bootloader 1 Б
 *   17 : резерв (нулі)                 15 Б
 *   32 : шифротекст (кратний 256 Б)
 * Без заголовка файл вважається сирим шифротекстом і CRC треба задати вручну.
 */
const CONTAINER_MAGIC = 'LEAFOTA1';
const CONTAINER_HEADER = 32;

export function hasContainerHeader(bytes) {
    if (bytes.length < CONTAINER_HEADER) return false;
    for (let i = 0; i < CONTAINER_MAGIC.length; i++) {
        if (bytes[i] !== CONTAINER_MAGIC.charCodeAt(i)) return false;
    }
    return true;
}

/** Парсить CRC32 з hex-рядка (8 символів, з 0x або без). */
export function parseCrcHex(text) {
    const clean = (text || '').trim().replace(/^0x/i, '');
    if (!/^[0-9a-fA-F]{8}$/.test(clean)) {
        throw new Error('CRC32 має бути 8 hex-символів (напр. 38664E2C)');
    }
    return parseInt(clean, 16) >>> 0;
}

/**
 * Розбирає обраний файл у пару {image, crc}. Кидає помилку, якщо образ не
 * схожий на on-wire (шифротекст завжди кратний 256 Б, бо padding робиться ДО
 * шифрування — доповнювати його тут не можна, це зіпсувало б останню сторінку).
 */
export function parseOtaFile(bytes, manualCrcHex, expectedUnit = null) {
    let image = bytes;
    let crc;
    let unit = null;

    if (hasContainerHeader(bytes)) {
        const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
        crc = view.getUint32(8, true);
        const declared = view.getUint32(12, true);
        unit = view.getUint8(16);
        image = bytes.subarray(CONTAINER_HEADER);

        if (declared !== image.length) {
            throw new Error(`Контейнер пошкоджено: заголовок обіцяє ${declared} Б, ` +
                            `у файлі ${image.length} Б`);
        }

        // Заливка образу бутлоадера в банку застосунку (чи навпаки) — це шлях
        // до цеглини, а не просто невдала спроба. Тому розбіжність фатальна.
        if (expectedUnit !== null && unit !== expectedUnit) {
            const name = (u) => (u === 0x01 ? 'бутлоадера' : 'застосунку');
            throw new Error(`Образ призначено для ${name(unit)}, а обрано таргет ` +
                            `${name(expectedUnit)}. Виправ вибір або візьми інший файл.`);
        }
    } else {
        if (!manualCrcHex) {
            throw new Error('Файл без заголовка LEAFOTA1 — вкажи CRC32 плейнтексту ' +
                            'вручну (рядок «CRC32 = 0x…» з логу can_flash.py)');
        }
        crc = parseCrcHex(manualCrcHex);
    }

    if (image.length === 0) {
        throw new Error('Порожній образ');
    }
    if (image.length % PAGE_SIZE !== 0) {
        throw new Error(`Образ ${image.length} Б не кратний ${PAGE_SIZE} Б — це не ` +
                        'зашифрований on-wire образ. Потрібен вихід ' +
                        'can_flash.py --no-send --out, а не сирий firmware.bin');
    }
    if (image.length > MAX_BYTES) {
        throw new Error(`Образ ${image.length} Б перевищує ліміт ${MAX_BYTES} Б ` +
                        '(16-бітний індекс блоку)');
    }

    return { image, crc, unit };
}

// --- Фази протоколу ---------------------------------------------------------

/**
 * START. Для app-таргета застосунок ack-ає і йде в ребут у бутлоадер, тож
 * потрібні два раунди: спершу достукатись до застосунку, потім — до бутлоадера,
 * який піднявся. Одиничний кадр тут легко губиться, поки CAN-контролер
 * ре-синхронізується після ресету — саме тому START ретраїться.
 */
async function handshake(target) {
    const isStartAck = (b) => b.length >= 4 && FW_START_ACK.every((v, i) => b[i] === v);
    const isRefusal = (b) => b.length >= 1 && b[0] === 0x03;

    logMessage('OTA: START…');
    let acked = false;

    for (let attempt = 1; attempt <= FIRMWARE_CONFIG.startAttempts; attempt++) {
        if (cancelRequested) throw new Error('Скасовано користувачем');

        const res = await sendFrame(FW_START, (b) => isStartAck(b) || isRefusal(b),
                                    FIRMWARE_CONFIG.startTimeoutMs);
        if (res) {
            if (isRefusal(res)) {
                throw new Error('ECU відмовив: не в P/N або рухається. ' +
                                'Постав P/N, зупинись і повтори.');
            }
            logMessage(`OTA: приймач відповів (спроба ${attempt}).`);
            acked = true;
            break;
        }
        logMessage(`OTA: немає ack (спроба ${attempt}/${FIRMWARE_CONFIG.startAttempts})…`);
    }

    if (!acked) {
        throw new Error('Немає ack на START — ECU живий на CAN0? Перевір термінацію шини.');
    }

    if (!target.reboots) {
        logMessage('OTA: застосунок готовий приймати образ бутлоадера.');
        return;
    }

    // Застосунок ack-нув і зараз ресетиться в бутлоадер із FLASH1.
    logMessage('OTA: чекаємо старту бутлоадера…');
    await new Promise(r => setTimeout(r, FIRMWARE_CONFIG.bootWaitMs));

    for (let attempt = 1; attempt <= FIRMWARE_CONFIG.startAttempts; attempt++) {
        if (cancelRequested) throw new Error('Скасовано користувачем');

        if (await sendFrame(FW_START, isStartAck, FIRMWARE_CONFIG.startTimeoutMs)) {
            logMessage('OTA: бутлоадер готовий, позицію запису скинуто.');
            return;
        }
        logMessage(`OTA: бутлоадер ще не піднявся (спроба ${attempt}/${FIRMWARE_CONFIG.startAttempts})…`);
    }

    throw new Error('Бутлоадер не підтвердив START. ECU лишається в буті — можна просто повторити.');
}

/** Потік DATA: lockstep — кожен блок чекає на ехо свого індексу. */
async function streamData(image, target, onProgress) {
    const total = Math.ceil(image.length / 4);
    logMessage(`OTA: стрім ${image.length} байт · ${total} блоків…`);

    let lastPct = -1;
    let lastBroadcast = -1;

    for (let i = 0; i < total; i++) {
        if (cancelRequested) throw new Error('Скасовано користувачем');

        const lo = i & 0xFF;
        const hi = (i >> 8) & 0xFF;

        let frame = 'FF' + toHex(lo) + toHex(hi);
        for (let b = 0; b < 4; b++) {
            const idx = i * 4 + b;
            frame += toHex(idx < image.length ? image[idx] : 0xFF);
        }
        frame += '00';

        const isAck = (bytes) => bytes.length >= 2 && bytes[0] === lo && bytes[1] === hi;

        let ack = null;
        for (let retry = 0; retry < FIRMWARE_CONFIG.blockRetries && !ack; retry++) {
            ack = await sendFrame(frame, isAck, FIRMWARE_CONFIG.blockTimeoutMs);
        }

        // Приймач кладе байти за індексом блоку, тож повтор кадру переписує те
        // саме місце — ретрай після загубленого ack безпечний і самолікується.
        if (!ack) {
            throw new Error(`Немає ack на блок ${i}/${total} — заливку перервано.`);
        }

        const pct = Math.floor((i + 1) * 100 / total);
        if (pct !== lastPct) {
            lastPct = pct;
            if (onProgress) onProgress(i + 1, total);

            if (pct - lastBroadcast >= FIRMWARE_CONFIG.statusEveryPct) {
                lastBroadcast = pct;
                await broadcastStatus(target, PHASE.PROGRESS, pct);
            }
        }
    }
}

/**
 * END з очікуваним CRC32. Відповідь (5 байт): <r> + CRC32 ECU (LE).
 * r: 01=OK · 00=CRC не зійшовся · 02=розмір · 03=NOT PARKED.
 * null — статусу не було (старий бут без CRC-ack або вже ребутнувся).
 */
async function finish(crc, target) {
    const crcHex = toHex(crc & 0xFF) + toHex((crc >>> 8) & 0xFF) +
                   toHex((crc >>> 16) & 0xFF) + toHex((crc >>> 24) & 0xFF);

    logMessage(`OTA: END, очікуваний CRC32 = 0x${crc.toString(16).toUpperCase().padStart(8, '0')}`);

    const res = await sendFrame(
        FW_END_MARKER + crcHex,
        (b) => b.length >= 5 && [0x00, 0x01, 0x02, 0x03].includes(b[0]),
        FIRMWARE_CONFIG.endTimeoutMs
    );

    if (!res) {
        logMessage('OTA: статус-кадру немає — старий бутлоадер без CRC-ack або вже ребутнувся.');
        return null;
    }

    const ecuCrc = (res[1] | (res[2] << 8) | (res[3] << 16) | (res[4] << 24)) >>> 0;

    if (res[0] === 0x01) {
        logMessage(target.reboots
            ? '✅ CRC OK — ECU перевірив образ і стартує новий застосунок.'
            : '✅ CRC OK — новий бутлоадер записано у FLASH1 (перевірено зчитуванням назад).');
        return true;
    }
    if (res[0] === 0x02) {
        logMessage('❌ Розмір/переповнення — образ завеликий, нічого не записано.');
        return false;
    }
    if (res[0] === 0x03) {
        logMessage('❌ NOT PARKED — ECU у передачі руху або рухається, нічого не записано.');
        return false;
    }

    logMessage(`❌ CRC MISMATCH — ECU 0x${ecuCrc.toString(16).toUpperCase()}, ` +
               `хост 0x${crc.toString(16).toUpperCase()}. ` +
               (target.reboots ? 'ECU ЛИШИВСЯ в бутлоадері — просто повтори заливку.'
                               : 'Бутлоадер НЕ встановлено, FLASH1 не чіпали — повтори.'));
    return false;
}

// --- Публічний API ----------------------------------------------------------

export function cancelFirmwareUpdate() {
    cancelRequested = true;
}

/**
 * Головна функція оновлення.
 * @param {Uint8Array} firmwareData — вміст обраного файлу (шифрований образ,
 *        з заголовком LEAFOTA1 або без нього)
 * @param {Object} options — { target: 'app'|'boot', crcHex: string, onProgress, onPhase }
 * @returns {Promise<boolean>}
 */
export async function updateFirmware(firmwareData, options = {}) {
    const target = OTA_TARGETS[options.target || 'app'];
    if (!target) throw new Error(`Невідомий таргет OTA: ${options.target}`);

    if (!state.isConnected || !state.writer) {
        throw new Error('Адаптер не підключено');
    }

    const { image, crc } = parseOtaFile(firmwareData, options.crcHex, target.unit);
    const onProgress = options.onProgress || null;
    const onPhase = options.onPhase || (() => {});

    cancelRequested = false;
    otaActive = true;
    let result = false;

    await acquireWakeLock();

    // Опитування і watchdog звʼязку глушимо: UDS-поллер перебив би потік OTA,
    // а watchdog оголосив би обрив на першій же паузі ребуту ECU.
    stopAllPolling();
    stopLinkWatchdog();
    state.rawChunkSink = sinkChunk;
    flushRx();

    try {
        logMessage('=== ПОЧАТОК OTA ===');
        logMessage(`Таргет: ${options.target === 'boot' ? 'бутлоадер (0x7E4, FLASH1)'
                                                        : 'застосунок (0x79B, FLASH0)'}`);

        onPhase('prepare');
        logMessage(`Образ ${image.length} Б (${image.length / PAGE_SIZE} сторінок) · ` +
                   `CRC32 = 0x${crc.toString(16).toUpperCase().padStart(8, '0')} · ` +
                   (hasContainerHeader(firmwareData) ? 'CRC із заголовка LEAFOTA1'
                                                     : 'CRC задано вручну'));

        onPhase('elm');
        // Сирий CAN без ISO-TP-форматування, з заголовками, короткий таймаут.
        await elmCommand('ATCAF0');
        await elmCommand('ATH1');
        await elmCommand('ATS0');
        await elmCommand('ATAL');
        await elmCommand(`ATCRA${RX_ID}`);
        await elmCommand('ATAT0');
        await elmCommand(`ATST${FIRMWARE_CONFIG.elmStreamSt}`);
        await elmCommand(`ATSH${target.txId}`);

        await broadcastStatus(target, PHASE.START, 0);

        onPhase('handshake');
        await handshake(target);

        onPhase('stream');
        await streamData(image, target, onProgress);

        onPhase('finish');
        const status = await finish(crc, target);

        // null = статусу не було (старий бут). Успіхом це не вважаємо, але й
        // помилкою теж — заливка могла пройти, просто без підтвердження.
        result = status === true;
        await broadcastStatus(target, result ? PHASE.END_OK : PHASE.END_FAIL, 100);

        logMessage(result ? '=== OTA ЗАВЕРШЕНО УСПІШНО ===' : '=== OTA ЗАВЕРШЕНО З ПОМИЛКОЮ ===');
        return result;

    } catch (error) {
        logMessage(`ПОМИЛКА OTA: ${error.message}`);
        try {
            await broadcastStatus(target, PHASE.END_FAIL, 0);
        } catch (e) { /* best-effort */ }
        return false;

    } finally {
        state.rawChunkSink = null;
        flushRx();

        // Повертаємо адаптер у штатний UDS-режим (значення з init транспорту).
        try {
            await elmCommand('ATAT1');
            await elmCommand(`ATST${FIRMWARE_CONFIG.elmNormalSt}`);
            await elmCommand('ATSH79B');
        } catch (e) {
            console.warn('Не вдалось відновити режим ELM:', e.message);
        }

        if (state.isConnected) startLinkWatchdog();
        cancelRequested = false;
        otaActive = false;
        await releaseWakeLock();
    }
}

/** Налаштування таймінгів (використовується сторінкою оновлення). */
export function setFirmwareConfig(config) {
    Object.assign(FIRMWARE_CONFIG, config);
}

export function getFirmwareConfig() {
    return { ...FIRMWARE_CONFIG };
}
