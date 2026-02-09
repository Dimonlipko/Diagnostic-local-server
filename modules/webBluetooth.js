// modules/webBluetooth.js
import { state } from './state.js';
import { logMessage, updateConnectionTabs, uiUpdater } from './ui.js';
import { parseCanResponse } from './canProtocol.js';

let bleBuffer = ""; 

export async function connectBleAdapter() {
    try {
        logMessage("Пошук BLE пристроїв...");
        const device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [0xFFF0] }],
            optionalServices: [0xFFF0]
        });

        const server = await device.gatt.connect();
        const service = await server.getPrimaryService(0xFFF0);
        const charRead = await service.getCharacteristic(0xFFF1);
        const charWrite = await service.getCharacteristic(0xFFF2);

        state.connectionType = 'ble';
        state.bleDevice = device;

        state.writer = {
            write: async (text) => {
                if (uiUpdater?.flashAdapterLed) uiUpdater.flashAdapterLed();
                const encoder = new TextEncoder();
                await charWrite.writeValueWithoutResponse(encoder.encode(text));
            }
        };

        await charRead.startNotifications();
        
        charRead.addEventListener('characteristicvaluechanged', (event) => {
            const decoder = new TextDecoder();
            const chunk = decoder.decode(event.target.value);
            
            // 🔍 ДЕБАГ: Виводимо кожен фізичний пакет у термінал
            // Це покаже, чи Android справді "ріже" дані по 20 байт
            logMessage(`[BLE CHUNK]: "${chunk.replace(/\r/g, '\\r').replace(/\n/g, '\\n')}"`);

            bleBuffer += chunk;

            // Чекаємо на символ завершення від ELM327
            if (bleBuffer.includes('>')) {
                const cleanResponse = bleBuffer.replace(/>/g, '').trim();
                
                logMessage(`[BLE FULL]: ${cleanResponse}`); // Повна зібрана відповідь

                if (uiUpdater?.flashCanLed) uiUpdater.flashCanLed();

                const parsed = parseCanResponse(cleanResponse);
                if (parsed && parsed.id && parsed.data && window.pollingManager) {
                    window.pollingManager.handleCanResponse(parsed.id, parsed.data);
                }

                bleBuffer = ""; // Очищення для наступної команди
            }
        });

        state.isConnected = true;
        updateConnectionTabs();
        logMessage("✓ BLE підключено");
        
        const activePageButton = document.querySelector('.sidebar .nav-button.active');
        if (activePageButton) activePageButton.click();

        return true;
    } catch (error) {
        logMessage(`BLE Помилка: ${error.message}`);
        return false;
    }
}