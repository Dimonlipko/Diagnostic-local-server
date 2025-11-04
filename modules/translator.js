import { state } from './state.js';
import { translations } from './config.js';

/**
 * Застосовує переклади до всіх елементів з 'data-lang-key'
 */
export function translatePage() {
    const t = translations[state.currentLanguage];
    if (!t) return;
    document.documentElement.lang = state.currentLanguage;
    
    // Оновлюємо кнопки перемикача
    const langBtnUk = document.getElementById('lang-uk');
    const langBtnEn = document.getElementById('lang-en');
    if (langBtnUk) langBtnUk.classList.toggle('active', state.currentLanguage === 'uk');
    if (langBtnEn) langBtnEn.classList.toggle('active', state.currentLanguage === 'en');
    
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

/**
 * Встановлює нову мову та оновлює сторінку
 */
export function setLanguage(lang) {
    state.currentLanguage = lang;
    localStorage.setItem('appLanguage', lang); // Зберігаємо вибір
    translatePage();
}

/**
 * Ініціалізує кнопки перемикання мови
 */
export function initLanguageSwitcher() {
    const langBtnUk = document.getElementById('lang-uk');
    const langBtnEn = document.getElementById('lang-en');
    
    if (langBtnUk) {
        langBtnUk.addEventListener('click', () => setLanguage('uk'));
    }
    if (langBtnEn) {
        langBtnEn.addEventListener('click', () => setLanguage('en'));
    }
}

