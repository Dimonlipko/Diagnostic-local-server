import { state } from './state.js';
import { logMessage, updateConnectionTabs } from './ui.js';
import { parseCanResponse } from './canProtocol.js';

// Глобальний буфер для зклеювання розірваних BLE пакетів
let bleBuffer = "";

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

        state.writer = {
            write: async (text) => {
                const encoder = new TextEncoder();
                const command = text.endsWith('\r') ? text : text + '\r';
                const data = encoder.encode(command);
                
                if (window.uiUpdater && window.uiUpdater.flashAdapterLed) {
                    window.uiUpdater.flashAdapterLed();
                }

                await charWrite.writeValueWithoutResponse(data);
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
                        if (parsed && parsed.id && parsed.data && window.pollingManager) {
                            window.pollingManager.handleCanResponse(parsed.id, parsed.data);
                        }
                    }
                }
                // Очищуємо буфер після обробки повної відповіді
                bleBuffer = ""; 
            }

            if (window.uiUpdater && window.uiUpdater.flashCanLed) {
                window.uiUpdater.flashCanLed();
            }
        });

        // --- КРОК ІНІЦІАЛІЗАЦІЇ ---
        logMessage("Ініціалізація ELM327...");

        const initCommands = [
            { cmd: "ATZ", desc: "Скидання адаптера", wait: 1200 },
            { cmd: "ATE0", desc: "Вимкнення ехо", wait: 500 },
            { cmd: "ATL0", desc: "Вимкнення переносів (Linefeeds)", wait: 300 },
            { cmd: "ATH1", desc: "Заголовки (ID) ON", wait: 300 },
            { cmd: "ATSP6", desc: "Встановлення протоколу CAN", wait: 400 },
            { cmd: "ATST10", desc: "Adaptive Timeout (Fast)", wait: 100 },
            { cmd: "ATSH79B", desc: "Встановлення ID запиту", wait: 300 }
        ];

        for (const item of initCommands) {
            logMessage(`[INIT] ${item.desc}...`);
            await state.writer.write(item.cmd);
            await new Promise(r => setTimeout(r, item.wait));
        }

        state.isConnected = true;
        updateConnectionTabs();
        logMessage("✓ BLE підключено та налаштовано!");

        const activePageButton = document.querySelector('.sidebar .nav-button.active');
        if (activePageButton) activePageButton.click();

        return true;
    } catch (error) {
        logMessage(`BLE Помилка: ${error.message}`);
        state.isConnected = false;
        return false;
    }
}