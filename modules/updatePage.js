// updatePage.js - Обробка сторінки оновлення прошивки

import { state } from './state.js';
import { logMessage } from './ui.js';
import {
    updateFirmware, cancelFirmwareUpdate, parseCrcHex, parseOtaFile, hasContainerHeader
} from './firmwareUpdate.js';
import { translations } from './config.js';

let selectedFile = null;
let isUpdating = false;
let streamStartedAt = 0;

/**
 * Отримує переклад за ключем для поточної мови
 * @param {string} key - Ключ перекладу
 * @returns {string} - Перекладений текст
 */
function t(key) {
    const currentLang = state.currentLanguage || 'uk';
    return translations[currentLang]?.[key] || key;
}

/**
 * Показує/ховає оверлей блокування під час оновлення
 * @param {boolean} show - true для показу, false для приховання
 */
function toggleUpdateOverlay(show) {
    const overlay = document.getElementById('update-overlay');
    if (overlay) {
        overlay.style.display = show ? 'flex' : 'none';
    }
}

/**
 * Оновлює індикатор прогресу (на картці й на оверлеї) та рахує ETA.
 * @param {number} current - Поточний блок
 * @param {number} total - Загальна кількість блоків
 */
function updateProgress(current, total) {
    const percent = total ? Math.round((current / total) * 100) : 0;

    for (const id of ['progress-bar', 'overlay-progress-bar']) {
        const bar = document.getElementById(id);
        if (bar) {
            bar.style.width = `${percent}%`;
            bar.textContent = `${percent}%`;
        }
    }

    // ETA за фактичною швидкістю: через ELM327 заливка довга, і без залишку
    // часу незрозуміло, чи воно взагалі рухається.
    let eta = '';
    if (streamStartedAt && current > 0) {
        const elapsed = (Date.now() - streamStartedAt) / 1000;
        const remaining = Math.round(elapsed / current * (total - current));
        if (remaining > 0) {
            const mm = String(Math.floor(remaining / 60)).padStart(2, '0');
            const ss = String(remaining % 60).padStart(2, '0');
            eta = ` · ${t('update_eta')} ${mm}:${ss}`;
        }
    }

    setStatusText(`${current}/${total} ${t('update_blocks')} (${percent}%)${eta}`);
}

/**
 * Встановлює текст статусу
 * @param {string} text - Текст статусу
 * @param {string} langKey - Ключ перекладу (опціонально)
 */
function setStatusText(text, langKey = null) {
    for (const id of ['status-text', 'overlay-status-text']) {
        const el = document.getElementById(id);
        if (!el) continue;

        el.textContent = text;
        el.setAttribute('data-lang-key', langKey || '');
    }
}

/** Текст фази протоколу — щоб було видно, де саме воно стоїть. */
function setPhase(phase) {
    const map = {
        prepare: 'update_phase_prepare',
        elm: 'update_phase_elm',
        handshake: 'update_phase_handshake',
        stream: 'update_phase_stream',
        finish: 'update_phase_finish'
    };

    if (phase === 'stream') streamStartedAt = Date.now();
    if (map[phase]) setStatusText(t(map[phase]), map[phase]);
}

/** Поточний таргет OTA ('app' | 'boot'). */
function currentTarget() {
    return document.getElementById('ota-target')?.value || 'app';
}

/** Попередження під селектором залежить від таргета — ризики різні. */
function refreshWarning() {
    const warning = document.getElementById('ota-warning');
    if (!warning) return;

    const key = currentTarget() === 'boot' ? 'update_warn_boot' : 'update_warn_app';
    warning.textContent = t(key);
    warning.setAttribute('data-lang-key', key);
    warning.classList.toggle('critical', currentTarget() === 'boot');
}

/**
 * Обробник вибору файлу
 */
async function handleFileSelect(event) {
    const file = event.target.files[0];
    const fileNameDisplay = document.getElementById('file-name');
    const uploadButton = document.getElementById('upload-button');

    if (!file) return;

    selectedFile = file;

    if (fileNameDisplay) {
        fileNameDisplay.textContent = `${file.name} · ${file.size} B`;
        fileNameDisplay.setAttribute('data-lang-key', ''); // Вимикаємо переклад
    }

    if (uploadButton) {
        uploadButton.disabled = false;
    }

    logMessage(`Файл обрано: ${file.name} (${file.size} байт)`);
    await applyContainerHeader(file);
}

/**
 * Якщо файл — контейнер LEAFOTA1, CRC і таргет беруться з заголовка, а поля
 * блокуються: ручне значення тут могло б лише суперечити файлу.
 */
async function applyContainerHeader(file) {
    const crcInput = document.getElementById('ota-crc');
    const targetSelect = document.getElementById('ota-target');
    if (!crcInput) return;

    let header;
    try {
        header = new Uint8Array(await file.slice(0, 32).arrayBuffer());
    } catch (e) {
        return;
    }

    if (header.length === 32 && hasContainerHeader(header)) {
        const view = new DataView(header.buffer, header.byteOffset, header.byteLength);
        const crc = view.getUint32(8, true);
        const unit = view.getUint8(16);

        crcInput.value = crc.toString(16).toUpperCase().padStart(8, '0');
        crcInput.disabled = true;

        if (targetSelect) {
            targetSelect.value = unit === 0x01 ? 'boot' : 'app';
            targetSelect.disabled = true;
            refreshWarning();
        }

        logMessage(`Контейнер LEAFOTA1: CRC32 = 0x${crcInput.value}, ` +
                   `таргет = ${unit === 0x01 ? 'бутлоадер' : 'застосунок'}`);
    } else {
        crcInput.disabled = false;
        if (targetSelect) targetSelect.disabled = false;
    }
}

/**
 * Читає файл як ArrayBuffer
 * @param {File} file - Файл для читання
 * @returns {Promise<Uint8Array>}
 */
function readFileAsArrayBuffer(file) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = (e) => {
            const arrayBuffer = e.target.result;
            const uint8Array = new Uint8Array(arrayBuffer);
            resolve(uint8Array);
        };

        reader.onerror = () => {
            reject(new Error('Помилка читання файлу'));
        };

        reader.readAsArrayBuffer(file);
    });
}

/**
 * Головна функція оновлення прошивки
 */
async function handleUpload() {
    if (!selectedFile) {
        logMessage('ПОМИЛКА: Файл не обрано');
        alert(t('update_alert_no_file'));
        return;
    }

    if (!state.isConnected || !state.writer) {
        logMessage('ПОМИЛКА: Адаптер не підключено');
        alert(t('update_alert_no_adapter'));
        return;
    }

    if (isUpdating) {
        logMessage('ПОПЕРЕДЖЕННЯ: Оновлення вже виконується');
        return;
    }

    const target = currentTarget();
    const crcHex = document.getElementById('ota-crc')?.value || '';

    // CRC валідуємо ДО підтвердження: інакше друкарська помилка виявиться аж
    // після 15 хвилин заливки, у вигляді CRC MISMATCH.
    try {
        parseCrcHex(crcHex);
    } catch (error) {
        alert(`${t('update_alert_bad_crc')}\n\n${error.message}`);
        return;
    }

    // Читаємо і валідуємо образ ДО діалогу підтвердження: немає сенсу лякати
    // попередженням про ризики, якщо файл узагалі не той.
    let firmwareData;
    try {
        logMessage(`Читання файлу: ${selectedFile.name}`);
        firmwareData = await readFileAsArrayBuffer(selectedFile);
        logMessage(`Файл прочитано: ${firmwareData.length} байт`);
        parseOtaFile(firmwareData, crcHex, target === 'boot' ? 0x01 : 0x00);
    } catch (error) {
        logMessage(`ПОМИЛКА: ${error.message}`);
        alert(`${t('update_alert_bad_image')}\n\n${error.message}`);
        return;
    }

    // Попередження користувача
    const confirmUpdate = confirm(
        `${t('update_confirm_title')}\n\n` +
        `${target === 'boot' ? t('update_warn_boot') : t('update_warn_app')}\n\n` +
        `${t('update_confirm_file')}: ${selectedFile.name}\n` +
        `${t('update_confirm_size')}: ${selectedFile.size} ${t('update_confirm_bytes')}\n\n` +
        `${t('update_confirm_continue')}`
    );

    if (!confirmUpdate) {
        logMessage('Оновлення скасовано користувачем');
        return;
    }

    const uploadButton = document.getElementById('upload-button');
    const cancelButton = document.getElementById('cancel-button');
    const fileInput = document.getElementById('file-input');

    try {
        isUpdating = true;
        streamStartedAt = 0;

        // Показуємо оверлей та блокуємо UI
        toggleUpdateOverlay(true);
        setStatusText(t('update_status_reading'), 'update_status_reading');

        if (uploadButton) uploadButton.disabled = true;
        if (fileInput) fileInput.disabled = true;
        if (cancelButton) cancelButton.disabled = false;

        // Запускаємо оновлення
        const success = await updateFirmware(firmwareData, {
            target,
            crcHex,
            onProgress: (current, total) => updateProgress(current, total),
            onPhase: setPhase
        });

        if (success) {
            setStatusText(t('update_status_success'), 'update_status_success');
            logMessage('=== ОНОВЛЕННЯ ПРОШИВКИ ЗАВЕРШЕНО УСПІШНО ===');

            alert(t('update_alert_success'));

            // Очищуємо вибраний файл
            selectedFile = null;
            const fileNameDisplay = document.getElementById('file-name');
            if (fileNameDisplay) {
                fileNameDisplay.textContent = 'Файл не обрано';
                fileNameDisplay.setAttribute('data-lang-key', 'update_file_not_selected');
            }

        } else {
            setStatusText(t('update_status_error'), 'update_status_error');
            logMessage('=== ОНОВЛЕННЯ ПРОШИВКИ ЗАВЕРШЕНО З ПОМИЛКОЮ ===');

            alert(t('update_alert_error'));
        }

    } catch (error) {
        logMessage(`КРИТИЧНА ПОМИЛКА: ${error.message}`);
        console.error('Помилка оновлення:', error);

        setStatusText(t('update_status_error'), 'update_status_error');
        alert(`${t('update_alert_critical')}: ${error.message}`);

    } finally {
        isUpdating = false;
        streamStartedAt = 0;

        // Ховаємо оверлей та розблоковуємо UI
        toggleUpdateOverlay(false);

        if (uploadButton) uploadButton.disabled = !selectedFile;
        if (fileInput) fileInput.disabled = false;
        if (cancelButton) cancelButton.disabled = true;

        // Скидаємо прогрес
        updateProgress(0, 100);
    }
}

/** Скасування: приймач ідемпотентний, тож перерваний залив просто повторюється. */
function handleCancel() {
    if (!isUpdating) return;

    if (!confirm(t('update_cancel_confirm'))) return;

    logMessage('OTA: запит на скасування…');
    cancelFirmwareUpdate();
}

/**
 * Ініціалізує обробники подій для сторінки update
 */
export function initUpdatePage() {
    // Обробник вибору файлу
    const fileInput = document.getElementById('file-input');
    if (fileInput) {
        fileInput.addEventListener('change', handleFileSelect);
    }

    // Обробник кнопки завантаження
    const uploadButton = document.getElementById('upload-button');
    if (uploadButton) {
        uploadButton.addEventListener('click', handleUpload);
    }

    // Скасування довгої заливки
    const cancelButton = document.getElementById('cancel-button');
    if (cancelButton) {
        cancelButton.disabled = true;
        cancelButton.addEventListener('click', handleCancel);
    }

    // Обробник кліку на область вибору файлу
    const fileInputLabel = document.getElementById('file-input-label');
    if (fileInputLabel && fileInput) {
        fileInputLabel.addEventListener('click', () => {
            fileInput.click();
        });
    }

    // Таргет OTA міняє текст попередження
    const targetSelect = document.getElementById('ota-target');
    if (targetSelect) {
        targetSelect.addEventListener('change', refreshWarning);
    }
    refreshWarning();

    logMessage('Сторінка оновлення прошивки ініціалізована');
}

/**
 * Очищає стан сторінки update
 */
export function cleanupUpdatePage() {
    if (isUpdating) cancelFirmwareUpdate();

    selectedFile = null;
    isUpdating = false;
    streamStartedAt = 0;
    toggleUpdateOverlay(false);
}
