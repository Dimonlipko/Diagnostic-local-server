// --- app.js (ВИПРАВЛЕНО ВІДОБРАЖЕННЯ ІКОНОК) ---

import { state } from './modules/state.js';
import { menuConfig, DEFAULT_PAGE } from './modules/config.js'; 
import { setLanguage, initLanguageSwitcher } from './modules/translator.js';
import { loadPage, initPageEventListeners, logMessage } from './modules/ui.js';
import { connectAdapter, disconnectAdapter } from './modules/webSerial.js';
import { sendCanRequest } from './modules/canProtocol.js'; 
import { connectBleAdapter } from './modules/webBluetooth.js';

// ===============================================
// БЛОК НАВІГАЦІЇ
// ===============================================

const subMenuContainer = document.getElementById('dynamic-sub-menu');
const pageContainer = document.getElementById('page-container');
const sidebarButtons = document.querySelectorAll('.menu-trigger'); 

function setupSidebarEvents() {
    sidebarButtons.forEach(btn => {
        btn.addEventListener('click', () => {
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
    const config = menuConfig[sectionKey];

    if (!config) {
        console.error(`Немає конфігурації для розділу: ${sectionKey}`);
        return;
    }

    // 1. Очищуємо та ховаємо підменю
    subMenuContainer.innerHTML = '';
    subMenuContainer.className = 'sub-menu-hidden';

    // 2. Логіка відображення
    if (config.type === 'submenu') {
        // Показуємо панель
        subMenuContainer.className = 'sub-menu-visible';

        // Генеруємо кнопки підменю
        config.items.forEach(item => {
            const subBtn = document.createElement('button');
            subBtn.className = 'sub-menu-btn';
            
            // --- ОСЬ ЦЕЙ БЛОК ВІДПОВІДАЄ ЗА ІКОНКИ ---
            // Якщо в конфігу є іконка (SVG код), вставляємо її
            if (item.icon) {
                subBtn.innerHTML = item.icon; 
            }

            // Текст вставляємо окремо в span, щоб працював переклад і стилі
            const textSpan = document.createElement('span');
            textSpan.innerText = item.label;
            textSpan.setAttribute('data-lang-key', item.langKey);
            
            // Додаємо текст після іконки
            subBtn.appendChild(textSpan);
            // ------------------------------------------
            
            subBtn.onclick = () => {
                document.querySelectorAll('.sub-menu-btn').forEach(b => b.classList.remove('active'));
                subBtn.classList.add('active');
                loadPageWrapper(item.link);
            };
            
            subMenuContainer.appendChild(subBtn);
        });

        // Активуємо першу кнопку візуально
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
    loadPage(url, pageContainer); 
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

    if (btnSerial) {
        btnSerial.addEventListener('click', async () => {
            if (state.isConnected) {
                await disconnectAdapter();
                updateUIConnectionState(null);
                return;
            }
            try {
                logMessage("Запуск Web Serial...");
                const success = await connectAdapter();
                if (success) updateUIConnectionState('serial');
            } catch (err) {
                logMessage(`ПОМИЛКА Serial: ${err.message}`);
            }
        });
    }

    if (btnBle) {
        btnBle.addEventListener('click', async () => {
            if (state.isConnected) {
                if (state.connectionType === 'ble') {
                    state.isConnected = false; 
                } else {
                    await disconnectAdapter();
                }
                updateUIConnectionState(null);
                return;
            }
            try {
                logMessage("Запуск BLE...");
                const success = await connectBleAdapter();
                if (success) updateUIConnectionState('ble');
            } catch (err) {
                logMessage(`ПОМИЛКА BLE: ${err.message}`);
            }
        });
    }

    const savedLang = localStorage.getItem('appLanguage') || 'uk';
    setLanguage(savedLang);

    // Вантажимо сторінку за замовчуванням (Термінал)
    const defaultBtn = document.querySelector(`[data-section="terminal"]`);
    if (defaultBtn) {
        defaultBtn.click();
    }
});