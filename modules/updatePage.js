// updatePage.js - Обробка сторінки оновлення прошивки

import { state } from './state.js';
import { logMessage } from './ui.js';
import { updateFirmware, setFirmwareConfig } from './firmwareUpdate.js';
import { translations } from './config.js';

let selectedFile = null;
let isUpdating = false;

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
 * Оновлює індикатор прогресу
 * @param {number} current - Поточний блок
 * @param {number} total - Загальна кількість блоків
 */
function updateProgress(current, total) {
    const progressBar = document.getElementById('progress-bar');
    const statusText = document.getElementById('status-text');

    const percent = Math.round((current / total) * 100);

    if (progressBar) {
        progressBar.style.width = `${percent}%`;
        progressBar.textContent = `${percent}%`;
    }

    if (statusText) {
        statusText.textContent = `Прогрес: ${current}/${total} блоків (${percent}%)`;
        statusText.setAttribute('data-lang-key', ''); // Вимикаємо переклад для динамічного тексту
    }
}

/**
 * Встановлює текст статусу
 * @param {string} text - Текст статусу
 * @param {string} langKey - Ключ перекладу (опціонально)
 */
function setStatusText(text, langKey = null) {
    const statusText = document.getElementById('status-text');
    if (statusText) {
        statusText.textContent = text;
        if (langKey) {
            statusText.setAttribute('data-lang-key', langKey);
        } else {
            statusText.setAttribute('data-lang-key', '');
        }
    }
}

/**
 * Обробник вибору файлу
 */
function handleFileSelect(event) {
    const file = event.target.files[0];
    const fileNameDisplay = document.getElementById('file-name');
    const uploadButton = document.getElementById('upload-button');

    if (file) {
        selectedFile = file;

        if (fileNameDisplay) {
            fileNameDisplay.textContent = file.name;
            fileNameDisplay.setAttribute('data-lang-key', ''); // Вимикаємо переклад
        }

        if (uploadButton) {
            uploadButton.disabled = false;
        }

        logMessage(`Файл обрано: ${file.name} (${file.size} байт)`);
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

    // Попередження користувача
    const confirmUpdate = confirm(
        `${t('update_confirm_title')}\n\n` +
        `${t('update_confirm_text')}\n\n` +
        `${t('update_confirm_file')}: ${selectedFile.name}\n` +
        `${t('update_confirm_size')}: ${selectedFile.size} ${t('update_confirm_bytes')}\n\n` +
        `${t('update_confirm_continue')}`
    );

    if (!confirmUpdate) {
        logMessage('Оновлення скасовано користувачем');
        return;
    }

    try {
        isUpdating = true;

        // Показуємо оверлей та блокуємо UI
        toggleUpdateOverlay(true);
        setStatusText('Читання файлу...', 'update_status_reading');

        const uploadButton = document.getElementById('upload-button');
        const fileInput = document.getElementById('file-input');

        if (uploadButton) uploadButton.disabled = true;
        if (fileInput) fileInput.disabled = true;

        // Читаємо файл
        logMessage(`Читання файлу: ${selectedFile.name}`);
        const firmwareData = await readFileAsArrayBuffer(selectedFile);
        logMessage(`Файл прочитано: ${firmwareData.length} байт`);

        setStatusText('Початок оновлення...', 'update_status_starting');

        // Запускаємо оновлення
        const success = await updateFirmware(
            firmwareData,
            (current, total) => updateProgress(current, total)
        );

        if (success) {
            setStatusText('Оновлення завершено успішно!', 'update_status_success');
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
            setStatusText('Помилка оновлення!', 'update_status_error');
            logMessage('=== ОНОВЛЕННЯ ПРОШИВКИ ЗАВЕРШЕНО З ПОМИЛКОЮ ===');

            alert(t('update_alert_error'));
        }

    } catch (error) {
        logMessage(`КРИТИЧНА ПОМИЛКА: ${error.message}`);
        console.error('Помилка оновлення:', error);

        setStatusText('Критична помилка!', 'update_status_error');
        alert(`${t('update_alert_critical')}: ${error.message}`);

    } finally {
        isUpdating = false;

        // Ховаємо оверлей та розблоковуємо UI
        toggleUpdateOverlay(false);

        const uploadButton = document.getElementById('upload-button');
        const fileInput = document.getElementById('file-input');

        if (uploadButton) uploadButton.disabled = !selectedFile;
        if (fileInput) fileInput.disabled = false;

        // Скидаємо прогрес
        updateProgress(0, 100);
    }
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

    // Обробник кліку на область вибору файлу
    const fileInputLabel = document.getElementById('file-input-label');
    if (fileInputLabel && fileInput) {
        fileInputLabel.addEventListener('click', () => {
            fileInput.click();
        });
    }

    logMessage('Сторінка оновлення прошивки ініціалізована');
}

/**
 * Очищає стан сторінки update
 */
export function cleanupUpdatePage() {
    selectedFile = null;
    isUpdating = false;
    toggleUpdateOverlay(false);
}
