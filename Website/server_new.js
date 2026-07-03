import 'dotenv/config';
import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'Database', 'maritime.db'));
const app = express();
const PORT = process.env.PORT || 3000;
const SITE_PASSWORD = process.env.SITE_PASSWORD || '';

if (SITE_PASSWORD) {
  app.use((req, res, next) => {
    const auth = req.headers['authorization'];
    if (auth) {
      const b64 = auth.split(' ')[1] || '';
      const [, pass] = Buffer.from(b64, 'base64').toString().split(':');
      if (pass === SITE_PASSWORD) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="Maritime"');
    res.status(401).send('Unauthorized');
  });
}

app.get('/api/shipments', (req, res) => {
  const rows = db.prepare('SELECT * FROM shipments ORDER BY date_sent DESC').all();
  res.json(rows);
});

app.get('/', (req, res) => res.send(HTML));

app.listen(PORT, () => console.log(`[website] http://localhost:${PORT}`));

const HTML = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>Maritime DB Viewer</title>
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
  header { padding: 20px 32px; border-bottom: 1px solid #1e2533; }
  header h1 { font-size: 26px; font-weight: 600; letter-spacing: .02em; }
  .search-bar { padding: 10px 32px; border-bottom: 1px solid #1e2533; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 24px; }
  .search-field { display: flex; flex-direction: column; gap: 6px; }
  .search-field label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
  .search-field input { background: #1a1f2e; border: 1px solid #2a3044; color: #e2e8f0; border-radius: 8px; padding: 6px 14px; font-size: 14px; width: 100%; outline: none; }
  .search-field input:focus { border-color: #3b82f6; }
  .columns { display: flex; height: calc(100vh - 61px - 250px); }
  .col { flex: 1; display: flex; flex-direction: column; min-width: 0; }
  .col + .col { border-left: 1px solid #1e2533; }
  .col-head { padding: 16px 24px; border-bottom: 1px solid #1e2533; display: flex; align-items: center; justify-content: space-between; }
  .col-head h2 { font-size: 18px; font-weight: 600; text-transform: uppercase; letter-spacing: .05em; }
  .col.vessels .col-head h2 { color: #4ade80; }
  .col.cargos .col-head h2 { color: #60a5fa; }
  .col-count { font-size: 16px; color: #ffffffff; }
  .col-body { overflow-y: auto; overflow-x: hidden; }
  table { width: 100%; table-layout: fixed; border-collapse: collapse; font-size: 12px; }
  th { position: sticky; top: 0; background: #1a1f2e; color: #64748b; font-weight: 500; text-align: left; padding: 8px 8px; border-bottom: 1px solid #2a3044; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; word-break: break-word; }
  .sort-btn { background: none; border: none; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer; padding: 0; width: 100%; text-align: left; }
  .sort-btn:hover { color: #e2e8f0; }
  .sort-arrow { opacity: .6; }
  .sort-btn:hover .sort-arrow { opacity: 1; }
  td { padding: 8px 8px; vertical-align: top; word-break: break-word; overflow-wrap: break-word; }
  tr:hover td { background: #151a27; }
  .row-sep td { border-bottom: 1px solid #1a1f2e; }
  th:nth-child(1), td:nth-child(1) { width: 22%; padding-left: 20px; }
  th:nth-child(2), td:nth-child(2) { width: 13%; }
  th:nth-child(3), td:nth-child(3) { width: 11%; }
  th:nth-child(4), td:nth-child(4) { width: 8%; }
  th:nth-child(5), td:nth-child(5) { width: 8%; }
  th:nth-child(6), td:nth-child(6) { width: 11%; }
  th:nth-child(7), td:nth-child(7) { width: 18%; }
  th:nth-child(8), td:nth-child(8) { width: 9%; }
  .stack { display: flex; flex-direction: column; gap: 3px; }
  .stack .sub { font-size: 10px; color: #64748b; }
  .stack .country { font-size: 12px; color: #94a3b8; }
  .null { color: #334155; font-style: italic; }
  .empty { text-align: center; padding: 60px; color: #334155; }
  .toggle-row { cursor: pointer; }
  .toggle-row td { padding: 0px 4px 4px 20px; text-align: left; color: #64748b; }
  .toggle-row:hover td { background: #151a27; color: #e2e8f0; }
  .toggle-row .arrow { display: inline-block; transform: scaleX(1.6); font-size: 10px; }
  .body-row td { background: #10141d; }
  .body-row pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12px; color: #94a3b8; max-height: 320px; overflow-y: auto; user-select: text; }
</style>
</head>
<body>
<header>
  <h1>Maritime DB Viewer</h1>
</header>
<div class="search-bar">
  <div class="search-field"><label>Ship Name</label><input id="f-ship" placeholder="e.g. Ocean Star, Pan Amber" oninput="renderAll()"></div>
  <div class="search-field"><label>Load Port</label><input id="f-loadport" placeholder="e.g. Kakinada, Oran" oninput="renderAll()"></div>
  <div class="search-field"><label>Load Country</label><input id="f-loadcountry" placeholder="e.g. China, Korea" oninput="renderAll()"></div>
  <div class="search-field"><label>Discharge Port</label><input id="f-dischargeport" placeholder="e.g. Singapore, Houston" oninput="renderAll()"></div>
  <div class="search-field"><label>Discharge Country</label><input id="f-dischargecountry" placeholder="e.g. Brazil, India" oninput="renderAll()"></div>
  <div class="search-field"><label>Tonnage (MT)</label><input id="f-tonnage" placeholder="e.g. 50000, 70000" oninput="renderAll()"></div>
  <div class="search-field"><label>Laycan Date</label><input id="f-laycandate" type="date" oninput="renderAll()"></div>
  <div class="search-field"><label>Company</label><input id="f-company" placeholder="e.g. @ex1.com, @ex2.org" oninput="renderAll()"></div>
</div>
<div class="columns">
  <div class="col vessels">
    <div class="col-head"><h2>Vessels</h2><span class="col-count" id="vessels-count"></span></div>
    <div class="col-body"><table><thead><tr id="vessels-head"></tr></thead><tbody id="vessels-body"></tbody></table><div class="empty" id="vessels-empty" style="display:none">No entries.</div></div>
  </div>
  <div class="col cargos">
    <div class="col-head"><h2>Cargos</h2><span class="col-count" id="cargos-count"></span></div>
    <div class="col-body"><table><thead><tr id="cargos-head"></tr></thead><tbody id="cargos-body"></tbody></table><div class="empty" id="cargos-empty" style="display:none">No entries.</div></div>
  </div>
</div>
<script>
  function n(v) {
    if (v == null || v === '') return '<span class="null">—</span>';
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function fmt(v) {
    return v == null ? '<span class="null">—</span>' : v.toLocaleString();
  }

  function stack(top, bottom) {
    return \`<div class="stack"><div>\${top}</div><div class="sub">\${bottom}</div></div>\`;
  }

  function portStack(port, country) {
    return \`<div class="stack"><div>\${port}</div><div class="country">\${country}</div></div>\`;
  }

  function laycanCell(r) {
    return \`<div class="stack"><div>\${n(r.laycanStart)} to</div><div>\${n(r.laycanEnd)}</div><div class="sub">\${n(r.laycan)}</div></div>\`;
  }

  function sentSplit(v) {
    if (!v) return ['<span class="null">—</span>', ''];
    const [datePart, timePartRaw] = v.split('T');
    const time = timePartRaw ? timePartRaw.slice(0, 8) + ' UTC' : '';
    return [n(time), n(datePart)];
  }

  const HEADERS = [
    'Ship / Subject', 'Load Port / Country', 'Discharge Port / Country',
    'Tonnage Min', 'Tonnage Max', 'Laycan', 'Company', 'Sent (Time / Date)',
  ];

  const SORT_KEYS = { 3: 'tonnage_min', 4: 'tonnage_max', 5: 'laycan', 7: 'date_sent' };
  const sortState = { key: null, dir: 'asc' };

  function setSort(key) {
    if (sortState.key === key) {
      sortState.dir = sortState.dir === 'asc' ? 'desc' : 'asc';
    } else {
      sortState.key = key;
      sortState.dir = 'asc';
    }
    renderAll();
  }

  function sortRows(rows) {
    if (!sortState.key) return rows;
    const field = sortState.key === 'laycan' ? 'laycanStart' : sortState.key;
    const dir = sortState.dir;
    return [...rows].sort((a, b) => {
      const av = a[field], bv = b[field];
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (av < bv) return dir === 'asc' ? -1 : 1;
      if (av > bv) return dir === 'asc' ? 1 : -1;
      return 0;
    });
  }

  function headerCell(label, idx) {
    const key = SORT_KEYS[idx];
    if (!key) return \`<th>\${label}</th>\`;
    const active = sortState.key === key;
    const arrow = active ? (sortState.dir === 'asc' ? '▲' : '▼') : '↕';
    return \`<th><button class="sort-btn" onclick="setSort('\${key}')">\${label} <span class="sort-arrow">\${arrow}</span></button></th>\`;
  }

  const expanded = new Set();

  function toggleBody(id) {
    if (expanded.has(id)) expanded.delete(id); else expanded.add(id);
    renderAll();
  }

  function rowHtml(r) {
    const isOpen = expanded.has(r.id);
    const [sentTime, sentDate] = sentSplit(r.date_sent);
    const cells = [
      stack(n(r.item), n(r.subject)),
      portStack(n(r.load_port), n(r.load_country)),
      portStack(n(r.discharge_port), n(r.discharge_country)),
      fmt(r.tonnage_min),
      fmt(r.tonnage_max),
      laycanCell(r),
      n(r.company),
      stack(sentTime, sentDate),
    ].map(html => \`<td>\${html}</td>\`).join('');
    const toggleRowClass = isOpen ? 'toggle-row' : 'toggle-row row-sep';
    const toggleRow = \`<tr class="\${toggleRowClass}" onclick="toggleBody(\${r.id})"><td colspan="\${HEADERS.length}"><span class="arrow">\${isOpen ? '▲' : '▼'}</span></td></tr>\`;
    const bodyRow = isOpen
      ? \`<tr class="body-row row-sep"><td colspan="\${HEADERS.length}"><pre>\${n(r.body) || '<span class="null">No body text.</span>'}</pre></td></tr>\`
      : '';
    return \`<tr>\${cells}</tr>\${toggleRow}\${bodyRow}\`;
  }

  function renderCol(id, rows) {
    document.getElementById(id + '-head').innerHTML = HEADERS.map(headerCell).join('');
    const sorted = sortRows(rows);
    document.getElementById(id + '-count').textContent = sorted.length;
    document.getElementById(id + '-body').innerHTML = sorted.map(rowHtml).join('');
    document.getElementById(id + '-empty').style.display = sorted.length ? 'none' : '';
  }

  function fieldVal(id) {
    return document.getElementById(id).value;
  }

  function terms(input) {
    return input.split(',').map(t => t.trim().toLowerCase()).filter(Boolean);
  }

  function matchesAny(value, input) {
    const ts = terms(input);
    if (!ts.length) return true;
    const v = (value || '').toLowerCase();
    return ts.some(t => v.includes(t));
  }

  function matchesTonnage(r, input) {
    const ts = terms(input).map(Number).filter(v => !isNaN(v));
    if (!ts.length) return true;
    if (r.tonnage_min == null || r.tonnage_max == null) return false;
    return ts.some(v => v >= r.tonnage_min && v <= r.tonnage_max);
  }

  function matchesLaycanDate(r, dateVal) {
    if (!dateVal) return true;
    if (!r.laycanStart || !r.laycanEnd) return false;
    return dateVal >= r.laycanStart && dateVal <= r.laycanEnd;
  }

  function matchesFilters(r) {
    return matchesAny(r.item, fieldVal('f-ship'))
      && matchesAny(r.load_port, fieldVal('f-loadport'))
      && matchesAny(r.load_country, fieldVal('f-loadcountry'))
      && matchesAny(r.discharge_port, fieldVal('f-dischargeport'))
      && matchesAny(r.discharge_country, fieldVal('f-dischargecountry'))
      && matchesTonnage(r, fieldVal('f-tonnage'))
      && matchesLaycanDate(r, fieldVal('f-laycandate'))
      && matchesAny(r.company, fieldVal('f-company'));
  }

  let allRows = [];
  function renderAll() {
    const filtered = allRows.filter(matchesFilters);
    renderCol('vessels', filtered.filter(r => r.type === 'vessel'));
    renderCol('cargos', filtered.filter(r => r.type === 'cargo'));
  }

  async function load() {
    allRows = await fetch('/api/shipments').then(r => r.json());
    renderAll();
  }

  load();
</script>
</body>
</html>`;
