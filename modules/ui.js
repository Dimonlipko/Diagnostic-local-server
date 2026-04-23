import { state } from './state.js';
import { translatePage } from './translator.js';
import { translations } from './config.js';
import { stopAllPolling } from './pollingManager.js';
import { PARAMETER_REGISTRY } from './parameterRegistry.js';
import { initUpdatePage, cleanupUpdatePage } from './updatePage.js';
import { initSocMapPage, cleanupSocMapPage } from './socMapPage.js';
import { initCruiseChartPage, cleanupCruiseChartPage } from './cruiseChartPage.js';
import { initPedalChartPage, cleanupPedalChartPage } from './pedalChartPage.js';
import { initPresetPage, cleanupPresetPage } from './parameterPreset.js';
import { sendCanRequest } from './canProtocol.js';

let logElement = null;
let clockTickInterval = null;

// --- Data Listener System ---
const dataListeners = new Map();

export function addDataListener(rootKey, callback) {
    if (!dataListeners.has(rootKey)) {
        dataListeners.set(rootKey, new Set());
    }
    dataListeners.get(rootKey).add(callback);
}

export function removeDataListener(rootKey, callback) {
    const listeners = dataListeners.get(rootKey);
    if (listeners) {
        listeners.delete(callback);
        if (listeners.size === 0) dataListeners.delete(rootKey);
    }
}

export function removeAllDataListeners() {
    dataListeners.clear();
}

export function updateLogElement() {
    logElement = document.getElementById('log');
}

export function logMessage(message) {
    state.terminalLog = message + '\n' + state.terminalLog;
    if (logElement) {
        logElement.textContent = state.terminalLog;
    }
    console.log(message);
}

export async function loadPage(pageFile) {
    const pageContainer = document.getElementById('page-container');
    if (!pageContainer) {
        console.error('Елемент page-container не знайдено!');
        return;
    }

    console.log(`Завантаження сторінки: ${pageFile}`);
    
    // Завжди зупиняємо старе опитування перед зміною сторінки
    if (window.pollingManager) {
        window.pollingManager.stopAllPolling();
    }

    // Cleanup data listeners та сторінки з lifecycle
    removeAllDataListeners();
    if (clockTickInterval) { clearInterval(clockTickInterval); clockTickInterval = null; }
    cleanupCruiseChartPage();
    cleanupPedalChartPage();
    
    try {
        const response = await fetch(pageFile);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        
        const html = await response.text();
        pageContainer.innerHTML = html;
        
        console.log(`Сторінка ${pageFile} завантажена успішно`);
        
        updateLogElement();
        
        if (logElement) {
            logElement.textContent = state.terminalLog;
        }
            
        translatePage();

        // --- ЛОГІКА КЕРУВАННЯ ОПИТУВАННЯМ (ОНОВЛЕНО) ---
        
        // 💡 Використовуємо state.isConnected — це найнадійніший прапорець
        const isConnected = state.isConnected; 

        // Визначаємо "тихі" сторінки
        const isSilentPage = pageFile.includes('terminal.html') || pageFile.includes('update.html');

        if (isConnected && !isSilentPage) { 
            // Збираємо ключі (data-bind) з нової сторінки
            const requiredKeys = getRequiredKeysFromDOM(pageContainer);
            
            if (requiredKeys.size > 0) {
                console.log(`[PageLoader] Запуск опитування для ${requiredKeys.size} параметрів...`, Array.from(requiredKeys));
                
                // 💡 Перевіряємо наявність менеджера та реєстру (з window)
                if (window.pollingManager && window.PARAMETER_REGISTRY) {
                    window.pollingManager.startPolling(
                        Array.from(requiredKeys),
                        window.PARAMETER_REGISTRY,
                        updateUiValue
                    );
                } else {
                    console.error('[PageLoader] pollingManager або PARAMETER_REGISTRY не знайдено.');
                }
            } else {
                console.log(`[PageLoader] На сторінці не знайдено елементів для опитування.`);
            }
        } else if (isSilentPage) {
            console.log(`[PageLoader] Опитування вимкнено для сторінки: ${pageFile}`);
        } else {
            console.log(`[PageLoader] Адаптер не підключено, опитування не запускається.`);
        }

        // Ініціалізація спеціальних сторінок
        if (pageFile.includes('update.html')) {
            console.log('[PageLoader] Ініціалізація сторінки оновлення прошивки...');
            initUpdatePage();
            initPresetPage();
        }

        if (pageFile.includes('bms_soc_map.html')) {
            console.log('[PageLoader] Ініціалізація сторінки SOC Map...');
            initSocMapPage();
        }

        if (pageFile.includes('cruise_control.html')) {
            initCruiseChartPage();
        }

        if (pageFile.includes('inverter.html')) {
            initPedalChartPage();
        }

        if (pageFile.includes('dashboard.html')) {
            initDisplayModeToggleHighlight(pageContainer);
            initDashboardClockSync(pageContainer);
        }

    } catch (error) {
        console.error(`Помилка завантаження ${pageFile}:`, error);
        pageContainer.innerHTML = `
            <div style="padding: 20px;">
                <h2 style="color: red;">Помилка завантаження сторінки</h2>
                <p><strong>Файл:</strong> ${pageFile}</p>
                <p><strong>Помилка:</strong> ${error.message}</p>
            </div>
        `;
    }
}

function initDisplayModeToggleHighlight(container) {
    addDataListener('dash_info_220F32', (_key, data) => {
        const raw = data?.displayModeRaw;
        if (raw === undefined) return;
        container.querySelectorAll('button[data-param-name="write_display_mode"]').forEach(btn => {
            btn.classList.toggle('active', parseInt(btn.dataset.value, 10) === raw);
        });
    });
}

function initDashboardClockSync(container) {
    const pad2 = (n) => String(n).padStart(2, '0');
    const pad2hex = (n) => (n & 0xff).toString(16).padStart(2, '0');

    const clockEl = container.querySelector('#readBrowserClock');
    const tick = () => {
        if (!clockEl) return;
        const d = new Date();
        clockEl.value = `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
    };
    tick();
    if (clockTickInterval) clearInterval(clockTickInterval);
    clockTickInterval = setInterval(tick, 1000);

    const btn = container.querySelector('#syncClockBtn');
    if (!btn) return;
    btn.addEventListener('click', async () => {
        if (!state.isConnected) {
            logMessage('Адаптер не підключено.');
            return;
        }
        btn.disabled = true;
        try {
            if (window.pollingManager) window.pollingManager.stopAllPolling();
            await new Promise(r => setTimeout(r, 200));

            const now = new Date();
            const day    = now.getDate();
            const month  = now.getMonth() + 1;
            const year   = Math.min(now.getFullYear() - 2000, 99);
            const hour   = now.getHours();
            const minute = now.getMinutes();

            const dateHex = `2e4101${pad2hex(day)}${pad2hex(month)}${pad2hex(year)}`;
            await sendCanRequest('79B', dateHex);
            await new Promise(r => setTimeout(r, 100));

            const timeHex = `2e4102${pad2hex(hour)}${pad2hex(minute)}00`;
            await sendCanRequest('79B', timeHex);
            await new Promise(r => setTimeout(r, 500));

            const synced = translations[state.currentLanguage]?.dash_clock_synced || 'Clock synced';
            logMessage(`[CLOCK ✓] ${synced}: ${pad2(day)}/${pad2(month)}/${2000 + year} ${pad2(hour)}:${pad2(minute)}`);
        } catch (e) {
            logMessage(`[CLOCK ✗] ${e.message}`);
        } finally {
            const keys = getRequiredKeysFromDOM(container);
            if (keys.size > 0 && window.pollingManager && window.PARAMETER_REGISTRY) {
                window.pollingManager.startPolling(
                    Array.from(keys),
                    window.PARAMETER_REGISTRY,
                    updateUiValue
                );
            }
            btn.disabled = false;
        }
    });
}

export function initNavigation() {
    console.log('Ініціалізація навігації...');
    
    const pageLoadButtons = document.querySelectorAll('.nav-button[data-page-file]');
    console.log(`Знайдено ${pageLoadButtons.length} кнопок навігації`);
    
    pageLoadButtons.forEach(button => {
        button.addEventListener('click', () => {
            const pageFile = button.dataset.pageFile;
            console.log(`Клік по кнопці: ${pageFile}`);
            
            document.querySelectorAll('.sidebar .nav-button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            button.classList.add('active');
            
            const parentMenu = button.closest('.has-submenu');
            if (parentMenu) {
                const parentButton = parentMenu.querySelector('.nav-button:not([data-page-file])');
                if (parentButton) {
                    parentButton.classList.add('active');
                }
            }
            
            loadPage(pageFile);
        });
    });

    const submenuToggleButtons = document.querySelectorAll('.has-submenu > .nav-button:not([data-page-file])');
    console.log(`Знайдено ${submenuToggleButtons.length} кнопок підменю`);
    
    submenuToggleButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault();
            const parentItem = button.parentElement;
            parentItem.classList.toggle('open');
            console.log(`Підменю ${parentItem.classList.contains('open') ? 'відкрито' : 'закрито'}`);
        });
    });
}

function getRequiredKeysFromDOM(container) {
    const requiredKeys = new Set();
    const boundElements = container.querySelectorAll('[data-bind]');
    
    boundElements.forEach(element => {
        const bindKey = element.getAttribute('data-bind');
        const rootKey = bindKey.split('.')[0];
        
        if (rootKey) {
            requiredKeys.add(rootKey);
        }
    });
    
    return requiredKeys;
}

export function initPageEventListeners(handlers) {
    const pageContainer = document.getElementById('page-container');
    if (!pageContainer) {
        console.error('page-container не знайдено для делегування подій');
        return;
    }
    
    console.log('Ініціалізація обробників подій сторінок...');
    
    pageContainer.addEventListener('click', async (event) => {
        const target = event.target;

        // --- ОБРОБКА КНОПКИ ЗАПИСУ ПАРАМЕТРІВ ---
        // --- ОБРОБКА КНОПКИ ЗАПИСУ З ПАУЗОЮ ПОЛІНГУ ---
        if (target.classList.contains('write-button') && handlers.onWrite) {
            const paramName = target.dataset.paramName;
            const targetId = target.dataset.targetId;
            const directValue = target.dataset.value; // Пряме значення з кнопки

            // Confirm dialog if needed
            const confirmKey = target.dataset.confirmKey;
            if (confirmKey) {
                const t = translations[state.currentLanguage] || {};
                const confirmText = t[confirmKey] || confirmKey;
                if (!confirm(confirmText)) return;
            }

            let valueToWrite = null;

            // Визначаємо звідки брати значення
            if (directValue !== undefined) {
                // Кнопка з прямим значенням (для ON/OFF команд)
                valueToWrite = directValue;
            } else if (targetId) {
                // Кнопка з посиланням на input
                const inputElement = document.getElementById(targetId);
                if (inputElement && inputElement.value !== '') {
                    valueToWrite = inputElement.value;
                } else if (!inputElement) {
                    logMessage(`ПОМИЛКА: Не знайдено input з ID: ${targetId}`);
                    return;
                } else {
                    logMessage('ПОПЕРЕДЖЕННЯ: Значення для запису порожнє.');
                    return;
                }
            }

            if (valueToWrite !== null) {
                // 1. Зупиняємо полінг перед записом
                if (window.pollingManager) {
                    window.pollingManager.stopAllPolling();
                    logMessage(`[WRITE] Полінг зупинено для запису ${paramName}...`);
                }

                // Короткий відпочинок для адаптера (200мс)
                await new Promise(r => setTimeout(r, 200));

                // 2. Викликаємо сам запис
                await handlers.onWrite(paramName, valueToWrite);

                // 3. Пауза, щоб ECU встиг оновити дані (500мс)
                await new Promise(r => setTimeout(r, 500));

                // 4. Автоматичний перезапуск полінгу для поточної сторінки
                const requiredKeys = getRequiredKeysFromDOM(pageContainer);
                if (requiredKeys.size > 0 && window.pollingManager) {
                    window.pollingManager.startPolling(
                        Array.from(requiredKeys),
                        window.PARAMETER_REGISTRY,
                        updateUiValue
                    );
                    logMessage(`[WRITE] Опитування відновлено.`);
                }
            }
        }

        // --- ОБРОБКА ПЕРЕМИКАЧІВ (TOGGLE) ---
        if (target.classList.contains('bms-toggle') && handlers.onToggle) {
            const paramName = target.parentElement.dataset.paramName;
            const value = target.dataset.value;
            target.parentElement.querySelectorAll('button').forEach(btn => {
                btn.classList.remove('active');
            });
            target.classList.add('active');
            handlers.onToggle(paramName, value);
        }

        // --- ОБРОБКА КНОПКИ ПРОШИВКИ (FLASH) ---
        if (target.id === 'flashButton' && handlers.onFlash) {
            const fileInput = document.getElementById('firmwareFile');
            const canId = document.getElementById('updateCanId').value;
            const canAnswer = document.getElementById('updateCanAnswer').value;
            const token = document.getElementById('updateToken').value;
            
            if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
                logMessage('ПОМИЛКА: Будь ласка, оберіть файл прошивки.');
                return;
            }
            if (!canId || !token || !canAnswer) {
                logMessage('ПОМИЛКА: Будь ласка, заповніть усі ID та токен.');
                return;
            }
            
            handlers.onFlash(fileInput.files[0], canId, canAnswer, token);
        }

        // --- НОВЕ: ОБРОБКА ВІДПРАВКИ З ТЕРМІНАЛУ ---
        if (target.id === 'terminal-send-btn' && handlers.onTerminalSend) {
            const inputElement = document.getElementById('terminal-input');
            if (inputElement) {
                const command = inputElement.value.trim();
                if (command) {
                    handlers.onTerminalSend(command);
                    inputElement.value = ''; // Очищаємо поле після відправки
                } else {
                    logMessage('ПОПЕРЕДЖЕННЯ: Команда порожня.');
                }
            }
        }
    });

    // Додаємо обробку натискання Enter у полі терміналу (окремий слухач для keydown)
    pageContainer.addEventListener('keydown', (event) => {
        if (event.target.id === 'terminal-input' && event.key === 'Enter' && handlers.onTerminalSend) {
            const command = event.target.value.trim();
            if (command) {
                handlers.onTerminalSend(command);
                event.target.value = '';
            }
        }
    });
}

export function updateUI(id, data) {
    console.log(`updateUI викликано (застаріла): ID=${id}, Data=${data}`);
}

/**
 * Оновлює UI для конкретного параметра
 */
function updateUiValue(rootKey, data) {
    const elements = document.querySelectorAll(`[data-bind^="${rootKey}"]`);
    
    elements.forEach(element => {
        const bindKey = element.getAttribute('data-bind');
        
        if (bindKey === rootKey) {
            if (typeof data !== 'object' || data === null) {
                setElementValue(element, data);
            } else {
                console.warn(`[UI_Updater] Отримано об'єкт для прямої прив'язки ${rootKey}.`);
            }
        } else if (bindKey.startsWith(rootKey + '.')) {
            if (typeof data !== 'object' || data === null) {
                console.warn(`[UI_Updater] Потрібна властивість з ${rootKey}, але дані не є об'єктом.`);
                return;
            }

            const propertyName = bindKey.substring(rootKey.length + 1);
            
            if (data.hasOwnProperty(propertyName)) {
                setElementValue(element, data[propertyName]);
            }
        }
    });

    // Notify data listeners
    const listeners = dataListeners.get(rootKey);
    if (listeners) {
        listeners.forEach(cb => {
            try { cb(rootKey, data); } catch (e) { console.error('[DataListener]', e); }
        });
    }
}

export function updateConnectionTabs() {
    const btnBT = document.getElementById('btnConnectSerial');
    const btnBLE = document.getElementById('btnConnectBle');

    if (!btnBT || !btnBLE) return;

    btnBT.classList.remove('active');
    btnBLE.classList.remove('active');

    if (state.isConnected) {
        if (state.connectionType === 'ble') {
            btnBLE.classList.add('active');
        } else {
            btnBT.classList.add('active');
        }

        // Автоматично запускаємо polling для поточної сторінки
        const pageContainer = document.getElementById('page-container');
        if (pageContainer && window.pollingManager && window.PARAMETER_REGISTRY) {
            const requiredKeys = getRequiredKeysFromDOM(pageContainer);
            if (requiredKeys.size > 0) {
                window.pollingManager.startPolling(
                    Array.from(requiredKeys),
                    window.PARAMETER_REGISTRY,
                    updateUiValue
                );
                logMessage(`[POLLING] Автоматично запущено опитування для поточної сторінки (${requiredKeys.size} параметрів)`);
            }
        }
    }
}

function setElementValue(element, value) {
    const formattedValue = (value === null || value === undefined) ? 'N/A' : value;

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
        element.value = formattedValue;
    } else {
        element.textContent = formattedValue;
    }
}