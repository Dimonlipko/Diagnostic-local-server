// --- pollingManager.js (ПОВНІСТЮ ОНОВЛЕНИЙ) ---

import { state } from './state.js';
import { sendCanRequest } from './canProtocol.js';

// Глобальна мапа для активних запитів (слухачів)
// Ключ тепер буде "responseCanId:requestPid" (напр. "7BB:220301")
const activeRequests = new Map();

function logMessage(message) {
    console.log(`[Polling] ${message}`);
}

/**
 * Запускає опитування на основі списку ключів, зібраних з DOM.
 * @param {string[]} parameterKeys - Масив кореневих ключів (напр. 'inverter_info_220301')
 * @param {object} registry - Повний PARAMETER_REGISTRY
 * @param {function} updateCallback - Функція оновлення UI (напр. window.uiUpdater.updateUiValue)
 */
function startPolling(parameterKeys, registry, updateCallback) {
    stopAllPolling(); // Це також очистить activeRequests
    
    if (!registry) {
        logMessage("ПОМИЛКА: Реєстр параметрів (PARAMETER_REGISTRY) не передано.");
        return;
    }
    if (!updateCallback) {
        logMessage("ПОМИЛКА: Функцію оновлення UI (updateCallback) не передано.");
        return;
    }
    if (!parameterKeys || parameterKeys.length === 0) {
        logMessage(`Немає параметрів для опитування.`);
        return;
    }
    
    logMessage(`Запуск опитування для ${parameterKeys.length} ключів...`);

    const requestGroups = groupParametersByRequest(parameterKeys, registry);
    
    // --- 💡 ПОЧАТОК ЗМІН ---
    // Створюємо "шаховий" старт, щоб вони не билися
    // Чим менше інтервал, тим щільніше вони будуть, але 50мс - безпечно
    const staggerInterval = 50; 

    requestGroups.forEach((group, index) => {
        const { request, parameters } = group;
        const paramId = parameters[0].id; // Напр. 'inverter_info_220301'

        const handlerContext = {
            request: request,
            parameters: parameters, 
            updateCallback: updateCallback
        };

        // Розраховуємо затримку старту для КОЖНОГО таймера
        const startDelay = index * staggerInterval;

        // Запускаємо інтервал не одразу, а з затримкою
        setTimeout(() => {
            logMessage(`[Polling] Старт таймера для ${paramId} (інтервал: ${request.interval}ms)`);
            
            // Запускаємо перший запит негайно (після нашої затримки)
            sendRequestForParameters(handlerContext);
            
            // І створюємо інтервал для наступних
            const intervalId = setInterval(() => {
                sendRequestForParameters(handlerContext);
            }, request.interval);
            
            if (!state.activePollers) {
                state.activePollers = [];
            }
            state.activePollers.push(intervalId);

        }, startDelay); // 👈 Ось тут і є вся магія!

    });
    // --- 💡 КІНЕЦЬ ЗМІН ---
}

/**
 * Групує параметри за однаковими запитами (для data-bind)
 */
function groupParametersByRequest(parameterKeys, registry) {
    const groups = new Map();
    
    parameterKeys.forEach(key => {
        const paramGroup = registry[key];
        if (!paramGroup) {
            logMessage(`ПОПЕРЕДЖЕННЯ: Параметр "${key}" не знайдено в реєстрі`);
            return;
        }
        
        // Переконуємось, що це група для опитування (має 'request')
        if (!paramGroup.request) {
            return;
        }

        // Використовуємо сам ключ групи як унікальний
        if (!groups.has(key)) {
            groups.set(key, {
                request: paramGroup.request,
                parameters: [{
                    id: key, // 'inverter_info_220301'
                    ...paramGroup
                }]
            });
        }
    });
    
    return Array.from(groups.values());
}

/**
 * Надсилає запит і реєструє параметри
 */
async function sendRequestForParameters(context) {
    const { request } = context;

    // 'parameters' - це масив, що містить одну групу (напр. 'inverter_info_220301')
    const paramGroup = context.parameters[0];
    const responseCanId = paramGroup.response.canId; // '7BB'
    const requestPid = paramGroup.request.data;     // '220301'
    
    // 1. РЕЄСТРУЄМО СЛУХАЧА ПІД УНІКАЛЬНИМ КЛЮЧЕМ
    // Ключ = "ID_Відповіді:PID_Запиту" (напр. "7BB:220301")
    const responseKey = `${responseCanId}:${requestPid}`;

    // Ми не перевіряємо, чи існує ключ. Ми просто перезаписуємо
    // контекст очікування щоразу, коли надсилаємо запит.
    // Це гарантує, що ми чекаємо на відповідь саме на *цей* запит.
    activeRequests.set(responseKey, context);
    
    // logMessage(`Зареєстровано слухача для: ${responseKey}`);

    // 2. ПОТІМ ВІДПРАВЛЯЄМО ЗАПИТ
    const success = await sendCanRequest(request.canId, request.data);
    
    if (!success) {
        logMessage(`ПОМИЛКА: не вдалося відправити запит для ${request.canId} (${requestPid})`);
        // Якщо не вдалося відправити, видаляємо слухача, щоб він не висів вічно
        activeRequests.delete(responseKey);
    }
}

/**
 * Обробляє вхідну CAN-відповідь
 * Ця функція має викликатися вашим головним CAN-обробником
 */
export function handleCanResponse(canId, dataHex) {
    // canId = '7BB'
    // dataHex = '0762030300000168'
    
    // Це відповідь UDS (ISO-15765). Нам потрібно витягти PID.
    // "62" - це відповідь на "22" (0x22 + 0x40 = 0x62)
    // "0303" - це PID, який ми запитували.
    
    if (dataHex.length < 8) { // Потрібно принаймні "07620301"
        return; 
    }

    const responseMode = dataHex.substring(2, 4).toUpperCase(); // "62"
    const responsePid = dataHex.substring(4, 8).toUpperCase();  // "0301" or "0303"
    
    let requestPid;
    
    // Конвертуємо "62" -> "22"
    if (responseMode === '62') {
        requestPid = '22' + responsePid;
    } else {
        // Додайте тут інші правила, якщо вони потрібні
        // logMessage(`Невідомий режим відповіді: ${responseMode}`);
        return; 
    }

    // Створюємо той самий унікальний ключ, що й у sendRequestForParameters
    const responseKey = `${canId}:${requestPid}`; // "7BB:220301"
    
    // Шукаємо *конкретного* слухача
    const context = activeRequests.get(responseKey);
    
    if (!context) {
        // Немає слухача для цієї відповіді. Це нормально.
        // Можливо, це відповідь, на яку ми вже не чекаємо, або "шум".
        return;
    }
    
    logMessage(`[CAN ✓] ID: ${canId} | Key: ${responseKey} | Data: ${dataHex}`);
    
    // Ми знайшли ОДИН правильний контекст
    const paramGroup = context.parameters[0]; // напр. 'inverter_info_220301'
    
    try {
        const parsedValue = paramGroup.response.parser(dataHex);
        
        if (parsedValue !== null) {
            // Викликаємо callback (який є window.uiUpdater.updateUiValue)
            context.updateCallback(paramGroup.id, parsedValue);
        }

    } catch (e) {
        logMessage(`[PARSE PARAM ✗] Помилка парсингу ${paramGroup.id} (key: ${responseKey}): ${e.message}`);
        console.error(e);
    }
    
    // Очищуємо ТІЛЬКИ ЦЬОГО слухача
    activeRequests.delete(responseKey);
}

/**
 * Зупиняє всі активні опитування
 */
export function stopAllPolling() {
    if (!state.activePollers) {
        state.activePollers = [];
    }
    
    if (state.activePollers.length > 0) {
        logMessage("Зупинка опитування...");
        state.activePollers.forEach(timerId => clearInterval(timerId));
        state.activePollers = [];
    }
    
    activeRequests.clear();
}

// --- ГОЛОВНЕ ---
window.pollingManager = {
    startPolling: startPolling,
    stopAllPolling: stopAllPolling,
    handleCanResponse: handleCanResponse
};