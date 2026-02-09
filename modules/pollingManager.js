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
    // Отримуємо Mode (62) та PID (напр. 0301)
    const responseMode = dataHex.substring(0, 2) === '07' ? dataHex.substring(2, 4) : dataHex.substring(0, 2);
    const responsePid = dataHex.substring(0, 2) === '07' ? dataHex.substring(4, 8) : dataHex.substring(2, 6);

    if (responseMode !== '62') return;

    const responseKey = `${canId}:22${responsePid}`;
    const context = activeRequests.get(responseKey);

    if (context) {
        logMessage(`[CAN ✓] Впізнано: ${responseKey}`);
        try {
            // Визначаємо парсер (працює і для об'єкта, і для масиву parameters)
            const parser = context.parser || context.parameters[0].response.parser;
            const id = context.id || context.parameters[0].id;
            
            const val = parser(dataHex);
            if (val !== null) context.updateCallback(id, val);
        } catch (e) {
            console.error("Помилка парсингу:", e);
        }
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