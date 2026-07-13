export function registerMatchesRoute(app, db) {
  app.get('/api/matches', (req, res) => {
    const rows = db.prepare(`
      SELECT
        m.id as match_id, m.leniency, m.human_review, m.whitelist_entry,
        m.vessel_uid, m.vessel_subid, m.cargo_uid, m.cargo_subid,
        v.item as vessel_item, v.subject as vessel_subject,
        v.load_port as vessel_load_port, v.load_country as vessel_load_country,
        v.discharge_port as vessel_discharge_port, v.discharge_country as vessel_discharge_country,
        v.size_class as vessel_size_class, v.tonnage_min as vessel_tonnage_min, v.tonnage_max as vessel_tonnage_max,
        v.laycan as vessel_laycan, v.laycanStart as vessel_laycanStart, v.laycanEnd as vessel_laycanEnd,
        v.company as vessel_company, v.date_sent as vessel_date_sent,
        c.item as cargo_item, c.subject as cargo_subject,
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
}

export const MATCHES_CSS = `
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
`;

export const MATCHES_TAB_BTN = `<button class="tab-btn" id="tab-matches" onclick="switchTab('matches')">Matches</button>`;

export const MATCHES_HTML = `
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
`;

export const MATCHES_JS = `
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
      stack(\`\${roleHtml} \${n(e.item)}\`, n(e.subject), 'subject'),
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
`;
