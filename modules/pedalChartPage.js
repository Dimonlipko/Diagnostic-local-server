import { addDataListener, removeDataListener } from './ui.js';

// Calibration data (from ECU params)
let cal = {
    notPressed: 0,
    torqueNotPressed: 0,
    pedalMin: 0,
    pedalMax: 1000,
    pedalCal: 500,
    torqueCal: 0,
    maxTorque: 0
};

// Live data
let livePedal = 0;
let liveTorque = 0;

// Listeners
let listeners = [];

function addListener(key, cb) {
    addDataListener(key, cb);
    listeners.push({ key, cb });
}

/**
 * Interpolate torque for a given pedal position using the calibration curve
 */
function torqueAtPedal(pedal) {
    if (pedal <= cal.notPressed) return cal.torqueNotPressed;
    if (pedal <= cal.pedalMin) {
        // Linear: notPressed->pedalMin maps torqueNotPressed->0
        const t = (pedal - cal.notPressed) / (cal.pedalMin - cal.notPressed || 1);
        return cal.torqueNotPressed * (1 - t);
    }
    if (pedal <= cal.pedalCal) {
        // Linear: pedalMin->pedalCal maps 0->torqueCal
        const t = (pedal - cal.pedalMin) / (cal.pedalCal - cal.pedalMin || 1);
        return cal.torqueCal * t;
    }
    if (pedal <= cal.pedalMax) {
        // Linear: pedalCal->pedalMax maps torqueCal->maxTorque
        const t = (pedal - cal.pedalCal) / (cal.pedalMax - cal.pedalCal || 1);
        return cal.torqueCal + (cal.maxTorque - cal.torqueCal) * t;
    }
    return cal.maxTorque;
}

function draw() {
    const canvas = document.getElementById('pedalChart');
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    const dpr = window.devicePixelRatio || 1;

    // Set canvas size to CSS size
    const rect = canvas.getBoundingClientRect();
    canvas.width = rect.width * dpr;
    canvas.height = rect.height * dpr;
    ctx.scale(dpr, dpr);

    const W = rect.width;
    const H = rect.height;
    const pad = { top: 20, right: 20, bottom: 40, left: 55 };
    const gW = W - pad.left - pad.right;
    const gH = H - pad.top - pad.bottom;

    ctx.clearRect(0, 0, W, H);

    // Determine data ranges
    const xMin = Math.min(cal.notPressed, 0);
    const xMax = Math.max(cal.pedalMax, cal.pedalCal, 1);
    const yMin = Math.min(cal.torqueNotPressed, 0);
    const yMax = Math.max(cal.maxTorque, cal.torqueCal, 1);

    // Coordinate transforms
    const toX = (v) => pad.left + ((v - xMin) / (xMax - xMin)) * gW;
    const toY = (v) => pad.top + gH - ((v - yMin) / (yMax - yMin)) * gH;

    // --- Grid & Axes ---
    const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        window.matchMedia('(prefers-color-scheme: dark)').matches;
    const axisColor = isDark ? '#888' : '#999';
    const gridColor = isDark ? '#333' : '#e0e0e0';
    const textColor = isDark ? '#ccc' : '#555';

    ctx.strokeStyle = gridColor;
    ctx.lineWidth = 0.5;

    // Horizontal grid lines
    const ySteps = 5;
    for (let i = 0; i <= ySteps; i++) {
        const val = yMin + (yMax - yMin) * i / ySteps;
        const y = toY(val);
        ctx.beginPath();
        ctx.moveTo(pad.left, y);
        ctx.lineTo(W - pad.right, y);
        ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = axisColor;
    ctx.lineWidth = 1;

    // X-axis at torque=0
    const y0 = toY(0);
    ctx.beginPath();
    ctx.moveTo(pad.left, y0);
    ctx.lineTo(W - pad.right, y0);
    ctx.stroke();

    // Y-axis
    ctx.beginPath();
    ctx.moveTo(pad.left, pad.top);
    ctx.lineTo(pad.left, H - pad.bottom);
    ctx.stroke();

    // Axis labels
    ctx.fillStyle = textColor;
    ctx.font = '11px Roboto, sans-serif';
    ctx.textAlign = 'center';

    // X-axis labels
    for (let i = 0; i <= 4; i++) {
        const val = xMin + (xMax - xMin) * i / 4;
        ctx.fillText(Math.round(val), toX(val), H - pad.bottom + 15);
    }

    // Y-axis labels
    ctx.textAlign = 'right';
    for (let i = 0; i <= ySteps; i++) {
        const val = yMin + (yMax - yMin) * i / ySteps;
        ctx.fillText(Math.round(val), pad.left - 5, toY(val) + 4);
    }

    // Axis titles
    ctx.fillStyle = textColor;
    ctx.font = '12px Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText('Pedal', W / 2, H - 3);

    ctx.save();
    ctx.translate(12, H / 2);
    ctx.rotate(-Math.PI / 2);
    ctx.fillText('Nm', 0, 0);
    ctx.restore();

    // --- Calibration curve: 3 segments ---
    const points = [
        { x: cal.notPressed, y: cal.torqueNotPressed },
        { x: cal.pedalMin, y: 0 },
        { x: cal.pedalCal, y: cal.torqueCal },
        { x: cal.pedalMax, y: cal.maxTorque }
    ];

    const segColors = ['#22c55e', '#3b82f6', '#ef4444']; // green, blue, red

    for (let i = 0; i < points.length - 1; i++) {
        ctx.strokeStyle = segColors[i];
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.moveTo(toX(points[i].x), toY(points[i].y));
        ctx.lineTo(toX(points[i + 1].x), toY(points[i + 1].y));
        ctx.stroke();
    }

    // Calibration points (dots)
    ctx.fillStyle = '#3b82f6';
    for (const p of points) {
        ctx.beginPath();
        ctx.arc(toX(p.x), toY(p.y), 4, 0, Math.PI * 2);
        ctx.fill();
    }

    // --- Live pedal dot ---
    const liveX = toX(livePedal);
    const liveY = toY(liveTorque);

    // Clamp to chart area
    const cx = Math.max(pad.left, Math.min(W - pad.right, liveX));
    const cy = Math.max(pad.top, Math.min(H - pad.bottom, liveY));

    // Glow
    ctx.shadowColor = '#f59e0b';
    ctx.shadowBlur = 10;
    ctx.fillStyle = '#f59e0b';
    ctx.beginPath();
    ctx.arc(cx, cy, 6, 0, Math.PI * 2);
    ctx.fill();
    ctx.shadowBlur = 0;

    // White center
    ctx.fillStyle = '#fff';
    ctx.beginPath();
    ctx.arc(cx, cy, 2.5, 0, Math.PI * 2);
    ctx.fill();
}

export function initPedalChartPage() {
    const canvas = document.getElementById('pedalChart');
    if (!canvas) return;

    // Listen to calibration params
    addListener('inverter_info_220305', (key, data) => {
        cal.pedalMin = parseFloat(data.pedalMin) || 0;
        cal.pedalMax = parseFloat(data.pedalMax) || 1000;
        draw();
    });

    addListener('inverter_info_220307', (key, data) => {
        cal.torqueCal = parseFloat(data.torqueCal) || 0;
        cal.pedalCal = parseFloat(data.pedalCal) || 0;
        cal.torqueNotPressed = parseInt(data.torqueNotPressed) || 0;
        draw();
    });

    addListener('inverter_info_220308', (key, data) => {
        cal.notPressed = parseFloat(data.notPressed) || 0;
        draw();
    });

    addListener('inverter_info_220304', (key, data) => {
        cal.maxTorque = parseFloat(data.maxTorque) || 0;
        liveTorque = parseInt(data.torqueReq) || 0;
        draw();
    });

    addListener('inverter_info_220303', (key, data) => {
        livePedal = parseFloat(data.pedal) || 0;
        draw();
    });

    // Initial draw
    draw();

    // Redraw on resize
    window._pedalChartResize = () => draw();
    window.addEventListener('resize', window._pedalChartResize);
}

export function cleanupPedalChartPage() {
    for (const { key, cb } of listeners) {
        removeDataListener(key, cb);
    }
    listeners = [];
    livePedal = 0;
    liveTorque = 0;
    cal = {
        notPressed: 0, torqueNotPressed: 0,
        pedalMin: 0, pedalMax: 1000,
        pedalCal: 500, torqueCal: 0, maxTorque: 0
    };

    if (window._pedalChartResize) {
        window.removeEventListener('resize', window._pedalChartResize);
        delete window._pedalChartResize;
    }
}
