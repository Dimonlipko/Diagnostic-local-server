// --- app.js (ПОВНІСТЮ ОНОВЛЕНИЙ) ---

import { state } from './modules/state.js';
import { DEFAULT_PAGE } from './modules/config.js';
import { setLanguage, initLanguageSwitcher } from './modules/translator.js';
import { initNavigation, loadPage, initPageEventListeners, logMessage } from './modules/ui.js';
import { connectAdapter, sendCanMessage, disconnectAdapter } from './modules/webSerial.js';
// 💡 ІМПОРТУЄМО ФУНКЦІЮ ВІДПРАВКИ З canProtocol.js (ЯКЩО ВОНА ТАМ)
// АБО З webSerial.js, ЯКЩО ВОНА ВМІЄ ПРИЙМАТИ ID І ДАНІ
// Я припускаю, що у вас є sendCanRequest у 'canProtocol.js'
import { sendCanRequest } from './modules/canProtocol.js'; 


// ===============================================
// БЛОК ДЛЯ ЗАПИСУ ДАНИХ
// (Цей код тепер є частиною app.js)
// ===============================================

/**
 * Форматує JS-значення у повний CAN-фрейм (ID + дані) для запису.
 */
/**
 * Форматує значення від користувача у готове CAN-повідомлення.
 * @param {string} param - Ключ параметра з PARAMETER_REGISTRY (напр., 'socAh').
 * @param {string} value - "Сире" значення з поля вводу (напр., "100").
 * @returns {object|null} - Об'єкт { canId, data } або null у разі помилки.
 */
function formatCanMessage(param, value) {
    if (!window.PARAMETER_REGISTRY) {
        logMessage("ПОМИЛКА: Внутрішня: PARAMETER_REGISTRY не знайдено.");
        console.error("[Formatter] PARAMETER_REGISTRY не знайдено у 'window'!");
        return null;
    }

    const config = window.PARAMETER_REGISTRY[param]?.writeConfig;

    if (!config) {
        logMessage(`ПОМИЛКА: Не знайдено 'writeConfig' для "${param}"`);
        return null;
    }

    // <-- ЗМІНА: Використовуємо parseFloat замість parseInt
    let numericValue = parseFloat(value); 
    
    if (isNaN(numericValue)) {
        logMessage(`ПОМИЛКА: Значення "${value}" для "${param}" не є числом.`);
        return null;
    }

    // <-- ЗМІНА: Застосовуємо множник, ЯКЩО він існує в конфігурації
    if (config.multiplier) {
        // Множимо значення від користувача (напр., 100) на множник (напр., 1000000)
        // Округлюємо, оскільки CAN-повідомлення не може бути дробовим
        numericValue = Math.round(numericValue * config.multiplier);
    }
    // Тепер numericValue = 100000000 (у прикладі з socAh)

    let hexValue;
    const totalHexLength = config.bytes * 2; 

    if (config.signed) {
        const mask = Math.pow(2, config.bytes * 8) - 1;
        // Тепер ця логіка працює з ВЖЕ помноженим значенням
        hexValue = (numericValue & mask).toString(16);
    } else {
        if (numericValue < 0) {
            logMessage(`ПОМИЛКА: "${param}" не приймає від'ємні значення.`);
            return null;
        }
        // І ця логіка працює з ВЖЕ помноженим значенням
        hexValue = numericValue.toString(16);
    }

    // Доповнюємо HEX до потрібної довжини (напр., 8 символів для 4 байт)
    const paddedHexValue = hexValue.padStart(totalHexLength, '0');
    
    // Перевірка, чи не перевищує значення максимальний розмір
    if (paddedHexValue.length > totalHexLength) {
        logMessage(`ПОМИЛКА: Значення ${numericValue} завелике для ${config.bytes} байт.`);
        console.error(`[Formatter] Значення ${numericValue} (${hexValue}) перевищує ${config.bytes} байт.`);
        return null;
    }
    
    const finalData = config.dataPrefix + paddedHexValue;
    
    return {
        canId: config.canId,
        data: finalData.toUpperCase()
    };
}


/**
 * РЕАЛЬНИЙ обробник для onWrite, який замінить "заглушку".
 */
async function handleWrite(paramKey, value) {
    if (!state.isConnected) {
        logMessage("ПОМИЛKA: Адаптер не підключено.");
        return;
    }
    
    logMessage(`Спроба запису: ${paramKey} = ${value}`);
    
    // 1. Форматуємо повідомлення
    const canMessage = formatCanMessage(paramKey, value);
    
    if (!canMessage) {
        // Помилка вже буде в лозі з formatCanMessage
        return;
    }
    
    // 2. Викликаємо вашу універсальну функцію відправки
    try {
        // 💡 Використовуємо 'sendCanRequest', яка приймає ID і ДАНІ
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
// КІНЕЦЬ БЛОКУ
// ===============================================


// --- ВАШ ІСНУЮЧИЙ КОД ---

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM завантажено, ініціалізація...');

    initLanguageSwitcher();
    initNavigation();

    // 💡 ОНОВЛЕНО: Тепер ми передаємо нашу НОВУ функцію
    initPageEventListeners({
        onWrite: handleWrite, // 👈 ОСЬ ГОЛОВНА ЗМІНА
        
        // TODO: Вам також треба буде зробити обробник для onToggle
        onToggle: (param, val) => logMessage(`Заглушка: onToggle ${param}=${val}`)
    });

    const connectButton = document.getElementById('connectButton');
    if (connectButton) {
        connectButton.addEventListener('click', () => {
            if (state.port) {
                disconnectAdapter();
            } else {
                connectAdapter();
            }
        });
    } else {
        console.error('Кнопка connectButton не знайдена!');
    }

    const savedLang = localStorage.getItem('appLanguage') || 'uk';
    setLanguage(savedLang);

    const defaultNavButton = document.querySelector(`[data-page-file="${DEFAULT_PAGE}"]`);
    if (defaultNavButton) {
        console.log(`Завантаження дефолтної сторінки: ${DEFAULT_PAGE}`);
        defaultNavButton.classList.add('active');
        loadPage(DEFAULT_PAGE);
    } else {
        console.error(`Не знайдено кнопку для дефолтної сторінки: ${DEFAULT_PAGE}`);
        const firstButton = document.querySelector('.nav-button[data-page-file]');
        if (firstButton) {
            const firstPage = firstButton.dataset.pageFile;
            console.log(`Завантаження першої доступної сторінки: ${firstPage}`);
            firstButton.classList.add('active');
            loadPage(firstPage);
        } else {
            console.error('Не знайдено жодної кнопки навігації!');
        }
    }
});