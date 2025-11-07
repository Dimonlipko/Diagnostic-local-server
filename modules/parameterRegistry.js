/**
 * parameterRegistry.js
 * 
 * Допоміжна функція для парсингу 2-байтного знакового цілого (signed int16)
 */
function parseInt16(h, l) {
    let raw = (h << 8) | l;
    if (raw & 0x8000) {
        raw -= 0x10000;
    }
    return raw;
}

/**
 * Допоміжна функція для парсингу 2-байтного беззнакового цілого (unsigned int16)
 */
function parseUint16(h, l) {
    return (h << 8) | l;
}

/**
 * Реєстр параметрів - центральне сховище всіх CAN-запитів.
 * Ключі - це логічні імена груп параметрів.
 * HTML-елементи посилаються на ці ключі через [data-bind].
 */
export const PARAMETER_REGISTRY = {

    // ========================================
    // ГРУПИ ДЛЯ ЧИТАННЯ (POLLING)
    // ========================================

    /**
     * Запит 220301: Напруга, Готовність, Статус
     */
    'inverter_info_220301': {
        request: {
            canId: '79B',
            data: '220301',
            interval: 250
        },
        response: {
        canId: '7BB',
        parser: (dataHex) => {
            console.log(`[PARSER 220301] Отримано: "${dataHex}", Length: ${dataHex.length}`);
            
            if (dataHex.length < 16) {
                console.warn(`[PARSER 220301] Недостатньо даних: ${dataHex.length} < 16`);
                return null;
            }

            const readyMap = { "0": "No", "1": "Yes" };
            const statusMap = {
                "0": "OK", "1": "Battery discharge, OFF", "2": "Battery discharge, Tortle",
                "3": "Error Precharge", "4": "Insert AC plug", "5": "AC charging",
                "6": "Insert DC plug", "7": "DC charging", "8": "Charge END",
                "9": "Charge END, DC-DC ON", "10": "Ready", "11": "IDLE"
            };

            const volt_h = parseInt(dataHex.substring(8, 10), 16);
            const volt_l = parseInt(dataHex.substring(10, 12), 16);
            const readyRaw = parseInt(dataHex.substring(12, 14), 16);
            const statusRaw = parseInt(dataHex.substring(14, 16), 16);

            console.log(`[PARSER 220301] volt_h=${volt_h}, volt_l=${volt_l}, ready=${readyRaw}, status=${statusRaw}`);

            return {
                voltage: `${parseUint16(volt_h, volt_l)} V`,
                ready: readyMap[readyRaw.toString()] || 'Unknown',
                status: statusMap[statusRaw.toString()] || 'Unknown'
            };
            }
        }
    },

    /**
     * Запит 220302: Температури, Селектор, Помилка
     */
    'inverter_info_220302': {
        request: {
            canId: '79B',
            data: '220302',
            interval: 250
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null; // Потрібно 7 байтів
                
                const selectorMap = {"0": "N", "1": "D", "2": "R", "3": "P"};
                const errorMap = {"0": "No", "1": "Yes"};

                // "Invertor temperature" (fb: 4, 1b)
                const invTemp = parseInt(dataHex.substring(8, 10), 16);
                // "Motor temperature" (fb: 5, 1b)
                const motTemp = parseInt(dataHex.substring(10, 12), 16);
                // "Selector position" (fb: 6, 1b)
                const selRaw = parseInt(dataHex.substring(12, 14), 16);
                // "Invertor error" (fb: 7, 1b)
                const errRaw = parseInt(dataHex.substring(14, 16), 16);

                return {
                    invTemp: `${invTemp} C`, 
                    motorTemp: `${motTemp} C`,
                    selector: selectorMap[selRaw.toString()] || 'Unknown',
                    error: errorMap[errRaw.toString()] || 'Unknown'
                };
            }
        }
    },

    /**
     * Запит 220303: Оберти (RPM) та Педаль
     */
    'inverter_info_220303': {
        request: {
            canId: '79B',
            data: '220303',
            interval: 250 // Швидке оновлення
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null; // Потрібно 7 байтів
                
                // "Motor RPM" (fb: 4, 2b, signed)
                const rpm_h = parseInt(dataHex.substring(8, 10), 16);
                const rpm_l = parseInt(dataHex.substring(10, 12), 16);
                const rpm = parseInt16(rpm_h, rpm_l);
                
                // "Pedal position" (fb: 6, 2b)
                const pedal_h = parseInt(dataHex.substring(12, 14), 16);
                const pedal_l = parseInt(dataHex.substring(14, 16), 16);
                const pedal = parseUint16(pedal_h, pedal_l);
                
                return {
                    rpm: `${rpm} rpm`,
                    pedal: pedal.toString()
                };
            }
        }
    },

    /**
     * Запит 220304: Макс. момент, Запит моменту
     */
    'inverter_info_220304': {
        request: {
            canId: '79B',
            data: '220304',
            interval: 250
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null; // Потрібно 7 байтів
                
                // "Max torque" (fb: 4, 2b)
                const max_h = parseInt(dataHex.substring(8, 10), 16);
                const max_l = parseInt(dataHex.substring(10, 12), 16);
                const maxTorque = parseUint16(max_h, max_l);
                
                // "Torque request" (fb: 6, 2b, signed)
                const req_h = parseInt(dataHex.substring(12, 14), 16);
                const req_l = parseInt(dataHex.substring(14, 16), 16);
                const torqueReq = parseInt16(req_h, req_l);
                
                return {
                    maxTorque: `${maxTorque} Nm`,
                    torqueReq: `${torqueReq} Nm`
                };
            }
        }
    },

    /**
     * Запит 220305: Мін/Макс позиції педалі
     */
    'inverter_info_220305': {
        request: {
            canId: '79B',
            data: '220305',
            interval: 2000 // Читаємо рідко, це налаштування
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null; // Потрібно 7 байтів
                
                // "Pedal MIN position" (fb: 4, 2b)
                const min_h = parseInt(dataHex.substring(8, 10), 16);
                const min_l = parseInt(dataHex.substring(10, 12), 16);
                const pedalMin = parseUint16(min_h, min_l);
                
                // "Pedal MAX position" (fb: 6, 2b)
                const max_h = parseInt(dataHex.substring(12, 14), 16);
                const max_l = parseInt(dataHex.substring(14, 16), 16);
                const pedalMax = parseUint16(max_h, max_l);
                
                return {
                    pedalMin: pedalMin.toString(),
                    pedalMax: pedalMax.toString()
                };
            }
        }
    },

    /**
     * Запит 220307: Параметри калібрування
     */
    'inverter_info_220307': {
        request: {
            canId: '79B',
            data: '220307',
            interval: 2000 // Налаштування
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null; // Потрібно 7 байтів
                
                // "Torque in calibration point" (fb: 4, 1b)
                const torqueCal = parseInt(dataHex.substring(8, 10), 16);
                
                // "Pedal position in calibration point" (fb: 5, 2b)
                const pedal_h = parseInt(dataHex.substring(10, 12), 16);
                const pedal_l = parseInt(dataHex.substring(12, 14), 16);
                const pedalCal = parseUint16(pedal_h, pedal_l);

                // "Torque while pedal not pressed" (fb: 7, 1b, signed)
                let torqueNotPressed = parseInt(dataHex.substring(14, 16), 16);
                if (torqueNotPressed & 0x80) { // 1b signed
                    torqueNotPressed -= 0x100;
                }

                return {
                    torqueCal: torqueCal.toString(),
                    pedalCal: pedalCal.toString(),
                    torqueNotPressed: `${torqueNotPressed} Nm`
                };
            }
        }
    },

    /**
     * Запит 220308: Позиція не натиснутої педалі
     */
    'inverter_info_220308': {
        request: {
            canId: '79B',
            data: '220308',
            interval: 2000 // Налаштування
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 12) return null; // Потрібно 5 байтів
                
                // "Not presed pedal position" (fb: 4, 2b)
                const h = parseInt(dataHex.substring(8, 10), 16);
                const l = parseInt(dataHex.substring(10, 12), 16);
                const notPressed = parseUint16(h, l);
                
                return {
                    notPressed: notPressed.toString()
                };
            }
        }
    },


    // ========================================
    // ПАРАМЕТРИ ДЛЯ ЗАПИСУ (WRITE)
    // ========================================
    // Вони не мають 'request' (для опитування), лише 'writeConfig'
    // 'writeConfig' використовується вашим 'can-writer.js' (я припускаю)
    
    'write_max_torque': {
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0304', // "2e.03.04"
            bytes: 2 // "bytescount": 2
        }
    },
    'write_pedal_min': {
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0305', // "2e.03.05"
            bytes: 2 // "bytescount": 2
        }
    },
    'write_pedal_max': {
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0306', // "2e.03.06"
            bytes: 2 // "bytescount": 2
        }
    },
    'write_torque_cal': {
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e030701', // "2e.03.07.01"
            bytes: 1 // "bytescount": 1
        }
    },
    'write_pedal_cal': {
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e030702', // "2e.03.07.02"
            bytes: 2 // "bytescount": 2
        }
    },
    'write_not_pressed': {
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0308', // "2e.03.08"
            bytes: 2 // "bytescount": 2
        }
    },
    'write_torque_not_pressed': {
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e030703', // "2e.03.07.03"
            bytes: 1, // "bytescount": 1
            signed: true // "signed": true
        }
    }
};

window.PARAMETER_REGISTRY = PARAMETER_REGISTRY;