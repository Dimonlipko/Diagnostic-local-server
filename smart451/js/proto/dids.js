// --- js/proto/dids.js ---
// Усе, що застосунок читає через UDS. Офсети — від початку зібраної відповіді
// (байт 0 = 0x62), той самий відлік, що й RESP_OFF у tools/smart_ed_diag_gui.py.
//
// Джерела:
//   BMS   docs/smart451-bms-cbf-catalog.md + RESP_OFF: перевірено на машині
//   CEPC  docs/smart451-cepc-diag.md (scale/offset/max з CEPC_SEV3.CBF)
//   міст  firmware/bridge/README.md, include/uds.h, src/lbc_uds.cpp
//   OBL і охолодження — ED_BMSdiag, на цій машині ще НЕ звірялись (unverified: true).
//   ED_BMSdiag рахує багатокадрові офсети з урахуванням байта довжини, тому тут вони
//   на 1 менші, ніж у його canDiag.cpp.

export const CELL_MV_SCALE = 1000 / 1024;   // CBF Div_1024; raw-як-мВ завищує на 2.4 %
export const NOMINAL_AH = 52.5;
export const CAP_TO_AH = 10 / 3600;
const TEMP_NA = 0x8000;                     // незаселений слот температури

// Адреси з CBF. Перевірені на машині лише BMS, CEPC і OBL; решта — для опитування DTC.
export const ECU = {
    BMS:  { req: 0x7E7, resp: 0x7EF, title: 'HV-батарея' },
    CEPC: { req: 0x7E5, resp: 0x7ED, title: 'Блок приводу CEPC' },
    LE:   { req: 0x7E6, resp: 0x7EE, title: 'Інвертор і DC/DC' },
    OBL:  { req: 0x61A, resp: 0x483, title: 'Бортовий зарядник' },
    CSHV: { req: 0x62D, resp: 0x62F, title: 'HV-розетка' },
    PLGW: { req: 0x769, resp: 0x601, title: 'Шлюз' },
    COM:  { req: 0x75A, resp: 0x4AB, title: 'Телематика' },
    SOGE: { req: 0x6AA, resp: 0x495, title: 'SOGE' },
    KI:   { req: 0x782, resp: 0x783, title: 'Приборка' },
    SAM:  { req: 0x7A0, resp: 0x7A1, title: 'SAM' },
    ESP:  { req: 0x784, resp: 0x785, title: 'ESP' },
    EWM:  { req: 0x788, resp: 0x789, title: 'Селектор' },
    EPS:  { req: 0x796, resp: 0x797, title: 'Підсилювач керма' },
    AC:   { req: 0x7A2, resp: 0x7A3, title: 'Клімат' },
    AE:   { req: 0x7A4, resp: 0x7A5, title: 'Airbag' },
    TPM:  { req: 0x6B8, resp: 0x4F8, title: 'Тиск у шинах' },
};

export const be16 = (b, i) => (i + 1 < b.length ? (b[i] << 8) | b[i + 1] : null);

export const be16s = (b, i) => {
    const v = be16(b, i);
    return v === null ? null : (v & 0x8000 ? v - 0x10000 : v);
};

export const be32 = (b, i) => (i + 3 < b.length
    ? ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
    : null);

const u24 = (b, i) => (i + 2 < b.length ? (b[i] << 16) | (b[i + 1] << 8) | b[i + 2] : null);

export function ascii(b, from = 3) {
    let s = '';
    for (let i = from; i < b.length; i++) {
        if (b[i] >= 0x20 && b[i] < 0x7F) s += String.fromCharCode(b[i]);
    }
    return s.trim();
}

export function hexDump(b, from = 0) {
    return Array.from(b.slice(from), (v) => v.toString(16).toUpperCase().padStart(2, '0')).join(' ');
}

// Рядок ідентифікації: текст, якщо він друкований, інакше hex.
function identText(b) {
    const body = b.slice(3);
    if (!body.length) return null;
    const printable = body.filter((v) => v >= 0x20 && v < 0x7F).length;
    return printable >= body.length * 0.8 ? ascii(b) : hexDump(body);
}

// Масив BE16 до першого 0xFFFF: BMS має 200 слотів, заселено 93 (96 з мостом).
export function decodeCells(b, first, scale = 1) {
    const out = [];
    for (let i = first; i + 1 < b.length; i += 2) {
        const v = be16(b, i);
        if (v === 0xFFFF) break;
        out.push(v * scale);
    }
    return out;
}

export function cellStats(vals) {
    if (!vals?.length) return null;
    let min = Infinity, max = -Infinity, minAt = 0, maxAt = 0, sum = 0;
    vals.forEach((v, i) => {
        sum += v;
        if (v < min) { min = v; minAt = i; }
        if (v > max) { max = v; maxAt = i; }
    });
    const mean = sum / vals.length;
    const stdev = Math.sqrt(vals.reduce((a, v) => a + (v - mean) ** 2, 0) / vals.length);
    return { count: vals.length, min, max, minAt, maxAt, mean, delta: max - min, stdev };
}

function temps(b, first, count) {
    const out = [];
    for (let i = 0; i < count; i++) {
        const raw = be16(b, first + i * 2);
        if (raw === null || raw === TEMP_NA) continue;
        out.push(be16s(b, first + i * 2) / 100);
    }
    return out;
}

// Коротка відповідь має дати «нема даних», а не 0 після ділення null.
const u16Scaled = (b, k) => { const v = be16(b, 3); return v === null ? null : v * k; };
const lbcTemp = (b) => { const v = be16(b, 3); return v === null ? null : v / 16 - 40; };  // 9012.., 9131.., 91B7
const lbcCounter = (b) => {                                // 924F.. u32, (raw − 2³¹)/1024
    const v = be32(b, 3);
    return v === null ? null : (v - 2 ** 31) / 1024;
};

// --- CEPC -------------------------------------------------------------------
// [DID, ключ групи, підпис, scale, offset, max raw, одиниця]
const CEPC_RAW = [
    [0x5326, 'received', 'Напруга пакета',          0.1,     0,     0x1FFE, 'В'],
    [0x5324, 'received', 'Струм пакета',            0.1,  -819.2,   0x3FFE, 'А'],
    [0x5321, 'received', 'SOC від BMS',             0.1,     0,     0x03E8, '%'],
    [0x530F, 'received', 'Макс. напруга заряду',    0.1,     0,     0x1FFE, 'В'],
    [0x5312, 'received', 'Мін. напруга розряду',    0.1,     0,     0x1FFE, 'В'],
    [0x5310, 'received', 'Ліміт струму заряду',     0.1,  -819.2,   0x3FFE, 'А'],
    [0x5311, 'received', 'Ліміт струму розряду',    0.1,  -819.2,   0x3FFE, 'А'],
    [0x5313, 'received', 'Стан контакторів',        1,       0,     0x0003, ''],
    [0x5338, 'received', 'Темп. комірок, макс',     1,     -40,     0x00FF, '°C'],
    [0x5339, 'received', 'Темп. комірок, мін',      1,     -40,     0x00FF, '°C'],
    [0x5005, 'received', 'Темп. комірок, середня',  1,     -50,     0x00FF, '°C'],
    [0x5006, 'received', 'Темп. рідини батареї',    0.5,   -40,     0x00FF, '°C'],
    [0x5329, 'received', 'Час до розмикання',       1,       0,     0xFFFF, ''],
    [0x532B, 'received', 'Клапан контуру батареї',  1,       0,     0x0003, ''],
    [0x5315, 'flags',    'Помилка інтерлоку',       1,       0,     0x0001, ''],
    [0x5314, 'flags',    'Перегрів передзаряду',    1,       0,     0x0001, ''],
    [0x5318, 'flags',    'Ізоляція: внутрішня',     1,       0,     0x0001, ''],
    [0x5319, 'flags',    'Ізоляція: зовнішня',      1,       0,     0x0001, ''],
    [0x5320, 'flags',    'Ізоляція: критична',      1,       0,     0x0001, ''],
    [0x5334, 'flags',    'Режим збою ізоляції',     1,       0,     0x0001, ''],
    [0x5317, 'flags',    'Запит охолодження',       1,       0,     0x0001, ''],
    [0x531A, 'flags',    'Критичний запит охолодж.', 1,      0,     0x0001, ''],
    [0x531B, 'flags',    'Запит сервісу',           1,       0,     0x0001, ''],
    [0x531C, 'flags',    'Вимога: без струму',      1,       0,     0x0001, ''],
    [0x531D, 'flags',    'Вимога: відкладене вимк.', 1,      0,     0x0001, ''],
    [0x531E, 'flags',    'Вимога: вимкнення',       1,       0,     0x0001, ''],
    [0x6010, 'derived',  'SOC енергоменеджера',     0.1,     0,     0x03E8, '%'],
    [0x6014, 'derived',  'SOC за таблицею OCV',     0.1,     0,     0xFFFF, '%'],
    [0x6013, 'derived',  'Струм (плаузибілізований)', 0.1, -819.2,  0x3FFE, 'А'],
    [0x6012, 'derived',  'Поточна ємність',         1,       0,     0xFFFF, ''],
    [0x6308, 'derived',  'Старіння батареї',        0.5,     0,     0x00FF, '%'],
    [0x2022, 'derived',  '12 В борт-мережі',        0.00195313, 0,  0x7FFF, 'В'],
];

export const CEPC_GROUPS = [
    ['received', 'Прийнято від BMS'],
    ['flags', 'Статусні біти BMS'],
    ['derived', 'Власні розрахунки CEPC'],
];

export const CEPC_ROWS = CEPC_RAW.map(([did, group, label, scale, offset, max, unit]) => ({
    did, group, label, scale, offset, max, unit,
    key: `cepc_${did.toString(16)}`,
}));

// CBF описує ці поля як 16 біт на байті 3, але ECU вільний відповісти одним значущим
// байтом — пробуємо обидві ширини (_cepc_value у GUI). Поза діапазоном = «недійсно».
export function cepcValue(b, row) {
    if (b.length < 4) return null;
    if (b.length >= 5) {
        const raw = be16(b, 3);
        if (raw <= row.max) return raw * row.scale + row.offset;
        // Лише коли діапазон CBF вміщається в байт: інакше 16-бітний маркер «недійсно»
        // тихо перетворився б на правдоподібне, але хибне число.
        if (row.max <= 0xFF && b[3] <= row.max) return b[3] * row.scale + row.offset;
        return null;
    }
    return b[3] <= row.max ? b[3] * row.scale + row.offset : null;
}

// --- опитування --------------------------------------------------------------
// every — бажаний період, мс; once — один раз за сесію; timeout — на всю відповідь.
// Багатокадрові відповіді йдуть зі STmin 20 мс: 400 Б ≈ 58 кадрів ≈ 1.2 с.
const FULL_DUMP_MS = 6000;

export const POLLS = {
    bms_soc: { ecu: 'BMS', did: 0x0206, every: 4000, apply(b, set) {
        const f = (o) => { const v = be32(b, o); return v === null ? null : v / 1000; };
        set('soc_min', f(3));
        set('soc_avg', f(7));
        set('soc_max', f(11));
    } },
    bms_amps: { ecu: 'BMS', did: 0x0203, every: 2000, apply(b, set) {
        const v = be16s(b, 3);
        if (v !== null) set('bms_amps', v / 32);
    } },
    bms_hv: { ecu: 'BMS', did: 0x0204, every: 2000, apply(b, set) {
        const v = [7, 9, 11].map((o) => be16(b, o)).map((r) => (r === null ? null : r / 64));
        set('bms_hv1', v[0]);
        set('bms_hv2', v[1]);
        set('bms_hv3', v[2]);
    } },
    bms_temps: { ecu: 'BMS', did: 0x0201, every: 6000, apply(b, set) {
        const t = temps(b, 3, 7);
        set('t_max', t[0] ?? null);
        set('t_min', t[1] ?? null);
        set('t_avg', t[2] ?? null);
    } },
    bms_module_temps: { ecu: 'BMS', did: 0x0202, every: 8000, apply(b, set) {
        set('t_modules', temps(b, 3, 30));
    } },
    bms_cells: { ecu: 'BMS', did: 0x0208, every: 8000, timeout: FULL_DUMP_MS, apply(b, set) {
        const cells = decodeCells(b, 3, CELL_MV_SCALE);
        set('cells_mv', cells);
        const s = cellStats(cells);
        if (!s) return;
        set('cell_count', s.count);
        set('cell_min', s.min);
        set('cell_max', s.max);
        set('cell_mean', s.mean);
        set('cell_delta', s.delta);
        set('cell_stdev', s.stdev);
        set('cell_min_at', s.minAt + 1);
        set('cell_max_at', s.maxAt + 1);
    } },
    bms_iso: { ecu: 'BMS', did: 0x0209, every: 6000, apply(b, set) {
        set('iso_kohm', be16s(b, 3));
        set('iso_fault', b.length > 5 ? b[5] : null);
    } },
    bms_cap: { ecu: 'BMS', did: 0x0305, every: 60000, apply(b, set) {
        const raw = be16(b, 3);
        if (raw === null) return;
        const ah = raw * CAP_TO_AH;
        set('cap_ah', ah);
        set('soh', (ah / NOMINAL_AH) * 100);
    } },
    bms_cap_loss: { ecu: 'BMS', did: 0x0307, every: 60000, apply(b, set) {
        set('cap_loss_raw', be16(b, 3));
    } },
    bms_ct_max: { ecu: 'BMS', did: 0x0309, every: 60000, apply(b, set) {
        set('ct_cycles_max', be32(b, 3));
    } },
    bms_ct_left: { ecu: 'BMS', did: 0x030C, every: 60000, apply(b, set) {
        set('ct_cycles_left', be32(b, 3));
    } },
    bms_res: { ecu: 'BMS', did: 0x030D, every: 60000, timeout: FULL_DUMP_MS, apply(b, set) {
        set('cells_res', decodeCells(b, 3));
    } },
    bms_cell_cap: { ecu: 'BMS', did: 0x0310, every: 60000, timeout: FULL_DUMP_MS, apply(b, set) {
        set('cells_ah', decodeCells(b, 20, CAP_TO_AH));
    } },
    bms_contactor: { ecu: 'BMS', did: 0xD003, every: 3000, apply(b, set) {
        set('contactor_raw', b.length > 3 ? b[3] : null);
    } },
    bms_pump1: { ecu: 'BMS', did: 0xD000, every: 5000, apply(b, set) { set('bms_pump1', be16(b, 3)); } },
    bms_pump2: { ecu: 'BMS', did: 0xD005, every: 5000, apply(b, set) { set('bms_pump2', be16(b, 3)); } },
    bms_valve: { ecu: 'BMS', did: 0xD006, every: 5000, apply(b, set) {
        set('bms_valve', b.length > 3 ? b[3] : null);
    } },

    obl_pn: { ecu: 'OBL', did: 0xF111, once: true, apply(b, set) {
        const pn = ascii(b);
        set('obl_pn', pn);
        set('obl_nlg6', pn.includes('4519822221'));   // ED_BMSdiag: NLG6_PN_HW
    } },
    obl_volts: { ecu: 'OBL', did: 0x0226, every: 2000, unverified: true, apply(b, set, get) {
        const na = (v) => (v === null || v === 8190 ? null : v / 10);
        if (get('obl_nlg6')) {
            set('obl_lv', b.length > 7 ? b[7] / 10 : null);
            set('obl_dc_v', na(be16(b, 8)));
            set('obl_ac_v1', na(be16(b, 10)));
            set('obl_ac_v2', na(be16(b, 12)));
            set('obl_ac_v3', na(be16(b, 14)));
        } else {
            set('obl_lv', b.length > 5 ? b[5] / 10 : null);
            set('obl_dc_v', na(be16(b, 8)));
            set('obl_ac_v1', na(be16(b, 10)));
            set('obl_ac_v2', null);
            set('obl_ac_v3', null);
        }
    } },
    obl_amps: { ecu: 'OBL', did: 0x0225, every: 2000, unverified: true, apply(b, set, get) {
        const na = (v) => (v === null || v === 2047 ? null : v / 10);
        if (get('obl_nlg6')) {
            set('obl_dc_a', na(be16(b, 3)));
            set('obl_ac_a1', na(be16(b, 5)));
            set('obl_ac_a2', na(be16(b, 7)));
            set('obl_ac_a3', na(be16(b, 9)));
            set('obl_point_a', na(be16(b, 15)));
            set('obl_cable_a', na(be16(b, 17)));
        } else {
            set('obl_ac_a1', na(be16(b, 5)));
            set('obl_ac_a2', null);
            set('obl_ac_a3', null);
            set('obl_dc_a', na(be16(b, 17)));
            set('obl_cable_a', na(be16(b, 13)));
            set('obl_point_a', null);
        }
    } },
    obl_setpoint: { ecu: 'OBL', did: 0x022A, every: 8000, unverified: true, apply(b, set, get) {
        const o = get('obl_nlg6') ? 7 : 6;
        set('obl_setpoint', b.length > o ? b[o] : null);
    } },
    obl_temps: { ecu: 'OBL', did: 0x0223, every: 5000, unverified: true, apply(b, set, get) {
        const t = (o) => (b.length > o && b[o] !== 0xFF ? b[o] - 40 : null);
        if (get('obl_nlg6')) {
            set('obl_t_plate', t(3));
            set('obl_t_mean', t(11));
            set('obl_t_socket', t(12));
        } else {
            set('obl_t_plate', t(4));
            set('obl_t_mean', t(6));
            set('obl_t_socket', t(8));
        }
    } },

    cool_temp:   { ecu: 'CEPC', did: 0x2047, every: 5000, unverified: true, apply(b, set) {
        const v = be16s(b, 3);
        if (v !== null) set('cool_temp', v / 8);
    } },
    cool_pump_t: { ecu: 'CEPC', did: 0x230A, every: 8000, unverified: true, apply(b, set) {
        set('cool_pump_t', b.length > 3 ? b[3] - 50 : null);
    } },
    cool_pump_v: { ecu: 'CEPC', did: 0x2308, every: 8000, unverified: true, apply(b, set) {
        set('cool_pump_v', b.length > 3 ? b[3] / 10 : null);
    } },
    cool_pump_a: { ecu: 'CEPC', did: 0x2309, every: 5000, unverified: true, apply(b, set) {
        set('cool_pump_a', b.length > 4 ? b[4] / 5 : null);
    } },
    cool_pump:   { ecu: 'CEPC', did: 0xD032, every: 5000, unverified: true, apply(b, set) {
        set('cool_pump', b.length > 3 ? (b[3] / 255) * 100 : null);
    } },
    cool_fan:    { ecu: 'CEPC', did: 0xD041, every: 5000, unverified: true, apply(b, set) {
        set('cool_fan', b.length > 3 ? (b[3] / 255) * 100 : null);
    } },
    cool_heater: { ecu: 'CEPC', did: 0xD302, every: 5000, unverified: true, apply(b, set) {
        set('cool_heater', b.length > 3 ? b[3] !== 0 : null);
    } },
    cool_pump_h: { ecu: 'CEPC', did: 0x6309, every: 60000, unverified: true, apply(b, set) {
        set('cool_pump_h', be16(b, 3));
    } },
    cool_fan_h:  { ecu: 'CEPC', did: 0x630A, every: 60000, unverified: true, apply(b, set) {
        set('cool_fan_h', be16(b, 3));
    } },
    cool_heater_h: { ecu: 'CEPC', did: 0x6321, every: 60000, unverified: true, apply(b, set) {
        set('cool_heater_h', be16(b, 3));
    } },
    vac_h:  { ecu: 'CEPC', did: 0x6303, every: 60000, unverified: true, apply(b, set) {
        const v = be32(b, 3);
        set('vac_h', v === null ? null : v / 360000);
    } },
    vac_p1: { ecu: 'CEPC', did: 0x2041, every: 5000, unverified: true, apply(b, set) {
        set('vac_p1', be16s(b, 3));
    } },
    vac_p2: { ecu: 'CEPC', did: 0x2043, every: 5000, unverified: true, apply(b, set) {
        set('vac_p2', be16s(b, 3));
    } },

    br_status: { ecu: 'BMS', did: 0xFD04, every: 3000, bridge: true, apply(b, set) {
        // Розклад — include/uds.h. Є лише на Due; C5 відмовить, і це нормально.
        const p = b.slice(3);
        if (p.length < 13) return;
        set('br_reset', p[1]);
        set('br_uptime_s', be32(p, 2) / 1000);
        set('br_ct_state', p[6]);
        set('br_ct_fault', p[7]);
        set('br_relays', p[8]);
        set('br_flags', p[9]);
        set('br_lbc_age', be16(p, 11));
        if (p.length >= 47) set('br_ign_v', be16(p, 45) / 1000);
    } },
    lbc_soc:    { ecu: 'BMS', did: 0x9001, every: 5000, bridge: true, apply(b, set) { set('lbc_soc', u16Scaled(b, 0.01)); } },
    lbc_usable: { ecu: 'BMS', did: 0x9002, every: 5000, bridge: true, apply(b, set) { set('lbc_usable', u16Scaled(b, 0.01)); } },
    lbc_soh:    { ecu: 'BMS', did: 0x9003, every: 30000, bridge: true, apply(b, set) { set('lbc_soh', u16Scaled(b, 0.01)); } },
    lbc_v:      { ecu: 'BMS', did: 0x9005, every: 3000, bridge: true, apply(b, set) { set('lbc_v', u16Scaled(b, 0.1)); } },
    lbc_cmax:   { ecu: 'BMS', did: 0x9007, every: 5000, bridge: true, apply(b, set) { set('lbc_cmax', u16Scaled(b, 1 / 1.024)); } },
    lbc_cmin:   { ecu: 'BMS', did: 0x9009, every: 5000, bridge: true, apply(b, set) { set('lbc_cmin', u16Scaled(b, 1 / 1.024)); } },
    lbc_tavg:   { ecu: 'BMS', did: 0x9012, every: 8000, bridge: true, apply(b, set) { set('lbc_tavg', lbcTemp(b)); } },
    lbc_tmin:   { ecu: 'BMS', did: 0x9013, every: 8000, bridge: true, apply(b, set) { set('lbc_tmin', lbcTemp(b)); } },
    lbc_tmax:   { ecu: 'BMS', did: 0x9014, every: 8000, bridge: true, apply(b, set) { set('lbc_tmax', lbcTemp(b)); } },
    lbc_pchg:   { ecu: 'BMS', did: 0x9018, every: 8000, bridge: true, apply(b, set) { set('lbc_pchg', u16Scaled(b, 0.01)); } },
    lbc_pregen: { ecu: 'BMS', did: 0x900E, every: 8000, bridge: true, apply(b, set) { set('lbc_pregen', u16Scaled(b, 0.01)); } },
    lbc_pdis:   { ecu: 'BMS', did: 0x900F, every: 8000, bridge: true, apply(b, set) { set('lbc_pdis', u16Scaled(b, 0.01)); } },
    lbc_ilock:  { ecu: 'BMS', did: 0x901A, every: 5000, bridge: true, apply(b, set) {
        set('lbc_ilock', b.length > 3 ? b[3] : null);
    } },
    lbc_energy: { ecu: 'BMS', did: 0x91C8, every: 15000, bridge: true, apply(b, set) {
        const wh = u24(b, 3);
        set('lbc_energy', wh === null ? null : wh / 1000);
    } },
    lbc_relay_main: { ecu: 'BMS', did: 0x91CA, every: 4000, bridge: true, apply(b, set) { set('lbc_relay_main', b.length > 3 ? b[3] & 1 : null); } },
    lbc_relay_pre:  { ecu: 'BMS', did: 0x91CB, every: 4000, bridge: true, apply(b, set) { set('lbc_relay_pre', b.length > 3 ? b[3] & 1 : null); } },
    lbc_relay_fb:   { ecu: 'BMS', did: 0x91D0, every: 4000, bridge: true, apply(b, set) { set('lbc_relay_fb', b.length > 3 ? b[3] & 1 : null); } },
    lbc_cpu_t:  { ecu: 'BMS', did: 0x91B7, every: 15000, bridge: true, apply(b, set) { set('lbc_cpu_t', lbcTemp(b)); } },
    lbc_balance: { ecu: 'BMS', did: 0x912B, every: 10000, bridge: true, apply(b, set) {
        const on = [];
        b.slice(3).forEach((byte, i) => {
            for (let bit = 0; bit < 8; bit++) if (byte & (1 << bit)) on.push(i * 8 + bit);
        });
        set('lbc_balance', on);
        set('lbc_balance_n', on.length);
    } },
    lbc_bal_ah:  { ecu: 'BMS', did: 0x924F, every: 60000, bridge: true, apply(b, set) { set('lbc_bal_ah', lbcCounter(b)); } },
    lbc_bal_h:   { ecu: 'BMS', did: 0x9250, every: 60000, bridge: true, apply(b, set) { set('lbc_bal_h', lbcCounter(b)); } },
};

for (const row of CEPC_ROWS) {
    POLLS[row.key] = {
        ecu: 'CEPC',
        did: row.did,
        every: row.group === 'flags' ? 8000 : 4000,
        apply(b, set) { set(row.key, cepcValue(b, row)); },
    };
}

export const CEPC_POLLS = CEPC_ROWS.map((r) => r.key);

// Ідентифікація читається разово, тож окремо від POLLS.
export const IDENT_DIDS = [
    [0xF190, 'VIN батареї'],
    [0xF100, 'Варіант діагностики'],
    [0xF101, 'Постачальник заліза'],
    [0xF150, 'Версія заліза'],
    [0xF154, 'Патч заліза'],
    [0xF151, 'Версія ПЗ'],
    [0xF153, 'Версія завантажувача'],
    [0xF155, 'Постачальник ПЗ'],
    [0xF111, 'Номер ПЗ 1'],
    [0xF121, 'Номер ПЗ 2'],
    [0xF18C, 'Дата виробництва'],
    [0x0303, 'Варіант комплектації'],
].map(([did, label]) => ({ did, label, decode: identText }));

export const NRC_TEXT = {
    0x10: 'загальна відмова',
    0x11: 'сервіс не підтримується',
    0x12: 'функція не підтримується',
    0x13: 'невірна довжина',
    0x22: 'умови не виконано',
    0x31: 'DID не підтримується',
    0x33: 'потрібен доступ',
    0x7E: 'не в цій сесії',
    0x7F: 'не в цій сесії',
};
