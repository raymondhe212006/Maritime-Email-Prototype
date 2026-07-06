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

app.get('/api/matches', (req, res) => {
  const rows = db.prepare(`
    SELECT
      m.id as match_id, m.leniency, m.human_review, m.whitelist_entry,
      m.vessel_uid, m.vessel_subid, m.cargo_uid, m.cargo_subid,
      v.item as vessel_item, v.subject as vessel_subject, v.body as vessel_body,
      v.load_port as vessel_load_port, v.load_country as vessel_load_country,
      v.discharge_port as vessel_discharge_port, v.discharge_country as vessel_discharge_country,
      v.size_class as vessel_size_class, v.tonnage_min as vessel_tonnage_min, v.tonnage_max as vessel_tonnage_max,
      v.laycan as vessel_laycan, v.laycanStart as vessel_laycanStart, v.laycanEnd as vessel_laycanEnd,
      v.company as vessel_company, v.date_sent as vessel_date_sent,
      c.item as cargo_item, c.subject as cargo_subject, c.body as cargo_body,
      c.load_port as cargo_load_port, c.load_country as cargo_load_country,
      c.discharge_port as cargo_discharge_port, c.discharge_country as cargo_discharge_country,
      c.size_class as cargo_size_class, c.tonnage_min as cargo_tonnage_min, c.tonnage_max as cargo_tonnage_max,
      c.laycan as cargo_laycan, c.laycanStart as cargo_laycanStart, c.laycanEnd as cargo_laycanEnd,
      c.company as cargo_company, c.date_sent as cargo_date_sent
    FROM matches m
    JOIN shipments v ON v.message_id = m.vessel_uid AND v.sub_id = m.vessel_subid
    JOIN shipments c ON c.message_id = m.cargo_uid AND c.sub_id = m.cargo_subid
    ORDER BY m.human_review ASC, m.leniency ASC, m.id DESC
  `).all();
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
  * { box-sizing: border-box; margin: 0; padding: 0; scrollbar-color: #2a3044 #10141d; scrollbar-width: thin; }
  *::-webkit-scrollbar { width: 10px; height: 10px; }
  *::-webkit-scrollbar-track { background: #10141d; }
  *::-webkit-scrollbar-thumb { background: #2a3044; border-radius: 8px; border: 2px solid #10141d; }
  *::-webkit-scrollbar-thumb:hover { background: #3b82f6; }
  body { font-family: system-ui, sans-serif; background: #0f1117; color: #e2e8f0; min-height: 100vh; }
  header { padding: 20px 32px; border-bottom: 1px solid #1e2533; }
  header h1 { font-size: 22px; font-weight: 600; letter-spacing: .02em; }
  .search-bar { padding: 10px 32px; border-bottom: 1px solid #1e2533; display: grid; grid-template-columns: repeat(3, 1fr); gap: 4px 24px; }
  .search-field { display: flex; flex-direction: column; gap: 6px; }
  .search-field label { font-size: 12px; color: #64748b; text-transform: uppercase; letter-spacing: .05em; }
  .search-field input, .search-field select { background: #1a1f2e; border: 1px solid #2a3044; color: #e2e8f0; border-radius: 8px; padding: 6px 14px; font-size: 14px; width: 100%; outline: none; }
  .search-field input:focus, .search-field select:focus { border-color: #3b82f6; }
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
  th { position: sticky; top: 0; z-index: 2; background: #1a1f2e; color: #64748b; font-weight: 500; text-align: left; padding: 8px 8px; border-bottom: 1px solid #2a3044; text-transform: uppercase; font-size: 10px; letter-spacing: .04em; word-break: break-word; }
  .sort-btn { background: none; border: none; color: inherit; font: inherit; text-transform: inherit; letter-spacing: inherit; cursor: pointer; padding: 0; width: 100%; text-align: left; }
  .sort-btn:hover { color: #e2e8f0; }
  .sort-arrow { opacity: .6; }
  .sort-btn:hover .sort-arrow { opacity: 1; }
  td { padding: 8px 8px; vertical-align: top; word-break: break-word; overflow-wrap: break-word; }
  tr:hover td { background: #151a27; }
  .row-sep td { border-bottom: 1px solid #1a1f2e; }
  th:nth-child(1), td:nth-child(1) { width: 20%; padding-left: 20px; }
  th:nth-child(2), td:nth-child(2) { width: 13%; }
  th:nth-child(3), td:nth-child(3) { width: 11%; }
  th:nth-child(4), td:nth-child(4) { width: 10%; }
  th:nth-child(5), td:nth-child(5) { width: 9%; }
  th:nth-child(6), td:nth-child(6) { width: 11%; }
  th:nth-child(7), td:nth-child(7) { width: 17%; }
  th:nth-child(8), td:nth-child(8) { width: 9%; }
  .stack { display: flex; flex-direction: column; gap: 3px; }
  .stack .sub { font-size: 10px; color: #64748b; }
  .stack .country { font-size: 12px; color: #94a3b8; }
  .tonnage-cell { align-items: flex-start; gap: 1px; }
  .tonnage-cell .range-symbol { color: #64748b; font-size: 10px; line-height: 1.4; }
  .tonnage-head { align-items: flex-start; gap: 1px; }
  .tonnage-head .sort-btn { text-transform: inherit; }
  .tonnage-head .range-symbol { color: #64748b; font-size: 10px; line-height: 1.4; }
  .null { color: #334155; font-style: italic; }
  .empty { text-align: center; padding: 60px; color: #334155; }
  .toggle-row { cursor: pointer; }
  .toggle-row td { padding: 0px 4px 4px 20px; text-align: left; color: #64748b; }
  .toggle-row:hover td { background: #151a27; color: #e2e8f0; }
  .toggle-row .arrow { display: inline-block; transform: scaleX(1.6); font-size: 10px; }
  .body-row td { background: #10141d; }
  .body-row pre { white-space: pre-wrap; word-break: break-word; font-family: inherit; font-size: 12px; color: #94a3b8; max-height: 320px; overflow-y: auto; user-select: text; }
  .tab-bar { display: flex; gap: 24px; padding: 0 32px; border-bottom: 1px solid #1e2533; }
  .tab-btn { background: none; border: none; color: #64748b; font: inherit; font-weight: 600; font-size: 13px; text-transform: uppercase; letter-spacing: .04em; padding: 14px 2px; cursor: pointer; border-bottom: 2px solid transparent; }
  .tab-btn:hover { color: #e2e8f0; }
  .tab-btn.active { color: #e2e8f0; border-bottom-color: #3b82f6; }
  .role-tag { display: inline-block; font-size: 9px; font-weight: 700; letter-spacing: .04em; padding: 1px 5px; border-radius: 4px; margin-right: 4px; vertical-align: middle; }
  .role-tag.role-vessel { background: rgba(74, 222, 128, .15); color: #4ade80; }
  .role-tag.role-cargo { background: rgba(96, 165, 250, .15); color: #60a5fa; }
  .leniency-0 td:first-child { border-left: 4px solid #4ade80; }
  .leniency-1 td:first-child { border-left: 4px solid #eab308; }
  .needs-review td:first-child { border-left: 4px solid #ef4444; }
  .matches-columns { height: calc(100vh - 61px - 50px - 90px); }
  .match-main-row { cursor: pointer; }
  .match-count { font-size: 10px; color: #64748b; margin-left: 4px; }
  .match-candidate-row td:first-child { padding-left: 40px; }
  .match-group-end td { border-bottom: 6px solid #05070b; }
</style>
</head>
<body>
<header>
  <h1>Maritime DB Viewer</h1>
</header>
<div class="tab-bar">
  <button class="tab-btn active" id="tab-shipments" onclick="switchTab('shipments')">Shipments</button>
  <button class="tab-btn" id="tab-matches" onclick="switchTab('matches')">Matches</button>
</div>
<div id="shipments-view">
<div class="search-bar">
  <div class="search-field"><label>Ship Name</label><input id="f-ship" placeholder="e.g. Ocean Star, Pan Amber" oninput="renderAll()"></div>
  <div class="search-field"><label>Load Port</label><input id="f-loadport" placeholder="e.g. Kakinada, Oran" oninput="renderAll()"></div>
  <div class="search-field"><label>Load Country</label><input id="f-loadcountry" placeholder="e.g. China, Korea" oninput="renderAll()"></div>
  <div class="search-field"><label>Discharge Port</label><input id="f-dischargeport" placeholder="e.g. Singapore, Houston" oninput="renderAll()"></div>
  <div class="search-field"><label>Discharge Country</label><input id="f-dischargecountry" placeholder="e.g. Brazil, India" oninput="renderAll()"></div>
  <div class="search-field"><label>Tonnage (MT)</label><input id="f-tonnage" placeholder="e.g. 50000, 70000" oninput="renderAll()"></div>
  <div class="search-field"><label>Laycan Date</label><input id="f-laycandate" type="date" oninput="renderAll()"></div>
  <div class="search-field"><label>Company</label><input id="f-company" placeholder="e.g. @exampleemail1.com, @exampleemail2.org" oninput="renderAll()"></div>
  <div class="search-field"><label>Keyword</label><input id="f-keyword" placeholder="e.g. iron ore , coal + aus → ore OR (coal AND aus)" oninput="renderAll()"></div>
  <div class="search-field"><label>Subject</label><input id="f-subject" placeholder="e.g. HMX - SMX, laycan" oninput="renderAll()"></div>
  <div class="search-field"><label>Sent Date</label><input id="f-sentdate" type="date" oninput="renderAll()"></div>
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
</div>
<div id="matches-view" style="display:none">
  <div class="search-bar">
    <div class="search-field">
      <label>Match Status</label>
      <select id="f-match-category" onchange="renderMatches()">
        <option value="">All</option>
        <option value="0">0 - Matched</option>
        <option value="1">1 - Check Loading Country</option>
        <option value="2">2 - Check Tonnage/Loading Country</option>
      </select>
    </div>
  </div>
  <div class="columns matches-columns">
    <div class="col">
      <div class="col-head"><h2>Matches</h2><span class="col-count" id="matches-count"></span></div>
      <div class="col-body"><table><thead><tr id="matches-head"></tr></thead><tbody id="matches-body"></tbody></table><div class="empty" id="matches-empty" style="display:none">No matches.</div></div>
    </div>
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

  function sizeClassText(v) {
    return v == null ? v : String(v).split('/').join(' / ');
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

  function tonnageCell(r) {
    return \`<div class="stack tonnage-cell"><div>\${fmt(r.tonnage_min)}</div><div class="range-symbol">to</div><div>\${fmt(r.tonnage_max)}</div></div>\`;
  }

  function sentSplit(v) {
    if (!v) return ['<span class="null">—</span>', ''];
    const [datePart, timePartRaw] = v.split('T');
    const time = timePartRaw ? timePartRaw.slice(0, 8) + ' UTC' : '';
    return [n(time), n(datePart)];
  }

  const HEADERS = [
    'Ship / Subject', 'Load Port / Country', 'Discharge Port / Country',
    'Size Class', 'Tonnage (MT)', 'Laycan', 'Company', 'Sent (Time / Date)',
  ];

  const SORT_KEYS = { 5: 'laycan', 7: 'date_sent' };
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

  function sortButton(key, label) {
    const active = sortState.key === key;
    const arrow = active ? (sortState.dir === 'asc' ? '▲' : '▼') : '↕';
    return \`<button class="sort-btn" onclick="setSort('\${key}')">\${label} <span class="sort-arrow">\${arrow}</span></button>\`;
  }

  function tonnageHeaderCell() {
    return \`<th><div class="stack tonnage-head">
      <div>\${sortButton('tonnage_min', 'Min')}</div>
      <div class="range-symbol">to</div>
      <div>\${sortButton('tonnage_max', 'Max')}</div>
    </div></th>\`;
  }

  function headerCell(label, idx) {
    if (idx === 4) return tonnageHeaderCell();
    const key = SORT_KEYS[idx];
    if (!key) return \`<th>\${label}</th>\`;
    return \`<th>\${sortButton(key, label)}</th>\`;
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
      n(sizeClassText(r.size_class)),
      tonnageCell(r),
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

  function matchesSubject(value, input) {
    const trimmed = (input || '').trim().toLowerCase();
    if (!trimmed) return true;
    return (value || '').toLowerCase().includes(trimmed);
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

  function matchesSentDate(r, dateVal) {
    if (!dateVal) return true;
    if (!r.date_sent) return false;
    return r.date_sent.slice(0, 10) === dateVal;
  }

  function matchesKeyword(r, input) {
    const trimmed = (input || '').trim().toLowerCase();
    if (!trimmed) return true;
    const haystack = ((r.subject || '') + ' ' + (r.body || '')).toLowerCase();
    const orGroups = trimmed.split(',').map(g => g.trim()).filter(Boolean);
    if (!orGroups.length) return true;
    return orGroups.some(group => {
      const andTerms = group.split('+').map(t => t.trim()).filter(Boolean);
      if (!andTerms.length) return true;
      return andTerms.every(t => haystack.includes(t));
    });
  }

  function matchesFilters(r) {
    return matchesAny(r.item, fieldVal('f-ship'))
      && matchesAny(r.load_port, fieldVal('f-loadport'))
      && matchesAny(r.load_country, fieldVal('f-loadcountry'))
      && matchesAny(r.discharge_port, fieldVal('f-dischargeport'))
      && matchesAny(r.discharge_country, fieldVal('f-dischargecountry'))
      && matchesTonnage(r, fieldVal('f-tonnage'))
      && matchesLaycanDate(r, fieldVal('f-laycandate'))
      && matchesAny(r.company, fieldVal('f-company'))
      && matchesKeyword(r, fieldVal('f-keyword'))
      && matchesSubject(r.subject, fieldVal('f-subject'))
      && matchesSentDate(r, fieldVal('f-sentdate'));
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

  function matchCategory(m) {
    if (m.human_review) return 2;
    return m.leniency === 0 ? 0 : 1;
  }

  const MATCH_CATEGORY_CLASS = { 0: 'leniency-0', 1: 'leniency-1', 2: 'needs-review' };

  function mainPrefix(m) { return m.whitelist_entry === 0 ? 'vessel' : 'cargo'; }
  function otherPrefix(m) { return m.whitelist_entry === 0 ? 'cargo' : 'vessel'; }
  function mainRole(m) { return m.whitelist_entry === 0 ? 'VESSEL' : 'CARGO'; }
  function otherRole(m) { return m.whitelist_entry === 0 ? 'CARGO' : 'VESSEL'; }

  function entryFields(m, prefix) {
    return {
      item: m[prefix + '_item'],
      subject: m[prefix + '_subject'],
      load_port: m[prefix + '_load_port'],
      load_country: m[prefix + '_load_country'],
      discharge_port: m[prefix + '_discharge_port'],
      discharge_country: m[prefix + '_discharge_country'],
      size_class: m[prefix + '_size_class'],
      tonnage_min: m[prefix + '_tonnage_min'],
      tonnage_max: m[prefix + '_tonnage_max'],
      laycan: m[prefix + '_laycan'],
      laycanStart: m[prefix + '_laycanStart'],
      laycanEnd: m[prefix + '_laycanEnd'],
      company: m[prefix + '_company'],
      date_sent: m[prefix + '_date_sent'],
    };
  }

  function entryCells(e, roleHtml) {
    const [sentTime, sentDate] = sentSplit(e.date_sent);
    return [
      stack(\`\${roleHtml} \${n(e.item)}\`, n(e.subject)),
      portStack(n(e.load_port), n(e.load_country)),
      portStack(n(e.discharge_port), n(e.discharge_country)),
      n(sizeClassText(e.size_class)),
      tonnageCell(e),
      laycanCell(e),
      n(e.company),
      stack(sentTime, sentDate),
    ].map(html => \`<td>\${html}</td>\`).join('');
  }

  function groupKey(m) {
    return m.whitelist_entry === 0
      ? \`v:\${m.vessel_uid}:\${m.vessel_subid}\`
      : \`c:\${m.cargo_uid}:\${m.cargo_subid}\`;
  }

  function groupMatches(rows) {
    const map = new Map();
    for (const m of rows) {
      const key = groupKey(m);
      if (!map.has(key)) {
        map.set(key, { main: entryFields(m, mainPrefix(m)), mainRole: mainRole(m), candidates: [] });
      }
      map.get(key).candidates.push(m);
    }
    return map;
  }

  const expandedGroups = new Set();

  function toggleMatchGroup(key) {
    if (expandedGroups.has(key)) expandedGroups.delete(key); else expandedGroups.add(key);
    renderMatches();
  }

  function matchGroupHtml(key, group) {
    const isOpen = expandedGroups.has(key);
    const arrow = \`<span class="row-arrow">\${isOpen ? '▲' : '▼'}</span>\`;
    const roleTag = \`<span class="role-tag role-\${group.mainRole.toLowerCase()}">\${group.mainRole}</span>\`;
    const count = group.candidates.length;
    const countBadge = \`<span class="match-count">\${count} match\${count === 1 ? '' : 'es'}</span>\`;
    const mainRowClass = isOpen && count > 0 ? 'data-row match-main-row' : 'data-row match-main-row match-group-end';
    const mainRow = \`<tr class="\${mainRowClass}" data-key="\${n(key)}" onclick="toggleMatchGroup(this.dataset.key)">\${entryCells(group.main, \`\${arrow} \${roleTag} \${countBadge}\`)}</tr>\`;

    let candidateRows = '';
    if (isOpen) {
      candidateRows = group.candidates.map((m, idx) => {
        const catClass = MATCH_CATEGORY_CLASS[matchCategory(m)];
        const isLast = idx === group.candidates.length - 1;
        const rowClass = \`\${catClass} match-candidate-row\${isLast ? ' match-group-end' : ''}\`;
        const otherRoleTag = \`<span class="role-tag role-\${otherRole(m).toLowerCase()}">\${otherRole(m)}</span>\`;
        return \`<tr class="\${rowClass}">\${entryCells(entryFields(m, otherPrefix(m)), otherRoleTag)}</tr>\`;
      }).join('');
    }
    return mainRow + candidateRows;
  }

  let allMatches = [];
  let matchesLoaded = false;

  function renderMatches() {
    const categoryFilter = document.getElementById('f-match-category').value;
    const filteredRows = categoryFilter === ''
      ? allMatches
      : allMatches.filter(m => matchCategory(m) === Number(categoryFilter));
    const groups = groupMatches(filteredRows);
    document.getElementById('matches-head').innerHTML = HEADERS.map(h => \`<th>\${h}</th>\`).join('');
    document.getElementById('matches-count').textContent = groups.size;
    document.getElementById('matches-body').innerHTML = [...groups.entries()].map(([key, group]) => matchGroupHtml(key, group)).join('');
    document.getElementById('matches-empty').style.display = groups.size ? 'none' : '';
  }

  async function loadMatches() {
    allMatches = await fetch('/api/matches').then(r => r.json());
    renderMatches();
  }

  function switchTab(tab) {
    document.getElementById('shipments-view').style.display = tab === 'shipments' ? '' : 'none';
    document.getElementById('matches-view').style.display = tab === 'matches' ? '' : 'none';
    document.getElementById('tab-shipments').classList.toggle('active', tab === 'shipments');
    document.getElementById('tab-matches').classList.toggle('active', tab === 'matches');
    if (tab === 'matches' && !matchesLoaded) {
      matchesLoaded = true;
      loadMatches();
    }
  }

  load();
</script>
</body>
</html>`;
