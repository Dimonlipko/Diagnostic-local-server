// --- js/proto/frames.js ---
// Широкомовні кадри шини OBD. Формули — ті самі, що в decode_broadcast()
// tools/smart_ed_diag_gui.py; джерело — ED_BMSdiag + OVMS, перевірено на машині.
//
// Батарейних кадрів (0x042, 0x315, 0x2D5, 0x3D6…) на OBD-розетці нема: вони живуть
// на внутрішній шині BMS↔машина (docs/smart451-charge-bus.md). Тому SOC самої BMS
// читаємо через UDS 0206, а не з 0x2D5.

const HV_NA = 0x1FFF;   // контактори розімкнені: без цієї перевірки було б 819.1 В

const be16 = (d, i) => (d[i] << 8) | d[i + 1];

export const FRAMES = {
    0x518: { name: 'SOC приборки, ліміт мережі', min: 8, decode(d, set) {
        // 0xFF = «нема показу» (машина не в READY); /2 дало б безглузді 127.5 %
        set('soc_dash', d[7] === 0xFF ? null : d[7] / 2);
        set('supply_a', d[1] / 2);
    } },
    0x508: { name: 'Струм HV, порт заряду', min: 4, decode(d, set) {
        set('amps', (((d[2] & 0x3F) << 8) + d[3] - 0x2000) / 10);
        set('charge_port', !!(d[2] & 0x40));
    } },
    0x448: { name: 'Напруга HV', min: 8, decode(d, set) {
        const raw = be16(d, 6);
        set('hv', raw === HV_NA ? null : raw / 10);
    } },
    0x3D5: { name: '12 В', min: 4, decode(d, set) { set('lv', d[3] / 10); } },
    0x412: { name: 'Одометр', min: 5, decode(d, set) {
        // 65535, а не 65536 — так у ED_BMSdiag і OVMS
        set('odo', d[2] * 65535 + d[3] * 256 + d[4]);
    } },
    0x512: { name: 'Годинник', min: 2, decode(d, set) {
        set('clock', `${String(d[0]).padStart(2, '0')}:${String(d[1]).padStart(2, '0')}`);
    } },
    0x200: { name: 'Швидкість', min: 4, decode(d, set) { set('speed', be16(d, 2) / 18); } },
    // d5 тут — стала 0x63, а не педаль: педаль живе на шині мотора, не на OBD
    0x318: { name: 'Запас ходу', min: 8, decode(d, set) { set('range_km', d[7]); } },
    0x3D7: { name: 'HV активне', min: 1, decode(d, set) { set('hv_active', !!d[0]); } },
    0x168: { name: 'Заряджання', min: 8, decode(d, set) {
        set('charging', d[7] === 0x20 || d[7] === 0x40);
    } },
    0x408: { name: 'Зовнішня температура', min: 5, decode(d, set) {
        set('temp_out', ((d[4] - 50) - 32) / 1.8);
    } },
    0x3CE: { name: 'Енергія', min: 4, decode(d, set) {
        set('energy_start', be16(d, 0) / 100);
        set('energy_reset', be16(d, 2) / 100);
    } },
    0x3F2: { name: 'Eco-оцінка', min: 4, decode(d, set) {
        set('eco_accel', d[0] >> 1);
        set('eco_const', d[1] >> 1);
        set('eco_coast', d[2] >> 1);
        set('eco_score', d[3] >> 1);
    } },
    0x504: { name: 'Пробіг поїздки', min: 6, decode(d, set) {
        set('trip_start', be16(d, 1) / 10);
        set('trip_reset', be16(d, 4) / 10);
    } },
};

// Групи для ATMA. Одна маска ELM ловить кілька ID за один прохід, тож цикл по всій
// шині коштує 5 вікон замість 14. Склад підібрано так, щоб маска пропускала мало
// чужих ID: зайві кадри на клонах переповнюють буфер.
export const STREAM_GROUPS = {
    power: { ids: [0x508, 0x518, 0x512, 0x504], weight: 4 },
    hv:    { ids: [0x448, 0x408, 0x412], weight: 3 },
    drive: { ids: [0x200, 0x318], weight: 3 },
    body:  { ids: [0x3CE, 0x3D5, 0x3D7, 0x3F2], weight: 1 },
    state: { ids: [0x168], weight: 1 },
};

// Мінімальна маска для набору ID: біт важливий, лише якщо він однаковий у всіх.
export function maskFor(ids) {
    let diff = 0;
    for (const id of ids) diff |= id ^ ids[0];
    return { id: ids[0] & ~diff & 0x7FF, mask: ~diff & 0x7FF };
}

export function decodeFrame(id, data, set) {
    const f = FRAMES[id];
    if (!f || data.length < f.min) return false;
    f.decode(data, set);
    return true;
}
