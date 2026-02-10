// --- КОНСТАНТИ ---
export const BAUD_RATE = 38400;
export const DEFAULT_PAGE = 'pages/terminal.html';

// --- СЛОВНИК ПЕРЕКЛАДІВ (ЧИСТИЙ ТЕКСТ БЕЗ ЕМОДЗІ) ---
export const translations = {
    'uk': {
        'menu_title': 'CAN Монітор',
        'menu_inverter': 'Інвертор',
        'menu_bms': 'БМС',
        'menu_ecu': 'ECU',
        
        'menu_bms_params': 'Параметри',
        'menu_bms_cells': 'Комірки',
        'menu_bms_temp_map': 'T-Мапа',
        'menu_bms_soc_map': 'SOC-Мапа',
        
        'menu_internal': 'Внутрішні',
        'menu_settings': 'Налаштування',
        'menu_update': 'Оновлення',
        
        'menu_terminal': 'Термінал',
        
        'status_adapter': 'Адаптер',
        'status_can': 'Шина (CAN)',
        'btn_connect': 'Підключити',
        'btn_write': 'Запис',
        'btn_on': 'УВІМК',
        'btn_off': 'ВИМК',
        'col_read': 'Поточне значення',
        'col_write': 'Нове значення',
        'placeholder_new_value': 'Значення...',
        'terminal_title': 'Термінал (Debug)',
        'terminal_subtitle': 'Сирий потік даних з адаптера для дебагу:',
    },
    'en': {
        'menu_title': 'CAN Monitor',
        'menu_inverter': 'Inverter',
        'menu_bms': 'BMS',
        'menu_ecu': 'ECU',

        'menu_bms_params': 'Parameters',
        'menu_bms_cells': 'Cells',
        'menu_bms_temp_map': 'Temp Map',
        'menu_bms_soc_map': 'SOC Map',
        
        'menu_internal': 'Internal',
        'menu_settings': 'Settings',
        'menu_update': 'Update',
        
        'menu_terminal': 'Terminal',
        
        'status_adapter': 'Adapter',
        'status_can': 'CAN Bus',
        'btn_connect': 'Connect',
        'btn_write': 'Write',
        'btn_on': 'ON',
        'btn_off': 'OFF',
        'col_read': 'Current Value',
        'col_write': 'New Value',
        'placeholder_new_value': 'Value...',
        'terminal_title': 'Terminal (Debug)',
        'terminal_subtitle': 'Raw data stream from adapter for debugging:',
    }
};

// --- ІКОНКИ (SVG КОДИ) ---
const icons = {
    // --- ПІДМЕНЮ ---
    list: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
    
    battery: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="20" height="12" rx="2" ry="2"></rect><line x1="23" y1="11" x2="23" y2="13"></line><rect x="5" y="9" width="3" height="6" fill="currentColor" stroke="none"></rect><rect x="10" y="9" width="3" height="6" fill="currentColor" stroke="none"></rect><rect x="15" y="9" width="3" height="6" fill="currentColor" stroke="none"></rect></svg>`,
    
    thermometer: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>`,
    
    chart: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"></path><path d="M12 20V4"></path><path d="M6 20v-6"></path></svg>`,
    
    settings: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.38a2 2 0 0 0-.73-2.73l-.15-.1a2 2 0 0 1-1-1.72v-.51a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"></path><circle cx="12" cy="12" r="3"></circle></svg>`,
    
    chip: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`,
    
    upload: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="7 10 12 15 17 10"></polyline><line x1="12" y1="15" x2="12" y2="3"></line></svg>`,

    // --- ГОЛОВНЕ МЕНЮ (ДЛЯ ВИКОРИСТАННЯ В HTML) ---
    inverter: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M13 2L3 14h9l-1 8 10-12h-9l1-8z"/></svg>`,
    
    terminal: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><polyline points="4 17 10 11 4 5"></polyline><line x1="12" y1="19" x2="20" y2="19"></line></svg>`,

    // --- МОВИ ---
    lang_ua: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="bold">UA</text><rect x="2" y="4" width="20" height="16" rx="2" stroke-width="2"/></svg>`,
    lang_en: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><text x="50%" y="55%" dominant-baseline="middle" text-anchor="middle" font-size="10" font-weight="bold">EN</text><rect x="2" y="4" width="20" height="16" rx="2" stroke-width="2"/></svg>`
};

// --- КОНФІГУРАЦІЯ МЕНЮ ---
export const menuConfig = {
    // Розділ BMS
    bms: {
        type: 'submenu', 
        defaultPage: 'pages/bms_params.html', 
        items: [
            { label: 'Параметри', link: 'pages/bms_params.html', langKey: 'menu_bms_params', icon: icons.list },
            { label: 'Комірки', link: 'pages/bms_cells.html', langKey: 'menu_bms_cells', icon: icons.battery },
            { label: 'T-Мапа', link: 'pages/bms_temp_map.html', langKey: 'menu_bms_temp_map', icon: icons.thermometer },
            { label: 'SOC-Мапа', link: 'pages/bms_soc_map.html', langKey: 'menu_bms_soc_map', icon: icons.chart }
        ]
    },

    // Розділ ECU (колишні Налаштування)
    ecu: {
        type: 'submenu',
        defaultPage: 'pages/settings.html',
        items: [
            { label: 'Налаштування', link: 'pages/settings.html', langKey: 'menu_settings', icon: icons.settings },
            { label: 'Внутрішні', link: 'pages/internal.html', langKey: 'menu_internal', icon: icons.chip },
            { label: 'Оновлення', link: 'pages/update.html', langKey: 'menu_update', icon: icons.upload }
        ]
    },

    // Прості розділи
    inverter: { type: 'direct', link: 'pages/inverter.html' },
    terminal: { type: 'direct', link: 'pages/terminal.html' }
};