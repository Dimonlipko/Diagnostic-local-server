// --- js/pages/battery.js ---
import { LineChart } from '../ui/charts.js';
import { bindWindowPicker, card, chart, stat, stats, windowPicker } from '../ui/widgets.js';

const CONTACTOR = ['Розімкнені', 'Передзаряд', 'Замкнені'];

export default {
    id: 'battery',
    title: 'Батарея',
    groups: ['power', 'hv', 'state', 'body'],
    polls: ['bms_soc', 'bms_amps', 'bms_hv', 'bms_iso', 'bms_cap', 'bms_cap_loss',
        'bms_ct_max', 'bms_ct_left', 'bms_contactor'],

    render() {
        return `<div class="grid">
            ${card('Заряд', stats('soc_avg', 'soc_dash', 'soc_min', 'soc_max'),
                { note: 'BMS рахує SOC сама; приборка — з напруги' })}
            ${card('Силове коло', `${stats('hv_main', 'amps', 'power_kw', 'lv')}
                <div class="kv"><span>Контактори</span><b data-contactor>—</b></div>`)}
            ${card('Потужність', chart('power'), { cls: 'wide', note: windowPicker() })}
            ${card('Напруга пака', chart('volts'), { cls: 'wide' })}
            ${card('Ресурс', stats('cap_ah', 'soh', 'cap_loss_raw', 'ct_cycles_left'),
                { note: 'SOH — оцінка BMS, від 52.5 А·год' })}
            ${card('Ізоляція', `<div class="stats">${stat('iso_kohm', { label: 'Опір' })}</div><div class="kv"><span>DC-збій</span><b data-iso>—</b></div>`)}
            ${card('Вимірювання BMS', stats('bms_hv1', 'bms_hv2', 'bms_hv3', 'bms_amps'),
                { note: 'DID 0204, 0203' })}
        </div>`;
    },

    mount(root) {
        this.charts = [
            new LineChart(root.querySelector('[data-chart="power"]'), {
                series: [{ key: 'power_kw', label: 'Потужність', token: '--accent' }],
                unit: 'кВт', digits: 1, zero: true, minSpan: 4,
            }),
            new LineChart(root.querySelector('[data-chart="volts"]'), {
                series: [{ key: 'hv_main', label: 'Напруга', token: '--accent' }],
                unit: 'В', digits: 1, minSpan: 4,
            }),
        ];
        bindWindowPicker(root, this.charts);
    },

    update(root, { store }) {
        for (const c of this.charts) c.draw(store);
        // Для контакторів застаріле значення гірше за прочерк: «замкнені» мусить бути правдою.
        const raw = store.fresh('contactor_raw');
        root.querySelector('[data-contactor]').textContent =
            raw === null ? '—' : `${CONTACTOR[raw] ?? 'невідомо'} (0x${raw.toString(16).toUpperCase().padStart(2, '0')})`;
        const f = store.fresh('iso_fault');
        root.querySelector('[data-iso]').textContent = f === null ? '—' : f ? `є (0x${f.toString(16)})` : 'нема';
    },

    unmount() { for (const c of this.charts) c.destroy(); },
};
