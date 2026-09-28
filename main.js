const { app, BrowserWindow, ipcMain, Menu } = require('electron');
const path = require('path');
const Database = require('better-sqlite3');

let mainWindow;
let db;

// Убираем верхнее меню File/Edit/View/Window полностью
Menu.setApplicationMenu(null);

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 780,
    minWidth: 900,
    minHeight: 600,
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
  mainWindow.webContents.openDevTools();

  mainWindow.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('did-fail-load:', code, desc);
  });
}

function initDatabase() {
  const dbPath = path.join(app.getPath('userData'), 'clients.db');
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
    INSERT INTO clients (plate_letters, plate_region, full_name, car_brand, phone, is_good)
    VALUES (@plate_letters, @plate_region, @full_name, @car_brand, @phone, @is_good)
  `).run(client);
  return { id: info.lastInsertRowid, ...client };
});

ipcMain.handle('db:updateClient', (_e, client) => {
  db.prepare(`
    UPDATE clients SET
      plate_letters = @plate_letters, plate_region = @plate_region,
      full_name = @full_name, car_brand = @car_brand,
      phone = @phone, is_good = @is_good
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

// ---------- IPC: статистика / последние обращения ----------
ipcMain.handle('db:getRecentVisits', (_e, limit = 8) => {
  return db.prepare(`
    SELECT r.*, c.full_name, c.plate_letters, c.plate_region
    FROM records r
    JOIN clients c ON c.id = r.client_id
    WHERE r.type = 'visit'
    ORDER BY r.visit_date DESC, r.id DESC
    LIMIT ?
  `).all(limit);
});

ipcMain.handle('db:getStats', () => {
  const totalClients = db.prepare('SELECT COUNT(*) as n FROM clients').get().n;
  const totalVisits = db.prepare("SELECT COUNT(*) as n FROM records WHERE type='visit'").get().n;
  const monthVisits = db.prepare(`
    SELECT COUNT(*) as n FROM records
    WHERE type='visit'
      AND visit_date >= date('now', 'start of month')
  `).get().n;
  const goodClients = db.prepare('SELECT COUNT(*) as n FROM clients WHERE is_good = 1').get().n;
  return { totalClients, totalVisits, monthVisits, goodClients };
});

// ---------- Автообновление ----------
function setupAutoUpdater() {
  try {
    const { autoUpdater } = require('electron-updater');
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = true;

    autoUpdater.on('update-available', (info) => {
      if (mainWindow) {
        mainWindow.webContents.send('update-available', {
          version: info.version, releaseNotes: info.releaseNotes || '',
        });
      }
    });
    autoUpdater.on('update-downloaded', () => {
      if (mainWindow) mainWindow.webContents.send('update-downloaded');
    });
    autoUpdater.on('error', (err) => console.error('AutoUpdater:', err.message));

    if (app.isPackaged) autoUpdater.checkForUpdates().catch(() => {});

    ipcMain.handle('update:download', () => autoUpdater.downloadUpdate());
    ipcMain.handle('update:install', () => autoUpdater.quitAndInstall());
    ipcMain.handle('update:check', () => autoUpdater.checkForUpdates().catch(() => {}));
  } catch (e) {
    ipcMain.handle('update:download', () => {});
    ipcMain.handle('update:install', () => {});
    ipcMain.handle('update:check', () => {});
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