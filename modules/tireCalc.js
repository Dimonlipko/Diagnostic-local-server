import { state } from './state.js';
import { translations } from './config.js';

/**
 * Калькулятор окружності колеса за маркуванням шини (сторінка settings.html).
 *
 * Окружність — геометрична: π · (D_диска · 25.4 + 2 · ширина · профіль / 100).
 * ECU рахує швидкість як motor_rpm / gear_reduction · wheel_circle, де
 * gear_reduction — ціла константа 8 (Leaf_V4.cpp). Якщо реальне передаточне
 * число редуктора інше, значення для запису масштабується на 8 / ratio, щоб
 * спідометр і круїз бачили правильну швидкість.
 */

const ECU_GEAR_REDUCTION = 8;

// Тільки цифри з необов'язковою дробовою частиною (крапка або кома).
// parseFloat тут не годиться: '8.19abc' він тихо читає як 8.19.
const INT_RE = /^\d+$/;
const DEC_RE = /^\d+(?:[.,]\d+)?$/;

const FIELDS = {
    width:   { id: 'tireCalcWidth',   re: INT_RE, min: 100, max: 400 },
    profile: { id: 'tireCalcProfile', re: INT_RE, min: 20,  max: 100 },
    rim:     { id: 'tireCalcRim',     re: DEC_RE, min: 10,  max: 26 },
    ratio:   { id: 'tireCalcRatio',   re: DEC_RE, min: 1,   max: 30 },
};

/** @returns {number|null} число, null для порожнього поля, NaN для невалідного */
function parseField(text, { re, min, max }) {
    const s = text.trim();
    if (s === '') return null;
    if (!re.test(s)) return NaN;
    const n = Number(s.replace(',', '.'));
    return n >= min && n <= max ? n : NaN;
}

/** Діаметр і окружність у мм */
export function tireCircumference(width, profile, rim) {
    const diameter = rim * 25.4 + 2 * width * profile / 100;
    return { diameter, circ: Math.PI * diameter };
}

export function initTireCalc(container) {
    const toggle = container.querySelector('#tireCalcToggle');
    const panel = container.querySelector('#tireCalc');
    const target = container.querySelector('#writeWheelCirc');
    const applyBtn = container.querySelector('#tireCalcApply');
    const errorLine = container.querySelector('#tireCalcError');
    const outDiameter = container.querySelector('#tireCalcDiameter');
    const outCirc = container.querySelector('#tireCalcCirc');
    const outEcu = container.querySelector('#tireCalcEcu');
    const inputs = Object.fromEntries(
        Object.entries(FIELDS).map(([k, f]) => [k, container.querySelector('#' + f.id)])
    );
    if (!toggle || !panel || !target || Object.values(inputs).some(el => !el)) return;

    const t = translations[state.currentLanguage] || {};
    toggle.title = t.tire_calc_title || '';

    toggle.addEventListener('click', () => {
        const open = panel.hidden;
        panel.hidden = !open;
        toggle.setAttribute('aria-expanded', String(open));
        toggle.classList.toggle('active', open);
        if (open) inputs.width.focus();
    });

    let ecuValue = null;

    const recalc = () => {
        const v = {};
        let anyInvalid = false;
        for (const [k, f] of Object.entries(FIELDS)) {
            v[k] = parseField(inputs[k].value, f);
            const bad = Number.isNaN(v[k]);
            inputs[k].classList.toggle('tire-calc-invalid', bad);
            anyInvalid ||= bad;
        }
        errorLine.hidden = !anyInvalid;

        // Порожнє передаточне число = ECU-константа, тобто без корекції
        const ratio = v.ratio ?? ECU_GEAR_REDUCTION;
        const sizeOk = [v.width, v.profile, v.rim].every(n => n !== null && !Number.isNaN(n));
        const tire = sizeOk ? tireCircumference(v.width, v.profile, v.rim) : null;

        ecuValue = null;
        if (tire && !Number.isNaN(ratio)) {
            const n = Math.round(tire.circ * ECU_GEAR_REDUCTION / ratio);
            if (n > 0 && n <= 0xFFFF) ecuValue = n;
        }

        outDiameter.textContent = tire ? Math.round(tire.diameter) : '—';
        outCirc.textContent = tire ? Math.round(tire.circ) : '—';
        outEcu.textContent = ecuValue ?? '—';
        applyBtn.disabled = ecuValue === null;
    };

    Object.values(inputs).forEach(el => el.addEventListener('input', recalc));
    applyBtn.addEventListener('click', () => {
        if (ecuValue === null) return;
        target.value = ecuValue;
        target.focus();
    });

    recalc();
}
