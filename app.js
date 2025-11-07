import { state } from './modules/state.js';
import { DEFAULT_PAGE } from './modules/config.js';
import { setLanguage, initLanguageSwitcher } from './modules/translator.js';
import { initNavigation, loadPage, initPageEventListeners } from './modules/ui.js';
import { connectAdapter, sendCanMessage, disconnectAdapter } from './modules/webSerial.js';

document.addEventListener('DOMContentLoaded', () => {
    console.log('DOM завантажено, ініціалізація...');

    // Ініціалізуємо перемикачі мови
    initLanguageSwitcher();

    // Ініціалізуємо навігацію
    initNavigation();

    // Ініціалізуємо делегування подій
    initPageEventListeners({
        onWrite: sendCanMessage,
        onToggle: sendCanMessage
    });

    // Кнопка підключення
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

    // Встановлюємо мову
    const savedLang = localStorage.getItem('appLanguage') || 'uk';
    setLanguage(savedLang);

    // Завантажуємо дефолтну сторінку
    const defaultNavButton = document.querySelector(`[data-page-file="${DEFAULT_PAGE}"]`);
    if (defaultNavButton) {
        console.log(`Завантаження дефолтної сторінки: ${DEFAULT_PAGE}`);
        defaultNavButton.classList.add('active');
        loadPage(DEFAULT_PAGE);
    } else {
        console.error(`Не знайдено кнопку для дефолтної сторінки: ${DEFAULT_PAGE}`);
        
        // Пробуємо завантажити першу доступну
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