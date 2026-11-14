// --- js/proto/params.js ---
// Підпис, одиниця, точність і джерело кожного значення. Звідси беруть і плитки, і
// вкладка «Усі параметри», і CSV.

import { CEPC_ROWS } from './dids.js';

const P = (label, unit, digits, src) => ({ label, unit, digits, src });

export const PARAMS = {
    soc_dash:     P('SOC приборки', '%', 1, '0x518 b7'),
    supply_a:     P('Ліміт струму мережі', 'А', 1, '0x518 b1'),
    amps:         P('Струм HV', 'А', 1, '0x508 b2:3'),
    hv:           P('Напруга 0x448', 'В', 1, '0x448 b6:7'),
    hv_main:      P('Напруга HV', 'В', 1, '0x448, інакше BMS 0204 або CEPC 5326'),
    lv:           P('Бортова мережа', 'В', 1, '0x3D5 b3'),
    odo:          P('Одометр', 'км', 0, '0x412'),
    clock:        P('Годинник машини', '', 0, '0x512'),
    speed:        P('Швидкість', 'км/год', 0, '0x200 b2:3'),
    range_km:     P('Запас ходу', 'км', 0, '0x318 b7'),
    temp_out:     P('Зовні', '°C', 1, '0x408 b4'),
    energy_start: P('Енергія з пуску', 'кВт·год', 2, '0x3CE b0:1'),
    energy_reset: P('Енергія з скидання', 'кВт·год', 2, '0x3CE b2:3'),
    trip_start:   P('Пробіг з пуску', 'км', 1, '0x504 b1:2'),
    trip_reset:   P('Пробіг з скидання', 'км', 1, '0x504 b4:5'),
    eco_accel:    P('Плавність розгону', '%', 0, '0x3F2 b0'),
    eco_const:    P('Рівномірність', '%', 0, '0x3F2 b1'),
    eco_coast:    P('Накат', '%', 0, '0x3F2 b2'),
    eco_score:    P('Eco-оцінка', '%', 0, '0x3F2 b3'),
    hv_active:    P('HV активне', '', 0, '0x3D7 b0'),
    charging:     P('Заряджання', '', 0, '0x168 b7'),
    charge_port:  P('Порт заряду', '', 0, '0x508 b2.6'),

    obd_v:        P('Напруга на OBD', 'В', 1, 'ATRV'),
    power_kw:     P('Потужність', 'кВт', 1, 'U×I'),
    consumption:  P('Витрата з пуску', 'кВт·год/100 км', 1, '0x3CE / 0x504'),

    soc_min:      P('SOC мін', '%', 1, 'BMS 0206'),
    soc_avg:      P('SOC BMS', '%', 1, 'BMS 0206'),
    soc_max:      P('SOC макс', '%', 1, 'BMS 0206'),
    bms_amps:     P('Струм BMS', 'А', 2, 'BMS 0203'),
    bms_hv1:      P('Напруга BMS 1', 'В', 1, 'BMS 0204'),
    bms_hv2:      P('Напруга BMS 2', 'В', 1, 'BMS 0204'),
    bms_hv3:      P('Напруга BMS 3', 'В', 1, 'BMS 0204'),
    t_max:        P('Температура макс', '°C', 1, 'BMS 0201'),
    t_min:        P('Температура мін', '°C', 1, 'BMS 0201'),
    t_avg:        P('Температура середня', '°C', 1, 'BMS 0201'),
    cell_count:   P('Комірок', '', 0, 'BMS 0208'),
    cell_min:     P('Комірка мін', 'мВ', 0, 'BMS 0208'),
    cell_max:     P('Комірка макс', 'мВ', 0, 'BMS 0208'),
    cell_mean:    P('Комірка середня', 'мВ', 0, 'BMS 0208'),
    cell_delta:   P('Розкид', 'мВ', 0, 'BMS 0208'),
    cell_stdev:   P('СКВ', 'мВ', 1, 'BMS 0208'),
    cell_min_at:  P('Номер найнижчої', '', 0, 'BMS 0208'),
    cell_max_at:  P('Номер найвищої', '', 0, 'BMS 0208'),
    iso_kohm:     P('Ізоляція', 'кОм', 0, 'BMS 0209'),
    iso_fault:    P('DC-збій ізоляції', '', 0, 'BMS 0209'),
    cap_ah:       P('Ємність пака', 'А·год', 1, 'BMS 0305'),
    soh:          P('SOH', '%', 0, 'BMS 0305 / 52.5 А·год'),
    cap_loss_raw: P('Втрата ємності (raw)', '', 0, 'BMS 0307'),
    ct_cycles_max:  P('Ресурс контакторів', 'циклів', 0, 'BMS 0309'),
    ct_cycles_left: P('Лишилось циклів', 'циклів', 0, 'BMS 030C'),
    contactor_raw:  P('Контактори (raw)', '', 0, 'BMS D003'),
    bms_pump1:    P('Помпа 1', 'об/хв', 0, 'BMS D000'),
    bms_pump2:    P('Помпа 2', 'об/хв', 0, 'BMS D005'),
    bms_valve:    P('Клапан', '', 0, 'BMS D006'),

    obl_pn:       P('Номер зарядника', '', 0, 'OBL F111'),
    obl_lv:       P('12 В зарядника', 'В', 1, 'OBL 0226'),
    obl_dc_v:     P('DC напруга', 'В', 1, 'OBL 0226'),
    obl_dc_a:     P('DC струм', 'А', 1, 'OBL 0225'),
    obl_ac_v1:    P('L1 напруга', 'В', 1, 'OBL 0226'),
    obl_ac_v2:    P('L2 напруга', 'В', 1, 'OBL 0226'),
    obl_ac_v3:    P('L3 напруга', 'В', 1, 'OBL 0226'),
    obl_ac_a1:    P('L1 струм', 'А', 1, 'OBL 0225'),
    obl_ac_a2:    P('L2 струм', 'А', 1, 'OBL 0225'),
    obl_ac_a3:    P('L3 струм', 'А', 1, 'OBL 0225'),
    obl_point_a:  P('Ліміт станції', 'А', 0, 'OBL 0225'),
    obl_cable_a:  P('Ліміт кабелю', 'А', 0, 'OBL 0225'),
    obl_setpoint: P('Заданий струм', 'А', 0, 'OBL 022A'),
    obl_t_plate:  P('Плита охолодження', '°C', 0, 'OBL 0223'),
    obl_t_mean:   P('Зарядник, середня', '°C', 0, 'OBL 0223'),
    obl_t_socket: P('Розетка', '°C', 0, 'OBL 0223'),
    ac_kw:        P('Потужність AC', 'кВт', 1, 'ΣU×I'),
    dc_kw:        P('Потужність DC', 'кВт', 1, 'U×I'),
    chg_eff:      P('ККД зарядника', '%', 0, 'DC / AC'),

    cool_temp:    P('Рідина контуру', '°C', 1, 'CEPC 2047'),
    cool_pump_t:  P('Температура помпи', '°C', 0, 'CEPC 230A'),
    cool_pump_v:  P('Живлення помпи', 'В', 1, 'CEPC 2308'),
    cool_pump_a:  P('Струм помпи', 'А', 1, 'CEPC 2309'),
    cool_pump:    P('Помпа', '%', 0, 'CEPC D032'),
    cool_fan:     P('Вентилятор', '%', 0, 'CEPC D041'),
    cool_heater:  P('Нагрівач батареї', '', 0, 'CEPC D302'),
    cool_pump_h:  P('Напрацювання помпи', 'год', 0, 'CEPC 6309'),
    cool_fan_h:   P('Напрацювання вентилятора', 'год', 0, 'CEPC 630A'),
    cool_heater_h: P('Напрацювання нагрівача', 'год', 0, 'CEPC 6321'),
    vac_h:        P('Напрацювання вакуум-помпи', 'год', 1, 'CEPC 6303'),
    vac_p1:       P('Вакуум 1', 'мбар', 0, 'CEPC 2041'),
    vac_p2:       P('Вакуум 2', 'мбар', 0, 'CEPC 2043'),

    br_uptime_s:  P('Час роботи моста', 'с', 0, 'FD04'),
    br_ign_v:     P('Запалювання', 'В', 2, 'FD04'),
    br_lbc_age:   P('Вік кадру LBC', 'мс', 0, 'FD04'),
    lbc_soc:      P('SOC LBC', '%', 1, '9001'),
    lbc_usable:   P('Доступний SOC', '%', 1, '9002'),
    lbc_soh:      P('SOH LBC', '%', 1, '9003'),
    lbc_v:        P('Напруга пака', 'В', 1, '9005'),
    lbc_cmax:     P('Комірка макс', 'мВ', 0, '9007'),
    lbc_cmin:     P('Комірка мін', 'мВ', 0, '9009'),
    lbc_tavg:     P('Температура середня', '°C', 1, '9012'),
    lbc_tmin:     P('Температура мін', '°C', 1, '9013'),
    lbc_tmax:     P('Температура макс', '°C', 1, '9014'),
    lbc_pchg:     P('Макс. заряд', 'кВт', 1, '9018'),
    lbc_pregen:   P('Макс. рекуперація', 'кВт', 1, '900E'),
    lbc_pdis:     P('Макс. розряд', 'кВт', 1, '900F'),
    lbc_energy:   P('Енергія в паку', 'кВт·год', 1, '91C8'),
    lbc_cpu_t:    P('Плата LBC', '°C', 1, '91B7'),
    lbc_balance_n: P('Балансуються', 'комірок', 0, '912B'),
    lbc_bal_ah:   P('Балансування, всього', 'А·год', 1, '924F'),
    lbc_bal_h:    P('Балансування, час', 'год', 1, '9250'),
};

for (const r of CEPC_ROWS) {
    PARAMS[r.key] = P(r.label, r.unit, r.scale < 1 ? 1 : 0, `CEPC ${r.did.toString(16).toUpperCase()}`);
}

const nf = new Map();

export function formatNumber(v, digits = 0) {
    let f = nf.get(digits);
    if (!f) {
        f = new Intl.NumberFormat('uk-UA', { minimumFractionDigits: digits, maximumFractionDigits: digits });
        nf.set(digits, f);
    }
    return f.format(v).replace('-', '−');
}

export function formatValue(key, v) {
    if (v === null || v === undefined) return '—';
    if (typeof v === 'boolean') return v ? 'так' : 'ні';
    if (typeof v === 'number') return formatNumber(v, PARAMS[key]?.digits ?? 0);
    if (Array.isArray(v)) return `${v.length} знач.`;
    return String(v);
}
