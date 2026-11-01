const $ = id => document.getElementById(id);
const DISP = [['answered','Answered'],['interested','Interested'],['not_interested','Not interested'],['callback','Call back'],['voicemail','Voicemail'],['no_answer','No answer'],['busy','Busy'],['dead_number','Dead number'],['failed','Call failed'],['wrong_number','Wrong number'],['missed','Missed (incoming)'],['cancelled','Cancelled by agent'],['do_not_call','Do not call'],['other','Other']];
const label = k => (DISP.find(d => d[0] === k) || [k, k || '—'])[1];
const ONLINE_SEC = 75; // agents heartbeat roughly every 20s
const VIEWS = ['home', 'agents', 'calls', 'lists', 'numbers', 'interested', 'besttime', 'leaderboard', 'team'];
const DATAVIEWS = ['home', 'agents', 'calls', 'numbers', 'interested', 'besttime', 'leaderboard', 'agent'];

let session = JSON.parse(localStorage.getItem('gv_admin_session') || 'null');
let profiles = [], status = [], calls = [], lists = [], progress = [];
let view = 'home', timer = null;

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  Object.assign(e, props);
  for (const k of kids.flat()) if (k != null && k !== false) e.append(k.nodeType ? k : document.createTextNode(String(k)));
  return e;
}
const fmtDur = s => {
  s = Math.max(0, Math.round(s || 0));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), x = s % 60, p = n => String(n).padStart(2, '0');
  return h ? `${h}:${p(m)}:${p(x)}` : `${m}:${p(x)}`;
};
function ago(ts) {
  const s = Math.max(0, (Date.now() - new Date(ts)) / 1000);
  if (s < 60) return Math.round(s) + 's ago';
  if (s < 3600) return Math.round(s / 60) + 'm ago';
  if (s < 86400) return Math.round(s / 3600) + 'h ago';
  return Math.round(s / 86400) + 'd ago';
}
const agentName = id => { const p = profiles.find(x => x.id === id); return p ? (p.full_name || p.email) : 'Deleted user'; };
const callAgent = c => (c.agent_id && profiles.some(p => p.id === c.agent_id)) ? agentName(c.agent_id) : (c.agent_label || 'Deleted user');
const badge = k => el('span', { className: 'badge d-' + k, textContent: label(k) });
// Older extension versions sometimes saved Google Voice screen text ("call_end", "Ongoing call") as the name.
const cleanLabel = l => (!l || /^[a-z_]+$/.test(l) || /ongoing call|^calling|ringing|connecting|end call|call ended|^call$/i.test(l)) ? '' : l;
const CONNECTED = new Set(['answered', 'interested', 'not_interested', 'callback']);
const contact = (name, number, bad) => el('div', { className: 'contact' },
  el('div', { className: 'cn' + (name ? '' : ' none'), textContent: name || 'No name' }),
  el('div', { className: 'cp num' + (bad ? ' bad' : ''), textContent: fmtPhone(number) }));
function fmtPhone(n) { const m = String(n || '').match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `+1 (${m[1]}) ${m[2]}-${m[3]}` : String(n || ''); }
// which lists each agent has numbers on (from list progress)
function listsOfAgent(id) {
  const ids = [...new Set(progress.filter(p => p.agent_id === id).map(p => p.list_id))];
  return ids.map(i => lists.find(l => l.id === i)).filter(Boolean);
}
function agentsOfList(id) {
  return [...new Set(progress.filter(p => p.list_id === id).map(p => p.agent_id))];
}
const PAGES = {
  agents: ['Agents', 'How each agent is doing in the selected period. Click one for their profile.'],
  calls: ['Calls', 'Every call your agents made. Change a result if it was logged wrong.'],
  lists: ['Lead lists', 'Upload numbers, assign them to agents and track progress.'],
  numbers: ['Numbers', 'Each phone number once, with every attempt. Click a number for its full history.'],
  interested: ['Interested', 'People who showed interest first, then your other real conversations.'],
  besttime: ['Insights', 'When and where people pick up, from your own calls.'],
  leaderboard: ['Leaderboard', 'Who brings in the most interested leads.'],
  team: ['Team', 'Agents and admins, their lists, and sign-in details.']
};
const th = (...h) => el('tr', {}, h.map(x => el('th', { textContent: x })));

// ---------- network ----------
// "Failed to fetch" only says the browser could not complete the request. Probe to find out why.
const HOST = () => { try { return new URL(CFG.SUPABASE_URL).host; } catch (e) { return CFG.SUPABASE_URL; } };
const probe = () => fetch(CFG.SUPABASE_URL + '/auth/v1/health', { mode: 'no-cors' }).then(() => true, () => false);
const NETWORK_HELP = () => `Can't reach ${HOST()} from this network (Failed to fetch). Some networks and ISPs block *.supabase.co. Try another network, a VPN, or switch your DNS to 1.1.1.1. Open diagnose.html for a step-by-step check.`;
const FUNCTION_HELP = 'Supabase is reachable, but the "admin-users" function did not answer. Deploy it with exactly that name and turn OFF "Verify JWT" (README: Enable user management).';
async function netFetch(url, opts) {
  try { return await fetch(url, opts); }
  catch (e) { throw new Error((await probe()) ? 'Supabase is reachable but the browser blocked the request. Check the URL and key in config.js, then open diagnose.html.' : NETWORK_HELP()); }
}

// ---------- auth ----------
function errText(j, text, status) {
  const raw = j.error_description || j.msg || j.message || (typeof j.error === 'string' ? j.error : '') || (text || '').slice(0, 160) || 'no response from server';
  return (j.error_code === 'invalid_credentials' || /invalid login/i.test(raw) ? 'Wrong email or password.' : raw) + ` (HTTP ${status})`;
}
async function authReq(grant, body) {
  const r = await netFetch(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!r.ok) throw new Error(errText(j, text, r.status));
  return j;
}
function store(j) {
  session = { access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + j.expires_in, user: { id: j.user.id, email: j.user.email } };
  localStorage.setItem('gv_admin_session', JSON.stringify(session));
}
async function token() {
  if (!session) throw new Error('Signed out');
  if (session.expires_at - 60 <= Date.now() / 1000) store(await authReq('refresh_token', { refresh_token: session.refresh_token }));
  return session.access_token;
}
// thin loading bar at the top while anything is loading
let busyN = 0, busyT = null, booting = false, lastLoad = Promise.resolve();
function busy(d) {
  busyN = Math.max(0, busyN + d);
  const bar = document.getElementById('topbar'); if (!bar) return;
  clearTimeout(busyT);
  if (busyN && booting) busyT = setTimeout(() => bar.classList.add('on'), 120); // only on sign-in / page refresh, not while browsing
  else { bar.classList.remove('on'); }
}
async function api(path, opts = {}) {
  busy(1);
  try { return await apiInner(path, opts); } finally { busy(-1); }
}
async function apiInner(path, opts) {
  const r = await netFetch(`${CFG.SUPABASE_URL}/rest/v1/${path}`, {
    ...opts,
    headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + await token(), 'Content-Type': 'application/json', ...(opts.headers || {}) }
  });
  const t = await r.text();
  if (!r.ok) throw new Error(t || r.status);
  return t ? JSON.parse(t) : null;
}
// Supabase caps a response at 1000 rows by default, so page through.
async function fetchAll(path, max = 20000) {
  const out = [];
  for (let off = 0; off < max; off += 1000) {
    const rows = await api(`${path}&limit=1000&offset=${off}`);
    out.push(...rows);
    if (rows.length < 1000) break;
  }
  return out;
}
// Team management goes through a server-side function (needs the secret key, which never touches the browser).
async function manageUsers(body) {
  const bearer = await token();
  let r;
  try {
    r = await fetch(`${CFG.SUPABASE_URL}/functions/v1/admin-users`, {
      method: 'POST',
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + bearer, 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    });
  } catch (e) {
    // A missing function (404) or a rejected preflight shows up as "Failed to fetch" too.
    throw new Error((await probe()) ? FUNCTION_HELP : NETWORK_HELP());
  }
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (r.status === 404) throw new Error('The "admin-users" function is not deployed yet. Follow the "Enable user management" step in the README.');
  if (!r.ok) throw new Error(j.error || j.message || text.slice(0, 160) || 'HTTP ' + r.status);
  return j;
}
function signOut() {
  session = null; localStorage.removeItem('gv_admin_session');
  clearInterval(timer);
  $('app').hidden = true; $('login').hidden = false;
}

// ---------- data ----------
function sinceISO() {
  const v = $('range').value;
  if (v === 'all') return null;
  const d = new Date();
  if (v === 'today') d.setHours(0, 0, 0, 0); else d.setDate(d.getDate() - +v);
  return d.toISOString();
}
async function load() {
  const a = document.activeElement;
  if (a && ['SELECT', 'INPUT'].includes(a.tagName) && (a.closest('table') || a.closest('#best'))) return; // don't clobber an edit
  try {
    const since = sinceISO();
    const jobs = [api('profiles?select=id,email,full_name,role&order=email'), api('agent_status?select=*')];
    const wantCalls = DATAVIEWS.includes(view), wantLists = ['lists', 'agent', 'home'].includes(view);
    // Home always looks at the last 14 days (today vs yesterday + trends), whatever the period filter says
    const callSince = view === 'home' ? Home.since() : since; // the dashboard has its own period picker
    jobs.push(wantCalls ? fetchAll('calls?select=*' + (callSince ? '&started_at=gte.' + encodeURIComponent(callSince) : '') + '&order=started_at.desc,id.asc') : null);
    jobs.push(wantLists ? api('lead_lists?select=*&order=created_at.desc') : null, wantLists ? api('rpc/list_progress', { method: 'POST', body: '{}' }).catch(() => []) : null);
    const res = await Promise.all(jobs);
    [profiles, status] = res;
    if (wantCalls) calls = res[2];
    if (wantLists) { lists = res[3] || []; progress = res[4] || []; }
    fillAgentFilter();
    $('upd').textContent = 'Updated ' + new Date().toLocaleTimeString([], { timeStyle: 'short' });
    render();
  } catch (e) {
    $('upd').textContent = 'Error: ' + String(e.message).slice(0, 90);
  }
}
function fillAgentFilter() {
  const sel = $('agent'), cur = sel.value;
  sel.replaceChildren(el('option', { value: '', textContent: 'All agents' }),
    profiles.map(p => el('option', { value: p.id, textContent: p.full_name || p.email })));
  sel.value = cur;
}
function filtered() {
  const ag = $('agent').value, d = $('disp').value, q = $('q').value.toLowerCase().trim();
  return calls.filter(c =>
    (!ag || c.agent_id === ag) && (!d || c.disposition === d) &&
    (!q || [c.number, c.label, c.notes, callAgent(c)].join(' ').toLowerCase().includes(q)));
}

// ---------- call history helpers ----------
const histCache = new Map();      // number -> calls (all time)
const openNumbers = new Set();    // numbers whose history is expanded in the Numbers tab
const when = ts => new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
function histRows(list, cols) {
  if (!list) return [el('tr', { className: 'hist' }, el('td', { colSpan: cols, textContent: 'Loading history…' }))];
  if (!list.length) return [el('tr', { className: 'hist' }, el('td', { colSpan: cols, textContent: 'No calls recorded for this number yet.' }))];
  return [el('tr', { className: 'hist hist-head' }, el('td', { colSpan: cols, textContent: `${list.length} call${list.length > 1 ? 's' : ''} to this number` })),
    ...list.map(c => el('tr', { className: 'hist' }, el('td', { colSpan: cols },
      el('span', { className: 'num', textContent: when(c.started_at) }), '  ·  ', callAgent(c), '  ·  ', fmtDur(c.duration_sec) + ' ', c.ended_by ? el('span', { className: 'sub', textContent: c.ended_by === 'agent' ? ' (agent hung up) ' : ' (other side ended) ' }) : ' ',
      c.auto_disposition && c.auto_disposition !== c.disposition ? [el('span', { className: 'sub', textContent: 'auto: ' }), badge(c.auto_disposition), ' → '] : null,
      badge(c.disposition), el('span', { className: 'sub', textContent: `  (${c.disposition_source})` }),
      c.notes ? el('span', { className: 'sub', textContent: '  “' + c.notes + '”' }) : null)))];
}
async function loadHistory(number) {
  const rows = await fetchAll('calls?select=*&number=eq.' + encodeURIComponent(number) + '&order=started_at.desc,id.asc', 2000);
  histCache.set(number, rows);
  return rows;
}

// ---------- views ----------
function statusEl(id) {
  const st = status.find(s => s.agent_id === id);
  if (!st) return el('span', { className: 'st off', textContent: 'Never connected' });
  if ((Date.now() - new Date(st.last_seen)) / 1000 < ONLINE_SEC)
    return st.on_call ? el('span', { className: 'st on-call', textContent: 'On call' + (st.current_number ? ' · ' + st.current_number : '') })
                      : el('span', { className: 'st online', textContent: 'Online' });
  return el('span', { className: 'st off', textContent: 'Offline · ' + ago(st.last_seen) });
}

function kpis(rows) {
  const online = status.filter(s => (Date.now() - new Date(s.last_seen)) / 1000 < ONLINE_SEC);
  const items = [
    ['Agents online', online.length, 'var(--blue)'],
    ['On a call', online.filter(s => s.on_call).length, 'var(--green)'],
    ['Calls', rows.length, '#6d8bff'],
    ['Talk time', fmtDur(rows.reduce((s, c) => s + (c.duration_sec || 0), 0)), 'var(--purple)'],
    ['Interested', rows.filter(c => c.disposition === 'interested').length, '#3257F7'],
    ['Answered', rows.filter(c => c.disposition === 'answered').length, '#12b76a']
  ];
  $('kpis').replaceChildren(...items.map(([l, v, c]) =>
    el('div', { className: 'kpi', style: `--c:${c}` }, el('div', { className: 'v', textContent: v }), el('div', { className: 'l', textContent: l }))));
}

// ---------- leaderboard: interested first, then talk time, then call-backs ----------
function renderBoard() {
  const agents = profiles.filter(p => p.role === 'agent');
  const rows = agents.map(p => {
    const mine = calls.filter(c => c.agent_id === p.id);
    return { p, calls: mine.length, interested: mine.filter(c => c.disposition === 'interested').length,
      talk: mine.reduce((s, c) => s + (c.duration_sec || 0), 0), callbacks: mine.filter(c => c.disposition === 'callback').length };
  }).sort((a, b) => b.interested - a.interested || b.talk - a.talk || b.callbacks - a.callbacks || b.calls - a.calls);
  const t = el('table'); t.append(th('#', 'Agent', 'Interested', 'Talk time', 'Call backs', 'Calls'));
  rows.forEach((r, i) => t.append(el('tr', {},
    el('td', {}, el('span', { className: 'rank' + (i < 3 && r.calls ? ' r' + (i + 1) : ''), textContent: i + 1 })),
    el('td', {}, el('b', { textContent: r.p.full_name || r.p.email })),
    el('td', { className: 'num', textContent: r.interested }), el('td', { className: 'num', textContent: fmtDur(r.talk) }),
    el('td', { className: 'num', textContent: r.callbacks }), el('td', { className: 'num', textContent: r.calls }))));
  if (!rows.length) t.append(el('tr', {}, el('td', { colSpan: 6, className: 'empty', textContent: 'No agents yet.' })));
  t.querySelectorAll('tr').forEach((tr, i) => { if (i && rows[i - 1]) { tr.className = 'click'; tr.onclick = () => go('#/agent/' + rows[i - 1].p.id); } });
  const medal = ['🥇', '🥈', '🥉'];
  const podium = el('div', { className: 'podium' }, rows.slice(0, 3).filter(r => r.calls).map((r, i) => {
    const c = el('div', { className: 'pod p' + (i + 1) },
      el('div', { className: 'pm', textContent: medal[i] }),
      el('div', { className: 'pn', textContent: r.p.full_name || r.p.email }),
      el('div', { className: 'pv', textContent: r.interested }), el('div', { className: 'pl', textContent: 'interested' }),
      el('div', { className: 'ps', textContent: `${fmtDur(r.talk)} talk · ${r.callbacks} call backs · ${r.calls} calls` }));
    c.onclick = () => go('#/agent/' + r.p.id);
    return c;
  }));
  $('board').className = 'board';
  $('board').replaceChildren(podium, el('p', { className: 'hint', textContent: 'Ranked by most interested leads, then talk time, then call backs, for the selected period.' }),
    el('div', { className: 'card' }, el('div', { className: 'scroll', style: 'max-height:none' }, t)));
}

// ---------- interested leads: interested numbers first, then the rest by talk time ----------
function renderInterested(rows) {
  // Only real conversations: someone picked up (answered / interested / call back). Voicemail, no answer, dead etc. are left out.
  const RANK = { interested: 3, callback: 2, answered: 1 };
  const g = new Map();
  for (const c of rows) {
    if (!RANK[c.disposition]) continue;
    const x = g.get(c.number) || { number: c.number, name: '', calls: 0, talk: 0, best: c.disposition, last: null, note: '' };
    x.calls++; x.talk += c.duration_sec || 0;
    if (RANK[c.disposition] > RANK[x.best]) x.best = c.disposition;
    if (!x.last || new Date(c.started_at) > new Date(x.last.started_at)) x.last = c;
    if (cleanLabel(c.label) && !x.name) x.name = cleanLabel(c.label);
    if (c.notes && !x.note) x.note = c.notes;
    g.set(c.number, x);
  }
  const all = [...g.values()];
  const hot = all.filter(x => x.best === 'interested').sort((a, b) => b.talk - a.talk);
  const rest = all.filter(x => x.best !== 'interested').sort((a, b) => b.talk - a.talk).slice(0, 300);
  const t = $('tbl'); t.replaceChildren(th('Number', 'Name', 'Agent', 'Result', 'Talk time', 'Calls', 'Last called', 'Note'));
  const line = x => el('tr', {},
    el('td', { className: 'num', textContent: x.number }), el('td', { textContent: x.name }), el('td', { textContent: callAgent(x.last) }),
    el('td', {}, badge(x.best)), el('td', { className: 'num', textContent: fmtDur(x.talk) }),
    el('td', { textContent: x.calls }), el('td', { textContent: when(x.last.started_at) }), el('td', { textContent: x.note }));
  const sec = txt => el('tr', { className: 'sec' }, el('td', { colSpan: 8, textContent: txt }));
  t.append(sec(`Interested (${hot.length})`), ...hot.map(line));
  if (!hot.length) t.append(el('tr', {}, el('td', { colSpan: 8, className: 'empty', textContent: 'No one marked interested in this period yet.' })));
  t.append(sec('Other conversations, longest talk time first'), ...rest.map(line));
  if (!rest.length) t.append(el('tr', {}, el('td', { colSpan: 8, className: 'empty', textContent: 'No other answered or call-back numbers.' })));
}

function renderBest() {
  const ag = $('agent').value;
  BestTime.render($('best'), calls.filter(c => !ag || c.agent_id === ag), el, renderBest);
}

function renderAgents(rows) {
  const t = $('tbl'); t.replaceChildren(th('Agent', 'Status', 'Calls', 'Numbers', 'Picked up', 'Connectivity', 'Talk time', 'Interested', 'Call backs', 'Answered', 'Voicemail', 'No answer', 'Dead'));
  for (const p of profiles) {
    const mine = rows.filter(c => c.agent_id === p.id);
    const n = d => mine.filter(c => c.disposition === d).length;
    const tr = el('tr', { className: 'click', title: 'Open ' + (p.full_name || p.email) + "'s profile" },
      el('td', {}, el('b', { className: 'alink', textContent: p.full_name || p.email }), p.role === 'admin' ? el('span', { className: 'chip', textContent: 'admin' }) : null),
      el('td', {}, statusEl(p.id)),
      el('td', { className: 'num', textContent: mine.length }),
      ...(() => { const cs = Conn.analyse(mine); const pc = v => (v == null ? '—' : Math.round(v * 100) + '%');
        return [el('td', { className: 'num', textContent: cs.total }), el('td', { className: 'num', title: cs.n.human + ' numbers picked up by a person' }, el('b', { style: 'color:#079455', textContent: pc(cs.pickup) })),
          el('td', { className: 'num', title: (cs.n.human + cs.n.active) + ' live numbers', textContent: pc(cs.connectivity) })]; })(),
      el('td', { className: 'num', textContent: fmtDur(mine.reduce((x, c) => x + (c.duration_sec || 0), 0)) }),
      el('td', { textContent: n('interested') }), el('td', { textContent: n('callback') }),
      el('td', { textContent: n('answered') }), el('td', { textContent: n('voicemail') }), el('td', { textContent: n('no_answer') }),
      el('td', { className: n('dead_number') ? 'bad' : '', textContent: n('dead_number') }));
    tr.onclick = () => openAgent(p.id);
    t.append(tr);
  }
}

function renderCalls(rows) {
  const counts = {}; for (const c of calls.filter(c => (!$('agent').value || c.agent_id === $('agent').value))) counts[c.disposition] = (counts[c.disposition] || 0) + 1;
  const cur = $('disp').value;
  $('kpis').hidden = false;
  $('kpis').className = 'chips';
  $('kpis').replaceChildren(el('button', { className: 'fchip' + (cur ? '' : ' on'), onclick: () => { $('disp').value = ''; render(); } }, 'All ', el('b', { textContent: Object.values(counts).reduce((a, b) => a + b, 0) })),
    ...DISP.filter(([k]) => counts[k]).map(([k, n]) => el('button', { className: 'fchip d-' + k + (cur === k ? ' on' : ''), onclick: () => { $('disp').value = cur === k ? '' : k; render(); } }, n + ' ', el('b', { textContent: counts[k] }))));
  const t = $('tbl'); t.replaceChildren(th('Time', 'Agent', 'Number', 'Name', 'Length', 'Ended by', 'Auto result', 'Final disposition', 'Set by', 'Note'));
  if (!rows.length) { t.append(el('tr', {}, el('td', { colSpan: 10, className: 'empty', textContent: 'No calls in this range yet.' }))); return; }
  for (const c of rows.slice(0, 1000)) {
    const sel = el('select', {}, DISP.map(([k, n]) => el('option', { value: k, textContent: n, selected: k === c.disposition })));
    sel.onchange = async () => {
      try {
        await api('calls?id=eq.' + c.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ disposition: sel.value, disposition_source: 'admin' }) });
        c.disposition = sel.value; c.disposition_source = 'admin';
        sel.blur(); render();
      } catch (e) { alert('Could not save: ' + e.message); }
    };
    const differs = c.auto_disposition && c.auto_disposition !== c.disposition;
    const agentCell = el('td', {}, el('span', { className: 'alink', textContent: callAgent(c) }));
    if (c.agent_id) agentCell.onclick = () => openAgent(c.agent_id);
    t.append(el('tr', {},
      el('td', { className: 'nowrap', textContent: new Date(c.started_at).toLocaleString([], { dateStyle: 'short', timeStyle: 'short' }) }),
      agentCell,
      el('td', { className: c.disposition === 'dead_number' ? 'bad num' : 'num', textContent: c.number }),
      el('td', { textContent: cleanLabel(c.label) }),
      el('td', { className: 'num', textContent: fmtDur(c.duration_sec) }),
      el('td', { textContent: c.ended_by === 'agent' ? 'Agent' : c.ended_by === 'remote' ? 'Other side' : '' }),
      el('td', { className: differs ? 'diff' : '' }, c.auto_disposition ? badge(c.auto_disposition) : ''),
      el('td', {}, sel),
      el('td', { className: 'src-' + c.disposition_source, textContent: c.disposition_source }),
      el('td', { textContent: c.notes || '' })));
  }
}

function renderNumbers(rows) {
  const t = $('tbl'); t.replaceChildren(th('Number', 'Name', 'Line', 'Attempts', 'Agents', 'Interested', 'Answered', 'Voicemail', 'No answer', 'Talk time', 'Last result', 'Last called by', 'When'));
  numberRows(rows, t, 13, true, true);
}
// One row per number (click for full history). Used by Numbers and the agent profile.
function numberRows(rows, t, cols, withAgents, withLine = false) {
  const by = new Map();
  for (const c of rows) {
    const g = by.get(c.number) || { number: c.number, label: '', n: 0, agents: new Set(), int: 0, ans: 0, vm: 0, na: 0, talk: 0, last: c, line: 'none' };
    { const cl = Conn.callClass(c), R = { human: 3, active: 2, dead: 1, none: 0 }; if (R[cl] > R[g.line]) g.line = cl; }
    g.n++; g.agents.add(callAgent(c)); g.talk += c.duration_sec || 0;
    if (!g.label) g.label = cleanLabel(c.label);
    if (c.disposition === 'interested') g.int++;
    if (c.disposition === 'answered') g.ans++;
    if (c.disposition === 'voicemail') g.vm++;
    if (c.disposition === 'no_answer') g.na++;
    if (new Date(c.started_at) > new Date(g.last.started_at)) g.last = c;
    by.set(c.number, g);
  }
  const groups = [...by.values()].sort((a, b) => new Date(b.last.started_at) - new Date(a.last.started_at));
  if (!groups.length) t.append(el('tr', {}, el('td', { colSpan: cols, className: 'empty', textContent: 'No calls in this range yet.' })));
  for (const g of groups.slice(0, 1000)) {
    const open = openNumbers.has(g.number);
    const tr = el('tr', { className: 'click', title: 'Click to see every call to this number' },
      el('td', { className: 'num' + (g.last.disposition === 'dead_number' ? ' bad' : '') }, el('span', { className: 'caret', textContent: open ? '▾' : '▸' }), g.number),
      el('td', { textContent: g.label }),
      withLine ? el('td', {}, el('span', { className: 'line-b ' + g.line, textContent: { human: 'Person picked up', active: 'Active · no person', dead: 'Dead', none: 'Not reached' }[g.line] })) : null,
      el('td', { textContent: g.n }),
      withAgents ? el('td', { textContent: g.agents.size }) : null,
      el('td', { textContent: g.int }), el('td', { textContent: g.ans }), el('td', { textContent: g.vm }), el('td', { textContent: g.na }),
      el('td', { className: 'num', textContent: fmtDur(g.talk) }),
      el('td', {}, badge(g.last.disposition)),
      withAgents ? el('td', { textContent: callAgent(g.last) }) : null,
      el('td', { textContent: ago(g.last.started_at) }));
    // expand/collapse in place: no full redraw, so nothing on the page moves except the opened rows
    let extra = [];
    const show = list => { extra.forEach(x => x.remove()); extra = histRows(list, cols); tr.after(...extra); };
    tr.onclick = async () => {
      const caret = tr.querySelector('.caret');
      if (openNumbers.has(g.number)) { openNumbers.delete(g.number); extra.forEach(x => x.remove()); extra = []; caret.textContent = '▸'; return; }
      openNumbers.add(g.number); caret.textContent = '▾';
      show(histCache.get(g.number));
      if (!histCache.has(g.number)) { try { await loadHistory(g.number); } catch (e) { histCache.set(g.number, []); } if (openNumbers.has(g.number)) show(histCache.get(g.number)); }
    };
    t.append(tr);
    if (open) { extra = histRows(histCache.get(g.number), cols); t.append(...extra); }
  }
}

function renderLists() {
  const t = $('lists'); t.replaceChildren(th('List', 'Progress', ''));
  { const sum = st => progress.filter(r => r.status === st).reduce((s, r) => s + Number(r.n), 0);
    const finished = lists.filter(l => { const r = progress.filter(p => p.list_id === l.id); return r.length && !r.some(x => x.status === 'pending' && Number(x.n)); }).length;
    const stat = (v, l, c) => el('div', { className: 'kpi', style: `--c:${c}` }, el('div', { className: 'v', textContent: v }), el('div', { className: 'l', textContent: l }));
    $('listkpis').replaceChildren(stat(lists.filter(l => l.enabled !== false).length, 'Active lists', '#3257F7'), stat(sum('pending').toLocaleString(), 'Numbers waiting', '#f79009'),
      stat((sum('called') + sum('skipped')).toLocaleString(), 'Numbers called', '#12b76a'), stat(finished, 'Lists finished', '#7a5af8')); }
  if (openListId) return;
  if (!lists.length) { t.append(el('tr', {}, el('td', { colSpan: 3, className: 'empty', textContent: 'No lists yet. Click “+ Add list” to upload your first spreadsheet.' }))); return; }
  for (const l of lists) {
    const rows = progress.filter(p => p.list_id === l.id);
    const sum = st => rows.filter(r => r.status === st).reduce((s, r) => s + Number(r.n), 0);
    const total = sum('pending') + sum('called') + sum('skipped');
    const done = sum('called') + sum('skipped');
    const per = new Map();
    for (const r of rows) {
      const a = per.get(r.agent_id) || { done: 0, total: 0 };
      a.total += Number(r.n); if (r.status !== 'pending') a.done += Number(r.n);
      per.set(r.agent_id, a);
    }
    const requeue = el('button', { className: 'btn', textContent: 'Re-queue' });
    requeue.onclick = async () => {
      if (!confirm(`Put every called/skipped number in "${l.name}" back in the queue?`)) return;
      await api('leads?list_id=eq.' + l.id + '&status=neq.pending', { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ status: 'pending', called_at: null }) });
      load();
    };
    const del = el('button', { className: 'btn danger', textContent: 'Delete' });
    del.onclick = async () => {
      if (!confirm(`Delete "${l.name}" and its ${total} numbers? Logged calls are kept.`)) return;
      await api('lead_lists?id=eq.' + l.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } });
      load();
    };
    const toggle = el('button', { className: 'btn', textContent: l.enabled === false ? 'Enable' : 'Disable',
      title: l.enabled === false ? 'Agents get this list\'s undialed numbers back' : 'Hide this list\'s undialed numbers from agents (nothing is deleted)' });
    toggle.onclick = async e => {
      e.stopPropagation();
      try { await api('lead_lists?id=eq.' + l.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ enabled: l.enabled === false }) }); load(); }
      catch (err) { alert('Could not change the list: ' + err.message + '\n\nRe-run supabase/schema.sql if this is the first time.'); }
    };
    const pending = sum('pending');
    const nameCell = el('td', {}, el('b', { textContent: l.name }), l.enabled === false ? el('span', { className: 'badge off', style: 'margin-left:8px', textContent: 'Disabled' }) : null,
      el('div', { className: 'sub', style: 'margin:0;font-size:12px', textContent: new Date(l.created_at).toLocaleDateString() + ' · ' + total + ' numbers' + (l.enabled === false && pending ? ` · ${pending} hidden from agents` : '') }));
    const row = el('tr', { className: 'click', title: 'Open this list and see its call history', style: l.enabled === false ? 'opacity:.7' : '' },
      nameCell,
      el('td', { className: 'progcell' }, el('div', { className: 'bar' }, el('i', { style: `width:${total ? Math.round(done / total * 100) : 0}%` })),
        el('div', { className: 'sub', style: 'margin:2px 0 0;font-size:12px', textContent: `${done} of ${total} done · ${sum('skipped')} skipped` })),
      el('td', { className: 'actcell' }, toggle, ' ', requeue, ' ', del));
    row.onclick = () => go('#/lists/' + l.id);
    for (const b of [requeue, del]) { const f = b.onclick; b.onclick = e => { e.stopPropagation(); return f(e); }; }
    t.append(row);
  }
}

// ----- one list: its numbers and every call made on it -----
let openListId = null, listData = null, listTab = 'numbers', openLeads = new Set();
let listAgent = null, listFrom = 'list'; // listAgent: show only that agent's part of the list
async function openList(l, agentId = null, from = 'list') {
  openListId = l.id; listAgent = agentId; listFrom = from; $('pagehead').hidden = true; listTab = 'numbers'; openLeads = new Set(); listData = null;
  const only = agentId ? '&agent_id=eq.' + agentId : '';
  $('lists-main').hidden = true; $('list-detail').hidden = false;
  renderListDetail(l);
  try {
    const [leads, lcalls] = await Promise.all([
      fetchAll('leads?select=*&list_id=eq.' + l.id + only + '&order=position.asc,id.asc'),
      fetchAll('calls?select=*&list_id=eq.' + l.id + only + '&order=started_at.desc,id.asc')
    ]);
    listData = { leads, calls: lcalls };
  } catch (e) { listData = { leads: [], calls: [], error: e.message }; }
  renderListDetail(l);
}
function closeList() {
  if (listAgent && listFrom === 'profile') go('#/agent/' + listAgent);
  else if (listAgent) go('#/lists/' + openListId);
  else go('#/lists');
}
function renderListDetail(l) {
  const box = $('list-detail'); box.replaceChildren();
  const back = el('button', { className: 'btn backlink', textContent: listAgent ? (listFrom === 'profile' ? `← ${agentName(listAgent)}'s profile` : `← All of ${l.name}`) : '← All lists', onclick: closeList });
  const seg = el('div', { className: 'seg' },
    ...[['numbers', 'Numbers'], ['history', 'Call history']].map(([k, n]) => el('button', { className: listTab === k ? 'on' : '', textContent: n, onclick: () => { listTab = k; renderListDetail(l); } })));
  const csv = el('button', { className: 'btn', textContent: 'Export history CSV', onclick: () => exportListCsv(l) });
  box.append(back, el('div', { className: 'dtop' }, el('h2', {}, l.name, listAgent ? el('span', { className: 'sub', style: 'font-weight:500;font-size:16px', textContent: '  ·  ' + agentName(listAgent) + "'s numbers" }) : null),
    listAgent && listFrom === 'list' ? el('a', { className: 'link', href: '#/agent/' + listAgent, textContent: 'Open ' + agentName(listAgent) + "'s profile →" }) : null, l.enabled === false ? el('span', { className: 'badge off', textContent: 'Disabled' }) : null, seg, csv));
  if (!listData) { box.append(el('div', { className: 'card pad', textContent: 'Loading…' })); return; }
  if (listData.error) { box.append(el('div', { className: 'note err', textContent: listData.error })); return; }
  const { leads, calls: lc } = listData;
  const by = new Map();
  for (const c of lc) { const k = c.lead_id || c.number; (by.get(k) || by.set(k, []).get(k)).push(c); }
  const called = leads.filter(x => (x.attempts || 0) > 0).length;
  box.append(el('div', { className: 'kpis' }, ...[['Numbers', leads.length, 'var(--blue)'], ['Called', called, 'var(--green)'], ['Not called', leads.length - called, '#98a2b3'], ['Total calls', lc.length, 'var(--purple)'],
    ['Answered', lc.filter(c => c.disposition === 'answered').length, '#12b76a'], ['Voicemail', lc.filter(c => c.disposition === 'voicemail').length, '#7a5af8']].map(([lab, v, c]) =>
    el('div', { className: 'kpi', style: `--c:${c}` }, el('div', { className: 'v', textContent: v }), el('div', { className: 'l', textContent: lab })))));
  box.append(Object.assign(el('div', { style: 'margin-bottom:16px' }), { innerHTML: Conn.card(Conn.analyse(lc), { title: 'Connectivity', sub: (listAgent ? agentName(listAgent) + "'s numbers on this list" : 'Numbers called on this list') + ' · ' + leads.filter(x => !(x.attempts > 0)).length.toLocaleString() + ' not called yet' }) }));
  // who works this list
  const ag = new Map();
  for (const x of leads) { const a = ag.get(x.agent_id) || { total: 0, called: 0 }; a.total++; if ((x.attempts || 0) > 0 || x.status !== 'pending') a.called++; ag.set(x.agent_id, a); }
  const at = el('table'); at.append(th('Agent', 'Numbers', 'Called', 'Left', 'Progress'));
  for (const [id, a] of ag) {
    const tr = el('tr', { className: 'click', title: 'Open profile' },
      el('td', {}, el('b', { className: 'alink', textContent: agentName(id) })), el('td', { textContent: a.total }), el('td', { textContent: a.called }), el('td', { textContent: a.total - a.called }),
      el('td', {}, el('div', { className: 'bar' }, el('i', { style: `width:${a.total ? Math.round(a.called / a.total * 100) : 0}%` }))));
    tr.onclick = () => go(`#/lists/${l.id}/agent/${id}`); // this agent's progress on this list
    at.append(tr);
  }
  if (!listAgent) box.append(el('h3', { className: 'sec-h', textContent: 'Agents on this list' }), el('div', { className: 'card', style: 'margin-bottom:18px' }, el('div', { className: 'scroll', style: 'max-height:none' }, at)));
  box.append(el('h3', { className: 'sec-h', textContent: listTab === 'numbers' ? 'Numbers' : 'Call history' }));
  const t = el('table');
  if (listTab === 'numbers') {
    const showName = leads.some(x => x.name), showCo = leads.some(x => x.company);
    const exLabels = [...new Set(leads.flatMap(x => (x.extra || []).map(e => e.l)))];
    const cols = [showName ? 'Name' : null, showCo ? 'Company' : null, ...exLabels].filter(Boolean);
    const exVal = (x, lab) => ((x.extra || []).find(e => e.l === lab) || {}).v || '';
    t.append(th('Number', ...cols, 'Agent', 'Queue', 'Calls', 'Last result', 'Last called'));
    for (const x of leads.slice(0, 2000)) {
      const open = openLeads.has(x.id);
      const tr = el('tr', { className: 'click' },
        el('td', { className: 'num' }, el('span', { className: 'caret', textContent: open ? '▾' : '▸' }), x.number),
        showName ? el('td', { textContent: x.name || '' }) : null, showCo ? el('td', { textContent: x.company || '' }) : null, ...exLabels.map(lab => el('td', { textContent: exVal(x, lab) })), el('td', { textContent: agentName(x.agent_id) }),
        el('td', { textContent: x.status === 'pending' ? (l.enabled === false ? 'paused (list disabled)' : 'in queue') : x.status }),
        el('td', { textContent: x.attempts || 0 }),
        el('td', {}, x.last_disposition ? badge(x.last_disposition) : el('span', { className: 'sub', textContent: 'not called' })),
        el('td', { textContent: x.last_call_at ? when(x.last_call_at) : '' }));
      let extra = open ? histRows(by.get(x.id) || [], 6 + cols.length) : [];
      tr.onclick = () => { // toggle in place so the page doesn't jump
        const caret = tr.querySelector('.caret');
        if (openLeads.has(x.id)) { openLeads.delete(x.id); extra.forEach(r => r.remove()); extra = []; caret.textContent = '▸'; }
        else { openLeads.add(x.id); extra = histRows(by.get(x.id) || [], 6 + cols.length); tr.after(...extra); caret.textContent = '▾'; }
      };
      t.append(tr, ...extra);
    }
    if (!leads.length) t.append(el('tr', {}, el('td', { colSpan: 8, className: 'empty', textContent: 'This list has no numbers.' })));
  } else {
    t.append(th('Time', 'Agent', 'Number', 'Name', 'Length', 'Auto result', 'Final disposition', 'Set by', 'Note'));
    for (const c of lc.slice(0, 2000)) t.append(el('tr', {},
      el('td', { textContent: when(c.started_at) }), el('td', { textContent: callAgent(c) }), el('td', { className: 'num', textContent: c.number }),
      el('td', { textContent: cleanLabel(c.label) }), el('td', { className: 'num', textContent: fmtDur(c.duration_sec) }),
      el('td', {}, c.auto_disposition ? badge(c.auto_disposition) : ''), el('td', {}, badge(c.disposition)),
      el('td', { className: 'src-' + c.disposition_source, textContent: c.disposition_source }), el('td', { textContent: c.notes || '' })));
    if (!lc.length) t.append(el('tr', {}, el('td', { colSpan: 9, className: 'empty', textContent: 'No calls have been made on this list yet.' })));
  }
  box.append(el('div', { className: 'card' }, el('div', { className: 'scroll' }, t)));
}
function exportListCsv(l) {
  if (!listData) return;
  const q = v => '"' + String(v ?? '').replace(/"/g, '""') + '"';
  const lines = [['time', 'agent', 'number', 'name', 'direction', 'duration_sec', 'auto_disposition', 'disposition', 'set_by', 'notes'].join(',')];
  for (const c of listData.calls) lines.push([c.started_at, callAgent(c), c.number, cleanLabel(c.label), c.direction, c.duration_sec, c.auto_disposition, c.disposition, c.disposition_source, c.notes].map(q).join(','));
  const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: (l.name || 'list').replace(/[^\w.-]+/g, '_') + '-history.csv' });
  document.body.append(a); a.click(); a.remove();
}

function renderTeam() {
  const t = $('team'); t.replaceChildren(th('Name', 'Email', 'Role', 'Status', ''));
  for (const p of profiles) {
    const self = session && p.id === session.user.id;
    const reset = el('button', { className: 'btn', textContent: 'Reset password' });
    reset.onclick = async () => {
      const pw = prompt(`New password for ${p.full_name || p.email} (8+ characters):`);
      if (pw == null) return;
      try { await manageUsers({ action: 'set_password', id: p.id, password: pw }); alert('Password changed. Share it with them.'); }
      catch (e) { alert(e.message); }
    };
    const del = el('button', { className: 'btn danger', textContent: 'Delete', disabled: self, title: self ? "You can't delete yourself" : '' });
    del.onclick = async () => {
      if (!confirm(`Delete ${p.full_name || p.email}?\n\nThey can no longer sign in and any numbers still assigned to them are removed. Their logged calls stay in your reports.`)) return;
      try { await manageUsers({ action: 'delete', id: p.id }); load(); } catch (e) { alert(e.message); }
    };
    t.append(el('tr', {},
      el('td', {}, Object.assign(el('b', { className: 'alink', textContent: p.full_name || '—', title: 'Open profile' }), { onclick: () => openAgent(p.id) })),
      el('td', { textContent: p.email }),
      el('td', {}, el('span', { className: 'chip', textContent: p.role })),
      el('td', {}, statusEl(p.id)),
      el('td', { className: 'nowrap' }, reset, ' ', del)));
  }
}

function render() {
  if (view === 'lists') return renderLists();
  if (view === 'team') return renderTeam();
  if (view === 'besttime') return renderBest();
  if (view === 'leaderboard') return renderBoard();
  if (view === 'agent') return renderProfile();
  if (view === 'home') return Home.render($('v-home'), { calls, profiles, status, lists, progress, label, agentName, callAgent, fmtDur, ago, cleanLabel, ONLINE_SEC,
    onAgent: id => go('#/agent/' + id), onList: id => go('#/lists/' + id), reload: load });
  const rows = filtered();
  $('kpis').className = 'kpis';
  kpis(rows);
  $('kpis').hidden = view !== 'agents';
  $('disp').hidden = view === 'interested';
  if (view === 'interested') return renderInterested(calls.filter(c => (!$('agent').value || c.agent_id === $('agent').value) &&
    (!$('q').value.trim() || [c.number, c.label, c.notes, callAgent(c)].join(' ').toLowerCase().includes($('q').value.toLowerCase().trim()))));
  ({ agents: renderAgents, calls: renderCalls, numbers: renderNumbers })[view](rows);
}
function showView(v) {
  const changed = view !== v || !showView.done; showView.done = true;
  view = v;
  if (changed) { const m = document.querySelector('main'); m.classList.remove('fadein'); void m.offsetWidth; m.classList.add('fadein'); }
  if (v === 'home') Home.skeleton($('v-home'));
  const ph = PAGES[v];
  $('pagehead').hidden = !ph;
  if (ph) $('pagehead').replaceChildren(el('div', { className: 'crumb', textContent: 'Pages / ' + ph[0] }), el('h1', { textContent: ph[0] }), el('p', { textContent: ph[1] }));
  if (v === 'besttime' && $('range').value === 'today') $('range').value = '30'; // today alone is too little data
  for (const k of VIEWS) $('t-' + k).className = k === v ? 'on' : '';
  const dataView = DATAVIEWS.includes(v);
  $('v-data').hidden = !dataView || ['besttime', 'leaderboard', 'agent', 'home'].includes(v);
  $('v-agent').hidden = v !== 'agent';
  $('v-home').hidden = v !== 'home';
  $('v-best').hidden = v !== 'besttime';
  $('v-lb').hidden = v !== 'leaderboard';
  $('disp').hidden = ['besttime', 'interested', 'leaderboard'].includes(v);
  $('q').hidden = v === 'besttime' || v === 'leaderboard';
  $('agent').hidden = v === 'leaderboard' || v === 'agent';
  if (v === 'agent') { $('disp').hidden = true; $('q').hidden = true; }
  $('nav').classList.remove('open'); $('burger').setAttribute('aria-expanded', 'false');
  $('v-lists').hidden = v !== 'lists';
  // entering any page resets the list sub-pages; the router opens a list / upload afterwards if the link asks for it
  openListId = null; listAgent = null; listData = null;
  $('list-detail').hidden = true; $('upload-page').hidden = true; $('lists-main').hidden = false;
  $('v-team').hidden = v !== 'team';
  $('filters').hidden = !dataView || v === 'agent' || v === 'home';
  $('csv').hidden = !dataView || v === 'home' || v === 'agent'; $('mcsv').hidden = !dataView || ['besttime', 'leaderboard', 'home', 'agent'].includes(v);
  lastLoad = load();
}

// ---------- links for every page (#/overview, #/lists/<id>, #/agent/<id> …) ----------
const SLUG = { home: 'home', agents: 'agents', calls: 'calls', lists: 'lists', numbers: 'numbers', interested: 'interested', besttime: 'insights', leaderboard: 'leaderboard', team: 'team' };
const VIEW_OF = { ...Object.fromEntries(Object.entries(SLUG).map(([k, v]) => [v, k])), overview: 'agents' };
const go = h => { if (location.hash === h) route(); else location.hash = h; };
function setView(v) { go(v === 'agent' ? '#/agent/' + profileId : '#/' + (SLUG[v] || 'home')); }
let profileBack = '#/home';
async function findList(id) {
  let l = lists.find(x => x.id === id);
  if (!l) { try { l = (await api('lead_lists?select=*&id=eq.' + encodeURIComponent(id)))[0]; } catch (e) { l = null; } }
  return l;
}
async function route(e) {
  if (!session) return;
  const [a, b, c, d] = location.hash.replace(/^#\/?/, '').split('/').filter(Boolean).map(decodeURIComponent);
  if (!profiles.length) { try { profiles = await api('profiles?select=id,email,full_name,role&order=email'); } catch (err) { /* load() will report */ } }
  if (a === 'agent' && b) {
    // remember where we came from, so Back on the profile returns there
    const old = e && e.oldURL ? (e.oldURL.split('#')[1] || '') : '';
    if (old && !old.startsWith('/agent/' + b)) profileBack = '#' + old;
    profileId = b;
    if (c === 'list' && d) { showView('lists'); const l = await findList(d); if (l) openList(l, b, 'profile'); }
    else showView('agent');
  } else if (a === 'lists' && b === 'new') { showView('lists'); openUpload(); }
  else if (a === 'lists' && b) { showView('lists'); const l = await findList(b); if (l) openList(l, c === 'agent' ? d : null, 'list'); }
  else showView(VIEW_OF[a] || 'home');
}
window.addEventListener('hashchange', route);

// ---------- team: add member ----------
function randomPassword() {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const b = crypto.getRandomValues(new Uint8Array(12));
  return [...b].map(x => chars[x % chars.length]).join('');
}
async function addMember() {
  const msg = (cls, text) => $('tm-msg').replaceChildren(el('div', { className: 'note ' + cls, textContent: text }));
  const body = { action: 'create', full_name: $('tm-name').value.trim(), email: $('tm-email').value.trim(), password: $('tm-pass').value, role: $('tm-role').value };
  if (!body.email || body.password.length < 8) return msg('err', 'Enter an email and a password of at least 8 characters.');
  $('tm-add').disabled = true;
  try {
    await manageUsers(body);
    msg('ok', `Created. Share these with them: ${body.email} / ${body.password}`);
    $('tm-name').value = ''; $('tm-email').value = ''; $('tm-pass').value = '';
    load();
  } catch (e) { msg('err', e.message); }
  $('tm-add').disabled = false;
}

// ---------- upload numbers ----------
let sheet = null; // { name, sheetName, raw, width, hdrIdx, headers, rows }
const COLS = ['phone', 'name', 'company'];
let extraCols = []; // [{ col, label }] extra columns chosen at upload
const curExtras = () => extraCols.filter(e => e.col >= 0).map(e => ({ col: e.col, label: (e.label || '').trim() || String(sheet.headers[e.col]) }));
// Options for any column picker: "HEADER · e.g. sample", columns with data first.
function colOptions(cur, noneText = '— not used —') {
  const st = sheet.stats;
  const opt = j => el('option', { value: j, textContent: short(String(sheet.headers[j]), 30) + (st[j].sample ? '  ·  ' + short(cleanVal(st[j].sample), 26) : '  ·  (empty)'), selected: j === cur });
  const all = sheet.headers.map((_, j) => j);
  const withData = all.filter(j => st[j].filled), empty = all.filter(j => !st[j].filled);
  return [el('option', { value: -1, textContent: noneText }), ...withData.map(opt),
    empty.length ? el('optgroup', { label: 'Empty columns' }, ...empty.map(opt)) : null].filter(Boolean);
}
const cleanVal = v => String(v ?? '').trim().replace(/^(\d+)\.0+$/, '$1');
const okMark = on => el('span', { className: 'fstat' + (on ? ' on' : ''), textContent: on ? '✓' : '', title: on ? 'Mapped' : 'Not used' });

function renderExtras() {
  const box = $('extras'); box.replaceChildren();
  extraCols.forEach((e, i) => {
    const sel = el('select', {}, ...colOptions(e.col));
    sel.value = e.col;
    if (e.fixed) { // MC number: a standard field with a fixed name
      const mark = okMark(e.col >= 0);
      sel.onchange = () => { e.col = +sel.value; renderExtras(); updatePreview(); };
      box.append(el('div', { className: 'frow' }, el('span', { className: 'flab', textContent: e.label }), sel, mark));
      return;
    }
    const inp = el('input', { className: 'flab-in', placeholder: 'Field name', value: e.label || '' });
    sel.onchange = () => {
      const prevHeader = e.col >= 0 ? String(sheet.headers[e.col]) : '';
      e.col = +sel.value;
      if (!e.label || e.label === prevHeader) { e.label = e.col >= 0 ? String(sheet.headers[e.col]) : ''; inp.value = e.label; }
      updatePreview();
    };
    inp.oninput = () => { e.label = inp.value; updatePreview(); };
    const x = el('button', { type: 'button', className: 'fx', textContent: '✕', title: 'Remove this field' });
    x.onclick = () => { extraCols.splice(i, 1); renderExtras(); updatePreview(); };
    box.append(el('div', { className: 'frow' }, inp, sel, x));
  });
}
const cellText = v => String(v ?? '').trim();
const ccDigits = () => ($('cc').value || '1').replace(/\D/g, '') || '1';
const short = (s, n) => (s.length > n ? s.slice(0, n - 1) + '…' : s);

function fillMappers(map) {
  const cc = ccDigits(), st = sheet.stats;
  const ratio = i => (st[i].filled ? st[i].valid / st[i].filled : 0);
  // Phone: columns that look like phone numbers first
  const ph = $('m-phone');
  const opt = j => el('option', { value: j, textContent: short(String(sheet.headers[j]), 30) + (st[j].sample ? '  ·  ' + short(cleanVal(st[j].sample), 20) : '  ·  (empty)') + (st[j].filled ? `  ·  ${Math.round(ratio(j) * 100)}% numbers` : '') });
  const all = sheet.headers.map((_, j) => j);
  const likely = all.filter(j => st[j].filled && ratio(j) >= 0.5).sort((a, b) => ratio(b) - ratio(a));
  const rest = all.filter(j => !likely.includes(j));
  ph.replaceChildren(el('option', { value: -1, textContent: '— choose a column —' }),
    ...(likely.length ? [el('optgroup', { label: 'Looks like phone numbers' }, ...likely.map(opt))] : []),
    el('optgroup', { label: likely.length ? 'Other columns' : 'All columns' }, ...rest.map(opt)));
  ph.value = map.phone;
  for (const k of ['name', 'company']) { const sel = $('m-' + k); sel.replaceChildren(...colOptions(map[k])); sel.value = map[k]; }
  marks();
}
function marks() {
  for (const k of ['phone', 'name', 'company']) { const m = $('k-' + k); if (m) m.replaceWith(Object.assign(okMark(+$('m-' + k).value >= 0), { id: 'k-' + k })); }
}

const curMap = () => Object.fromEntries(COLS.map(k => [k, +$('m-' + k).value]));

function setHeaderRow(idx) {
  sheet.hdrIdx = idx;
  sheet.headers = Array.from({ length: sheet.width }, (_, i) => idx >= 0 ? (cellText(sheet.raw[idx][i]) || 'Column ' + (i + 1)) : 'Column ' + (i + 1));
  sheet.rows = sheet.raw.slice(idx + 1);
      sheet.stats = sheet.headers.map((_, i) => LeadsUtil.columnStats(sheet.rows, i, ccDigits(), 300));
  // The phone column is suggested (you can change it); everything else is your choice.
  const map = { phone: LeadsUtil.pickPhoneColumn(sheet.headers, sheet.rows, ccDigits()), name: -1, company: -1 };
  fillMappers(map);
  extraCols = [{ col: -1, label: 'MC number', fixed: true }]; renderExtras();
  updatePreview();
}

function updatePreview() {
  const map = curMap();
  const ex = curExtras();
  const { leads, invalid, duplicates, empty, invalidSamples } = LeadsUtil.buildLeads(sheet.rows, map, ccDigits(), ex);
  const picked = document.querySelectorAll('#agentpick input:checked').length;

  // first rows of the file, as they will be imported
  const pv = $('pv'); pv.replaceChildren(el('tr', {}, ['Phone', 'Name', 'Company', ...ex.map(e => e.label)].map(h => el('th', { textContent: h }))));
  for (const r of sheet.rows.filter(r => r.some(v => cellText(v))).slice(0, 6)) {
    const raw = map.phone >= 0 ? cellText(r[map.phone]) : '';
    const n = map.phone >= 0 ? LeadsUtil.extractNumber(raw, ccDigits()) : null;
    pv.append(el('tr', {},
      el('td', { className: n ? 'ok' : 'x', textContent: n || (raw ? '✗ ' + short(raw, 18) : '—') }),
      el('td', { textContent: map.name >= 0 ? short(cleanVal(r[map.name]), 22) : '' }),
      el('td', { textContent: map.company >= 0 ? short(cleanVal(r[map.company]), 22) : '' }),
      ...ex.map(e => el('td', { textContent: short(cleanVal(r[e.col]), 22) }))));
  }

  // Under the file: what will be imported and what is skipped (only once a phone column is chosen)
  const fn = $('filenote');
  if (map.phone >= 0) {
    const parts = [el('span', {}, el('b', { textContent: leads.length.toLocaleString() }), ' numbers ready')];
    if (duplicates) parts.push(el('span', { textContent: `${duplicates.toLocaleString()} duplicates removed` }));
    if (empty) parts.push(el('span', { textContent: `${empty.toLocaleString()} ${empty === 1 ? "row" : "rows"} without a phone` }));
    if (invalid) parts.push(el('span', { textContent: `${invalid.toLocaleString()} not a phone number` + (invalidSamples.length ? ` (e.g. ${invalidSamples.slice(0, 3).map(x => '“' + short(x, 14) + '”').join(', ')})` : '') }));
    fn.replaceChildren(...parts.flatMap((p, i) => (i ? [' · ', p] : [p])));
    fn.className = 'filenote' + (leads.length ? '' : ' bad'); fn.hidden = false;
  } else fn.hidden = true;

  // Agent preview: use the row that fills the most chosen fields, so you can check every mapping
  $('pvempty').hidden = map.phone >= 0; $('pvwrap').hidden = map.phone < 0;
  const card = $('pvcard'); card.replaceChildren();
  if (map.phone >= 0) {
    const fieldsOf = [map.name, map.company, ...ex.map(e => e.col)].filter(i => i >= 0);
    let src = null, best = -1;
    for (const r of sheet.rows.slice(0, 1500)) {
      if (!LeadsUtil.extractNumber(cellText(r[map.phone]), ccDigits())) continue;
      const score = fieldsOf.filter(i => cleanVal(r[i])).length;
      if (score > best) { best = score; src = r; if (score === fieldsOf.length) break; }
    }
    if (src) {
      const v = i => (i >= 0 ? cleanVal(src[i]) : '');
      const number = LeadsUtil.extractNumber(cellText(src[map.phone]), ccDigits());
      const nm = v(map.name), co = v(map.company);
      const title = nm || co || number;
      const init = (nm || co || '#').split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase();
      const rows = ex.map(e => [e.label, v(e.col)]);
      card.append(el('p', { className: 'agentcard-cap', textContent: 'What an agent sees in the dialer' }),
        el('div', { className: 'agentcard' },
          el('div', { className: 'ac-top' }, el('div', { className: 'av', textContent: init || '#' }),
            el('div', {}, el('div', { className: 'n', textContent: title }),
              nm && co ? el('div', { className: 'c', textContent: co }) : null,
              title !== number ? el('div', { className: 'p', textContent: number }) : null)),
          rows.length ? el('div', { className: 'xf' }, rows.map(([l, val]) => el('div', { className: 'xr' }, el('span', { className: 'xl', textContent: l }), el('span', { className: 'xv', textContent: val || '—' })))) : null));
    }
    const stat = (v, l) => el('div', {}, el('b', { textContent: v }), el('span', { textContent: l }));
    card.append(el('div', { className: 'pvstats' },
      stat(leads.length.toLocaleString(), 'numbers to call'), stat(picked && leads.length ? Math.ceil(leads.length / picked).toLocaleString() : '—', picked === 1 ? 'for 1 agent' : `each, for ${picked} agents`)));
  }
  $('preview').hidden = true;
  const btnTxt = map.phone < 0 ? 'Choose the Phone column' : !leads.length ? 'No valid numbers in that column' : !picked ? 'Tick at least one agent' : `Import ${leads.length.toLocaleString()} numbers & assign`;
  $('import').disabled = !leads.length || !picked || map.phone < 0;
  $('import').textContent = btnTxt;
}

async function readFile(file) {
  $('importmsg').replaceChildren();
  let rows, sheetName = 'CSV';
  if (/\.csv$/i.test(file.name)) {
    const wb = XLSX.read(await file.text(), { type: 'string', raw: true }); // raw: keep "0300…" and long numbers as typed
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: '' });
  } else {
    const wb = XLSX.read(await file.arrayBuffer(), { type: 'array' });
    sheetName = wb.SheetNames[0];
    rows = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], { header: 1, raw: false, defval: '' });
  }
  rows = rows.filter(r => r.some(v => cellText(v)));
  if (!rows.length) { alert('That file looks empty.'); return; }
  const width = Math.max(...rows.slice(0, 200).map(r => r.length));
  sheet = { name: file.name, sheetName, raw: rows, width };

  $('mapper').hidden = false;
  $('colsearch').value = '';
  const fi = $('fileinfo'); fi.hidden = false; $('drop').hidden = true;
  const change = el('button', { type: 'button', className: 'btn', textContent: 'Change file', onclick: () => $('file').click() });
  fi.replaceChildren(el('div', { className: 'fi', textContent: (file.name.split('.').pop() || '').toUpperCase().slice(0, 4) }),
    el('div', {}, el('b', { textContent: file.name }), el('p', { className: 'sub', textContent: `${rows.length} rows · ${width} columns` })), change);
  $('listname').value = file.name.replace(/\.[^.]+$/, '');
  $('hdrrow').replaceChildren(
    ...rows.slice(0, 8).map((r, i) => el('option', { value: i, textContent: `Row ${i + 1}: ` + short(r.slice(0, 6).map(v => cellText(v) || '—').join(' | '), 60) })),
    el('option', { value: -1, textContent: 'No header row (data starts on row 1)' }));
  const agents = profiles.filter(p => p.role === 'agent');
  $('agentpick').replaceChildren(...agents.map(p =>
    el('label', {}, el('input', { type: 'checkbox', value: p.id, checked: true, onchange: updatePreview }), p.full_name || p.email)));
  if (!agents.length) $('agentpick').textContent = 'No agents yet. Add them in the Team tab first.';
  const first = LeadsUtil.looksLikeHeader(rows[0]) ? 0 : -1;
  $('hdrrow').value = first;
  setHeaderRow(first);
}

async function doImport() {
  const { leads } = LeadsUtil.buildLeads(sheet.rows, curMap(), ccDigits(), curExtras());
  const agentIds = [...document.querySelectorAll('#agentpick input:checked')].map(i => i.value);
  const name = $('listname').value.trim() || sheet.name;
  const msg = (cls, text) => { $('importmsg').replaceChildren(el('div', { className: 'note ' + cls, textContent: text })); };
  if (!leads.length || !agentIds.length) return;
  if (leads.length > 90000) return msg('err', 'Please split lists larger than 90,000 numbers.');
  $('import').disabled = true;
  try {
    const hdr = k => { const i = curMap()[k]; return i >= 0 && sheet.headers && sheet.headers[i] ? String(sheet.headers[i]).trim() : null; };
    const meta = { name, name_header: hdr('name'), company_header: hdr('company') };
    let list;
    try { [list] = await api('lead_lists', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify(meta) }); }
    catch (e) { // database not upgraded yet: import without the header labels
      [list] = await api('lead_lists', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify({ name }) });
    }
    const base = Math.floor(Date.now() / 1000) * 100000; // later uploads queue after earlier ones
    const rows = LeadsUtil.assign(leads, agentIds, base).map(l => ({ ...l, list_id: list.id }));
    try {
      for (let i = 0; i < rows.length; i += 500) {
        msg('', `Uploading ${Math.min(i + 500, rows.length)} of ${rows.length}…`);
        await api('leads', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify(rows.slice(i, i + 500)) });
      }
    } catch (err) {
      // don't leave a half-imported list behind
      await api('lead_lists?id=eq.' + list.id, { method: 'DELETE', headers: { Prefer: 'return=minimal' } }).catch(() => {});
      throw err;
    }
    msg('ok', `Done. ${rows.length} numbers assigned to ${agentIds.length} agent(s). They'll see them in their dialer within a minute.`);
    $('mapper').hidden = true; sheet = null; $('file').value = '';
    $('import').disabled = true;
    setTimeout(() => go('#/lists'), 1800);
    load();
  } catch (e) {
    msg('err', /extra/i.test(e.message) ? 'Import failed: the database needs one update for extra columns. Run supabase/schema.sql in Supabase (SQL editor), then import again.' : 'Import failed: ' + String(e.message).slice(0, 200));
  }
  $('import').disabled = false;
}

// ---------- agent profile ----------
let profileId = null;
function openAgent(id) { go('#/agent/' + id); }
let prevView = 'agents';
function renderProfile() {
  const p = profiles.find(x => x.id === profileId);
  const box = $('v-agent'); box.replaceChildren();
  const back = el('button', { className: 'btn', textContent: '← Back', onclick: () => go(profileBack || '#/home') });
  // period picker lives in the same row as Back (the main filter bar is hidden on this page)
  const rng = el('select', {}, [...$('range').options].map(o => el('option', { value: o.value, textContent: o.textContent, selected: o.value === $('range').value })));
  rng.onchange = () => { $('range').value = rng.value; load(); };
  const bar = el('div', { className: 'pbar' }, back, el('span', { className: 'sp' }), el('span', { className: 'lbl2', textContent: 'Showing' }), rng);
  if (!p) { box.append(bar, el('div', { className: 'card pad', textContent: 'This person was not found.' })); return; }
  const mine = calls.filter(c => c.agent_id === p.id);
  const n = d => mine.filter(c => c.disposition === d).length;
  const conn = mine.filter(c => Conn.isHuman(c)).length;
  const talk = mine.reduce((x, c) => x + (c.duration_sec || 0), 0);
  const init = (p.full_name || p.email).split(/[\s@.]+/).filter(Boolean).slice(0, 2).map(w => w[0]).join('').toUpperCase();
  const rangeTxt = $('range').options[$('range').selectedIndex].textContent.toLowerCase();

  // header
  box.append(bar, el('div', { className: 'card pad prof' },
    el('div', { className: 'prof-av', textContent: init }),
    el('div', { className: 'prof-main' },
      el('h2', { textContent: p.full_name || p.email }),
      el('div', { className: 'sub', style: 'margin:2px 0 8px' }, p.email, '  ·  ', p.role),
      statusEl(p.id)),
    el('div', { className: 'prof-last' }, el('div', { className: 'sub', textContent: 'Last call' }), el('b', { textContent: mine[0] ? ago(mine[0].started_at) : '—' }))));

  // numbers for the selected period
  const stat = (v, l, c) => el('div', { className: 'kpi', style: `--c:${c}` }, el('div', { className: 'v', textContent: v }), el('div', { className: 'l', textContent: l }));
  box.append(el('h3', { className: 'sec-h', textContent: 'Calling ' + rangeTxt }),
    el('div', { className: 'kpis' },
      stat(mine.length, 'Calls', 'var(--blue)'),
      stat(mine.length ? Math.round(conn / mine.length * 100) + '%' : '—', 'Reached a person', 'var(--green)'),
      stat(n('interested'), 'Interested', '#3257F7'),
      stat(n('callback'), 'Call backs', '#f79009'),
      stat(fmtDur(talk), 'Talk time', 'var(--purple)'),
      stat(conn ? fmtDur(mine.filter(c => Conn.isHuman(c)).reduce((x, c) => x + (c.duration_sec || 0), 0) / conn) : '—', 'Avg conversation', '#98a2b3')));

  box.append(Object.assign(el('div', { style: 'margin-top:16px' }), { innerHTML: Conn.card(Conn.analyse(mine), { title: 'Connectivity', sub: 'Numbers ' + (p.full_name || 'this agent') + ' dialed ' + rangeTxt + ': live lines and real people reached' }) }));

  // results breakdown + lists side by side
  const res = el('table'); res.append(th('Result', 'Calls', 'Share'));
  const counts = DISP.map(([k]) => [k, n(k)]).filter(([, v]) => v).sort((a, b) => b[1] - a[1]);
  for (const [k, v] of counts) res.append(el('tr', {}, el('td', {}, badge(k)), el('td', { className: 'num', textContent: v }), el('td', { className: 'num', textContent: Math.round(v / mine.length * 100) + '%' })));
  if (!counts.length) res.append(el('tr', {}, el('td', { colSpan: 3, className: 'empty', textContent: 'No calls ' + rangeTxt + '.' })));

  const lt = el('table'); lt.append(th('List', 'Numbers', 'Called', 'Left', ''));
  const mineLists = [...new Set(progress.filter(x => x.agent_id === p.id).map(x => x.list_id))];
  for (const id of mineLists) {
    const l = lists.find(x => x.id === id); if (!l) continue;
    const rows = progress.filter(x => x.agent_id === p.id && x.list_id === id);
    const sum = st => rows.filter(r => r.status === st).reduce((a, r) => a + Number(r.n), 0);
    const total = sum('pending') + sum('called') + sum('skipped'), left = sum('pending');
    const tr = el('tr', { className: 'click', title: 'Open list' },
      el('td', {}, el('b', { textContent: l.name }), l.enabled === false ? el('span', { className: 'badge off', style: 'margin-left:6px', textContent: 'Disabled' }) : null),
      el('td', { textContent: total }), el('td', { textContent: total - left }), el('td', { textContent: left }),
      el('td', {}, el('div', { className: 'bar' }, el('i', { style: `width:${total ? Math.round((total - left) / total * 100) : 0}%` }))));
    tr.onclick = () => go(`#/agent/${p.id}/list/${l.id}`);
    lt.append(tr);
  }
  if (!mineLists.length) lt.append(el('tr', {}, el('td', { colSpan: 5, className: 'empty', textContent: 'No lists assigned.' })));
  box.append(el('div', { className: 'prof-grid' },
    el('div', {}, el('h3', { className: 'sec-h', textContent: 'Assigned lists' }), el('div', { className: 'card' }, el('div', { className: 'scroll', style: 'max-height:none' }, lt))),
    el('div', {}, el('h3', { className: 'sec-h', textContent: 'Results' }), el('div', { className: 'card' }, el('div', { className: 'scroll', style: 'max-height:none' }, res)))));

  // every number they dialed, with history
  const nt = el('table'); nt.append(th('Number', 'Name', 'Attempts', 'Interested', 'Answered', 'Voicemail', 'No answer', 'Talk time', 'Last result', 'When'));
  numberRows(mine, nt, 10, false);
  box.append(el('h3', { className: 'sec-h', textContent: 'Numbers dialed ' + rangeTxt + ' · click one for its full history' }),
    el('div', { className: 'card' }, el('div', { className: 'scroll' }, nt)));
}

// ---------- upload page ----------
function resetUpload() {
  sheet = null; extraCols = [];
  $('file').value = ''; $('drop').hidden = false; $('drop').classList.remove('over');
  $('fileinfo').hidden = true; $('mapper').hidden = true; $('filenote').hidden = true;
  $('pvempty').hidden = false; $('pvcard').replaceChildren(); $('preview').hidden = true; $('pvwrap').hidden = true;
  $('import').disabled = true; $('import').textContent = 'Import & assign'; $('importmsg').replaceChildren();
}
function openUpload() {
  resetUpload(); $('pagehead').hidden = true;
  $('lists-main').hidden = true; $('list-detail').hidden = true; $('upload-page').hidden = false;
  window.scrollTo(0, 0);
}
function closeUpload() {
  $('upload-page').hidden = true; $('lists-main').hidden = false;
  load();
}

// ---------- new version check ----------
// Every 60s (and when you come back to the tab) ask the server for version.json, bypassing every cache.
// If it changed: reload straight into the new version (or show a button if you're in the middle of typing/uploading).
let newVersion = null;
async function checkVersion() {
  if (!window.APP_VERSION || location.protocol === 'file:') return;
  try {
    const r = await fetch('version.json?t=' + Date.now(), { cache: 'no-store' });
    if (!r.ok) return;
    const v = String((await r.json()).version || '');
    if (!v || v === window.APP_VERSION) return;
    newVersion = v;
    // already reloaded for this version but the page is still older (index.html not updated / host cache): don't loop
    if (new URLSearchParams(location.search).get('v') === v) return;
    const a = document.activeElement;
    const busyEditing = (a && ['INPUT', 'SELECT', 'TEXTAREA'].includes(a.tagName)) || ($('upload-page') && !$('upload-page').hidden && sheet);
    if (!busyEditing) return goNewVersion();
    $('newver').hidden = false;
  } catch (e) { /* offline: try again later */ }
}
function goNewVersion() {
  // a new address (?v=) makes the browser fetch a fresh page, which then loads the new files
  location.replace(location.pathname + '?v=' + encodeURIComponent(newVersion || Date.now()) + location.hash);
}
setInterval(checkVersion, 60000);
document.addEventListener('visibilitychange', () => { if (!document.hidden) checkVersion(); });
window.addEventListener('focus', checkVersion);

// ---------- boot ----------
async function start() {
  // loading screen on sign-in / refresh only; moving between pages stays instant
  booting = true; $('splash').hidden = false; $('splash').classList.remove('out');
  $('login').hidden = true; $('app').hidden = false;
  try { await route(); await lastLoad; }
  finally {
    booting = false; busy(0);
    $('splash').classList.add('out'); setTimeout(() => { $('splash').hidden = true; }, 350);
  }
  clearInterval(timer);
  timer = setInterval(load, 20000);
}

(function init() {
  $('disp').append(el('option', { value: '', textContent: 'All dispositions' }), ...DISP.map(([k, n]) => el('option', { value: k, textContent: n })));
  // nav items are real links (#/overview, #/calls …): the router handles them
  $('range').onchange = load;
  for (const id of ['agent', 'disp']) $(id).onchange = render;
  $('q').oninput = render;
  $('out').onclick = signOut;
  $('mout').onclick = signOut;
  $('mcsv').onclick = () => { $('nav').classList.remove('open'); $('burger').setAttribute('aria-expanded', 'false'); $('csv').click(); };
  $('burger').onclick = () => { const o = $('nav').classList.toggle('open'); $('burger').setAttribute('aria-expanded', String(o)); };

  $('csv').onclick = () => {
    const q = s => '"' + String(s ?? '').replace(/"/g, '""') + '"';
    const lines = [['time', 'agent', 'number', 'name', 'direction', 'duration_sec', 'auto_disposition', 'disposition', 'set_by', 'notes'].join(',')];
    for (const c of filtered()) lines.push([c.started_at, callAgent(c), c.number, cleanLabel(c.label), c.direction, c.duration_sec, c.auto_disposition, c.disposition, c.disposition_source, c.notes].map(q).join(','));
    const a = el('a', { href: URL.createObjectURL(new Blob([lines.join('\n')], { type: 'text/csv' })), download: 'calls.csv' });
    document.body.append(a); a.click(); a.remove();
  };

  // team
  $('tm-gen').onclick = () => { $('tm-pass').value = randomPassword(); };
  $('tm-add').onclick = addMember;

  // lead upload
  const fail = err => alert('Could not read that file: ' + err.message);
  $('file').onchange = e => { const f = e.target.files[0]; if (f) readFile(f).catch(fail); };
  const drop = $('drop');
  drop.ondragover = e => e.preventDefault();
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readFile(f).catch(fail); };
  $('hdrrow').onchange = () => setHeaderRow(+$('hdrrow').value);
  $('colsearch').oninput = () => { if (sheet) fillMappers(curMap()); };
  for (const k of COLS) $('m-' + k).onchange = () => { marks(); updatePreview(); };
  $('cc').oninput = updatePreview;
  $('cc').onchange = () => { fillMappers(curMap()); updatePreview(); };
  $('import').onclick = doImport;
  $('newver-go').onclick = goNewVersion;
  checkVersion();
  $('addextra').onclick = () => { if (!sheet) return; extraCols.push({ col: -1, label: '' }); renderExtras(); };
  $('addlist').onclick = () => go('#/lists/new');
  $('addclose').onclick = () => go('#/lists');
  drop.ondragenter = () => drop.classList.add('over');
  drop.ondragleave = () => drop.classList.remove('over');
  $('sample').onclick = e => {
    e.preventDefault();
    const csv = 'Phone,Name,Company,MC number,City\n(214) 555-0182,John Carter,Carter Freight,MC123456,Dallas\n512-555-0147,Maria Lopez,Lopez Logistics,MC654321,Austin\n';
    const a = el('a', { href: URL.createObjectURL(new Blob([csv], { type: 'text/csv' })), download: 'sample-leads.csv' });
    document.body.append(a); a.click(); a.remove();
  };

  const doLogin = async () => {
    $('err').textContent = '';
    try {
      store(await authReq('password', { email: $('em').value.trim(), password: $('pw').value }));
      const p = await api('profiles?id=eq.' + session.user.id + '&select=role');
      if (!p[0] || p[0].role !== 'admin') { signOut(); $('err').textContent = 'This account is not an admin. Set its role to admin in the profiles table.'; return; }
      $('pw').value = '';
      start();
    } catch (e) { $('err').textContent = e.message; }
  };
  $('go').onclick = doLogin;
  $('pw').onkeydown = e => { if (e.key === 'Enter') doLogin(); };

  if (session) start().catch(signOut); else $('login').hidden = false;
})();
