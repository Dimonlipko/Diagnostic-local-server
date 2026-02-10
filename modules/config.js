// --- КОНСТАНТИ ---
export const BAUD_RATE = 38400;
export const DEFAULT_PAGE = 'pages/terminal.html';

// --- СЛОВНИК ПЕРЕКЛАДІВ ---
export const translations = {
    'uk': {
        'menu_title': 'CAN Монітор',
        'menu_inverter': '⚡️ Інвертор',
        'menu_bms': '🔋 БМС',
        'menu_bms_params': 'Параметри',
        'menu_bms_cells': 'Комірки',                                                         
        'menu_bms_temp_map': 'Температура',
        'menu_bms_soc_map': 'SOC-Мапа',
        'menu_internal': 'Внутрішні параметри',
        'menu_settings': 'Налаштування',
        'menu_update': '⬆️ Оновлення',
        'menu_terminal': '💻 Термінал',
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
        
        // --- Settings Page (Налаштування) ---
        'settings_title': 'Налаштування ЕБУ (ECU)',
        'set_wheel_circ': 'Окружність колеса',
        'set_contactor_voltage': 'Напруга увімк. контактора',
        'set_type_selector': 'Тип селектора',
        'set_type_start_btn': 'Тип кнопки Start',
        'set_type_invertor': 'Тип інвертора',
        'set_pump_temp': 'Температура пуску помпи',
        'set_fan_high_temp': 'Поріг вентилятора (High)',
        'set_fan_low_temp': 'Поріг вентилятора (Low)',
        'set_type_bms': 'Тип BMS',

        // --- BMS Parameters ---
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
        'menu_bms_temp_map': 'Temp Map',
        'menu_bms_soc_map': 'SOC Map',
        'menu_internal': 'Internal',
        'menu_settings': 'Settings',
        'menu_update': '⬆️ Update',
        'menu_terminal': '💻 Terminal',
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

        // --- Settings Page ---
        'settings_title': 'ECU Settings',
        'set_wheel_circ': 'Wheel circumference',
        'set_contactor_voltage': 'Contactor ON voltage',
        'set_type_selector': 'Type selector',
        'set_type_start_btn': 'Type start button',
        'set_type_invertor': 'Type inverter',
        'set_pump_temp': 'Pump start temperature',
        'set_fan_high_temp': 'Fan ON high speed temp',
        'set_fan_low_temp': 'Fan ON low speed temp',
        'set_type_bms': 'Type BMS',

        // --- BMS Parameters ---
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

// --- ІКОНКИ (SVG) ---
const icons = {
    list: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><line x1="8" y1="6" x2="21" y2="6"></line><line x1="8" y1="12" x2="21" y2="12"></line><line x1="8" y1="18" x2="21" y2="18"></line><line x1="3" y1="6" x2="3.01" y2="6"></line><line x1="3" y1="12" x2="3.01" y2="12"></line><line x1="3" y1="18" x2="3.01" y2="18"></line></svg>`,
    battery: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="1" y="6" width="18" height="12" rx="2" ry="2"></rect><line x1="23" y1="13" x2="23" y2="11"></line></svg>`,
    thermometer: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z"></path></svg>`,
    chart: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M18 20V10"></path><path d="M12 20V4"></path><path d="M6 20v-6"></path></svg>`,
    settings: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1 0 2.83 2 2 0 0 1-2.83 0l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-2 2 2 2 0 0 1-2-2v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83 0 2 2 0 0 1 0-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1-2-2 2 2 0 0 1 2-2h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 0-2.83 2 2 0 0 1 2.83 0l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 2-2 2 2 0 0 1 2 2v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 0 2 2 0 0 1 0 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 2 2 2 2 0 0 1-2 2h-.09a1.65 1.65 0 0 0-1.51 1z"></path></svg>`,
    chip: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><rect x="4" y="4" width="16" height="16" rx="2" ry="2"></rect><rect x="9" y="9" width="6" height="6"></rect><line x1="9" y1="1" x2="9" y2="4"></line><line x1="15" y1="1" x2="15" y2="4"></line><line x1="9" y1="20" x2="9" y2="23"></line><line x1="15" y1="20" x2="15" y2="23"></line><line x1="20" y1="9" x2="23" y2="9"></line><line x1="20" y1="14" x2="23" y2="14"></line><line x1="1" y1="9" x2="4" y2="9"></line><line x1="1" y1="14" x2="4" y2="14"></line></svg>`,
    upload: `<svg viewBox="0 0 24 24" width="24" height="24" stroke="currentColor" stroke-width="2" fill="none" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path><polyline points="17 8 12 3 7 8"></polyline><line x1="12" y1="3" x2="12" y2="15"></line></svg>`
};


export const menuConfig = {
    // === РОЗДІЛИ З ПІДМЕНЮ ===
    
    // Розділ BMS
    bms: {
        type: 'submenu', 
        defaultPage: 'pages/bms_params.html', 
        items: [
            { label: 'Параметри', link: 'pages/bms_params.html', langKey: 'menu_bms_params' },
            { label: 'Комірки', link: 'pages/bms_cells.html', langKey: 'menu_bms_cells' },
            { label: 'T-Мапа', link: 'pages/bms_temp_map.html', langKey: 'menu_bms_temp_map' },
            { label: 'SOC-Мапа', link: 'pages/bms_soc_map.html', langKey: 'menu_bms_soc_map' }
        ]
    },

    // Розділ Налаштування (Тепер включає Internal)
    ecu: {
        type: 'submenu',
        defaultPage: 'pages/settings.html',
        items: [
            { label: 'Загальні', link: 'pages/settings.html', langKey: 'menu_settings' },
            { label: 'Внутрішні', link: 'pages/internal.html', langKey: 'menu_internal' }, // <--- ДОДАНО ТУТ
            { label: 'Оновлення', link: 'pages/update.html', langKey: 'menu_update' }
        ]
    },

    // === ПРОСТІ РОЗДІЛИ ===
    
    inverter: {
        type: 'direct', 
        link: 'pages/inverter.html'
    },
    
    terminal: {
        type: 'direct',
        link: 'pages/terminal.html'
    }
    
    // internal видалено звідси
};