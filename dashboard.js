/**
 * Dashboard / Summary Modal
 */

let chartInstance = null;

async function showSummary(projectId) {
    // Remove any existing
    const existing = document.getElementById('dashboard-overlay');
    if (existing) { existing.remove(); return; }

    const overlay = document.createElement('div');
    overlay.className = 'modal-overlay center-mode';
    overlay.id = 'dashboard-overlay';

    overlay.innerHTML = `
      <div class="modal-dialog">
        <div class="modal-dialog-header">
          <div style="font-size:1.15rem; font-weight:700;">📊 ダッシュボード</div>
          <div style="display:flex; gap:8px; align-items:center;">
            <button id="dash-exp-csv" style="padding:8px 14px; border-radius:10px; border:1px solid rgba(0,184,148,0.4); background:rgba(0,184,148,0.12); color:#55eca0; font-weight:600; cursor:pointer; font-size:0.85rem;">⬇CSV</button>
            <button id="dash-exp-json" style="padding:8px 14px; border-radius:10px; border:1px solid rgba(108,92,231,0.4); background:rgba(108,92,231,0.12); color:#a29bfe; font-weight:600; cursor:pointer; font-size:0.85rem;">⬇JSON</button>
            <button id="dash-close" style="width:36px;height:36px; border-radius:50%; border:1px solid rgba(255,255,255,0.1); background:rgba(255,255,255,0.06); color:#f0f1f6; font-size:1rem; cursor:pointer;">✕</button>
          </div>
        </div>

        <div class="stats-grid">
          <div class="stat-card">
            <div class="stat-label">合計実行時間</div>
            <div class="stat-value" id="d-total-time">--</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">実行回数</div>
            <div class="stat-value" id="d-run-count">--</div>
          </div>
          <div class="stat-card">
            <div class="stat-label">合計オーバー</div>
            <div class="stat-value" style="color:#e17055;" id="d-total-over">--</div>
          </div>
        </div>

        <div class="chart-wrap">
          <canvas id="dash-chart"></canvas>
        </div>

        <h3 style="font-size:0.95rem; color:#8892a4; margin-bottom:8px;">最近の履歴（最大20件）</h3>
        <div style="overflow-x:auto;">
          <table class="history-table">
            <thead>
              <tr>
                <th>開始日時</th>
                <th>タイマー名</th>
                <th>目標</th>
                <th>実測</th>
                <th>差異</th>
              </tr>
            </thead>
            <tbody id="d-history-body"></tbody>
          </table>
        </div>
      </div>
    `;

    document.getElementById('modal-root').appendChild(overlay);

    document.getElementById('dash-close').addEventListener('click', () => overlay.remove());
    overlay.addEventListener('click', e => { if (e.target === overlay) overlay.remove(); });

    document.getElementById('dash-exp-csv').addEventListener('click', () => dashExport('csv', projectId));
    document.getElementById('dash-exp-json').addEventListener('click', () => dashExport('json', projectId));

    await renderDashData(projectId);
}

async function renderDashData(projectId) {
    const runs = await Storage.getRuns(projectId);

    let totalSec = 0, totalOverSec = 0;

    const sorted = [...runs].sort((a, b) => new Date(b.startTimestamp) - new Date(a.startTimestamp));

    const tbody = document.getElementById('d-history-body');
    tbody.innerHTML = '';

    sorted.slice(0, 20).forEach(r => {
        totalSec += r.durationSec || 0;
        if (r.overrunSec > 0) totalOverSec += r.overrunSec;

        const dt = new Date(r.startTimestamp);
        const diffStr = r.overrunSec > 0
            ? `<span style="color:#e17055">+${r.overrunSec.toFixed(2)}s</span>`
            : `<span style="color:#00b894">${(r.finalRemainingSec || 0).toFixed(2)}s 残</span>`;

        tbody.innerHTML += `
          <tr>
            <td style="white-space:nowrap">${dt.toLocaleString()}</td>
            <td>${dashEsc(r.titleSnapshot)}</td>
            <td style="font-family:monospace">${dashFmt(r.targetSeconds)}</td>
            <td style="font-family:monospace">${dashFmt(r.durationSec)}</td>
            <td style="font-family:monospace">${diffStr}</td>
          </tr>
        `;
    });

    document.getElementById('d-run-count').textContent = runs.length;
    document.getElementById('d-total-time').textContent = dashFmt(totalSec);
    document.getElementById('d-total-over').textContent = dashFmt(totalOverSec);

    dashRenderChart(runs);
}

function dashRenderChart(runs) {
    const ctx = document.getElementById('dash-chart');
    if (!ctx) return;
    if (chartInstance) { chartInstance.destroy(); chartInstance = null; }

    const daily = {};
    runs.forEach(r => {
        const d = (r.startTimestamp || '').split('T')[0];
        if (!d) return;
        if (!daily[d]) daily[d] = { target: 0, actual: 0 };
        daily[d].target += (r.targetSeconds || 0) / 60;
        daily[d].actual += (r.durationSec || 0) / 60;
    });

    const labels = Object.keys(daily).sort();
    if (labels.length === 0) return;

    Chart.defaults.color = '#8892a4';
    Chart.defaults.font.family = 'Inter, sans-serif';

    chartInstance = new Chart(ctx, {
        type: 'bar',
        data: {
            labels,
            datasets: [
                { label: '目標 (分)', data: labels.map(l => +daily[l].target.toFixed(1)), backgroundColor: 'rgba(0,206,201,0.35)', borderColor: 'rgba(0,206,201,1)', borderWidth: 1 },
                { label: '実測 (分)', data: labels.map(l => +daily[l].actual.toFixed(1)), backgroundColor: 'rgba(108,92,231,0.55)', borderColor: 'rgba(108,92,231,1)', borderWidth: 1 }
            ]
        },
        options: {
            responsive: true, maintainAspectRatio: false,
            scales: {
                y: { beginAtZero: true, grid: { color: 'rgba(255,255,255,0.07)' } },
                x: { grid: { color: 'rgba(255,255,255,0.07)' } }
            },
            plugins: { legend: { position: 'top' }, title: { display: true, text: '日別活動推移' } }
        }
    });
}

async function dashExport(format, projectId) {
    const runs = await Storage.getRuns(projectId);
    let blob, filename;
    const d = new Date().toISOString().split('T')[0];

    if (format === 'csv') {
        const h = ['runId', 'presetId', 'title', 'startTimestamp', 'endTimestamp', 'durationSec', 'targetSeconds', 'overrunSec', 'finalRemainingSec', 'manualEnd'];
        const rows = [h.join(',')];
        runs.forEach(r => {
            rows.push([r.runId, r.presetId, `"${dashEsc(r.titleSnapshot)}"`, r.startTimestamp, r.endTimestamp,
            (r.durationSec || 0).toFixed(3), r.targetSeconds, (r.overrunSec || 0).toFixed(3),
            (r.finalRemainingSec || 0).toFixed(3), r.manualEnd].join(','));
        });
        blob = new Blob(['\uFEFF' + rows.join('\n')], { type: 'text/csv;charset=utf-8' });
        filename = `timer_runs_${d}.csv`;
    } else {
        const data = { exportDate: new Date().toISOString(), projectId, runs, presets: await Storage.getPresets(projectId) };
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `timer_backup_${d}.json`;
    }

    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url; a.download = filename; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function dashFmt(sec) {
    if (!sec || sec <= 0) return '00:00:00';
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), s = Math.floor(sec % 60);
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

function dashEsc(s) {
    return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}
