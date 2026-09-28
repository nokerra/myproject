const { app, BrowserWindow, ipcMain, Menu, dialog, shell } = require('electron');
const path = require('path');
const fs = require('fs');
const Database = require('better-sqlite3');
const ExcelJS = require('exceljs');

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

  try {
    db.exec(`ALTER TABLE clients ADD COLUMN vin TEXT DEFAULT ''`);
  } catch (e) { /* уже есть */ }

  makeAutoBackup();
}

// ==================== Автобэкап ====================
function makeAutoBackup() {
  try {
    const backupDir = path.join(app.getPath('userData'), 'backups');
    if (!fs.existsSync(backupDir)) fs.mkdirSync(backupDir, { recursive: true });

    const today = new Date().toISOString().slice(0, 10);
    const targetFile = path.join(backupDir, `clients-${today}.db`);

    if (fs.existsSync(targetFile)) return;

    db.pragma('wal_checkpoint(TRUNCATE)');
    fs.copyFileSync(dbPath, targetFile);
    console.log('Auto-backup создан:', targetFile);

    const files = fs.readdirSync(backupDir)
      .filter(f => f.startsWith('clients-') && f.endsWith('.db'))
      .sort()
      .reverse();

    files.slice(7).forEach(f => {
      try { fs.unlinkSync(path.join(backupDir, f)); } catch (e) {}
    });
  } catch (e) {
    console.error('Auto-backup error:', e.message);
  }
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

// ---------- Бэкап/восстановление вручную ----------
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

// ---------- Экспорт в Excel ----------
ipcMain.handle('db:exportExcel', async () => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow, {
    title: 'Экспорт базы в Excel',
    defaultPath: `clients-${new Date().toISOString().slice(0, 10)}.xlsx`,
    filters: [{ name: 'Excel', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { ok: false };

  try {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'База клиентов';
    workbook.created = new Date();

    const clients = db.prepare(
      'SELECT * FROM clients ORDER BY full_name COLLATE NOCASE ASC'
    ).all();

    const wsClients = workbook.addWorksheet('Клиенты', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    wsClients.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'ФИО', key: 'full_name', width: 32 },
      { header: 'Номер авто', key: 'plate', width: 14 },
      { header: 'Регион', key: 'plate_region', width: 10 },
      { header: 'VIN', key: 'vin', width: 22 },
      { header: 'Марка авто', key: 'car_brand', width: 22 },
      { header: 'Телефон', key: 'phone', width: 18 },
      { header: 'Статус', key: 'status', width: 14 },
      { header: 'Обращений', key: 'visits_count', width: 12 },
      { header: 'На сумму (₽)', key: 'total_sum', width: 16 },
      { header: 'Создан', key: 'created_at', width: 20 },
    ];

    wsClients.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A7BD8' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
    wsClients.getRow(1).height = 24;

    const visitStats = db.prepare(`
      SELECT client_id,
             COUNT(*) as cnt,
             SUM(CAST(REPLACE(REPLACE(price, ' ', ''), ',', '.') AS REAL)) as total
      FROM records
      WHERE type = 'visit'
      GROUP BY client_id
    `).all();
    const statsMap = {};
    visitStats.forEach(s => statsMap[s.client_id] = s);

    clients.forEach(c => {
      const stat = statsMap[c.id] || { cnt: 0, total: 0 };
      wsClients.addRow({
        id: c.id,
        full_name: c.full_name,
        plate: c.plate_letters,
        plate_region: c.plate_region,
        vin: c.vin || '',
        car_brand: c.car_brand || '',
        phone: c.phone,
        status: c.is_good ? 'Порядочный' : 'Козёл',
        visits_count: stat.cnt,
        total_sum: stat.total || 0,
        created_at: c.created_at,
      });
    });

    wsClients.columns.forEach(col => {
      let max = col.header.length;
      wsClients.eachRow((row, i) => {
        if (i === 1) return;
        const v = row.getCell(col.key).value;
        if (v) max = Math.max(max, String(v).length);
      });
      col.width = Math.min(max + 4, 40);
    });

    const wsRecords = workbook.addWorksheet('Обращения', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });

    wsRecords.columns = [
      { header: 'ID', key: 'id', width: 8 },
      { header: 'Клиент', key: 'full_name', width: 32 },
      { header: 'Номер авто', key: 'plate', width: 14 },
      { header: 'Тип', key: 'type', width: 12 },
      { header: 'Дата', key: 'date', width: 14 },
      { header: 'Пробег (км)', key: 'mileage', width: 14 },
      { header: 'Что сделано / текст', key: 'content', width: 50 },
      { header: 'Цена (₽)', key: 'price', width: 14 },
      { header: 'Создано', key: 'created_at', width: 20 },
    ];

    wsRecords.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A7BD8' } };
      cell.alignment = { vertical: 'middle', horizontal: 'left' };
    });
    wsRecords.getRow(1).height = 24;

    const records = db.prepare(`
      SELECT r.*, c.full_name, c.plate_letters, c.plate_region
      FROM records r
      JOIN clients c ON c.id = r.client_id
      ORDER BY r.created_at DESC, r.id DESC
    `).all();

    records.forEach(r => {
      wsRecords.addRow({
        id: r.id,
        full_name: r.full_name,
        plate: `${r.plate_letters} ${r.plate_region}`,
        type: r.type === 'visit' ? 'Обращение' : 'Заметка',
        date: r.visit_date || r.created_at?.slice(0, 10) || '',
        mileage: r.mileage || '',
        content: r.type === 'visit' ? (r.work_done || '') : (r.content || ''),
        price: r.price || '',
        created_at: r.created_at,
      });
    });

    wsRecords.columns.forEach(col => {
      let max = col.header.length;
      wsRecords.eachRow((row, i) => {
        if (i === 1) return;
        const v = row.getCell(col.key).value;
        if (v) max = Math.max(max, String(v).length);
      });
      col.width = Math.min(max + 4, 50);
    });

    const wsSummary = workbook.addWorksheet('Итоги');
    wsSummary.columns = [
      { header: 'Показатель', key: 'k', width: 32 },
      { header: 'Значение', key: 'v', width: 20 },
    ];
    wsSummary.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = { type: 'pattern', pattern: 'solid', fgColor: { argb: 'FF4A7BD8' } };
    });

    const totalClients = clients.length;
    const totalVisits = records.filter(r => r.type === 'visit').length;
    const totalNotes = records.filter(r => r.type === 'note').length;
    const totalSum = visitStats.reduce((acc, s) => acc + (s.total || 0), 0);

    wsSummary.addRow({ k: 'Всего клиентов', v: totalClients });
    wsSummary.addRow({ k: 'Всего обращений', v: totalVisits });
    wsSummary.addRow({ k: 'Всего заметок', v: totalNotes });
    wsSummary.addRow({ k: 'Общая сумма обращений (₽)', v: totalSum });
    wsSummary.addRow({ k: 'Экспорт создан', v: new Date().toLocaleString('ru-RU') });

    await workbook.xlsx.writeFile(filePath);
    return { ok: true, path: filePath };
  } catch (e) {
    console.error('Экспорт Excel ошибка:', e);
    return { ok: false, error: e.message };
  }
});

// ---------- Автообновление ----------
let updateDownloading = false;

function setupAutoUpdater() {
  const { autoUpdater } = require('electron-updater');

  autoUpdater.disableDifferentialDownload = true;
  autoUpdater.autoDownload = false;
  autoUpdater.autoInstallOnAppQuit = true;

  const GITHUB_URL = 'https://github.com/nokerra/myproject/releases/latest/download';
  const GITHUB_BASE = 'https://github.com/nokerra/myproject/releases/download';

  autoUpdater.setFeedURL({ provider: 'generic', url: GITHUB_URL });

  autoUpdater.on('update-available', (info) => {
    updateDownloading = false;

    // Собираем прямую ссылку на .exe для ручного скачивания
    const files = info.files || [];
    const exeFile = files.find(f => f.url && f.url.endsWith('.exe'));
    let manualUrl = '';

    if (exeFile) {
      const fileName = exeFile.url.split('/').pop();
      manualUrl = `${GITHUB_BASE}/v${info.version}/${fileName}`;
    }

    if (mainWindow) {
      mainWindow.webContents.send('update-available', {
        version: info.version,
        releaseNotes: info.releaseNotes || '',
        manualUrl: manualUrl,
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
    try {
      autoUpdater.downloadUpdate().catch(() => {});
      return { ok: true };
    } catch (e) {
      return { ok: false, error: e.message };
    }
  });

  ipcMain.handle('update:openDownloadUrl', async (_e, url) => {
    if (!url) return false;
    await shell.openExternal(url);
    return true;
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