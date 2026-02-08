// Цей файл містить спільний стан програми, 
// який можуть "імпортувати" та змінювати інші модулі.

export let state = {
    port: null,
    reader: null,
    writer: null,
    bleWriter: null, // Для Web Bluetooth
    adapterType: 'elm327',
    connectionType: null,
    carStatusTimeout: null,
    logElement: null, // Посилання на <pre id="log">
    currentLanguage: 'uk',
    terminalLog: 'Очікування підключення...',
    activePollers: [],
    lastRequestId: null, // Додано для парсингу відповідей ELM без заголовків
    isConnected: false
};

