import { state } from './state.js';
import { translatePage } from './translator.js';
import { stopAllPolling } from './pollingManager.js';
import { PARAMETER_REGISTRY } from './parameterRegistry.js';

let logElement = null;

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
    stopAllPolling();
    
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

        // Якщо підключені - запускаємо опитування
        if (state.port) {
            const requiredKeys = getRequiredKeysFromDOM(pageContainer);
            
            console.log(`[PageLoader] Запуск опитування для ${requiredKeys.size} параметрів...`, Array.from(requiredKeys));
            
            // ВИПРАВЛЕНО: Використовуємо імпортовані модулі
            if (window.pollingManager && PARAMETER_REGISTRY) {
                window.pollingManager.startPolling(
                    Array.from(requiredKeys),
                    PARAMETER_REGISTRY,
                    updateUiValue  // Викликаємо локальну функцію
                );
            } else {
                const errorMsg = '[PageLoader] pollingManager не доступний.';
                console.error(errorMsg);
                logMessage(`ПОМИЛКА: ${errorMsg}`);
            }
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
    
    pageContainer.addEventListener('click', (event) => {
        const target = event.target;

        if (target.classList.contains('write-button') && handlers.onWrite) {
            const paramName = target.dataset.paramName;
            const targetId = target.dataset.targetId;
            const inputElement = document.getElementById(targetId);
            
            if (inputElement && inputElement.value !== '') {
                handlers.onWrite(paramName, inputElement.value);
            } else if (!inputElement) {
                logMessage(`ПОМИЛКА: Не знайдено input з ID: ${targetId}`);
            } else {
                logMessage('ПОПЕРЕДЖЕННЯ: Значення для запису порожнє.');
            }
        }

        if (target.classList.contains('bms-toggle') && handlers.onToggle) {
            const paramName = target.parentElement.dataset.paramName;
            const value = target.dataset.value;
            target.parentElement.querySelectorAll('button').forEach(btn => {
                btn.classList.remove('active');
            });
            target.classList.add('active');
            handlers.onToggle(paramName, value);
        }

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
}

function setElementValue(element, value) {
    const formattedValue = (value === null || value === undefined) ? 'N/A' : value;

    if (element.tagName === 'INPUT' || element.tagName === 'TEXTAREA' || element.tagName === 'SELECT') {
        element.value = formattedValue;
    } else {
        element.textContent = formattedValue;
    }
}