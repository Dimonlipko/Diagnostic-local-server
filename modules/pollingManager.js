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

            // Ключ = все після "22" (service code)
            // Для "22011200" -> ключ "011200"
            // Для "220113" -> ключ "0113"
            const expectedDid = data.substring(2).toUpperCase();

            const responseKey = `${responseCanId}:${expectedDid}`;

            activeRequests.set(responseKey, {
                id: key,
                updateCallback: updateCallback,
                parser: paramGroup.response.parser,
                expectedDid: expectedDid, // Зберігаємо очікуваний DID для порівняння
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

    // Ключ = все після "22" (service code)
    const expectedDid = request.data.substring(2).toUpperCase();

    // Формуємо ключ для Classic Serial
    const responseKey = `${param.response.canId}:${expectedDid}`;

    // Додаємо expectedDid до контексту
    context.expectedDid = expectedDid;

    activeRequests.set(responseKey, context);
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
    console.log(`[handleCanResponse] ВИКЛИКАНО: canId=${canId}, dataHex=${dataHex}`);

    // 1. ПЕРЕВІРКА НА СМІТТЯ
    if (!dataHex || dataHex.length < 8) {
        console.log(`[handleCanResponse] ВІДХИЛЕНО: довжина ${dataHex?.length} < 8`);
        return;
    }

    // 2. ВИЗНАЧЕННЯ MODE (має бути позитивна відповідь 0x62)
    const pciLength = parseInt(dataHex.substring(0, 2), 16);
    const responseMode = dataHex.substring(2, 4);
    console.log(`[handleCanResponse] PCI=${pciLength}, Mode=${responseMode}`);

    if (responseMode !== '62') {
        console.log(`[handleCanResponse] ВІДХИЛЕНО: режим не 62`);
        return;
    }

    // 3. Витягуємо весь PID з відповіді
    // Структура: [PCI][62][PID...][DATA...]
    // Для 220107: "0462220107XXYY" або "07622201070XXYY"
    // Для 220113: "04620113XX"
    // Для 22011200: "076201120000XXYY"

    // Знаходимо всі можливі співпадіння ключів
    let context = null;
    let responseKey = null;

    // Знаходимо контекст, порівнюючи DID з відповіді з очікуваним DID
    for (const [key, ctx] of activeRequests.entries()) {
        const expectedDid = ctx.expectedDid;
        if (!expectedDid) continue;

        // Витягуємо DID з відповіді (після PCI та response code '62')
        // Структура: [PCI][62][DID...][DATA...]
        const didLen = expectedDid.length; // 4 символи (2 байти) або 6 символів (3 байти)
        const responseDid = dataHex.substring(4, 4 + didLen).toUpperCase();

        // Порівнюємо точно DID
        if (responseDid === expectedDid) {
            context = ctx;
            responseKey = key;
            logMessage(`[CAN ✓] Знайдено контекст: ${responseKey} (DID: ${responseDid})`);
            break;
        }
    }

    if (!context) {
        console.log(`[Polling] Контекст не знайдено для відповіді від ${canId}, dataHex=${dataHex}`);
        return;
    }
    
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