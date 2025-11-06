// Цей файл містить спільний стан програми, 
// який можуть "імпортувати" та змінювати інші модулі.

export let state = {
    port: null,
    reader: null,
    writer: null,
    adapterType: 'unknown',
    carStatusTimeout: null,
    logElement: null, // Посилання на <pre id="log">
    currentLanguage: 'uk',
    terminalLog: 'Очікування підключення...'
};

