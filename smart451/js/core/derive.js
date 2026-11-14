// --- js/core/derive.js ---
// Величини, яких немає на шині: рахуються з того, що вже прочитано.

export function derive(store) {
    const { get, set, fresh } = store;

    const soc = fresh('soc_avg') ?? fresh('soc_dash');
    if (soc !== null) set('soc_main', soc);

    // 0x448 частину часу віддає 0x1FFF («нема даних»), тоді напруга — від BMS.
    const hv = fresh('hv') ?? fresh('bms_hv1') ?? fresh('cepc_5326');
    if (hv !== null) set('hv_main', hv);
    const amps = fresh('amps') ?? fresh('bms_amps');
    if (hv !== null && amps !== null) set('power_kw', (hv * amps) / 1000);

    const trip = fresh('trip_start');
    const energy = fresh('energy_start');
    if (trip > 0.5 && energy !== null) set('consumption', (energy / trip) * 100);

    const phases = [1, 2, 3]
        .map((n) => (fresh(`obl_ac_v${n}`) ?? 0) * (fresh(`obl_ac_a${n}`) ?? 0))
        .reduce((a, v) => a + v, 0);
    const dc = (fresh('obl_dc_v') ?? 0) * (fresh('obl_dc_a') ?? 0);
    if (phases > 0) set('ac_kw', phases / 1000);
    if (dc > 0) set('dc_kw', dc / 1000);
    if (phases > 100 && dc > 0) set('chg_eff', (dc / phases) * 100);
}
