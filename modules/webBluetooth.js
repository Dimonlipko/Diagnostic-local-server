import { state } from './state.js';
import { logMessage, updateConnectionTabs } from './ui.js';
import { parseCanResponse, sendPendingFlowControl } from './canProtocol.js';

// Глобальний буфер для зклеювання розірваних BLE пакетів
let bleBuffer = "";

// Допоміжна функція затримки
const sleep = (ms) => new Promise(r => setTimeout(r, ms));

export async function connectBleAdapter() {
    try {
        logMessage("Пошук BLE пристроїв...");
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [0xFFF0] }],
            optionalServices: [0xFFF0]
        });

        logMessage(`Підключення до ${device.name}...`);
        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(0xFFF0);

        const charRead = await service.getCharacteristic(0xFFF1);
        const charWrite = await service.getCharacteristic(0xFFF2);

        state.connectionType = 'ble';
        state.bleDevice = device;
        bleBuffer = ""; // Очищуємо буфер при новому підключенні

        // Налаштування "письменника" з логікою повторних спроб
        state.writer = {
            write: async (text) => {
                const encoder = new TextEncoder();
                const command = text.endsWith('\r') ? text : text + '\r';
                const data = encoder.encode(command);
                
                if (window.uiUpdater && window.uiUpdater.flashAdapterLed) {
                    window.uiUpdater.flashAdapterLed();
                }

                // Логіка Retry для стабільності (вирішує GATT busy)
                let retries = 3;
                while (retries > 0) {
                    try {
                        if (charWrite.service.device.gatt.connected) {
                            await charWrite.writeValueWithoutResponse(data);
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

        await charRead.startNotifications();
        
        // --- ОБРОБНИК ВХІДНИХ ДАНИХ З БУФЕРОМ ---
        charRead.addEventListener('characteristicvaluechanged', (event) => {
            const decoder = new TextDecoder();
            const chunk = decoder.decode(event.target.value);
            
            // Накопичуємо дані в буфер
            bleBuffer += chunk;

            // ELM327 сигналізує про кінець відповіді символом ">"
            if (bleBuffer.includes('>')) {
                const parts = bleBuffer.split('\r');
                
                for (let part of parts) {
                    // Очищаємо від службових символів
                    const cleanLine = part.replace(/>/g, '').trim().toUpperCase();

                    if (cleanLine && cleanLine !== 'OK' && !cleanLine.startsWith('AT')) {
                        const parsed = parseCanResponse(cleanLine);
                        console.log(`[BLE Debug] parsed=${JSON.stringify(parsed)}, pollingManager=${!!window.pollingManager}`);

                        if (parsed && parsed.id && parsed.data && window.pollingManager) {
                            console.log(`[BLE Debug] Викликаємо handleCanResponse(${parsed.id}, ${parsed.data})`);
                            window.pollingManager.handleCanResponse(parsed.id, parsed.data);
                        } else {
                            console.log(`[BLE Debug] НЕ викликаємо handleCanResponse: parsed=${!!parsed}, id=${!!parsed?.id}, data=${!!parsed?.data}, pollingManager=${!!window.pollingManager}`);
                        }
                    }
                }
                // Очищуємо буфер після обробки повної відповіді
                bleBuffer = "";

                // ISO-TP fallback: відправляємо ручний FC якщо потрібен
                sendPendingFlowControl();
            }

            if (window.uiUpdater && window.uiUpdater.flashCanLed) {
                window.uiUpdater.flashCanLed();
            }
        });

        // --- КРОК ІНІЦІАЛІЗАЦІЇ ---
        logMessage("Стабілізація з'єднання...");
        await sleep(500); // Даємо час GATT стабілізуватися перед інітом

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

        state.isConnected = true;
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
        
        state.isConnected = false;
        return false;
    }
}

// --- НОВА ФУНКЦІЯ ВІДКЛЮЧЕННЯ ---
export async function disconnectBleAdapter() {
    try {
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