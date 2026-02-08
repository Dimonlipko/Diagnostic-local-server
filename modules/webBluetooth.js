import { state } from './state.js';
import { logMessage } from './ui.js';
import { parseCanResponse } from './canProtocol.js';

export const bluetoothManager = {
    device: null,
    characteristic: null,
    SERVICE_UUID: '0000fff0-0000-1000-8000-00805f9b34fb',
    CHARACTERISTIC_UUID: '0000fff1-0000-1000-8000-00805f9b34fb',

    async connect() {
        try {
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [this.SERVICE_UUID] }]
            });

            logMessage(`Підключення до ${this.device.name}...`);
            const server = await this.device.gatt.connect();
            const service = await server.getPrimaryService(this.SERVICE_UUID);
            this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);

            // Налаштування читання даних
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', (event) => {
                const decoder = new TextDecoder();
                const rawData = decoder.decode(event.target.value);
                // Відправляємо дані в ваш основний обробник
                parseCanResponse(rawData);
            });

            // Оновлюємо глобальний стан
            state.isConnected = true;
            state.connectionType = 'ble';
            state.adapterType = 'elm327';
            
            // Створюємо "замінник" writer для canProtocol.js
            state.bleWriter = {
                write: async (data) => this.send(data)
            };

            logMessage("BLE підключено! Можете опитувати авто.");
            document.getElementById('statusAdapter').classList.add('active');

        } catch (error) {
            logMessage(`Помилка BLE: ${error.message}`);
            state.isConnected = false;
            throw error;
        }
    },

    async send(data) {
        if (!this.characteristic) return;
        const encoder = new TextEncoder();
        // BLE ELM327 зазвичай приймає дані невеликими порціями
        await this.characteristic.writeValue(encoder.encode(data));
    },

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            await this.device.gatt.disconnect();
        }
        state.isConnected = false;
        state.connectionType = null;
        state.bleWriter = null;
        logMessage("BLE роз'єднано.");
        document.getElementById('statusAdapter').classList.remove('active');
    }
};