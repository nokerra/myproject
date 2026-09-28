const { app, BrowserWindow, ipcMain, Menu, dialog } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');

let mainWindow;
let db;
let dbPath;

Menu.setApplicationMenu(null);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1200,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    backgroundColor: '#0e1015',
    title: 'База клиентов',
    autoHideMenuBar: true,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  mainWindow.loadFile(path.join(__dirname, 'src', 'index.html'));
}

function initDatabase() {
  dbPath = path.join(app.getPath('userData'), 'clients.db');
  db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  db.exec(`
    CREATE TABLE IF NOT EXISTS clients (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      plate_letters TEXT NOT NULL,
      plate_region TEXT NOT NULL,
      full_name TEXT NOT NULL,
      car_brand TEXT DEFAULT '',
      vin TEXT DEFAULT '',
      phone TEXT NOT NULL,
      is_good INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now', 'localtime'))
    );

    CREATE TABLE IF NOT EXISTS records (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id INTEGER NOT NULL,
      type TEXT NOT NULL CHECK(type IN ('note', 'visit')),
      content TEXT DEFAULT '',
      mileage TEXT DEFAULT '',
      work_done TEXT DEFAULT '',
      visit_date TEXT DEFAULT '',
      price TEXT DEFAULT '',
      created_at TEXT DEFAULT (datetime('now', 'localtime')),
      FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE
    );
  `);

  // На случай апгрейда со старой версии — добавим колонку, если её нет
  try {
    db.exec(`ALTER TABLE clients ADD COLUMN vin TEXT DEFAULT ''`);
  } catch (e) { /* уже есть */ }
}

// ---------- IPC: клиенты ----------
ipcMain.handle('db:getClients', () => {
  return db.prepare('SELECT * FROM clients ORDER BY full_name COLLATE NOCASE ASC').all();
});

ipcMain.handle('db:getClient', (_e, id) => {
  return db.prepare('SELECT * FROM clients WHERE id = ?').get(id);
});

ipcMain.handle('db:addClient', (_e, client) => {
  const info = db.prepare(`
    INSERT INTO clients (plate_letters, plate_region, full_name, car_brand, vin, phone, is_good)
    VALUES (@plate_letters, @plate_region, @full_name, @car_brand, @vin, @phone, @is_good)
  `).run(client);
  return { id: info.lastInsertRowid, ...client };
});

ipcMain.handle('db:updateClient', (_e, client) => {
  db.prepare(`
    UPDATE clients SET
      plate_letters = @plate_letters, plate_region = @plate_region,
      full_name = @full_name, car_brand = @car_brand,
      vin = @vin, phone = @phone, is_good = @is_good
    WHERE id = @id
  `).run(client);
  return true;
});

ipcMain.handle('db:deleteClient', (_e, id) => {
  db.prepare('DELETE FROM clients WHERE id = ?').run(id);
  return true;
});

// ---------- IPC: записи ----------
ipcMain.handle('db:getRecords', (_e, clientId) => {
  return db.prepare(
    'SELECT * FROM records WHERE client_id = ? ORDER BY created_at DESC, id DESC'
  ).all(clientId);
});

ipcMain.handle('db:addRecord', (_e, record) => {
  const info = db.prepare(`
    INSERT INTO records (client_id, type, content, mileage, work_done, visit_date, price)
    VALUES (@client_id, @type, @content, @mileage, @work_done, @visit_date, @price)
  `).run(record);
  return { id: info.lastInsertRowid, ...record };
});

ipcMain.handle('db:updateRecord', (_e, record) => {
  db.prepare(`
    UPDATE records SET
      content = @content, mileage = @mileage, work_done = @work_done,
      visit_date = @visit_date, price = @price
    WHERE id = @id
  `).run(record);
  return true;
});

ipcMain.handle('db:deleteRecord', (_e, id) => {
  db.prepare('DELETE FROM records WHERE id = ?').run(id);
  return true;
});

ipcMain.handle('db:getRecentVisits', (_e, limit = 10) => {
  return db.prepare(`
    SELECT r.*, c.full_name, c.plate_letters, c.plate_region
    FROM records r
    JOIN clients c ON c.id = r.client_id
    WHERE r.type = 'visit'
    ORDER BY r.visit_date DESC, r.id DESC
    LIMIT ?
  `).all(limit);
});

// ---------- Бэкап/восстановление ----------
ipcMain.handle('db:backup', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Сохранить копию базы',
    defaultPath: `clients-backup-${new Date().toISOString().slice(0, 10)}.db`,
    filters: [{ name: 'SQLite DB', extensions: ['db'] }],
  });
  if (canceled || !filePath) return { ok: false };
  try {
    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath, filePath);
    return { ok: true, path: filePath };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

ipcMain.handle('db:restore', async () => {
  const { canceled, filePaths } = await dialog.showOpenDialog(mainWindow, {
    title: 'Восстановить из копии',
    filters: [{ name: 'SQLite DB', extensions: ['db'] }],
    properties: ['openFile'],
  });
  if (canceled || !filePaths.length) return { ok: false };
  try {
    db.close();
    fs.copyFileSync(filePaths[0], dbPath);
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('foreign_keys = ON');
    return { ok: true, path: filePaths[0] };
  } catch (e) {
    return { ok: false, error: e.message };
  }
});

// ---------- Автообновление ----------
let updateDownloading = false;

function setupAutoUpdater() {
  const { autoUpdater } = require('electron-updater');

  // Качаем .exe целиком — самые надёжно
  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  // Пытаемся через GitHub, если долго — через прокси
  const GITHUB_URL = 'https://github.com/nokerra/myproject/releases/latest/download';
  const PROXY_URL = 'https://gh-proxy.com/' + GITHUB_URL;

  autoUpdater.setFeedURL({ provider: 'generic', url: GITHUB_URL });

  autoUpdater.on('update-available', (info) => {
    updateDownloading = false;
    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
      });
    }
  });

  autoUpdater.on('download-progress', (p) => {
    if (mainWindow) {
      mainWindow.webContents.send('update-progress', {
        percent: p.percent,
        bytesPerSecond: p.bytesPerSecond,
        transferred: p.transferred,
        total: p.total,
      });
    }
  });

  autoUpdater.on('update-downloaded', () => {
    if (mainWindow) mainWindow.webContents.send('update-downloaded');
  });

  autoUpdater.on('error', (err) => {
    console.error('AutoUpdater:', err.message);
    if (mainWindow) {
      mainWindow.webContents.send('update-error', err.message || 'Ошибка обновления');
    }
  });

  ipcMain.handle('update:download', async () => {
    if (updateDownloading) return { ok: false };
    updateDownloading = true;

    // Fallback на прокси через 15 секунд, если скорость < 20 КБ/с
    let switched = false;
    const watchdog = setTimeout(() => {
      if (switched || !updateDownloading) return;
      switched = true;
      console.warn('Медленно — переключаюсь на прокси');
      autoUpdater.setFeedURL({ provider: 'generic', url: PROXY_URL });
      autoUpdater.downloadUpdate().catch(() => {});
    }, 15000);

    try {
      await autoUpdater.downloadUpdate();
      clearTimeout(watchdog);
      return { ok: true };
    } catch (e) {
      clearTimeout(watchdog);
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
  ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => {}));

  if (app.isPackaged) {
    autoUpdater.checkForUpdates().catch(() => {});
    setInterval(() => autoUpdater.checkForUpdates().catch(() => {}), 6 * 60 * 60 * 1000);
  }
}

app.whenReady().then(() => {
  initDatabase();
  createWindow();
  setupAutoUpdater();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (db) db.close();
  if (process.platform !== 'darwin') app.quit();
});