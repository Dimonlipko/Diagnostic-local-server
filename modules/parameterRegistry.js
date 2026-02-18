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

function parseUint32(b1, b2, b3, b4) {
    return (b1 << 24) | (b2 << 16) | (b3 << 8) | b4;
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
                    invTemp: `${invTemp} °C`, 
                    motorTemp: `${motTemp} °C`,
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
    },

    // ========================================
    // BMS - ГРУПИ ДЛЯ ЧИТАННЯ (POLLING)
    // ========================================

    /**
     * Запит 220107: Battery voltage
     */
    'bms_info_220107': {
        request: { canId: '79B', data: '220107', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 12) return null; // 62220107 + 2 байти
                const h = parseInt(dataHex.substring(8, 10), 16);
                const l = parseInt(dataHex.substring(10, 12), 16);
                // (Value / 100) + "V"
                return { batteryVoltage: `${(parseUint16(h, l) / 100).toFixed(2)} V` };
            }
        }
    },

    /**
     * Запит 220306: Cell MIN/MAX voltage
     */
    'bms_info_220306': {
        request: { canId: '79B', data: '220306', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null; // 62220306 + 4 байти
                const min_h = parseInt(dataHex.substring(8, 10), 16);
                const min_l = parseInt(dataHex.substring(10, 12), 16);
                const max_h = parseInt(dataHex.substring(12, 14), 16);
                const max_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    // (Value / 1000) + "V"
                    cellMin: `${(parseUint16(min_h, min_l) / 1000).toFixed(3)} V`,
                    cellMax: `${(parseUint16(max_h, max_l) / 1000).toFixed(3)} V`
                };
            }
        }
    },
    
    /**
     * Запит 220308: Cell MIN/MAX number
     */
    'bms_info_220308': {
        request: { canId: '79B', data: '220308', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                // Цей запит також містить 'Not presed pedal position', але ми його ігноруємо
                if (dataHex.length < 16) return null; // 62220308 + 4 байти
                const minNum = parseInt(dataHex.substring(12, 14), 16);
                const maxNum = parseInt(dataHex.substring(14, 16), 16);
                return {
                    minCellNum: minNum.toString(),
                    maxCellNum: maxNum.toString()
                };
            }
        }
    },

    /**
     * Запит 220408: Balancing, Recuperation
     */
    'bms_info_220408': {
        request: { canId: '79B', data: '220408', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const balanceMap = { "0": "OFF", "1": "ON" };
                const balanceRaw = parseInt(dataHex.substring(10, 12), 16); // Байт 5
                const recup_h = parseInt(dataHex.substring(12, 14), 16);    // Байт 6
                const recup_l = parseInt(dataHex.substring(14, 16), 16);    // Байт 7
                return {
                    balancing: balanceMap[balanceRaw.toString()] || 'Unknown',
                    recuperation: `${parseUint16(recup_h, recup_l)} Nm`
                };
            }
        }
    },
    
    /**
     * Запит 220414: Cut charge power
     */
    'bms_info_220414': {
        request: { canId: '79B', data: '220414', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 14) return null;
                const cutMap = { "0": "OFF", "1": "ON" };
                const cutRaw = parseInt(dataHex.substring(12, 14), 16); // Байт 6
                return {
                    cutCharge: cutMap[cutRaw.toString()] || 'Unknown'
                };
            }
        }
    },
    
    /**
     * Запит 220409: Cell voltage off charging, Cell voltage start balancing
     */
    'bms_info_220409': {
        request: { canId: '79B', data: '220409', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const off_h = parseInt(dataHex.substring(8, 10), 16);
                const off_l = parseInt(dataHex.substring(10, 12), 16);
                const start_h = parseInt(dataHex.substring(12, 14), 16);
                const start_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    cellOffCharging: `${(parseUint16(off_h, off_l) / 1000).toFixed(3)} V`,
                    cellStartBalancing: `${(parseUint16(start_h, start_l) / 1000).toFixed(3)} V`
                };
            }
        }
    },

    /**
     * Запит 220410: Cell voltage on tortle, Cell voltage off battery
     */
    'bms_info_220410': {
        request: { canId: '79B', data: '220410', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const tortle_h = parseInt(dataHex.substring(8, 10), 16);
                const tortle_l = parseInt(dataHex.substring(10, 12), 16);
                const off_h = parseInt(dataHex.substring(12, 14), 16);
                const off_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    cellOnTortle: `${(parseUint16(tortle_h, tortle_l) / 1000).toFixed(3)} V`,
                    cellOffBattery: `${(parseUint16(off_h, off_l) / 1000).toFixed(3)} V`
                };
            }
        }
    },

    /**
     * Запит 220105: SOC %
     */
    'bms_info_220105': {
        request: { canId: '79B', data: '220105', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 12) return null;
                const h = parseInt(dataHex.substring(8, 10), 16);
                const l = parseInt(dataHex.substring(10, 12), 16);
                // (Value / 100) + "%"
                return { soc: `${(parseUint16(h, l) / 100).toFixed(2)} %` };
            }
        }
    },
    
    /**
     * Запит 220101: SOC in Ah
     */
    'bms_info_220101': {
        request: { canId: '79B', data: '220101', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const b1 = parseInt(dataHex.substring(8, 10), 16);
                const b2 = parseInt(dataHex.substring(10, 12), 16);
                const b3 = parseInt(dataHex.substring(12, 14), 16);
                const b4 = parseInt(dataHex.substring(14, 16), 16);
                // (Value / 1000000) + "Ah"
                return { socAh: `${(parseUint32(b1, b2, b3, b4) / 1000000).toFixed(3)} Ah` };
            }
        }
    },

    /**
     * Запит 220102: SOH in Ah
     */
    'bms_info_220102': {
        request: { canId: '79B', data: '220102', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const b1 = parseInt(dataHex.substring(8, 10), 16);
                const b2 = parseInt(dataHex.substring(10, 12), 16);
                const b3 = parseInt(dataHex.substring(12, 14), 16);
                const b4 = parseInt(dataHex.substring(14, 16), 16);
                // (Value / 1000000) + "Ah"
                return { sohAh: `${(parseUint32(b1, b2, b3, b4) / 1000000).toFixed(3)} Ah` };
            }
        }
    },

    /**
     * Запит 220108: Current, Current sens type
     */
    'bms_info_220108': {
        request: { canId: '79B', data: '220108', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const typeMap = { "0": "Volt 1", "1": "OFF", "2": "Leaf" };
                const typeRaw = parseInt(dataHex.substring(8, 10), 16); // Байт 4
                const curr_h = parseInt(dataHex.substring(12, 14), 16); // Байт 6
                const curr_l = parseInt(dataHex.substring(14, 16), 16); // Байт 7
                return {
                    currentSensType: typeMap[typeRaw.toString()] || 'Unknown',
                    current: `${parseInt16(curr_h, curr_l)} A`
                };
            }
        }
    },

    /**
     * Запит 220109: Current sens 1, Current sens 2
     */
    'bms_info_220109': {
        request: { canId: '79B', data: '220109', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const s1_h = parseInt(dataHex.substring(8, 10), 16);
                const s1_l = parseInt(dataHex.substring(10, 12), 16);
                const s2_h = parseInt(dataHex.substring(12, 14), 16);
                const s2_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    currentSens1: `${parseInt16(s1_h, s1_l)} A`,
                    currentSens2: `${parseInt16(s2_h, s2_l)} A`
                };
            }
        }
    },
    
    /**
     * Запит 220111: IR sens voltage
     */
    'bms_info_220111': {
        request: { canId: '79B', data: '220111', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 12) return null;
                const h = parseInt(dataHex.substring(8, 10), 16);
                const l = parseInt(dataHex.substring(10, 12), 16);
                return { irSens: `${parseInt16(h, l)} mV` };
            }
        }
    },

    'balancing': {
        // Це Toggle (ON/OFF)
        // JSON: 2e.03.81.01 (ON) / 2e.03.81.00 (OFF). 
        // Довіряємо sentbytes: 2e048101 / 2e048100
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0481', // Команда
            bytes: 1              // 1 байт для 01 або 00
        }
    },
    'recuperation': {
        // JSON: 2e.04.82, "Write requperation", 2 байти
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0482',
            bytes: 2
        }
    },
    'cutCharge': {
        // Це Toggle (ON/OFF)
        // JSON: 2e.04.14.03.01 (ON) / 2e.04.14.03.00 (OFF)
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e041403',
            bytes: 1
        }
    },
    'cellOffCharging': {
        // JSON: 2e.04.90, "Write_off_charge", 2 байти
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0490',
            bytes: 2
            // Примітка: для запису значення в мВ (якщо потрібно)
            // multiplier: 1000 
        }
    },
    'cellStartBalancing': {
        // JSON: 2e.04.91, "Write_start_balance", 2 байти
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0491',
            bytes: 2
            // multiplier: 1000
        }
    },
    'cellOnTortle': {
        // JSON: 2e.04.10, "Write_tortle", 2 байти
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0410',
            bytes: 2
            // multiplier: 1000
        }
    },
    'cellOffBattery': {
        // JSON: 2e.04.11, "Write_off_battery", 2 байти
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0411',
            bytes: 2
            // multiplier: 1000
        }
    },
    'socAh': {
        // JSON: 2e.01.01, "SOC in Ah Write", 4 байти, /1000000
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0101',
            bytes: 4,
            multiplier: 1000000 // Множимо Ah на 1M перед відправкою
        }
    },
    'sohAh': {
        // JSON: 2e.01.02, "SOH Write", 4 байти, /1000000
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0102',
            bytes: 4,
            multiplier: 1000000 // Множимо Ah на 1M перед відправкою
        }
    },
    'currentSensType': {
        // JSON: 2e.04.81 (name) -> 2e0108 (sentbytes), "Write current sens type", 1 байт (list)
        writeConfig: {
            canId: '79B',
            dataPrefix: '2e0108',
            bytes: 1
        }
    },

    /**
     * Запит 220401: ADC напруги
     */
    'internal_info_220401': {
        request: { canId: '79B', data: '220401', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                // 12v ADC (байти 4-5), 5v ADC (байти 6-7)
                const v12_h = parseInt(dataHex.substring(8, 10), 16);
                const v12_l = parseInt(dataHex.substring(10, 12), 16);
                const v5_h = parseInt(dataHex.substring(12, 14), 16);
                const v5_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    adc12v: `${(parseUint16(v12_h, v12_l) / 1000).toFixed(2)}V`,
                    adc5v: `${(parseUint16(v5_h, v5_l) / 1000).toFixed(2)}V`
                };
            }
        }
    },

    /**
     * Запит 220402: Аналогові входи A1, A2
     */
    'internal_info_220402': {
        request: { canId: '79B', data: '220402', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const a1_h = parseInt(dataHex.substring(8, 10), 16);
                const a1_l = parseInt(dataHex.substring(10, 12), 16);
                const a2_h = parseInt(dataHex.substring(12, 14), 16);
                const a2_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    adcA1: `${(parseUint16(a1_h, a1_l) / 1000).toFixed(2)} V`,
                    adcA2: `${(parseUint16(a2_h, a2_l) / 1000).toFixed(2)} V`
                };
            }
        }
    },

    /**
     * Запит 220403: A4 ADC та Педаль (A5)
     */
    'internal_info_220403': {
        request: { canId: '79B', data: '220403', interval: 250 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const a4_h = parseInt(dataHex.substring(8, 10), 16);
                const a4_l = parseInt(dataHex.substring(10, 12), 16);
                const a5_h = parseInt(dataHex.substring(12, 14), 16);
                const a5_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    adcA4: `${(parseUint16(a4_h, a4_l) / 1000).toFixed(2)} V`,
                    pedal1: `${(parseUint16(a5_h, a5_l) / 1000).toFixed(2)} V`
                };
            }
        }
    },

    /**
     * Запит 220404: Аналогові входи A7, A8
     */
    'internal_info_220404': {
        request: { canId: '79B', data: '220404', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const a7_h = parseInt(dataHex.substring(8, 10), 16);
                const a7_l = parseInt(dataHex.substring(10, 12), 16);
                const a8_h = parseInt(dataHex.substring(12, 14), 16);
                const a8_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    adcA7: `${(parseUint16(a7_h, a7_l) / 1000).toFixed(2)} V`,
                    adcA8: `${(parseUint16(a8_h, a8_l) / 1000).toFixed(2)} V`
                };
            }
        }
    },

    /**
     * Запит 220405: Гальма (A9) та Дискретні входи D5, D6
     */
    'internal_info_220405': {
        request: { canId: '79B', data: '220405', interval: 250 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const a9_h = parseInt(dataHex.substring(8, 10), 16);
                const a9_l = parseInt(dataHex.substring(10, 12), 16);
                const d5Val = parseInt(dataHex.substring(12, 14), 16);
                const d6Val = parseInt(dataHex.substring(14, 16), 16);
                // A9 в мілівольтах
                const brakeMv = parseUint16(a9_h, a9_l);
                return {
                    brakeSens: `${(brakeMv / 1000).toFixed(2)} V`,
                    d5: d5Val === 1 ? 'High' : 'Low',
                    d6: d6Val === 1 ? 'High' : 'Low'
                };
            }
        }
    },

    /**
     * Запит 220406: Цифрові входи D7 (Chademo IN1), D48, D50, D52
     */
    'internal_info_220406': {
        request: { canId: '79B', data: '220406', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                return {
                    chademoIN1: parseInt(dataHex.substring(8, 10), 16) === 1 ? 'High' : 'Low',
                    d48: parseInt(dataHex.substring(10, 12), 16) === 1 ? 'High' : 'Low',
                    d50: parseInt(dataHex.substring(12, 14), 16) === 1 ? 'High' : 'Low',
                    d52: parseInt(dataHex.substring(14, 16), 16) === 1 ? 'High' : 'Low'
                };
            }
        }
    },

    /**
     * Запит 220413: Chademo та CAN 3
     */
    'internal_info_220413': {
        request: { canId: '79B', data: '220413', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const statusMap = { "0": "Err", "1": "OK" };
                const can3Raw = parseInt(dataHex.substring(12, 14), 16);
                return {
                    chademoIN0: parseInt(dataHex.substring(8, 10), 16) === 1 ? 'High' : 'Low',
                    chademoIN2: parseInt(dataHex.substring(10, 12), 16) === 1 ? 'High' : 'Low',
                    can3: statusMap[can3Raw.toString()] || 'Unknown'
                };
            }
        }
    },

    /**
     * Запит 220407: Системна інформація (Device ID та Software Version)
     */
    'internal_info_220407': {
        request: { canId: '79B', data: '220407', interval: 5000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                // Device ID: 2 байти (4 hex символи) на позиції 8-11
                const id = parseInt(dataHex.substring(8, 12), 16);
                // Software Version: 2 байти (4 hex символи) на позиції 12-15
                const ver = parseInt(dataHex.substring(12, 16), 16);
                return {
                    deviceId: id.toString(),
                    softVer: ver.toString()
                };
            }
        }
    },

    /**
     * Запит 220415: Контактори та Помпа
     */
    'internal_info_220415': {
        request: { canId: '79B', data: '220415', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                return {
                    contactorPlus: parseInt(dataHex.substring(8, 10), 16) === 1 ? 'On' : 'Off',
                    contactorMinus: parseInt(dataHex.substring(10, 12), 16) === 1 ? 'On' : 'Off',
                    precharge: parseInt(dataHex.substring(12, 14), 16) === 1 ? 'On' : 'Off',
                    waterPump: parseInt(dataHex.substring(14, 16), 16) === 1 ? 'On' : 'Off'
                };
            }
        }
    },

    /**
     * Запит 220416: Вентилятори та Chademo Out
     */
    'internal_info_220416': {
        request: { canId: '79B', data: '220416', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                return {
                    fanHigh: parseInt(dataHex.substring(8, 10), 16) === 1 ? 'On' : 'Off',
                    dac1: parseInt(dataHex.substring(10, 12), 16) === 1 ? 'On' : 'Off',
                    d8: parseInt(dataHex.substring(12, 14), 16) === 1 ? 'On' : 'Off',
                    d12: parseInt(dataHex.substring(14, 16), 16) === 1 ? 'On' : 'Off'
                };
            }
        }
    },

    /**
     * Запит 220417: Бустер та Вентилятор низької швидкості
     */
    'internal_info_220417': {
        request: { canId: '79B', data: '220417', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 12) return null;
                return {
                    boosterStatus: parseInt(dataHex.substring(8, 10), 16) === 1 ? 'On' : 'Off',
                    fanLow: parseInt(dataHex.substring(10, 12), 16) === 1 ? 'On' : 'Off'
                };
            }
        }
    },

    /**
     * Запит 220701: Напруга бустера ON/OFF
     */
    'brake_info_220701': {
        request: { canId: '79B', data: '220701', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const on_h = parseInt(dataHex.substring(8, 10), 16);
                const on_l = parseInt(dataHex.substring(10, 12), 16);
                const off_h = parseInt(dataHex.substring(12, 14), 16);
                const off_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    voltageOn: `${(parseUint16(on_h, on_l) / 1000).toFixed(3)} V`,
                    voltageOff: `${(parseUint16(off_h, off_l) / 1000).toFixed(3)} V`
                };
            }
        }
    },

    /**
     * Запит 220501: Круїз контроль
     */
    'cruise_info_220501': {
        request: { canId: '79B', data: '220501', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const buttonMap = {
                    "0": "OFF",
                    "1": "ON",
                    "3": "CANCEL",
                    "5": "-",
                    "9": "+"
                };

                const statusMap = {
                    "0": "OFF",
                    "1": "ON"
                };

                const speed = parseInt(dataHex.substring(8, 10), 16);
                const setSpeed = parseInt(dataHex.substring(10, 12), 16);
                const button = parseInt(dataHex.substring(12, 14), 16);
                const status = parseInt(dataHex.substring(14, 16), 16);

                return {
                    speed: `${speed} km/h`,
                    cruiseSetSpeed: `${setSpeed} km/h`,
                    cruiseButton: buttonMap[button.toString()] || 'Unknown',
                    cruiseStatus: statusMap[status.toString()] || 'Unknown'
                };
            }
        }
    },

    /**
     * Запит 220502: PID коефіцієнти kP та kI
     */
    'cruise_info_220502': {
        request: { canId: '79B', data: '220502', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const kp_h = parseInt(dataHex.substring(8, 10), 16);
                const kp_l = parseInt(dataHex.substring(10, 12), 16);
                const ki_h = parseInt(dataHex.substring(12, 14), 16);
                const ki_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    kP: (parseUint16(kp_h, kp_l) * 0.1).toFixed(1),
                    kI: (parseUint16(ki_h, ki_l) * 0.1).toFixed(1)
                };
            }
        }
    },

    /**
     * Запит 220503: PID коефіцієнт kD
     */
    'cruise_info_220503': {
        request: { canId: '79B', data: '220503', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 12) return null;
                const kd_h = parseInt(dataHex.substring(8, 10), 16);
                const kd_l = parseInt(dataHex.substring(10, 12), 16);
                return {
                    kD: (parseUint16(kd_h, kd_l) * 0.1).toFixed(1)
                };
            }
        }
    },

    // ========================================
    // CLIMATE CONTROL
    // ========================================

    /**
     * Запит 221602: Analog Inputs 1-4 (Button, Temp set, IN3, IN4)
     */
    'climate_info_221602': {
        request: { canId: '79B', data: '221602', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const buttonOn = (parseInt(dataHex.substring(8, 10), 16) * 0.1).toFixed(1);
                const tempSet = (parseInt(dataHex.substring(10, 12), 16) * 0.01).toFixed(2);
                return {
                    buttonOn: `${buttonOn} V`,
                    tempSetResistor: `${tempSet} V`
                };
            }
        }
    },

    /**
     * Запит 221603: Analog Inputs 5-8 (A/C pressure, Heater temp, Evaporator temp)
     */
    'climate_info_221603': {
        request: { canId: '79B', data: '221603', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const acPressure = (parseInt(dataHex.substring(10, 12), 16) * 0.1).toFixed(1);
                const heaterTemp = (parseInt(dataHex.substring(12, 14), 16) * 0.1).toFixed(1);
                const evapTemp = (parseInt(dataHex.substring(14, 16), 16) * 0.1).toFixed(1);
                return {
                    acPressure: `${acPressure} V`,
                    heaterTempV: `${heaterTemp} V`,
                    evapTempV: `${evapTemp} V`
                };
            }
        }
    },

    /**
     * Запит 221604: Heater/AC button states
     */
    'climate_info_221604': {
        request: { canId: '79B', data: '221604', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 14) return null;
                const stateMap = { "0": "OFF", "1": "ON" };
                const heaterState = parseInt(dataHex.substring(8, 10), 16);
                const acState = parseInt(dataHex.substring(12, 14), 16);
                return {
                    heaterState: stateMap[heaterState.toString()] || 'Unknown',
                    acState: stateMap[acState.toString()] || 'Unknown'
                };
            }
        }
    },

    /**
     * Запит 221605: Pressure, Heater temp, Evaporator temp
     */
    'climate_info_221605': {
        request: { canId: '79B', data: '221605', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const press_h = parseInt(dataHex.substring(8, 10), 16);
                const press_l = parseInt(dataHex.substring(10, 12), 16);
                const heaterTemp = parseInt(dataHex.substring(12, 14), 16) - 40;
                const evapTemp = parseInt(dataHex.substring(14, 16), 16) - 40;
                return {
                    pressure: `${parseUint16(press_h, press_l)} Bar`,
                    heaterTemp: `${heaterTemp} °C`,
                    evapTemp: `${evapTemp} °C`
                };
            }
        }
    },

    /**
     * Запит 221606: Heater power, A/C power
     */
    'climate_info_221606': {
        request: { canId: '79B', data: '221606', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 14) return null;
                const heaterPower = (parseInt(dataHex.substring(8, 10), 16) * 0.1).toFixed(1);
                const acPower = (parseInt(dataHex.substring(12, 14), 16) * 0.1).toFixed(1);
                return {
                    heaterPower: `${heaterPower} kW`,
                    acPower: `${acPower} kW`
                };
            }
        }
    },

    // ========================================
    // CHADEMO
    // ========================================

    /**
     * Запит 220601: Target Current (2b), Target Voltage (2b)
     */
    'chademo_info_220601': {
        request: { canId: '79B', data: '220601', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const cur_h = parseInt(dataHex.substring(8, 10), 16);
                const cur_l = parseInt(dataHex.substring(10, 12), 16);
                const vol_h = parseInt(dataHex.substring(12, 14), 16);
                const vol_l = parseInt(dataHex.substring(14, 16), 16);
                return {
                    targetCurrent: `${parseUint16(cur_h, cur_l)} A`,
                    targetVoltage: `${parseUint16(vol_h, vol_l)} V`
                };
            }
        }
    },

    /**
     * Запит 220602: Asking Current, faults, status, chademoState
     */
    'chademo_info_220602': {
        request: { canId: '79B', data: '220602', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const stateMap = {
                    "0": "STARTUP", "1": "SEND INITIAL PARAMS",
                    "2": "WAIT FOR EVSE PARAMS", "3": "SET CHARGE BEGIN",
                    "4": "WAIT FOR BEGIN CONFIRMATION", "5": "CLOSE CONTACTORS",
                    "6": "RUNNING", "7": "CEASE_CURRENT",
                    "8": "WAIT FOR ZERO CURRENT", "9": "OPEN CONTACTOR",
                    "10": "FAULTED", "11": "STOPPED",
                    "12": "LIMBO", "13": "NOT SUPPORT"
                };
                const askingCurrent = parseInt(dataHex.substring(8, 10), 16);
                const faults = parseInt(dataHex.substring(10, 12), 16);
                const status = parseInt(dataHex.substring(12, 14), 16);
                const state = parseInt(dataHex.substring(14, 16), 16);
                return {
                    askingCurrent: `${askingCurrent} A`,
                    faults: faults.toString(),
                    status: status.toString(),
                    chademoState: stateMap[state.toString()] || 'Unknown'
                };
            }
        }
    },

    /**
     * Запит 220603: availVoltage (2b), availCurrent, supportWeldCheck
     */
    'chademo_info_220603': {
        request: { canId: '79B', data: '220603', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const vol_h = parseInt(dataHex.substring(8, 10), 16);
                const vol_l = parseInt(dataHex.substring(10, 12), 16);
                const availCurrent = parseInt(dataHex.substring(12, 14), 16);
                const weldCheck = parseInt(dataHex.substring(14, 16), 16);
                return {
                    availVoltage: `${parseUint16(vol_h, vol_l)} V`,
                    availCurrent: `${availCurrent} A`,
                    supportWeldCheck: weldCheck.toString()
                };
            }
        }
    },

    /**
     * Запит 220604: thresholdVoltage, presentVoltage (2b), minChargeAmperage
     */
    'chademo_info_220604': {
        request: { canId: '79B', data: '220604', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const thresholdVoltage = parseInt(dataHex.substring(8, 10), 16);
                const pv_h = parseInt(dataHex.substring(10, 12), 16);
                const pv_l = parseInt(dataHex.substring(12, 14), 16);
                const minAmperage = parseInt(dataHex.substring(14, 16), 16);
                return {
                    thresholdVoltage: `${thresholdVoltage} V`,
                    presentVoltage: `${parseUint16(pv_h, pv_l)} V`,
                    minChargeAmperage: `${minAmperage} A`
                };
            }
        }
    },

    /**
     * Запит 220605: evse_status, remainingChargeSeconds (2b), presentCurrent
     */
    'chademo_info_220605': {
        request: { canId: '79B', data: '220605', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const evseStatus = parseInt(dataHex.substring(8, 10), 16);
                const sec_h = parseInt(dataHex.substring(10, 12), 16);
                const sec_l = parseInt(dataHex.substring(12, 14), 16);
                const presentCurrent = parseInt(dataHex.substring(14, 16), 16);
                return {
                    evseStatus: evseStatus.toString(),
                    remainingChargeSeconds: `${parseUint16(sec_h, sec_l)} s`,
                    presentCurrent: `${presentCurrent} A`
                };
            }
        }
    },

    // ========================================
    // PDM / AC CHARGING
    // ========================================

    /**
     * Запит 220411: PWM plug, Charge plug status, PDM temperature, AC charge current
     */
    'pdm_info_220411': {
        request: { canId: '79B', data: '220411', interval: 1000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const pwmPlug = parseInt(dataHex.substring(8, 10), 16);
                const chargePlugStatus = parseInt(dataHex.substring(10, 12), 16);
                const pdmTemp = parseInt(dataHex.substring(12, 14), 16) - 40;
                const acChargeCurrent = parseInt(dataHex.substring(14, 16), 16);
                return {
                    pwmPlug: `${pwmPlug} A`,
                    chargePlugStatus: `${chargePlugStatus} A`,
                    pdmTemp: `${pdmTemp} °C`,
                    acChargeCurrent: `${acChargeCurrent} A`
                };
            }
        }
    },

    // ========================================
    // DASHBOARD / INSTRUMENT CLUSTER
    // ========================================

    /**
     * Запит 221201: Одометр (3 bytes, step 0.1, Km)
     */
    'dashboard_info_221201': {
        request: { canId: '79B', data: '221201', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 14) return null;
                const b1 = parseInt(dataHex.substring(8, 10), 16);
                const b2 = parseInt(dataHex.substring(10, 12), 16);
                const b3 = parseInt(dataHex.substring(12, 14), 16);
                const odometer = ((b1 << 16) | (b2 << 8) | b3) * 0.1;
                return { odometer: `${odometer.toFixed(1)} km` };
            }
        }
    },

    /**
     * Запит 221202: Повороти та фари (voltage inputs)
     */
    'dashboard_info_221202': {
        request: { canId: '79B', data: '221202', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const rightTurn = (parseInt(dataHex.substring(8, 10), 16) * 0.1).toFixed(1);
                const leftTurn = (parseInt(dataHex.substring(10, 12), 16) * 0.1).toFixed(1);
                const parkLights = (parseInt(dataHex.substring(12, 14), 16) * 0.1).toFixed(1);
                const headlight = (parseInt(dataHex.substring(14, 16), 16) * 0.1).toFixed(1);
                return {
                    rightTurn: `${rightTurn} V`,
                    leftTurn: `${leftTurn} V`,
                    parkLights: `${parkLights} V`,
                    headlight: `${headlight} V`
                };
            }
        }
    },

    /**
     * Запит 221203: Далекє світло, ручник, ремінь
     */
    'dashboard_info_221203': {
        request: { canId: '79B', data: '221203', interval: 500 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const beamLights = (parseInt(dataHex.substring(8, 10), 16) * 0.1).toFixed(1);
                const handbrake = (parseInt(dataHex.substring(10, 12), 16) * 0.1).toFixed(1);
                const belt = (parseInt(dataHex.substring(12, 14), 16) * 0.1).toFixed(1);
                return {
                    beamLights: `${beamLights} V`,
                    handbrake: `${handbrake} V`,
                    belt: `${belt} V`
                };
            }
        }
    },

    'settings_info_220901': {
        request: { canId: '79B', data: '220901', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 12) return null;
                const h = parseInt(dataHex.substring(8, 10), 16);
                const l = parseInt(dataHex.substring(10, 12), 16);
                return { wheelCirc: parseUint16(h, l).toString() };
            }
        }
    },

    /**
     * Запит 220110: Contactor ON voltage
     */
    'settings_info_220110': {
        request: { canId: '79B', data: '220110', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 12) return null;
                const h = parseInt(dataHex.substring(8, 10), 16);
                const l = parseInt(dataHex.substring(10, 12), 16);
                return { contactorVoltage: `${parseUint16(h, l)} V` };
            }
        }
    },

    /**
     * Запит 220131: Types (Selector, Button, Invertor)
     */
    'settings_info_220131': {
        request: { canId: '79B', data: '220131', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const selectorMap = { "0": "Button", "1": "Leaf", "2": "PSA" };
                const buttonMap = { "0": "With fixation", "1": "Without fixation" };
                const invMap = { "0": "AZE0", "1": "ZE0", "2": "ZE1" };

                const selRaw = parseInt(dataHex.substring(10, 12), 16); // Байт 5
                const btnRaw = parseInt(dataHex.substring(12, 14), 16); // Байт 6
                const invRaw = parseInt(dataHex.substring(14, 16), 16); // Байт 7

                return {
                    typeSelector: selectorMap[selRaw.toString()] || "Unknown",
                    typeStartBtn: buttonMap[btnRaw.toString()] || "Unknown",
                    typeInvertor: invMap[invRaw.toString()] || "Unknown"
                };
            }
        }
    },

    /**
     * Запит 220408: Pump Temp
     */
    'settings_info_220408': {
        request: { canId: '79B', data: '220408', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const temp = parseInt(dataHex.substring(8, 10), 16); // Байт 4
                return { pumpTemp: `${temp} °C` };
            }
        }
    },

    /**
     * Запит 220414: Fan Temps & BMS Type
     */
    'settings_info_220414': {
        request: { canId: '79B', data: '220414', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;
                const bmsMap = { "0": "OFF", "1": "Volt Gen 1", "2": "Leaf", "3": "Orion 2", "4": "VW ID", "9": "JK-BMS"};

                const highTemp = parseInt(dataHex.substring(8, 10), 16); // Байт 4
                const bmsRaw = parseInt(dataHex.substring(10, 12), 16);  // Байт 5
                const lowTemp = parseInt(dataHex.substring(14, 16), 16);  // Байт 7

                return {
                    fanHighTemp: `${highTemp} °C`,
                    typeBms: bmsMap[bmsRaw.toString()] || "Unknown",
                    fanLowTemp: `${lowTemp} °C`
                };
            }
        }
    },

    'write_wheel_circ': {
        writeConfig: { canId: '79B', dataPrefix: '2e0901', bytes: 2 }
    },
    'write_contactor_voltage': {
        writeConfig: { canId: '79B', dataPrefix: '2e0110', bytes: 2 }
    },
    'write_type_selector': {
        writeConfig: { canId: '79B', dataPrefix: '2e013102', bytes: 1 }
    },
    'write_type_start_btn': {
        writeConfig: { canId: '79B', dataPrefix: '2e013103', bytes: 1 }
    },
    'write_type_invertor': {
        writeConfig: { canId: '79B', dataPrefix: '2e013104', bytes: 1 }
    },
    'write_pump_temp': {
        writeConfig: { canId: '79B', dataPrefix: '2e0408', bytes: 1 }
    },
    'write_fan_high_temp': {
        writeConfig: { canId: '79B', dataPrefix: '2e041401', bytes: 1 }
    },
    'write_fan_low_temp': {
        writeConfig: { canId: '79B', dataPrefix: '2e041404', bytes: 1 }
    },
    'write_type_bms': {
        writeConfig: { canId: '79B', dataPrefix: '2e041402', bytes: 1 }
    },
    'write_booster_on': {
        writeConfig: { canId: '79B', dataPrefix: '2e070101', bytes: 2 }
    },
    'write_booster_off': {
        writeConfig: { canId: '79B', dataPrefix: '2e070102', bytes: 2 }
    },
    'write_cc_kp': {
        writeConfig: { canId: '79B', dataPrefix: '2e050201', bytes: 2 }
    },
    'write_cc_ki': {
        writeConfig: { canId: '79B', dataPrefix: '2e050202', bytes: 2 }
    },
    'write_cc_kd': {
        writeConfig: { canId: '79B', dataPrefix: '2e050203', bytes: 2 }
    },
    'write_ac_charge_current': {
        writeConfig: { canId: '79B', dataPrefix: '2e0205', bytes: 1 }
    },
    'write_target_current': {
        writeConfig: { canId: '79B', dataPrefix: '2e0601', bytes: 2 }
    },

    // ========================================
    // BMS TEMPERATURE MAP (16 sensors)
    // ========================================

    /**
     * Запити 220207-220227: Temperature sensors 1-16
     * Відповідь: 6202XX... + 2 bytes unsigned at byte 4, offset -40
     */
    'bms_temp_1': {
        request: { canId: '79B', data: '220207', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_1: `${temp} °C` };
            }
        }
    },

    'bms_temp_2': {
        request: { canId: '79B', data: '220208', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_2: `${temp} °C` };
            }
        }
    },

    'bms_temp_3': {
        request: { canId: '79B', data: '220209', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_3: `${temp} °C` };
            }
        }
    },

    'bms_temp_4': {
        request: { canId: '79B', data: '220210', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_4: `${temp} °C` };
            }
        }
    },

    'bms_temp_5': {
        request: { canId: '79B', data: '220211', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_5: `${temp} °C` };
            }
        }
    },

    'bms_temp_6': {
        request: { canId: '79B', data: '220212', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_6: `${temp} °C` };
            }
        }
    },

    'bms_temp_7': {
        request: { canId: '79B', data: '220213', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_7: `${temp} °C` };
            }
        }
    },

    'bms_temp_8': {
        request: { canId: '79B', data: '220214', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_8: `${temp} °C` };
            }
        }
    },

    'bms_temp_9': {
        request: { canId: '79B', data: '220215', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_9: `${temp} °C` };
            }
        }
    },

    'bms_temp_10': {
        request: { canId: '79B', data: '220216', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_10: `${temp} °C` };
            }
        }
    },

    'bms_temp_11': {
        request: { canId: '79B', data: '220217', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_11: `${temp} °C` };
            }
        }
    },

    'bms_temp_12': {
        request: { canId: '79B', data: '220218', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_12: `${temp} °C` };
            }
        }
    },

    'bms_temp_13': {
        request: { canId: '79B', data: '220219', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_13: `${temp} °C` };
            }
        }
    },

    'bms_temp_14': {
        request: { canId: '79B', data: '220225', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_14: `${temp} °C` };
            }
        }
    },

    'bms_temp_15': {
        request: { canId: '79B', data: '220226', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_15: `${temp} °C` };
            }
        }
    },

    'bms_temp_16': {
        request: { canId: '79B', data: '220227', interval: 2000 },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                if (dataHex.length < 10) return null;
                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }
                const rawValue = (bytes[4] << 8) | bytes[5];
                const temp = rawValue - 40;
                return { temp_16: `${temp} °C` };
            }
        }
    },

    // ========================================
    // BMS CELL MAP (96 cells)
    // ========================================

    /**
     * Запит 2141: BMS Cell Map (Cells 1-62)
     * Відповідь: 6141... + 62 cells * 2 bytes each
     * Формат: 2 bytes unsigned, multiply by 0.001 for voltage in V
     */
    'bms_cells_1_62': {
        request: {
            canId: '79B',
            data: '2141',
            interval: 1000
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                // Мінімальна довжина: 6141 (4 байти) + 62 cells * 2 bytes = 128 байтів = 256 hex chars
                if (dataHex.length < 130) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const result = {};

                // Cells 1-62: starting at byte 3 (index 3), increment by 2
                for (let cellNum = 1; cellNum <= 62; cellNum++) {
                    const byteIndex = 3 + (cellNum - 1) * 2; // 3, 5, 7, 9...

                    if (byteIndex + 1 >= bytes.length) break;

                    // 2 bytes unsigned (big endian)
                    const rawValue = (bytes[byteIndex] << 8) | bytes[byteIndex + 1];
                    const voltage = (rawValue * 0.001).toFixed(3);

                    // Format to match HTML: cell_1, cell_2, ... cell_62
                    const cellKey = `cell_${cellNum}`;
                    result[cellKey] = `${voltage} V`;
                }

                return result;
            }
        }
    },

    /**
     * Запит 2142: BMS Cell Map (Cells 63-96)
     * Відповідь: 6142... + 34 cells * 2 bytes each
     * Формат: 2 bytes unsigned, multiply by 0.001 for voltage in V
     */
    'bms_cells_63_96': {
        request: {
            canId: '79B',
            data: '2142',
            interval: 1000
        },
        response: {
            canId: '7BB',
            parser: (dataHex) => {
                // Мінімальна довжина: 6142 (4 байти) + 34 cells * 2 bytes = 72 байти = 144 hex chars
                if (dataHex.length < 80) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const result = {};

                // Cells 63-96: starting at byte 3 (index 3), increment by 2
                for (let cellNum = 63; cellNum <= 96; cellNum++) {
                    const byteIndex = 3 + (cellNum - 63) * 2; // 3, 5, 7, 9...

                    if (byteIndex + 1 >= bytes.length) break;

                    // 2 bytes unsigned (big endian)
                    const rawValue = (bytes[byteIndex] << 8) | bytes[byteIndex + 1];
                    const voltage = (rawValue * 0.001).toFixed(3);

                    // Format to match HTML: cell_63, cell_64, ... cell_96
                    const cellKey = `cell_${cellNum}`;
                    result[cellKey] = `${voltage} V`;
                }

                return result;
            }
        }
    },

    // ========================================
    // SOC CALIBRATION MAP
    // ========================================

    /**
     * Запит 220113: Режим калібрування SOC
     */
    'soc_info_220113': {
        request: {
            canId: '79B',
            data: '220113',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 2, // DID 0113 = 2 байти
            parser: (dataHex) => {
                if (dataHex.length < 8) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                // Для 2-байтного DID (0113): дані на позиції байта 4
                // Структура: [PCI][62][01][13][DATA]
                const calibrationMode = bytes[4]; // 0 = OFF, 1 = ON

                return {
                    calibration: calibrationMode === 1 ? 'ON' : 'OFF'
                };
            }
        }
    },

    /**
     * Запит 22011200: SOC 0%
     */
    'soc_info_22011200': {
        request: {
            canId: '79B',
            data: '22011200',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011200 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                // Для 3-байтного DID (011200): дані на позиції байтів 5 та 6
                // Структура: [PCI][62][01][12][00][DATA_HIGH][DATA_LOW]
                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc0: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011201: SOC 10%
     */
    'soc_info_22011201': {
        request: {
            canId: '79B',
            data: '22011201',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011201 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc10: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011202: SOC 20%
     */
    'soc_info_22011202': {
        request: {
            canId: '79B',
            data: '22011202',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011202 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc20: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011203: SOC 30%
     */
    'soc_info_22011203': {
        request: {
            canId: '79B',
            data: '22011203',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011203 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc30: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011204: SOC 40%
     */
    'soc_info_22011204': {
        request: {
            canId: '79B',
            data: '22011204',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011204 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc40: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011205: SOC 50%
     */
    'soc_info_22011205': {
        request: {
            canId: '79B',
            data: '22011205',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011205 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc50: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011206: SOC 60%
     */
    'soc_info_22011206': {
        request: {
            canId: '79B',
            data: '22011206',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011206 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc60: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011207: SOC 70%
     */
    'soc_info_22011207': {
        request: {
            canId: '79B',
            data: '22011207',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011207 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc70: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011208: SOC 80%
     */
    'soc_info_22011208': {
        request: {
            canId: '79B',
            data: '22011208',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011208 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc80: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 22011209: SOC 90%
     */
    'soc_info_22011209': {
        request: {
            canId: '79B',
            data: '22011209',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 011209 = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc90: `${voltage} mV`
                };
            }
        }
    },

    /**
     * Запит 2201120a: SOC 100%
     */
    'soc_info_2201120a': {
        request: {
            canId: '79B',
            data: '2201120a',
            interval: 1000
        },
        response: {
            canId: '7BB',
            didBytes: 3, // DID 01120a = 3 байти
            parser: (dataHex) => {
                if (dataHex.length < 16) return null;

                const bytes = [];
                for (let i = 0; i < dataHex.length; i += 2) {
                    bytes.push(parseInt(dataHex.substring(i, i + 2), 16));
                }

                const voltage = (bytes[5] << 8) | bytes[6];

                return {
                    soc100: `${voltage} mV`
                };
            }
        }
    }

};

window.PARAMETER_REGISTRY = PARAMETER_REGISTRY;