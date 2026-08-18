// Парсер та аплоадер CAN-мапу ccs32clara через CANopen SDO.
// Формат файлу — `clara-canmap.txt` (terminal-style).
//
// SDO indices:
//   0x3000 (TX add) / 0x3001 (RX add)  — sub 0=canId, 1=param|off|bits, 2=gain1000|byteOffset
//   0x3100+slot (TX read/del) / 0x3180+slot (RX read/del)
//      sub 0=cobId, 1/3/5..=item meta (param|off|bits), 2/4/6..=item gain (gain1000|byteOff)
//      запис 0 у sub>=1 видаляє відповідний item
//   0x5002.0 — save

import {
    sdoRead, sdoWrite, sdoCommand, CMD_SAVE, isSdoActive, writeParamByUid
} from './canopenSdo.js';

const SDO_FAST_TIMEOUT = 250;

function tokenize(line) {
    return line.replace(/[;#].*$/, '').trim().split(/\s+/).filter(Boolean);
}

export function parseCanmap(text) {
    const ops = [];
    const errors = [];
    const lines = text.split(/\r?\n/);
    for (let i = 0; i < lines.length; i++) {
        const t = tokenize(lines[i]);
        if (t.length === 0) continue;
        const head = t[0].toLowerCase();

        if (head === 'can') {
            const sub = (t[1] || '').toLowerCase();
            if (sub === 'c' || sub === 'clear') { ops.push({ op: 'clear', line: i + 1 }); continue; }
            if (sub === 'r' || sub === 't') {
                if (t.length < 7) { errors.push({ line: i + 1, msg: `expected 'can ${sub} <param> <id> <off> <bits> <gain>'` }); continue; }
                const param = t[2];
                const canId = Number(t[3]);
                const offset = Number(t[4]);
                const bits = Number(t[5]);
                const gain = Number(t[6]);
                if ([canId, offset, bits, gain].some(v => !Number.isFinite(v))) {
                    errors.push({ line: i + 1, msg: 'invalid number' }); continue;
                }
                ops.push({ op: sub === 'r' ? 'rx' : 'tx', param, canId, offset, bits, gain, byteOffset: 0, line: i + 1 });
                continue;
            }
            errors.push({ line: i + 1, msg: `unknown can subcommand '${sub}'` });
            continue;
        }

        if (head === 'set') {
            if (t.length < 3) { errors.push({ line: i + 1, msg: "expected 'set <param> <value>'" }); continue; }
            const value = Number(t[2]);
            if (!Number.isFinite(value)) { errors.push({ line: i + 1, msg: 'invalid value' }); continue; }
            ops.push({ op: 'set', param: t[1], value, line: i + 1 });
            continue;
        }

        if (head === 'save') { ops.push({ op: 'save', line: i + 1 }); continue; }
        if (head === 'reset') { ops.push({ op: 'reset', line: i + 1 }); continue; }

        errors.push({ line: i + 1, msg: `unknown command '${head}'` });
    }
    return { ops, errors };
}

function buildAddSub1(paramId, offsetBits, numBits) {
    return ((paramId & 0xFFFF) | ((offsetBits & 0x3F) << 16) | ((numBits & 0xFF) << 24)) >>> 0;
}
function buildAddSub2(gain, byteOffset) {
    const g = Math.round(gain * 1000) & 0xFFFFFF;
    return (g | ((byteOffset & 0xFF) << 24)) >>> 0;
}

// Clara: canSendMap[MAX_MESSAGES=10] / canRecvMap[MAX_MESSAGES=10].
// Цикл нижче — 0..9; slot=10 у Clara ([cansdo.cpp:485]) має off-by-one
// `ididx > MAX_MESSAGES` (тобто 10 проходить, потім OOB-доступ і корупція
// пам'яті canmap). Тому stops at 9 inclusive.
const CLARA_MAX_SLOTS = 10;
const CLARA_MAX_ITEMS_PER_SLOT = 8;

async function deleteAllSlots(log, onProgress, slotBaseHex, label, totalProgress, progressStart, progressShare) {
    let removed = 0;
    for (let slot = 0; slot < CLARA_MAX_SLOTS; slot++) {
        let safety = CLARA_MAX_ITEMS_PER_SLOT;
        while (safety-- > 0) {
            try {
                await sdoWrite(slotBaseHex + slot, 1, 0, { timeoutMs: SDO_FAST_TIMEOUT });
                removed++;
                log(`  ${label} slot ${slot}: removed item`);
            } catch (e) {
                break; // abort/timeout → slot empty / no more items
            }
        }
        if (onProgress) {
            onProgress(progressStart + ((slot + 1) / CLARA_MAX_SLOTS) * progressShare, totalProgress);
        }
    }
    return removed;
}

export async function applyCanmap(parsed, paramNameToUid, opts = {}) {
    const log = opts.onLog || (() => {});
    const onProgress = opts.onProgress || (() => {});
    if (!isSdoActive()) throw new Error('SDO not active');

    const { ops, errors: parseErrors } = parsed;
    const errors = [...parseErrors];
    const total = 100;

    if (parseErrors.length) {
        for (const e of parseErrors) log(`[PARSE WARN] line ${e.line}: ${e.msg}`);
    }

    // Step 1: Clear (if requested)
    const hasClear = ops.some(o => o.op === 'clear');
    if (hasClear) {
        log('--- Clearing existing canmap ---');
        const removedTx = await deleteAllSlots(log, onProgress, 0x3100, 'TX', total, 0, 15);
        const removedRx = await deleteAllSlots(log, onProgress, 0x3180, 'RX', total, 15, 15);
        log(`Cleared: ${removedTx} TX items, ${removedRx} RX items`);
    } else {
        log('--- No clear in file, skipping ---');
        onProgress(30, total);
    }

    // Step 2: Add rows + sets
    const addOps = ops.filter(o => o.op === 'tx' || o.op === 'rx' || o.op === 'set');
    const saves = ops.filter(o => o.op === 'save');
    let done = 0;
    for (const op of addOps) {
        const uid = paramNameToUid[op.param];
        if (uid === undefined) {
            log(`[ERROR] line ${op.line}: unknown param '${op.param}'`);
            errors.push({ line: op.line, msg: `unknown param '${op.param}'` });
            done++;
            onProgress(30 + (done / addOps.length) * 60, total);
            continue;
        }

        try {
            if (op.op === 'tx' || op.op === 'rx') {
                const idx = op.op === 'tx' ? 0x3000 : 0x3001;
                await sdoWrite(idx, 0, op.canId, { timeoutMs: SDO_FAST_TIMEOUT });
                await sdoWrite(idx, 1, buildAddSub1(uid, op.offset, op.bits), { timeoutMs: SDO_FAST_TIMEOUT });
                await sdoWrite(idx, 2, buildAddSub2(op.gain, op.byteOffset || 0), { timeoutMs: SDO_FAST_TIMEOUT });
                log(`  Add ${op.op.toUpperCase()} ${op.param} id=${op.canId} off=${op.offset} bits=${op.bits} gain=${op.gain} OK`);
            } else if (op.op === 'set') {
                if (op.param === 'NodeId') {
                    log(`[WARN] 'set NodeId ${op.value}' — після save/reset знадобиться зміна NodeId у полі UI`);
                }
                await writeParamByUid(uid, op.value);
                log(`  set ${op.param} = ${op.value} OK`);
            }
        } catch (e) {
            // Скіпаємо silently:
            //   0x06020000 (LE: 00000206) — UID відсутній у прошивці Clara.
            //   "SDO timeout" — Clara не відповіла (старіша FW або заблокована).
            // Інші помилки — логуємо як ERROR.
            const msg = String(e.message || '');
            const isInvIdx = msg.includes('06020000') || msg.includes('00000206');
            const isTimeout = msg.toLowerCase().includes('timeout');
            if (isInvIdx || isTimeout) {
                log(`[SKIP] line ${op.line}: '${op.param}' (UID ${uid}) — ${isInvIdx ? 'відсутній у FW' : 'no response'}`);
                errors.push({ line: op.line, msg: `param '${op.param}' skipped: ${isInvIdx ? 'not in firmware' : 'no response'}` });
            } else {
                log(`[ERROR] line ${op.line}: ${e.message}`);
                errors.push({ line: op.line, msg: e.message });
            }
        }
        done++;
        onProgress(30 + (done / addOps.length) * 60, total);
    }

    // Step 3: Save (auto, незалежно від того чи був save у файлі)
    log('--- Saving to flash ---');
    try {
        await sdoCommand(CMD_SAVE);
        log('save OK');
    } catch (e) {
        log(`[ERROR] save failed: ${e.message}`);
        errors.push({ msg: 'save failed: ' + e.message });
    }
    onProgress(100, total);

    if (saves.length === 0) log('(файл без явного save — зберегли автоматично)');

    return { ok: errors.length === 0, errors };
}

// Read current canmap from Clara, return text in same format as input.
export async function readCanmap(uidToName, opts = {}) {
    if (!isSdoActive()) throw new Error('SDO not active');
    const onProgress = opts.onProgress || (() => {});
    const lines = [];
    const fast = { timeoutMs: SDO_FAST_TIMEOUT };
    let totalSlots = 0;

    async function readSide(baseHex, prefix) {
        for (let slot = 0; slot < CLARA_MAX_SLOTS; slot++) {
            let cobId;
            try { cobId = await sdoRead(baseHex + slot, 0, fast); }
            catch (e) { onProgress((slot + 1) / CLARA_MAX_SLOTS * 50, 100); continue; }
            cobId = cobId >>> 0;
            for (let item = 0; item < CLARA_MAX_ITEMS_PER_SLOT; item++) {
                const subMeta = 1 + item * 2;
                const subGain = 2 + item * 2;
                let metaRaw, gainRaw;
                try { metaRaw = await sdoRead(baseHex + slot, subMeta, fast); }
                catch (e) { break; }
                try { gainRaw = await sdoRead(baseHex + slot, subGain, fast); }
                catch (e) { break; }
                const paramUid = metaRaw & 0xFFFF;
                const offsetBits = (metaRaw >> 16) & 0x3F;
                const numBitsRaw = (metaRaw >> 24) & 0xFF;
                const numBits = numBitsRaw & 0x80 ? numBitsRaw - 0x100 : numBitsRaw;
                let gain1000 = gainRaw & 0xFFFFFF;
                if (gain1000 & 0x800000) gain1000 -= 0x1000000;
                const gain = gain1000 / 1000;
                const byteOff = (gainRaw >> 24) & 0xFF;
                const name = uidToName[paramUid] || `uid${paramUid}`;
                const gainStr = Number.isInteger(gain) ? `${gain}` : gain.toFixed(3);
                const byteOffStr = byteOff ? ` ; byteOff=${byteOff}` : '';
                lines.push(`can ${prefix} ${name.padEnd(22)} ${cobId.toString().padStart(5)} ${String(offsetBits).padStart(2)} ${String(numBits).padStart(3)} ${gainStr}${byteOffStr}`);
            }
            totalSlots++;
            onProgress(((slot + 1) / CLARA_MAX_SLOTS) * 50 + (prefix === 't' ? 0 : 50), 100);
        }
    }

    lines.push('; Read from Clara via SDO');
    lines.push('; --- TX (param → CAN, Clara → ECU) ---');
    await readSide(0x3100, 't');
    lines.push('; --- RX (CAN → param, ECU → Clara) ---');
    await readSide(0x3180, 'r');
    return lines.join('\n');
}
