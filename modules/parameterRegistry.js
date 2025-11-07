/**
 * Реєстр параметрів - центральне сховище всіх CAN-параметрів
 */
export const PARAMETER_REGISTRY = {
    // ========================================
    // ПАРАМЕТРИ ІНВЕРТОРА
    // ========================================
    'inverter_voltage': {
        request: {
            canId: '79B',
            data: '220301',
            interval: 500
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                // --- ДЕБАГ ---
                console.log(`[DEBUG: inverter_voltage] Отримано dataHex: ${dataHex}`);
                // --- /ДЕБАГ ---

                if (dataHex.length < 16) {
                    console.warn('[DEBUG: inverter_voltage] dataHex занадто короткий, повертаю null');
                    return null;
                }
                const voltage_h = parseInt(dataHex.substring(8, 10), 16);
                const voltage_l = parseInt(dataHex.substring(10, 12), 16);
                const result = (voltage_h << 8) | voltage_l;
                
                // --- ДЕБАГ ---
                console.log(`[DEBUG: inverter_voltage] Результат парсингу: ${result} V`);
                // --- /ДЕБАГ ---

                return result;
            },
            formatter: (value) => value !== null ? `${value} V` : 'N/A'
        },
        uiElement: 'readInvertorHighVoltage'
    },
    
    'inverter_status': {
        request: {
            canId: '79B',
            data: '220301',
            interval: 500
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                // --- ДЕБАГ ---
                console.log(`[DEBUG: inverter_status] Отримано dataHex: ${dataHex}`);
                // --- /ДЕБАГ ---

                if (dataHex.length < 16) {
                    console.warn('[DEBUG: inverter_status] dataHex занадто короткий, повертаю N/A');
                    return { status: 'N/A', ready: 'N/A' };
                }
                const controllerState = parseInt(dataHex.substring(14, 16), 16);
                
                // --- ДЕБАГ ---
                console.log(`[DEBUG: inverter_status] Спарсений controllerState: ${controllerState}`);
                // --- /ДЕБАГ ---

                let result;
                switch (controllerState) {
                    case 1: result = { status: 'ERR_PRECHARGE', ready: 'No' }; break;
                    case 2: result = { status: 'BATT_DIS_OFF', ready: 'No' }; break;
                    case 3: result = { status: 'BATT_DIS_LIMIT', ready: 'No' }; break;
                    default: result = { status: 'OK', ready: 'Yes' }; break;
                }
                
                // --- ДЕБАГ ---
                console.log('[DEBUG: inverter_status] Результат парсингу:', result);
                // --- /ДЕБАГ ---
                
                return result;
            },
            formatter: null
        },
        uiElement: {
            status: 'readStatus',
            ready: 'readReady'
        }
    }
};