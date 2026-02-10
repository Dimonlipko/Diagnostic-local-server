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
    logMessage("[Polling] Запуск реактивного циклу BLE...");
    isPollingActive = true;
    
    let currentIndex = 0;

    const pollNext = async () => {
        if (!isPollingActive || state.connectionType !== 'ble') return;

        const key = parameterKeys[currentIndex];
        const paramGroup = registry[key];

        if (paramGroup?.request) {
            const { canId, data } = paramGroup.request;
            const responseCanId = paramGroup.response.canId;
            const responseKey = `${responseCanId}:22${data.substring(data.length - 4)}`;

            activeRequests.set(responseKey, {
                id: key,
                updateCallback: updateCallback,
                parser: paramGroup.response.parser,
                // Додаємо callback, який викличе наступний крок
                onComplete: () => {
                    currentIndex = (currentIndex + 1) % parameterKeys.length;
                    // Мінімальна пауза 10мс, щоб не "забити" залізо
                    setTimeout(pollNext, 5); 
                }
            });

            await sendCanRequest(canId, data);
        } else {
            // Якщо параметра немає в реєстрі, йдемо далі
            currentIndex = (currentIndex + 1) % parameterKeys.length;
            pollNext();
        }
    };

    // Запускаємо перший запит
    pollNext();

    // Захисний таймер: якщо відповідь не прийшла протягом 300мс, штовхаємо чергу далі
    const watchdog = setInterval(() => {
        if (!isPollingActive) {
            clearInterval(watchdog);
            return;
        }
        // Якщо черга "зависла" (наприклад, пакет загубився)
        currentIndex = (currentIndex + 1) % parameterKeys.length;
        pollNext();
    }, 500);

    if (!state.activePollers) state.activePollers = [];
    state.activePollers.push(watchdog);
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
    // 1. ПЕРЕВІРКА НА СМІТТЯ
    if (!dataHex || dataHex.length < 10) return; 

    // 2. ПЕРЕВІРКА ЦІЛІСНОСТІ (PCI byte)
    const pciLength = parseInt(dataHex.substring(0, 2), 16);
    const actualDataBytes = dataHex.substring(2).length / 2;
    if (pciLength !== actualDataBytes) return;

    // 3. ВИЗНАЧЕННЯ MODE ТА PID
    const responseMode = dataHex.substring(2, 4);
    const responsePid = dataHex.substring(4, 8);
    if (responseMode !== '62') return;

    // Створюємо ключ, щоб знайти контекст запиту
    const responseKey = `${canId}:22${responsePid}`;
    const context = activeRequests.get(responseKey);

    // 💡 КЛЮЧОВА ЗМІНА: Перевірка на відповідність ID
    // Якщо прийшло "792", а ми чекаємо "7BB", context буде undefined
    if (!context) {
        // console.log(`[Filter] Ігноруємо чужі дані: ID ${canId}`);
        return; 
    }

    // Якщо ми тут, значить ID збігся (напр. 7BB) і PID наш
    logMessage(`[CAN ✓] Впізнано: ${responseKey}`);
    
    try {
        const parser = context.parser || (context.parameters && context.parameters[0].response.parser);
        const id = context.id || (context.parameters && context.parameters[0].id);
        
        const val = parser(dataHex); 
        if (val !== null) {
            context.updateCallback(id, val);
        }
    } catch (e) {
        console.error("Помилка парсингу:", e);
    }

    if (context.onComplete) context.onComplete();
    activeRequests.delete(responseKey);
}

export function stopAllPolling() {
    isPollingActive = false;
    //isWriting = false;
    state.lastSetHeader = "";
    if (state.activePollers) {
        state.activePollers.forEach(id => clearInterval(id));
        state.activePollers = [];
    }
    activeRequests.clear();
}

window.pollingManager = { startPolling, stopAllPolling, handleCanResponse };