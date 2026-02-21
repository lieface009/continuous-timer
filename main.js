/**
 * 連続式タイマーくん - Main Application
 */

// ===== State =====
let currentProjectId = 'p-1';
let presets = [];
let activePresetId = null;
let listOpen = true;

// ===== Timer Engine =====
const engine = new TimerEngine(
    // onTick
    (state) => updateTimerDisplay(state),
    // onEnd
    async (runData) => {
        runData.presetId = activePresetId;
        runData.projectId = currentProjectId;
        const preset = presets.find(p => p.id === activePresetId);
        runData.titleSnapshot = preset ? preset.title : '不明なタイマー';
        await Storage.saveRun(runData);
        renderActiveView(preset);
        // Auto-next
        const autoNext = await Storage.getSetting('autoStartNext', false);
        if (autoNext && preset) {
            const idx = presets.findIndex(p => p.id === preset.id);
            if (idx !== -1 && idx < presets.length - 1) {
                showToast('⏭ 次のタイマーへ移行します');
                setTimeout(() => {
                    selectPreset(presets[idx + 1].id);
                    startTimer();
                }, 800);
            }
        }
    }
);

engine.onTargetReached = () => {
    AudioManager.playBuiltin('chime1');
    const preset = presets.find(p => p.id === activePresetId);
    if (preset?.reminder?.vibratePattern) AudioManager.vibrate(preset.reminder.vibratePattern);
};

engine.onPreAlert = () => AudioManager.playBuiltin('short');

// ===== DOM Refs =====
const elMain = document.getElementById('timer-main');
const elEmptyHint = document.getElementById('empty-hint');
const elPresetList = document.getElementById('preset-list');
const elListCount = document.getElementById('list-count');
const elListBody = document.getElementById('timer-list-body');
const elListToggleIcon = document.getElementById('list-toggle-icon');
const elModalRoot = document.getElementById('modal-root');
const elToast = document.getElementById('toast');

// ===== Init =====
async function initApp() {
    await Storage.seedDefaultProject();
    await loadPresets();

    // Sortable list (touch + mouse)
    new Sortable(elPresetList, {
        handle: '.drag-handle',
        animation: 180,
        ghostClass: 'sortable-ghost',
        dragClass: 'sortable-drag',
        forceFallback: false,
        onEnd: async () => {
            const ids = Array.from(elPresetList.children).map(li => li.dataset.id);
            presets.forEach(p => { p.order = ids.indexOf(p.id); });
            await Storage.updateOrders(presets);
            await loadPresets();
        }
    });

    // ---- Button bindings ----
    document.getElementById('btn-add').addEventListener('click', addNewPreset);
    document.getElementById('btn-save').addEventListener('click', handleSave);
    document.getElementById('btn-settings').addEventListener('click', showSettingsModal);
    document.getElementById('btn-data').addEventListener('click', showDataModal);
    document.getElementById('btn-dashboard').addEventListener('click', () => showSummary(currentProjectId));

    // List drawer toggle
    document.getElementById('list-panel-toggle').addEventListener('click', () => {
        listOpen = !listOpen;
        elListBody.classList.toggle('open', listOpen);
        elListToggleIcon.textContent = listOpen ? '▲' : '▼';
    });

    // Audio unlock on first touch
    document.body.addEventListener('click', () => { if (!AudioManager.enabled) AudioManager.enable(); }, { once: true });
}

// ===== Load & Render Presets =====
async function loadPresets() {
    presets = await Storage.getPresets(currentProjectId);
    renderPresetList();
    elListCount.textContent = presets.length;
    elEmptyHint.style.display = presets.length === 0 ? 'block' : 'none';

    // Keep active view if still valid
    if (activePresetId) {
        const p = presets.find(p => p.id === activePresetId);
        if (p && engine.state === 'idle') renderActiveView(p);
    }
}

function renderPresetList() {
    elPresetList.innerHTML = '';
    presets.forEach(preset => {
        const li = document.createElement('li');
        li.className = 'preset-item' + (activePresetId === preset.id ? ' active' : '');
        li.dataset.id = preset.id;

        const targetStr = fmtTime(preset.targetSeconds);

        li.innerHTML = `
      <span class="drag-handle">⠿</span>
      <div class="preset-info">
        <div class="preset-name">${esc(preset.title)}</div>
        <div class="preset-time-label">⏱ ${targetStr}</div>
      </div>
      <div class="preset-actions">
        <button class="icon-btn" data-action="edit" title="編集">✏️</button>
        <button class="icon-btn danger" data-action="delete" title="削除">🗑️</button>
      </div>
    `;

        li.addEventListener('click', e => {
            const btn = e.target.closest('[data-action]');
            if (btn) {
                const a = btn.dataset.action;
                if (a === 'delete') { if (confirm(`「${preset.title}」を削除しますか？`)) deletePreset(preset.id); }
                if (a === 'edit') showEditModal(preset);
            } else {
                selectPreset(preset.id);
            }
        });

        elPresetList.appendChild(li);
    });
}

// ===== Active View =====
function selectPreset(id) {
    if (engine.state !== 'idle') {
        if (!confirm('現在の計測を停止して切り替えますか？')) return;
        engine.stop(true, '手動切替');
    }
    activePresetId = id;
    const p = presets.find(p => p.id === id);
    if (p) renderActiveView(p);
    renderPresetList();
}

function renderActiveView(preset) {
    elEmptyHint.style.display = 'none';

    // Remove old view if exists
    const old = document.getElementById('active-view');
    if (old) old.remove();

    if (!preset) {
        elEmptyHint.style.display = presets.length === 0 ? 'block' : 'none';
        return;
    }

    const targetStr = fmtTime(preset.targetSeconds);

    const div = document.createElement('div');
    div.className = 'active-view';
    div.id = 'active-view';
    div.innerHTML = `
    <div class="timer-name-row">
      <div class="timer-title">${esc(preset.title)}</div>
      <button class="btn-edit-timer" id="btn-quick-edit" title="編集">✏️</button>
    </div>
    <div class="timer-clock-wrap">
      <div class="timer-display" id="v-display">${targetStr}</div>
      <div class="timer-target-sub" id="v-target-sub">目標 ${targetStr}</div>
      <div class="overrun-badge" id="v-overrun-badge" style="display:none"></div>
    </div>
    <div class="main-controls">
      <button class="ctrl-btn btn-start" id="btn-start">▶ スタート</button>
      <button class="ctrl-btn btn-pause" id="btn-pause" style="display:none">⏸ 一時停止</button>
      <button class="ctrl-btn btn-stop" id="btn-stop" style="display:none">■ 停止</button>
    </div>
    <div id="auto-next-hint" style="display:none" class="auto-next-hint">⏭ 自動次タイマー: ON</div>
  `;

    elMain.appendChild(div);

    // Bind controls
    document.getElementById('btn-start').addEventListener('click', startTimer);
    document.getElementById('btn-pause').addEventListener('click', pauseTimer);
    document.getElementById('btn-stop').addEventListener('click', stopTimer);
    document.getElementById('btn-quick-edit').addEventListener('click', () => showEditModal(preset));

    // Show auto-next hint
    Storage.getSetting('autoStartNext', false).then(on => {
        const hint = document.getElementById('auto-next-hint');
        if (hint) hint.style.display = on ? 'block' : 'none';
    });
}

// ===== Timer Controls =====
function startTimer() {
    AudioManager.enable();
    const preset = presets.find(p => p.id === activePresetId);
    if (!preset) return;

    engine.setTarget(preset.targetSeconds, preset.reminder?.sound?.preAlertSec || 0);
    engine.start();

    document.getElementById('btn-start').style.display = 'none';
    document.getElementById('btn-pause').style.display = '';
    document.getElementById('btn-stop').style.display = '';
}

function pauseTimer() {
    engine.pause();
    const btnStart = document.getElementById('btn-start');
    const btnPause = document.getElementById('btn-pause');
    btnStart.style.display = '';
    btnStart.innerHTML = '▶ 再開';
    btnPause.style.display = 'none';
}

function stopTimer() {
    engine.stop(true, '');
}

function updateTimerDisplay({ remainingSec, isOverrun, formattedDisplay }) {
    const d = document.getElementById('v-display');
    const badge = document.getElementById('v-overrun-badge');
    if (!d) return;

    d.textContent = formattedDisplay;
    if (isOverrun) {
        d.classList.add('overrun');
        if (badge) {
            badge.style.display = '';
            badge.textContent = `OVER +${Math.abs(remainingSec).toFixed(2)}s`;
        }
    } else {
        d.classList.remove('overrun');
        if (badge) badge.style.display = 'none';
    }
}

// ===== Save =====
async function handleSave() {
    showToast('💾 保存しました');
}

// ===== Add / Delete Presets =====
async function addNewPreset() {
    const id = 'preset-' + Date.now();
    const newPreset = {
        id,
        projectId: currentProjectId,
        title: '新しいタイマー',
        targetSeconds: 300, // 5分
        order: presets.length,
        reminder: { sound: { type: 'builtin', name: 'chime1', volume: 80, loop: false, preAlertSec: 0 }, vibratePattern: [200, 100, 200] }
    };
    await Storage.savePreset(newPreset);
    await loadPresets();
    showEditModal(newPreset);
}

async function deletePreset(id) {
    await Storage.deletePreset(id);
    if (activePresetId === id) {
        activePresetId = null;
        const old = document.getElementById('active-view');
        if (old) old.remove();
        elEmptyHint.style.display = presets.length <= 1 ? 'block' : 'none';
    }
    await loadPresets();
}

// ===== Edit Modal =====
function showEditModal(preset) {
    closeModal();

    const h = Math.floor(preset.targetSeconds / 3600);
    const m = Math.floor((preset.targetSeconds % 3600) / 60);
    const s = Math.round(preset.targetSeconds % 60);

    const overlay = createOverlay();
    overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-sheet-handle"></div>
      <div class="modal-title">✏️ タイマーを編集</div>

      <div class="modal-section">
        <div class="modal-label">タイマー名</div>
        <input class="name-input" id="edit-name" type="text" value="${esc(preset.title)}" maxlength="30" placeholder="タイマー名">
      </div>

      <div class="modal-section">
        <div class="modal-label">目標時間</div>
        <div class="time-picker">
          <div class="time-picker-unit">
            <label>時間</label>
            <input class="time-picker-input" id="edit-h" type="number" min="0" max="23" value="${h}">
          </div>
          <span class="time-separator">:</span>
          <div class="time-picker-unit">
            <label>分</label>
            <input class="time-picker-input" id="edit-m" type="number" min="0" max="59" value="${m}">
          </div>
          <span class="time-separator">:</span>
          <div class="time-picker-unit">
            <label>秒</label>
            <input class="time-picker-input" id="edit-s" type="number" min="0" max="59" value="${s}">
          </div>
        </div>
      </div>

      <button class="modal-save-btn" id="edit-save-btn">✔ 保存する</button>
    </div>
  `;

    elModalRoot.appendChild(overlay);

    document.getElementById('edit-name').focus();

    document.getElementById('edit-save-btn').addEventListener('click', async () => {
        const title = document.getElementById('edit-name').value.trim() || 'タイマー';
        const h2 = parseInt(document.getElementById('edit-h').value) || 0;
        const m2 = parseInt(document.getElementById('edit-m').value) || 0;
        const s2 = parseInt(document.getElementById('edit-s').value) || 0;
        const totalSec = h2 * 3600 + m2 * 60 + s2;

        if (totalSec <= 0) { showToast('❌ 1秒以上の時間を設定してください'); return; }

        preset.title = title;
        preset.targetSeconds = totalSec;
        await Storage.savePreset(preset);
        await loadPresets();

        if (activePresetId === preset.id && engine.state === 'idle') renderActiveView(preset);
        closeModal();
        showToast('✔ 保存しました');
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
}

// ===== Settings Modal =====
async function showSettingsModal() {
    closeModal();
    const autoNext = await Storage.getSetting('autoStartNext', false);

    const overlay = createOverlay();
    overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-sheet-handle"></div>
      <div class="modal-title">⚙️ 設定</div>

      <div class="modal-section">
        <div class="modal-label">タイマー動作</div>

        <label class="toggle-row">
          <div>
            <div class="toggle-text">自動的に次のタイマーへ移行</div>
            <div class="toggle-sub">タイマーが止まると自動で次の項目を開始します</div>
          </div>
          <div class="toggle-switch">
            <input type="checkbox" id="chk-auto-next" ${autoNext ? 'checked' : ''}>
            <span class="toggle-knob"></span>
          </div>
        </label>
      </div>

      <button class="modal-save-btn" id="settings-save-btn">✔ 設定を保存</button>
    </div>
  `;

    elModalRoot.appendChild(overlay);

    document.getElementById('settings-save-btn').addEventListener('click', async () => {
        const v = document.getElementById('chk-auto-next').checked;
        await Storage.saveSetting('autoStartNext', v);
        // update hint if active view shown
        const hint = document.getElementById('auto-next-hint');
        if (hint) hint.style.display = v ? 'block' : 'none';
        closeModal();
        showToast('⚙️ 設定を保存しました');
    });

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
}

// ===== Data Modal =====
function showDataModal() {
    closeModal();

    const overlay = createOverlay();
    overlay.innerHTML = `
    <div class="modal-sheet">
      <div class="modal-sheet-handle"></div>
      <div class="modal-title">📦 データ操作</div>

      <div class="modal-section">
        <div class="modal-label">エクスポート</div>
        <button class="action-btn success" id="exp-csv">
          <span class="btn-icon-big">⬇️</span>
          <div><div>CSVでダウンロード</div><small>Excelで開けます</small></div>
        </button>
        <button class="action-btn primary" id="exp-json">
          <span class="btn-icon-big">⬇️</span>
          <div><div>JSONでダウンロード</div><small>バックアップ用</small></div>
        </button>
      </div>

      <div class="modal-section">
        <div class="modal-label">インポート</div>
        <button class="action-btn" id="imp-json">
          <span class="btn-icon-big">⬆️</span>
          <div><div>JSONを読み込む</div><small>以前のバックアップを復元</small></div>
        </button>
        <input type="file" id="file-input" accept=".json" style="display:none">
      </div>

      <div class="modal-section">
        <div class="modal-label">危険な操作</div>
        <button class="action-btn danger" id="clear-runs">
          <span class="btn-icon-big">🗑️</span>
          <div><div>計測履歴をすべて削除</div><small>この操作は元に戻せません</small></div>
        </button>
      </div>
    </div>
  `;

    elModalRoot.appendChild(overlay);

    document.getElementById('exp-csv').addEventListener('click', () => exportData('csv'));
    document.getElementById('exp-json').addEventListener('click', () => exportData('json'));
    document.getElementById('imp-json').addEventListener('click', () => document.getElementById('file-input').click());
    document.getElementById('file-input').addEventListener('change', importJson);
    document.getElementById('clear-runs').addEventListener('click', clearRunHistory);

    overlay.addEventListener('click', e => { if (e.target === overlay) closeModal(); });
}

// ===== Export / Import =====
async function exportData(format) {
    const runs = await Storage.getRuns(currentProjectId);
    let blob, filename;

    if (format === 'csv') {
        const headers = ['runId', 'presetId', 'title', 'startTimestamp', 'endTimestamp', 'durationSec', 'targetSeconds', 'overrunSec', 'finalRemainingSec', 'manualEnd'];
        const lines = [headers.join(',')];
        runs.forEach(r => {
            lines.push([
                r.runId, r.presetId, `"${esc(r.titleSnapshot)}"`,
                r.startTimestamp, r.endTimestamp,
                r.durationSec?.toFixed(3), r.targetSeconds,
                r.overrunSec?.toFixed(3), r.finalRemainingSec?.toFixed(3), r.manualEnd
            ].join(','));
        });
        blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8' });
        filename = `timer_export_${today()}.csv`;
    } else {
        const data = {
            exportDate: new Date().toISOString(),
            projectId: currentProjectId,
            runs,
            presets: await Storage.getPresets(currentProjectId)
        };
        blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        filename = `timer_export_${today()}.json`;
    }

    downloadBlob(blob, filename);
    showToast('⬇️ ダウンロードしました');
}

async function importJson(e) {
    const file = e.target.files[0];
    if (!file) return;
    try {
        const text = await file.text();
        const data = JSON.parse(text);
        if (data.presets) {
            for (const p of data.presets) await Storage.savePreset(p);
        }
        if (data.runs) {
            for (const r of data.runs) await Storage.saveRun(r);
        }
        await loadPresets();
        closeModal();
        showToast('✔ インポートしました');
    } catch {
        showToast('❌ ファイルが正しくありません');
    }
}

async function clearRunHistory() {
    if (!confirm('計測履歴をすべて削除しますか？この操作は元に戻せません。')) return;
    // We'll delete via getAll + delete each
    const runs = await Storage.getRuns(currentProjectId);
    for (const r of runs) {
        await Storage.deleteRun(r.runId);
    }
    closeModal();
    showToast('🗑️ 履歴を削除しました');
}

// ===== Modal Helpers =====
function createOverlay() {
    const div = document.createElement('div');
    div.className = 'modal-overlay';
    div.id = 'modal-overlay';
    return div;
}

function closeModal() {
    const m = document.getElementById('modal-overlay');
    if (m) m.remove();
}

// ===== Toast =====
let toastTimer = null;
function showToast(msg) {
    elToast.textContent = msg;
    elToast.classList.add('show');
    if (toastTimer) clearTimeout(toastTimer);
    toastTimer = setTimeout(() => elToast.classList.remove('show'), 2400);
}

// ===== Helpers =====
function fmtTime(sec) {
    if (!sec || sec < 0) sec = 0;
    const h = Math.floor(sec / 3600);
    const m = Math.floor((sec % 3600) / 60);
    const s = Math.round(sec % 60);
    if (h > 0) return `${pad(h)}:${pad(m)}:${pad(s)}`;
    return `${pad(m)}:${pad(s)}`;
}

function pad(n) { return String(n).padStart(2, '0'); }
function esc(s) { return (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;'); }
function today() { return new Date().toISOString().split('T')[0]; }
function downloadBlob(blob, name) {
    const u = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = u; a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(u), 1000);
}

// ===== Boot =====
document.addEventListener('DOMContentLoaded', initApp);
