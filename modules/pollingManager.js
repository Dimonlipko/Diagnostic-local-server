// --- modules/pollingManager.js ---
import { state } from './state.js';
import { sendCanRequest } from './canProtocol.js';

let isPollingActive = false;
const activeRequests = new Map();

function logMessage(message) {
    console.log(`[Polling] ${message}`);
}

/**
 * Швидка логіка для Classic Bluetooth (Serial) - БЕЗ ЗМІН
 */
function startClassicPolling(requestGroups, updateCallback) {
    const staggerInterval = 50;
    requestGroups.forEach((group, index) => {
        const { request, parameters } = group;
        const handlerContext = { request, parameters, updateCallback };
        const startDelay = index * staggerInterval;

        setTimeout(() => {
            sendRequestForParameters(handlerContext);
            const intervalId = setInterval(() => {
                sendRequestForParameters(handlerContext);
            }, request.interval);
            
            if (!state.activePollers) state.activePollers = [];
            state.activePollers.push(intervalId);
        }, startDelay);
    });
}

/**
 * Послідовна логіка для BLE (Один за одним)
 */
async function startBlePollingLoop(parameterKeys, registry, updateCallback) {
    logMessage("Головний цикл BLE запущено.");
    while (isPollingActive && state.connectionType === 'ble') {
        for (const key of parameterKeys) {
            if (!isPollingActive) break;
            const paramGroup = registry[key];
            if (!paramGroup?.request) continue;

            const { canId, data } = paramGroup.request;
            const responseCanId = paramGroup.response.canId;
            
            // Ключ для очікування відповіді
            const responseKey = `${responseCanId}:22${data.substring(data.length - 4)}`;
            
            activeRequests.set(responseKey, {
                id: key,
                updateCallback: updateCallback,
                parser: paramGroup.response.parser
            });

            await sendCanRequest(canId, data);
            
            // Пауза для BLE (даємо час на обробку відповіді)
            await new Promise(r => setTimeout(r, 40)); 
        }
        await new Promise(r => setTimeout(r, 80)); 
    }
}

export function startPolling(parameterKeys, registry, updateCallback) {
    stopAllPolling();
    if (!parameterKeys?.length) return;
    isPollingActive = true;

    if (state.connectionType === 'ble') {
        logMessage("Запуск послідовного опитування (BLE Mode)");
        startBlePollingLoop(parameterKeys, registry, updateCallback);
    } else {
        logMessage("Запуск швидкого опитування (Classic Mode)");
        const requestGroups = groupParametersByRequest(parameterKeys, registry);
        startClassicPolling(requestGroups, updateCallback);
    }
}

async function sendRequestForParameters(context) {
    if (!state.isConnected) return;
    const { request } = context;
    const param = context.parameters[0];
    // Формуємо ключ для Classic Serial
    activeRequests.set(`${param.response.canId}:${request.data}`, context);
    await sendCanRequest(request.canId, request.data);
}

function groupParametersByRequest(parameterKeys, registry) {
    const groups = new Map();
    parameterKeys.forEach(key => {
        const p = registry[key];
        if (p?.request && !groups.has(key)) {
            groups.set(key, { request: p.request, parameters: [{ id: key, ...p }] });
        }
    });
    return Array.from(groups.values());
}

/**
 * Ця функція ПОВИННА викликатися з webBluetooth.js та webSerial.js
 */
export function handleCanResponse(canId, dataHex) {
    // 1. ПЕРЕВІРКА НА СМІТТЯ (мінімальна довжина для UDS відповіді)
    if (!dataHex || dataHex.length < 10) return; 

    // 2. ПЕРЕВІРКА ЦІЛІСНОСТІ (Твій підхід по першому байту)
    const pciLength = parseInt(dataHex.substring(0, 2), 16);
    const actualDataBytes = dataHex.substring(2).length / 2;

    // Якщо довжина в першому байті не збігається з отриманою - ігноруємо
    if (pciLength !== actualDataBytes) {
        // console.warn(`[Polling] Неповний пакет: PCI ${pciLength} != Data ${actualDataBytes}`);
        return;
    }

    // 3. ВИЗНАЧЕННЯ MODE ТА PID (З урахуванням того, що PCI на початку)
    // dataHex: [PCI][Mode][PID_H][PID_L]...
    // індекси:  01   23    45     67
    const responseMode = dataHex.substring(2, 4);
    const responsePid = dataHex.substring(4, 8);

    if (responseMode !== '62') return;

    const responseKey = `${canId}:22${responsePid}`;
    const context = activeRequests.get(responseKey);

    if (context) {
        logMessage(`[CAN ✓] Впізнано: ${responseKey}`);
        try {
            // Визначаємо парсер
            const parser = context.parser || context.parameters[0].response.parser;
            const id = context.id || context.parameters[0].id;
            
            // 💡 ПЕРЕДАЄМО ПОВНИЙ dataHex (з 07/05 на початку)
            // Тепер твої substring(8, 10) у parameterRegistry знову працюватимуть!
            const val = parser(dataHex); 
            
            if (val !== null) {
                context.updateCallback(id, val);
            }
        } catch (e) {
            console.error("Помилка парсингу:", e);
        }
        // Видаляємо запит з активних, щоб звільнити місце для наступного кола
        activeRequests.delete(responseKey);
    }
}

export function stopAllPolling() {
    isPollingActive = false;
    if (state.activePollers) {
        state.activePollers.forEach(id => clearInterval(id));
        state.activePollers = [];
    }
    activeRequests.clear();
}

window.pollingManager = { startPolling, stopAllPolling, handleCanResponse };