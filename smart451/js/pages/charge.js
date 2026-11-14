// --- js/pages/charge.js ---
import { LineChart } from '../ui/charts.js';
import { bindWindowPicker, card, chart, stats, windowPicker } from '../ui/widgets.js';

const PHASES = [1, 2, 3];

export default {
    id: 'charge',
    title: 'Заряджання',
    groups: ['power', 'hv', 'state'],
    polls: ['obl_pn', 'obl_volts', 'obl_amps', 'obl_setpoint', 'obl_temps', 'bms_soc', ['bms_hv', 5000]],

    render() {
        const rows = PHASES.map((n) => `<tr><th>L${n}</th>
            <td><b data-k="obl_ac_v${n}">—</b> В</td><td><b data-k="obl_ac_a${n}">—</b> А</td></tr>`).join('');
        return `<div class="grid">
            ${card('Стан', `<div class="kv"><span>Сеанс</span><b data-state>—</b></div>
                ${stats('soc_avg', 'power_kw', 'supply_a', 'charge_port')}`)}
            ${card('Мережа', `<table class="tbl phases"><tbody>${rows}</tbody></table>
                ${stats('ac_kw', 'obl_setpoint', 'obl_point_a', 'obl_cable_a')}`, { note: 'зарядник NLG6 / OBL' })}
            ${card('Вихід на батарею', stats('obl_dc_v', 'obl_dc_a', 'dc_kw', 'chg_eff', 'obl_lv'))}
            ${card('Нагрів зарядника', stats('obl_t_plate', 'obl_t_mean', 'obl_t_socket'))}
            ${card('Струм заряду', chart('i'), { cls: 'wide', note: windowPicker() })}
        </div>
        <p class="foot-note">Офсети зарядника взяті з ED_BMSdiag і на цій машині ще не звірялись. Тип визначається за номером у F111: <span data-k="obl_pn">—</span>.</p>`;
    },

    mount(root) {
        this.charts = [new LineChart(root.querySelector('[data-chart="i"]'), {
            series: [{ key: 'amps', label: 'Струм HV', token: '--accent' }],
            unit: 'А', digits: 1, zero: true, minSpan: 5,
        })];
        bindWindowPicker(root, this.charts);
    },

    update(root, { store }) {
        for (const c of this.charts) c.draw(store);
        const on = store.get('charging');
        root.querySelector('[data-state]').textContent = on === null ? '—' : on ? 'Іде заряджання' : 'Немає';
    },

    unmount() { for (const c of this.charts) c.destroy(); },
};
