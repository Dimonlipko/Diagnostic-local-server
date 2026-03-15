import { addDataListener, removeDataListener } from './ui.js';

const MAX_CHART_POINTS = 300;
const MAX_LOG_ENTRIES = 36000;

let chart = null;
let isChartOpen = false;
let logBuffer = [];
let startTime = null;
let latestTorque = 0;
let onCruiseData = null;
let onTorqueData = null;

let chartData = {
    labels: [],
    speed: [],
    setSpeed: [],
    torqueReq: []
};

async function loadChartJs() {
    if (window.Chart) return;
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = './modules/chart.min.js';
        script.onload = resolve;
        script.onerror = () => reject(new Error('Failed to load Chart.js'));
        document.head.appendChild(script);
    });
}

function createChart() {
    const canvas = document.getElementById('cruiseChart');
    if (!canvas || !window.Chart) return;

    chart = new Chart(canvas, {
        type: 'line',
        data: {
            labels: chartData.labels,
            datasets: [
                {
                    label: 'Speed (km/h)',
                    data: chartData.speed,
                    borderColor: '#3b82f6',
                    backgroundColor: 'rgba(59,130,246,0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    yAxisID: 'y',
                    tension: 0.2
                },
                {
                    label: 'Set Speed (km/h)',
                    data: chartData.setSpeed,
                    borderColor: '#3b82f6',
                    borderDash: [6, 3],
                    borderWidth: 1.5,
                    pointRadius: 0,
                    yAxisID: 'y',
                    tension: 0
                },
                {
                    label: 'Torque (Nm)',
                    data: chartData.torqueReq,
                    borderColor: '#ef4444',
                    backgroundColor: 'rgba(239,68,68,0.1)',
                    borderWidth: 2,
                    pointRadius: 0,
                    yAxisID: 'y1',
                    tension: 0.2
                }
            ]
        },
        options: {
            animation: false,
            responsive: true,
            maintainAspectRatio: false,
            interaction: {
                mode: 'index',
                intersect: false
            },
            scales: {
                x: {
                    title: { display: true, text: 'Time (s)' },
                    ticks: { maxTicksLimit: 10 }
                },
                y: {
                    type: 'linear',
                    position: 'left',
                    title: { display: true, text: 'Speed (km/h)' },
                    min: 0,
                    suggestedMax: 120
                },
                y1: {
                    type: 'linear',
                    position: 'right',
                    title: { display: true, text: 'Torque (Nm)' },
                    grid: { drawOnChartArea: false },
                    suggestedMin: -50,
                    suggestedMax: 200
                }
            },
            plugins: {
                legend: {
                    position: 'top',
                    labels: { usePointStyle: true, boxWidth: 8 }
                }
            }
        }
    });
}

function pushDataPoint(time, speed, setSpd, torque, status) {
    const timeLabel = time.toFixed(1);

    chartData.labels.push(timeLabel);
    chartData.speed.push(speed);
    chartData.setSpeed.push(setSpd);
    chartData.torqueReq.push(torque);

    if (chartData.labels.length > MAX_CHART_POINTS) {
        chartData.labels.shift();
        chartData.speed.shift();
        chartData.setSpeed.shift();
        chartData.torqueReq.shift();
    }

    if (chart) {
        chart.update('none');
    }

    // Always log when chart is open
    if (logBuffer.length < MAX_LOG_ENTRIES) {
        logBuffer.push({ time, speed, setSpd, torque, status });
    }

    updateLogStatus();
}

function updateLogStatus() {
    const el = document.getElementById('logStatus');
    if (el) {
        el.textContent = `${logBuffer.length} rec`;
    }
}

function exportCSV() {
    if (logBuffer.length === 0) return;

    const header = 'timestamp_s,speed_kmh,setSpeed_kmh,torqueReq_Nm,ccStatus\n';
    const rows = logBuffer.map(e =>
        `${e.time.toFixed(2)},${e.speed},${e.setSpd},${e.torque},${e.status}`
    ).join('\n');

    const blob = new Blob([header + rows], { type: 'text/csv' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `cruise_log_${new Date().toISOString().slice(0, 19).replace(/:/g, '-')}.csv`;
    a.click();
    URL.revokeObjectURL(url);
}

function clearLog() {
    logBuffer = [];
    chartData.labels = [];
    chartData.speed = [];
    chartData.setSpeed = [];
    chartData.torqueReq = [];

    if (chart) {
        chart.data.labels = chartData.labels;
        chart.data.datasets[0].data = chartData.speed;
        chart.data.datasets[1].data = chartData.setSpeed;
        chart.data.datasets[2].data = chartData.torqueReq;
        chart.update('none');
    }

    startTime = Date.now();
    updateLogStatus();
}

async function toggleChart() {
    const panel = document.getElementById('chartPanel');
    if (!panel) return;

    isChartOpen = !isChartOpen;
    panel.classList.toggle('open', isChartOpen);

    if (isChartOpen && !chart) {
        try {
            await loadChartJs();
            createChart();
            startTime = Date.now();
            startListening();
        } catch (e) {
            console.error('[CruiseChart] Failed to init chart:', e);
        }
    }
}

function startListening() {
    onCruiseData = (rootKey, data) => {
        if (!isChartOpen) return;
        const now = (Date.now() - startTime) / 1000;
        const speed = parseFloat(data.speed) || 0;
        const setSpd = parseFloat(data.cruiseSetSpeed) || 0;
        const status = data.cruiseStatus || '';
        pushDataPoint(now, speed, setSpd, latestTorque, status);
    };

    onTorqueData = (rootKey, data) => {
        latestTorque = parseInt(data.torqueReq) || 0;
    };

    addDataListener('cruise_info_220501', onCruiseData);
    addDataListener('inverter_info_220304', onTorqueData);
}

export function initCruiseChartPage() {
    const btnChart = document.getElementById('btnToggleChart');
    const btnSaveLog = document.getElementById('btnSaveLog');
    const btnClearLog = document.getElementById('btnClearLog');

    if (btnChart) btnChart.addEventListener('click', toggleChart);
    if (btnSaveLog) btnSaveLog.addEventListener('click', exportCSV);
    if (btnClearLog) btnClearLog.addEventListener('click', clearLog);
}

export function cleanupCruiseChartPage() {
    if (onCruiseData) removeDataListener('cruise_info_220501', onCruiseData);
    if (onTorqueData) removeDataListener('inverter_info_220304', onTorqueData);
    onCruiseData = null;
    onTorqueData = null;

    if (chart) {
        chart.destroy();
        chart = null;
    }

    isChartOpen = false;
    latestTorque = 0;
    logBuffer = [];
    chartData = { labels: [], speed: [], setSpeed: [], torqueReq: [] };
}
