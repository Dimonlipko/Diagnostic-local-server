// Весь наш код запускається, коли HTML-оболонка готова
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. СЛОВНИК ПЕРЕКЛАДІВ (з новими ключами) ---
    const translations = {
        'uk': {
            'menu_title': 'CAN Монітор',
            'menu_inverter': '⚡️ Інвертор',
            'menu_bms': '🔋 БМС',
            'menu_bms_params': 'Параметри',
            'menu_bms_cells': 'Комірки',
            'menu_bms_temp_map': 'T-Мапа',
            'menu_bms_soc_map': 'SOC-Мапа',
            'menu_settings': '⚙️ Налаштування',
            'menu_update': '⬆️ Оновлення',
            'menu_terminal': '💻 Термінал',
            'status_adapter': 'Адаптер',
            'status_can': 'Шина (CAN)',
            'btn_connect': 'Підключити',
            'btn_write': 'Запис',
            'btn_on': 'УВІМК',
            'btn_off': 'ВИМК',
            'placeholder_new_value': 'Нове значення',
            'terminal_title': 'Термінал (Debug)',
            'terminal_subtitle': 'Сирий потік даних з адаптера для дебагу:',
            'inverter_title': 'Інвертор',
            // ... (тут мають бути всі ключі для інвертора) ...
            'bms_title': 'Параметри BMS:',
            'bms_battery_voltage': 'Напруга батареї',
            'bms_cell_min': 'Cell MIN напруга',
            'bms_cell_max': 'Cell MAX напруга',
            'bms_balancing': 'Балансування',
            'bms_recuperation': 'Рекуперація',
            'bms_cut_charge': 'Відсічка заряду',
            'bms_cell_off_charging': 'Напруга відкл. заряду',
            'bms_cell_start_balancing': 'Напруга старту баланс.',
            'bms_cell_on_tortle': 'Напруга "черепахи"',
            'bms_cell_off_battery': 'Напруга відкл. батареї',
            'bms_soc': 'SOC',
            'bms_soc_ah': 'SOC в Ah',
            'bms_soh_ah': 'SOH в Ah',
            'bms_current': 'Струм',
            'bms_current_sens_type': 'Тип датчика струму',
            'bms_current_sens1': 'Датчик струму 1',
            'bms_current_sens2': 'Датчик струму 2',
            'bms_ir_sens': 'IR sens напруга',
            'bms_min_cell_num': 'MIN номер комірки',
            'bms_max_cell_num': 'MAX номер комірки',
            'bms_sens_leaf': 'Leaf',
            'bms_sens_off': 'ВИМК',
            'bms_sens_volt1': 'Volt 1',
        },
        'en': {
            'menu_title': 'CAN Monitor',
            'menu_inverter': '⚡️ Inverter',
            'menu_bms': '🔋 BMS',
            'menu_bms_params': 'Parameters',
            'menu_bms_cells': 'Cells',
            'menu_bms_temp_map': 'T-Map',
            'menu_bms_soc_map': 'SOC-Map',
            'menu_settings': '⚙️ Settings',
            'menu_update': '⬆️ Update',
            'menu_terminal': '💻 Terminal',
            'status_adapter': 'Adapter',
            'status_can': 'CAN Bus',
            'btn_connect': 'Connect',
            'btn_write': 'Write',
            'btn_on': 'ON',
            'btn_off': 'OFF',
            'placeholder_new_value': 'New Value',
            'terminal_title': 'Terminal (Debug)',
            'terminal_subtitle': 'Raw data stream from adapter for debugging:',
            'inverter_title': 'Inverter',
            // ... (тут мають бути всі ключі для інвертора англійською) ...
            'bms_title': 'BMS Parameters:',
            'bms_battery_voltage': 'Battery voltage',
            'bms_cell_min': 'Cell MIN voltage',
            'bms_cell_max': 'Cell MAX voltage',
            'bms_balancing': 'Balancing',
            'bms_recuperation': 'Recuperation',
            'bms_cut_charge': 'Cut charge power when finishing',
            'bms_cell_off_charging': 'Cell voltage off charging',
            'bms_cell_start_balancing': 'Cell voltage start balancing',
            'bms_cell_on_tortle': 'Cell voltage on tortle',
            'bms_cell_off_battery': 'Cell voltage off battery',
            'bms_soc': 'SOC',
            'bms_soc_ah': 'SOC in Ah',
            'bms_soh_ah': 'SOH in Ah',
            'bms_current': 'Current',
            'bms_current_sens_type': 'Current sens type',
            'bms_current_sens1': 'Current sens 1',
            'bms_current_sens2': 'Current sens 2',
            'bms_ir_sens': 'IR sens voltage',
            'bms_min_cell_num': 'MIN Cell number',
            'bms_max_cell_num': 'MAX Cell number',
            'bms_sens_leaf': 'Leaf',
            'bms_sens_off': 'OFF',
            'bms_sens_volt1': 'Volt 1',
        }
    };
    let currentLanguage = 'uk'; // За замовчуванням

    // --- 2. ЕЛЕМЕНТИ UI (з оболонки) ---
    const pageContainer = document.getElementById('page-container');
    
    // Розділяємо кнопки на два типи
    const pageLoadButtons = document.querySelectorAll('.nav-button[data-page-file]');
    const submenuToggleButtons = document.querySelectorAll('.has-submenu > .nav-button:not([data-page-file])');
    
    const connectButton = document.getElementById('connectButton');
    const statusAdapter = document.getElementById('statusAdapter');
    const statusCar = document.getElementById('statusCar');
    const langBtnUk = document.getElementById('lang-uk');
    const langBtnEn = document.getElementById('lang-en');

    // --- 3. ГЛОБАЛЬНІ ЗМІННІ ---
    let port, reader, writer, adapterType, carStatusTimeout;
    let logElement = null; // Посилання на <pre id="log">
    const BAUD_RATE = 115200;
    const DEFAULT_PAGE = 'pages/terminal.html';

    // --- 4. ВИЗНАЧЕННЯ ВСІХ ФУНКЦІЙ ---

    function translatePage() {
        const t = translations[currentLanguage];
        if (!t) return;
        document.documentElement.lang = currentLanguage;
        langBtnUk.classList.toggle('active', currentLanguage === 'uk');
        langBtnEn.classList.toggle('active', currentLanguage === 'en');
        
        document.querySelectorAll('[data-lang-key]').forEach(el => {
            const key = el.dataset.langKey;
            if (t[key]) {
                // Перевіряємо, чи є вкладений span (для стрілки)
                const firstChild = el.firstElementChild; // Шукаємо <span>
                
                if (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') {
                    if (el.placeholder) el.placeholder = t[key];
                } else if (firstChild && firstChild.tagName === 'SPAN' && el.classList.contains('nav-button')) {
                    // Якщо це кнопка меню зі span (напр. "⚡️ Інвертор" або "🔋 БМС")
                    firstChild.textContent = t[key];
                }
                else {
                    el.textContent = t[key];
                }
            }
        });
    }

    function setLanguage(lang) {
        currentLanguage = lang;
        localStorage.setItem('appLanguage', lang); // Зберігаємо вибір
        translatePage();
    }

    function updateLogElement() {
        logElement = document.getElementById('log');
    }

    async function loadPage(pageFile) {
        try {
            const response = await fetch(pageFile);
            if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
            
            pageContainer.innerHTML = await response.text();
            
            updateLogElement(); 
            translatePage(); // Перекладаємо новий вміст

        } catch (error) {
            pageContainer.innerHTML = `<h2 style="color: red;">Помилка завантаження сторінки: ${pageFile}</h2><p>${error.message}</p>`;
        }
    }

    function logMessage(message) {
        if (logElement) {
            // Додаємо на початок, щоб нові повідомлення були зверху
            logElement.textContent = message + '\n' + logElement.textContent;
        }
        // console.log(message); // Для дебагу на всіх сторінках
    }

    async function readWithTimeout(timeoutMs) {
        let timeoutId;
        const timeoutPromise = new Promise((resolve) => {
            timeoutId = setTimeout(() => resolve({ value: null, done: false, timeout: true }), timeoutMs);
        });
        const readPromise = reader.read();
        const result = await Promise.race([readPromise, timeoutPromise]);
        clearTimeout(timeoutId);
        return result;
    }

    async function detectAdapterType() {
        logMessage("Визначення типу... (спроба 1: slcan 'V')...");
        await writer.write("V\r");
        const { value } = await readWithTimeout(300);
        if (value) {
            if (value.startsWith('V') || value.startsWith('N')) return 'slcan';
            if (value.includes('?')) return 'elm327';
        }
        logMessage("Спроба 1 не вдалась. (спроба 2: ELM 'ATI')...");
        await writer.write("ATI\r");
        const { value: v2 } = await readWithTimeout(1000);
        if (v2 && v2.includes('ELM327')) return 'elm327';
        logMessage("Не вдалося визначити тип адаптера.");
        return 'unknown';
    }

    async function initializeAdapter() {
        if (adapterType === 'slcan') {
            logMessage('Ініціалізація slcan...');
            await writer.write("C\r"); // Закрити, про всяк випадок
            await writer.write("O\r"); // Відкрити канал
            logMessage('slcan канал відкрито.');
        } else if (adapterType === 'elm327') {
            logMessage('Ініціалізація ELM327...');
            await writer.write("ATE0\r");   // Вимкнути ехо
            await writer.write("ATSP0\r");  // Авто-протокол
            await writer.write("ATMA\r");   // Моніторинг
            logMessage('ELM327 налаштовано на моніторинг (ATMA).');
        }
    }

    function updateUI(id, data) {
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

    function parseData(line) {
        let isValidCanMessage = false;
        let id, dlc, data;

        // Ігноруємо службові відповіді
        if (line.startsWith('OK') || line.startsWith('?') || line.includes('ELM327') || line.startsWith('V') || line.trim() === '>') {
            logMessage(`SVC: ${line}`);
            return;
        }
        
        // Парсинг slcan
        if (adapterType === 'slcan' && line.startsWith('t')) {
            id = line.substring(1, 4).toUpperCase();
            dlc = parseInt(line.substring(4, 5), 16);
            data = line.substring(5, 5 + dlc * 2);
            logMessage(`[SLCAN] ID: ${id} | DLC: ${dlc} | Data: ${data}`);
            isValidCanMessage = true;
        } 
        // Парсинг ELM327
        else if (adapterType === 'elm327') {
            const parts = line.split(' ');
            if (parts.length > 2) { 
                id = parts[0].toUpperCase();
                data = parts.slice(1).join('');
                logMessage(`[ELM327] ID: ${id} | Data: ${data}`);
                isValidCanMessage = true;
            }
        }

        // Якщо успішно розпарсили, оновлюємо UI та індикатор
        if (isValidCanMessage) {
            statusCar.classList.add('receiving');
            clearTimeout(carStatusTimeout);
            carStatusTimeout = setTimeout(() => statusCar.classList.remove('receiving'), 500); // Індикатор згасне через 0.5с
            
            updateUI(id, data);
        }
    }

    async function readLoop() {
        try {
            while (true) {
                const { value, done } = await reader.read();
                if (done) { 
                    reader.releaseLock(); 
                    break; 
                }
                const lines = value.trim().split('\r');
                for (const line of lines) {
                    if (line) parseData(line);
                }
            }
        } catch (error) {
            logMessage(`Помилка читання: ${error.message}`);
            if(reader) reader.releaseLock();
        }
    }

    function formatCanMessage(param, value) {
        // !!! ВАША ЛОГІКА ТУТ !!!
        // Ви повинні перетворити 'param' (напр. 'maxTorque') та 'value'
        // у рядок CAN-повідомлення.
        
        // Приклад-заглушка:
        // if (param === 'maxTorque' && adapterType === 'slcan') {
        //     const intValue = parseInt(value);
        //     const highByte = (intValue >> 8) & 0xFF;
        //     const lowByte = intValue & 0xFF;
        //     return `t2018${highByte.toString(16).padStart(2, '0')}${lowByte.toString(16).padStart(2, '0')}0000000000`;
        // }
        
        logMessage(`Заглушка: ${param} = ${value}. Потрібна реалізація formatCanMessage.`);
        return null; // Поверніть null, якщо не знайдено
    }

    async function sendCanMessage(paramName, value) {
        if (!writer) {
            logMessage('ПОМИЛКА: Адаптер не підключено.');
            return;
        }
        const canMessage = formatCanMessage(paramName, value);
        if (canMessage) {
            logMessage(`ВІДПРАВКА: ${canMessage} (для ${paramName}=${value})`);
            await writer.write(canMessage + '\r');
        } else {
            logMessage(`ПОМИЛКА: Не вдалося відформатувати CAN для ${paramName}=${value}`);
        }
    }

    // --- 5. ПРИВ'ЯЗКА ОБРОБНИКІВ ПОДІЙ ---

    // ОНОВЛЕНО: Логіка навігації
    
    // 5.1. Кнопки, що завантажують сторінки
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

    // 5.2. Кнопки, що відкривають підменю
    submenuToggleButtons.forEach(button => {
        button.addEventListener('click', (e) => {
            e.preventDefault(); // Забороняємо будь-які інші дії
            button.parentElement.classList.toggle('open'); // Перемикаємо клас 'open' на '.nav-item'
        });
    });

    // Мова (без змін)
    langBtnUk.addEventListener('click', () => setLanguage('uk'));
    langBtnEn.addEventListener('click', () => setLanguage('en'));

    // Кнопка "Підключити" (без змін)
    connectButton.addEventListener('click', async () => {
        if (!('serial' in navigator)) {
            logMessage('Помилка: Ваш браузер не підтримує WebSerial API.');
            return;
        }
        try {
            logMessage('Очікуємо вибору COM-порту...');
            port = await navigator.serial.requestPort();
            await port.open({ baudRate: BAUD_RATE });
            statusAdapter.classList.add('connected');
            logMessage(`Порт відкрито. Швидкість: ${BAUD_RATE}`);
            
            const textEncoder = new TextEncoderStream();
            writer = textEncoder.writable.getWriter();
            textEncoder.readable.pipeTo(port.writable);
            const textDecoder = new TextDecoderStream();
            reader = textDecoder.readable.getReader();
            textDecoder.readable.pipeTo(port.readable);

            adapterType = await detectAdapterType();
            if (adapterType === 'unknown') throw new Error('Не вдалося визначити тип адаптера.');

            await initializeAdapter();
            readLoop();
        } catch (error) {
            logMessage(`Помилка: ${error.message}`);
            if(reader) reader.releaseLock();
            statusAdapter.classList.remove('connected');
        }
    });

    // Делегування подій для динамічного контенту (кнопки Write, ON/OFF) (без змін)
    pageContainer.addEventListener('click', (event) => {
        const target = event.target;
        if (target.classList.contains('write-button')) {
            const paramName = target.dataset.paramName;
            const targetId = target.dataset.targetId;
            const inputElement = document.getElementById(targetId);
            
            if (inputElement && inputElement.value !== '') {
                sendCanMessage(paramName, inputElement.value);
            } else if (!inputElement) {
                 logMessage(`ПОМИЛКА: Не знайдено input з ID: ${targetId}`);
            } else {
                 logMessage('ПОПЕРЕДЖЕННЯ: Значення для запису порожнє.');
            }
        }
        if (target.classList.contains('bms-toggle')) {
            const paramName = target.parentElement.dataset.paramName;
            const value = target.dataset.value; // 'on' або 'off'
            target.parentElement.querySelectorAll('button').forEach(btn => btn.classList.remove('active'));
            target.classList.add('active');
            sendCanMessage(paramName, value);
        }
    });

    // --- 6. ІНІЦІАЛІЗАЦІЯ ---
    
    // Встановлюємо збережену мову або 'uk'
    const savedLang = localStorage.getItem('appLanguage') || 'uk';
    setLanguage(savedLang); // Це перекладе оболонку

    // Завантажуємо дефолтну сторінку
    const defaultNavButton = document.querySelector(`[data-page-file="${DEFAULT_PAGE}"]`);
    if (defaultNavButton) {
        defaultNavButton.classList.add('active');
        loadPage(DEFAULT_PAGE); // Це завантажить *і* перекладе сторінку
    } else {
        console.error("Не знайдено дефолтну сторінку.");
        // Якщо термінал не знайдено, завантажуємо першу доступну сторінку
        const firstButton = document.querySelector('.nav-button[data-page-file]');
        if (firstButton) {
            firstButton.classList.add('active');
            loadPage(firstButton.dataset.pageFile);
        }
    }
});

