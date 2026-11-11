// AI Pilot page + the "AI day so far" card on agent profiles.
// Lists (interested, call backs, conversations, long calls) come straight from call data (no AI used).
// AI writes only: a short summary per recorded call (done once, by the recordings service) and a "day so far"
// summary, which the service caches and only rewrites when new calls came in.
const AIPage = (() => {
  const TZS = [['', 'Your time'], ['Asia/Karachi', 'Pakistan (PKT)'], ['America/New_York', 'US Eastern'], ['America/Chicago', 'US Central'], ['America/Denver', 'US Mountain'], ['America/Los_Angeles', 'US Pacific']];
  const HUMAN = ['interested', 'not_interested', 'callback', 'answered', 'wrong_number', 'do_not_call'];
  let st = { day: 0, tz: '', agent: '', tab: 'interested' };
  try { const h = JSON.parse(localStorage.getItem('tm_home') || '{}'); if (h.tz !== undefined) st.tz = h.tz; Object.assign(st, JSON.parse(localStorage.getItem('tm_ai') || '{}')); } catch (e) { /* private mode */ }
  const save = () => { try { localStorage.setItem('tm_ai', JSON.stringify(st)); } catch (e) { /* ignore */ } };
  let C = null; // helpers from app.js
  let hasAi = true;

  // ---------- dates: a "day" is midnight to midnight on the chosen clock ----------
  const ymd = (d, tz) => new Intl.DateTimeFormat('en-CA', { timeZone: tz || undefined, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d);
  function offsetMin(tz, at) { // minutes the zone is ahead of UTC at instant `at`
    const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz || undefined, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric' }).formatToParts(at).map(x => [x.type, x.value]));
    return (Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour % 24, +p.minute, +p.second) - at.getTime()) / 60000;
  }
  function midnight(dayStr, tz) {
    const [y, m, d] = dayStr.split('-').map(Number);
    let t = Date.UTC(y, m - 1, d);
    t -= offsetMin(tz, new Date(t)) * 60000;
    t -= (offsetMin(tz, new Date(t)) * 60000 - (Date.UTC(y, m - 1, d) - t)); // settle across a DST change
    return new Date(t);
  }
  function dayRange(back, tz) {
    const today = ymd(new Date(), tz);
    const base = new Date(today + 'T12:00:00Z'); base.setUTCDate(base.getUTCDate() - back);
    const d = base.toISOString().slice(0, 10);
    const n = new Date(d + 'T12:00:00Z'); n.setUTCDate(n.getUTCDate() + 1);
    return { from: midnight(d, tz).toISOString(), to: midnight(n.toISOString().slice(0, 10), tz).toISOString(), day: d,
      label: back === 0 ? 'Today' : back === 1 ? 'Yesterday' : new Date(d + 'T12:00:00Z').toLocaleDateString([], { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }) };
  }
  const timeOf = ts => new Date(ts).toLocaleTimeString([], { timeZone: st.tz || undefined, hour: 'numeric', minute: '2-digit' });

  // ---------- data ----------
  const dayCache = new Map(); // key -> { at, rows }
  // The day's calls come from the portal's local copy (no download); only the AI summaries of recorded calls are fetched.
  async function dayCalls(R, agent, fresh) {
    const k = R.from + '|' + (agent || '');
    const c = dayCache.get(k);
    if (c && !fresh && Date.now() - c.at < 60000) return c.rows;
    const dev = new Set(C.profiles.filter(p => p.role === 'developer').map(p => p.id));
    const have = !fresh && C.cachedCalls(R.from); // already in the local copy: no need to ask the database
    const base = (have || await C.loadCalls(R.from)).filter(r => r.started_at < R.to && (!agent || r.agent_id === agent) && !dev.has(r.agent_id));
    let ai = new Map();
    if (hasAi && base.some(r => r.transcript_status)) {
      try {
        const q = `calls?select=id,ai_summary,ai&started_at=gte.${encodeURIComponent(R.from)}&started_at=lt.${encodeURIComponent(R.to)}&transcript_status=not.is.null${agent ? '&agent_id=eq.' + agent : ''}`;
        ai = new Map((await C.fetchAll(q)).map(r => [r.id, r]));
      } catch (e) { if (/ai_summary|column/i.test(e.message)) hasAi = false; else throw e; }
    }
    const rows = base.map(r => (ai.has(r.id) ? { ...r, ai_summary: ai.get(r.id).ai_summary, ai: ai.get(r.id).ai } : r));
    dayCache.set(k, { at: Date.now(), rows });
    return rows;
  }
  const digestCache = new Map();
  async function getDigest(R, agent, force) {
    const k = R.from + '|' + (agent || '');
    const c = digestCache.get(k);
    if (c && !force && Date.now() - c.got < 90000) return c;
    const r = await C.recFetch('/digest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: R.from, to: R.to, agent: agent || undefined, force: !!force }) });
    const j = await r.json().catch(() => ({}));
    if (!r.ok || j.error) throw new Error(j.error || 'HTTP ' + r.status);
    const out = { ...j, got: Date.now() };
    digestCache.set(k, out);
    return out;
  }

  // ---------- grouping (plain data, no AI) ----------
  const isInt = c => c.disposition === 'interested' || (c.ai && c.ai.outcome === 'interested');
  const isCb = c => c.disposition === 'callback' || (c.ai && c.ai.outcome === 'callback');
  const isConv = c => HUMAN.includes(c.disposition) || (c.ai && ['interested', 'callback', 'not_interested', 'other'].includes(c.ai.outcome));
  function groups(rows) {
    const used = new Set(), take = f => rows.filter(c => !used.has(c.id) && f(c)).map(c => (used.add(c.id), c));
    const interested = take(isInt), callbacks = take(isCb);
    const convo = take(c => isConv(c) && (c.duration_sec || 0) >= 45).sort((a, b) => b.duration_sec - a.duration_sec);
    const long = rows.filter(c => (c.duration_sec || 0) >= 180).sort((a, b) => b.duration_sec - a.duration_sec);
    const human = rows.filter(isConv);
    return { interested, callbacks, convo, long, stats: {
      calls: rows.length, conversations: human.length, interested: rows.filter(isInt).length, callbacks: rows.filter(isCb).length,
      talk: human.reduce((s, c) => s + (c.duration_sec || 0), 0), recorded: rows.filter(c => c.transcript_status).length } };
  }

  // ---------- pieces ----------
  const E = (...a) => (C ? C.el : el)(...a); // el() is the portal's helper (app.js)
  function chips(ai) {
    if (!ai) return null;
    const list = [['Call back', ai.callback], ['Trucks', ai.trucks], ['Trailer', ai.equipment], ['Lanes', ai.lanes], ['Rate', ai.rate], ['Next', ai.next]].filter(x => x[1]);
    return list.length ? E('div', { className: 'ai-tags' }, ...list.map(([k, v]) => E('span', {}, E('i', { textContent: k }), String(v)))) : null;
  }
  function summaryCell(c) {
    if (c.ai_summary) return E('td', { className: 'ai-sumcell' }, E('div', { className: 'ai-sum', textContent: c.ai_summary }), chips(c.ai));
    return E('td', { className: 'ai-sumcell' }, E('span', { className: 'ai-none', textContent: c.transcript_status === 'pending' ? 'Summary on its way…' : c.transcript_status ? 'No summary' : 'No recording' }));
  }
  function row(c, opts = {}) {
    const name = C.cleanLabel(c.label);
    const play = c.transcript_status ? E('button', { className: 'recbtn', title: 'Listen and read the transcript', onclick: e => { e.stopPropagation(); C.openRecording(c); } }, E('span', { className: 'tri' }), 'Play') : null;
    const tr = E('tr', { className: c.transcript_status ? 'click' : '' },
      E('td', { className: 'ai-time c-meta', textContent: timeOf(c.started_at) }),
      E('td', { className: 'c-num' }, E('div', { className: 'ai-num', textContent: C.fmtPhone(c.number) }), name ? E('div', { className: 'ai-co', textContent: name }) : null),
      opts.noAgent ? null : E('td', { className: 'c-meta', textContent: C.callAgent(c) }),
      E('td', { className: 'num c-meta', textContent: C.fmtDur(c.duration_sec) }),
      E('td', { className: 'c-res' }, C.badge(c.disposition)),
      summaryCell(c),
      E('td', { className: 'ai-act' }, play));
    if (c.transcript_status) tr.onclick = () => C.openRecording(c);
    return tr;
  }
  function table(list, opts, key, redraw) {
    const t = E('table', { className: 'ai-table' });
    t.append(E('tr', {}, ...['Time', 'Number', opts.noAgent ? null : 'Agent', 'Length', 'Result', 'AI summary', ''].filter(x => x !== null).map(h => E('th', { textContent: h }))));
    const pg = C.paged(key, list);
    if (!list.length) t.append(E('tr', {}, E('td', { colSpan: opts.noAgent ? 6 : 7, className: 'empty', textContent: opts.empty })));
    for (const c of pg.rows) t.append(row(c, opts));
    return E('div', { className: 'card' }, E('div', { className: 'scroll', style: 'max-height:none' }, t), C.pager(key, pg, redraw));
  }
  // The assistant: a soft blue blob that slowly changes shape, with two eyes that blink and follow the pointer.
  const botHtml = (size = '') => `<span class="tmbot ${size}" aria-hidden="true"><span class="tmbot-blob"><span class="tmbot-face"><span class="eye"></span><span class="eye"></span></span></span>${size === 'tiny' || size === 'chat' ? '' : '<span class="tmbot-shadow"></span>'}</span>`;
  function bot(size = '') {
    const t = document.createElement('div'); t.innerHTML = botHtml(size);
    return t.firstElementChild;
  }
  // The "ask the assistant" button (same on every AI card): sparkle + label; while it works it says so.
  const SPARK = '<svg class="ai-spark" viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M12 2.5c.5 4.6 2.9 7 7.5 7.5-4.6.5-7 2.9-7.5 7.5-.5-4.6-2.9-7-7.5-7.5 4.6-.5 7-2.9 7.5-7.5z"/><path d="M19 14.5c.25 2 1.25 3 3.25 3.25-2 .25-3 1.25-3.25 3.25-.25-2-1.25-3-3.25-3.25 2-.25 3-1.25 3.25-3.25z" opacity=".75"/></svg>';
  const askHtml = (title, label = 'Ask for latest updates') => `<button type="button" class="ai-ask" title="${title}">${SPARK}<span class="ai-ask-l" data-l="${label}">${label}</span></button>`;
  function busy(btn, on, label = 'Reading the calls…') {
    if (!btn) return;
    const l = btn.querySelector('.ai-ask-l');
    btn.classList.toggle('busy', on); btn.disabled = on;
    if (l) l.textContent = on ? label : l.dataset.l;
  }
  function follow() {
    if (follow.on) return; follow.on = true;
    addEventListener('pointermove', e => {
      for (const b of document.querySelectorAll('.tmbot')) {
        const r = b.getBoundingClientRect(); if (!r.width) continue;
        const dx = (e.clientX - (r.left + r.width / 2)) / innerWidth, dy = (e.clientY - (r.top + r.height / 2)) / innerHeight;
        b.style.setProperty('--ex', Math.max(-1, Math.min(1, dx * 2.5)).toFixed(3));
        b.style.setProperty('--ey', Math.max(-1, Math.min(1, dy * 2.5)).toFixed(3));
      }
    }, { passive: true });
  }
  // the AI text appears line by line (skipped when the same text is shown again)
  function typeInto(node, text, key) {
    if (node.dataset.k === key) return;
    node.dataset.k = key;
    const lines = String(text).split(/\n+/).map(s => s.trim()).filter(Boolean).map(l => l.replace(/^[-•*]\s*/, ''));
    const ul = E('ul', { className: 'ai-bullets' });
    node.replaceChildren(ul);
    const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
    lines.forEach((l, i) => { const li = E('li', { textContent: l }); if (!reduce) li.style.animationDelay = (i * 0.12) + 's'; ul.append(li); });
  }
  const hello = () => { const h = new Date().getHours(); return h < 5 ? 'Working late' : h < 12 ? 'Good morning' : h < 17 ? 'Good afternoon' : 'Good evening'; };
  const fmtTalk = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
  const thinking = () => E('div', { className: 'ai-think' }, E('i'), E('i', { style: 'width:82%' }), E('i', { style: 'width:64%' }));

  // When there are no calls yet: two short lines, picked at random (20 x 20 combinations), no AI used.
  const QUIET_A = ['No calls have come in yet for this day.', 'It’s quiet so far, no calls on the board yet.', 'I haven’t seen a single call for this day yet.',
    'Nothing to report yet, the phones haven’t started.', 'The call log for this day is still empty.', 'No dialing yet, so there’s nothing for me to read.',
    'All quiet here. No calls have been made yet.', 'I’m watching, but no calls have landed yet.', 'The day hasn’t started on the phones yet.',
    'There are no calls for this period so far.', 'Not a single call logged yet for this day.', 'I don’t have any calls to look at just yet.',
    'The team hasn’t made any calls in this period yet.', 'Zero calls so far, the board is clean.', 'No activity on the lines yet for this day.',
    'I’ve checked, and there are no calls here yet.', 'Calls for this day haven’t started coming in.', 'The phones are still quiet for this period.',
    'Nothing has been dialed yet for this day.', 'I’m ready, but there are no calls to review yet.'];
  const QUIET_B = ['As soon as the first call comes in, I’ll start the briefing.', 'I’ll write your briefing once the calls start.', 'Check back after a few calls and I’ll have something for you.',
    'Once your agents start dialing, I’ll keep you posted here.', 'The moment calls come in, I’ll sum them up for you.', 'Give it a little time and I’ll have updates ready.',
    'I’ll be here, ready to read every call.', 'When the first conversations happen, I’ll tell you how they went.', 'Pick another day above to see an earlier briefing.',
    'Try Yesterday above if you’d like to see the last day of calls.', 'I’ll pick out the interested leads as soon as there are some.', 'Once calls start, I’ll list the call backs for you too.',
    'Press Ask for latest updates any time to check again.', 'Your briefing will appear right here when there’s something to say.', 'I’ll keep an eye on the lines for you.',
    'Let’s check again once the team gets going.', 'I’ll have a fresh summary ready after the first few calls.', 'As calls come in, the lists below will fill up too.',
    'Nothing to worry about, it’s just early.', 'A good time to make sure everyone’s signed in and ready.'];
  const quietPicks = new Map(); // same lines while you look at the same day (the 20-second refresh doesn't change them)
  function quiet(key, noPicker) {
    if (!quietPicks.has(key)) {
      const a = QUIET_A[Math.floor(Math.random() * QUIET_A.length)], bs = noPicker ? QUIET_B.filter(x => !/above/.test(x)) : QUIET_B;
      quietPicks.set(key, a + '\n' + bs[Math.floor(Math.random() * bs.length)]);
    }
    return quietPicks.get(key);
  }

  // ---------- the page ----------
  let pageBox = null, pageToken = 0, last = null;
  const TABS = [['interested', 'Interested'], ['callbacks', 'Call backs'], ['convo', 'Conversations'], ['long', 'Long calls']];
  const EMPTY = { interested: 'No one marked interested yet.', callbacks: 'No call backs requested.', convo: 'No other real conversations of 45+ seconds yet.', long: 'No calls of 3+ minutes yet.' };
  function render(box, ctx) {
    C = ctx; follow();
    if (pageBox !== box || !box.querySelector('.ai-brief')) build(box);
    refresh(false);
  }
  function build(box) {
    pageBox = box;
    const opt = (list, cur) => list.map(([v, t]) => `<option value="${v}"${String(v) === String(cur) ? ' selected' : ''}>${t}</option>`).join('');
    const agents = C.profiles.filter(p => p.role !== 'developer');
    box.innerHTML = `
      <div class="filters ai-filters">
        <select id="ai-day">${opt([[0, 'Today'], [1, 'Yesterday'], [2, '2 days ago']], st.day)}</select>
        <select id="ai-agent">${opt([['', 'Whole team'], ...agents.map(p => [p.id, p.full_name || p.email])], st.agent)}</select>
        <select id="ai-tz" title="Which clock defines a day">${opt(TZS, st.tz)}</select>
      </div>
      <div class="card ai-brief">
        <div class="ai-brief-bot"></div>
        <div class="ai-brief-main">
          <div class="ai-brief-h"><div><div class="ai-hello"></div><div class="ai-when"></div></div><div class="ai-acts"><a class="btn ai-rep" href="#/reports" title="Detailed PDF reports for any day, week or month"><svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg>Download Report</a>${askHtml('The assistant re-reads the newest calls and writes the briefing again')}</div></div>
          <div class="ai-text"></div>
        </div>
      </div>
      <div class="kpis ai-kpis"></div>
      <div class="ai-tabsrow"><div class="seg ai-tabs"></div></div>
      <div class="ai-tablewrap"></div>
      <p class="ai-foot">Summaries are written by AI from call recordings and can be wrong. Listen to the call when it matters.</p>`;
    box.querySelector('.ai-brief-bot').append(bot());
    const set = (k, v) => { st[k] = v; save(); refresh(true); };
    box.querySelector('#ai-day').onchange = e => set('day', +e.target.value);
    box.querySelector('#ai-agent').onchange = e => set('agent', e.target.value);
    box.querySelector('#ai-tz').onchange = e => set('tz', e.target.value);
    box.querySelector('.ai-ask').onclick = () => refresh(true, true);
  }
  function drawTabs() {
    const box = pageBox; if (!box || !last) return;
    const g = last.g, tab = TABS.some(t => t[0] === st.tab) ? st.tab : 'interested';
    box.querySelector('.ai-tabs').replaceChildren(...TABS.map(([k, n]) => E('button', { className: k === tab ? 'on' : '', onclick: () => { st.tab = k; save(); drawTabs(); } }, n, E('span', { className: 'ai-n', textContent: g[k].length }))));
    box.querySelector('.ai-tablewrap').replaceChildren(table(g[tab], { noAgent: !!st.agent, empty: EMPTY[tab] }, 'ai:' + tab, drawTabs));
  }
  async function refresh(fresh, force) {
    const box = pageBox; if (!box) return;
    const my = ++pageToken;
    const R = dayRange(st.day, st.tz);
    const me = C.me();
    box.querySelector('.ai-hello').textContent = `${hello()}${me ? ', ' + me.split(/[\s@]/)[0] : ''}`;
    const textEl = box.querySelector('.ai-text'), whenEl = box.querySelector('.ai-when'), regen = box.querySelector('.ai-ask');
    const botEl = box.querySelector('.tmbot');
    let rows;
    try { rows = await dayCalls(R, st.agent, fresh); }
    catch (e) { if (my === pageToken) box.querySelector('.ai-tablewrap').replaceChildren(E('div', { className: 'note err', textContent: 'Could not load calls: ' + e.message })); return; }
    if (my !== pageToken) return;
    const g = groups(rows), s = g.stats;
    const k = (v, l, c) => E('div', { className: 'kpi', style: '--c:' + c }, E('div', { className: 'v', textContent: v }), E('div', { className: 'l', textContent: l }));
    box.querySelector('.ai-kpis').replaceChildren(k(s.calls, 'Calls', 'var(--blue)'), k(s.conversations, 'Conversations', '#0ba5ec'), k(s.interested, 'Interested', 'var(--green)'),
      k(s.callbacks, 'Call backs', 'var(--amber)'), k(fmtTalk(s.talk), 'Talk time', '#7a5af8'), k(s.recorded, 'Recorded', '#98a2b3'));
    last = { g }; drawTabs();
    const sub = `${st.agent ? C.agentName(st.agent) + '’s brief' : 'Your team brief'} · ${R.label}`;
    if (!s.calls) { whenEl.textContent = sub; const t = quiet('page' + R.from + st.agent); typeInto(textEl, t, 'none' + t); return; } // nothing to read: no AI request at all
    if (!hasAi && !s.recorded) { whenEl.textContent = sub; typeInto(textEl, `${s.calls} calls and ${s.conversations} conversations so far.\nAI briefings start once calls are being recorded.`, 'noai' + R.from); return; }
    botEl && botEl.classList.add('thinking'); busy(regen, true);
    if (!textEl.dataset.k || fresh) { textEl.dataset.k = ''; textEl.replaceChildren(thinking()); }
    whenEl.textContent = sub + ' · reading the calls…';
    try {
      const d = await getDigest(R, st.agent, force);
      if (my !== pageToken) return;
      typeInto(textEl, d.text, R.from + st.agent + d.at);
      whenEl.textContent = sub + (d.at ? ' · updated ' + new Date(d.at).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : '');
    } catch (e) {
      if (my !== pageToken) return;
      whenEl.textContent = sub;
      textEl.dataset.k = ''; textEl.replaceChildren(E('div', { className: 'note err', textContent: 'The AI briefing isn’t available right now (' + e.message + '). The lists below are up to date.' }));
    } finally {
      if (my === pageToken) { botEl && botEl.classList.remove('thinking'); busy(regen, false); }
    }
  }

  // ---------- agent profile card ----------
  const cards = new Map(); // agent id -> element (kept between redraws so it doesn't flicker)
  function agentCard(agentId, ctx) {
    C = ctx; follow();
    let card = cards.get(agentId);
    if (!card) {
      card = E('div', { className: 'card ai-pcard' });
      card.innerHTML = `<div class="ai-brief-h"><div class="ai-pcard-t"><div class="ai-pcard-bot"></div><div><div class="ai-hello">Today so far</div><div class="ai-when"></div></div></div>${askHtml('The assistant re-reads today’s newest calls and writes the summary again')}</div><div class="ai-text"></div><div class="ai-ptable"></div>`;
      card.querySelector('.ai-pcard-bot').append(bot('mini'));
      card.querySelector('.ai-ask').onclick = () => fillCard(card, agentId, true, true);
      cards.set(agentId, card);
    }
    fillCard(card, agentId, false, false);
    return card;
  }
  async function fillCard(card, agentId, fresh, force) {
    const R = dayRange(0, st.tz);
    const textEl = card.querySelector('.ai-text'), regen = card.querySelector('.ai-ask');
    let rows;
    try { rows = await dayCalls(R, agentId, fresh); } catch (e) { textEl.replaceChildren(E('div', { className: 'note err', textContent: 'Could not load today’s calls.' })); return; }
    const g = groups(rows), s = g.stats;
    card.querySelector('.ai-when').textContent = `${s.calls} calls · ${s.conversations} conversations · ${s.interested} interested · ${s.callbacks} call backs · ${fmtTalk(s.talk)} talk`;
    const list = [...g.interested, ...g.callbacks, ...g.convo];
    const redraw = () => card.querySelector('.ai-ptable').replaceChildren(E('div', { className: 'ai-ptitle' }, 'Today’s conversations', E('span', { className: 'ai-n', textContent: list.length })),
      table(list, { noAgent: true, empty: s.calls ? 'No real conversations yet today.' : 'No calls yet today.' }, 'aiagent:' + agentId, redraw));
    redraw();
    if (!s.calls) { const t = quiet('card' + agentId + R.from, true); typeInto(textEl, t, 'none' + t); return; }
    const botEl = card.querySelector('.tmbot');
    botEl && botEl.classList.add('thinking'); busy(regen, true);
    if (!textEl.dataset.k) textEl.replaceChildren(thinking());
    try {
      const d = await getDigest(R, agentId, force);
      typeInto(textEl, d.text, R.from + agentId + d.at);
    } catch (e) { textEl.dataset.k = ''; textEl.replaceChildren(E('div', { className: 'note err', textContent: 'AI summary not available right now.' })); }
    finally { botEl && botEl.classList.remove('thinking'); busy(regen, false); }
  }

  return { render, agentCard, bot, botHtml, askHtml, busy, follow, typeInto, thinking, tz: { ymd, midnight, offsetMin, TZS, current: () => st.tz } };
})();
