// --- pollingManager.js (ПОВНІСТЮ ВИПРАВЛЕНИЙ) ---

import { state } from './state.js';
import { PARAMETER_REGISTRY } from './parameterRegistry.js';
import { PAGE_BINDINGS } from './pageBindings.js';
import { sendCanRequest } from './canProtocol.js';

//
// !!! ГОЛОВНЕ ВИПРАВЛЕННЯ: Ми більше не імпортуємо нічого з 'ui.js' !!!
//
// import { logMessage } from './ui.js'; // <--- РОЗІРВАЛИ ЦИКЛ
//

// Ми будемо використовувати console.log і додамо префікс для ясності.
function logMessage(message) {
    console.log(`[Polling] ${message}`);
}

// Це та сама мапа. Тепер вона буде ОДНА для всіх.
const activeRequests = new Map();

/**
 * Запускає опитування для конкретної сторінки
 */
export function startPollingForPage(pageFile) {
    stopAllPolling(); // Це також очистить activeRequests
    
    const parameterIds = PAGE_BINDINGS[pageFile];
    if (!parameterIds || parameterIds.length === 0) {
        logMessage(`Немає параметрів для опитування на сторінці ${pageFile}`);
        return;
    }
    
    // Цей лог ви вже бачили
    logMessage(`Запуск опитування для ${parameterIds.length} параметрів...`);
    
    const requestGroups = groupParametersByRequest(parameterIds);
    
    requestGroups.forEach(({ request, parameters }) => {
        // Запускаємо перший запит негайно
        sendRequestForParameters(request, parameters);
        
        // І створюємо інтервал для наступних
        const intervalId = setInterval(() => {
            sendRequestForParameters(request, parameters);
        }, request.interval);
        
        if (!state.activePollers) {
            state.activePollers = [];
        }
        state.activePollers.push(intervalId);
    });
}

/**
 * Групує параметри за однаковими запитами
 */
function groupParametersByRequest(parameterIds) {
    const groups = new Map();
    
    parameterIds.forEach(paramId => {
        const param = PARAMETER_REGISTRY[paramId];
        if (!param) {
            logMessage(`ПОПЕРЕДЖЕННЯ: Параметр "${paramId}" не знайдено в реєстрі`);
            return;
        }
        
        const key = `${param.request.canId}:${param.request.data}`;
        
        if (!groups.has(key)) {
            groups.set(key, {
                request: param.request,
                parameters: []
            });
        }
        
        groups.get(key).parameters.push({
            id: paramId,
            ...param
        });
    });
    
    return Array.from(groups.values());
}

/**
 * Надсилає запит і реєструє параметри (З виправленням "гонки станів")
 */
async function sendRequestForParameters(request, parameters) {
    
    // 1. СПОЧАТКУ РЕЄСТРУЄМО СЛУХАЧА
    parameters.forEach(param => {
        const responseId = param.response.canId;
        
        if (!activeRequests.has(responseId)) {
            activeRequests.set(responseId, []);
        }
        
        const existing = activeRequests.get(responseId);
        const filtered = existing.filter(p => p.id !== param.id);
        filtered.push(param);
        activeRequests.set(responseId, filtered);
    });
    
    logMessage(`Зареєстровано слухачів для: ${parameters.map(p => p.id).join(', ')} (чекають на ${parameters[0].response.canId})`);

    // 2. ПОТІМ ВІДПРАВЛЯЄМО ЗАПИТ
    const success = await sendCanRequest(request.canId, request.data);
    
    if (!success) {
        logMessage(`ПОМИЛКА: не вдалося відправити запит для ${request.canId}`);
    }
}

/**
 * Обробляє вхідну CAN-відповідь
 */
export function handleCanResponse(canId, dataHex) {
    logMessage(`[HANDLE] Отримано CAN ID: ${canId}, Data: ${dataHex}`);
    
    const waitingParams = activeRequests.get(canId);
    
    logMessage(`[HANDLE] Параметрів в черзі для ID ${canId}: ${waitingParams ? waitingParams.length : 0}`);
    
    if (!waitingParams || waitingParams.length === 0) {
        logMessage(`[HANDLE] Немає параметрів, що чекають на ID ${canId}`);
        return;
    }
    
    logMessage(`[CAN ✓] ID: ${canId} | Data: ${dataHex}`);
    
    waitingParams.forEach(param => {
        try {
            logMessage(`[PARSE PARAM] Парсинг параметра: ${param.id}`);
            const parsedValue = param.response.parser(dataHex);
            logMessage(`[PARSE PARAM ✓] ${param.id} = ${JSON.stringify(parsedValue)}`);
            updateUIForParameter(param, parsedValue);
        } catch (e) {
            logMessage(`[PARSE PARAM ✗] Помилка парсингу ${param.id}: ${e.message}`);
            console.error(e);
        }
    });
}

/**
 * Оновлює UI для параметра (внутрішня функція)
 */
function updateUIForParameter(param, value) {
    const uiElement = param.uiElement;
    
    if (typeof uiElement === 'string') {
        const element = document.getElementById(uiElement);
        if (element) {
            const displayValue = param.response.formatter 
                ? param.response.formatter(value) 
                : (value !== null ? value.toString() : 'N/A');
            element.value = displayValue;
        } else {
            logMessage(`ПОМИЛКА UI: Елемент не знайдено: ${uiElement}`);
        }
    }
    else if (typeof uiElement === 'object' && value !== null) {
        Object.keys(uiElement).forEach(key => {
            const elementId = uiElement[key];
            const element = document.getElementById(elementId);
            if (element && value[key] !== undefined) {
                element.value = value[key];
            } else if (!element) {
                logMessage(`ПОМИЛКА UI: Елемент не знайдено: ${elementId}`);
            }
        });
    }
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
    
    // Це ключ: очищуємо мапу ТІЛЬКИ коли зупиняємо все
    activeRequests.clear();
}