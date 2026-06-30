import 'dotenv/config';
import express from 'express';
import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const db = new Database(path.join(__dirname, '..', 'Database', 'maritime.db'));
const app = express();
const PORT = process.env.PORT || 3000;
const PURGE_SECRET = process.env.PURGE_SECRET || '';
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

app.get('/api/stats', (req, res) => {
    const total = db.prepare('SELECT COUNT(*) as n FROM shipments').get().n;
    const cargo = db.prepare("SELECT COUNT(*) as n FROM shipments WHERE type='cargo'").get().n;
    const shipping = db.prepare("SELECT COUNT(*) as n FROM shipments WHERE type='shipping'").get().n;
    const stale = db.prepare("SELECT COUNT(*) as n FROM shipments WHERE date_sent < datetime('now', '-14 days')").get().n;
    res.json({ total, cargo, shipping, stale });
});

app.post('/api/purge', (req, res) => {
    if (PURGE_SECRET && req.headers['x-purge-secret'] !== PURGE_SECRET) {
        return res.status(401).json({ error: 'Unauthorized' });
    }
    const result = db.prepare("DELETE FROM shipments WHERE date_sent < datetime('now', '-14 days')").run();
    res.json({ deleted: result.changes });
});

app.post('/api/correct-tonnage', (req, res) => {
    const result = db.prepare(`
        UPDATE shipments
        SET tonnage_min = ROUND(tonnage_min * 0.95), tonnage_max = ROUND(tonnage_max * 1.05)
        WHERE tonnage_min IS NOT NULL AND tonnage_max IS NOT NULL AND tonnage_min = tonnage_max
    `).run();
    res.json({ corrected: result.changes });
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
  header { padding: 20px 32px; border-bottom: 1px solid #1e2533; display: flex; align-items: center; justify-content: space-between; }
  header h1 { font-size: 18px; font-weight: 600; letter-spacing: .02em; }
  .stats { display: flex; gap: 16px; padding: 20px 32px; border-bottom: 1px solid #1e2533; }
  .stat { background: #1a1f2e; border: 1px solid #2a3044; border-radius: 8px; padding: 12px 20px; min-width: 110px; }
  .stat .val { font-size: 26px; font-weight: 700; line-height: 1; }
  .stat .lbl { font-size: 11px; color: #64748b; margin-top: 4px; text-transform: uppercase; letter-spacing: .06em; }
  .stat.stale .val { color: #f87171; }
  .toolbar { padding: 16px 32px; display: flex; align-items: center; gap: 12px; flex-wrap: wrap; }
  .toolbar input { background: #1a1f2e; border: 1px solid #2a3044; color: #e2e8f0; border-radius: 6px; padding: 8px 12px; font-size: 13px; width: 260px; outline: none; }
  .toolbar input:focus { border-color: #3b82f6; }
  .toolbar select { background: #1a1f2e; border: 1px solid #2a3044; color: #e2e8f0; border-radius: 6px; padding: 8px 12px; font-size: 13px; outline: none; cursor: pointer; }
  .spacer { flex: 1; }
  button { border: none; border-radius: 6px; padding: 8px 16px; font-size: 13px; font-weight: 500; cursor: pointer; transition: opacity .15s; }
  button:hover { opacity: .85; }
  #purgeBtn { background: #dc2626; color: #fff; }
  #purgeBtn:disabled { background: #4b1515; color: #888; cursor: not-allowed; opacity: 1; }
  .wrap { padding: 0 32px 32px; overflow-x: auto; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: #1a1f2e; color: #64748b; font-weight: 500; text-align: left; padding: 10px 12px; white-space: nowrap; border-bottom: 1px solid #2a3044; position: sticky; top: 0; text-transform: uppercase; font-size: 11px; letter-spacing: .05em; }
  td { padding: 10px 12px; border-bottom: 1px solid #1a1f2e; vertical-align: top; max-width: 280px; word-break: break-word; }
  tr:hover td { background: #151a27; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; text-transform: uppercase; letter-spacing: .04em; }
  .badge-cargo    { background: #1e3a5f; color: #60a5fa; }
  .badge-shipping { background: #14432a; color: #4ade80; }
  .badge-unknown  { background: #2a2a2a; color: #94a3b8; }
  .null { color: #334155; font-style: italic; }
  .tonnage { white-space: nowrap; }
  #count { font-size: 13px; color: #64748b; }
  .empty { text-align: center; padding: 60px; color: #334155; }
</style>
</head>
<body>
<header>
  <h1>Maritime DB Viewer</h1>
  <span id="count"></span>
</header>
<div class="stats">
  <div class="stat"><div class="val" id="s-total">—</div><div class="lbl">Total</div></div>
  <div class="stat"><div class="val" id="s-cargo" style="color:#60a5fa">—</div><div class="lbl">Cargo</div></div>
  <div class="stat"><div class="val" id="s-shipping" style="color:#4ade80">—</div><div class="lbl">Shipping</div></div>
  <div class="stat stale"><div class="val" id="s-stale">—</div><div class="lbl">Stale (&gt;14d)</div></div>
</div>
<div class="toolbar">
  <input id="loadPortFilter" placeholder="Load port…" oninput="render()">
  <input id="loadCountryFilter" placeholder="Load country…" oninput="render()">
  <input id="dischargePortFilter" placeholder="Discharge port…" oninput="render()">
  <input id="dischargeCountryFilter" placeholder="Discharge country…" oninput="render()">
  <input id="companyFilter" placeholder="Company…" oninput="render()">
  <input id="loadFilter" type="text" placeholder="Tonnage…" style="width:160px" oninput="render()">
  <input id="dateFilter" type="date" oninput="render()" title="Laycan date">
  <input id="sentDateFilter" type="date" oninput="render()" title="Sent on or after">
  <select id="typeFilter" onchange="render()">
    <option value="">All types</option>
    <option value="cargo">Cargo</option>
    <option value="shipping">Shipping</option>
    <option value="unknown">Unknown</option>
  </select>
  <div class="spacer"></div>
  <button id="correctBtn" onclick="correctTonnage()">Correct equal tonnage ranges</button>
  <button id="purgeBtn" onclick="purge()">Purge stale entries</button>
</div>
<div class="wrap">
  <table>
    <thead>
      <tr>
        <th>Type</th>
        <th>Subject</th>
        <th>Load Port</th>
        <th>Load Country</th>
        <th>Discharge Port</th>
        <th>Discharge Country</th>
        <th>Min (MT)</th>
        <th>Max (MT)</th>
        <th>Cargo</th>
        <th>Laycan</th>
        <th>Laycan Start</th>
        <th>Laycan End</th>
        <th>Company</th>
        <th>Date Sent</th>
      </tr>
    </thead>
    <tbody id="tbody"></tbody>
  </table>
  <div id="empty" class="empty" style="display:none">No entries found.</div>
</div>
<script>
  const PURGE_SECRET = ${JSON.stringify(PURGE_SECRET)};
  let rows = [];

  async function load() {
    const [data, stats] = await Promise.all([
      fetch('/api/shipments').then(r => r.json()),
      fetch('/api/stats').then(r => r.json()),
    ]);
    rows = data;
    document.getElementById('s-total').textContent = stats.total;
    document.getElementById('s-cargo').textContent = stats.cargo;
    document.getElementById('s-shipping').textContent = stats.shipping;
    document.getElementById('s-stale').textContent = stats.stale;
    document.getElementById('purgeBtn').disabled = stats.stale === 0;
    render();
  }

  function n(v) {
    if (v == null) return '<span class="null">—</span>';
    return String(v).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  function fmt(v) {
    return v == null ? '<span class="null">—</span>' : v.toLocaleString();
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

  function render() {
    const lp = document.getElementById('loadPortFilter').value;
    const lc = document.getElementById('loadCountryFilter').value;
    const dp = document.getElementById('dischargePortFilter').value;
    const dc = document.getElementById('dischargeCountryFilter').value;
    const co = document.getElementById('companyFilter').value;
    const loadVal = document.getElementById('loadFilter').value;
    const dateVal = document.getElementById('dateFilter').value;
    const sentDateVal = document.getElementById('sentDateFilter').value;
    const t = document.getElementById('typeFilter').value;
    const filtered = rows.filter(r => {
      if (t && r.type !== t) return false;
      if (!matchesAny(r.load_port, lp)) return false;
      if (!matchesAny(r.load_country, lc)) return false;
      if (!matchesAny(r.discharge_port, dp)) return false;
      if (!matchesAny(r.discharge_country, dc)) return false;
      if (!matchesAny(r.company, co)) return false;
      if (loadVal) {
        const loadTerms = terms(loadVal);
        if (!loadTerms.some(t => {
          const load = Number(t);
          return r.tonnage_min != null && r.tonnage_max != null && load >= r.tonnage_min && load <= r.tonnage_max;
        })) return false;
      }
      if (dateVal) {
        if (!r.laycanStart || !r.laycanEnd || dateVal < r.laycanStart || dateVal > r.laycanEnd) return false;
      }
      if (sentDateVal && (!r.date_sent || r.date_sent.slice(0, 10) < sentDateVal)) return false;
      return true;
    });
    document.getElementById('count').textContent = filtered.length + ' of ' + rows.length + ' entries';
    const empty = document.getElementById('empty');
    const tbody = document.getElementById('tbody');
    if (filtered.length === 0) { tbody.innerHTML = ''; empty.style.display = ''; return; }
    empty.style.display = 'none';
    tbody.innerHTML = filtered.map(r => \`<tr>
      <td><span class="badge badge-\${r.type}">\${r.type}</span></td>
      <td>\${n(r.subject)}</td>
      <td>\${n(r.load_port)}</td>
      <td>\${n(r.load_country)}</td>
      <td>\${n(r.discharge_port)}</td>
      <td>\${n(r.discharge_country)}</td>
      <td class="tonnage">\${fmt(r.tonnage_min)}</td>
      <td class="tonnage">\${fmt(r.tonnage_max)}</td>
      <td>\${n(r.cargo)}</td>
      <td>\${n(r.laycan)}</td>
      <td>\${n(r.laycanStart)}</td>
      <td>\${n(r.laycanEnd)}</td>
      <td>\${n(r.company)}</td>
      <td>\${r.date_sent ? r.date_sent.slice(0,10) : '<span class=\\"null\\">—</span>'}</td>
    </tr>\`).join('');
  }

  async function correctTonnage() {
    const res = await fetch('/api/correct-tonnage', { method: 'POST' }).then(r => r.json());
    alert(\`Corrected \${res.corrected} tonnage rows.\`);
    load();
  }

  async function purge() {
    const stale = parseInt(document.getElementById('s-stale').textContent);
    if (!confirm(\`Delete \${stale} entries older than 14 days?\`)) return;
    const headers = PURGE_SECRET ? { 'x-purge-secret': PURGE_SECRET } : {};
    const res = await fetch('/api/purge', { method: 'POST', headers }).then(r => r.json());
    alert(\`Purged \${res.deleted} entries.\`);
    load();
  }

  load();
</script>
</body>
</html>`;
