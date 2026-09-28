let allClients = [];
let currentClient = null;
let currentRecords = [];
let allRecordsCache = [];
let fuseClients = null;
let fuseRecords = null;
let recentVisits = [];

const $ = (s) => document.querySelector(s);
const $$ = (s) => document.querySelectorAll(s);

// ==================== Утилиты ====================
function formatDate(d) {
  if (!d) return '—';
  const dt = new Date(d);
  return dt.toLocaleDateString('ru-RU', { day: '2-digit', month: 'short', year: 'numeric' });
}

function escapeHtml(s) {
  if (!s) return '';
  return String(s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;')
    .replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

function todayISO() {
  const d = new Date();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${m}-${day}`;
}

function highlight(text, query) {
  const escaped = escapeHtml(text || '');
  if (!query) return escaped;
  const words = query.trim().split(/\s+/).filter(w => w.length >= 2);
  if (!words.length) return escaped;
  const pattern = words.map(w => w.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('|');
  return escaped.replace(new RegExp(`(${pattern})`, 'gi'), '<mark>$1</mark>');
}

// Копирование в буфер + всплывающий тост
function showToast(msg) {
  let t = $('.toast');
  if (!t) {
    t = document.createElement('div');
    t.className = 'toast';
    document.body.appendChild(t);
  }
  t.textContent = msg;
  t.classList.add('show');
  clearTimeout(t._timer);
  t._timer = setTimeout(() => t.classList.remove('show'), 1600);
}

async function copyText(text, label) {
  try {
    await navigator.clipboard.writeText(text);
    showToast(`${label} скопирован`);
  } catch (e) {
    showToast('Не удалось скопировать');
  }
}

// ==================== Навигация ====================
function showPage(id) {
  $$('.page').forEach(p => p.style.display = 'none');
  $(`#${id}`).style.display = 'block';

  const fabAdd = $('#fabAdd');
  const fabGroup = $('#fabGroup');
  if (fabAdd) fabAdd.style.display = (id === 'pageHome') ? 'flex' : 'none';
  if (fabGroup) fabGroup.style.display = (id === 'pageClient') ? 'flex' : 'none';
}

function updateNavActive(view) {
  $('#navSearchBtn').classList.toggle('active', view === 'home');
  $('#navClientsBtn').classList.toggle('active', view === 'clients');
}

function goHome() {
  showPage('pageHome');
  updateNavActive('home');
  $('#mainSearch').value = '';
  $('#searchResults').innerHTML = '';
  $('#searchClear').style.display = 'none';
  loadHomeData();
}

function goClients() {
  showPage('pageClients');
  updateNavActive('clients');
  renderAccordion();
}

async function goClient(id) {
  const client = await window.api.getClient(id);
  if (!client) return;
  currentClient = client;
  renderClientHeader();
  await loadRecords(id);
  showPage('pageClient');
  updateNavActive('');
}

// ==================== Лоадер ====================
function showLoader() { const el = $('#loader'); if (el) el.classList.remove('hidden'); }
function hideLoader() { const el = $('#loader'); if (el) el.classList.add('hidden'); }

// ==================== Главная ====================
async function loadHomeData() {
  recentVisits = await window.api.getRecentVisits(10);
  renderCarousel(recentVisits);
}

function renderCarousel(visits) {
  const el = $('#recentCarousel');
  if (!visits.length) {
    el.innerHTML = `<div class="carousel-empty">Обращений пока нет</div>`;
    return;
  }
  el.innerHTML = visits.map(v => `
    <div class="carousel-card" data-client-id="${v.client_id}">
      <div class="cc-name">${escapeHtml(v.full_name)}</div>
      <div class="cc-date">${formatDate(v.visit_date || v.created_at)}</div>
      <div class="cc-work">${escapeHtml(v.work_done || '—')}</div>
      <div class="cc-foot">
        ${v.price ? `<span class="cc-price">${escapeHtml(v.price)} ₽</span>` : '<span></span>'}
        ${v.mileage ? `<span class="cc-mileage"><span class="material-symbols-rounded">speed</span>${escapeHtml(v.mileage)} км</span>` : ''}
      </div>
    </div>
  `).join('');
  el.querySelectorAll('.carousel-card').forEach(card => {
    card.addEventListener('click', () => goClient(+card.dataset.clientId));
  });
}

// ==================== Поиск ====================
function initMainSearch() {
  const input = $('#mainSearch');
  const clear = $('#searchClear');

  input.addEventListener('input', () => {
    const q = input.value.trim();
    clear.style.display = q ? 'flex' : 'none';
    if (!q || !fuseClients) { $('#searchResults').innerHTML = ''; return; }

    const results = fuseClients.search(q).slice(0, 8);
    const el = $('#searchResults');
    if (!results.length) {
      el.innerHTML = `<div class="empty" style="padding:24px;font-size:16px">Ничего не найдено</div>`;
      return;
    }
    el.innerHTML = results.map(r => {
      const c = r.item;
      return `<div class="search-result-item" data-id="${c.id}">
        <div class="sr-body">
          <div class="sr-name">${highlight(c.full_name, q)}</div>
          <div class="sr-meta">
            <span class="sr-plate-mini">${highlight(c.plate_letters, q)} ${highlight(c.plate_region, q)}</span>
            <span>${highlight(c.phone, q)}</span>
          </div>
        </div>
      </div>`;
    }).join('');
    el.querySelectorAll('.search-result-item').forEach(item => {
      item.addEventListener('click', () => goClient(+item.dataset.id));
    });
  });

  clear.addEventListener('click', () => {
    input.value = '';
    input.dispatchEvent(new Event('input'));
    input.focus();
  });
}

// ==================== Аккордеон ====================
const RU_LETTERS = 'АБВГДЕЁЖЗИЙКЛМНОПРСТУФХЦЧШЩЪЫЬЭЮЯ'.split('');

function renderAccordion() {
  const container = $('#clientsAccordion');
  const groups = {};
  RU_LETTERS.forEach(l => groups[l] = []);
  const others = [];

  allClients.forEach(c => {
    const first = (c.full_name || '').trim().charAt(0).toUpperCase();
    if (groups[first]) groups[first].push(c);
    else others.push(c);
  });

  let html = '';
  RU_LETTERS.forEach(letter => {
    const list = groups[letter];
    if (!list.length) return;
    html += buildAccordionGroup(letter, list);
  });
  if (others.length) html += buildAccordionGroup('_', others, 'Прочее');

  container.innerHTML = html || '<div class="empty"><span class="material-symbols-rounded">group_off</span><p>Пока нет клиентов</p></div>';
  $('#clientsTotal').textContent = allClients.length;

  container.querySelectorAll('.accordion-header').forEach(h => {
    h.addEventListener('click', () => h.parentElement.classList.toggle('open'));
  });
  container.querySelectorAll('.accordion-item').forEach(item => {
    item.addEventListener('click', () => goClient(+item.dataset.id));
  });
}

function buildAccordionGroup(letter, list, label) {
  return `<div class="accordion-group" data-letter="${letter}">
    <div class="accordion-header">
      <span class="material-symbols-rounded chevron">chevron_right</span>
      <span>${label || letter}</span>
      <span class="count">${list.length}</span>
    </div>
    <div class="accordion-body">
      ${list.map(c => `<div class="accordion-item" data-id="${c.id}">
        <span class="ai-name">${escapeHtml(c.full_name)}</span>
        <span class="ai-phone">${escapeHtml(c.phone)}</span>
      </div>`).join('')}
    </div>
  </div>`;
}

// ==================== Страница клиента ====================
function renderClientHeader() {
  const c = currentClient;
  const st = c.is_good
    ? '<span class="client-status good">Порядочный</span>'
    : '<span class="client-status bad">Козёл</span>';

  const plateFull = `${c.plate_letters} ${c.plate_region}`;

  $('#clientSticky').innerHTML = `
    <div class="client-header">
      <div class="plate-box" id="plateCopy" title="Скопировать номер">
        <div class="plate-left">${escapeHtml(c.plate_letters)}</div>
        <div class="plate-right">
          <div class="plate-region">${escapeHtml(c.plate_region)}</div>
          <div class="plate-country"><span>RUS</span><span class="plate-flag"></span></div>
        </div>
      </div>
      <div class="client-info">
        <div class="client-name">${escapeHtml(c.full_name)} ${st}</div>
        <div class="client-meta">
          ${c.car_brand ? `<span><span class="material-symbols-rounded">directions_car</span>${escapeHtml(c.car_brand)}</span>` : ''}
          <span class="copyable" id="phoneCopy" title="Скопировать телефон">
            <span class="material-symbols-rounded">call</span>
            ${escapeHtml(c.phone)}
            <span class="copy-hint">копировать</span>
          </span>
          ${c.vin ? `<span class="copyable" id="vinCopy" title="Скопировать VIN">
            <span class="material-symbols-rounded">fingerprint</span>
            VIN: ${escapeHtml(c.vin)}
            <span class="copy-hint">копировать</span>
          </span>` : ''}
        </div>
      </div>
    </div>
  `;

  // Обработчики копирования
  $('#plateCopy').addEventListener('click', () => copyText(plateFull, 'Номер'));
  $('#phoneCopy').addEventListener('click', () => copyText(c.phone, 'Телефон'));
  if ($('#vinCopy')) $('#vinCopy').addEventListener('click', () => copyText(c.vin, 'VIN'));
}

async function loadRecords(clientId) {
  currentRecords = await window.api.getRecords(clientId);
  allRecordsCache = currentRecords;
  fuseRecords = new Fuse(allRecordsCache, {
    keys: ['content', 'work_done'],
    threshold: 0.4,
  });
  renderFeed(currentRecords);
  renderRecordsMeta(currentRecords);
}

function renderRecordsMeta(records) {
  const visits = records.filter(r => r.type === 'visit').length;
  const notes = records.filter(r => r.type === 'note').length;
  $('#recordsCount').innerHTML = `Обращений: <strong>${visits}</strong> · Заметок: <strong>${notes}</strong>`;
}

function renderFeed(records, query = '') {
  const feed = $('#recordsFeed');
  if (!records.length) {
    feed.innerHTML = `<div class="empty"><span class="material-symbols-rounded">inbox</span><p>${query ? 'Ничего не найдено' : 'Нет записей'}</p></div>`;
    return;
  }
  feed.innerHTML = records.map(r => {
    if (r.type === 'note') {
      return `<div class="feed-item note" data-id="${r.id}">
        <div class="feed-item-header">
          <span class="fi-type note-type">Заметка</span>
          <span class="fi-date">${formatDate(r.created_at)}</span>
        </div>
        <div class="fi-content">${highlight(r.content, query)}</div>
        <div class="fi-actions">
          <button data-action="edit-record" data-id="${r.id}" data-type="note">
            <span class="material-symbols-rounded">edit</span> Изменить
          </button>
          <button data-action="delete-record" data-id="${r.id}" class="del">
            <span class="material-symbols-rounded">delete</span> Удалить
          </button>
        </div>
      </div>`;
    }
    return `<div class="feed-item visit" data-id="${r.id}">
      <div class="feed-item-header">
        <span class="fi-type visit-type">Обращение</span>
        <span class="fi-date">${formatDate(r.visit_date || r.created_at)}</span>
      </div>
      ${r.work_done ? `<div class="fi-content">${highlight(r.work_done, query)}</div>` : ''}
      <div class="fi-row">
        ${r.mileage ? `<span><span class="material-symbols-rounded">speed</span>${escapeHtml(r.mileage)} км</span>` : ''}
        ${r.price ? `<span><span class="material-symbols-rounded">payments</span>${escapeHtml(r.price)} ₽</span>` : ''}
      </div>
      <div class="fi-actions">
        <button data-action="edit-record" data-id="${r.id}" data-type="visit">
          <span class="material-symbols-rounded">edit</span> Изменить
        </button>
        <button data-action="delete-record" data-id="${r.id}" class="del">
          <span class="material-symbols-rounded">delete</span> Удалить
        </button>
      </div>
    </div>`;
  }).join('');

  feed.querySelectorAll('[data-action="edit-record"]').forEach(btn => {
    btn.addEventListener('click', () => openEditRecord(+btn.dataset.id, btn.dataset.type));
  });
  feed.querySelectorAll('[data-action="delete-record"]').forEach(btn => {
    btn.addEventListener('click', () => openDeleteRecord(+btn.dataset.id));
  });
}

function initRecordSearch() {
  $('#recordSearch').addEventListener('input', (e) => {
    const q = e.target.value.trim();
    if (!q) { renderFeed(currentRecords); return; }
    const results = fuseRecords.search(q).map(r => r.item);
    renderFeed(results, q);
  });
}

// ==================== Модалки ====================
function openModal(html) {
  $('#modalContent').innerHTML = html;
  $('#modalOverlay').style.display = 'flex';
}
function closeModal() {
  $('#modalOverlay').style.display = 'none';
  $('#modalContent').innerHTML = '';
}

function openClientForm(client = null) {
  const isEdit = !!client;
  const c = client || { plate_letters: '', plate_region: '', full_name: '', car_brand: '', vin: '', phone: '+7', is_good: 1 };
  openModal(`
    <h2>${isEdit ? 'Редактировать клиента' : 'Новый клиент'}</h2>
    <form id="clientForm">
      <div class="field-row">
        <div class="field" style="flex:2">
          <label>Номер авто</label>
          <input type="text" id="fPlate" value="${escapeHtml(c.plate_letters)}" placeholder="А123ВС" required />
        </div>
        <div class="field" style="flex:1">
          <label>Регион</label>
          <input type="text" id="fRegion" value="${escapeHtml(c.plate_region)}" placeholder="77" maxlength="3" required />
        </div>
      </div>
      <div class="field">
        <label>ФИО</label>
        <input type="text" id="fName" value="${escapeHtml(c.full_name)}" placeholder="Иванов Иван Иванович" required />
      </div>
      <div class="field">
        <label>Марка автомобиля</label>
        <input type="text" id="fBrand" value="${escapeHtml(c.car_brand)}" placeholder="Toyota Camry" />
      </div>
      <div class="field">
        <label>VIN-код</label>
        <input type="text" id="fVin" value="${escapeHtml(c.vin || '')}" placeholder="17 символов" maxlength="17" />
      </div>
      <div class="field">
        <label>Телефон</label>
        <input type="text" id="fPhone" value="${escapeHtml(c.phone)}" placeholder="+7 (999) 123-45-67" required />
      </div>
      <div class="switch-row">
        <label class="switch">
          <input type="checkbox" id="fGood" ${c.is_good ? 'checked' : ''} />
          <span class="switch-slider"></span>
        </label>
        <span class="switch-label" id="switchLabel">${c.is_good ? 'Порядочный' : 'Козёл'}</span>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modalCancel">Отмена</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>
  `);

  // Номер авто: буквы (лат+кир) + цифры, авто-капс
  const plateInput = $('#fPlate');
  plateInput.addEventListener('input', () => {
    plateInput.value = plateInput.value.toUpperCase().replace(/[^A-ZА-Я0-9]/g, '');
  });

  // Регион: только цифры
  $('#fRegion').addEventListener('input', (e) => {
    e.target.value = e.target.value.replace(/\D/g, '');
  });

  // VIN: только латинские буквы и цифры, капс
  const vinInput = $('#fVin');
  vinInput.addEventListener('input', () => {
    vinInput.value = vinInput.value.toUpperCase().replace(/[^A-Z0-9]/g, '');
  });

  // Телефон
  const phoneInput = $('#fPhone');
  phoneInput.addEventListener('input', () => {
    if (!phoneInput.value.startsWith('+7')) {
      phoneInput.value = '+7' + phoneInput.value.replace(/\D/g, '').slice(1);
    }
  });

  $('#fGood').addEventListener('change', (e) => {
    $('#switchLabel').textContent = e.target.checked ? 'Порядочный' : 'Козёл';
  });
  $('#modalCancel').addEventListener('click', closeModal);
  $('#clientForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      plate_letters: plateInput.value.trim().toUpperCase(),
      plate_region: $('#fRegion').value.trim(),
      full_name: $('#fName').value.trim(),
      car_brand: $('#fBrand').value.trim(),
      vin: vinInput.value.trim().toUpperCase(),
      phone: phoneInput.value.trim(),
      is_good: $('#fGood').checked ? 1 : 0,
    };
    if (isEdit) {
      await window.api.updateClient({ id: client.id, ...data });
      closeModal();
      await refreshAll();
      if (currentClient && currentClient.id === client.id) {
        currentClient = await window.api.getClient(client.id);
        renderClientHeader();
      }
    } else {
      const created = await window.api.addClient(data);
      closeModal();
      await refreshAll();
      goClient(created.id);
    }
  });
}

function openNoteForm(note = null) {
  const isEdit = !!note;
  openModal(`
    <h2>${isEdit ? 'Редактировать заметку' : 'Новая заметка'}</h2>
    <form id="noteForm">
      <div class="field">
        <label>Текст</label>
        <textarea id="noteText" placeholder="Введите текст…" required>${note ? escapeHtml(note.content) : ''}</textarea>
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modalCancel">Отмена</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Сохранить' : 'Опубликовать'}</button>
      </div>
    </form>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#noteForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const content = $('#noteText').value.trim();
    if (!content) return;
    if (isEdit) {
      await window.api.updateRecord({ id: note.id, content, mileage: '', work_done: '', visit_date: '', price: '' });
    } else {
      await window.api.addRecord({
        client_id: currentClient.id, type: 'note', content,
        mileage: '', work_done: '', visit_date: '', price: '',
      });
    }
    closeModal();
    await loadRecords(currentClient.id);
  });
}

function openVisitForm(visit = null) {
  const isEdit = !!visit;
  const v = visit || { mileage: '', work_done: '', visit_date: todayISO(), price: '' };
  openModal(`
    <h2>${isEdit ? 'Редактировать обращение' : 'Новое обращение'}</h2>
    <form id="visitForm">
      <div class="field">
        <label>Дата обращения</label>
        <input type="date" id="vDate" value="${v.visit_date}" required />
      </div>
      <div class="field">
        <label>Пробег (км)</label>
        <input type="text" id="vMileage" value="${escapeHtml(v.mileage)}" placeholder="120000" />
      </div>
      <div class="field">
        <label>Что было сделано</label>
        <textarea id="vWork" placeholder="Замена масла, фильтров, диагностика…" required>${escapeHtml(v.work_done)}</textarea>
      </div>
      <div class="field">
        <label>Цена (₽)</label>
        <input type="text" id="vPrice" value="${escapeHtml(v.price)}" placeholder="5000" />
      </div>
      <div class="modal-actions">
        <button type="button" class="btn btn-ghost" id="modalCancel">Отмена</button>
        <button type="submit" class="btn btn-primary">${isEdit ? 'Сохранить' : 'Добавить'}</button>
      </div>
    </form>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#visitForm').addEventListener('submit', async (e) => {
    e.preventDefault();
    const data = {
      mileage: $('#vMileage').value.trim(),
      work_done: $('#vWork').value.trim(),
      visit_date: $('#vDate').value,
      price: $('#vPrice').value.trim(),
    };
    if (isEdit) {
      await window.api.updateRecord({ id: visit.id, content: '', ...data });
    } else {
      await window.api.addRecord({ client_id: currentClient.id, type: 'visit', content: '', ...data });
    }
    closeModal();
    await loadRecords(currentClient.id);
  });
}

function openEditRecord(id, type) {
  const rec = allRecordsCache.find(r => r.id === id);
  if (!rec) return;
  if (type === 'note') openNoteForm(rec);
  else openVisitForm(rec);
}

function openDeleteRecord(id) {
  openModal(`
    <h2>Удалить запись?</h2>
    <p style="color:var(--text2);font-size:16px;margin-bottom:12px">Это действие нельзя отменить.</p>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">Отмена</button>
      <button class="btn btn-danger" id="confirmDelete">Удалить</button>
    </div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#confirmDelete').addEventListener('click', async () => {
    await window.api.deleteRecord(id);
    closeModal();
    await loadRecords(currentClient.id);
  });
}

function openDeleteClient() {
  openModal(`
    <h2>Удалить клиента?</h2>
    <p style="color:var(--text2);font-size:16px;margin-bottom:12px">
      Все обращения и заметки этого клиента будут безвозвратно удалены.
    </p>
    <label class="checkbox-row">
      <input type="checkbox" id="confirmCheck" />
      <span>Я понимаю, что действие необратимо</span>
    </label>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">Отмена</button>
      <button class="btn btn-danger" id="confirmDeleteClient" disabled>Удалить</button>
    </div>
  `);
  $('#confirmCheck').addEventListener('change', (e) => {
    $('#confirmDeleteClient').disabled = !e.target.checked;
  });
  $('#modalCancel').addEventListener('click', closeModal);
  $('#confirmDeleteClient').addEventListener('click', async () => {
    await window.api.deleteClient(currentClient.id);
    closeModal();
    await refreshAll();
    goHome();
  });
}

// ==================== Резервная копия ====================
function openBackupDialog() {
  openModal(`
    <h2>Резервная копия</h2>
    <p style="color:var(--text2);font-size:16px;margin-bottom:24px;line-height:1.6">
      База хранится только на вашем компьютере. Рекомендую сохранять копию
      на флешку или в облако раз в неделю.
    </p>
    <div style="display:flex;flex-direction:column;gap:12px;margin-bottom:24px">
      <button class="btn btn-primary" id="backupSave" style="justify-content:flex-start">
        <span class="material-symbols-rounded">save</span>
        Сохранить копию базы
      </button>
      <button class="btn btn-ghost" id="backupRestore" style="justify-content:flex-start;border:1px solid var(--border)">
        <span class="material-symbols-rounded">restore</span>
        Восстановить из копии
      </button>
    </div>
    <div class="modal-actions">
      <button class="btn btn-ghost" id="modalCancel">Закрыть</button>
    </div>
  `);
  $('#modalCancel').addEventListener('click', closeModal);
  $('#backupSave').addEventListener('click', async () => {
    const res = await window.api.backupDb();
    if (res.ok) { closeModal(); showToast('Копия сохранена'); }
    else if (res.error) showToast('Ошибка: ' + res.error);
  });
  $('#backupRestore').addEventListener('click', async () => {
    const res = await window.api.restoreDb();
    if (res.ok) {
      closeModal();
      await refreshAll();
      goHome();
      showToast('База восстановлена');
    } else if (res.error) showToast('Ошибка: ' + res.error);
  });
}

// ==================== Обновление данных ====================
async function refreshAll() {
  allClients = await window.api.getClients();
  fuseClients = new Fuse(allClients, {
    keys: ['plate_letters', 'plate_region', 'full_name', 'phone', 'vin', 'car_brand'],
    threshold: 0.35,
    ignoreLocation: true,
  });
  const cc = $('#clientCount');
  const ct = $('#clientsTotal');
  if (cc) cc.textContent = allClients.length;
  if (ct) ct.textContent = allClients.length;
}

// ==================== Обновления ====================
function initUpdates() {
  const toast = $('#updateToast');
  const text = $('#updateToastText');
  const actions = $('#updateActions');
  const progress = $('#updateProgress');
  const barFill = $('#updateBarFill');
  const info = $('#updateProgressInfo');

  window.api.onUpdateAvailable((infoData) => {
    text.textContent = `Доступно обновление v${infoData.version}`;
    actions.style.display = 'flex';
    progress.style.display = 'none';
    barFill.style.width = '0%';
    info.textContent = '0%';
    toast.style.display = 'flex';
  });

  $('#updateLater').addEventListener('click', () => {
    toast.style.display = 'none';
  });

  $('#updateNow').addEventListener('click', async () => {
    // Скрываем кнопки, показываем прогресс
    actions.style.display = 'none';
    progress.style.display = 'block';
    text.textContent = 'Загрузка обновления…';
    info.textContent = '0%';
    await window.api.downloadUpdate();
  });

  window.api.onUpdateProgress((p) => {
    const percent = Math.max(0, Math.min(100, p.percent || 0));
    barFill.style.width = percent.toFixed(1) + '%';
    const mb = (p.transferred / 1024 / 1024).toFixed(1);
    const totalMb = (p.total / 1024 / 1024).toFixed(1);
    const speed = (p.bytesPerSecond / 1024).toFixed(0);
    info.textContent = `${percent.toFixed(1)}% · ${mb} / ${totalMb} МБ · ${speed} КБ/с`;
  });

  window.api.onUpdateError((msg) => {
    text.textContent = 'Ошибка загрузки. Проверьте интернет.';
    info.textContent = msg;
    actions.style.display = 'flex';
    // Показать кнопку "Повторить"
    $('#updateNow').textContent = 'Повторить';
  });

  window.api.onUpdateDownloaded(() => {
    text.textContent = 'Обновление загружено. Устанавливаю…';
    barFill.style.width = '100%';
    info.textContent = 'Готово';
    setTimeout(() => window.api.installUpdate(), 800);
  });
}

// ==================== Инициализация ====================
document.addEventListener('DOMContentLoaded', async () => {
  showLoader();
  const safetyTimer = setTimeout(hideLoader, 10000);

  try {
    if (!window.api) throw new Error('window.api не определён');
    if (typeof Fuse === 'undefined') throw new Error('Fuse не загружен');

    await refreshAll();
    await loadHomeData();

    $('#navBrand').addEventListener('click', goHome);
    $('#navSearchBtn').addEventListener('click', goHome);
    $('#navClientsBtn').addEventListener('click', goClients);
    $('#navBackupBtn').addEventListener('click', openBackupDialog);
    $('#backBtn').addEventListener('click', goHome);

    initMainSearch();
    $('#fabAdd').addEventListener('click', () => openClientForm());

    $('#btnEditClient').addEventListener('click', () => openClientForm(currentClient));
    $('#btnDeleteClient').addEventListener('click', openDeleteClient);
    initRecordSearch();
    $('#fabNote').addEventListener('click', () => openNoteForm());
    $('#fabVisit').addEventListener('click', () => openVisitForm());

    $('#modalOverlay').addEventListener('click', (e) => {
      if (e.target === $('#modalOverlay')) closeModal();
    });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape') closeModal();
    });

    showPage('pageHome');
    initUpdates();
  } catch (err) {
    console.error('ОШИБКА:', err);
    const overlay = $('#loader');
    if (overlay) {
      overlay.innerHTML = `
        <div style="padding:40px;max-width:800px;font-family:system-ui;color:#e8ebef">
          <h1 style="color:#e2504f;margin-bottom:16px">Ошибка</h1>
          <pre style="color:#ff8a95;white-space:pre-wrap">${err.stack || err.message}</pre>
        </div>
      `;
    }
  } finally {
    clearTimeout(safetyTimer);
    hideLoader();
  }
});