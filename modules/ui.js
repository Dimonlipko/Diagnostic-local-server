import { state } from './state.js';
import { translatePage } from './translator.js';

/**
 * Оновлює посилання на елемент <pre id="log">
 */
export function updateLogElement() {
    state.logElement = document.getElementById('log');
}

/**
 * Логує повідомлення.
 * ЗАВЖДИ зберігає в state.terminalLog.
 * Оновлює <pre> на екрані, ТІЛЬКИ якщо він видимий.
 */
export function logMessage(message) {
    // 1. ЗАВЖДИ оновлюємо повний лог у state
    state.terminalLog = message + '\n' + state.terminalLog;

    // 2. Оновлюємо видимий <pre> елемент, тільки якщо він зараз є на сторінці
    if (state.logElement) {
        state.logElement.textContent = state.terminalLog;
    }
    // console.log(message); // Для дебагу на всіх сторінках
}

/**
 * Асинхронно завантажує HTML сторінки в контейнер
 */
export async function loadPage(pageFile) {
    const pageContainer = document.getElementById('page-container');
    if (!pageContainer) return;
    
    try {
        const response = await fetch(pageFile);
        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
        
        pageContainer.innerHTML = await response.text();
        
        updateLogElement(); 

        // 3. НОВИЙ БЛОК: Відновлюємо лог, якщо ми завантажили сторінку терміналу
        if (state.logElement) {
            state.logElement.textContent = state.terminalLog;
        }
           
        translatePage(); // Перекладаємо новий вміст

    } catch (error) {
        pageContainer.innerHTML = `<h2 style="color: red;">Помилка завантаження сторінки: ${pageFile}</h2><p>${error.message}</p>`;
    }
}

/**
 * Ініціалізує навігацію по меню
 */
export function initNavigation() {
    // 1. Кнопки, що завантажують сторінки
    const pageLoadButtons = document.querySelectorAll('.nav-button[data-page-file]');
    pageLoadButtons.forEach(button => {
        button.addEventListener('click', () => {
            const pageFile = button.dataset.pageFile;
            
            // Знімаємо 'active' з усіх кнопок (включно з підменю)
            document.querySelectorAll('.sidebar .nav-button').forEach(btn => btn.classList.remove('active'));
            // Додаємо 'active' до поточної
            button.classList.add('active');
            
            // Також додаємо 'active' до батьківського меню, якщо це підменю
            const parentMenu = button.closest('.has-submenu');
            if (parentMenu) {
                // Знаходимо кнопку самого батьківського меню (НЕ ту, що в підменю)
                parentMenu.querySelector('.nav-button:not([data-page-file])').classList.add('active');
            }
            
            loadPage(pageFile);
        });
    });

    // 2. Кнопки, що відкривають підменю
    const submenuToggleButtons = document.querySelectorAll('.has-submenu > .nav-button:not([data-page-file])');
    submenuToggleButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault(); // Забороняємо будь-які інші дії
            button.parentElement.classList.toggle('open'); // Перемикаємо клас 'open' на '.nav-item'
        });
    });
}

/**
 * Ініціалізує делегування подій для динамічного контенту (кнопки Write, ON/OFF)
 * @param {object} handlers - Об'єкт з callback-функціями, напр. { onWrite: func, onToggle: func }
 */
export function initPageEventListeners(handlers) {
    const pageContainer = document.getElementById('page-container');
    if (!pageContainer) return;
    
    pageContainer.addEventListener('click', (event) => {
        const target = event.target;

        // Обробник для кнопок "Write" (з <input>)
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
            const value = target.dataset.value; // 'on' або 'off'
            target.parentElement.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');
            handlers.onToggle(paramName, value);
        }
    });
}

/**
 * Оновлює UI на основі вхідних CAN-даних
 */
export function updateUI(id, data) {
    // --- ТУТ БУДЕ ВАША ЛОГІКА ОНОВЛЕННЯ UI ---
    // Ця функція викликається для КОЖНОГО CAN-повідомлення
    
    // Приклад:
    if (id === '1F0') { // Припустимо, це ID для RPM
        const rpmEl = document.getElementById('readMotorRPM');
        if (rpmEl) {
            // const rpm = (parseInt(data.substring(0, 2), 16) << 8) | parseInt(data.substring(2, 4), 16);
            // rpmEl.value = rpm + ' rpm';
        }
    }
    if (id === '3A0') { // Припустимо, це ID для напруги BMS
        const voltEl = document.getElementById('readBatteryVoltage');
        if (voltEl) {
             // const voltage = ... (ваша логіка парсингу 'data')
             // voltEl.value = voltage + ' V';
        }
    }
}