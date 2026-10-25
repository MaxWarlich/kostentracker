'use strict';

/* =========================================================
   Kosten-Tracker – app.js
   Die gesamte Logik der App:
   1. Konstanten & Hilfsfunktionen (Formatierung, Datum, Beträge)
   2. Datenspeicher (localStorage)
   3. Kategorien
   4. Wiederkehrende Posten (automatisches Eintragen)
   5. Darstellung der Ansichten
   6. Diagramme (Chart.js)
   7. Dialoge
   8. Ereignisse (Klicks, Formulare)
   9. Start

   Beträge werden intern immer in CENT (ganze Zahlen) gespeichert,
   damit keine Rundungsfehler wie 0,1 + 0,2 = 0,30000000004 entstehen.
   Datumswerte werden als Text im Format "JJJJ-MM-TT" gespeichert,
   Monate als "JJJJ-MM".
   ========================================================= */

// ---------- 1. Konstanten & Hilfsfunktionen ----------

const STORAGE_KEY = 'kostentracker-daten-v1';
const THEME_KEY = 'kostentracker-theme';
const NO_CATEGORY = '__none__'; // Filterwert für "Ohne Kategorie"

const MONTH_NAMES = ['Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember'];
const MONTH_SHORT = ['Jan', 'Feb', 'Mär', 'Apr', 'Mai', 'Jun',
  'Jul', 'Aug', 'Sep', 'Okt', 'Nov', 'Dez'];
const TYPE_LABEL = { income: 'Einnahme', expense: 'Ausgabe' };

// Farben für das Kreisdiagramm (und die Punkte in der Kategorienliste)
const PIE_COLORS = ['#4f7cff', '#f2994a', '#27ae60', '#eb5757', '#9b51e0', '#2d9cdb',
  '#f2c94c', '#e056a0', '#56ccf2', '#6fcf97', '#bb6bd9', '#8d99ae'];

// Kleine Symbole (SVG) für Bearbeiten/Löschen-Buttons
const ICON_EDIT = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/></svg>';
const ICON_DELETE = '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/></svg>';

// Deutsche Zahlenformate: 1.234,56 €
const euroFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR' });
const euroShortFormat = new Intl.NumberFormat('de-DE', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });
const percentFormat = new Intl.NumberFormat('de-DE', { style: 'percent', maximumFractionDigits: 1 });

/** Kurzschreibweise für document.querySelector */
const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

/** Erzeugt eine eindeutige ID für Einträge, Kategorien usw. */
function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
}

/** 5 -> "05" */
function pad(n) {
  return String(n).padStart(2, '0');
}

/** Heutiges Datum als "JJJJ-MM-TT" (in lokaler Zeit, nicht UTC) */
function todayISO() {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** "2026-10-25" -> "2026-10" */
function monthOf(isoDate) {
  return isoDate.slice(0, 7);
}

function currentMonth() {
  return monthOf(todayISO());
}

/** Monat verschieben: addMonths("2026-01", -1) -> "2025-12" */
function addMonths(monthKey, n) {
  const [y, m] = monthKey.split('-').map(Number);
  const total = y * 12 + (m - 1) + n;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** Anzahl Tage eines Monats, z. B. "2026-02" -> 28 */
function daysInMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return new Date(y, m, 0).getDate();
}

/** "2026-10" -> "Oktober 2026" */
function formatMonth(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_NAMES[m - 1]} ${y}`;
}

/** "2026-10" -> "Okt 26" (für die Diagrammachse) */
function formatMonthShort(monthKey) {
  const [y, m] = monthKey.split('-').map(Number);
  return `${MONTH_SHORT[m - 1]} ${String(y).slice(2)}`;
}

/** "2026-10-25" -> "25.10.2026" */
function formatDate(isoDate) {
  const [y, m, d] = isoDate.split('-');
  return `${d}.${m}.${y}`;
}

/** 123456 (Cent) -> "1.234,56 €" */
function formatEuro(cents) {
  return euroFormat.format(cents / 100);
}

/** 1250 (Cent) -> "12,50" (für Eingabefelder) */
function centsToInput(cents) {
  return (cents / 100).toFixed(2).replace('.', ',');
}

/**
 * Liest einen eingegebenen Betrag und gibt ihn in Cent zurück.
 * Erlaubt: "12,50", "12.50", "1.234,56", "1234", "12,5 €".
 * Gibt null zurück, wenn der Betrag ungültig oder nicht größer als 0 ist.
 */
function parseAmount(text) {
  let s = String(text).replace(/[\s€]/g, '');
  if (!s) return null;
  if (s.includes(',')) {
    // Deutsches Format: Punkte sind Tausendertrennzeichen, Komma ist Dezimaltrennzeichen
    s = s.replace(/\./g, '').replace(',', '.');
  } else if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
    // "1.234" ohne Komma = Tausenderpunkt
    s = s.replace(/\./g, '');
  }
  if (!/^\d+(\.\d{1,2})?$/.test(s)) return null;
  const cents = Math.round(parseFloat(s) * 100);
  return cents > 0 ? cents : null;
}

/**
 * Wie parseAmount, erlaubt aber auch 0 und negative Beträge (z. B. "-250,00" bei überzogenem Konto).
 * Gibt null zurück, wenn die Eingabe ungültig ist. Ein leeres Feld zählt als 0.
 */
function parseSignedAmount(text) {
  const s = String(text).trim();
  if (!s) return 0;
  const negative = /^[-−]/.test(s);
  const rest = negative ? s.slice(1) : s;
  if (/^[\s€]*0+([.,]0{1,2})?[\s€]*$/.test(rest)) return 0;
  const cents = parseAmount(rest);
  if (cents === null) return null;
  return negative ? -cents : cents;
}

/** Schützt vor HTML-Einschleusung, wenn Text (z. B. Notizen) ins HTML eingesetzt wird */
function escapeHtml(text) {
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/** Deutsche Einzahl/Mehrzahl: plural(1, 'Eintrag', 'Einträge') -> "1 Eintrag" */
function plural(n, one, many) {
  return `${n} ${n === 1 ? one : many}`;
}

/** Zeigt unten kurz eine Meldung an */
let toastTimer = null;
function showToast(message) {
  const toast = $('#toast');
  toast.textContent = message;
  toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { toast.hidden = true; }, 3200);
}

// ---------- 2. Datenspeicher (localStorage) ----------

/** Startdaten beim allerersten Öffnen: ein paar Beispielkategorien */
function defaultState() {
  const cat = (name, type) => ({ id: uid(), name, type });
  return {
    version: 1,
    categories: [
      cat('Wohnen', 'expense'),
      cat('Lebensmittel', 'expense'),
      cat('Mobilität', 'expense'),
      cat('Versicherungen', 'expense'),
      cat('Handy & Internet', 'expense'),
      cat('Freizeit', 'expense'),
      cat('Sonstiges', 'expense'),
      cat('Gehalt', 'income'),
      cat('Nebenjob', 'income'),
      cat('Sonstiges', 'income'),
    ],
    entries: [],
    recurring: [],
    settings: defaultSettings(),
  };
}

/** Startguthaben: Betrag in Cent (darf negativ sein) und Monat, ab dem es gilt */
function defaultSettings() {
  return { startBalance: 0, startMonth: currentMonth() };
}

/**
 * Prüft geladene Daten (aus localStorage oder einer Import-Datei)
 * und filtert kaputte Datensätze heraus. Gibt null zurück, wenn die Daten unbrauchbar sind.
 */
function normalizeState(data) {
  if (!data || !Array.isArray(data.categories) || !Array.isArray(data.entries) || !Array.isArray(data.recurring)) {
    return null;
  }
  const isType = (t) => t === 'income' || t === 'expense';
  const isDate = (d) => typeof d === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(d);
  const isMonth = (m) => typeof m === 'string' && /^\d{4}-\d{2}$/.test(m);
  const isCents = (a) => Number.isInteger(a) && a > 0;
  const settings = data.settings && Number.isInteger(data.settings.startBalance) && isMonth(data.settings.startMonth)
    ? { startBalance: data.settings.startBalance, startMonth: data.settings.startMonth }
    : defaultSettings();

  return {
    version: 1,
    categories: data.categories.filter((c) => c && c.id && typeof c.name === 'string' && isType(c.type)),
    entries: data.entries.filter((e) => e && e.id && isType(e.type) && isCents(e.amount) && isDate(e.date)),
    recurring: data.recurring.filter((r) => r && r.id && isType(r.type) && isCents(r.amount)
      && Number.isInteger(r.day) && isMonth(r.startMonth) && isMonth(r.lastGenerated)),
    settings,
  };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const loaded = normalizeState(JSON.parse(raw));
      if (loaded) return loaded;
    }
  } catch (err) {
    console.warn('Gespeicherte Daten konnten nicht gelesen werden:', err);
  }
  return defaultState();
}

function saveState() {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch (err) {
    console.error(err);
    showToast('Speichern fehlgeschlagen – ist der Speicher des Browsers voll oder gesperrt?');
  }
}

// Der komplette Datenbestand der App
let state = loadState();

// Zustand der Oberfläche (wird nicht gespeichert)
const ui = {
  view: 'overview',          // aktive Ansicht
  month: currentMonth(),     // in der Übersicht gewählter Monat
  editingCategoryId: null,   // Kategorie, die gerade umbenannt wird
  editingEntryId: null,      // Eintrag im Dialog (null = neuer Eintrag)
  editingRecurringId: null,  // wiederkehrender Posten im Dialog
  charts: { pie: null, bar: null },
};

// ---------- 3. Kategorien ----------

function getCategory(id) {
  return state.categories.find((c) => c.id === id) || null;
}

/** Name einer Kategorie oder "Ohne Kategorie", falls gelöscht/nicht gesetzt */
function categoryName(id) {
  const cat = getCategory(id);
  return cat ? cat.name : 'Ohne Kategorie';
}

/** Alle Kategorien eines Typs, alphabetisch sortiert */
function categoriesOfType(type) {
  return state.categories
    .filter((c) => c.type === type)
    .sort((a, b) => a.name.localeCompare(b.name, 'de'));
}

/** Gibt es den Namen beim selben Typ schon? (Groß-/Kleinschreibung egal) */
function categoryNameTaken(name, type, exceptId = null) {
  const lower = name.toLowerCase();
  return state.categories.some((c) => c.type === type && c.id !== exceptId && c.name.toLowerCase() === lower);
}

/** Legt eine Kategorie an. Gibt eine Fehlermeldung zurück oder null bei Erfolg. */
function addCategory(name, type) {
  name = name.trim();
  if (!name) return 'Bitte einen Namen eingeben.';
  if (categoryNameTaken(name, type)) return `Die Kategorie „${name}“ gibt es schon.`;
  state.categories.push({ id: uid(), name, type });
  saveState();
  return null;
}

function renameCategory(id, name) {
  const cat = getCategory(id);
  name = name.trim();
  if (!cat) return 'Kategorie nicht gefunden.';
  if (!name) return 'Bitte einen Namen eingeben.';
  if (categoryNameTaken(name, cat.type, id)) return `Die Kategorie „${name}“ gibt es schon.`;
  cat.name = name;
  saveState();
  return null;
}

/** Löscht eine Kategorie nach Rückfrage. Betroffene Einträge werden "Ohne Kategorie". */
function deleteCategory(id) {
  const cat = getCategory(id);
  if (!cat) return;
  const usedEntries = state.entries.filter((e) => e.categoryId === id).length;
  const usedRecurring = state.recurring.filter((r) => r.categoryId === id).length;

  let question = `Kategorie „${cat.name}“ wirklich löschen?`;
  if (usedEntries || usedRecurring) {
    question += `\n\nSie wird von ${plural(usedEntries, 'Eintrag', 'Einträgen')} und `
      + `${plural(usedRecurring, 'wiederkehrendem Posten', 'wiederkehrenden Posten')} verwendet. `
      + 'Diese werden auf „Ohne Kategorie“ gesetzt, bleiben aber erhalten.';
  }
  if (!confirm(question)) return;

  state.entries.forEach((e) => { if (e.categoryId === id) e.categoryId = null; });
  state.recurring.forEach((r) => { if (r.categoryId === id) r.categoryId = null; });
  state.categories = state.categories.filter((c) => c.id !== id);
  saveState();
  renderAll();
  showToast('Kategorie gelöscht');
}

// ---------- 4. Wiederkehrende Posten ----------

/**
 * Trägt fällige wiederkehrende Posten als normale Einträge ein.
 *
 * So werden doppelte Einträge verhindert:
 * - Jeder Posten merkt sich in "lastGenerated" den letzten Monat, für den er schon eingetragen wurde.
 *   Es werden nur Monate DANACH bis einschließlich heute bearbeitet.
 * - Zusätzlich wird geprüft, ob es für Posten + Monat schon einen Eintrag gibt.
 * - Löschst du einen automatisch erzeugten Eintrag, kommt er nicht wieder,
 *   weil der Monat in "lastGenerated" schon als erledigt gilt.
 *
 * Im aktuellen Monat wird erst eingetragen, wenn der eingestellte Tag erreicht ist.
 * Gibt die Anzahl neu angelegter Einträge zurück.
 */
function applyRecurring() {
  const today = todayISO();
  const thisMonth = monthOf(today);
  const todayDay = Number(today.slice(8, 10));
  let created = 0;
  let changed = false;

  state.recurring.forEach((r) => {
    if (!r.active) return;

    let month = addMonths(r.lastGenerated, 1);
    // Monatstexte "JJJJ-MM" lassen sich direkt vergleichen
    while (month <= thisMonth) {
      const day = Math.min(r.day, daysInMonth(month)); // z. B. 31. -> 28. Februar
      if (month === thisMonth && todayDay < day) break; // noch nicht fällig

      const alreadyThere = state.entries.some((e) => e.recurringId === r.id && e.recurringMonth === month);
      if (!alreadyThere) {
        state.entries.push({
          id: uid(),
          type: r.type,
          amount: r.amount,
          date: `${month}-${pad(day)}`,
          categoryId: r.categoryId,
          note: r.name,
          recurringId: r.id,
          recurringMonth: month,
          createdAt: Date.now(),
        });
        created++;
      }
      r.lastGenerated = month;
      changed = true;
      month = addMonths(month, 1);
    }
  });

  if (changed) saveState();
  return created;
}

/** Pausieren bzw. fortsetzen. Pausierte Monate werden beim Fortsetzen NICHT nachgetragen. */
function toggleRecurring(id) {
  const r = state.recurring.find((x) => x.id === id);
  if (!r) return;
  r.active = !r.active;
  if (r.active) {
    // Alles vor dem aktuellen Monat gilt als erledigt, der aktuelle Monat wird ggf. noch eingetragen
    const previousMonth = addMonths(currentMonth(), -1);
    if (r.lastGenerated < previousMonth) r.lastGenerated = previousMonth;
  }
  saveState();
  const created = applyRecurring();
  renderAll();
  showToast(r.active
    ? `„${r.name}“ fortgesetzt${created ? ` – ${plural(created, 'Eintrag', 'Einträge')} hinzugefügt` : ''}`
    : `„${r.name}“ pausiert`);
}

function deleteRecurring(id) {
  const r = state.recurring.find((x) => x.id === id);
  if (!r) return;
  if (!confirm(`Wiederkehrenden Posten „${r.name}“ löschen?\n\nBereits eingetragene Einträge bleiben erhalten.`)) return;
  state.recurring = state.recurring.filter((x) => x.id !== id);
  saveState();
  renderAll();
  showToast('Wiederkehrender Posten gelöscht');
}

// ---------- 5. Darstellung der Ansichten ----------

/** Zeichnet alle Ansichten neu (nach jeder Datenänderung) */
function renderAll() {
  renderOverview();
  renderCategoryFilter();
  renderEntries();
  renderRecurring();
  renderCategories();
}

/** Wechselt zwischen Übersicht, Einträge, Wiederkehrend und Kategorien */
function showView(name) {
  ui.view = name;
  $$('.view').forEach((v) => v.classList.toggle('is-active', v.id === `view-${name}`));
  $$('.tab').forEach((tab) => {
    const active = tab.dataset.view === name;
    tab.classList.toggle('is-active', active);
    if (active) tab.setAttribute('aria-current', 'page');
    else tab.removeAttribute('aria-current');
  });
  window.scrollTo(0, 0);
}

function entriesInMonth(monthKey) {
  return state.entries.filter((e) => monthOf(e.date) === monthKey);
}

function sumOfType(entries, type) {
  return entries.filter((e) => e.type === type).reduce((sum, e) => sum + e.amount, 0);
}

/** Summen pro Kategorie, absteigend sortiert: [{ id, name, sum }] */
function sumsByCategory(entries, type) {
  const sums = new Map();
  entries.filter((e) => e.type === type).forEach((e) => {
    const key = getCategory(e.categoryId) ? e.categoryId : NO_CATEGORY;
    sums.set(key, (sums.get(key) || 0) + e.amount);
  });
  return Array.from(sums, ([id, sum]) => ({
    id,
    name: id === NO_CATEGORY ? 'Ohne Kategorie' : categoryName(id),
    sum,
  })).sort((a, b) => b.sum - a.sum);
}

/**
 * Übertrag in den angegebenen Monat:
 * Saldo ALLER Einträge vor diesem Monat (jeder Gewinn/Verlust wird in alle folgenden Monate weitergetragen)
 * plus das Startguthaben, sobald dessen Startmonat erreicht ist.
 */
function carryOver(monthKey) {
  const { startBalance, startMonth } = state.settings;
  const before = state.entries.filter((e) => monthOf(e.date) < monthKey);
  const start = monthKey >= startMonth ? startBalance : 0;
  return start + sumOfType(before, 'income') - sumOfType(before, 'expense');
}

/** Betrag anzeigen: grün wenn positiv, rot wenn negativ */
function setSignedAmount(el, cents) {
  el.textContent = formatEuro(cents);
  el.classList.toggle('income', cents > 0);
  el.classList.toggle('expense', cents < 0);
}

/* ----- Übersicht ----- */
function renderOverview() {
  const monthEntries = entriesInMonth(ui.month);
  const income = sumOfType(monthEntries, 'income');
  const expense = sumOfType(monthEntries, 'expense');
  const monthBalance = income - expense;
  // Übertrag = Saldo aller Einträge vor dem gewählten Monat, d. h. was aus den Vormonaten übrig ist
  const carry = carryOver(ui.month);
  const balance = carry + monthBalance;

  $('#month-label').textContent = formatMonth(ui.month);
  $('#month-today').hidden = ui.month === currentMonth();
  $('#sum-income').textContent = formatEuro(income);
  $('#sum-expense').textContent = formatEuro(expense);
  setSignedAmount($('#sum-carry'), carry);
  setSignedAmount($('#sum-balance'), balance);
  $('#sum-month-balance').textContent = `davon dieser Monat: ${formatEuro(monthBalance)}`;

  renderCategorySums($('#cat-sums-expense'), sumsByCategory(monthEntries, 'expense'), expense, true);
  renderCategorySums($('#cat-sums-income'), sumsByCategory(monthEntries, 'income'), income, false);
  renderCharts(monthEntries);
}

/** Liste "Summe pro Kategorie" mit Prozentbalken */
function renderCategorySums(listEl, rows, total, isExpense) {
  if (!rows.length) {
    listEl.innerHTML = `<li class="empty">Keine ${isExpense ? 'Ausgaben' : 'Einnahmen'} in diesem Monat.</li>`;
    return;
  }
  listEl.innerHTML = rows.map((row, i) => {
    // Ausgaben: gleiche Farbe wie im Kreisdiagramm, Einnahmen: grün
    const color = isExpense ? PIE_COLORS[i % PIE_COLORS.length] : 'var(--income)';
    const share = total ? row.sum / total : 0;
    return `
      <li>
        <div class="cat-sum-row">
          <span class="dot" style="background:${color}"></span>
          <span class="cat-sum-name">${escapeHtml(row.name)}</span>
          <span class="cat-sum-percent">${percentFormat.format(share)}</span>
          <span class="cat-sum-amount">${formatEuro(row.sum)}</span>
        </div>
        <div class="bar"><span style="width:${(share * 100).toFixed(1)}%;background:${color}"></span></div>
      </li>`;
  }).join('');
}

/* ----- Einträge mit Suche & Filter ----- */

/** Füllt das Kategorie-Auswahlfeld im Filter (behält die aktuelle Auswahl) */
function renderCategoryFilter() {
  const select = $('#f-category');
  const previous = select.value;
  const options = (type) => categoriesOfType(type)
    .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('');

  select.innerHTML = `
    <option value="">Alle</option>
    <optgroup label="Ausgaben">${options('expense')}</optgroup>
    <optgroup label="Einnahmen">${options('income')}</optgroup>
    <option value="${NO_CATEGORY}">Ohne Kategorie</option>`;

  // Vorherige Auswahl wiederherstellen, falls die Kategorie noch existiert
  select.value = Array.from(select.options).some((o) => o.value === previous) ? previous : '';
}

function getFilters() {
  return {
    text: $('#f-text').value.trim().toLowerCase(),
    type: $('#f-type').value,
    category: $('#f-category').value,
    from: $('#f-from').value,
    to: $('#f-to').value,
  };
}

function filterEntries(filters) {
  return state.entries.filter((e) => {
    if (filters.type && e.type !== filters.type) return false;
    if (filters.category === NO_CATEGORY) {
      if (getCategory(e.categoryId)) return false;
    } else if (filters.category && e.categoryId !== filters.category) {
      return false;
    }
    if (filters.from && e.date < filters.from) return false;
    if (filters.to && e.date > filters.to) return false;
    if (filters.text) {
      // Gesucht wird in Notiz, Kategoriename, Datum und Betrag
      const haystack = [e.note || '', categoryName(e.categoryId), formatDate(e.date),
        formatEuro(e.amount), centsToInput(e.amount)].join(' ').toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });
}

function renderEntries() {
  const filters = getFilters();
  const list = filterEntries(filters).sort((a, b) =>
    b.date.localeCompare(a.date) || (b.createdAt || 0) - (a.createdAt || 0));

  const income = sumOfType(list, 'income');
  const expense = sumOfType(list, 'expense');
  $('#filter-summary').innerHTML = list.length
    ? `${plural(list.length, 'Eintrag', 'Einträge')} · Einnahmen <strong class="income">${formatEuro(income)}</strong>`
      + ` · Ausgaben <strong class="expense">${formatEuro(expense)}</strong>`
    : '';

  const container = $('#entry-list');
  if (!list.length) {
    container.innerHTML = state.entries.length
      ? '<p class="empty">Keine Einträge passen zu deinem Filter.</p>'
      : '<p class="empty">Noch keine Einträge. Tippe unten rechts auf <strong>+</strong>, um den ersten Eintrag anzulegen.</p>';
    return;
  }

  // Nach Monaten gruppieren
  const groups = new Map();
  list.forEach((e) => {
    const key = monthOf(e.date);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(e);
  });

  container.innerHTML = Array.from(groups, ([monthKey, entries]) => {
    const saldo = sumOfType(entries, 'income') - sumOfType(entries, 'expense');
    return `
      <h3 class="list-month"><span>${formatMonth(monthKey)}</span><span>${formatEuro(saldo)}</span></h3>
      <div class="entry-group">${entries.map(entryHtml).join('')}</div>`;
  }).join('');
}

/** HTML für eine Zeile in der Eintragsliste */
function entryHtml(e) {
  const sign = e.type === 'expense' ? '−' : '+';
  const recurringBadge = e.recurringId ? '<span class="badge" title="Automatisch aus einem wiederkehrenden Posten">↻ wiederkehrend</span>' : '';
  const note = e.note ? ` · ${escapeHtml(e.note)}` : '';
  return `
    <article class="entry" data-id="${e.id}">
      <div class="entry-info">
        <div class="entry-title">${escapeHtml(categoryName(e.categoryId))}${recurringBadge}</div>
        <div class="entry-sub">${formatDate(e.date)}${note}</div>
      </div>
      <div class="entry-amount ${e.type}">${sign}${formatEuro(e.amount)}</div>
      <div class="entry-actions">
        <button class="icon-btn" type="button" data-action="edit" aria-label="Bearbeiten" title="Bearbeiten">${ICON_EDIT}</button>
        <button class="icon-btn danger" type="button" data-action="delete" aria-label="Löschen" title="Löschen">${ICON_DELETE}</button>
      </div>
    </article>`;
}

/* ----- Wiederkehrende Posten ----- */
function renderRecurring() {
  const container = $('#recurring-list');
  const items = [...state.recurring].sort((a, b) => a.day - b.day || a.name.localeCompare(b.name, 'de'));

  // Monatliche Summe aller aktiven Posten
  const active = items.filter((r) => r.active);
  const fixedIncome = sumOfType(active, 'income');
  const fixedExpense = sumOfType(active, 'expense');
  $('#recurring-total').innerHTML = active.length
    ? `Pro Monat aktiv: Einnahmen <strong class="income">${formatEuro(fixedIncome)}</strong>`
      + ` · Ausgaben <strong class="expense">${formatEuro(fixedExpense)}</strong>`
    : '';

  if (!items.length) {
    container.innerHTML = '<p class="empty">Noch keine wiederkehrenden Posten angelegt.</p>';
    return;
  }

  container.innerHTML = `<div class="entry-group">${items.map((r) => {
    const sign = r.type === 'expense' ? '−' : '+';
    const status = r.active
      ? '<span class="badge badge-active">aktiv</span>'
      : '<span class="badge">pausiert</span>';
    const last = r.lastGenerated >= r.startMonth
      ? `zuletzt eingetragen: ${formatMonth(r.lastGenerated)}`
      : `startet ${formatMonth(r.startMonth)}`;
    return `
      <article class="entry ${r.active ? '' : 'is-paused'}" data-id="${r.id}">
        <div class="entry-info">
          <div class="entry-title">${escapeHtml(r.name)}${status}</div>
          <div class="entry-sub">${TYPE_LABEL[r.type]} · ${escapeHtml(categoryName(r.categoryId))} · jeden ${r.day}. im Monat</div>
          <div class="entry-sub">${last}</div>
        </div>
        <div class="entry-amount ${r.type}">${sign}${formatEuro(r.amount)}</div>
        <div class="entry-actions">
          <button class="btn btn-small" type="button" data-action="toggle">${r.active ? 'Pausieren' : 'Fortsetzen'}</button>
          <button class="icon-btn" type="button" data-action="edit" aria-label="Bearbeiten" title="Bearbeiten">${ICON_EDIT}</button>
          <button class="icon-btn danger" type="button" data-action="delete" aria-label="Löschen" title="Löschen">${ICON_DELETE}</button>
        </div>
      </article>`;
  }).join('')}</div>`;
}

/* ----- Kategorien verwalten ----- */
function renderCategories() {
  ['expense', 'income'].forEach((type) => {
    const listEl = $(`#cat-list-${type}`);
    const cats = categoriesOfType(type);
    if (!cats.length) {
      listEl.innerHTML = '<li class="empty">Noch keine Kategorien.</li>';
      return;
    }
    listEl.innerHTML = cats.map((c) => {
      // Diese Kategorie wird gerade umbenannt -> Eingabefeld anzeigen
      if (ui.editingCategoryId === c.id) {
        return `
          <li class="cat-item" data-id="${c.id}">
            <form class="cat-rename">
              <input name="name" value="${escapeHtml(c.name)}" maxlength="40" required autocomplete="off" aria-label="Neuer Name">
              <button class="btn btn-primary btn-small" type="submit">Speichern</button>
              <button class="btn btn-ghost btn-small" type="button" data-action="cancel">Abbrechen</button>
            </form>
          </li>`;
      }
      const count = state.entries.filter((e) => e.categoryId === c.id).length;
      return `
        <li class="cat-item" data-id="${c.id}">
          <span class="cat-name">${escapeHtml(c.name)}</span>
          <span class="cat-count">${plural(count, 'Eintrag', 'Einträge')}</span>
          <button class="icon-btn" type="button" data-action="rename" aria-label="Umbenennen" title="Umbenennen">${ICON_EDIT}</button>
          <button class="icon-btn danger" type="button" data-action="delete" aria-label="Löschen" title="Löschen">${ICON_DELETE}</button>
        </li>`;
    }).join('');
  });

  renderStartBalanceForm();

  // Fokus ins Umbenennen-Feld setzen
  const renameInput = $('.cat-rename input');
  if (renameInput) {
    renameInput.focus();
    renameInput.select();
  }
}

/* ----- Startguthaben ----- */

/** Füllt das Formular mit den gespeicherten Werten (außer der Nutzer tippt gerade darin) */
function renderStartBalanceForm() {
  const form = $('#form-start');
  if (form.contains(document.activeElement)) return;
  const { startBalance, startMonth } = state.settings;
  const now = currentMonth();
  // Auswahl: 36 Monate zurück bis 12 voraus, plus ggf. der gespeicherte Monat
  const months = [];
  for (let i = -36; i <= 12; i++) months.push(addMonths(now, i));
  if (!months.includes(startMonth)) months.push(startMonth);
  months.sort();
  form.elements.startMonth.innerHTML = months
    .map((m) => `<option value="${m}">${formatMonth(m)}</option>`).join('');
  form.elements.startMonth.value = startMonth;
  form.elements.startBalance.value = startBalance ? centsToInput(startBalance) : '';
}

function saveStartBalance(form) {
  const cents = parseSignedAmount(form.elements.startBalance.value);
  if (cents === null) return showToast('Bitte einen gültigen Betrag eingeben, z. B. 1.500,00 oder -200,00.');
  state.settings = { startBalance: cents, startMonth: form.elements.startMonth.value };
  saveState();
  document.activeElement.blur();
  renderAll();
  showToast(`Startguthaben ${formatEuro(cents)} ab ${formatMonth(state.settings.startMonth)} gespeichert`);
}

// ---------- 6. Diagramme (Chart.js) ----------

/** Liest die aktuellen Farben aus den CSS-Variablen (hell oder dunkel) */
function chartColors() {
  const css = getComputedStyle(document.documentElement);
  const get = (name) => css.getPropertyValue(name).trim();
  return {
    text: get('--text-muted'),
    grid: get('--border'),
    surface: get('--surface'),
    income: get('--income'),
    expense: get('--expense'),
  };
}

/** Diagramme entfernen (z. B. beim Farbwechsel, damit sie mit neuen Farben neu entstehen) */
function destroyCharts() {
  Object.keys(ui.charts).forEach((key) => {
    if (ui.charts[key]) ui.charts[key].destroy();
    ui.charts[key] = null;
  });
}

function renderCharts(monthEntries) {
  // Chart.js konnte nicht geladen werden (z. B. offline)
  if (typeof Chart === 'undefined') {
    $('#chart-missing').hidden = false;
    return;
  }

  const colors = chartColors();
  Chart.defaults.font.family = getComputedStyle(document.body).fontFamily;
  Chart.defaults.color = colors.text;

  /* --- Kreisdiagramm: Ausgaben nach Kategorie --- */
  const rows = sumsByCategory(monthEntries, 'expense');
  const hasExpenses = rows.length > 0;
  $('#pie-wrap').hidden = !hasExpenses;
  $('#pie-empty').hidden = hasExpenses;

  const pieData = {
    labels: rows.map((r) => r.name),
    datasets: [{
      data: rows.map((r) => r.sum / 100),
      backgroundColor: rows.map((_, i) => PIE_COLORS[i % PIE_COLORS.length]),
      borderColor: colors.surface,
      borderWidth: 2,
    }],
  };

  if (ui.charts.pie) {
    ui.charts.pie.data = pieData;
    ui.charts.pie.update();
  } else {
    ui.charts.pie = new Chart($('#chart-pie'), {
      type: 'doughnut',
      data: pieData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '58%',
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              label(ctx) {
                const total = ctx.dataset.data.reduce((a, b) => a + b, 0);
                return ` ${ctx.label}: ${euroFormat.format(ctx.parsed)} (${percentFormat.format(ctx.parsed / total)})`;
              },
            },
          },
        },
      },
    });
  }

  /* --- Balkendiagramm: Einnahmen vs. Ausgaben der letzten 6 Monate (bis zum gewählten Monat) --- */
  const months = Array.from({ length: 6 }, (_, i) => addMonths(ui.month, i - 5));
  const barData = {
    labels: months.map(formatMonthShort),
    datasets: [
      {
        label: 'Einnahmen',
        data: months.map((m) => sumOfType(entriesInMonth(m), 'income') / 100),
        backgroundColor: colors.income,
        borderRadius: 4,
      },
      {
        label: 'Ausgaben',
        data: months.map((m) => sumOfType(entriesInMonth(m), 'expense') / 100),
        backgroundColor: colors.expense,
        borderRadius: 4,
      },
    ],
  };

  if (ui.charts.bar) {
    ui.charts.bar.data = barData;
    ui.charts.bar.update();
  } else {
    ui.charts.bar = new Chart($('#chart-bar'), {
      type: 'bar',
      data: barData,
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: { grid: { display: false } },
          y: {
            beginAtZero: true,
            grid: { color: colors.grid },
            border: { display: false },
            ticks: { callback: (value) => euroShortFormat.format(value) },
          },
        },
        plugins: {
          legend: { position: 'bottom', labels: { boxWidth: 12, padding: 12 } },
          tooltip: {
            callbacks: {
              label: (ctx) => ` ${ctx.dataset.label}: ${euroFormat.format(ctx.parsed.y)}`,
            },
          },
        },
      },
    });
  }
}

// ---------- 7. Dialoge ----------

/** Füllt ein Kategorie-Auswahlfeld mit den Kategorien des gewählten Typs */
function fillCategorySelect(select, type, selectedId) {
  const cats = categoriesOfType(type);
  select.innerHTML = cats.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')
    + '<option value="">Ohne Kategorie</option>';
  // null = bewusst "Ohne Kategorie", undefined = erste Kategorie vorauswählen
  if (selectedId === null) select.value = '';
  else select.value = cats.some((c) => c.id === selectedId) ? selectedId : (cats[0] ? cats[0].id : '');
}

function showFormError(form, message) {
  const el = $('.form-error', form);
  el.textContent = message;
  el.hidden = !message;
}

/* ----- Dialog: Eintrag ----- */
function openEntryDialog(id = null) {
  const form = $('#form-entry');
  const entry = id ? state.entries.find((e) => e.id === id) : null;
  ui.editingEntryId = entry ? entry.id : null;

  form.reset();
  showFormError(form, '');
  $('#dlg-entry-title').textContent = entry ? 'Eintrag bearbeiten' : 'Neuer Eintrag';

  const type = entry ? entry.type : 'expense';
  form.elements.type.value = type;
  form.elements.amount.value = entry ? centsToInput(entry.amount) : '';
  form.elements.date.value = entry ? entry.date : todayISO();
  form.elements.note.value = entry ? entry.note || '' : '';
  fillCategorySelect(form.elements.categoryId, type, entry ? entry.categoryId : undefined);

  $('[data-action="delete"]', form).hidden = !entry;

  // Hinweis, wenn der Eintrag automatisch aus einem wiederkehrenden Posten stammt
  const hint = $('#entry-recurring-hint');
  hint.hidden = !(entry && entry.recurringId);
  if (entry && entry.recurringId) {
    hint.textContent = 'Dieser Eintrag wurde automatisch aus einem wiederkehrenden Posten erzeugt. '
      + 'Änderungen gelten nur für diesen einen Eintrag.';
  }

  $('#dlg-entry').showModal();
  if (!entry) form.elements.amount.focus();
}

function saveEntryFromForm() {
  const form = $('#form-entry');
  const f = form.elements;
  const amount = parseAmount(f.amount.value);
  if (amount === null) return showFormError(form, 'Bitte einen gültigen Betrag größer als 0 eingeben, z. B. 12,50.');
  if (!f.date.value) return showFormError(form, 'Bitte ein Datum auswählen.');

  const data = {
    type: f.type.value,
    amount,
    date: f.date.value,
    categoryId: f.categoryId.value || null,
    note: f.note.value.trim(),
  };

  const existing = state.entries.find((e) => e.id === ui.editingEntryId);
  if (existing) {
    Object.assign(existing, data);
  } else {
    state.entries.push({ id: uid(), createdAt: Date.now(), ...data });
  }
  saveState();
  $('#dlg-entry').close();
  renderAll();
  showToast(existing ? 'Eintrag aktualisiert' : 'Eintrag gespeichert');
}

function deleteEntry(id) {
  const entry = state.entries.find((e) => e.id === id);
  if (!entry) return false;
  const label = `${categoryName(entry.categoryId)} vom ${formatDate(entry.date)} über ${formatEuro(entry.amount)}`;
  if (!confirm(`Eintrag „${label}“ wirklich löschen?`)) return false;
  state.entries = state.entries.filter((e) => e.id !== id);
  saveState();
  renderAll();
  showToast('Eintrag gelöscht');
  return true;
}

/* ----- Dialog: wiederkehrender Posten ----- */
function openRecurringDialog(id = null) {
  const form = $('#form-recurring');
  const r = id ? state.recurring.find((x) => x.id === id) : null;
  ui.editingRecurringId = r ? r.id : null;

  form.reset();
  showFormError(form, '');
  $('#dlg-recurring-title').textContent = r ? 'Wiederkehrenden Posten bearbeiten' : 'Neuer wiederkehrender Posten';

  const type = r ? r.type : 'expense';
  form.elements.type.value = type;
  form.elements.name.value = r ? r.name : '';
  form.elements.amount.value = r ? centsToInput(r.amount) : '';
  form.elements.day.value = r ? r.day : Number(todayISO().slice(8, 10));
  fillCategorySelect(form.elements.categoryId, type, r ? r.categoryId : undefined);

  // Startmonat nur beim Anlegen wählbar: 12 Monate zurück bis 12 Monate voraus
  $('#field-start-month').hidden = Boolean(r);
  if (!r) {
    const now = currentMonth();
    const options = [];
    for (let i = -12; i <= 12; i++) {
      const m = addMonths(now, i);
      options.push(`<option value="${m}">${formatMonth(m)}</option>`);
    }
    form.elements.startMonth.innerHTML = options.join('');
    form.elements.startMonth.value = now;
  }

  $('#dlg-recurring').showModal();
  if (!r) form.elements.name.focus();
}

function saveRecurringFromForm() {
  const form = $('#form-recurring');
  const f = form.elements;
  const name = f.name.value.trim();
  const amount = parseAmount(f.amount.value);
  const day = Number(f.day.value);

  if (!name) return showFormError(form, 'Bitte eine Bezeichnung eingeben.');
  if (amount === null) return showFormError(form, 'Bitte einen gültigen Betrag größer als 0 eingeben, z. B. 12,50.');
  if (!Number.isInteger(day) || day < 1 || day > 31) return showFormError(form, 'Der Tag muss zwischen 1 und 31 liegen.');

  const data = { name, type: f.type.value, amount, categoryId: f.categoryId.value || null, day };
  const existing = state.recurring.find((r) => r.id === ui.editingRecurringId);

  if (existing) {
    // Änderungen gelten für künftige Einträge; vorhandene Einträge bleiben unverändert
    Object.assign(existing, data);
  } else {
    const startMonth = f.startMonth.value;
    state.recurring.push({
      id: uid(),
      ...data,
      active: true,
      startMonth,
      lastGenerated: addMonths(startMonth, -1), // "noch nichts eingetragen"
      createdAt: Date.now(),
    });
  }
  saveState();
  const created = applyRecurring();
  $('#dlg-recurring').close();
  renderAll();
  showToast(`Posten gespeichert${created ? ` – ${plural(created, 'Eintrag', 'Einträge')} automatisch hinzugefügt` : ''}`);
}

// ---------- Datensicherung (Export / Import) ----------

function exportData() {
  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `kostentracker-backup-${todayISO()}.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  showToast('Backup-Datei wurde heruntergeladen');
}

function importData(file) {
  const reader = new FileReader();
  reader.onload = () => {
    let imported = null;
    try {
      imported = normalizeState(JSON.parse(reader.result));
    } catch (err) {
      imported = null;
    }
    if (!imported) {
      alert('Die Datei konnte nicht gelesen werden. Ist es eine Backup-Datei des Kosten-Trackers?');
      return;
    }
    const question = `Backup mit ${plural(imported.entries.length, 'Eintrag', 'Einträgen')} importieren?\n\n`
      + 'ACHTUNG: Deine aktuellen Daten in diesem Browser werden dabei ersetzt.';
    if (!confirm(question)) return;
    state = imported;
    saveState();
    applyRecurring();
    renderAll();
    showToast('Daten importiert');
  };
  reader.readAsText(file);
}

// ---------- Hell/Dunkel ----------

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  const dark = theme === 'dark';
  $('#theme-toggle').setAttribute('aria-label', dark ? 'Hellen Modus einschalten' : 'Dunklen Modus einschalten');
  $('meta[name="theme-color"]').setAttribute('content', dark ? '#181b21' : '#ffffff');
}

function toggleTheme() {
  const next = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  applyTheme(next);
  try {
    localStorage.setItem(THEME_KEY, next);
  } catch (err) { /* nicht speicherbar – gilt dann nur bis zum Neuladen */ }
  // Diagramme mit den neuen Farben neu zeichnen
  destroyCharts();
  renderOverview();
}

// ---------- 8. Ereignisse ----------

function bindEvents() {
  // Navigation
  $$('.tab').forEach((tab) => tab.addEventListener('click', () => showView(tab.dataset.view)));
  $('#theme-toggle').addEventListener('click', toggleTheme);

  // Monatsauswahl
  $('#month-prev').addEventListener('click', () => { ui.month = addMonths(ui.month, -1); renderOverview(); });
  $('#month-next').addEventListener('click', () => { ui.month = addMonths(ui.month, 1); renderOverview(); });
  $('#month-today').addEventListener('click', () => { ui.month = currentMonth(); renderOverview(); });

  // Neuer Eintrag
  $('#fab-add').addEventListener('click', () => openEntryDialog());

  // Filter: bei jeder Eingabe sofort neu filtern
  ['#f-text', '#f-type', '#f-category', '#f-from', '#f-to'].forEach((sel) => {
    $(sel).addEventListener('input', renderEntries);
  });
  $('#f-reset').addEventListener('click', () => {
    ['#f-text', '#f-type', '#f-category', '#f-from', '#f-to'].forEach((sel) => { $(sel).value = ''; });
    renderEntries();
  });

  // Klicks in der Eintragsliste (ein Listener für alle Zeilen = "Event Delegation")
  $('#entry-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const row = event.target.closest('.entry');
    if (!row) return;
    if (button && button.dataset.action === 'delete') deleteEntry(row.dataset.id);
    else openEntryDialog(row.dataset.id); // Klick auf Zeile oder Stift = bearbeiten
  });

  // Wiederkehrende Posten
  $('#btn-add-recurring').addEventListener('click', () => openRecurringDialog());
  $('#recurring-list').addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const row = event.target.closest('.entry');
    if (!button || !row) return;
    const id = row.dataset.id;
    if (button.dataset.action === 'toggle') toggleRecurring(id);
    if (button.dataset.action === 'edit') openRecurringDialog(id);
    if (button.dataset.action === 'delete') deleteRecurring(id);
  });

  // Kategorien: hinzufügen
  $$('.cat-add').forEach((form) => {
    form.addEventListener('submit', (event) => {
      event.preventDefault();
      const error = addCategory(form.elements.name.value, form.dataset.type);
      if (error) return showToast(error);
      form.reset();
      renderAll();
      showToast('Kategorie hinzugefügt');
    });
  });

  // Kategorien: umbenennen / löschen
  const catView = $('#view-categories');
  catView.addEventListener('click', (event) => {
    const button = event.target.closest('button[data-action]');
    const item = event.target.closest('.cat-item');
    if (!button || !item) return;
    const action = button.dataset.action;
    if (action === 'rename') { ui.editingCategoryId = item.dataset.id; renderCategories(); }
    if (action === 'cancel') { ui.editingCategoryId = null; renderCategories(); }
    if (action === 'delete') deleteCategory(item.dataset.id);
  });
  catView.addEventListener('submit', (event) => {
    if (!event.target.matches('.cat-rename')) return;
    event.preventDefault();
    const item = event.target.closest('.cat-item');
    const error = renameCategory(item.dataset.id, event.target.elements.name.value);
    if (error) return showToast(error);
    ui.editingCategoryId = null;
    renderAll();
    showToast('Kategorie umbenannt');
  });
  catView.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && ui.editingCategoryId) { ui.editingCategoryId = null; renderCategories(); }
  });

  // Startguthaben
  $('#form-start').addEventListener('submit', (event) => {
    event.preventDefault();
    saveStartBalance(event.target);
  });

  // Datensicherung
  $('#btn-export').addEventListener('click', exportData);
  $('#file-import').addEventListener('change', (event) => {
    const file = event.target.files[0];
    if (file) importData(file);
    event.target.value = ''; // gleiche Datei erneut wählbar machen
  });

  // Dialog Eintrag
  const formEntry = $('#form-entry');
  formEntry.addEventListener('submit', (event) => { event.preventDefault(); saveEntryFromForm(); });
  formEntry.addEventListener('change', (event) => {
    // Typ gewechselt -> passende Kategorien anzeigen
    if (event.target.name === 'type') fillCategorySelect(formEntry.elements.categoryId, event.target.value);
  });
  $('[data-action="cancel"]', formEntry).addEventListener('click', () => $('#dlg-entry').close());
  $('[data-action="delete"]', formEntry).addEventListener('click', () => {
    if (deleteEntry(ui.editingEntryId)) $('#dlg-entry').close();
  });

  // Dialog wiederkehrender Posten
  const formRec = $('#form-recurring');
  formRec.addEventListener('submit', (event) => { event.preventDefault(); saveRecurringFromForm(); });
  formRec.addEventListener('change', (event) => {
    if (event.target.name === 'type') fillCategorySelect(formRec.elements.categoryId, event.target.value);
  });
  $('[data-action="cancel"]', formRec).addEventListener('click', () => $('#dlg-recurring').close());

  // Dialoge schließen, wenn man auf den abgedunkelten Hintergrund klickt
  $$('dialog').forEach((dlg) => {
    dlg.addEventListener('click', (event) => { if (event.target === dlg) dlg.close(); });
  });

  // Wenn die Seite wieder sichtbar wird (z. B. am nächsten Tag), fällige Posten nachtragen
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) return;
    const created = applyRecurring();
    if (created) {
      renderAll();
      showToast(`${plural(created, 'wiederkehrender Eintrag', 'wiederkehrende Einträge')} automatisch hinzugefügt`);
    }
  });
}

// ---------- 9. Start ----------

function init() {
  applyTheme(document.documentElement.dataset.theme || 'light');
  bindEvents();
  const created = applyRecurring();
  renderAll();
  if (created) {
    showToast(`${plural(created, 'wiederkehrender Eintrag', 'wiederkehrende Einträge')} automatisch hinzugefügt`);
  }
}

init();
