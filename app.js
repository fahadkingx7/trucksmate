const $ = id => document.getElementById(id);
const DISP = [['answered','Answered'],['interested','Interested'],['not_interested','Not interested'],['callback','Call back'],['voicemail','Voicemail'],['no_answer','No answer'],['busy','Busy'],['dead_number','Dead number'],['failed','Call failed'],['wrong_number','Wrong number'],['missed','Missed (incoming)'],['cancelled','Cancelled by agent'],['do_not_call','Do not call'],['other','Other']];
const label = k => (DISP.find(d => d[0] === k) || [k, k || '—'])[1];
const ONLINE_SEC = 75; // agents heartbeat roughly every 20s
const VIEWS = ['home', 'agents', 'calls', 'lists', 'numbers', 'interested', 'besttime', 'leaderboard', 'ai', 'team'];
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
const cleanLabel = l => (!l || /^[a-z_]+$/.test(l) || /ongoing call|^calling|ringing|connecting|end call|call ended|^call$|^call with\b|^(?:\+?\d[\s\d()+-]{6,})$/i.test(l.trim())) ? '' : l;
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
// ---------- team roles: agent < moderator < admin < developer ----------
const STAFF = new Set(['moderator', 'admin', 'developer']); // who can use the portal
const ROLES = [['agent', 'Agent'], ['moderator', 'Moderator'], ['admin', 'Admin'], ['developer', 'Developer']];
// developer accounts only appear on the Team page: never in filters, lists of agents or any numbers
const isDev = p => p && p.role === 'developer';
const devIds = () => new Set(profiles.filter(isDev).map(p => p.id));
const myRole = () => { const me = profiles.find(p => session && p.id === session.user.id); return (me && me.role) || 'admin'; };
// can I do `action` (delete / disable / set_password / role) to someone whose role is `target`? (the server checks again)
function canDo(action, target) {
  const me = myRole();
  if (me === 'developer') return true;
  if (me === 'admin') return target !== 'developer';
  if (me === 'moderator') return !['disable', 'enable', 'role'].includes(action) && (target === 'agent' || target === 'moderator');
  return false;
}
const canGive = role => { const me = myRole(); return me === 'developer' || (me === 'admin' && role !== 'developer') || (me === 'moderator' && (role === 'agent' || role === 'moderator')); };

const PAGES = {
  agents: ['Agents', 'Here\u2019s how each of your agents is doing. Tap anyone to open their profile.'],
  calls: ['Calls', 'These are all the calls your team made. If I logged a result wrong, you can fix it right here.'],
  lists: ['Lead lists', 'Upload your numbers here and I\u2019ll share them out between agents and keep track of progress.'],
  numbers: ['Numbers', 'I keep every phone number here once, with every attempt. Tap one to see its whole story.'],
  interested: ['Interested', 'I put the people who showed interest first, then your other real conversations.'],
  besttime: ['Insights', 'I looked through your calls to find when and where people actually pick up.'],
  leaderboard: ['Leaderboard', 'Here\u2019s who\u2019s bringing in the most interested leads.'],
  ai: ['AI Pilot', 'I read every recorded call and put together your briefing, the hot leads and who to call back.'],
  team: ['Team', 'Here you can see everyone on your team, their roles and sign-in details.']
};
// The bot under each page title: says what the page is, plus a quick read of the numbers (plain counting, no AI).
function pageHead(v) {
  const ph = PAGES[v];
  const says = el('div', { className: 'says' });
  says.innerHTML = AIPage.botHtml('chat');
  says.append(el('div', { className: 'says-b' }, el('span', { className: 'says-d', textContent: ph[1] }), el('span', { className: 'says-x' })));
  const acts = v === 'besttime' ? el('div', { className: 'ph-acts' }, Object.assign(el('button', { className: 'btn ph-dl', title: 'Download what this page shows, for the selected period, as a PDF' },
    el('span', { className: 'ph-dli' }), 'Download PDF'), { onclick: insightsPdf })) : null;
  return [el('div', { className: 'crumb', textContent: 'Pages / ' + ph[0] }), el('h1', { textContent: ph[0] }), says, acts].filter(Boolean);
}
function say(text) {
  const x = $('pagehead').querySelector('.says-x'); if (!x || x.textContent === (text || '')) return;
  x.textContent = text || ''; x.classList.remove('in'); void x.offsetWidth; if (text) x.classList.add('in');
}
const rangePhrase = () => ({ today: 'today', all: 'so far', '7': 'in the last 7 days', '30': 'in the last 30 days' })[$('range').value] || 'in this period';
const nf = n => Number(n || 0).toLocaleString();
function pageSummary(v) {
  const rp = rangePhrase(), ag = $('agent').value;
  const filt = ag || (v !== 'agents' && $('disp').value) || $('q').value.trim();
  const mineOnly = a => (ag ? a.filter(c => c.agent_id === ag) : a);
  if (v === 'calls') {
    const r = filtered(), h = r.filter(c => Conn.isHuman(c)).length;
    if (!r.length) return `I don\u2019t see any calls ${filt ? 'matching your filters ' : ''}${rp} yet. They\u2019ll show up here as they come in.`;
    return `I counted ${nf(r.length)} ${r.length === 1 ? 'call' : 'calls'} ${filt ? 'matching your filters ' : ''}${rp}, and ${nf(h)} of them reached a real person.`;
  }
  if (v === 'numbers') {
    const r = filtered(), all = new Set(r.map(c => c.number)), hit = new Set(r.filter(c => Conn.isHuman(c)).map(c => c.number));
    if (!all.size) return `I don\u2019t have any numbers ${filt ? 'matching your filters ' : ''}${rp} yet.`;
    return `You dialed ${nf(all.size)} different ${all.size === 1 ? 'number' : 'numbers'} ${rp}, and I can see you reached a real person on ${nf(hit.size)} of them.`;
  }
  if (v === 'interested') {
    const r = mineOnly(calls), i = new Set(r.filter(c => c.disposition === 'interested').map(c => c.number)).size, cb = new Set(r.filter(c => c.disposition === 'callback').map(c => c.number)).size;
    if (!i && !cb) return `I haven\u2019t found anyone interested ${rp} yet.`;
    return `I found ${nf(i)} ${i === 1 ? 'person' : 'people'} interested ${rp}${cb ? `, and ${nf(cb)} more who asked for a call back` : ''}.`;
  }
  if (v === 'agents') {
    const agents = profiles.filter(p => p.role === 'agent');
    const on = status.filter(s => (Date.now() - new Date(s.last_seen)) / 1000 < ONLINE_SEC && agents.some(p => p.id === s.agent_id)).length;
    const cnt = new Map(); for (const c of calls) cnt.set(c.agent_id, (cnt.get(c.agent_id) || 0) + 1);
    const top = [...cnt].filter(([id]) => agents.some(p => p.id === id)).sort((a, b) => b[1] - a[1])[0];
    return `I can see ${nf(on)} of your ${nf(agents.length)} agents online right now.` + (top ? ` ${agentName(top[0])} has made the most calls ${rp} (${nf(top[1])}).` : '');
  }
  if (v === 'leaderboard') {
    const agents = profiles.filter(p => p.role === 'agent');
    const best = agents.map(p => [p, calls.filter(c => c.agent_id === p.id && c.disposition === 'interested').length]).sort((a, b) => b[1] - a[1])[0];
    if (!best || !best[1]) return `I haven\u2019t seen an interested lead from anyone ${rp} yet.`;
    return `I see ${best[0].full_name || best[0].email} in the lead ${rp}, with ${nf(best[1])} interested ${best[1] === 1 ? 'lead' : 'leads'}.`;
  }
  if (v === 'lists') {
    const wait = progress.filter(r => r.status === 'pending').reduce((x, r) => x + Number(r.n), 0), act = lists.filter(l => l.enabled !== false).length;
    if (!lists.length) return 'You don\u2019t have any lists yet. Once you add one, I\u2019ll share its numbers out between your agents.';
    return `You have ${nf(act)} active ${act === 1 ? 'list' : 'lists'}, and I have ${nf(wait)} ${wait === 1 ? 'number' : 'numbers'} still waiting to be called.`;
  }
  if (v === 'team') {
    const a = profiles.filter(p => p.role === 'agent').length, d = profiles.filter(p => p.role === 'admin' || p.role === 'moderator').length;
    return `I count ${nf(a)} ${a === 1 ? 'agent' : 'agents'} and ${nf(d)} ${d === 1 ? 'person' : 'people'} who manage the team (admins and moderators).`;
  }
  return '';
}
const th = (...h) => el('tr', {}, h.map(x => el('th', { textContent: x })));

// ----- pages of 100 rows for long tables -----
const PAGE = 100, pages = new Map(); // table key -> current page
function paged(key, items) {
  const last = Math.max(1, Math.ceil(items.length / PAGE));
  const p = Math.min(pages.get(key) || 1, last); pages.set(key, p);
  return { rows: items.slice((p - 1) * PAGE, p * PAGE), p, last, total: items.length };
}
// Pager bar: "101–200 of 6,596   ‹ 1 … 3 4 5 … 66 ›". redraw() re-renders the table on the new page.
function pager(key, pg, redraw) {
  const bar = el('div', { className: 'pager' });
  if (pg.total <= PAGE) { bar.hidden = true; return bar; }
  const to = n => {
    pages.set(key, n); redraw();
    const b = document.querySelector(`.pager[data-key="${CSS.escape(key)}"]`), card = b && (b.closest('.card') || b.previousElementSibling);
    if (card) { const sc = card.querySelector('.scroll'); if (sc) sc.scrollTop = 0;
      const y = card.getBoundingClientRect().top + scrollY - 90; if (y < scrollY) scrollTo({ top: y }); }
  };
  bar.dataset.key = key;
  const btn = (txt, n, on, dis) => el('button', { className: 'pg' + (on ? ' on' : ''), textContent: txt, disabled: dis, onclick: () => to(n) });
  const nums = [];
  const want = new Set([1, pg.last, pg.p - 2, pg.p - 1, pg.p, pg.p + 1, pg.p + 2].filter(n => n >= 1 && n <= pg.last));
  let prev = 0;
  for (const n of [...want].sort((a, b) => a - b)) { if (n - prev > 1) nums.push(el('span', { className: 'gap', textContent: '…' })); nums.push(btn(n, n, n === pg.p)); prev = n; }
  const a = (pg.p - 1) * PAGE + 1, b = Math.min(pg.p * PAGE, pg.total);
  bar.append(el('span', { className: 'pinfo', textContent: `${a.toLocaleString()}–${b.toLocaleString()} of ${pg.total.toLocaleString()}` }),
    el('div', { className: 'pbtns' }, btn('‹ Prev', pg.p - 1, false, pg.p === 1), ...nums, btn('Next ›', pg.p + 1, false, pg.p === pg.last)));
  return bar;
}
const setMainPager = (key, pg) => $('tblpager').replaceWith(Object.assign(pager(key, pg, render), { id: 'tblpager' }));

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
  let r;
  try { r = await fetch(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  }); } catch (e) { r = null; }
  if (!r) r = await netFetch(`${CFG.SUPABASE_URL}/auth/v1/token?grant_type=${grant}`, {
    method: 'POST', headers: { apikey: CFG.SUPABASE_ANON_KEY, 'Content-Type': 'application/json' }, body: JSON.stringify(body)
  });
  const text = await r.text();
  let j = {}; try { j = JSON.parse(text); } catch (e) { /* not JSON */ }
  if (!r.ok) { const e = new Error(errText(j, text, r.status)); e.status = r.status; e.auth = r.status >= 400 && r.status < 500; throw e; }
  return j;
}
function store(j) {
  session = { access_token: j.access_token, refresh_token: j.refresh_token,
    expires_at: j.expires_at || Math.floor(Date.now() / 1000) + j.expires_in, user: { id: j.user.id, email: j.user.email } };
  localStorage.setItem('gv_admin_session', JSON.stringify(session));
}
// Sign-ins last until you sign out: the short-lived access key is renewed in the background.
// Several open copies (the installed app + a browser tab) share one sign-in, so only one renews at a time
// and the others pick up its result instead of using an already-spent renewal key (which would sign them out).
const saved = () => { try { return JSON.parse(localStorage.getItem('gv_admin_session') || 'null'); } catch (e) { return null; } };
const fresh = s => s && s.expires_at - 60 > Date.now() / 1000;
let renewing = null;
async function renew() {
  const s0 = saved();
  if (fresh(s0) && session && s0.user && s0.user.id === session.user.id) { session = s0; return; } // another copy already renewed
  try { store(await authReq('refresh_token', { refresh_token: (s0 && s0.refresh_token) || session.refresh_token })); }
  catch (e) {
    const s1 = saved();
    if (fresh(s1)) { session = s1; return; }   // renewed elsewhere meanwhile
    if (e.auth) { signOut('Your sign-in ended. Please sign in again.'); }
    throw e;                                   // network trouble: keep the sign-in and try again later
  }
}
async function token() {
  if (!session) throw new Error('Signed out');
  if (!fresh(session)) {
    if (!renewing) renewing = (navigator.locks ? navigator.locks.request('tm-portal-auth', renew) : renew()).finally(() => { renewing = null; });
    await renewing;
  }
  if (!session) throw new Error('Signed out');
  return session.access_token;
}
window.addEventListener('storage', e => { // signed in / out / renewed in another copy
  if (e.key !== 'gv_admin_session') return;
  const s = saved();
  if (s && session && s.user.id === session.user.id) session = s;
  else if (!s && session) signOut();
});
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
// Supabase sends at most 1000 rows per request. Ask for the total first, then fetch the remaining pages
// 6 at a time instead of one after another (this was most of the loading time).
async function apiPage(path, off, withCount) {
  busy(1);
  try {
    const r = await netFetch(`${CFG.SUPABASE_URL}/rest/v1/${path}&limit=1000&offset=${off}`, {
      headers: { apikey: CFG.SUPABASE_ANON_KEY, Authorization: 'Bearer ' + await token(), ...(withCount ? { Prefer: 'count=exact' } : {}) }
    });
    const t = await r.text();
    if (!r.ok) throw new Error(t || r.status);
    const total = withCount ? parseInt((r.headers.get('content-range') || '').split('/')[1], 10) : NaN;
    return { rows: t ? JSON.parse(t) : [], total: Number.isFinite(total) ? total : null };
  } finally { busy(-1); }
}
async function fetchAll(path, max = 60000) {
  const first = await apiPage(path, 0, true);
  const out = first.rows;
  if (out.length < 1000) return out;
  const total = Math.min(first.total ?? max, max);
  const offs = []; for (let o = 1000; o < total; o += 1000) offs.push(o);
  const pages = new Array(offs.length); let next = 0;
  await Promise.all(Array.from({ length: Math.min(6, offs.length) }, async () => {
    while (next < offs.length) { const k = next++; pages[k] = (await apiPage(path, offs[k], false)).rows; }
  }));
  for (const p of pages) out.push(...p);
  if (first.total == null && out.length % 1000 === 0) { // count unknown: keep going the old way
    for (let off = out.length; off < max; off += 1000) { const r = await apiPage(path, off, false); out.push(...r.rows); if (r.rows.length < 1000) break; }
  }
  return out;
}

// Columns each page needs (smaller downloads than select=*)
const COLS_SLIM = 'id,agent_id,agent_label,number,label,started_at,duration_sec,direction,disposition,auto_disposition,disposition_source';
const COLS_FULL = COLS_SLIM + ',ended_by,notes,list_id,lead_id';
// ---------- calls: one local copy, kept up to date by asking only for what changed ----------
// The first visit downloads the calls for the period on screen once. After that, every refresh asks the database
// "which calls changed since the last time?" (calls.updated_at), which is usually a handful of rows, not thousands.
// The copy is also saved in this browser (IndexedDB), so reopening the portal shows data straight away and only
// fetches the difference. A full re-download happens every 6 hours or when you press Refresh (catches deleted calls).
const CALL_COLS = COLS_FULL + ',transcript_status,updated_at';
const hasRec = true; // the recording columns exist (v8)
const CS = { rows: new Map(), from: undefined, sync: null, full: 0, list: null, loaded: false, dirty: false };
// from: earliest start time the copy covers (null = all time, undefined = nothing yet); sync: newest updated_at seen
const csKey = () => 'calls:' + (session && session.user.id);
const IDB = {
  db: null,
  open() {
    if (this.db) return this.db;
    return (this.db = new Promise((res, rej) => {
      try { const r = indexedDB.open('tm-portal', 1); r.onupgradeneeded = () => r.result.createObjectStore('kv'); r.onsuccess = () => res(r.result); r.onerror = () => rej(r.error); }
      catch (e) { rej(e); }
    }).catch(() => null));
  },
  async get(k) { const db = await this.open(); if (!db) return null; return new Promise(res => { try { const q = db.transaction('kv').objectStore('kv').get(k); q.onsuccess = () => res(q.result || null); q.onerror = () => res(null); } catch (e) { res(null); } }); },
  async set(k, v) { const db = await this.open(); if (!db) return; return new Promise(res => { try { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').put(v, k); t.oncomplete = t.onerror = t.onabort = () => res(); } catch (e) { res(); } }); },
  async clear() { const db = await this.open(); if (!db) return; return new Promise(res => { try { const t = db.transaction('kv', 'readwrite'); t.objectStore('kv').clear(); t.oncomplete = t.onerror = () => res(); } catch (e) { res(); } }); }
};
async function csRestore() {
  if (CS.loaded) return; CS.loaded = true;
  const saved = await IDB.get(csKey());
  if (!saved || saved.v !== 1 || !Array.isArray(saved.rows)) return;
  CS.rows = new Map(saved.rows.map(r => [r.id, r])); CS.from = saved.from; CS.sync = saved.sync; CS.full = saved.full || 0; CS.list = null;
}
let csSaveT = null;
function csSave() {
  clearTimeout(csSaveT);
  csSaveT = setTimeout(() => { if (!session) return; IDB.set(csKey(), { v: 1, rows: [...CS.rows.values()], from: CS.from, sync: CS.sync, full: CS.full }); CS.dirty = false; }, 1500);
}
function csPut(rows) {
  for (const r of rows) {
    if (CS.from && r.started_at < CS.from) continue; // outside the period we keep
    CS.rows.set(r.id, r);
    if (r.updated_at && (!CS.sync || r.updated_at > CS.sync)) CS.sync = r.updated_at;
  }
  if (rows.length) { CS.list = null; CS.dirty = true; }
}
const csq = (extra, order = 'started_at.desc,id.asc') => 'calls?select=' + CALL_COLS + extra + '&order=' + order;
let csBusy = Promise.resolve();
function loadCalls(since) { const run = csBusy.then(() => csEnsure(since)); csBusy = run.catch(() => {}); return run; }
async function csEnsure(since) {
  await csRestore();
  const now = Date.now(), want = since || null; // null = all time
  const covers = CS.from === null || (CS.from !== undefined && want !== null && want >= CS.from);
  if (CS.from === undefined || now - CS.full > 6 * 3600000) {
    // first time (or a periodic clean-up): download the period once, keeping at least what was already covered
    const from = want === null || CS.from === null ? null : (CS.from && CS.from < want ? CS.from : want);
    const rows = await fetchAll(csq(from ? '&started_at=gte.' + encodeURIComponent(from) : ''));
    CS.rows = new Map(); CS.sync = null; CS.from = from; csPut(rows);
    if (!CS.sync) CS.sync = new Date(now - 10 * 60000).toISOString();
    CS.full = now; CS.list = null; csSave();
  } else {
    if (!covers) { // an older period than we have: fetch just the missing part
      const older = await fetchAll(csq((want ? '&started_at=gte.' + encodeURIComponent(want) : '') + '&started_at=lt.' + encodeURIComponent(CS.from)));
      CS.from = want; csPut(older);
    }
    // what changed since last time (a 2-minute overlap so nothing slips between two refreshes)
    const after = new Date(new Date(CS.sync).getTime() - 120000).toISOString();
    csPut(await fetchAll(csq('&updated_at=gte.' + encodeURIComponent(after), 'updated_at.asc')));
    if (CS.dirty) csSave();
  }
  if (!CS.list) CS.list = [...CS.rows.values()].sort((x, y) => (x.started_at < y.started_at ? 1 : x.started_at > y.started_at ? -1 : x.id < y.id ? -1 : 1));
  if (!want) return CS.list;
  const out = []; for (const c of CS.list) { if (c.started_at < want) break; out.push(c); } // newest first, so stop at the cut-off
  return out;
}
// Can this period be shown straight from the copy we already have, without asking the database first?
function csCovers(since) { return CS.list !== null && (CS.from === null || (CS.from !== undefined && !!since && since >= CS.from)); }
function csNow(since) { const out = []; for (const c of CS.list) { if (since && c.started_at < since) break; out.push(c); } return out; }
const csReset = () => { CS.full = 0; }; // next load downloads everything again (Refresh button, after deleting someone)
// an edit made here shows at once, without waiting for the next refresh
function csPatch(id, fields) { const c = CS.rows.get(id); if (c) Object.assign(c, fields); }

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
function signOut(why) {
  session = null; localStorage.removeItem('gv_admin_session');
  IDB.clear(); CS.rows = new Map(); CS.from = undefined; CS.sync = null; CS.full = 0; CS.list = null; CS.loaded = false; // the saved copy of calls leaves with you
  clearInterval(timer); document.title = 'Sign in | TeamLook';
  $('app').hidden = true; $('login').hidden = false; $('splash').hidden = true;
  if (typeof why === 'string' && $('err')) $('err').textContent = why;
}

// ---------- data ----------
function sinceISO() {
  const v = $('range').value;
  if (v === 'all') return null;
  const d = new Date();
  if (v === 'today') d.setHours(0, 0, 0, 0); else d.setDate(d.getDate() - +v);
  return d.toISOString();
}
let listsAt = 0;
async function load() {
  const a = document.activeElement;
  if (a && ['SELECT', 'INPUT'].includes(a.tagName) && (a.closest('table') || a.closest('#best'))) return; // don't clobber an edit
  try {
    const since = sinceISO();
    const jobs = [api('profiles?select=id,email,full_name,role,disabled&order=email'), api('agent_status?select=*')];
    const wantCalls = DATAVIEWS.includes(view), wantLists = ['lists', 'agent', 'home'].includes(view);
    // Home always looks at the last 14 days (today vs yesterday + trends), whatever the period filter says
    const callSince = view === 'home' ? Home.since() : since; // the dashboard has its own period picker
    jobs.push(wantCalls ? loadCalls(callSince) : null);
    const listsDue = wantLists && (view === 'lists' || Date.now() - listsAt > 60000); // lists change rarely: once a minute is plenty elsewhere
    jobs.push(listsDue ? api('lead_lists?select=*&order=created_at.desc') : null, listsDue ? api('rpc/list_progress', { method: 'POST', body: '{}' }).catch(() => []) : null);
    const res = await Promise.all(jobs);
    [profiles, status] = res;
    if (wantCalls) { const dev = devIds(); calls = dev.size ? res[2].filter(c => !dev.has(c.agent_id)) : res[2]; } // a developer's own test calls never count
    if (listsDue) { lists = res[3] || []; progress = res[4] || []; listsAt = Date.now(); }
    fillAgentFilter();
    { const me = profiles.find(p => session && p.id === session.user.id); const ini = ((me && me.full_name) || (session && session.user.email) || 'A').trim()[0].toUpperCase(); $('acct-i').textContent = ini; }
    $('upd').textContent = 'Updated ' + new Date().toLocaleTimeString([], { timeStyle: 'short' });
    $('refresh').classList.remove('err'); $('refresh').title = 'Refresh (last updated ' + new Date().toLocaleTimeString([], { timeStyle: 'short' }) + ')';
    render();
  } catch (e) {
    $('upd').textContent = "Couldn't update"; $('refresh').classList.add('err'); $('refresh').title = String(e.message).slice(0, 300) + '\n\nClick to try again.';
  }
}
function fillAgentFilter() {
  const sel = $('agent'), cur = sel.value;
  sel.replaceChildren(el('option', { value: '', textContent: 'All agents' }),
    ...profiles.filter(p => !isDev(p)).map(p => el('option', { value: p.id, textContent: p.full_name || p.email })));
  sel.value = cur;
}
function filtered() {
  const ag = $('agent').value, d = view === 'agents' ? '' : $('disp').value, q = $('q').value.toLowerCase().trim();
  return calls.filter(c =>
    (!ag || c.agent_id === ag) && (!d || c.disposition === d) &&
    (!q || [c.number, c.label, c.notes, callAgent(c)].join(' ').toLowerCase().includes(q) || (trHits.q === q && trHits.ids.has(c.id))));
}

// ---------- call history helpers ----------
const histCache = new Map();      // number -> calls (all time)
const openNumbers = new Set();    // numbers whose history is expanded in the Numbers tab
const when = ts => new Date(ts).toLocaleString([], { dateStyle: 'short', timeStyle: 'medium' });
// ----- call recordings + transcripts -----
const trHits = { q: '', ids: new Set() }; // calls whose transcript matches the search box
let trTimer = null;
function searchTranscripts() {
  clearTimeout(trTimer);
  const q = $('q').value.toLowerCase().trim();
  if (!hasRec || q.length < 3) { trHits.q = ''; trHits.ids = new Set(); return; }
  trTimer = setTimeout(async () => {
    try {
      const rows = await api('calls?select=id&transcript_text=ilike.' + encodeURIComponent('*' + q.replace(/[*,()]/g, ' ') + '*') + '&limit=2000');
      if ($('q').value.toLowerCase().trim() !== q) return;
      trHits.q = q; trHits.ids = new Set(rows.map(r => r.id)); render();
    } catch (e) { /* search still works on the visible fields */ }
  }, 350);
}
const REC_LABEL = { done: 'Play', pending: 'Play', failed: 'Play' };
function recBtn(c) {
  if (!c || !c.transcript_status || !CFG.REC_URL) return null;
  const b = el('button', { className: 'recbtn', title: c.transcript_status === 'pending' ? 'Recording (transcript on its way)' : 'Listen and read the transcript' },
    el('span', { className: 'tri' }), REC_LABEL[c.transcript_status] || 'Play');
  b.onclick = e => { e.stopPropagation(); openRecording(c); };
  return b;
}
const audioCache = new Map(); // call id -> object URL
// Talk to the recordings service; if the main address can't be reached (e.g. a network still on old DNS), use the backup.
async function recFetch(path, init = {}) {
  let err;
  for (const base of [CFG.REC_URL, CFG.REC_URL_BACKUP].filter(Boolean)) {
    try { return await fetch(base + path, { ...init, headers: { Authorization: 'Bearer ' + await token(), ...(init.headers || {}) } }); }
    catch (e) { err = e; }
  }
  throw err || new Error('Recordings service unreachable');
}
async function openRecording(c) {
  const box = el('div', { className: 'modal' });
  const card = el('div', { className: 'card pad modal-card rec-card' });
  const close = () => { box.remove(); document.removeEventListener('keydown', esc); };
  const esc = e => { if (e.key === 'Escape') close(); };
  document.addEventListener('keydown', esc);
  box.onclick = e => { if (e.target === box) close(); };
  const name = cleanLabel(c.label);
  const audio = el('audio', { controls: true, preload: 'auto', className: 'rec-audio' });
  const status = el('div', { className: 'sub', textContent: 'Loading recording…' });
  const lines = el('div', { className: 'tr-lines' }, el('div', { className: 'sub', textContent: 'Loading transcript…' }));
  const tools = el('div', { className: 'rec-tools' });
  const aiBox = el('div');
  const drawAi = row => {
    if (row.ai_summary) {
      const ai = row.ai || {};
      const list = [['Call back', ai.callback], ['Trucks', ai.trucks], ['Trailer', ai.equipment], ['Lanes', ai.lanes], ['Rate', ai.rate], ['Next', ai.next]].filter(x => x[1]).map(([k, v]) => ['', k + ': ' + v]);
      aiBox.replaceChildren(el('div', { className: 'rec-ai' }, el('span', { className: 'ai-tag', textContent: 'AI summary' }),
        el('p', { className: 'ai-sum', textContent: row.ai_summary }), list.length ? el('div', { className: 'ai-chips' }, ...list.map(([i, t]) => el('span', { textContent: t }))) : null));
    } else if (row.transcript_status === 'done' && row.transcript_text && 'ai_summary' in row) {
      const b = el('button', { className: 'btn', textContent: '✦ Summarize this call' });
      b.onclick = async () => {
        b.disabled = true; b.textContent = 'Summarizing…';
        try { const r = await recFetch(`/summarize/${c.id}`, { method: 'POST' }); const j = await r.json(); if (!r.ok || !j.ai) throw new Error(j.error || 'No summary'); drawAi({ ...row, ai_summary: j.ai.summary, ai: j.ai }); }
        catch (e) { b.disabled = false; b.textContent = '✦ Summarize this call'; aiBox.append(el('div', { className: 'note err', textContent: 'Could not summarize: ' + e.message })); }
      };
      aiBox.replaceChildren(b);
    } else aiBox.replaceChildren();
  };
  card.append(el('div', { className: 'modal-top' },
      el('div', {}, el('h2', { textContent: name || fmtPhone(c.number) }), el('div', { className: 'sub', style: 'margin:2px 0 0', textContent: [name ? fmtPhone(c.number) : '', callAgent(c), when(c.started_at), fmtDur(c.duration_sec)].filter(Boolean).join('  ·  ') })),
      el('button', { className: 'btn', textContent: '✕', onclick: close })),
    audio, status, aiBox, tools, el('h3', { className: 'sec-h', style: 'margin:16px 0 8px', textContent: 'Transcript' }), lines);
  box.append(card); document.body.append(box);

  // audio (only admins can fetch it; the service checks the sign-in)
  (async () => {
    try {
      let url = audioCache.get(c.id);
      if (!url) {
        const r = await recFetch(`/rec/${c.id}`);
        if (!r.ok) { let m = ''; try { m = (await r.json()).error; } catch (e) { /* not JSON */ } throw new Error(m || 'HTTP ' + r.status); }
        url = URL.createObjectURL(await r.blob()); audioCache.set(c.id, url);
      }
      audio.src = url; status.remove();
      const dl = el('a', { className: 'btn', href: url, download: `call-${c.number.replace(/\D/g, '')}-${c.started_at.slice(0, 10)}.webm`, textContent: 'Download audio' });
      tools.prepend(dl);
    } catch (e) { status.className = 'note err'; status.textContent = 'Could not load the recording: ' + e.message; }
  })();

  // transcript
  const drawTranscript = async () => {
    let row;
    try { row = (await api('calls?id=eq.' + c.id + '&select=transcript,transcript_status,transcript_text,ai_summary,ai'))[0] || {}; }
    catch (e) {
      try { row = (await api('calls?id=eq.' + c.id + '&select=transcript,transcript_status,transcript_text'))[0] || {}; } // database without the AI columns
      catch (e2) { lines.replaceChildren(el('div', { className: 'note err', textContent: 'Could not load the transcript: ' + e2.message })); return; }
    }
    drawAi(row);
    c.transcript_status = row.transcript_status;
    tools.querySelectorAll('.tr-act').forEach(x => x.remove());
    if (row.transcript_status === 'pending') {
      lines.replaceChildren(el('div', { className: 'sub', textContent: 'Transcribing… this usually takes under a minute.' }));
      setTimeout(() => { if (box.isConnected) drawTranscript(); }, 8000);
      return;
    }
    if (row.transcript_status !== 'done') {
      const retry = el('button', { className: 'btn tr-act', textContent: 'Try the transcript again' });
      retry.onclick = async () => {
        retry.disabled = true; retry.textContent = 'Transcribing…';
        try { await recFetch(`/transcribe/${c.id}`, { method: 'POST' }); } catch (e) { /* shown on redraw */ }
        drawTranscript();
      };
      tools.append(retry);
      lines.replaceChildren(el('div', { className: 'note err', textContent: "The transcript couldn't be made for this call (the free daily allowance may have run out). You can still listen, or try again later." }));
      return;
    }
    const tr = Array.isArray(row.transcript) ? row.transcript : [];
    if (!tr.length) { lines.replaceChildren(el('div', { className: 'sub', textContent: 'No speech was found in this recording.' })); return; }
    const copy = el('button', { className: 'btn tr-act', textContent: 'Copy transcript' });
    copy.onclick = async () => { try { await navigator.clipboard.writeText(row.transcript_text || ''); copy.textContent = 'Copied'; setTimeout(() => (copy.textContent = 'Copy transcript'), 1500); } catch (e) { /* no clipboard */ } };
    tools.append(copy);
    const who = { agent: callAgent(c) === 'Deleted user' ? 'Agent' : callAgent(c).split(/[\s@]/)[0], caller: name ? name.split(/\s+/)[0] : 'Caller', call: '' };
    const mmss = t => Math.floor(t / 60) + ':' + String(Math.floor(t % 60)).padStart(2, '0');
    const nodes = tr.map(l => {
      const n = el('div', { className: 'tr-line ' + l.s, title: 'Play from here' },
        el('span', { className: 'tr-t', textContent: mmss(l.t || 0) }),
        el('div', {}, who[l.s] ? el('b', { textContent: who[l.s] }) : null, el('p', { textContent: l.x })));
      n.onclick = () => { if (audio.src) { audio.currentTime = l.t || 0; audio.play().catch(() => {}); } };
      return n;
    });
    lines.replaceChildren(...nodes);
    audio.ontimeupdate = () => {
      let cur = -1; tr.forEach((l, i) => { if ((l.t || 0) <= audio.currentTime + 0.2) cur = i; });
      nodes.forEach((n, i) => n.classList.toggle('on', i === cur));
    };
  };
  drawTranscript();
}

// helpers the AI page (ai.js) uses
function aiCtx() {
  return { el, fetchAll, loadCalls, cachedCalls: since => (csCovers(since) ? csNow(since) : null), recFetch, paged, pager, profiles, agentName, callAgent, fmtDur, fmtPhone, cleanLabel, badge, openRecording,
    me: () => { const p = profiles.find(x => session && x.id === session.user.id); return (p && p.full_name) || (session && session.user.email) || ''; } };
}

function histRows(list, cols) {
  if (!list) return [el('tr', { className: 'hist' }, el('td', { colSpan: cols, textContent: 'Loading history…' }))];
  if (!list.length) return [el('tr', { className: 'hist' }, el('td', { colSpan: cols, textContent: 'No calls recorded for this number yet.' }))];
  return [el('tr', { className: 'hist hist-head' }, el('td', { colSpan: cols, textContent: `${list.length} call${list.length > 1 ? 's' : ''} to this number` })),
    ...list.map(c => el('tr', { className: 'hist' }, el('td', { colSpan: cols },
      el('span', { className: 'num', textContent: when(c.started_at) }), '  ·  ', callAgent(c), '  ·  ', fmtDur(c.duration_sec) + ' ', c.ended_by ? el('span', { className: 'sub', textContent: c.ended_by === 'agent' ? ' (agent hung up) ' : ' (other side ended) ' }) : ' ',
      c.auto_disposition && c.auto_disposition !== c.disposition ? [el('span', { className: 'sub', textContent: 'auto: ' }), badge(c.auto_disposition), ' → '] : null,
      badge(c.disposition), el('span', { className: 'sub', textContent: `  (${c.disposition_source})` }),
      c.notes ? el('span', { className: 'sub', textContent: '  “' + c.notes + '”' }) : null, ' ', recBtn(c))))];
}
async function loadHistory(number) {
  const rows = await fetchAll('calls?select=' + CALL_COLS + '&number=eq.' + encodeURIComponent(number) + '&order=started_at.desc,id.asc', 2000);
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
    if (c.transcript_status && (!x.rec || new Date(c.started_at) > new Date(x.rec.started_at))) x.rec = c;
    g.set(c.number, x);
  }
  const all = [...g.values()];
  const hot = all.filter(x => x.best === 'interested').sort((a, b) => b.talk - a.talk);
  const rest = all.filter(x => x.best !== 'interested').sort((a, b) => b.talk - a.talk);
  const t = $('tbl'); t.replaceChildren(th('Number', 'Name', 'Agent', 'Result', 'Talk time', 'Calls', 'Last called', 'Note'));
  const line = x => el('tr', {},
    el('td', { className: 'num', textContent: x.number }), el('td', { textContent: x.name }), el('td', { textContent: callAgent(x.last) }),
    el('td', {}, badge(x.best)), el('td', { className: 'num', textContent: fmtDur(x.talk) }),
    el('td', { textContent: x.calls }), el('td', { textContent: when(x.last.started_at) }), el('td', {}, x.note, x.rec ? [' ', recBtn(x.rec)] : null));
  const sec = txt => el('tr', { className: 'sec' }, el('td', { colSpan: 8, textContent: txt }));
  const items = [...hot.map(x => ({ x, hot: true })), ...rest.map(x => ({ x, hot: false }))];
  const pg = paged('main:interested', items); setMainPager('main:interested', pg);
  const restHead = () => sec('Other conversations, longest talk time first');
  if (pg.p === 1) {
    t.append(sec(`Interested (${hot.length})`));
    if (!hot.length) t.append(el('tr', {}, el('td', { colSpan: 8, className: 'empty', textContent: 'No one marked interested in this period yet.' })));
  }
  pg.rows.forEach((r, i) => { if ((pg.p - 1) * PAGE + i === hot.length) t.append(restHead()); t.append(line(r.x)); });
  if (!rest.length && pg.p === pg.last) t.append(restHead(), el('tr', {}, el('td', { colSpan: 8, className: 'empty', textContent: 'No other answered or call-back numbers.' })));
}

// Insights as a PDF: the same calls and choices as on screen (period, agent, measure, time zone, state)
async function insightsPdf(e) {
  const b = e && e.currentTarget; if (b) { b.disabled = true; b.classList.add('busy'); }
  try {
    const ag = $('agent').value, rows = calls.filter(c => !ag || c.agent_id === ag), u = BestTime.ui;
    const tzMode = { lead: "the lead's local time (from the area code)", you: 'your local time', pk: 'Pakistan time (PKT)' }[u.tz] || 'local time';
    await Reports.insightsPdf(rows, { period: $('range').selectedOptions[0].text, agent: ag ? agentName(ag) : 'All agents', tzMode, tzLabel: { lead: "Lead's local time", you: 'Your time', pk: 'Pakistan time' }[u.tz] || '',
      state: u.state ? BestTime.NAMES[u.state] : '', stateCode: u.state, file: ($('range').value + (ag ? '-' + agentName(ag) : '')).replace(/[^\w-]+/g, '_') }, { ...aiCtx(), api });
  } catch (err) { alert('Could not make the PDF: ' + err.message); }
  finally { if (b) { b.disabled = false; b.classList.remove('busy'); } }
}
function renderBest() {
  const ag = $('agent').value;
  BestTime.render($('best'), calls.filter(c => !ag || c.agent_id === ag), el, renderBest);
}

function renderAgents(rows) {
  const t = $('tbl'); t.replaceChildren(th('Agent', 'Status', 'Calls', 'Numbers', 'Picked up', 'Connectivity', 'Talk time', 'Interested', 'Call backs', 'Answered', 'Voicemail', 'No answer', 'Dead'));
  for (const p of profiles) {
    if (isDev(p)) continue;
    const mine = rows.filter(c => c.agent_id === p.id);
    if (STAFF.has(p.role) && !mine.length) continue; // team leads only show up here if they made calls
    const n = d => mine.filter(c => c.disposition === d).length;
    const tr = el('tr', { className: 'click', title: 'Open ' + (p.full_name || p.email) + "'s profile" },
      el('td', {}, el('b', { className: 'alink', textContent: p.full_name || p.email }), STAFF.has(p.role) ? el('span', { className: 'chip', textContent: p.role }) : null),
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
  const t = $('tbl'); t.replaceChildren(th('Time', 'Agent', 'Number', 'Name', 'Length', 'Recording', 'Ended by', 'Auto result', 'Final disposition', 'Set by', 'Note'));
  if (!rows.length) { t.append(el('tr', {}, el('td', { colSpan: 11, className: 'empty', textContent: 'No calls in this range yet.' }))); return; }
  const pg = paged('main:calls', rows); setMainPager('main:calls', pg);
  for (const c of pg.rows) {
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
      el('td', {}, recBtn(c)),
      el('td', { textContent: c.ended_by === 'agent' ? 'Agent' : c.ended_by === 'remote' ? 'Other side' : '' }),
      el('td', { className: differs ? 'diff' : '' }, c.auto_disposition ? badge(c.auto_disposition) : ''),
      el('td', {}, sel),
      el('td', { className: 'src-' + c.disposition_source, textContent: c.disposition_source }),
      el('td', { textContent: c.notes || '' })));
  }
}

function renderNumbers(rows) {
  const t = $('tbl'); t.replaceChildren(th('Number', 'Name', 'Line', 'Attempts', 'Agents', 'Interested', 'Answered', 'Voicemail', 'No answer', 'Talk time', 'Last result', 'Last called by', 'When'));
  numberRows(rows, t, 13, true, true, 'main:numbers');
}
// One row per number (click for full history). Used by Numbers and the agent profile.
function numberRows(rows, t, cols, withAgents, withLine = false, key = null, redraw = render) {
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
  const pg = paged(key || 'numbers', groups);
  if (key && key.startsWith('main:')) setMainPager(key, pg);
  else if (key) t.pagerBar = pager(key, pg, redraw);
  for (const g of pg.rows) {
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
    const edit = el('button', { className: 'btn', textContent: 'Edit', title: 'Rename the list, add or remove agents' });
    edit.onclick = () => editList(l);
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
      el('td', { className: 'actcell' }, edit, ' ', toggle, ' ', requeue, ' ', del));
    row.onclick = () => go('#/lists/' + l.id);
    for (const b of [edit, requeue, del]) { const f = b.onclick; b.onclick = e => { e.stopPropagation(); return f(e); }; }
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
      fetchAll('calls?select=' + CALL_COLS + '&list_id=eq.' + l.id + only + '&order=started_at.desc,id.asc')
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
  const editB = listAgent ? null : el('button', { className: 'btn', textContent: 'Edit list', onclick: () => editList(l) });
  box.append(back, el('div', { className: 'dtop' }, el('h2', {}, l.name, listAgent ? el('span', { className: 'sub', style: 'font-weight:500;font-size:16px', textContent: '  ·  ' + agentName(listAgent) + "'s numbers" }) : null),
    listAgent && listFrom === 'list' ? el('a', { className: 'link', href: '#/agent/' + listAgent, textContent: 'Open ' + agentName(listAgent) + "'s profile →" }) : null, l.enabled === false ? el('span', { className: 'badge off', textContent: 'Disabled' }) : null, seg, editB, csv));
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
    var pgL = paged('list:' + l.id + ':' + (listAgent || '') + ':numbers', leads);
    for (const x of pgL.rows) {
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
    t.append(th('Time', 'Agent', 'Number', 'Name', 'Length', 'Recording', 'Auto result', 'Final disposition', 'Set by', 'Note'));
    var pgL = paged('list:' + l.id + ':' + (listAgent || '') + ':history', lc);
    for (const c of pgL.rows) t.append(el('tr', {},
      el('td', { textContent: when(c.started_at) }), el('td', { textContent: callAgent(c) }), el('td', { className: 'num', textContent: c.number }),
      el('td', { textContent: cleanLabel(c.label) }), el('td', { className: 'num', textContent: fmtDur(c.duration_sec) }), el('td', {}, recBtn(c)),
      el('td', {}, c.auto_disposition ? badge(c.auto_disposition) : ''), el('td', {}, badge(c.disposition)),
      el('td', { className: 'src-' + c.disposition_source, textContent: c.disposition_source }), el('td', { textContent: c.notes || '' })));
    if (!lc.length) t.append(el('tr', {}, el('td', { colSpan: 10, className: 'empty', textContent: 'No calls have been made on this list yet.' })));
  }
  box.append(el('div', { className: 'card' }, el('div', { className: 'scroll' }, t), pager('list:' + l.id + ':' + (listAgent || '') + ':' + listTab, pgL, () => renderListDetail(l))));
}
// ----- edit a list: rename, add or remove agents -----
// Only numbers nobody has dialed yet move between agents. Dialed numbers (and their history) stay with whoever called them.
const undialed = x => x.status === 'pending' && !((x.attempts || 0) > 0);
// Hand out `pool` (leads, in queue order) one at a time to whoever currently has the fewest waiting numbers.
function spread(pool, counts) {
  const moves = new Map([...counts.keys()].map(k => [k, []]));
  for (const x of pool) {
    let best = null;
    for (const [a, n] of counts) if (best === null || n < counts.get(best)) best = a;
    moves.get(best).push(x.id); counts.set(best, counts.get(best) + 1);
  }
  return moves;
}
function planList(leads, keep) {
  const agentsNow = [...new Set(leads.map(x => x.agent_id))];
  const waiting = new Map(keep.map(a => [a, 0]));
  for (const x of leads) if (undialed(x) && waiting.has(x.agent_id)) waiting.set(x.agent_id, waiting.get(x.agent_id) + 1);
  const removed = agentsNow.filter(a => !keep.includes(a));
  const added = keep.filter(a => !agentsNow.includes(a));
  const queue = leads.filter(undialed).sort((a, b) => (a.position - b.position) || (a.id < b.id ? -1 : 1));
  let pool = queue.filter(x => removed.includes(x.agent_id));
  if (added.length) { // new agents get a fair share: take the excess from agents above the even split
    const total = [...waiting.values()].reduce((s, n) => s + n, 0) + pool.length;
    const target = Math.ceil(total / keep.length);
    for (const a of keep) {
      const mine = queue.filter(x => x.agent_id === a);
      const extra = mine.length - target;
      if (extra > 0) { pool = pool.concat(mine.slice(-extra)); waiting.set(a, target); }
    }
    pool.sort((a, b) => (a.position - b.position) || (a.id < b.id ? -1 : 1));
  }
  return { removed, added, pool, moves: spread(pool, waiting) };
}
async function editList(l) {
  const agents = profiles.filter(p => p.role === 'agent');
  const box = el('div', { className: 'modal' });
  const card = el('div', { className: 'card pad modal-card' });
  box.append(card); document.body.append(box);
  const close = () => box.remove();
  box.onclick = e => { if (e.target === box) close(); };
  card.append(el('div', { className: 'modal-top' }, el('h2', { textContent: 'Edit list' }), el('button', { className: 'btn', textContent: '✕', onclick: close })), el('p', { className: 'sub', textContent: 'Loading…' }));
  let leads;
  try { leads = await fetchAll('leads?select=id,agent_id,status,attempts,position&list_id=eq.' + l.id + '&order=position.asc,id.asc'); }
  catch (e) { card.lastChild.textContent = 'Could not load the list: ' + e.message; return; }
  const per = new Map();
  for (const x of leads) { const a = per.get(x.agent_id) || { dialed: 0, waiting: 0 }; undialed(x) ? a.waiting++ : a.dialed++; per.set(x.agent_id, a); }
  const onList = [...per.keys()].filter(a => per.get(a).waiting > 0); // agents still working the list
  const pick = new Set(onList);
  const name = el('input', { value: l.name, style: 'width:100%;padding:10px 12px;font-size:15px;border:1px solid var(--line);border-radius:10px' });
  const rows = el('div', { className: 'ed-agents' });
  const plan = el('div', { className: 'ed-plan' });
  const save = el('button', { className: 'btn primary', textContent: 'Save changes' });
  const msg = el('div');
  const order = [...new Set([...onList, ...[...per.keys()].filter(a => !onList.includes(a)), ...agents.map(p => p.id)])].filter(id => profiles.some(p => p.id === id));
  const draw = () => {
    rows.replaceChildren(...order.map(id => {
      const a = per.get(id) || { dialed: 0, waiting: 0 };
      const cb = el('input', { type: 'checkbox', checked: pick.has(id) });
      cb.onchange = () => { cb.checked ? pick.add(id) : pick.delete(id); draw(); };
      const was = onList.includes(id), now = pick.has(id);
      const tag = was && !now ? el('span', { className: 'badge off', textContent: 'removing' }) : !was && now ? el('span', { className: 'badge d-answered', textContent: 'adding' }) : null;
      return el('label', { className: 'ed-row' + (now ? '' : ' off') }, cb,
        el('span', { className: 'ed-name' }, el('b', { textContent: agentName(id) }), ' ', tag),
        el('span', { className: 'sub', textContent: a.dialed || a.waiting ? `${a.dialed} dialed · ${a.waiting} waiting` : 'not on this list' }));
    }));
    const keep = [...pick];
    const changed = keep.length !== onList.length || keep.some(a => !onList.includes(a));
    if (!keep.length) { plan.replaceChildren(el('div', { className: 'note err', textContent: 'Keep at least one agent on the list so its waiting numbers have someone to call them.' })); save.disabled = true; return; }
    save.disabled = false;
    if (!changed) { plan.replaceChildren(el('p', { className: 'sub', textContent: 'Untick an agent to take them off this list. Their numbers that haven’t been dialed yet are shared out to the agents who stay. Numbers they already dialed stay with them.' })); return; }
    const p = planList(leads, keep);
    const lines = [...p.moves].filter(([, ids]) => ids.length).map(([a, ids]) => el('li', {}, el('b', { textContent: agentName(a) }), ` gets ${ids.length.toLocaleString()} number${ids.length === 1 ? '' : 's'}`));
    const kept = p.removed.reduce((s, a) => s + (per.get(a) || { dialed: 0 }).dialed, 0);
    plan.replaceChildren(el('div', { className: 'note' },
      el('div', { textContent: p.pool.length ? `${p.pool.length.toLocaleString()} undialed number${p.pool.length === 1 ? '' : 's'} will move:` : 'No undialed numbers need to move.' }),
      lines.length ? el('ul', { style: 'margin:6px 0 0 18px;padding:0' }, ...lines) : null,
      p.removed.length && kept ? el('div', { className: 'sub', style: 'margin-top:6px', textContent: `${kept.toLocaleString()} already-dialed number${kept === 1 ? '' : 's'} stay with ${p.removed.map(agentName).join(', ')} (call history is kept).` }) : null));
  };
  save.onclick = async () => {
    save.disabled = true; save.textContent = 'Saving…'; msg.replaceChildren();
    try {
      const newName = name.value.trim();
      if (newName && newName !== l.name) await api('lead_lists?id=eq.' + l.id, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ name: newName }) });
      const keep = [...pick];
      const changed = keep.length !== onList.length || keep.some(a => !onList.includes(a));
      if (changed) {
        // re-read right before moving, so numbers dialed in the last few seconds are left alone
        leads = await fetchAll('leads?select=id,agent_id,status,attempts,position&list_id=eq.' + l.id + '&order=position.asc,id.asc');
        const p = planList(leads, keep);
        let done = 0;
        for (const [a, ids] of p.moves) for (let i = 0; i < ids.length; i += 150) {
          const part = ids.slice(i, i + 150);
          await api(`leads?id=in.(${part.join(',')})&status=eq.pending&attempts=eq.0`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ agent_id: a }) });
          done += part.length; save.textContent = `Moving… ${done.toLocaleString()} / ${p.pool.length.toLocaleString()}`;
        }
      }
      close();
      await load();
      if (openListId === l.id) { const nl = lists.find(x => x.id === l.id) || l; openList(nl, listAgent, listFrom); }
    } catch (e) {
      msg.replaceChildren(el('div', { className: 'note err', textContent: 'Could not save: ' + e.message }));
      save.disabled = false; save.textContent = 'Save changes';
    }
  };
  card.lastChild.remove();
  card.append(el('label', { className: 'ed-lab', textContent: 'List name' }), name,
    el('label', { className: 'ed-lab', textContent: 'Agents on this list' }), rows, plan, msg,
    el('div', { className: 'ed-foot' }, el('button', { className: 'btn', textContent: 'Cancel', onclick: close }), save));
  draw();
  name.focus();
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
  // the add-member form only offers roles you're allowed to give
  { const sel = $('tm-role'), cur = sel.value;
    sel.replaceChildren(...ROLES.filter(([r]) => canGive(r)).map(([r, n]) => el('option', { value: r, textContent: n })));
    if ([...sel.options].some(o => o.value === cur)) sel.value = cur; }
  const t = $('team'); t.replaceChildren(th('Name', 'Email', 'Role', 'Status', ''));
  const order = { developer: 0, admin: 1, moderator: 2, agent: 3 };
  const rows = [...profiles].sort((x, y) => (order[x.role] ?? 9) - (order[y.role] ?? 9) || (x.full_name || x.email).localeCompare(y.full_name || y.email));
  const act = async (body, done) => { try { await manageUsers(body); if (done) alert(done); load(); } catch (e) { alert(e.message); load(); } };
  for (const p of rows) {
    const self = session && p.id === session.user.id, who = p.full_name || p.email;
    const no = why => ({ disabled: true, title: why });
    const reason = self ? 'This is your own account' : 'Your role can’t do this to a ' + p.role;
    const reset = el('button', { className: 'btn', textContent: 'Reset password', ...(self || canDo('set_password', p.role) ? {} : no(reason)) });
    reset.onclick = async () => {
      const pw = prompt(`New password for ${who} (8+ characters):`);
      if (pw != null) act({ action: 'set_password', id: p.id, password: pw }, 'Password changed. Share it with them.');
    };
    const tog = el('button', { className: 'btn', textContent: p.disabled ? 'Enable' : 'Disable', ...(!self && canDo('disable', p.role) ? {} : no(reason)) });
    tog.onclick = () => {
      if (!p.disabled && !confirm(`Disable ${who}?\n\nThey’re signed out and can’t sign in again until someone enables the account. Their calls stay in your reports.`)) return;
      act({ action: p.disabled ? 'enable' : 'disable', id: p.id });
    };
    const del = el('button', { className: 'btn danger', textContent: 'Delete', ...(!self && canDo('delete', p.role) ? {} : no(reason)) });
    del.onclick = () => {
      if (confirm(`Delete ${who}?\n\nThey can no longer sign in and any numbers still assigned to them are removed. Their logged calls stay in your reports.`)) act({ action: 'delete', id: p.id });
    };
    // role: a dropdown when you may change it, otherwise a label
    let role;
    if (!self && canDo('role', p.role)) {
      role = el('select', { className: 'rolesel r-' + p.role }, ...ROLES.filter(([r]) => canGive(r) || r === p.role).map(([r, n]) => el('option', { value: r, textContent: n, selected: r === p.role })));
      role.onchange = () => {
        if (!confirm(`Make ${who} ${/^[aeiou]/i.test(role.value) ? 'an' : 'a'} ${role.value}?`)) { role.value = p.role; return; }
        act({ action: 'set_role', id: p.id, role: role.value });
      };
    } else role = el('span', { className: 'chip role r-' + p.role, textContent: p.role + (self ? ' (you)' : '') });
    t.append(el('tr', { className: p.disabled ? 'is-off' : '' },
      el('td', {}, Object.assign(el('b', { className: 'alink', textContent: p.full_name || '—', title: 'Open profile' }), { onclick: () => openAgent(p.id) })),
      el('td', { textContent: p.email }),
      el('td', {}, role),
      el('td', {}, p.disabled ? el('span', { className: 'st off', textContent: 'Disabled' }) : statusEl(p.id)),
      el('td', { className: 'nowrap' }, reset, ' ', tog, ' ', del)));
  }
}

function render() {
  if (PAGES[view]) { try { say(pageSummary(view)); } catch (e) { /* the summary is extra; never block the page */ } }
  if (view === 'lists') return renderLists();
  if (view === 'team') return renderTeam();
  if (view === 'besttime') return renderBest();
  if (view === 'leaderboard') return renderBoard();
  if (view === 'agent') return renderProfile();
  if (view === 'ai') return AIPage.render($('v-ai'), aiCtx());
  if (view === 'reports') return Reports.render($('v-reports'), { ...aiCtx(), api });
  if (view === 'home') return Home.render($('v-home'), { calls, profiles, status, lists, progress, label, agentName, callAgent, fmtDur, ago, cleanLabel, ONLINE_SEC,
    onAgent: id => go('#/agent/' + id), onList: id => go('#/lists/' + id), reload: load, me: aiCtx().me(),
    refresh: () => { const b = $('refresh'); b.classList.add('spin'); csReset(); return load().finally(() => b.classList.remove('spin')); } });
  const sig = [view, $('range').value, $('agent').value, $('disp').value, $('q').value.trim()].join('|');
  if (sig !== render.sig) { render.sig = sig; for (const k of [...pages.keys()]) if (k.startsWith('main:')) pages.delete(k); }
  setMainPager('main:none', { total: 0 });
  const rows = filtered();
  $('kpis').className = 'kpis';
  kpis(rows);
  $('kpis').hidden = view !== 'agents';
  $('disp').hidden = view === 'interested' || view === 'agents';
  if (view === 'interested') return renderInterested(calls.filter(c => (!$('agent').value || c.agent_id === $('agent').value) &&
    (!$('q').value.trim() || [c.number, c.label, c.notes, callAgent(c)].join(' ').toLowerCase().includes($('q').value.toLowerCase().trim()))));
  ({ agents: renderAgents, calls: renderCalls, numbers: renderNumbers })[view](rows);
}
let switchTok = 0;
function showCached(v) {
  if (!profiles.length) return false;
  if (['lists', 'agent', 'home'].includes(v) && !listsAt) return false;
  if (DATAVIEWS.includes(v)) {
    const since = v === 'home' ? Home.since() : sinceISO();
    if (!csCovers(since)) return false;
    const dev = devIds(), rows = csNow(since);
    calls = dev.size ? rows.filter(c => !dev.has(c.agent_id)) : rows;
  }
  try { render(); return true; } catch (e) { return false; }
}
function showView(v) {
  const changed = view !== v || !showView.done || (v === 'agent' && showView.pid !== profileId); showView.done = true; showView.pid = profileId;
  if (view !== v && $('agent').value) $('agent').value = ''; // a new page starts with all agents
  view = v;
  // until the new page's data is in, keep the old page out of sight (and show the slim loading bar if it takes a moment)
  if (changed) { const m = document.querySelector('main'); m.classList.add('switching'); m.classList.remove('fadein'); void m.offsetWidth; m.classList.add('fadein'); }
  if (v === 'home') { Home.skeleton($('v-home')); if (changed) Conn.newGreeting(); } // a fresh greeting each time you come to the dashboard
  // browser tab title, e.g. "Calls | TeamLook"
  { const nm = v === 'home' ? 'AI Dashboard' : v === 'reports' ? 'Reports' : v === 'agent' ? ((profiles.find(x => x.id === profileId) || {}).full_name || 'Agent') : (PAGES[v] || [])[0];
    document.title = (nm ? nm + ' | ' : '') + 'TeamLook'; }
  const ph = PAGES[v];
  $('pagehead').hidden = !ph;
  if (ph && $('pagehead').dataset.v !== v) { $('pagehead').replaceChildren(...pageHead(v)); $('pagehead').dataset.v = v; }
  if (v === 'besttime' && $('range').value === 'today') $('range').value = '30'; // today alone is too little data
  for (const k of VIEWS) $('t-' + k).classList.toggle('on', k === v || (k === 'ai' && v === 'reports'));
  const dataView = DATAVIEWS.includes(v);
  $('v-data').hidden = !dataView || ['besttime', 'leaderboard', 'agent', 'home'].includes(v);
  $('v-agent').hidden = v !== 'agent';
  $('v-home').hidden = v !== 'home';
  $('v-best').hidden = v !== 'besttime';
  $('v-lb').hidden = v !== 'leaderboard';
  $('v-ai').hidden = v !== 'ai';
  $('v-reports').hidden = v !== 'reports';
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
  $('csv').hidden = !dataView || ['home', 'agent', 'besttime', 'leaderboard'].includes(v); $('mcsv').hidden = true; // Export CSV now sits next to the filters on every screen size
  // Already have what this page needs? Show it right away and check for anything new in the background.
  if (changed && showCached(v)) { const m = document.querySelector('main'); m.classList.remove('switching'); ++switchTok; document.body.classList.remove('loading'); lastLoad = load(); return; }
  lastLoad = load();
  if (changed) {
    const tok = ++switchTok, bar = setTimeout(() => document.body.classList.add('loading'), 150);
    lastLoad.finally(() => {
      if (tok !== switchTok) return; // a newer page switch took over
      clearTimeout(bar); document.body.classList.remove('loading');
      const m = document.querySelector('main');
      if (m.classList.contains('switching')) { m.classList.remove('switching', 'fadein'); void m.offsetWidth; m.classList.add('fadein'); }
    });
  }
}

// ---------- links for every page (#/overview, #/lists/<id>, #/agent/<id> …) ----------
const SLUG = { home: 'home', agents: 'agents', calls: 'calls', lists: 'lists', numbers: 'numbers', interested: 'interested', besttime: 'insights', leaderboard: 'leaderboard', ai: 'ai', team: 'team', reports: 'reports' };
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
  // names are only needed up front when opening a list or a profile directly; every page load fetches them anyway
  if (!profiles.length && (a === 'agent' || (a === 'lists' && b && b !== 'new'))) { try { profiles = await api('profiles?select=id,email,full_name,role,disabled&order=email'); } catch (err) { /* load() will report */ } }
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
  if (p && view === 'agent') document.title = (p.full_name || p.email) + ' | TeamLook';
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
  box.append(AIPage.agentCard(p.id, aiCtx())); // AI: today so far + today's conversations with summaries

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
  numberRows(mine, nt, 10, false, false, 'agent:' + profileId, renderProfile);
  box.append(el('h3', { className: 'sec-h', textContent: 'Numbers dialed ' + rangeTxt + ' · click one for its full history' }),
    el('div', { className: 'card' }, el('div', { className: 'scroll' }, nt), nt.pagerBar));
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
  $('q').oninput = () => { searchTranscripts(); render(); };
  // Refresh (the installed app has no browser reload button): newest version if there is one, then fresh data.
  const doRefresh = async btn => {
    if (btn.classList.contains('spin')) return;
    btn.classList.add('spin');
    try { csReset(); await checkVersion(); await load(); } finally { setTimeout(() => btn.classList.remove('spin'), 300); }
  };
  AIPage.follow(); // the bots' eyes follow the pointer (incl. the one in the menu)
  // A small loader when a filter change (period, day, time zone, agent…) has to fetch new data. Selects inside tables don't count.
  {
    let inflight = 0, started = 0, timer = null;
    const nf0 = window.fetch;
    window.fetch = function (...a) { inflight++; started++; return nf0.apply(this, a).finally(() => { inflight--; }); };
    document.addEventListener('change', e => {
      const t = e.target;
      if (!t.matches || !t.matches('select, input[type=date]') || t.closest('table, header') || !t.closest('main')) return;
      const s0 = started, t0 = Date.now(); clearInterval(timer);
      timer = setInterval(() => {
        const age = Date.now() - t0, busy = started > s0 && inflight > 0;
        if (busy && age >= 80) document.body.classList.add('loading');
        if ((!busy && age >= 80) || age > 15000) { // finished (or never needed to load)
          if (!document.body.classList.contains('loading') || age >= 350) { clearInterval(timer); document.body.classList.remove('loading'); }
        }
      }, 60);
    }, true);
  }
  $('refresh').onclick = () => doRefresh($('refresh'));
  $('mrefresh').onclick = () => doRefresh($('mrefresh'));
  $('out').onclick = signOut;
  // account menu (top right): who's signed in, version, sign out
  const acctOpen = on => { $('acctmenu').hidden = !on; $('acct').setAttribute('aria-expanded', String(on)); };
  $('acct').onclick = e => {
    e.stopPropagation();
    const email = (session && session.user && session.user.email) || '';
    const me = profiles.find(p => session && p.id === session.user.id);
    const ini = ((me && me.full_name) || email || 'A').trim()[0].toUpperCase();
    $('acct-i').textContent = $('acct-i2').textContent = ini;
    $('acct-email').textContent = (me && me.full_name) ? me.full_name : email;
    $('acct-email').title = email;
    $('acct-sub').textContent = (me && me.full_name ? email + ' · ' : '') + 'Admin';
    $('acct-ver').textContent = 'v' + (window.APP_VERSION || '');
    acctOpen($('acctmenu').hidden);
  };
  document.addEventListener('click', e => { if (!$('acctmenu').hidden && !e.target.closest('.acct')) acctOpen(false); });
  document.addEventListener('keydown', e => { if (e.key === 'Escape') acctOpen(false); });
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
      const p = await api('profiles?id=eq.' + session.user.id + '&select=role,disabled');
      if (!p[0] || !STAFF.has(p[0].role)) { signOut(); $('err').textContent = 'This account doesn’t have portal access. Ask an admin to make it a moderator, admin or developer.'; return; }
      if (p[0].disabled) { signOut(); $('err').textContent = 'This account has been disabled. Ask an admin to enable it.'; return; }
      $('pw').value = '';
      start();
    } catch (e) { $('err').textContent = e.message; }
  };
  $('go').onclick = doLogin;
  $('pw').onkeydown = e => { if (e.key === 'Enter') doLogin(); };
  if (!session) document.title = 'Sign in | TeamLook';

  // A failed first load (slow or blocked network) keeps you signed in; the page retries every 20 seconds.
  if (session) start().catch(e => { if (e && e.auth) signOut('Your sign-in ended. Please sign in again.'); });
  else $('login').hidden = false;
})();

// ----- install as an app (PWA) -----
(() => {
  if ('serviceWorker' in navigator && location.protocol === 'https:') { /* demo: no service worker */ }
  const standalone = matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
  const btns = [$('install'), $('minstall'), $('minstall2')];
  const show = on => btns.forEach(b => b && (b.hidden = !on));
  let deferred = null;
  window.addEventListener('beforeinstallprompt', e => { e.preventDefault(); deferred = e; show(true); });
  window.addEventListener('appinstalled', () => { deferred = null; show(false); });
  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  if (ios && !standalone) show(true); // iPhone/iPad have no install prompt: explain the Share menu instead
  const install = async () => {
    if (deferred) { deferred.prompt(); const r = await deferred.userChoice; if (r.outcome === 'accepted') show(false); deferred = null; return; }
    if (ios) alert('To install on iPhone or iPad: tap the Share button in Safari, then “Add to Home Screen”.');
  };
  btns.forEach(b => b && (b.onclick = install));
})();
