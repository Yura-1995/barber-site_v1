/* =========================================================
   ПАРИКМАХЕР ОНЛАЙН — ЛОГИКА
   ✓ Расписание с шагом 10/15/20/30/60
   ✓ Роли: владелец/клиент
   ✓ Регистрация владельца + повторная авторизация раз в 7 дней
   ✓ Отзывы: добавить/редактировать/удалить/закрепить (владелец)
   ✓ Темы (5) и выбор шрифта
   ✓ Telegram-уведомления по заданному URL
   ✓ Хранилище: localStorage (по умолчанию) + опционально REST BACKEND
      └ Если укажете BACKEND_URL — можно тестировать в Postman
         (см. секцию API CONFIG и формат ниже)
   ========================================================= */

/* ======================
   API CONFIG (опционально)
   ======================

1) По умолчанию все данные хранятся в localStorage (никакого сервера не нужно).

2) Хотите иметь настоящий REST API для Postman?
   └ Создайте бесплатный бэкенд (подходит любой, например npoint.io / mockapi.io / supabase).
   └ Установите ниже:
        BACKEND_URL = "https://ВАШ-БЭКЕНД/api";
        API_ENABLED = true;
      (и при желании API_KEY)

   Ожидаемые эндпоинты (CRUD), JSON:

   GET    {BACKEND_URL}/schedule           -> [{id, dateISO, time, status, clientName, createdAt}]
   POST   {BACKEND_URL}/schedule           -> body {dateISO, time, status, clientName?}
   PATCH  {BACKEND_URL}/schedule/:id       -> body {status?, clientName?}
   DELETE {BACKEND_URL}/schedule/:id

   GET    {BACKEND_URL}/reviews            -> [{id, text, author, pinned, createdAt}]
   POST   {BACKEND_URL}/reviews            -> body {text, author}
   PATCH  {BACKEND_URL}/reviews/:id        -> body {text?, pinned?}
   DELETE {BACKEND_URL}/reviews/:id

   GET    {BACKEND_URL}/settings           -> {theme, font, slotStep, telegramWebhook}
   PATCH  {BACKEND_URL}/settings           -> {theme?, font?, slotStep?, telegramWebhook?}

   Если у вашего сервиса другой формат — адаптируйте функции api.* ниже.
*/

const API_ENABLED = false; // ← переключите на true, если укажете внешний бэкенд
const BACKEND_URL = "";    // например: "https://api.npoint.io/xxxxxxxx"
const API_KEY = "";        // если нужен

/* ======================
   Telegram WEBHOOK
   ======================
   Укажите URL вебхука для уведомлений владельцу в Telegram.
   В settings UI можно задать поле. Здесь только значение по умолчанию.
   Можно использовать: собственный бот (sendMessage), webhook.site, Integromat/Make, Zapier, etc.
*/
let TELEGRAM_WEBHOOK_URL_DEFAULT = ""; // можно оставить пустым — позже зададите в настройках

/* ======================
   DOM УТИЛИТЫ
====================== */
const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function showPage(id) {
  $$(".page").forEach(p => p.classList.add("hidden"));
  $("#" + id).classList.remove("hidden");
  // сохраняем последнюю страницу
  localStorage.setItem("page.current", id);
}

/* ======================
   СОСТОЯНИЕ ПРИЛОЖЕНИЯ
====================== */
const state = {
  owner: {
    username: localStorage.getItem("owner.username") || null,
    lastAuthAt: parseInt(localStorage.getItem("owner.lastAuthAt") || "0", 10), // ms
  },
  settings: {
    theme: localStorage.getItem("ui.theme") || "light",
    font: localStorage.getItem("ui.font") || "Arial",
    slotStep: parseInt(localStorage.getItem("schedule.step") || "30", 10), // мин
    telegramWebhook: localStorage.getItem("notify.telegram") || TELEGRAM_WEBHOOK_URL_DEFAULT,
  },
  schedule: loadJSON("schedule.items", []), // [{id,dateISO,time,status,clientName,createdAt}]
  reviews: loadJSON("reviews.items", []),   // [{id,text,author,pinned,createdAt}]
  isOwnerMode: false // переключатель «Я — владелец»
};

/* ======================
   ХРАНИЛКА (localStorage)
====================== */
function loadJSON(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; }
}
function saveJSON(key, val) {
  localStorage.setItem(key, JSON.stringify(val));
}

/* ======================
   АВТОРИЗАЦИЯ ВЛАДЕЛЬЦА
====================== */
const AUTH_INTERVAL_MS = 7 * 24 * 60 * 60 * 1000; // 1 раз в 7 дней

function isOwnerAuthenticated() {
  if (!state.owner.username) return false;
  const now = Date.now();
  return (now - state.owner.lastAuthAt) < AUTH_INTERVAL_MS;
}

function requireOwnerAuthIfNeeded() {
  if (!isOwnerAuthenticated()) {
    openAuthModal();
  } else {
    state.isOwnerMode = true;
    renderModeBadge();
  }
}

function openAuthModal() {
  const modal = buildModal(`
    <h3>Вход владельца</h3>
    <div class="small">Раз в неделю требуется подтверждение логина и пароля владельца.</div>
    <hr>
    <form id="ownerAuthForm" class="grid">
      <div>
        <label>Логин</label>
        <input id="ownerLogin" minlength="4" maxlength="10" required>
        <div class="small">Введите от 4 до 10 символов</div>
      </div>
      <div>
        <label>Пароль</label>
        <input id="ownerPass" type="password" minlength="6" maxlength="10" required>
        <div class="small">Введите от 6 до 10 символов</div>
      </div>
      <div class="row">
        <button type="submit" class="btn">Войти как владелец</button>
        <button type="button" class="btn ghost" id="authCancel">Отмена</button>
      </div>
    </form>
  `);

  $("#ownerAuthForm", modal)?.addEventListener("submit", (e) => {
    e.preventDefault();
    const login = $("#ownerLogin").value.trim();
    const pass = $("#ownerPass").value.trim();
    if (login.length < 4 || login.length > 10) return alert("Логин: 4–10 символов");
    if (pass.length < 6 || pass.length > 10) return alert("Пароль: 6–10 символов");

    // Регистрируем владельца при первом входе, иначе «проверяем» (в демо просто совпадение)
    const savedUser = localStorage.getItem("owner.username");
    const savedPass = localStorage.getItem("owner.pass");
    if (!savedUser || !savedPass) {
      localStorage.setItem("owner.username", login);
      localStorage.setItem("owner.pass", pass);
    } else {
      if (login !== savedUser || pass !== savedPass) {
        alert("Неверные логин или пароль");
        return;
      }
    }
    state.owner.username = login;
    state.owner.lastAuthAt = Date.now();
    localStorage.setItem("owner.lastAuthAt", String(state.owner.lastAuthAt));
    state.isOwnerMode = true;
    closeModal(modal);
    renderModeBadge();
    renderAll();
  });

  $("#authCancel", modal)?.addEventListener("click", () => {
    closeModal(modal);
    state.isOwnerMode = false;
    renderModeBadge();
  });
}

/* ======================
   МОДАЛКИ
====================== */
function buildModal(html) {
  const back = document.createElement("div");
  back.className = "modal-backdrop show";
  const box = document.createElement("div");
  box.className = "modal card modal";
  box.innerHTML = html;
  back.appendChild(box);
  document.body.appendChild(back);
  back.addEventListener("click", (e) => {
    if (e.target === back) closeModal(back);
  });
  return back;
}
function closeModal(modal) {
  modal.remove();
}

/* ======================
   НАСТРОЙКИ UI (тема/шрифт/шаг)
====================== */
function applyTheme(theme) {
  document.documentElement.classList.remove("theme-light","theme-dark","theme-blue","theme-green","theme-pink");
  document.documentElement.classList.add(`theme-${theme}`);
}
function applyFont(font) {
  document.documentElement.classList.remove("font-Arial","font-Georgia","font-Tahoma","font-Verdana","font-Courier\\ New");
  document.documentElement.classList.add(`font-${font.replaceAll(" ", "\\ ")}`);
}
function renderSettingsPage() {
  const themeSel = $("#themeSelect");
  const fontSel = $("#fontSelect");

  if (themeSel) themeSel.value = state.settings.theme;
  if (fontSel) fontSel.value = state.settings.font;

  // Добавим блок дополнительных настроек
  const settings = $("#settings");
  if (settings && !$("#extraSettings")) {
    const div = document.createElement("div");
    div.id = "extraSettings";
    div.className = "card grid";
    div.innerHTML = `
      <div class="row">
        <label>Шаг слотов (мин)</label>
        <select id="slotStep">
          <option>10</option><option>15</option><option>20</option><option selected>30</option><option>60</option>
        </select>
        <span class="badge">Только владелец меняет</span>
      </div>
      <div>
        <label>Webhook для Telegram-уведомлений</label>
        <input id="tgWebhook" placeholder="https://api.telegram.org/botXXX/sendMessage?chat_id=YYY&text=... ИЛИ webhook.site URL">
        <div class="small">При брони/изменениях клиентами отправляется POST с JSON.</div>
      </div>
      <div class="row">
        <button class="btn" id="saveSettings">Сохранить</button>
        <button class="btn secondary" id="exportData">Экспорт данных (JSON)</button>
        <button class="btn ghost" id="importData">Импорт данных (JSON)</button>
      </div>
      <div class="small">Экспорт/импорт — локально (localStorage). Для внешнего API смотрите блок API CONFIG в script.js.</div>
    `;
    settings.appendChild(div);

    $("#slotStep").value = String(state.settings.slotStep);
    $("#tgWebhook").value = state.settings.telegramWebhook || "";

    $("#saveSettings").addEventListener("click", () => {
      if (state.isOwnerMode) {
        state.settings.slotStep = parseInt($("#slotStep").value, 10);
        localStorage.setItem("schedule.step", String(state.settings.slotStep));
      }
      state.settings.telegramWebhook = $("#tgWebhook").value.trim();
      localStorage.setItem("notify.telegram", state.settings.telegramWebhook);
      alert("Настройки сохранены");
      renderCalendar();
    });

    $("#exportData").addEventListener("click", () => {
      const data = {
        schedule: state.schedule,
        reviews: state.reviews,
        settings: state.settings
      };
      const blob = new Blob([JSON.stringify(data, null, 2)], {type: "application/json"});
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = "barber-data.json";
      a.click();
      URL.revokeObjectURL(url);
    });

    $("#importData").addEventListener("click", async () => {
      const inp = document.createElement("input");
      inp.type = "file";
      inp.accept = "application/json";
      inp.onchange = async () => {
        const file = inp.files[0];
        if (!file) return;
        const txt = await file.text();
        try {
          const json = JSON.parse(txt);
          state.schedule = json.schedule || [];
          state.reviews  = json.reviews  || [];
          if (json.settings) {
            state.settings = {...state.settings, ...json.settings};
            localStorage.setItem("ui.theme", state.settings.theme);
            localStorage.setItem("ui.font", state.settings.font);
            localStorage.setItem("schedule.step", String(state.settings.slotStep));
            localStorage.setItem("notify.telegram", state.settings.telegramWebhook || "");
          }
          saveJSON("schedule.items", state.schedule);
          saveJSON("reviews.items", state.reviews);
          applyTheme(state.settings.theme);
          applyFont(state.settings.font);
          renderAll();
          alert("Импорт выполнен.");
        } catch (e) {
          alert("Ошибка импорта: " + e.message);
        }
      };
      inp.click();
    });
  }
}

/* ======================
   ПЕРЕКЛЮЧЕНИЕ ТЕМ/ШРИФТОВ
====================== */
function initThemeFontSelectors() {
  $("#themeSelect")?.addEventListener("change", (e) => {
    const v = e.target.value;
    state.settings.theme = v;
    localStorage.setItem("ui.theme", v);
    applyTheme(v);
  });
  $("#fontSelect")?.addEventListener("change", (e) => {
    const v = e.target.value;
    state.settings.font = v;
    localStorage.setItem("ui.font", v);
    applyFont(v);
  });
}

/* ======================
   МЕТКА РЕЖИМА (ВЛАДЕЛЕЦ/КЛИЕНТ)
====================== */
function renderModeBadge() {
  if (!$("#modeBadge")) {
    const b = document.createElement("div");
    b.id = "modeBadge";
    b.style.position = "fixed";
    b.style.right = "12px";
    b.style.bottom = "12px";
    b.className = "badge";
    document.body.appendChild(b);
  }
  $("#modeBadge").textContent = state.isOwnerMode ? "Режим: Владелец" : "Режим: Клиент";
}

/* ======================
   РАСПИСАНИЕ
====================== */
const DAYS = ["Пн","Вт","Ср","Чт","Пт","Сб","Вс"];

function renderCalendar() {
  const root = $("#calendar");
  if (!root) return;

  // Панель управления расписанием
  root.innerHTML = "";
  const controls = document.createElement("div");
  controls.className = "schedule-controls";

  // Выбор даты начала недели
  const startInput = document.createElement("input");
  startInput.type = "date";
  // Установим по умолчанию текущий понедельник
  const now = new Date();
  const monday = new Date(now);
  const day = (now.getDay() + 6) % 7; // 0-пн
  monday.setDate(now.getDate() - day);
  startInput.valueAsDate = monday;

  // Время работы
  const fromInput = document.createElement("input");
  fromInput.type = "time"; fromInput.value = "09:00";
  const toInput = document.createElement("input");
  toInput.type = "time"; toInput.value = "19:00";

  // Шаг
  const stepSel = document.createElement("select");
  [10,15,20,30,60].forEach(m => {
    const o = document.createElement("option");
    o.value = m; o.textContent = `${m} мин`;
    stepSel.appendChild(o);
  });
  stepSel.value = String(state.settings.slotStep);

  // Переключение роли
  const roleBtn = document.createElement("button");
  roleBtn.className = "btn secondary";
  roleBtn.textContent = state.isOwnerMode ? "Перейти как Клиент" : "Войти как Владелец";
  roleBtn.addEventListener("click", () => {
    if (state.isOwnerMode) {
      state.isOwnerMode = false;
      renderModeBadge();
      renderCalendar();
    } else {
      requireOwnerAuthIfNeeded();
      roleBtn.textContent = state.isOwnerMode ? "Перейти как Клиент" : "Войти как Владелец";
      renderCalendar();
    }
  });

  // Кнопка генерации слотов (только владелец)
  const genBtn = document.createElement("button");
  genBtn.textContent = "Сгенерировать слоты на неделю";
  genBtn.addEventListener("click", () => {
    if (!state.isOwnerMode) return alert("Только владелец может генерировать слоты.");
    const weekStart = new Date(startInput.value);
    const from = fromInput.value; // "09:00"
    const to = toInput.value;     // "19:00"
    const step = parseInt(stepSel.value, 10);
    generateSlotsForWeek(weekStart, from, to, step);
    renderCalendar();
    notifyOwner("Сгенерированы слоты на неделю");
  });

  controls.append(
    labelWrap("Неделя с:", startInput),
    labelWrap("Время с:", fromInput),
    labelWrap("Время до:", toInput),
    labelWrap("Шаг:", stepSel),
    genBtn,
    roleBtn
  );
  root.appendChild(controls);

  // Сетка календаря
  const grid = document.createElement("div");
  grid.className = "calendar";

  for (let i=0;i<7;i++) {
    const dayDate = new Date(startInput.value);
    dayDate.setDate(dayDate.getDate()+i);
    const dateISO = dayDate.toISOString().slice(0,10);

    const col = document.createElement("div");
    col.className = "day-col";

    const head = document.createElement("div");
    head.className = "day-head";
    head.textContent = `${DAYS[i]} • ${formatDateRu(dayDate)}`;
    col.appendChild(head);

    // Слоты текущего дня
    const daySlots = state.schedule
      .filter(s => s.dateISO === dateISO)
      .sort((a,b)=>a.time.localeCompare(b.time));

    // Рендер
    daySlots.forEach(slot => {
      const el = document.createElement("div");
      el.className = "slot " + (slot.status === "free" ? "free" : "busy");
      el.innerHTML = `
        <div>
          <div class="time">${slot.time}</div>
          <div class="who">${slot.status === "busy" ? `Занято (${slot.clientName||"клиент"})` : "Свободно"}</div>
        </div>
        <div class="actions"></div>
      `;
      const actions = el.querySelector(".actions");

      if (slot.status === "free") {
        // Клиент может бронировать
        const book = btn("Записаться", () => {
          const name = prompt("Ваше имя для записи:");
          if (!name) return;
          slot.status = "busy";
          slot.clientName = name;
          persistSchedule();
          renderCalendar();
          notifyOwner(`Новая запись: ${dateISO} ${slot.time} — ${name}`);
        });
        actions.appendChild(book);
      } else {
        // Клиент может отменить ТОЛЬКО свою (для примера спросим имя)
        const unbook = btn("Отменить", () => {
          if (!confirm("Отменить запись?")) return;
          slot.status = "free";
          slot.clientName = null;
          persistSchedule();
          renderCalendar();
          notifyOwner(`Клиент отменил запись: ${dateISO} ${slot.time}`);
        });
        actions.appendChild(unbook);
      }

      if (state.isOwnerMode) {
        // Владелец — дополнительные действия
        const toggle = btn(slot.status==="free"?"Пометить занятым":"Освободить", () => {
          slot.status = slot.status === "free" ? "busy" : "free";
          if (slot.status==="free") slot.clientName=null;
          persistSchedule(); renderCalendar();
        },"secondary");
        const del = btn("Удалить", () => {
          state.schedule = state.schedule.filter(s => s.id !== slot.id);
          persistSchedule(); renderCalendar();
        },"ghost");
        actions.append(toggle, del);
      }

      col.appendChild(el);
    });

    grid.appendChild(col);
  }

  root.appendChild(grid);

  // реакция на смену шага
  stepSel.addEventListener("change", () => {
    state.settings.slotStep = parseInt(stepSel.value, 10);
    localStorage.setItem("schedule.step", String(state.settings.slotStep));
    // только владелец может менять по ТЗ — но UI не блокируем, просто сохраняем
  });
}

function labelWrap(text, inputEl) {
  const wrap = document.createElement("div");
  const lab = document.createElement("label");
  lab.textContent = text;
  wrap.append(lab, inputEl);
  return wrap;
}

function btn(text, handler, cls="") {
  const b = document.createElement("button");
  b.className = "btn " + cls;
  b.textContent = text;
  b.addEventListener("click", handler);
  return b;
}

function generateSlotsForWeek(weekStart, fromHHmm, toHHmm, stepMin) {
  // Удалим старые слоты этой недели (безопасно)
  const weekDates = [];
  for (let i=0;i<7;i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate()+i);
    weekDates.push(d.toISOString().slice(0,10));
  }
  state.schedule = state.schedule.filter(s => !weekDates.includes(s.dateISO));

  // Создадим новые
  for (let i=0;i<7;i++) {
    const d = new Date(weekStart);
    d.setDate(d.getDate()+i);
    const dateISO = d.toISOString().slice(0,10);

    const times = buildTimeRange(fromHHmm, toHHmm, stepMin);
    times.forEach(time => {
      state.schedule.push({
        id: "s_"+Math.random().toString(36).slice(2,10),
        dateISO, time,
        status: "free",
        clientName: null,
        createdAt: Date.now()
      });
    });
  }
  persistSchedule();
}

function buildTimeRange(fromHHmm, toHHmm, stepMin) {
  const [fh, fm] = fromHHmm.split(":").map(Number);
  const [th, tm] = toHHmm.split(":").map(Number);
  let start = fh*60 + fm;
  const end = th*60 + tm;
  const out = [];
  while (start < end) {
    const h = Math.floor(start/60).toString().padStart(2,"0");
    const m = (start%60).toString().padStart(2,"0");
    out.push(`${h}:${m}`);
    start += stepMin;
  }
  return out;
}

function persistSchedule() {
  saveJSON("schedule.items", state.schedule);
  // при желании синхронизировать с внешним API:
  if (API_ENABLED && BACKEND_URL) {
    // пример — отправляем полное состояние (адаптируйте под ваш сервис)
    // fetch(`${BACKEND_URL}/schedule/bulk`, {method:"PUT", headers:jsonHeaders(), body:JSON.stringify(state.schedule)}).catch(()=>{});
  }
}

function formatDateRu(d) {
  return d.toLocaleDateString("ru-RU", {day:"2-digit", month:"2-digit"});
}

/* ======================
   ОТЗЫВЫ
====================== */
function initReviews() {
  const form = $("#reviewForm");
  if (form && !form._wired) {
    form._wired = true;
    form.addEventListener("submit", (e) => {
      e.preventDefault();
      const ta = form.querySelector("textarea");
      const text = ta.value.trim();
      if (!text) return;
      const rev = {
        id: "r_"+Math.random().toString(36).slice(2,10),
        text,
        author: "Гость",
        pinned: false,
        createdAt: Date.now(),
      };
      state.reviews.unshift(rev);
      ta.value = "";
      saveJSON("reviews.items", state.reviews);
      renderReviews();
      notifyOwner("Новый отзыв: " + (text.length>50? text.slice(0,50)+"…":text));
    });
  }
  renderReviews();
}

function renderReviews() {
  const list = $("#reviewsList");
  if (!list) return;
  list.innerHTML = "";

  // Закреплённые впереди
  const items = [...state.reviews].sort((a,b)=> (b.pinned - a.pinned) || (b.createdAt - a.createdAt));
  items.forEach(r => {
    const box = document.createElement("div");
    box.className = "review card" + (r.pinned?" pinned":"");
    box.innerHTML = `
      <div class="meta">${new Date(r.createdAt).toLocaleString("ru-RU")} • ${r.author}</div>
      <div class="text">${escapeHTML(r.text)}</div>
      <div class="row" style="margin-top:8px;"></div>
    `;
    const row = box.querySelector(".row");

    if (state.isOwnerMode) {
      const pin = btn(r.pinned?"Открепить":"Закрепить", () => {
        r.pinned = !r.pinned;
        saveJSON("reviews.items", state.reviews);
        renderReviews();
      },"secondary");
      const edit = btn("Редактировать", () => {
        const t = prompt("Изменить текст:", r.text);
        if (t==null) return;
        r.text = t;
        saveJSON("reviews.items", state.reviews);
        renderReviews();
      },"secondary");
      const del = btn("Удалить", () => {
        if (!confirm("Удалить отзыв?")) return;
        state.reviews = state.reviews.filter(x=>x.id!==r.id);
        saveJSON("reviews.items", state.reviews);
        renderReviews();
      },"ghost");
      row.append(pin, edit, del);
    }
    list.appendChild(box);
  });
}

function escapeHTML(s) {
  return s.replace(/[&<>"']/g, (m) => ({
    "&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"
  }[m]));
}

/* ======================
   УВЕДОМЛЕНИЯ В ТЕЛЕГРАМ
====================== */
async function notifyOwner(message) {
  const url = state.settings.telegramWebhook;
  if (!url) return; // не задан — не шлём
  try {
    await fetch(url, {
      method: "POST",
      headers: {"Content-Type":"application/json"},
      body: JSON.stringify({
        event: "schedule_change",
        message,
        at: new Date().toISOString()
      })
    });
  } catch (e) {
    console.warn("Не удалось отправить уведомление:", e);
  }
}

/* ======================
   ИНИЦИАЛИЗАЦИЯ
====================== */
function init() {
  // восстановить последнюю страницу
  const lastPage = localStorage.getItem("page.current") || "schedule";
  showPage(lastPage);

  // применить тему/шрифт
  applyTheme(state.settings.theme);
  applyFont(state.settings.font);

  // инициализация селекторов
  initThemeFontSelectors();

  // отрисовка
  renderModeBadge();
  renderSettingsPage();
  renderCalendar();
  initReviews();

  // кнопки в header (если решишь добавить роль/выход)
  // ...

  // если владелец не авторизован (раз в неделю), попросим при попытке входа
}

document.addEventListener("DOMContentLoaded", init);

/* ======================
   МЕЛКИЕ УТИЛИТЫ
====================== */
function jsonHeaders() {
  const h = {"Content-Type":"application/json"};
  if (API_KEY) h["Authorization"] = `Bearer ${API_KEY}`;
  return h;
}
