// --- modules/pollingManager.js ---
import { state } from './state.js';
import { sendCanRequest, isIsotpActive } from './canProtocol.js';

let isPollingActive = false;
const activeRequests = new Map();

function logMessage(message) {
    console.log(`[Polling] ${message}`);
}

/**
 * Послідовне опитування (один запит за раз, чекаємо відповідь)
 * Обов'язково для ISO-TP multi-frame: новий запит перебиває CF потік
 */
async function startSequentialPolling(parameterKeys, registry, updateCallback) {
    logMessage("Запуск послідовного опитування...");
    isPollingActive = true;

    let currentIndex = 0;

    const pollNext = async () => {
        if (!isPollingActive || !state.isConnected) return;

        const key = parameterKeys[currentIndex];
        const paramGroup = registry[key];

        if (paramGroup?.request) {
            const { canId, data } = paramGroup.request;
            const responseCanId = paramGroup.response.canId;

            // Ключ = все після service code (перші 2 символи)
            // Для "220113" -> "0113", для "2141" -> "41"
            const expectedDid = data.substring(2).toUpperCase();

            const responseKey = `${responseCanId}:${expectedDid}`;

            activeRequests.set(responseKey, {
                id: key,
                updateCallback: updateCallback,
                parser: paramGroup.response.parser,
                expectedDid: expectedDid,
                // Callback який викличе наступний крок після отримання відповіді
                onComplete: () => {
                    currentIndex = (currentIndex + 1) % parameterKeys.length;
                    setTimeout(pollNext, 10);
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

    // Захисний таймер: якщо відповідь не прийшла, штовхаємо чергу далі
    const watchdog = setInterval(() => {
        if (!isPollingActive) {
            clearInterval(watchdog);
            return;
        }
        // НЕ штовхаємо чергу якщо ISO-TP збірка активна (чекаємо на CF)
        if (isIsotpActive()) return;

        // Якщо черга "зависла" (наприклад, пакет загубився)
        currentIndex = (currentIndex + 1) % parameterKeys.length;
        pollNext();
    }, 1500);

    if (!state.activePollers) state.activePollers = [];
    state.activePollers.push(watchdog);
}

export function startPolling(parameterKeys, registry, updateCallback) {
    stopAllPolling();
    if (!parameterKeys?.length) return;
    isPollingActive = true;

    logMessage(`Запуск опитування для ${parameterKeys.length} параметрів`);
    startSequentialPolling(parameterKeys, registry, updateCallback);
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

    // 2. ВИЗНАЧЕННЯ MODE (позитивна відповідь: 0x62 для сервісу 0x22, 0x61 для сервісу 0x21)
    const pciLength = parseInt(dataHex.substring(0, 2), 16);
    const responseMode = dataHex.substring(2, 4);
    console.log(`[handleCanResponse] PCI=${pciLength}, Mode=${responseMode}`);

    if (responseMode !== '62' && responseMode !== '61') {
        console.log(`[handleCanResponse] ВІДХИЛЕНО: режим не 62/61`);
        return;
    }

    // 3. Знаходимо контекст, порівнюючи DID з відповіді з очікуваним DID
    // Структура: [PCI][61/62][DID...][DATA...]
    let context = null;
    let responseKey = null;

    for (const [key, ctx] of activeRequests.entries()) {
        const expectedDid = ctx.expectedDid;
        if (!expectedDid) continue;

        const didLen = expectedDid.length;
        const responseDid = dataHex.substring(4, 4 + didLen).toUpperCase();

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
        const parser = context.parser;
        const id = context.id;

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
    state.lastSetHeader = "";
    if (state.activePollers) {
        state.activePollers.forEach(id => clearInterval(id));
        state.activePollers = [];
    }
    activeRequests.clear();
}

window.pollingManager = { startPolling, stopAllPolling, handleCanResponse };
