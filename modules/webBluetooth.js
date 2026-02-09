// modules/webBluetooth.js
import { state } from './state.js';
import { logMessage, updateConnectionTabs } from './ui.js';
import { parseCanResponse } from './canProtocol.js';

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

        // Налаштовуємо канали згідно з тестом
        const charRead = await service.getCharacteristic(0xFFF1);  // fff1 для вхідних даних
        const charWrite = await service.getCharacteristic(0xFFF2); // fff2 для вихідних команд

        state.connectionType = 'ble';
        state.bleDevice = device;

        // Створюємо універсальний writer
        state.writer = {
            write: async (text) => {
                const encoder = new TextEncoder();
                const data = encoder.encode(text);
                
                // 💡 ІНДИКАТОР АДАПТЕРА (TX)
                if (window.uiUpdater && window.uiUpdater.flashAdapterLed) {
                    window.uiUpdater.flashAdapterLed();
                }

                await charWrite.writeValueWithoutResponse(data);
            }
        };

        // Вмикаємо прослуховування fff1
        await charRead.startNotifications();
        charRead.addEventListener('characteristicvaluechanged', (event) => {
            const decoder = new TextDecoder();
            const value = decoder.decode(event.target.value);
            
            // 💡 ІНДИКАТОР ШИНИ (RX)
            if (window.uiUpdater && window.uiUpdater.flashCanLed) {
                window.uiUpdater.flashCanLed();
            }

            // 1. Відправляємо в парсер для терміналу та виділення ID/Data
            const parsed = parseCanResponse(value);

            // 2. ПЕРЕДАЄМО В МЕНЕДЖЕР ОПИТУВАННЯ
            if (parsed && parsed.id && parsed.data && window.pollingManager) {
                window.pollingManager.handleCanResponse(parsed.id, parsed.data);
            }
        });

        state.isConnected = true;
        updateConnectionTabs();
        logMessage("✓ BLE підключено (Режим розділених каналів)");

        const activePageButton = document.querySelector('.sidebar .nav-button.active');
        if (activePageButton) activePageButton.click();

        return true;
    } catch (error) {
        logMessage(`BLE Помилка: ${error.message}`);
        state.isConnected = false;
        return false;
    }
}