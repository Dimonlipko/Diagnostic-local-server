/**
 * Прив'язка сторінок до параметрів
 * Ключ - шлях до HTML файлу сторінки
 * Значення - масив ID параметрів з PARAMETER_REGISTRY
 */
export const PAGE_BINDINGS = {
    // Сторінка інвертора
    'pages/inverter.html': [
        'inverter_voltage',
        'inverter_status',
        'readInvertorTemperature'

    ],
    
    // Сторінка терміналу - не опитує параметри
    'pages/terminal.html': [],
    
    // Сторінка параметрів БМС
    'pages/bms_params.html': [
        // 'bms_total_voltage',
        // 'bms_current',
        // 'bms_soc'
        // Додайте свої параметри БМС
    ],
    
    // Сторінка комірок БМС
    'pages/bms_cells.html': [
        // Тут будуть параметри для всіх комірок
        // 'bms_cell_01', 'bms_cell_02', ...
    ],
    
    // Сторінка температурної карти
    'pages/bms_temp_map.html': [],
    
    // Сторінка SOC карти
    'pages/bms_soc_map.html': [],
    
    // Сторінка налаштувань
    'pages/settings.html': [],
    
    // Сторінка оновлення
    'pages/update.html': []
};