// Це "диригент". Він імпортує логіку з модулів та ініціалізує її.
import { state } from './modules/state.js';
import { DEFAULT_PAGE } from './modules/config.js';
import { setLanguage, initLanguageSwitcher } from './modules/translator.js';
import { initNavigation, loadPage, initPageEventListeners } from './modules/ui.js';
import { connectAdapter, sendCanMessage } from './modules/webSerial.js';

// Весь наш код запускається, коли HTML-оболонка готова
document.addEventListener('DOMContentLoaded', () => {

    // --- 1. ПРИВ'ЯЗКА ОСНОВНИХ ОБРОБНИКІВ ---

    // Ініціалізуємо перемикачі мови (UA/EN)
    initLanguageSwitcher();

    // Ініціалізуємо навігацію (кліки по меню)
    initNavigation();

    // Ініціалізуємо делегування подій для динамічного контенту (кнопки Write, ON/OFF)
    initPageEventListeners({
        onWrite: sendCanMessage, // Передаємо функцію sendCanMessage як callback
        onToggle: sendCanMessage // Ту саму функцію для кнопок ON/OFF
    });

    // Прив'язка кнопки "Підключити"
    const connectButton = document.getElementById('connectButton');
    if (connectButton) {
        connectButton.addEventListener('click', connectAdapter);
    }

    // --- 2. ІНІЦІАЛІЗАЦІЯ ---
    
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

