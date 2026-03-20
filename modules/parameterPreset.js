// --- modules/parameterPreset.js ---
// Експорт/імпорт пресетів параметрів ECU

import { state } from './state.js';
import { logMessage } from './ui.js';
import { translations } from './config.js';

function t(key) {
    return translations[state.currentLanguage || 'uk']?.[key] || key;
}

// ========================================
// МАППІНГ: DID → параметри для запису
// offset — позиція в hex-рядку відповіді
// bytes — розмір значення (1/2/4)
// signed — знакове значення
// divisor — дільник для людського значення (socAh, sohAh)
// ========================================
const PRESET_DIDS = [
    // --- Settings ---
    { did: '0901', params: [
        { key: 'write_wheel_circ', offset: 8, bytes: 2 }
    ]},
    { did: '0110', params: [
        { key: 'write_contactor_voltage', offset: 8, bytes: 2 }
    ]},
    { did: '0131', params: [
        { key: 'write_type_selector', offset: 10, bytes: 1 },
        { key: 'write_type_start_btn', offset: 12, bytes: 1 },
        { key: 'write_type_invertor', offset: 14, bytes: 1 }
    ]},

    // --- Inverter calibration ---
    { did: '0304', params: [
        { key: 'write_max_torque', offset: 8, bytes: 2 }
    ]},
    { did: '0305', params: [
        { key: 'write_pedal_min', offset: 8, bytes: 2 },
        { key: 'write_pedal_max', offset: 12, bytes: 2 }
    ]},
    { did: '0307', params: [
        { key: 'write_torque_cal', offset: 8, bytes: 1 },
        { key: 'write_pedal_cal', offset: 10, bytes: 2 },
        { key: 'write_torque_not_pressed', offset: 14, bytes: 1, signed: true }
    ]},
    { did: '0308', params: [
        { key: 'write_not_pressed', offset: 8, bytes: 2 }
    ]},

    // --- BMS / Thermal ---
    { did: '0408', params: [
        { key: 'write_pump_temp', offset: 8, bytes: 1 },
        { key: 'balancing', offset: 10, bytes: 1 },
        { key: 'recuperation', offset: 12, bytes: 2 }
    ]},
    { did: '0414', params: [
        { key: 'write_fan_high_temp', offset: 8, bytes: 1 },
        { key: 'write_type_bms', offset: 10, bytes: 1 },
        { key: 'cutCharge', offset: 12, bytes: 1 },
        { key: 'write_fan_low_temp', offset: 14, bytes: 1 }
    ]},
    { did: '0409', params: [
        { key: 'cellOffCharging', offset: 8, bytes: 2 },
        { key: 'cellStartBalancing', offset: 12, bytes: 2 }
    ]},
    { did: '0410', params: [
        { key: 'cellOnTortle', offset: 8, bytes: 2 },
        { key: 'cellOffBattery', offset: 12, bytes: 2 }
    ]},
    { did: '0108', params: [
        { key: 'currentSensType', offset: 8, bytes: 1 }
    ]},
    { did: '0114', params: [
        { key: 'write_bms_limits_charge', offset: 12, bytes: 1 },
        { key: 'write_bms_limits_discharge', offset: 14, bytes: 1 }
    ]},

    // --- SOC / SOH ---
    { did: '0101', params: [
        { key: 'socAh', offset: 8, bytes: 4, divisor: 1000000 }
    ]},
    { did: '0102', params: [
        { key: 'sohAh', offset: 8, bytes: 4, divisor: 1000000 }
    ]},

    // --- Brake booster ---
    { did: '0701', params: [
        { key: 'write_booster_on', offset: 8, bytes: 2 },
        { key: 'write_booster_off', offset: 12, bytes: 2 }
    ]},

    // --- Cruise control PID ---
    { did: '0502', params: [
        { key: 'write_cc_kp', offset: 8, bytes: 2 },
        { key: 'write_cc_ki', offset: 12, bytes: 2 }
    ]},
    { did: '0503', params: [
        { key: 'write_cc_kd', offset: 8, bytes: 2 }
    ]},

    // --- Chademo ---
    { did: '0601', params: [
        { key: 'write_target_current', offset: 8, bytes: 2 }
    ]}
];

// ========================================
// Утіліти
// ========================================

function extractValue(dataHex, offset, bytes, signed) {
    if (bytes === 1) {
        let val = parseInt(dataHex.substring(offset, offset + 2), 16);
        if (signed && val > 127) val -= 256;
        return val;
    } else if (bytes === 2) {
        const h = parseInt(dataHex.substring(offset, offset + 2), 16);
        const l = parseInt(dataHex.substring(offset + 2, offset + 4), 16);
        return (h << 8) | l;
    } else if (bytes === 4) {
        const b1 = parseInt(dataHex.substring(offset, offset + 2), 16);
        const b2 = parseInt(dataHex.substring(offset + 2, offset + 4), 16);
        const b3 = parseInt(dataHex.substring(offset + 4, offset + 6), 16);
        const b4 = parseInt(dataHex.substring(offset + 6, offset + 8), 16);
        return ((b1 << 24) | (b2 << 16) | (b3 << 8) | b4) >>> 0;
    }
    return 0;
}

/**
 * Оновлює прогрес-бар всередині кнопки.
 */
function setBtnProgress(btn, percent) {
    if (btn) btn.style.setProperty('--preset-btn-progress', `${percent}%`);
}

let toastTimer = null;

/**
 * Показує тост-повідомлення під кнопками.
 * @param {string} text — текст повідомлення
 * @param {'error'|'success'|'info'} type — тип (колір)
 * @param {number} duration — час показу в мс (0 = не ховати)
 */
function showToast(text, type = 'info', duration = 4000) {
    const toast = document.getElementById('preset-toast');
    if (!toast) return;

    if (toastTimer) clearTimeout(toastTimer);

    toast.textContent = text;
    toast.className = 'preset-toast visible toast-' + type;

    if (duration > 0) {
        toastTimer = setTimeout(() => {
            toast.className = 'preset-toast';
            toastTimer = null;
        }, duration);
    }
}

function hideToast() {
    const toast = document.getElementById('preset-toast');
    if (toast) toast.className = 'preset-toast';
    if (toastTimer) { clearTimeout(toastTimer); toastTimer = null; }
}

// ========================================
// Зчитування Device ID та Software Version
// ========================================

async function readDeviceInfo() {
    const rawHex = await window.pollingManager.readSingleParam('220407');
    if (!rawHex || rawHex.length < 16) return { deviceId: null, softVer: null };
    const deviceId = parseInt(rawHex.substring(8, 12), 16);
    const softVer = parseInt(rawHex.substring(12, 16), 16);
    return { deviceId, softVer };
}

// ========================================
// Зчитування всіх параметрів з ECU
// ========================================

async function readAllParams(activeBtn, progressOffset, progressScale) {
    const params = {};
    const total = PRESET_DIDS.length;
    const offset = progressOffset || 0;
    const scale = progressScale || 1;

    for (let i = 0; i < total; i++) {
        const didGroup = PRESET_DIDS[i];
        const readDid = '22' + didGroup.did;
        const percent = Math.round(offset + ((i + 1) / total) * 100 * scale);

        setBtnProgress(activeBtn, percent);

        const rawHex = await window.pollingManager.readSingleParam(readDid);

        if (!rawHex) {
            logMessage(`[Preset] DID ${didGroup.did} — немає відповіді, пропущено`);
            continue;
        }

        for (const p of didGroup.params) {
            let value = extractValue(rawHex, p.offset, p.bytes, p.signed);
            if (p.divisor) value = value / p.divisor;
            params[p.key] = value;
        }
    }

    return params;
}

// ========================================
// Експорт пресету
// ========================================

async function exportPreset() {
    if (!state.isConnected) {
        showToast(t('preset_connect_adapter'), 'error');
        return;
    }

    const exportBtn = document.getElementById('btn-preset-export');
    const importBtn = document.getElementById('btn-preset-import');

    hideToast();

    if (exportBtn) {
        exportBtn.disabled = true;
        exportBtn.classList.add('preset-busy');
        setBtnProgress(exportBtn, 0);
    }
    if (importBtn) importBtn.disabled = true;

    if (window.pollingManager) window.pollingManager.stopAllPolling();
    await new Promise(r => setTimeout(r, 300));

    try {
        const deviceInfo = await readDeviceInfo();
        const params = await readAllParams(exportBtn, 0, 1);
        const count = Object.keys(params).length;

        if (count === 0) {
            showToast(t('preset_no_data'), 'error');
            return;
        }

        const preset = {
            magic: 'ELECTRIC ENGINES_ECU_PRESET',
            version: 1,
            date: new Date().toISOString(),
            deviceId: deviceInfo.deviceId,
            firmwareVersion: deviceInfo.softVer,
            params: params
        };

        const blob = new Blob([JSON.stringify(preset, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `ecu_preset_${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);

        showToast(`${t('preset_export_done')} (${count} ${t('preset_params_count')})`, 'success');

    } finally {
        if (exportBtn) {
            exportBtn.disabled = false;
            exportBtn.classList.remove('preset-busy');
            setBtnProgress(exportBtn, 0);
        }
        if (importBtn) importBtn.disabled = false;
    }
}

// ========================================
// Імпорт пресету з верифікацією
// ========================================

async function importPreset(file) {
    if (!state.isConnected) {
        showToast(t('preset_connect_adapter'), 'error');
        return;
    }

    const exportBtn = document.getElementById('btn-preset-export');
    const importBtn = document.getElementById('btn-preset-import');

    // Парсимо файл
    let preset;
    try {
        const text = await file.text();
        preset = JSON.parse(text);
    } catch (e) {
        showToast(t('preset_invalid_file'), 'error');
        return;
    }

    if (preset.magic !== 'ELECTRIC ENGINES_ECU_PRESET' || !preset.params || typeof preset.params !== 'object') {
        showToast(t('preset_invalid_file'), 'error');
        return;
    }

    hideToast();

    if (exportBtn) exportBtn.disabled = true;
    if (importBtn) {
        importBtn.disabled = true;
        importBtn.classList.add('preset-busy');
        setBtnProgress(importBtn, 0);
    }

    if (window.pollingManager) window.pollingManager.stopAllPolling();
    await new Promise(r => setTimeout(r, 300));

    const entries = Object.entries(preset.params);
    const total = entries.length;

    try {
        // --- Фаза 1: Запис (0-50%) ---
        let writeCount = 0;
        let writeErrors = 0;

        for (let i = 0; i < total; i++) {
            const [paramKey, value] = entries[i];
            const percent = Math.round(((i + 1) / total) * 50);

            setBtnProgress(importBtn, percent);

            if (!window.handleWrite) {
                logMessage('[Preset] handleWrite не доступний');
                break;
            }

            try {
                await window.handleWrite(paramKey, value.toString());
                writeCount++;
            } catch (e) {
                logMessage(`[Preset] Помилка запису ${paramKey}: ${e.message}`);
                writeErrors++;
            }

            await new Promise(r => setTimeout(r, 300));
        }

        // --- Фаза 2: Верифікація (50-100%) ---
        setBtnProgress(importBtn, 55);
        await new Promise(r => setTimeout(r, 500));

        const currentParams = await readAllParams(importBtn, 55, 0.45);

        // Порівнюємо
        const mismatches = [];
        for (const [paramKey, expectedValue] of entries) {
            if (!(paramKey in currentParams)) {
                mismatches.push(`${paramKey}: не зчитано`);
                continue;
            }

            const actual = currentParams[paramKey];
            const expected = typeof expectedValue === 'number'
                ? parseFloat(expectedValue.toFixed(6))
                : expectedValue;
            const actualRounded = typeof actual === 'number'
                ? parseFloat(actual.toFixed(6))
                : actual;

            if (expected !== actualRounded) {
                mismatches.push(`${paramKey}: ${t('preset_expected')} ${expectedValue}, ${t('preset_got')} ${actual}`);
            }
        }

        // --- Результат ---
        if (mismatches.length === 0) {
            showToast(`${t('preset_import_success')} (${writeCount}/${total})`, 'success', 6000);
        } else {
            showToast(`${t('preset_verify_fail')}: ${mismatches.length}`, 'error', 8000);
            mismatches.forEach(m => logMessage(`  - ${m}`));
        }

    } finally {
        if (exportBtn) exportBtn.disabled = false;
        if (importBtn) {
            importBtn.disabled = false;
            importBtn.classList.remove('preset-busy');
            setBtnProgress(importBtn, 0);
        }
    }
}

// ========================================
// Ініціалізація сторінки
// ========================================

export function initPresetPage() {
    const exportBtn = document.getElementById('btn-preset-export');
    const importBtn = document.getElementById('btn-preset-import');
    const fileInput = document.getElementById('preset-file-input');

    if (exportBtn) {
        exportBtn.addEventListener('click', exportPreset);
    }

    if (importBtn) {
        importBtn.addEventListener('click', () => {
            if (!state.isConnected) {
                showToast(t('preset_connect_adapter'), 'error');
                return;
            }
            fileInput?.click();
        });
    }

    if (fileInput) {
        fileInput.addEventListener('change', (e) => {
            if (e.target.files && e.target.files.length > 0) {
                importPreset(e.target.files[0]);
                e.target.value = '';
            }
        });
    }
}

export function cleanupPresetPage() {
    // no-op
}
