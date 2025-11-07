import { state } from './state.js';
import { translatePage } from './translator.js';
import { startPollingForPage, stopAllPolling } from './pollingManager.js';

let logElement = null;

/**
 * Оновлює посилання на елемент <pre id="log">
 */
export function updateLogElement() {
    logElement = document.getElementById('log');
}

/**
 * Логує повідомлення
 */
export function logMessage(message) {
    state.terminalLog = message + '\n' + state.terminalLog;
    if (logElement) {
        logElement.textContent = state.terminalLog;
    }
    console.log(message); // Для дебагу
}

/**
 * Асинхронно завантажує HTML сторінки в контейнер
 */
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
            startPollingForPage(pageFile);
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

/**
 * Ініціалізує навігацію по меню
 */
export function initNavigation() {
    console.log('Ініціалізація навігації...');
    
    // 1. Кнопки, що завантажують сторінки
    const pageLoadButtons = document.querySelectorAll('.nav-button[data-page-file]');
    console.log(`Знайдено ${pageLoadButtons.length} кнопок навігації`);
    
    pageLoadButtons.forEach(button => {
        button.addEventListener('click', () => {
            const pageFile = button.dataset.pageFile;
            console.log(`Клік по кнопці: ${pageFile}`);
            
            // Знімаємо 'active' з усіх кнопок
            document.querySelectorAll('.sidebar .nav-button').forEach(btn => {
                btn.classList.remove('active');
            });
            
            // Додаємо 'active' до поточної
            button.classList.add('active');
            
            // Також додаємо 'active' до батьківського меню
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

    // 2. Кнопки, що відкривають підменю
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

/**
 * Ініціалізує делегування подій для динамічного контенту
 */
export function initPageEventListeners(handlers) {
    const pageContainer = document.getElementById('page-container');
    if (!pageContainer) {
        console.error('page-container не знайдено для делегування подій');
        return;
    }
    
    console.log('Ініціалізація обробників подій сторінок...');
    
    pageContainer.addEventListener('click', (event) => {
        const target = event.target;

        // Обробник для кнопок "Write"
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

        // Обробник для кнопок ON/OFF
        if (target.classList.contains('bms-toggle') && handlers.onToggle) {
            const paramName = target.parentElement.dataset.paramName;
            const value = target.dataset.value;
            target.parentElement.querySelectorAll('button').forEach(btn => {
                btn.classList.remove('active');
            });
            target.classList.add('active');
            handlers.onToggle(paramName, value);
        }

        // Обробник для кнопки "Прошити"
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

/**
 * Оновлює UI на основі вхідних CAN-даних (застаріла функція - тепер використовується pollingManager)
 */
export function updateUI(id, data) {
    // Ця функція тепер не використовується, бо всю роботу робить pollingManager
    // Залишаємо для зворотної сумісності
    console.log(`updateUI викликано (застаріла): ID=${id}, Data=${data}`);
}