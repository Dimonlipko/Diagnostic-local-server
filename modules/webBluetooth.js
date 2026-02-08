import { state } from './state.js';
import { logMessage } from './ui.js';
import { parseCanResponse } from './canProtocol.js';

export const bluetoothManager = {
    device: null,
    characteristic: null,
    // UUID з вашого скріншоту перевірки
    SERVICE_UUID: '0000fff0-0000-1000-8000-00805f9b34fb',
    CHARACTERISTIC_UUID: '0000fff1-0000-1000-8000-00805f9b34fb',

    async connect() {
        try {
            // 1. Пошук пристрою
            this.device = await navigator.bluetooth.requestDevice({
                filters: [{ services: [this.SERVICE_UUID] }]
            });

            logMessage(`Підключення до ${this.device.name}...`);
            const server = await this.device.gatt.connect();
            const service = await server.getPrimaryService(this.SERVICE_UUID);
            this.characteristic = await service.getCharacteristic(this.CHARACTERISTIC_UUID);

            // 2. Налаштування отримання даних
            await this.characteristic.startNotifications();
            this.characteristic.addEventListener('characteristicvaluechanged', (event) => {
                const value = new TextDecoder().decode(event.target.value);
                // Передаємо дані в ваш існуючий парсер
                parseCanResponse(value); 
            });

            // 3. Оновлення глобального стану (state.js)
            state.isConnected = true;
            state.connectionType = 'ble';
            state.adapterType = 'elm327';
            
            // Створюємо writer, який очікує canProtocol.js
            state.bleWriter = {
                write: async (data) => this.send(data)
            };

            logMessage("BLE підключено успішно!");
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
        await this.characteristic.writeValue(encoder.encode(data));
    },

    async disconnect() {
        if (this.device && this.device.gatt.connected) {
            await this.device.gatt.disconnect();
        }
        state.isConnected = false;
        state.connectionType = null;
        state.bleWriter = null;
        logMessage("BLE відключено.");
        document.getElementById('statusAdapter').classList.remove('active');
    }
};