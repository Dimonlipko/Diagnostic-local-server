// --- js/pages/temps.js ---
import { LineChart } from '../ui/charts.js';
import { bindWindowPicker, card, chart, legend, stats, windowPicker } from '../ui/widgets.js';
import { formatNumber } from '../proto/params.js';

// Шкала теплової карти фіксована: інакше різниця в пів градуса виглядала б як пожежа.
const HEAT_MIN = 0;
const HEAT_MAX = 45;

export default {
    id: 'temps',
    title: 'Температури',
    groups: ['hv'],
    polls: ['bms_temps', 'bms_module_temps', 'cepc_5338', 'cepc_5339', 'cepc_5005', 'cepc_5006'],

    render() {
        return `<div class="grid">
            ${card('Пак', stats('t_max', 't_avg', 't_min', 'temp_out'))}
            ${card('Датчики модулів', `<div class="heat" data-heat></div>
                <div class="heat-scale"><span>${HEAT_MIN} °C</span><i></i><span>${HEAT_MAX} °C</span></div>`,
                { note: 'DID 0202' })}
            ${card('Динаміка', `${legend([['Макс', '--series-3'], ['Середня', '--series-1'], ['Мін', '--series-2']])}${chart('t')}`,
                { cls: 'wide', note: windowPicker() })}
            ${card('Що бачить блок приводу', stats('cepc_5338', 'cepc_5339', 'cepc_5005', 'cepc_5006'),
                { cls: 'wide', note: 'CEPC, DID 53xx / 50xx' })}
        </div>`;
    },

    mount(root) {
        this.charts = [new LineChart(root.querySelector('[data-chart="t"]'), {
            series: [
                { key: 't_max', label: 'Макс', token: '--series-3' },
                { key: 't_avg', label: 'Середня', token: '--series-1' },
                { key: 't_min', label: 'Мін', token: '--series-2' },
            ],
            unit: '°C', digits: 1, minSpan: 3,
        })];
        bindWindowPicker(root, this.charts);
        this.sig = '';
    },

    update(root, { store }) {
        for (const c of this.charts) c.draw(store);
        const t = store.get('t_modules');
        const sig = JSON.stringify(t);
        if (sig === this.sig) return;
        this.sig = sig;
        const box = root.querySelector('[data-heat]');
        if (!t?.length) return;
        box.replaceChildren(...t.map((v, i) => {
            const cell = document.createElement('div');
            cell.className = 'heat-cell';
            const share = Math.max(0, Math.min(1, (v - HEAT_MIN) / (HEAT_MAX - HEAT_MIN)));
            cell.style.setProperty('--heat', `${Math.round(share * 100)}%`);
            cell.title = `Датчик ${i + 1}`;
            const b = document.createElement('b');
            b.textContent = formatNumber(v, 1);
            const s = document.createElement('span');
            s.textContent = `Д${i + 1}`;
            cell.append(s, b);
            return cell;
        }));
    },

    unmount() { for (const c of this.charts) c.destroy(); },
};
