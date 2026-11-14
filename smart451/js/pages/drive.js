// --- js/pages/drive.js ---
import { LineChart } from '../ui/charts.js';
import { bindWindowPicker, card, chart, meter, stat, stats, windowPicker } from '../ui/widgets.js';

export default {
    id: 'drive',
    title: 'Їзда',
    groups: ['power', 'hv', 'drive', 'body'],
    polls: [['bms_hv', 5000]],

    render() {
        return `<div class="grid">
            ${card('', `<div class="stats stats-hero">${stat('speed', { big: true })}${stat('power_kw', { big: true })}</div>
                ${stats('range_km', 'consumption', 'odo', 'temp_out')}`)}
            ${card('Eco', `${meter('eco_score', 'Загальна оцінка')}${meter('eco_accel', 'Плавність розгону')}
                ${meter('eco_const', 'Рівномірність')}${meter('eco_coast', 'Накат')}`, { note: '0x3F2' })}
            ${card('Швидкість', chart('v'), { cls: 'wide', note: windowPicker() })}
            ${card('Потужність', chart('p'), { cls: 'wide' })}
            ${card('Поїздка', stats('trip_start', 'energy_start', 'trip_reset', 'energy_reset'), { cls: 'wide' })}
        </div>`;
    },

    mount(root) {
        this.charts = [
            new LineChart(root.querySelector('[data-chart="v"]'), {
                series: [{ key: 'speed', label: 'Швидкість', token: '--accent' }],
                unit: 'км/год', digits: 0, zero: true, minSpan: 20,
            }),
            new LineChart(root.querySelector('[data-chart="p"]'), {
                series: [{ key: 'power_kw', label: 'Потужність', token: '--accent' }],
                unit: 'кВт', digits: 1, zero: true, minSpan: 4,
            }),
        ];
        bindWindowPicker(root, this.charts);
    },

    update(root, { store }) { for (const c of this.charts) c.draw(store); },

    unmount() { for (const c of this.charts) c.destroy(); },
};
