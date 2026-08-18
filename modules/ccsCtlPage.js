// Сторінкова логіка SDO-секції CCS-контролера (ccs32clara).

import { state } from './state.js';
import { logMessage } from './ui.js';
import {
    sdoConnect, sdoDisconnect, isSdoActive,
    readSerial, sdoReadString,
    readParamByUid, writeParamByUid,
    sdoCommand, CMD_SAVE, CMD_LOAD, CMD_RESET, CMD_DEFAULTS,
} from './canopenSdo.js';
import { ENUM_MAPS, DESCRIPTIONS, decodeEnum } from './ccsCtlEnums.js';
import { parseCanmap, applyCanmap, readCanmap } from './canopenCanmap.js';

const DEFAULT_NODE_ID = 22;
const NODE_ID_LS_KEY = 'ccsctl_node_id';
const POLL_INTERVAL_MS = 150;
// LS-prefix bumped до v4 щоб скинути закешовані JSON-и з попередніх багів зчитування.
const LS_PREFIX = 'ccsctl_jsondef_v4_';

function getNodeIdFromUI() {
    const inp = $('#ccsctlNodeId');
    let v = inp ? parseInt(inp.value, 10) : DEFAULT_NODE_ID;
    if (!Number.isFinite(v) || v < 1 || v > 127) v = DEFAULT_NODE_ID;
    return v;
}

let initialized = false;
let pageRoot = null;
let paramDefs = null;        // [{name, id, unit, isparam, minimum, maximum, default, category, value, i}]
let displayParams = [];      // subset isparam=false (excl serial)
let writableParams = [];     // subset isparam=true
let serial = null;
let pollHandle = null;
let pollGeneration = 0;
let connecting = false;

function $(sel) { return pageRoot ? pageRoot.querySelector(sel) : null; }

function setStatus(text, kind) {
    const el = $('#ccsctlStatus');
    if (!el) return;
    el.textContent = text;
    el.dataset.kind = kind || '';
}

function fmt(value, unit) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    let s = (Math.abs(value) >= 1000 || Number.isInteger(value))
        ? value.toFixed(0)
        : value.toFixed(2);
    return unit ? `${s} ${unit}` : s;
}

// Clara кодує enum у полі `unit` як "0=NONE, 1=CANTIMEOUT, 2=PLCTIMEOUT, ...".
// Парсимо це у динамічну мапу. Повертає null якщо unit — звичайна одиниця ("V", "°C", "A").
function parseEnumFromUnit(unit) {
    if (!unit || typeof unit !== 'string') return null;
    const matches = [...unit.matchAll(/(-?\d+)\s*=\s*([^,)]+?)(?=\s*(?:,|\)|$))/g)];
    if (matches.length < 2) return null; // одиничний "5=foo" не парсимо — щоб не з'їсти "5 V"
    const map = {};
    for (const m of matches) map[parseInt(m[1], 10)] = m[2].trim();
    return map;
}

// Хардкод (ENUM_MAPS) має пріоритет над парсінгом з unit.
function getEnumMap(name, unit) {
    return ENUM_MAPS[name] || parseEnumFromUnit(unit);
}

function formatValue(name, value, unit) {
    if (value === null || value === undefined || Number.isNaN(value)) return '—';
    const map = getEnumMap(name, unit);
    if (map) {
        const k = Math.round(value);
        const txt = map[k];
        return txt !== undefined ? `${k} – ${txt}` : `${k}`;
    }
    return fmt(value, unit);
}

function buildTooltip(p) {
    const parts = [];
    if (DESCRIPTIONS[p.name]) parts.push(DESCRIPTIONS[p.name]);
    parts.push(`id=${p.id}`);
    if (p.isparam) parts.push(`min=${p.minimum} max=${p.maximum} def=${p.default}`);
    const map = getEnumMap(p.name, p.unit);
    if (map) {
        const enumList = Object.entries(map).map(([k, v]) => `${k}=${v}`).join(', ');
        parts.push(`enum: ${enumList}`);
    }
    return parts.join(' | ');
}

function isEnumUnit(unit) {
    return parseEnumFromUnit(unit) !== null;
}

function parseDefs(jsonText) {
    let obj;
    try { obj = JSON.parse(jsonText); }
    catch (e) { throw new Error('Невалідний JSON від CCS-контролера: ' + e.message); }

    const defs = [];
    for (const [name, attr] of Object.entries(obj)) {
        if (!attr || typeof attr !== 'object') continue;
        if (name === 'serial') {
            // already handled separately
            continue;
        }
        defs.push({
            name,
            id: attr.id,
            unit: attr.unit || '',
            value: typeof attr.value === 'number' ? attr.value : Number(attr.value),
            isparam: !!attr.isparam,
            minimum: attr.minimum,
            maximum: attr.maximum,
            default: attr.default,
            category: attr.category || (attr.isparam ? 'Other' : 'Display'),
        });
    }
    return defs;
}

function renderTable() {
    const host = $('#ccsctlTable');
    if (!host) return;
    host.innerHTML = '';

    // Group by category
    const groups = {};
    for (const p of paramDefs) {
        const cat = p.category || (p.isparam ? 'Other' : 'Display');
        (groups[cat] = groups[cat] || []).push(p);
    }
    const catOrder = Object.keys(groups).sort((a, b) => {
        // Display first, then alpha
        if (a === 'Display') return -1;
        if (b === 'Display') return 1;
        return a.localeCompare(b);
    });

    for (const cat of catOrder) {
        const fs = document.createElement('fieldset');
        fs.className = 'ccsctl-cat';
        const lg = document.createElement('legend');
        lg.textContent = cat;
        fs.appendChild(lg);

        const grid = document.createElement('div');
        grid.className = 'ccsctl-grid';

        for (const p of groups[cat].sort((a, b) => a.name.localeCompare(b.name))) {
            const tip = buildTooltip(p);
            const lbl = document.createElement('label');
            // Якщо unit — довгий enum-рядок (lasterr, opmode, …), не пхаємо в лейбл.
            const labelUnit = p.unit && !isEnumUnit(p.unit) ? p.unit : '';
            lbl.textContent = p.name + (labelUnit ? ` (${labelUnit})` : '');
            lbl.title = tip;
            grid.appendChild(lbl);

            if (p.isparam) {
                // Якщо enum-карта повністю покриває діапазон min..max — рендеримо <select>.
                const enumMap = getEnumMap(p.name, p.unit);
                const range = (Number.isFinite(p.maximum) && Number.isFinite(p.minimum))
                    ? (p.maximum - p.minimum + 1) : null;
                const useSelect = enumMap && range !== null
                    && Object.keys(enumMap).length === range;

                if (useSelect) {
                    const sel = document.createElement('select');
                    sel.dataset.uid = String(p.id);
                    sel.dataset.name = p.name;
                    sel.title = tip;
                    for (const [k, v] of Object.entries(enumMap)) {
                        const opt = document.createElement('option');
                        opt.value = k;
                        opt.textContent = `${k} – ${v}`;
                        sel.appendChild(opt);
                    }
                    sel.value = String(Math.round(p.value));
                    sel.addEventListener('change', () => onWriteParam(p, sel));
                    grid.appendChild(sel);
                } else {
                    const wrap = document.createElement('div');
                    wrap.className = 'ccsctl-input-wrap';
                    const input = document.createElement('input');
                    input.type = 'number';
                    input.step = 'any';
                    input.dataset.uid = String(p.id);
                    input.dataset.name = p.name;
                    input.title = tip;
                    input.value = Number.isFinite(p.value) ? p.value : '';
                    if (Number.isFinite(p.minimum)) input.min = p.minimum;
                    if (Number.isFinite(p.maximum)) input.max = p.maximum;
                    const btn = document.createElement('button');
                    btn.type = 'button';
                    btn.textContent = 'Write';
                    btn.className = 'ccsctl-write-btn';
                    btn.addEventListener('click', () => onWriteParam(p, input));
                    input.addEventListener('keydown', (e) => {
                        if (e.key === 'Enter') { e.preventDefault(); onWriteParam(p, input); }
                    });
                    wrap.appendChild(input);
                    wrap.appendChild(btn);
                    grid.appendChild(wrap);
                }
            } else {
                const out = document.createElement('input');
                out.type = 'text';
                out.readOnly = true;
                out.dataset.uid = String(p.id);
                out.dataset.name = p.name;
                out.title = tip;
                out.value = formatValue(p.name, p.value, p.unit);
                grid.appendChild(out);
            }
        }
        fs.appendChild(grid);
        host.appendChild(fs);
    }
}

async function onWriteParam(p, input) {
    const v = parseFloat(input.value);
    if (!Number.isFinite(v)) {
        logMessage(`[CCSCTL] Невалідне значення для ${p.name}`);
        return;
    }
    // Stop Display-polling whilst write & verify — інакше pollLoop тримає
    // resolveFrame і ми отримуємо "SDO busy".
    await stopPollingAndWait();
    try {
        input.disabled = true;
        await writeParamByUid(p.id, v);
        logMessage(`[CCSCTL] Write OK: ${p.name} = ${v}`);
        try {
            const fresh = await readParamByUid(p.id);
            input.value = fresh;
            p.value = fresh;
        } catch (e) {}
    } catch (e) {
        logMessage(`[CCSCTL] Write FAIL ${p.name}: ${e.message}`);
    } finally {
        input.disabled = false;
        if (isSdoActive()) startPolling();
    }
}

async function loadDefinitions(forceReload) {
    setStatus('Читання Serial…');
    serial = await readSerial();
    const sEl = $('#ccsctlSerial');
    if (sEl) sEl.textContent = serial;

    let jsonText = null;

    // 1. Перший пріоритет — статичний файл, що лежить біля webtool.
    //    Швидко (мс), без segmented-SDO. Параметри ccs32clara стабільні
    //    у межах FW-версії, тож це надійніше.
    try {
        const resp = await fetch('canmaps/clara-params.json', { cache: 'no-cache' });
        if (resp.ok) {
            jsonText = await resp.text();
            setStatus('JSON зі статичного файлу');
        }
    } catch (e) {
        // network/file error — fall through to SDO
    }

    // 2. Fallback — SDO 0x5001 segmented (повільно, ненадійно через BLE).
    if (!jsonText) {
        const cacheKey = LS_PREFIX + serial;
        jsonText = forceReload ? null : localStorage.getItem(cacheKey);

        if (!jsonText) {
            setStatus('Файл canmaps/clara-params.json не знайдено — читаю з Clara через SDO…');
            const progEl = $('#ccsctlProgress');
            if (progEl) { progEl.style.display = ''; progEl.value = 0; }
            try {
                jsonText = await sdoReadString(0x5001, 0, (bytes) => {
                    if (progEl) progEl.value = bytes;
                });
            } finally {
                if (progEl) progEl.style.display = 'none';
            }
            try { localStorage.setItem(cacheKey, jsonText); } catch (e) {}
        } else {
            setStatus('JSON з кешу');
        }
    }

    paramDefs = parseDefs(jsonText);
    displayParams = paramDefs.filter(p => !p.isparam);
    writableParams = paramDefs.filter(p => p.isparam);

    // FW version: ccs32clara виводить "version" як параметр у тій же таблиці
    const ver = paramDefs.find(p => p.name.toLowerCase() === 'version');
    const verEl = $('#ccsctlVersion');
    if (verEl) verEl.textContent = ver && Number.isFinite(ver.value) ? ver.value : '—';

    renderTable();
}

function updateCellValue(name, value) {
    const el = pageRoot && pageRoot.querySelector(`#ccsctlTable input[data-name="${name}"]`);
    if (!el) return;
    if (el.readOnly) {
        const p = paramDefs && paramDefs.find(x => x.name === name);
        el.value = formatValue(name, value, p ? p.unit : '');
    }
    // editable inputs не перезаписуємо — щоб не псувати редагування
}

let pollLoopBusy = false;

async function pollLoop(myGen) {
    pollLoopBusy = true;
    try {
        while (myGen === pollGeneration && isSdoActive()) {
            for (const p of displayParams) {
                if (myGen !== pollGeneration) return;
                if (!isSdoActive()) return;
                try {
                    const v = await readParamByUid(p.id);
                    p.value = v;
                    updateCellValue(p.name, v);
                } catch (e) {
                    if (String(e.message || '').includes('disconnected')) return;
                }
            }
            await new Promise(r => setTimeout(r, POLL_INTERVAL_MS));
        }
    } finally {
        pollLoopBusy = false;
    }
}

async function startPolling() {
    pollGeneration++;
    const gen = pollGeneration;
    pollLoop(gen);
}

function stopPolling() {
    pollGeneration++;
}

// Стопає Display SDO-полінг і чекає, доки реально вийде з in-flight SDO read.
// Без цього свіжий SDO-запит (наприклад readCanmap) ловить "SDO busy".
async function stopPollingAndWait(maxMs = 800) {
    stopPolling();
    const start = Date.now();
    while (pollLoopBusy && Date.now() - start < maxMs) {
        await new Promise(r => setTimeout(r, 20));
    }
}

async function openSection() {
    if (connecting) return;
    if (!state.isConnected) {
        logMessage('[CCSCTL] Спочатку підключіть адаптер');
        const cb = $('#ccsctlToggleBtn');
        if (cb) cb.checked = false;
        return;
    }
    connecting = true;
    try {
        $('#ccsctlPanel').style.display = '';
        const nodeId = getNodeIdFromUI();
        try { localStorage.setItem(NODE_ID_LS_KEY, String(nodeId)); } catch (e) {}
        const txId = (0x600 + nodeId).toString(16).toUpperCase().padStart(3, '0');
        const rxId = (0x580 + nodeId).toString(16).toUpperCase().padStart(3, '0');
        setStatus(`Підключення SDO (TX 0x${txId} / RX 0x${rxId})…`);
        await sdoConnect(nodeId);
        await loadDefinitions(false);
        setStatus(`Стрімінг (NodeId ${nodeId})`);
        startPolling();
    } catch (e) {
        logMessage(`[CCSCTL] Помилка: ${e.message}`);
        setStatus('Помилка: ' + e.message, 'error');
        try { await sdoDisconnect(); } catch (_) {}
    } finally {
        connecting = false;
    }
}

async function closeSection() {
    stopPolling();
    if (isSdoActive()) {
        try { await sdoDisconnect(); } catch (e) {}
    }
    setStatus('Згорнуто');
    const panel = $('#ccsctlPanel');
    if (panel) panel.style.display = 'none';
    // sdoDisconnect повернув ATCRA 7BB / ATSH 79B — UDS-канал відновлено.
    // Верхня секція CCS поки що не має data-bind DID-ів, тому окремо запускати
    // UDS-полінг не потрібно. Якщо потім додадуть — достатньо перезавантажити сторінку.
}

async function onSave() {
    if (!isSdoActive()) return;
    await stopPollingAndWait();
    try { await sdoCommand(CMD_SAVE); logMessage('[CCSCTL] Save OK'); }
    catch (e) { logMessage(`[CCSCTL] Save FAIL: ${e.message}`); }
    finally { if (isSdoActive()) startPolling(); }
}
async function onLoad() {
    if (!isSdoActive()) return;
    await stopPollingAndWait();
    try { await sdoCommand(CMD_LOAD); logMessage('[CCSCTL] Load OK'); }
    catch (e) { logMessage(`[CCSCTL] Load FAIL: ${e.message}`); }
    finally { if (isSdoActive()) startPolling(); }
}
async function onDefaults() {
    if (!isSdoActive()) return;
    if (!confirm('Скинути всі параметри CCS-контролера до дефолтних?')) return;
    await stopPollingAndWait();
    try { await sdoCommand(CMD_DEFAULTS); logMessage('[CCSCTL] Defaults OK'); }
    catch (e) { logMessage(`[CCSCTL] Defaults FAIL: ${e.message}`); }
    finally { if (isSdoActive()) startPolling(); }
}
async function onReset() {
    if (!isSdoActive()) return;
    if (!confirm('Перезавантажити CCS-контролер?')) return;
    await stopPollingAndWait();
    try {
        await sdoCommand(CMD_RESET);
    } catch (e) {
        logMessage(`[CCSCTL] Reset (без відповіді — нормально): ${e.message}`);
    }
    setTimeout(() => { if (isSdoActive()) startPolling(); }, 1500);
}
async function onReload() {
    if (!isSdoActive()) return;
    try {
        stopPolling();
        const cacheKey = LS_PREFIX + (serial || '');
        if (cacheKey !== LS_PREFIX) localStorage.removeItem(cacheKey);
        await loadDefinitions(true);
        startPolling();
    } catch (e) {
        logMessage(`[CCSCTL] Reload FAIL: ${e.message}`);
    }
}

// ----- CAN map (Clara ↔ ECU) -----

function cmLog(msg) {
    const ta = $('#ccsctlCmLog');
    if (!ta) return;
    ta.value += msg + '\n';
    ta.scrollTop = ta.scrollHeight;
}
function cmSetProgress(value, max) {
    const p = $('#ccsctlCmProgress');
    if (!p) return;
    p.max = max || 100;
    p.value = value;
}
function cmReset() {
    const ta = $('#ccsctlCmLog'); if (ta) ta.value = '';
    cmSetProgress(0, 100);
}
function getParamMaps() {
    const nameToUid = {};
    const uidToName = {};
    if (!paramDefs) return { nameToUid, uidToName };
    for (const p of paramDefs) {
        if (Number.isInteger(p.id)) {
            nameToUid[p.name] = p.id;
            uidToName[p.id] = p.name;
        }
    }
    return { nameToUid, uidToName };
}

async function onCmApplyFile() {
    if (!isSdoActive()) { logMessage('[CCSCTL] SDO не активний'); return; }
    const fileInp = $('#ccsctlCmFile');
    if (!fileInp || !fileInp.files || !fileInp.files[0]) {
        logMessage('[CCSCTL] Спочатку обери .txt-файл канмапу');
        return;
    }
    const text = await fileInp.files[0].text();
    const parsed = parseCanmap(text);
    if (parsed.errors.length) {
        cmLog(`[PARSE] ${parsed.errors.length} помилок у файлі — див. лог`);
    }
    if (parsed.ops.length === 0) {
        logMessage('[CCSCTL] У файлі немає валідних команд');
        return;
    }
    if (!confirm(`Поточний канмап Clara буде стерто (${parsed.ops.length} операцій). Продовжити?`)) return;

    cmReset();
    cmLog(`File: ${fileInp.files[0].name}, ${parsed.ops.length} ops`);

    // Stop ALL polling — і чекаємо доки in-flight SDO read завершиться
    await stopPollingAndWait();
    if (window.pollingManager) window.pollingManager.stopAllPolling();
    setStatus('Заливання канмапу…');

    const { nameToUid } = getParamMaps();
    try {
        const result = await applyCanmap(parsed, nameToUid, {
            onLog: cmLog,
            onProgress: (v, m) => cmSetProgress(v, m)
        });
        if (result.ok) {
            cmLog('=== ВСЕ OK ===');
            cmLog('Натисни "Reset" щоб Clara перезавантажилась і застосувала зміни (CanSpeed/NodeId).');
        } else {
            cmLog(`=== ЗАВЕРШЕНО З ПОМИЛКАМИ (${result.errors.length}) ===`);
        }
    } catch (e) {
        cmLog(`[FATAL] ${e.message}`);
    } finally {
        setStatus(`Стрімінг (NodeId ${getNodeIdFromUI()})`);
        startPolling();
    }
}

async function onCmRead() {
    if (!isSdoActive()) { logMessage('[CCSCTL] SDO не активний'); return; }
    cmReset();
    cmLog('Читання поточного канмапу…');
    await stopPollingAndWait();
    if (window.pollingManager) window.pollingManager.stopAllPolling();
    setStatus('Читання канмапу…');

    const { uidToName } = getParamMaps();
    try {
        const text = await readCanmap(uidToName, {
            onProgress: (v, m) => cmSetProgress(v, m)
        });
        const ta = $('#ccsctlCmLog');
        if (ta) { ta.value = text; ta.scrollTop = 0; }
        cmSetProgress(100, 100);
    } catch (e) {
        cmLog(`[ERR] ${e.message}`);
    } finally {
        setStatus(`Стрімінг (NodeId ${getNodeIdFromUI()})`);
        startPolling();
    }
}

export function initCcsCtlPage() {
    pageRoot = document.getElementById('page-container');
    if (!pageRoot) return;
    if (!pageRoot.querySelector('#ccsctl-section')) return;
    if (initialized) cleanupCcsCtlPage();

    initialized = true;
    setStatus('Згорнуто');

    const nidInp = $('#ccsctlNodeId');
    if (nidInp) {
        const saved = localStorage.getItem(NODE_ID_LS_KEY);
        if (saved && /^\d+$/.test(saved)) nidInp.value = saved;
    }

    const toggle = $('#ccsctlToggleBtn');
    if (toggle) {
        toggle.addEventListener('change', () => {
            if (toggle.checked) openSection(); else closeSection();
        });
    }
    const bSave = $('#ccsctlBtnSave'); if (bSave) bSave.addEventListener('click', onSave);
    const bLoad = $('#ccsctlBtnLoad'); if (bLoad) bLoad.addEventListener('click', onLoad);
    const bDef = $('#ccsctlBtnDefaults'); if (bDef) bDef.addEventListener('click', onDefaults);
    const bRst = $('#ccsctlBtnReset'); if (bRst) bRst.addEventListener('click', onReset);
    const bRl = $('#ccsctlBtnReload'); if (bRl) bRl.addEventListener('click', onReload);
    const bCmApply = $('#ccsctlCmApplyFile'); if (bCmApply) bCmApply.addEventListener('click', onCmApplyFile);
    const bCmRead = $('#ccsctlCmRead'); if (bCmRead) bCmRead.addEventListener('click', onCmRead);
}

export async function cleanupCcsCtlPage() {
    if (!initialized) return;
    initialized = false;
    stopPolling();
    if (isSdoActive()) {
        try { await sdoDisconnect(); } catch (e) {}
    }
    pageRoot = null;
    paramDefs = null;
    displayParams = [];
    writableParams = [];
    serial = null;
}
