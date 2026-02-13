// --- app.js (ОНОВЛЕНО: Додано відключення BLE) ---

import { state } from './modules/state.js';
import { menuConfig, DEFAULT_PAGE } from './modules/config.js'; 
import { setLanguage, initLanguageSwitcher } from './modules/translator.js';
import { loadPage, initPageEventListeners, logMessage } from './modules/ui.js';
import { connectAdapter, disconnectAdapter } from './modules/webSerial.js';
import { sendCanRequest } from './modules/canProtocol.js'; 
// Додаємо імпорт функції відключення BLE
import { connectBleAdapter, disconnectBleAdapter } from './modules/webBluetooth.js';

// ===============================================
// БЛОК НАВІГАЦІЇ
// ===============================================

const subMenuContainer = document.getElementById('dynamic-sub-menu');
const pageContainer = document.getElementById('page-container');
const sidebarButtons = document.querySelectorAll('.menu-trigger'); 

function setupSidebarEvents() {
    if (!sidebarButtons.length) {
        console.warn("Sidebar buttons not found. Check classes in index.html");
    }
    sidebarButtons.forEach(btn => {
        btn.addEventListener('click', () => {
            // Знімаємо активний клас з усіх кнопок сайдбару
            sidebarButtons.forEach(b => b.classList.remove('active'));
            btn.classList.add('active');

            const section = btn.getAttribute('data-section');
            if (section) {
                handleMenuClick(section);
            }
        });
    });
}

function handleMenuClick(sectionKey) {
    // Перевірка на існування конфігурації
    if (!menuConfig) {
        console.error("Critical: menuConfig is undefined. Check modules/config.js");
        return;
    }

    const config = menuConfig[sectionKey];

    if (!config) {
        console.error(`No config found for section: ${sectionKey}`);
        return;
    }

    // 1. Очищуємо та ховаємо підменю
    if (subMenuContainer) {
        subMenuContainer.innerHTML = '';
        subMenuContainer.className = 'sub-menu-hidden';
    }

    // 2. Логіка відображення
    if (config.type === 'submenu' && subMenuContainer) {
        // Показуємо панель
        subMenuContainer.className = 'sub-menu-visible';

        // Генеруємо кнопки підменю
        config.items.forEach(item => {
            const subBtn = document.createElement('button');
            subBtn.className = 'sub-menu-btn';
            
            // --- ВСТАВКА ІКОНКИ ---
            if (item.icon) {
                subBtn.innerHTML = item.icon; 
            }

            // --- ВСТАВКА ТЕКСТУ ---
            const textSpan = document.createElement('span');
            textSpan.innerText = item.label;
            textSpan.setAttribute('data-lang-key', item.langKey);
            
            subBtn.appendChild(textSpan);
            
            // Обробник кліку
            subBtn.onclick = () => {
                // Оновлюємо активний стан
                const allSubBtns = subMenuContainer.querySelectorAll('.sub-menu-btn');
                allSubBtns.forEach(b => b.classList.remove('active'));
                subBtn.classList.add('active');
                
                loadPageWrapper(item.link);
            };
            
            subMenuContainer.appendChild(subBtn);
        });

        // Активуємо першу кнопку візуально, якщо вона є
        if (subMenuContainer.firstChild) {
            subMenuContainer.firstChild.classList.add('active');
        }

        // Завантажуємо сторінку за замовчуванням
        loadPageWrapper(config.defaultPage);

    } else {
        // Варіант без підменю (пряме посилання)
        loadPageWrapper(config.link);
    }
}

function loadPageWrapper(url) {
    if (pageContainer) {
        loadPage(url, pageContainer); 
    } else {
        console.error("Page container not found!");
    }
}

// ===============================================
// БЛОК ДЛЯ ЗАПИСУ ДАНИХ (БЕЗ ЗМІН)
// ===============================================

function formatCanMessage(param, value) {
    if (!window.PARAMETER_REGISTRY) {
        logMessage("ПОМИЛКА: Внутрішня: PARAMETER_REGISTRY не знайдено.");
        return null;
    }

    const config = window.PARAMETER_REGISTRY[param]?.writeConfig;
    if (!config) {
        logMessage(`ПОМИЛКА: Не знайдено 'writeConfig' для "${param}"`);
        return null;
    }

    let numericValue = parseFloat(value); 
    if (isNaN(numericValue)) {
        logMessage(`ПОМИЛКА: Значення "${value}" для "${param}" не є числом.`);
        return null;
    }

    if (config.multiplier) {
        numericValue = Math.round(numericValue * config.multiplier);
    }

    let hexValue;
    const totalHexLength = config.bytes * 2; 

    if (config.signed) {
        const mask = Math.pow(2, config.bytes * 8) - 1;
        hexValue = (numericValue & mask).toString(16);
    } else {
        if (numericValue < 0) {
            logMessage(`ПОМИЛКА: "${param}" не приймає від'ємні значення.`);
            return null;
        }
        hexValue = numericValue.toString(16);
    }

    const paddedHexValue = hexValue.padStart(totalHexLength, '0');
    
    if (paddedHexValue.length > totalHexLength) {
        logMessage(`ПОМИЛКА: Значення ${numericValue} завелике для ${config.bytes} байт.`);
        return null;
    }
    
    const finalData = config.dataPrefix + paddedHexValue;
    
    return {
        canId: config.canId,
        data: finalData.toUpperCase()
    };
}

async function handleWrite(paramKey, value) {
    if (!state.isConnected) {
        logMessage("ПОМИЛKA: Адаптер не підключено.");
        return;
    }
    
    logMessage(`Спроба запису: ${paramKey} = ${value}`);
    const canMessage = formatCanMessage(paramKey, value);
    
    if (!canMessage) return;
    
    try {
        const success = await sendCanRequest(canMessage.canId, canMessage.data); 
        if (success) {
            logMessage(`[WRITE ✓] ${paramKey} = ${value} (CAN: ${canMessage.data})`);
        } else {
            logMessage(`[WRITE ✗] Помилка відправки для ${paramKey}`);
        }
    } catch (e) {
        logMessage(`[WRITE ✗] Критична помилка відправки: ${e.message}`);
    }
}

// ===============================================
// ІНІЦІАЛІЗАЦІЯ
// ===============================================

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM завантажено, ініціалізація...');

    initLanguageSwitcher();
    setupSidebarEvents();

    initPageEventListeners({
        onWrite: handleWrite,
        onToggle: (param, val) => logMessage(`Заглушка: onToggle ${param}=${val}`),
        
        onTerminalSend: async (command) => {
            if (!state.isConnected) {
                logMessage("ПОМИЛКА: Адаптер не підключено.");
                return;
            }

            const writer = state.writer || state.bleWriter;
            if (writer) {
                try {
                    await writer.write('\r'); 
                    await new Promise(r => setTimeout(r, 100));
                    logMessage(`> ${command.toUpperCase()}`);
                    await writer.write('ATE0\r');
                    await new Promise(r => setTimeout(r, 50));
                    await writer.write(command.toUpperCase() + '\r');
                } catch (err) {
                    logMessage(`ПОМИЛКА ТЕРМІНАЛУ: ${err.message}`);
                }
            }
        }
    });

    const btnSerial = document.getElementById('btnConnectSerial');
    const btnBle = document.getElementById('btnConnectBle');

    function updateUIConnectionState(activeType) {
        if (btnSerial) btnSerial.classList.toggle('active', activeType === 'serial');
        if (btnBle) btnBle.classList.toggle('active', activeType === 'ble');
    }

    // Обробник Serial (BT)
    if (btnSerial) {
        btnSerial.addEventListener('click', async () => {
            if (state.isConnected) {
                // Якщо вже підключено (будь-чим) - відключаємо
                if (state.connectionType === 'ble') {
                    // Якщо раптом було BLE, а тиснуть BT (хоча UI має це блокувати, але на всяк випадок)
                    if (typeof disconnectBleAdapter === 'function') {
                        await disconnectBleAdapter();
                    }
                } else {
                    await disconnectAdapter();
                }
                updateUIConnectionState(null);
                return;
            }
            try {
                // Додаємо клас "connecting" для анімації завантаження
                btnSerial.classList.add('connecting');
                logMessage("Запуск Web Serial...");
                const success = await connectAdapter();
                // Прибираємо "connecting" після завершення
                btnSerial.classList.remove('connecting');
                if (success) updateUIConnectionState('serial');
            } catch (err) {
                btnSerial.classList.remove('connecting');
                logMessage(`ПОМИЛКА Serial: ${err.message}`);
            }
        });
    }

    // Обробник BLE
    if (btnBle) {
        btnBle.addEventListener('click', async () => {
            if (state.isConnected) {
                // Логіка відключення при повторному натисканні
                if (state.connectionType === 'ble') {
                    // Викликаємо функцію відключення BLE, якщо вона існує
                    if (typeof disconnectBleAdapter === 'function') {
                        await disconnectBleAdapter();
                    } else {
                        // Фолбек, якщо функції немає (хоча має бути імпортована)
                        console.warn("disconnectBleAdapter not found, force closing state");
                        state.isConnected = false;
                        state.bleServer = null;
                    }
                } else {
                    // Якщо було підключено через Serial
                    await disconnectAdapter();
                }
                updateUIConnectionState(null);
                return;
            }

            // Логіка підключення
            try {
                // Додаємо клас "connecting" для анімації завантаження
                btnBle.classList.add('connecting');
                logMessage("Запуск BLE...");
                const success = await connectBleAdapter();
                // Прибираємо "connecting" після завершення
                btnBle.classList.remove('connecting');
                if (success) updateUIConnectionState('ble');
            } catch (err) {
                btnBle.classList.remove('connecting');
                logMessage(`ПОМИЛКА BLE: ${err.message}`);
            }
        });
    }

    const savedLang = localStorage.getItem('appLanguage');
    if (savedLang) {
        setLanguage(savedLang);
    } else {
        const browserLang = navigator.language || navigator.userLanguage || '';
        const defaultLang = browserLang.startsWith('uk') ? 'uk' : 'en';
        setLanguage(defaultLang);
    }

    // --- Ініціалізація теми ---
    const savedTheme = localStorage.getItem('appTheme');
    if (savedTheme) {
        document.documentElement.setAttribute('data-theme', savedTheme);
    } else if (window.matchMedia('(prefers-color-scheme: dark)').matches) {
        document.documentElement.setAttribute('data-theme', 'dark');
    }

    const themeToggle = document.getElementById('theme-toggle');
    if (themeToggle) {
        themeToggle.addEventListener('click', () => {
            const current = document.documentElement.getAttribute('data-theme');
            const next = current === 'dark' ? 'light' : 'dark';
            document.documentElement.setAttribute('data-theme', next);
            localStorage.setItem('appTheme', next);
        });
    }

    // Вантажимо сторінку за замовчуванням (Термінал)
    const defaultBtn = document.querySelector(`[data-section="terminal"]`);
    if (defaultBtn) {
        defaultBtn.click();
    }
});