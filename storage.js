/**
 * IndexedDB Wrapper Module
 */

const DB_NAME = 'continuous-timer-db';
const DB_VERSION = 1;

/** @type {IDBDatabase | null} */
let dbInstance = null;

async function initDB() {
  if (dbInstance) return dbInstance;

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (e) => reject(`IndexedDB error: ${e.target.error}`);

    request.onsuccess = (e) => {
      dbInstance = e.target.result;
      resolve(dbInstance);
    };

    request.onupgradeneeded = (e) => {
      const db = e.target.result;

      // projects (keyPath: id)
      if (!db.objectStoreNames.contains('projects')) {
        db.createObjectStore('projects', { keyPath: 'id' });
      }

      // timerPresets (keyPath: id, index: projectId)
      if (!db.objectStoreNames.contains('timerPresets')) {
        const presetOS = db.createObjectStore('timerPresets', { keyPath: 'id' });
        presetOS.createIndex('projectId', 'projectId', { unique: false });
        presetOS.createIndex('order', 'order', { unique: false });
      }

      // timerRuns (keyPath: runId, indexes: presetId, projectId, startTimestamp)
      if (!db.objectStoreNames.contains('timerRuns')) {
        const runOS = db.createObjectStore('timerRuns', { keyPath: 'runId' });
        runOS.createIndex('presetId', 'presetId', { unique: false });
        runOS.createIndex('projectId', 'projectId', { unique: false });
        runOS.createIndex('startTimestamp', 'startTimestamp', { unique: false });
      }

      // assets (keyPath: id)
      if (!db.objectStoreNames.contains('assets')) {
        db.createObjectStore('assets', { keyPath: 'id' });
      }

      // settings (keyPath: key)
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings', { keyPath: 'key' });
      }
    };
  });
}

// --- Generic Helpers ---

async function runTransaction(storeName, mode, callback) {
  const db = await initDB();
  return new Promise((resolve, reject) => {
    const tx = db.transaction(storeName, mode);
    const store = tx.objectStore(storeName);

    let result;
    tx.oncomplete = () => resolve(result);
    tx.onerror = (e) => reject(`Transaction error: ${e.target.error}`);

    result = callback(store, tx);

    // For single requests if they are returned by callback
    if (result instanceof IDBRequest) {
      result.onsuccess = () => resolve(result.result);
      result.onerror = (e) => reject(e.target.error);
    }
  });
}

const Storage = {
  // Projects
  getProjects: () => runTransaction('projects', 'readonly', s => {
    const req = s.getAll();
    return new Promise(res => req.onsuccess = () => res(req.result || []));
  }),
  saveProject: (project) => runTransaction('projects', 'readwrite', s => s.put(project)),

  // Settings
  getSetting: (key, defaultValue = null) => runTransaction('settings', 'readonly', s => {
    const req = s.get(key);
    return new Promise(res => req.onsuccess = () => res(req.result ? req.result.value : defaultValue));
  }),
  saveSetting: (key, value) => runTransaction('settings', 'readwrite', s => s.put({ key, value })),

  // Presets
  getPresets: (projectId) => runTransaction('timerPresets', 'readonly', s => {
    const idx = s.index('projectId');
    const req = idx.getAll(projectId);
    return new Promise(res => {
      req.onsuccess = () => {
        const results = req.result || [];
        results.sort((a, b) => a.order - b.order);
        res(results);
      };
    });
  }),
  savePreset: (preset) => runTransaction('timerPresets', 'readwrite', s => s.put(preset)),
  deletePreset: (id) => runTransaction('timerPresets', 'readwrite', s => s.delete(id)),
  updateOrders: (presets) => runTransaction('timerPresets', 'readwrite', s => {
    presets.forEach(p => s.put(p)); // Requires full objects
    return true;
  }),

  // Runs
  getRuns: (projectId) => runTransaction('timerRuns', 'readonly', s => {
    const idx = s.index('projectId');
    const req = idx.getAll(projectId);
    return new Promise(res => {
      req.onsuccess = () => {
        const runs = req.result || [];
        runs.sort((a, b) => new Date(a.startTimestamp) - new Date(b.startTimestamp));
        res(runs);
      };
    });
  }),
  saveRun: (run) => runTransaction('timerRuns', 'readwrite', s => s.put(run)),
  deleteRun: (runId) => runTransaction('timerRuns', 'readwrite', s => s.delete(runId)),

  // Initial Seed
  seedDefaultProject: async () => {
    const projects = await Storage.getProjects();
    if (projects.length === 0) {
      const defaultProject = {
        id: 'p-1',
        name: 'デフォルト',
        createdAt: new Date().toISOString()
      };
      await Storage.saveProject(defaultProject);

      // Default initial preset
      await Storage.savePreset({
        id: 'preset-' + Date.now(),
        projectId: 'p-1',
        title: '作業（サンプル）',
        targetSeconds: 1500, // 25min
        order: 0,
        reminder: { sound: { type: 'builtin', name: 'chime1', volume: 80, loop: false, preAlertSec: 0 }, vibratePattern: [200, 100, 200] }
      });
      return defaultProject;
    }
    return projects[0];
  }
};
