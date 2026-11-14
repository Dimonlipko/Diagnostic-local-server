// --- js/pages/cool.js ---
import { card, meter, stats } from '../ui/widgets.js';

export default {
    id: 'cool',
    title: 'Охолодження',
    groups: [],
    polls: ['cool_temp', 'cool_pump_t', 'cool_pump_v', 'cool_pump_a', 'cool_pump', 'cool_fan',
        'cool_heater', 'cool_pump_h', 'cool_fan_h', 'cool_heater_h', 'vac_h', 'vac_p1', 'vac_p2',
        'bms_pump1', 'bms_pump2', 'bms_valve', 'cepc_5006'],

    render() {
        return `<div class="grid">
            ${card('Контур приводу', `${stats('cool_temp', 'cepc_5006')}${meter('cool_pump', 'Помпа')}${meter('cool_fan', 'Вентилятор')}`)}
            ${card('Помпа', stats('cool_pump_t', 'cool_pump_v', 'cool_pump_a'))}
            ${card('Контур батареї', stats('bms_pump1', 'bms_pump2', 'bms_valve', 'cool_heater'), { note: 'BMS D000, D005, D006' })}
            ${card('Вакуум гальм', stats('vac_p1', 'vac_p2'))}
            ${card('Напрацювання', stats('cool_pump_h', 'cool_fan_h', 'cool_heater_h', 'vac_h'), { cls: 'wide' })}
        </div>
        <p class="foot-note">Ідентифікатори 20xx, 23xx, 63xx, D0xx блока 0x7E5 взяті з ED_BMSdiag і на цій машині ще не звірялись.</p>`;
    },
};
