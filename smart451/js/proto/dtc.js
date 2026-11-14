// --- js/proto/dtc.js ---
// UDS 19 02 FF → записи по 4 байти: DTC (3) + статус (1).
// Розбір і таблиця описів — як у tools/smart_ed_diag_gui.py.

import { LBC_DTC, LBC_TEST } from './lbc_dtc.js';

export const DTC_STATUS_BITS = [
    [0x01, 'зараз активна'],
    [0x02, 'у цьому циклі'],
    [0x04, 'очікує'],
    [0x08, 'підтверджена'],
    [0x10, 'тест не завершено'],
    [0x20, 'після стирання'],
    [0x40, 'тест не завершено в циклі'],
    [0x80, 'лампа попередження'],
];

// CBF зберігає коди, але не назви: Xentry бере їх із окремої бази Daimler, якої в нас
// нема. Тут лише стандартні SAE J2012 і відомі для Smart 451 ED.
const DTC_DESC = {
    U01A1: 'Втрата CAN-зв\'язку з модулем комірок (BMB/CSC)',
    U01A2: 'Втрата CAN-зв\'язку з модулем комірок (BMB/CSC)',
    U019B: 'Втрата CAN-зв\'язку (внутрішня шина батареї)',
    U0292: 'Втрата CAN-зв\'язку з блоком керування приводом',
    B21F2: 'Внутрішня несправність HV-батареї',
    P0A0E: 'Коло датчика температури модуля',
    P0AA1: 'Датчик напруги батареї / коло контролю ізоляції',
    P0AA4: 'Коло датчика напруги батареї',
    P0C46: 'Коло вимірювання напруги комірки',
    P0C47: 'Коло вимірювання напруги комірки',
    P0C48: 'Коло вимірювання напруги комірки',
    P0C49: 'Коло вимірювання напруги комірки',
    P0E1A: 'Коло балансування комірок',
    P0E1B: 'Коло балансування комірок',
    P0E1C: 'Коло балансування комірок',
    P0E1E: 'Коло балансування комірок',
    P0E1F: 'Коло балансування комірок',
    P14F3: 'Несправність ізоляції HV-батареї',
};

const hex2 = (v) => v.toString(16).toUpperCase().padStart(2, '0');

// (0x0A, 0xA1, 0x00) → 'P0AA100'
export function decodeDtc(b0, b1, b2) {
    const letter = 'PCBU'[(b0 >> 6) & 3];
    return `${letter}${(b0 >> 4) & 3}${(b0 & 0xF).toString(16).toUpperCase()}${hex2(b1)}${hex2(b2)}`;
}

export function dtcDescription(code) {
    return DTC_DESC[code.slice(0, 5)] ?? null;
}

// Код LBC у назві має сімейство (1B07) і тип збою (15), див. docs/canze/.
export function lbcDescription(code) {
    const name = LBC_DTC[code.slice(1, 5)];
    if (!name) return null;
    const test = LBC_TEST[code.slice(5, 7)];
    return test ? `${name} — ${test}` : name;
}

export function statusText(st) {
    return DTC_STATUS_BITS.filter(([bit]) => st & bit).map(([, name]) => name);
}

/** @param {Uint8Array} resp  відповідь, що починається з 0x59 */
export function parseDtcList(resp, describe = dtcDescription) {
    const out = [];
    for (let i = 3; i + 3 < resp.length; i += 4) {
        const code = decodeDtc(resp[i], resp[i + 1], resp[i + 2]);
        const status = resp[i + 3];
        out.push({ code, status, text: describe(code), flags: statusText(status) });
    }
    return out;
}

// Активні або підтверджені. У LBC 19 02 FF повертає ~181 запис зі статусом 0x50
// («тест не завершено») — без цього фільтра список тоне у фальшивих кодах.
export const isRealDtc = (d) => (d.status & 0x09) !== 0;
