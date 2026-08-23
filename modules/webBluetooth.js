import { state } from './state.js';
import { logMessage, updateConnectionTabs } from './ui.js';
import { parseCanResponse, sendPendingFlowControl, notePrompt, resetPromptGate } from './canProtocol.js';
import { resetReinitState } from './elmInit.js';
import {
    noteRxActivity, noteTxActivity,
    startLinkWatchdog, stopLinkWatchdog, handleLinkLost
} from './linkStatus.js';

// Глобальний буфер для зклеювання розірваних BLE пакетів
let bleBuffer = "";

// Поки не null — триває проба GATT-каналу: сирі дані не парсяться як CAN,
// а накопичуються тут, щоб зрозуміти, яка пара характеристик жива.
let probeBuffer = null;

// Обрана notify-характеристика для прийому та час останнього пакета з неї.
// Поки вона говорить, пакети з інших вважаються дублями того ж UART.
let rxChar = null;
let lastRxAt = 0;
const RX_STICKY_MS = 2000;

// Допоміжна функція затримки
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Відомі сервіси BLE-клонів ELM327. Web Bluetooth віддає у getPrimaryServices()
// ЛИШЕ те, що перелічене тут або у filters, тож список має бути повним.
const KNOWN_SERVICES = [
    0xFFF0,                                   // vLinker, більшість дешевих клонів
    0xFFE0,                                   // HM-10 / Vgate iCar Pro BLE
    0xFFE5,                                   // HM-10 варіант із роздільним write-сервісом
    0x18F0,                                   // частина OBDII BLE модулів
    0xFEE7,                                   // Telink-клони
    '6e400001-b5a3-f393-e0a9-e50e24dcca9e'    // Nordic UART Service
];

// Порядок перебору кандидатів на запис: спершу канонічні UART-характеристики.
const WRITE_PREFERENCE = ['fff2', 'ffe1', 'ffe9', '2af1', 'fff1', '6e400002'];

function charLabel(ch) {
    // 16-бітні UUID приходять як 0000fff2-0000-1000-8000-00805f9b34fb
    return /^0000[0-9a-f]{4}-0000-1000-8000-00805f9b34fb$/.test(ch.uuid)
        ? '0x' + ch.uuid.slice(4, 8).toUpperCase()
        : ch.uuid;
}

function shortUuid(ch) {
    return ch.uuid.startsWith('0000') ? ch.uuid.slice(4, 8) : ch.uuid.split('-')[0];
}

function propsLabel(p) {
    const flags = [];
    if (p.notify) flags.push('notify');
    if (p.indicate) flags.push('indicate');
    if (p.write) flags.push('write');
    if (p.writeWithoutResponse) flags.push('writeNR');
    if (p.read) flags.push('read');
    return flags.join(',') || '—';
}

// Низькорівневий запис у конкретну характеристику обраним методом.
// BLE MTU за замовчуванням 23 байти (20 корисних), тож ріжемо довгі команди.
async function rawWrite(candidate, text) {
    const data = new TextEncoder().encode(text);
    for (let offset = 0; offset < data.length; offset += 20) {
        const chunk = data.slice(offset, offset + 20);
        if (candidate.mode === 'writeNR' && candidate.char.writeValueWithoutResponse) {
            await candidate.char.writeValueWithoutResponse(chunk);
        } else if (candidate.char.writeValueWithResponse) {
            await candidate.char.writeValueWithResponse(chunk);
        } else {
            await candidate.char.writeValue(chunk);
        }
        if (data.length > 20) await sleep(10);
    }
}

// Обробка вхідного шматка даних: під час проби — тільки накопичення,
// у робочому режимі — збірка до '>' і розбір CAN-кадрів.
function handleChunk(chunk) {
    noteRxActivity();

    // Prompt-gate ведемо до всіх фільтрів: '>' — це дозвіл на наступну команду
    // незалежно від того, хто зараз споживає потік.
    if (chunk.includes('>')) notePrompt();

    // Під час OTA сирі кадри забирає firmwareUpdate.js: ack блоку — це 2 байти,
    // штатний ISO-TP парсер такого не розбирає.
    if (state.rawChunkSink) {
        state.rawChunkSink(chunk);
        return;
    }

    if (probeBuffer !== null) {
        probeBuffer += chunk;
        return;
    }

    bleBuffer += chunk;

    // ELM327 сигналізує про кінець відповіді символом ">"
    // Обробляємо тільки до першого ">", залишок зберігаємо для наступного циклу
    if (bleBuffer.includes('>')) {
        const promptIdx = bleBuffer.indexOf('>');
        const toProcess = bleBuffer.substring(0, promptIdx);
        bleBuffer = bleBuffer.substring(promptIdx + 1);

        const parts = toProcess.split('\r');
        for (let part of parts) {
            const cleanLine = part.trim().toUpperCase();
            if (cleanLine && cleanLine !== 'OK' && !cleanLine.startsWith('AT')) {
                const parsed = parseCanResponse(cleanLine);
                if (parsed && parsed.id && parsed.data && window.pollingManager) {
                    window.pollingManager.handleCanResponse(parsed.id, parsed.data);
                }
            }
        }

        // ISO-TP: відправляємо FC якщо збірка потребує ще CF
        sendPendingFlowControl();
    }
}

// Шле ATI і чекає будь-яку відповідь. Повертає true, якщо канал живий.
async function probeCandidate(candidate, timeoutMs = 1500) {
    probeBuffer = "";
    try {
        await rawWrite(candidate, "ATI\r");
    } catch (e) {
        logMessage(`  ✗ ${candidate.label}: запис відхилено (${e.message})`);
        probeBuffer = null;
        return false;
    }

    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        if (probeBuffer.includes('>')) break;
        await sleep(50);
    }

    const answer = probeBuffer.replace(/[\r\n>]+/g, ' ').trim();
    probeBuffer = null;

    if (answer.length > 0) {
        logMessage(`  ✓ ${candidate.label}: відповідь [${answer}]`);
        return true;
    }
    logMessage(`  ✗ ${candidate.label}: тиша`);
    return false;
}

export async function connectBleAdapter() {
    let notifyChars = [];

    try {
        logMessage("Пошук BLE пристроїв...");
        const device = await navigator.bluetooth.requestDevice({
            filters: KNOWN_SERVICES.map(s => ({ services: [s] })),
            optionalServices: KNOWN_SERVICES
        });

        logMessage(`Підключення до ${device.name}...`);

        // Вішаємо ДО connect: якщо адаптер зникне (живлення, дальність, розряд),
        // подія прилетить і UI не залишиться у фальшивому «підключено».
        device.addEventListener('gattserverdisconnected', () => {
            handleLinkLost('BLE-пристрій відключився');
        });

        const server = await device.gatt.connect();

        // --- РОЗВІДКА GATT ---
        // Різні ревізії клонів кладуть UART на різні сервіси і міняють місцями
        // notify/write, тому профіль визначаємо, а не припускаємо.
        const services = await server.getPrimaryServices();
        const allChars = [];
        for (const svc of services) {
            for (const ch of await svc.getCharacteristics()) allChars.push(ch);
        }

        logMessage(`GATT: ${services.length} сервіс(ів), ${allChars.length} характеристик`);
        for (const ch of allChars) {
            logMessage(`  ${charLabel(ch)} [${propsLabel(ch.properties)}]`);
        }

        notifyChars = allChars.filter(c => c.properties.notify || c.properties.indicate);
        if (notifyChars.length === 0) {
            throw new Error("у пристрою немає характеристики з notify — це не UART-профіль");
        }

        // Кандидати на запис: кожна характеристика × кожен підтримуваний метод.
        const candidates = [];
        for (const ch of allChars) {
            if (ch.properties.writeWithoutResponse) {
                candidates.push({ char: ch, mode: 'writeNR', label: `${charLabel(ch)} writeNR` });
            }
            if (ch.properties.write) {
                candidates.push({ char: ch, mode: 'write', label: `${charLabel(ch)} write` });
            }
        }
        if (candidates.length === 0) {
            throw new Error("у пристрою немає характеристики для запису");
        }

        candidates.sort((a, b) => {
            const ra = WRITE_PREFERENCE.indexOf(shortUuid(a.char));
            const rb = WRITE_PREFERENCE.indexOf(shortUuid(b.char));
            return (ra < 0 ? 99 : ra) - (rb < 0 ? 99 : rb);
        });

        // Слухаємо ВСІ notify-характеристики, доки не зрозуміємо, яка відповідає.
        // Джерело останнього пакета запамʼятовуємо: саме воно — робочий RX-канал,
        // і воно не обовʼязково збігається з характеристикою запису.
        let activeNotify = null;
        const onValue = (event) => {
            // Клон із кількома notify віддає той самий UART на кожну, і буфер
            // склеїв би подвоєний текст. Тому приймаємо лише з обраного каналу —
            // але підписки не рвемо: якщо здогадка хибна і обраний замовк,
            // наступний пакет з іншої характеристики перебирає роль RX на себе.
            if (rxChar && event.target !== rxChar) {
                if (Date.now() - lastRxAt < RX_STICKY_MS) return; // обраний живий → це дубль
                rxChar = event.target;
                logMessage(`  RX-канал перемкнуто на ${charLabel(rxChar)}`);
            }
            lastRxAt = Date.now();

            activeNotify = event.target;
            handleChunk(new TextDecoder().decode(event.target.value));
            if (window.uiUpdater && window.uiUpdater.flashCanLed) {
                window.uiUpdater.flashCanLed();
            }
        };
        for (const ch of notifyChars) {
            await ch.startNotifications();
            ch.addEventListener('characteristicvaluechanged', onValue);
        }

        logMessage("Стабілізація з'єднання...");
        await sleep(500); // Даємо час GATT стабілізуватися перед пробою

        // --- ПРОБА КАНАЛУ ---
        logMessage(`Перевірка каналу (${candidates.length} варіант(ів))...`);
        let chosen = null;
        for (let pass = 1; pass <= 2 && !chosen; pass++) {
            if (pass === 2) {
                // Частина клонів після GATT-конекту прокидається не миттєво.
                // Другий прохід дешевший за хибний вердикт «адаптер німий».
                logMessage("Повторна спроба після паузи...");
                await sleep(1000);
            }
            for (const candidate of candidates) {
                if (await probeCandidate(candidate)) {
                    chosen = candidate;
                    break;
                }
                await sleep(150);
            }
        }

        if (!chosen) {
            throw new Error("жодна характеристика не відповіла на ATI — адаптер не приймає команди");
        }
        logMessage(`✓ Робочий канал: ${chosen.label}`);

        // Дублі відсікаємо за джерелом, а не відпискою: stopNotifications() на
        // частині клонів гасить CCCD так, що прийом не повертається взагалі, а
        // характеристика, яка відповіла на пробу, не завжди та, якою потім
        // приходять дані. Фіксуємо канал м'яко — onValue вміє перемкнутися.
        if (activeNotify && notifyChars.length > 1) {
            rxChar = activeNotify;
            lastRxAt = Date.now();
            logMessage(`  RX-канал: ${charLabel(rxChar)} (решта ${notifyChars.length - 1} у резерві)`);
        }

        state.connectionType = 'ble';
        state.bleDevice = device;
        bleBuffer = "";

        // Налаштування "письменника" з логікою повторних спроб
        state.writer = {
            write: async (text) => {
                const command = text.endsWith('\r') ? text : text + '\r';

                if (window.uiUpdater && window.uiUpdater.flashAdapterLed) {
                    window.uiUpdater.flashAdapterLed();
                }
                noteTxActivity();

                // Логіка Retry для стабільності (вирішує GATT busy)
                let retries = 3;
                while (retries > 0) {
                    try {
                        if (chosen.char.service.device.gatt.connected) {
                            await rawWrite(chosen, command);
                        } else {
                            console.warn("BLE Write skipped: disconnected");
                        }
                        return; // Успіх - виходимо
                    } catch (e) {
                        console.warn(`BLE Write failed (${retries}): ${e.message}`);
                        retries--;
                        if (retries === 0) throw e; // Якщо спроби вичерпані - кидаємо помилку далі
                        await sleep(150); // Чекаємо перед наступною спробою
                    }
                }
            }
        };

        // --- КРОК ІНІЦІАЛІЗАЦІЇ ---
        logMessage("Ініціалізація ELM327...");

        const initCommands = [
            { cmd: "ATZ", desc: "Скидання адаптера", wait: 1200 },
            { cmd: "ATE0", desc: "Вимкнення ехо", wait: 500 },
            { cmd: "ATL0", desc: "Вимкнення переносів (Linefeeds)", wait: 300 },
            { cmd: "ATH1", desc: "Заголовки (ID) ON", wait: 300 },
            { cmd: "ATS0", desc: "Пробіли OFF", wait: 100 },
            { cmd: "ATSP6", desc: "Встановлення протоколу CAN", wait: 400 },
            { cmd: "ATCAF0", desc: "CAN Auto Formatting OFF", wait: 300 },
            { cmd: "ATAL", desc: "Allow Long messages", wait: 300 },
            { cmd: "ATCRA7BB", desc: "CAN Receive Address = 7BB", wait: 300 },
            { cmd: "ATSH79B", desc: "Встановлення ID запиту", wait: 300 },
            { cmd: "ATST32", desc: "Timeout 200ms (для ISO-TP CF)", wait: 100 }
        ];

        for (const item of initCommands) {
            logMessage(`[INIT] ${item.desc}...`);
            await state.writer.write(item.cmd);
            await sleep(item.wait);
        }

        // Init ішов повз чергу — вирівнюємо gate перед стартом опитування.
        resetPromptGate();
        resetReinitState();

        state.isConnected = true;
        startLinkWatchdog();
        updateConnectionTabs();
        logMessage("✓ BLE підключено та налаштовано!");

        const activePageButton = document.querySelector('.sidebar .nav-button.active');
        if (activePageButton) activePageButton.click();

        return true;
    } catch (error) {
        logMessage(`BLE Помилка: ${error.message}`);

        // Спробуємо коректно відключитись при помилці ініціалізації
        if (state.bleDevice && state.bleDevice.gatt.connected) {
            state.bleDevice.gatt.disconnect();
        }

        probeBuffer = null;
        rxChar = null;
        lastRxAt = 0;
        state.isConnected = false;
        return false;
    }
}

// --- НОВА ФУНКЦІЯ ВІДКЛЮЧЕННЯ ---
export async function disconnectBleAdapter() {
    try {
        stopLinkWatchdog();

        if (state.bleDevice && state.bleDevice.gatt && state.bleDevice.gatt.connected) {
            logMessage("Відключення BLE...");
            state.bleDevice.gatt.disconnect();
        } else {
            // Якщо вже відключено або не знайдено, просто логуємо
            // logMessage("BLE вже відключено.");
        }

        // Скидання стану
        state.isConnected = false;
        state.connectionType = null;
        state.bleDevice = null;
        state.writer = null;
        bleBuffer = "";
        probeBuffer = null;
        rxChar = null;
        lastRxAt = 0;
        resetPromptGate();

        updateConnectionTabs();
        logMessage("BLE Відключено.");

        // Примусове оновлення кнопки в UI, якщо updateConnectionTabs цього не робить
        const btnBle = document.getElementById('btnConnectBle');
        if (btnBle) btnBle.classList.remove('active');

    } catch (error) {
        logMessage(`Помилка відключення BLE: ${error.message}`);
        console.error(error);
    }
}
