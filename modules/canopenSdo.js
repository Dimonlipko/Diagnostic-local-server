// CANopen SDO клієнт поверх ELM327 у режимі CAF0 + ATAL.
// Поки активний — стопить UDS-полінг і свопить ATSH/ATCRA на пару NodeId.
// При sdoDisconnect() повертає 79B/7BB.

import { state } from './state.js';
import { setRawFrameConsumer } from './canProtocol.js';

const Q_SCALE = 32; // Q5.27 fixed-point

let active = false;
let currentNodeId = null;
let currentTxIdHex = null;
let resolveFrame = null;
let frameTimeoutId = null;

function onFrame(_id, dataHex) {
    if (!resolveFrame) return;
    if (dataHex.length < 16) return;
    const r = resolveFrame;
    clearTimeout(frameTimeoutId);
    resolveFrame = null;
    frameTimeoutId = null;
    r(dataHex.substring(0, 16).toUpperCase());
}

function awaitFrame(timeoutMs = 200) {
    return new Promise((resolve, reject) => {
        if (resolveFrame) return reject(new Error('SDO busy'));
        frameTimeoutId = setTimeout(() => {
            resolveFrame = null;
            frameTimeoutId = null;
            reject(new Error('SDO timeout'));
        }, timeoutMs);
        resolveFrame = resolve;
    });
}

async function rawTx(canIdHex, dataHex) {
    if (!state.writer) throw new Error('No writer');
    if (canIdHex !== currentTxIdHex) {
        await state.writer.write(`ATSH${canIdHex}\r`);
        await new Promise(r => setTimeout(r, 30));
        currentTxIdHex = canIdHex;
        state.lastSetHeader = canIdHex;
        state.lastRequestId = canIdHex;
    }
    await state.writer.write(`${dataHex}\r`);
}

function hex2(n) { return (n & 0xff).toString(16).padStart(2, '0').toUpperCase(); }
function hex3(n) { return (n & 0xfff).toString(16).padStart(3, '0').toUpperCase(); }

export function isSdoActive() { return active; }
export function getNodeId() { return currentNodeId; }

export async function sdoConnect(nodeId) {
    if (active) await sdoDisconnect();
    if (!state.writer) throw new Error('Адаптер не підключено');

    if (window.pollingManager) window.pollingManager.stopAllPolling();
    await new Promise(r => setTimeout(r, 100));

    const txHex = hex3(0x600 + nodeId);
    const rxHex = hex3(0x580 + nodeId);

    await state.writer.write(`ATCRA${rxHex}\r`);
    await new Promise(r => setTimeout(r, 30));
    await state.writer.write(`ATSH${txHex}\r`);
    await new Promise(r => setTimeout(r, 30));

    currentNodeId = nodeId;
    currentTxIdHex = txHex;
    state.lastSetHeader = txHex;
    state.lastRequestId = txHex;
    setRawFrameConsumer(onFrame);
    active = true;
    return { txId: txHex, rxId: rxHex };
}

export async function sdoDisconnect() {
    if (!active) return;
    active = false;
    setRawFrameConsumer(null);
    if (resolveFrame) {
        clearTimeout(frameTimeoutId);
        const r = resolveFrame;
        resolveFrame = null;
        frameTimeoutId = null;
        try { r(null); } catch (e) {}
    }
    currentNodeId = null;
    currentTxIdHex = null;

    if (state.writer) {
        try {
            await state.writer.write(`ATCRA7BB\r`);
            await new Promise(r => setTimeout(r, 60));
            await state.writer.write(`ATSH79B\r`);
            await new Promise(r => setTimeout(r, 60));
            state.lastSetHeader = '79B';
            state.lastRequestId = '79B';
        } catch (e) {}
    }
}

function abortMessage(respHex) {
    const code = respHex.substring(8, 16);
    return `SDO abort 0x${code}`;
}

export async function sdoRead(index, sub, opts = {}) {
    if (!active) throw new Error('SDO not active');
    const txHex = hex3(0x600 + currentNodeId);
    const frame = `40${hex2(index & 0xff)}${hex2((index >> 8) & 0xff)}${hex2(sub)}00000000`;
    const tmo = opts.timeoutMs || 200;
    const retries = opts.retries ?? 2;

    let respHex = null;
    let lastErr = null;
    for (let attempt = 0; attempt <= retries; attempt++) {
        const p = awaitFrame(tmo);
        await rawTx(txHex, frame);
        try { respHex = await p; lastErr = null; break; }
        catch (e) {
            lastErr = e;
            if (attempt < retries) await new Promise(r => setTimeout(r, 30));
        }
    }
    if (lastErr) throw lastErr;
    if (respHex === null) throw new Error('SDO disconnected');

    const cmd = parseInt(respHex.substring(0, 2), 16);
    if (cmd === 0x80) throw new Error(abortMessage(respHex));

    const rIxLo = parseInt(respHex.substring(2, 4), 16);
    const rIxHi = parseInt(respHex.substring(4, 6), 16);
    const rSub = parseInt(respHex.substring(6, 8), 16);
    if (((rIxHi << 8) | rIxLo) !== index || rSub !== sub) {
        throw new Error(`SDO read echo mismatch: idx=${rIxHi.toString(16)}${rIxLo.toString(16)} sub=${rSub.toString(16)}`);
    }

    const b0 = parseInt(respHex.substring(8, 10), 16);
    const b1 = parseInt(respHex.substring(10, 12), 16);
    const b2 = parseInt(respHex.substring(12, 14), 16);
    const b3 = parseInt(respHex.substring(14, 16), 16);
    const raw = ((b3 << 24) | (b2 << 16) | (b1 << 8) | b0) | 0;
    return raw;
}

export async function sdoReadFloat(index, sub) {
    const raw = await sdoRead(index, sub);
    return raw / Q_SCALE;
}

export async function sdoWrite(index, sub, value, opts = {}) {
    if (!active) throw new Error('SDO not active');
    const txHex = hex3(0x600 + currentNodeId);
    const v = (value | 0);
    const frame = `23${hex2(index & 0xff)}${hex2((index >> 8) & 0xff)}${hex2(sub)}` +
                  `${hex2(v & 0xff)}${hex2((v >> 8) & 0xff)}${hex2((v >> 16) & 0xff)}${hex2((v >> 24) & 0xff)}`;

    const p = awaitFrame(opts.timeoutMs || 200);
    await rawTx(txHex, frame);
    const respHex = await p;
    if (respHex === null) throw new Error('SDO disconnected');

    const cmd = parseInt(respHex.substring(0, 2), 16);
    if (cmd === 0x80) throw new Error(abortMessage(respHex));
    if (cmd !== 0x60) throw new Error(`SDO write unexpected resp 0x${cmd.toString(16)}`);
}

export async function sdoWriteFloat(index, sub, value) {
    return sdoWrite(index, sub, Math.round(value * Q_SCALE));
}

// Param read/write by UID (preferred — stable across firmware iterations of same param table)
export async function readParamByUid(uid) {
    return sdoReadFloat(0x2100 | ((uid >> 8) & 0xff), uid & 0xff);
}
export async function writeParamByUid(uid, valueFloat) {
    return sdoWriteFloat(0x2100 | ((uid >> 8) & 0xff), uid & 0xff, valueFloat);
}

// Save/Load/Defaults/Reset (index 0x5002)
export async function sdoCommand(sub) {
    return sdoWrite(0x5002, sub, 0, { timeoutMs: 2000 });
}
export const CMD_SAVE = 0;
export const CMD_LOAD = 1;
export const CMD_RESET = 2;
export const CMD_DEFAULTS = 3;

// Read serial (4 × uint32). Returns hex string concatenation upper case.
export async function readSerial() {
    const parts = [];
    for (let i = 0; i < 4; i++) {
        const raw = await sdoRead(0x5000, i);
        parts.push((raw >>> 0).toString(16).padStart(8, '0').toUpperCase());
    }
    return parts.join('');
}

// Segmented upload of JSON definitions (0x5001) or any other big string.
// onProgress(bytesReceived) optional.
export async function sdoReadString(index, sub, onProgress) {
    if (!active) throw new Error('SDO not active');
    const txHex = hex3(0x600 + currentNodeId);

    // Init upload
    const initFrame = `40${hex2(index & 0xff)}${hex2((index >> 8) & 0xff)}${hex2(sub)}00000000`;
    let p = awaitFrame(2000);
    await rawTx(txHex, initFrame);
    let respHex = await p;
    if (respHex === null) throw new Error('SDO disconnected');

    let cmd = parseInt(respHex.substring(0, 2), 16);
    if (cmd === 0x80) throw new Error(abortMessage(respHex));

    // Expedited (bit 1 set in byte0): rare for strings but support it
    if ((cmd & 0x02) !== 0 && (cmd & 0xE0) === 0x40) {
        const n = 4 - ((cmd >> 2) & 0x03);
        let s = '';
        for (let i = 0; i < n; i++) {
            const b = parseInt(respHex.substring(8 + i * 2, 10 + i * 2), 16);
            if (b === 0) break;
            s += String.fromCharCode(b);
        }
        return s;
    }

    // Segmented loop. cmd should be 0x41 here (size indicated, not expedited).
    // Збираємо байти у Uint8Array і декодуємо UTF-8 у кінці.
    //
    // Clara особливість: 64-байтний print-buffer час від часу порожніє
    // ([cansdo.cpp:159-166]) — тоді сервер передчасно ставить біт "last".
    // Мітигація: початкова пауза щоб main-loop почав друкувати, і delay
    // між сегментами, щоб buffer ніколи не дренувався midstream.
    // НЕ полимо після last — інакше ризикуємо втратити сегмент через BLE
    // race window.
    const INTER_SEG_MS = 6;
    const SEG_TIMEOUT_MS = 600;
    const MAX_RETRIES_PER_SEG = 3;
    await new Promise(r => setTimeout(r, 30));

    const bytes = [];
    let toggle = 0;
    let safety = 8000;
    while (safety-- > 0) {
        const segCmdReq = (toggle << 4) | 0x60;
        const segHex = `${hex2(segCmdReq)}00000000000000`;

        let respOk = false;
        for (let attempt = 0; attempt <= MAX_RETRIES_PER_SEG && !respOk; attempt++) {
            p = awaitFrame(SEG_TIMEOUT_MS);
            await rawTx(txHex, segHex);
            try {
                respHex = await p;
                respOk = true;
            } catch (e) {
                if (attempt === MAX_RETRIES_PER_SEG) throw e;
                // BLE/ELM blip — retry the same toggle (Clara is stateless re: toggle).
                await new Promise(r => setTimeout(r, 50));
            }
        }
        if (respHex === null) throw new Error('SDO disconnected');

        cmd = parseInt(respHex.substring(0, 2), 16);
        if (cmd === 0x80) throw new Error(abortMessage(respHex));

        const isLast = (cmd & 0x01) !== 0;
        const unused = (cmd >> 1) & 0x07;
        const dataBytes = 7 - unused;

        for (let i = 0; i < dataBytes; i++) {
            bytes.push(parseInt(respHex.substring(2 + i * 2, 4 + i * 2), 16));
        }
        if (onProgress) onProgress(bytes.length);
        if (isLast) break;
        toggle ^= 1;
        if (INTER_SEG_MS > 0) await new Promise(r => setTimeout(r, INTER_SEG_MS));
    }

    while (bytes.length && bytes[bytes.length - 1] === 0) bytes.pop();
    return new TextDecoder('utf-8').decode(new Uint8Array(bytes));
}
