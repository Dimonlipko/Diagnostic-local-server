// Enum decoders + short descriptions for ccs32clara params.
// Keyed by Clara param name (matches JSON 0x5001 keys exactly).

export const ENUM_MAPS = {
    opmode: {
        0: 'NotYetInitialized', 1: 'Connecting', 2: 'SessionSetup',
        3: 'ServiceDiscovery', 4: 'ChargeParameterDiscovery', 5: 'CableCheck',
        6: 'PreCharge', 7: 'ContactorsClosed', 8: 'CurrentDemand',
        9: 'WeldingDetection', 10: 'SessionStop'
    },
    PortState: {
        0: 'Idle', 1: 'PluggedIn', 2: 'Ready', 3: 'ChargingAC',
        4: 'ChargingDC', 5: 'Stopping', 6: 'Unlock', 7: 'PortError'
    },
    StopReason: {
        0: 'None', 1: 'Button', 2: 'MissingEnable', 3: 'CANTimeout',
        4: 'ChargerShutdown', 5: 'AccuFull', 6: 'ChargerEmergency',
        7: 'InletOverheat', 8: 'EvseMalfunction', 9: 'InletVDeviation'
    },
    LimitationReason: { 0: 'None', 1: 'Charger', 2: 'Battery', 3: 'InletHot' },
    LockState:        { 0: 'None', 1: 'Open', 2: 'Closed', 3: 'Opening', 4: 'Closing' },
    AcObcState:       { 0: 'Idle', 1: 'Lock', 2: 'Charge', 3: 'Pause', 4: 'Complete', 5: 'Error' },
    DemoControl:      { 0: 'CAN', 1: 'StandAlone' },
    AcChargeControl:  { 0: 'CAN', 1: 'StandAlone' },
    CanSpeed:         { 0: '125k', 1: '250k', 2: '500k', 3: '800k', 4: '1M' },
    InletVtgSrc:      { 0: 'ChargerOutput', 1: 'InletAdc' },

    // Boolean flags (1-bit and 8-bit)
    enable:                    { 0: 'No', 1: 'Yes' },
    BasicAcCharging:           { 0: 'No', 1: 'Yes' },
    ButtonPushed:              { 0: 'No', 1: 'Yes' },
    CanAwake:                  { 0: 'No', 1: 'Yes' },
    VehicleSideIsoMonAllowed:  { 0: 'No', 1: 'Yes' },
    PlugPresent:               { 0: 'Unplugged', 1: 'Plugged' }
};

export const DESCRIPTIONS = {
    opmode: 'V2G state machine (PEV side)',
    PortState: 'Charge port high-level state',
    StopReason: 'Why charging stopped (last cause)',
    LimitationReason: 'Why current is limited',
    EVTargetCurrent: 'Current the car asks for, A',
    TempLimitedCurrent: 'Current cap from inlet temp, A',
    LockState: 'Charge lock motor state',
    EvsePresentVoltage: 'Voltage measured at EVSE output, V',
    EvseCurrent: 'Current measured at EVSE output, A',
    EvseMaxVoltage: 'EVSE-advertised maximum V',
    EvseMaxCurrent: 'EVSE-advertised maximum A',
    ControlPilotDuty: 'CP PWM duty, %',
    PlugPresent: 'PP signal: cable plugged?',
    ResistanceProxPilot: 'PP resistance, Ω (cable rating)',
    CableCurrentLimit: 'Cable rating from PP, A',
    MaxTemp: 'Hottest of inlet temps, °C',
    ContactorDuty: 'Contactor PWM, %',
    AcObcState: 'On-board charger AC state',
    BasicAcCharging: 'Type 2 basic AC charging mode',
    EvseAcCurrentLimit: 'AC EVSE max current (CP duty), A',
    temp1: 'Inlet positive pin temp, °C',
    temp2: 'Inlet negative pin temp, °C',
    temp3: 'Aux temp sensor, °C',
    lasterr: 'Last error code',
    checkpoint: 'Diagnostic checkpoint counter',
    CanWatchdog: 'CAN watchdog (×10 ms)',
    BatteryVoltage: 'Battery V from ECU',
    TargetVoltage: 'ECU-requested target V',
    ChargeCurrent: 'ECU-requested current, A',
    soc: 'Battery SOC, %',
    enable: 'Charging enable from ECU',
    MaxVoltage: 'Battery hard V limit',
    MaxCurrent: 'Battery hard I limit, A',
    MaxPower: 'Battery hard P limit, W',
    NodeId: 'CANopen node id (1..63). Reset required.',
    CanSpeed: 'CAN bus speed. Reset required.',
    DemoControl: 'CAN-controlled vs StandAlone test mode',
    AcChargeControl: 'CAN-controlled vs StandAlone AC mode',
    InletVtgSrc: 'Inlet voltage source (HW dependent)'
};

export function decodeEnum(paramName, value) {
    const map = ENUM_MAPS[paramName];
    if (!map) return null;
    const k = Math.round(value);
    return map[k] || null;
}
