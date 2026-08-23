// --- modules/pollingManager.js ---
import { state } from './state.js';
import { sendCanRequest, isIsotpActive, msSinceLastSend } from './canProtocol.js';

let isPollingActive = false;
const activeRequests = new Map();

// Скільки промахів підряд робить параметр «мовчазним». DID, якого немає в
// прошивці ECU або який належить вузлу, відсутньому на шині (наприклад 0x12xx
// даху), тримає ELM зайнятим повний ATST32 на КОЖНОМУ колі. Кілька таких у
// списку — і цикл опитування складається з самих таймаутів.
const MISS_LIMIT = 3;
// Мовчазний параметр не викидаємо назовсім: вузол може зʼявитись на шині.
const RETRY_EVERY = 10;
const missCounts = new Map();
const skipCounts = new Map();

// Скільки чекати відповідь, перш ніж вважати запит загубленим. ATST32 = 200 мс
// таймауту самого ELM плюс запас на BLE-затримку і розбір ISO-TP.
const STALL_MS = 1200;

// Зростає на кожному startPolling: черги від попередніх сторінок мають вмерти.
let pollGeneration = 0;

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
    // Токен покоління: stopAllPolling() знімає прапорець, але вже запланований
    // setTimeout(pollNext) від попередньої сторінки міг спрацювати вже після
    // старту нової — і тоді дві черги пишуть в адаптер одночасно.
    const generation = ++pollGeneration;

    const advance = () => {
        currentIndex = (currentIndex + 1) % parameterKeys.length;
    };

    const pollNext = async () => {
        if (!isPollingActive || !state.isConnected) return;
        if (generation !== pollGeneration) return;

        // Мовчазні параметри пропускаємо більшість кіл, лишаючи рідку ретрай-спробу.
        // Перебираємо в циклі, а не рекурсією: інакше список, де мовчать усі,
        // розганяється в ланцюг таймерів.
        let key = parameterKeys[currentIndex];
        for (let skipped = 0; skipped < parameterKeys.length; skipped++) {
            if ((missCounts.get(key) || 0) < MISS_LIMIT) break;

            const seen = (skipCounts.get(key) || 0) + 1;
            if (seen >= RETRY_EVERY) {
                skipCounts.set(key, 0);
                break;
            }
            skipCounts.set(key, seen);
            advance();
            key = parameterKeys[currentIndex];
        }

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
                    if (generation !== pollGeneration) return;
                    missCounts.delete(key);
                    skipCounts.delete(key);
                    advance();
                    setTimeout(pollNext, 10);
                }
            });

            await sendCanRequest(canId, data);
        } else {
            // Якщо параметра немає в реєстрі, йдемо далі
            advance();
            pollNext();
        }
    };

    // Запускаємо перший запит
    pollNext();

    // Захисний таймер: якщо відповідь не прийшла, штовхаємо чергу далі.
    // Тікає частіше за поріг, але штовхає ЛИШЕ коли запит справді завис. Раніше
    // він рухав чергу за власним годинником, незалежно від onComplete: два
    // драйвери періодично збігались і друга команда йшла в ELM327, поки той ще
    // опитував шину — на клонах це ERR9x, ресет і ехо до кінця сесії.
    const watchdog = setInterval(() => {
        if (!isPollingActive || generation !== pollGeneration) {
            clearInterval(watchdog);
            return;
        }
        // НЕ штовхаємо чергу якщо ISO-TP збірка активна (чекаємо на CF)
        if (isIsotpActive()) return;

        // Запит ще в польоті — ELM має право доопитувати шину.
        if (msSinceLastSend() < STALL_MS) return;

        const stuckKey = parameterKeys[currentIndex];
        const misses = (missCounts.get(stuckKey) || 0) + 1;
        missCounts.set(stuckKey, misses);
        if (misses === MISS_LIMIT) {
            logMessage(`${stuckKey} не відповідає ${misses} рази — опитуємо рідше`);
        }

        advance();
        pollNext();
    }, 500);

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
    // Осиротілі pollNext, заплановані до зупинки, більше не пройдуть перевірку.
    pollGeneration++;
    state.lastSetHeader = "";
    if (state.activePollers) {
        state.activePollers.forEach(id => clearInterval(id));
        state.activePollers = [];
    }
    activeRequests.clear();
    // missCounts свідомо переживають зміну сторінки: вузол, якого немає на шині,
    // не зʼявляється від того, що користувач перемкнув вкладку. Успішна відповідь
    // або рідкий ретрай обнулять лічильник самі.
}

/**
 * Одноразове зчитування параметра по DID.
 * Повертає Promise з raw dataHex або null при таймауті.
 */
export function readSingleParam(readDid) {
    return new Promise(async (resolve) => {
        const expectedDid = readDid.substring(2).toUpperCase();
        const responseKey = `7BB:${expectedDid}`;

        const timeout = setTimeout(() => {
            activeRequests.delete(responseKey);
            resolve(null);
        }, 2000);

        activeRequests.set(responseKey, {
            id: 'preset_read',
            updateCallback: (_id, rawHex) => resolve(rawHex),
            parser: (dataHex) => {
                clearTimeout(timeout);
                return dataHex;
            },
            expectedDid: expectedDid,
            onComplete: () => {}
        });

        await sendCanRequest('79B', readDid);
    });
}

window.pollingManager = { startPolling, stopAllPolling, handleCanResponse, readSingleParam };
