// --- js/ui/icons.js ---
// Власний набір контурних іконок 24×24, один штрих на все.

const I = (d) => `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;

export const ICONS = {
    home: I('<path d="M3.5 11 12 4l8.5 7"/><path d="M6 9.5V20h12V9.5"/><path d="M12.8 11l-2 3h2.4l-2 3"/>'),
    battery: I('<rect x="2.5" y="7" width="17" height="10" rx="2.5"/><path d="M22 10.5v3"/><path d="M11.5 9l-2.5 3.2h3L9.5 15"/>'),
    cells: I('<rect x="3" y="4" width="4.5" height="16" rx="1.2"/><rect x="9.75" y="7" width="4.5" height="13" rx="1.2"/><rect x="16.5" y="10" width="4.5" height="10" rx="1.2"/>'),
    temp: I('<path d="M14 14.8V5a2 2 0 1 0-4 0v9.8a4 4 0 1 0 4 0Z"/><path d="M12 9v8"/>'),
    charge: I('<path d="M9 3v5M15 3v5"/><path d="M6 8h12v3a6 6 0 0 1-12 0Z"/><path d="M12 17v4"/>'),
    drive: I('<path d="M4 17a9 9 0 1 1 16 0"/><path d="M12 14l4-5"/><circle cx="12" cy="14" r="1.4"/>'),
    cepc: I('<rect x="6" y="6" width="12" height="12" rx="2"/><path d="M9.5 2.5V6M14.5 2.5V6M9.5 18v3.5M14.5 18v3.5M2.5 9.5H6M2.5 14.5H6M18 9.5h3.5M18 14.5h3.5"/><path d="M12.8 9.5l-2 3h2.4l-2 3"/>'),
    cool: I('<path d="M12 2.5v19M4 7l16 10M20 7L4 17"/><path d="M9.5 4.5L12 7l2.5-2.5M9.5 19.5L12 17l2.5 2.5"/>'),
    dtc: I('<path d="M10.6 4.2 2.9 17.5A1.6 1.6 0 0 0 4.3 20h15.4a1.6 1.6 0 0 0 1.4-2.5L13.4 4.2a1.6 1.6 0 0 0-2.8 0Z"/><path d="M12 9.5v4.5M12 17h.01"/>'),
    ident: I('<rect x="3" y="5" width="18" height="14" rx="2.5"/><circle cx="8.5" cy="11" r="2"/><path d="M5.5 16c.6-1.6 1.7-2.3 3-2.3s2.4.7 3 2.3M14.5 10h4M14.5 14h4"/>'),
    bus: I('<path d="M2.5 12h3.5l2.5-6 4 13 3-9 1.5 2h4.5"/>'),
    bridge: I('<path d="M3 17V9M21 17V9M3 11c4 0 5-3 9-3s5 3 9 3"/><path d="M7.5 17v-5M12 17V8.2M16.5 17v-5M2 17h20"/>'),
    back: I('<path d="M15 5l-7 7 7 7"/>'),
    sun: I('<circle cx="12" cy="12" r="4"/><path d="M12 2.5v2M12 19.5v2M2.5 12h2M19.5 12h2M5.3 5.3l1.4 1.4M17.3 17.3l1.4 1.4M18.7 5.3l-1.4 1.4M6.7 17.3l-1.4 1.4"/>'),
    moon: I('<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5Z"/>'),
    rec: I('<circle cx="12" cy="12" r="8"/><circle cx="12" cy="12" r="3.5" fill="currentColor" stroke="none"/>'),
    ble: I('<path d="M7 7l10 10-5 4.5v-19L17 7 7 17"/>'),
    play: I('<path d="M7 4.5v15l12-7.5Z"/>'),
    close: I('<path d="M6 6l12 12M18 6L6 18"/>'),
    trash: I('<path d="M4 7h16M9.5 7V4.5h5V7M6.5 7l1 13h9l1-13M10 11v5.5M14 11v5.5"/>'),
};
