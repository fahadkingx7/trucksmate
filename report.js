// Reports page: pick a period and an agent, download a detailed PDF. A list of every day is there to download too.
// No new AI is used: the PDF is built from call data and rules, plus AI text that already exists
// (each call's saved summary, and the day's saved briefing if one was written).
const Reports = (() => {
  let C = null, box = null;
  const T = () => AIPage.tz;
  let st = { period: 'today', from: '', to: '', agent: '', tz: '' };
  try { st.tz = AIPage.tz.current(); Object.assign(st, JSON.parse(localStorage.getItem('tm_reports') || '{}')); } catch (e) { /* private mode */ }
  const save = () => { try { localStorage.setItem('tm_reports', JSON.stringify(st)); } catch (e) { /* ignore */ } };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const pick = a => a[Math.floor(Math.random() * a.length)];
  const fill = (t, v = {}) => t.replace(/\{(\w+)\}/g, (_, k) => (v[k] ?? ''));
  const HUMAN = new Set(['interested', 'not_interested', 'callback', 'wrong_number', 'do_not_call']);
  const isHuman = c => HUMAN.has(c.disposition) || (c.disposition === 'answered' && (c.disposition_source === 'agent' || c.disposition_source === 'admin'));

  // ---------- periods ----------
  const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['week', 'This week'], ['month', 'This month'], ['custom', 'Custom']];
  const addDay = (d, n) => { const x = new Date(d + 'T12:00:00Z'); x.setUTCDate(x.getUTCDate() + n); return x.toISOString().slice(0, 10); };
  const nice = (d, o = {}) => new Date(d + 'T12:00:00Z').toLocaleDateString([], { timeZone: 'UTC', month: 'short', day: 'numeric', ...o });
  function range(p = st.period, a = st.from, b = st.to) {
    const { ymd, midnight } = T(), tz = st.tz, today = ymd(new Date(), tz);
    let d1, d2;
    if (p === 'today') d1 = d2 = today;
    else if (p === 'yesterday') d1 = d2 = addDay(today, -1);
    else if (p === 'week') { const wd = (new Date(today + 'T12:00:00Z').getUTCDay() + 6) % 7; d1 = addDay(today, -wd); d2 = today; } // Monday to today
    else if (p === 'month') { d1 = today.slice(0, 8) + '01'; d2 = today; }
    else { d1 = a || today; d2 = b || d1; if (d2 < d1) [d1, d2] = [d2, d1]; }
    const day = d1 === d2;
    const label = day ? new Date(d1 + 'T12:00:00Z').toLocaleDateString([], { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })
      : `${nice(d1)} – ${nice(d2, { year: 'numeric' })}`;
    return { d1, d2, day, label, short: day ? nice(d1, { weekday: 'short' }) : `${nice(d1)} – ${nice(d2)}`,
      from: midnight(d1, tz).toISOString(), to: midnight(addDay(d2, 1), tz).toISOString() };
  }

  // ---------- the bot's lines (mixed from parts, so it rarely says the same thing twice) ----------
  const L = {
    open: ['Hey {name}!', 'Hi {name}!', 'Hello {name}!', 'Hey there, {name}!', 'Hi there, {name}!', 'Welcome back, {name}!', 'Good to see you, {name}!'],
    mid: ['I’ve been keeping an eye on every call.', 'I’ve got all your numbers lined up.', 'I watched every call come in.', 'Your team’s calls are all here with me.',
      'I keep a report ready for every single day.', 'I’ve sorted through everything your agents logged.', 'I’ve been listening in on the numbers all day.',
      'I’ve been counting calls while you were away.', 'Every lead and call back is noted down.', 'I know who called whom, and when.', 'The numbers are fresh and ready.',
      'I’ve kept track of every conversation.', 'I spotted a few interesting calls today.', 'Your team has been busy, and I took notes.', 'I’ve lined up the leads and call backs for you.',
      'All the charts are ready to draw.', 'I’ve been watching the team’s progress closely.'],
    ask: ['Which report should I put together?', 'Pick a day or a range and I’ll write it up.', 'Tell me the dates and the agent, I’ll handle the rest.',
      'Want today’s report, or something older?', 'What would you like to review?', 'Choose a period and I’ll build the PDF for you.', 'Where should we start?',
      'Shall I write up today, or look further back?', 'Which agent would you like to look at?', 'Just pick a period and press Download.', 'Ready for a report when you are.',
      'Curious how the week went? I can show you.', 'Want the whole team, or just one agent?', 'Choose the dates and I’ll do the rest.', 'Let me know which day you’d like to see.',
      'Pick what you need and I’ll make it tidy.', 'What should I put in your report today?'],
    today: ['Oh, you need today’s report.', 'Today it is. I’ve been watching it live.', 'Today’s calls so far, got it.', 'Ah, today. Fresh numbers coming up.'],
    yesterday: ['Yesterday’s report, sure.', 'Oh, looking back at yesterday.', 'Yesterday, got it. Let’s see how it went.', 'Ah, yesterday. I remember it well.'],
    week: ['This week’s report, nice choice.', 'The whole week, got it.', 'Oh, you want the week at a glance.', 'This week so far, coming right up.'],
    month: ['The whole month, got it.', 'Oh, a monthly review. I like it.', 'This month so far, sure.', 'A month of calls, let’s see the big picture.'],
    custom: ['A custom range, sure. Pick the start and end dates.', 'Choose your dates and I’ll cover everything in between.', 'Custom dates, got it. Which days?'],
    dates: ['Oh, you need {range}.', '{range}, got it.', 'Ah, {range}. I can do that.', 'Sure, {range} it is.'],
    agent: ['Oh, you’re looking to review {agent}.', 'Let’s see how {agent} did.', 'Focusing on {agent}, got it.', 'Just {agent}’s calls, sure.', 'Ah, {agent}. I’ve been watching their calls too.'],
    all: ['The whole team, got it.', 'Everyone together, sure.', 'All agents, I’ll cover each of them.', 'The full team, coming up.'],
    tail: ['Press Download when you’re ready.', 'It’ll have charts, tables and what needs attention.', 'I’ll include interested leads and call backs.', 'Ready when you are.',
      'Each agent gets their own section.', 'Just say the word and I’ll build it.'],
    day: ['Ah, {date}. Let me pull that day for you.', '{date}? I remember that day. Building it now.', 'Going back to {date}, one moment.', 'Oh, {date}. Coming right up.'],
    work: ['Counting the calls…', 'Drawing the charts…', 'Gathering interested leads and call backs…', 'Checking what needs attention…', 'Writing it all up for you…', 'Almost there…'],
    done: ['Done! Your PDF is downloading.', 'Here you go, {name}. It’s in your downloads.', 'All set. Need another one?', 'Finished. I hope it helps, {name}.', 'There you are, fresh off the press.'],
    empty: ['Hmm, I don’t see any calls in that period.', 'There were no calls then, so there’s nothing to report.', 'That period is empty. Try another one?']
  };
  const meName = () => { const n = String(C.me() || '').split(/[\s@._]/)[0]; return n ? n[0].toUpperCase() + n.slice(1) : 'there'; };
  let typing = null;
  function say(text) {
    const b = box && box.querySelector('.rp-say'); if (!b) return;
    clearInterval(typing);
    const full = fill(text, { name: meName() });
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) { b.textContent = full; return; }
    let i = 0; b.textContent = ''; box.querySelector('.rp-left').classList.add('talking');
    typing = setInterval(() => { i += 2; b.textContent = full.slice(0, i); if (i >= full.length) { clearInterval(typing); box.querySelector('.rp-left').classList.remove('talking'); } }, 16);
  }
  // "Hey Fahad!" stays at the top of the bubble (bold) for the whole visit; only the words under it change
  const greet = () => { const h = box && box.querySelector('.rp-hey'); if (h) h.textContent = fill(pick(L.open), { name: meName() }); say(`${pick(L.mid)} ${pick(L.ask)}`); };

  // ---------- page ----------
  let days = new Map(); // `${tz}|${agent}` -> rows
  function render(b, ctx) {
    C = ctx; AIPage.follow();
    if (box === b && b.querySelector('.rp-wrap')) return; // already built: the 20-second refresh must not reset your choices
    box = b;
    const { TZS } = T();
    const agents = C.profiles.filter(p => p.role !== 'developer');
    const opt = (list, cur) => list.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(cur) ? ' selected' : ''}>${esc(t)}</option>`).join('');
    const today = T().ymd(new Date(), st.tz);
    box.innerHTML = `<div class="rp-wrap">
      <div class="rp-grid">
        <div class="rp-left"><div class="rp-bot"></div><div class="rp-bubble"><b class="rp-hey"></b><span class="rp-say"></span></div></div>
        <div class="rp-right card">
          <div class="rp-h"><div><h2>Reports</h2><p>Detailed PDF reports: overview, charts, each agent, leads and call backs.</p></div>
            <a class="btn" href="#/ai">← AI Pilot</a></div>
          <div class="rp-lbl">Period</div>
          <div class="seg rp-periods">${PERIODS.map(([k, n]) => `<button data-p="${k}"${k === st.period ? ' class="on"' : ''}>${n}</button>`).join('')}</div>
          <div class="rp-custom"${st.period === 'custom' ? '' : ' hidden'}><label>From <input type="date" id="rp-from" max="${today}" value="${esc(st.from || today)}"></label><label>To <input type="date" id="rp-to" max="${today}" value="${esc(st.to || today)}"></label></div>
          <div class="rp-row">
            <label><span class="rp-lbl">Agent</span><select id="rp-agent">${opt([['', 'All agents'], ...agents.map(p => [p.id, p.full_name || p.email])], st.agent)}</select></label>
            <label><span class="rp-lbl">Time zone</span><select id="rp-tz">${opt(TZS, st.tz)}</select></label>
          </div>
          <div class="rp-sum"></div>
          <button class="rp-go btn primary"><svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg><span>Download PDF Report</span></button>
        </div>
      </div></div>`;
    const bot = AIPage.bot(); bot.classList.add('big'); box.querySelector('.rp-bot').append(bot);
    const agentName = id => (C.profiles.find(p => p.id === id) || {}).full_name || 'that agent';
    box.querySelectorAll('.rp-periods button').forEach(bt => bt.onclick = () => {
      st.period = bt.dataset.p; save();
      box.querySelectorAll('.rp-periods button').forEach(x => x.classList.toggle('on', x === bt));
      box.querySelector('.rp-custom').hidden = st.period !== 'custom';
      say(`${pick(L[st.period])} ${st.period === 'custom' ? '' : pick(L.tail)}`.trim()); summary();
    });
    const dates = () => { st.from = box.querySelector('#rp-from').value; st.to = box.querySelector('#rp-to').value; save(); say(`${fill(pick(L.dates), { range: range().short })} ${pick(L.tail)}`); summary(); };
    box.querySelector('#rp-from').onchange = dates; box.querySelector('#rp-to').onchange = dates;
    box.querySelector('#rp-agent').onchange = e => { st.agent = e.target.value; save(); say(`${st.agent ? fill(pick(L.agent), { agent: agentName(st.agent) }) : pick(L.all)} ${pick(L.tail)}`); loadDays(); };
    box.querySelector('#rp-tz').onchange = e => { st.tz = e.target.value; save(); say(`Got it, I’ll count days on ${e.target.selectedOptions[0].text}. ${pick(L.tail)}`); loadDays(); };
    box.querySelector('.rp-go').onclick = () => download(range());
    greet(); loadDays();
  }
  // day totals feed the summary line above the Download button (custom periods use the date pickers)
  async function loadDays() {
    const k = (st.tz || 'local') + '|' + st.agent;
    const tz = st.tz || Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    if (!days.has(k)) {
      try { days.set(k, await C.api('rpc/report_days', { method: 'POST', body: JSON.stringify({ p_tz: tz, p_agent: st.agent || null }) })); }
      catch (e) { days.set(k, []); }
    }
    summary();
  }
  function summary() {
    const el = box && box.querySelector('.rp-sum'); if (!el) return;
    const R = range(), rows = (days.get((st.tz || 'local') + '|' + st.agent) || []).filter(r => r.day >= R.d1 && r.day <= R.d2);
    const n = k => rows.reduce((s, r) => s + Number(r[k] || 0), 0);
    el.innerHTML = `<b>${esc(R.label)}</b><span>${n('calls').toLocaleString()} ${n('calls') === 1 ? 'call' : 'calls'} · ${n('conversations').toLocaleString()} ${n('conversations') === 1 ? 'conversation' : 'conversations'} · ${n('interested')} interested · ${n('callbacks')} ${n('callbacks') === 1 ? 'call back' : 'call backs'}</span>`;
  }

  // ---------- making the report ----------
  let running = false;
  async function download(R, quiet) {
    if (running) return; running = true;
    const btn = box.querySelector('.rp-go'), left = box.querySelector('.rp-left'), bot = box.querySelector('.tmbot');
    const idle = btn.innerHTML; // while it works: a spinner and "Downloading…"
    btn.innerHTML = '<span class="rp-spin" aria-hidden="true"></span><span>Downloading…</span>';
    btn.disabled = true; btn.classList.add('busy'); bot && bot.classList.add('thinking');
    let step = 0; if (!quiet) say(L.work[0]);
    const ticker = setInterval(() => say(L.work[Math.min(++step, L.work.length - 1)]), 1300);
    try {
      await libs();
      const data = await gather(R);
      if (!data.rows.length) { clearInterval(ticker); say(pick(L.empty)); return; }
      const doc = build(R, data);
      const who = st.agent ? '-' + (C.agentName(st.agent) || 'agent').replace(/[^\w]+/g, '_') : '';
      doc.save(`TeamLook-report-${R.d1}${R.day ? '' : '_to_' + R.d2}${who}.pdf`);
      clearInterval(ticker); say(pick(L.done));
    } catch (e) {
      clearInterval(ticker); say('Something went wrong while I was building it: ' + (e.message || e));
      console.error(e);
    } finally {
      clearInterval(ticker); running = false; btn.innerHTML = idle; btn.disabled = false; btn.classList.remove('busy'); bot && bot.classList.remove('thinking'); left && left.classList.remove('talking');
    }
  }
  let libsP = null;
  function libs() {
    if (window.jspdf && window.jspdf.jsPDF && window.jspdf.jsPDF.API.autoTable) return Promise.resolve();
    const load = src => new Promise((res, rej) => { const s = document.createElement('script'); s.src = src + '?v=' + (window.APP_VERSION || ''); s.onload = res; s.onerror = () => rej(new Error('Could not load ' + src)); document.head.append(s); });
    return (libsP = libsP || load('vendor/jspdf.umd.min.js').then(() => load('vendor/jspdf.plugin.autotable.min.js')));
  }
  let logo = null, palm = null;
  const dataUrl = async src => { try { const b = await (await fetch(src)).blob(); return await new Promise(r => { const f = new FileReader(); f.onload = () => r(f.result); f.readAsDataURL(b); }); } catch (e) { return ''; } };
  async function logoData() {
    if (logo === null) [logo, palm] = await Promise.all([dataUrl('logo.png'), dataUrl('palm.png')]);
    return logo;
  }
  // calls for the period: from the portal's local copy, plus the saved AI summaries of recorded calls
  async function gather(R) {
    const dev = new Set(C.profiles.filter(p => p.role === 'developer').map(p => p.id));
    const base = (await C.loadCalls(R.from)).filter(c => c.started_at < R.to && (!st.agent || c.agent_id === st.agent) && !dev.has(c.agent_id));
    let extra = new Map();
    if (base.some(c => c.transcript_status === 'done')) {
      const q = `calls?select=id,ai_summary,ai,transcript_text&started_at=gte.${encodeURIComponent(R.from)}&started_at=lt.${encodeURIComponent(R.to)}&transcript_status=eq.done${st.agent ? '&agent_id=eq.' + st.agent : ''}`;
      try { extra = new Map((await C.fetchAll(q)).map(r => [r.id, r])); } catch (e) { /* summaries are extra */ }
    }
    const rows = base.map(c => (extra.has(c.id) ? { ...c, ...extra.get(c.id) } : c)).sort((a, b) => (a.started_at < b.started_at ? -1 : 1));
    // the day's AI briefing: reused if it's up to date, otherwise written now (one small AI request, then saved for everyone)
    let brief = null;
    if (R.day && rows.length) {
      try { const r = await C.recFetch('/digest', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ from: R.from, to: R.to, agent: st.agent || undefined, forReport: true }) }); const j = await r.json(); if (j && j.text) brief = j; } catch (e) { /* optional */ }
    }
    await logoData();
    return { rows, brief };
  }

  // ---------- numbers ----------
  const tzOpt = () => (st.tz ? { timeZone: st.tz } : {});
  const hourOf = c => +new Intl.DateTimeFormat('en-US', { hour: 'numeric', hourCycle: 'h23', ...tzOpt() }).format(new Date(c.started_at)) % 24;
  const dayOf = c => T().ymd(new Date(c.started_at), st.tz);
  const tm = ts => new Date(ts).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit', ...tzOpt() });
  const dtm = ts => new Date(ts).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', ...tzOpt() });
  const mins = s => { s = Math.round(s || 0); const h = Math.floor(s / 3600), m = Math.round((s % 3600) / 60); return h ? `${h}h ${m}m` : `${m}m`; };
  const mmss = s => { s = Math.round(s || 0); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const pct = (a, b) => (b ? Math.round(a / b * 100) : 0);
  function stats(rows) {
    const n = d => rows.filter(c => c.disposition === d).length;
    const conv = rows.filter(isHuman), cs = Conn.analyse(rows, hourOf);
    const talk = conv.reduce((s, c) => s + (c.duration_sec || 0), 0);
    const per = new Map(); for (const c of rows) per.set(c.number, (per.get(c.number) || 0) + 1);
    // longest break between calls (start of a call to the end of the one before), same day only
    let gap = null;
    for (let i = 1; i < rows.length; i++) {
      const a = rows[i - 1], b = rows[i]; if (dayOf(a) !== dayOf(b)) continue;
      const g = (new Date(b.started_at) - new Date(a.started_at)) / 1000 - (a.duration_sec || 0);
      if (!gap || g > gap.s) gap = { s: g, from: new Date(new Date(a.started_at).getTime() + (a.duration_sec || 0) * 1000).toISOString(), to: b.started_at };
    }
    return { calls: rows.length, numbers: cs.total, conv: conv.length, interested: n('interested'), callbacks: n('callback'), notInt: n('not_interested'),
      dnc: n('do_not_call'), wrong: n('wrong_number'), vm: n('voicemail'), noAns: n('no_answer'), dead: n('dead_number') + n('failed'), cancelled: n('cancelled'),
      talk, avg: conv.length ? talk / conv.length : 0, short: conv.filter(c => (c.duration_sec || 0) < 20).length,
      pickup: cs.pickup, connectivity: cs.connectivity, deadRate: cs.deadRate, vmRate: cs.vmRate, cs,
      repeats: [...per.values()].filter(v => v >= 3).length, first: rows[0] && rows[0].started_at, last: rows.length ? rows[rows.length - 1].started_at : null, gap };
  }
  const score = s => s.interested * 5 + s.callbacks * 3 + s.conv + s.talk / 600;
  const WARN = /\b(angry|anger|rude|argu\w*|yell\w*|shout\w*|upset|frustrat\w*|complain\w*|hung up on|hang up on|threat\w*|curs(e|ed|ing)|swear\w*|abus\w*|insult\w*|harass\w*|lawsuit|sue|report (you|this|the company)|stop calling|don'?t call|do not call|scam\w*|spam\w*|unprofessional|hostile|aggressive)\b/i;
  function warnings(rows) {
    const out = [];
    for (const c of rows) {
      const src = [c.ai_summary, c.transcript_text].filter(Boolean).join('\n');
      const m = src.match(WARN);
      if (m) {
        const i = src.indexOf(m[0]), s = Math.max(0, src.lastIndexOf('\n', i) + 1), e = src.indexOf('\n', i);
        let snip = src.slice(s, e < 0 ? undefined : e).trim(); if (snip.length > 220) snip = snip.slice(Math.max(0, i - s - 90), i - s + 130).trim() + '…';
        out.push({ c, why: `"${m[0]}" came up on this call`, snip });
      } else if (c.disposition === 'do_not_call') out.push({ c, why: 'Asked not to be called again', snip: c.ai_summary || c.notes || '' });
    }
    return out;
  }
  function fixes(s, team) {
    const out = [];
    if (team && team.calls && s.calls < team.avgCalls * 0.5) out.push(`Low activity: ${s.calls} calls against a team average of ${Math.round(team.avgCalls)}.`);
    if (team && s.pickup != null && team.pickup && s.calls >= 30 && s.pickup < team.pickup * 0.7) out.push(`People picked up on ${pct(s.cs.n.human, s.cs.reached)}% of numbers, below the team’s ${Math.round(team.pickup * 100)}%. Calling at better times may help.`);
    if (s.conv >= 8 && team && team.conv && s.interested / s.conv < (team.interested / team.conv) * 0.5) out.push(`Few conversations turned into interest: ${s.interested} of ${s.conv} (${pct(s.interested, s.conv)}%), team ${pct(team.interested, team.conv)}%. Worth reviewing the pitch.`);
    if (s.conv >= 5 && s.avg < 40) out.push(`Conversations are short (about ${mmss(s.avg)} on average). The opening may need work to keep people on the line.`);
    if (s.short >= 5 && s.short / Math.max(1, s.conv) > 0.5) out.push(`${s.short} conversations ended within 20 seconds.`);
    if (s.calls >= 20 && s.cancelled / s.calls > 0.15) out.push(`${s.cancelled} calls (${pct(s.cancelled, s.calls)}%) were cancelled before they rang.`);
    if (s.repeats >= 5) out.push(`${s.repeats} numbers were dialed 3 times or more.`);
    if (s.gap && s.gap.s > 45 * 60) out.push(`A break of ${mins(s.gap.s)} between calls (${tm(s.gap.from)} to ${tm(s.gap.to)}).`);
    if (s.deadRate != null && s.deadRate > 0.3 && s.numbers >= 20) out.push(`${Math.round(s.deadRate * 100)}% of the numbers were dead. That’s the list’s quality, not the agent’s fault.`);
    if (!s.interested && !s.callbacks && s.conv >= 10) out.push(`${s.conv} conversations but no interested leads or call backs yet.`);
    return out;
  }
  function strengths(s, team) {
    const out = [];
    if (s.interested) out.push(`Brought in ${s.interested} interested ${s.interested === 1 ? 'lead' : 'leads'}.`);
    if (s.callbacks) out.push(`Got ${s.callbacks} ${s.callbacks === 1 ? 'person' : 'people'} to ask for a call back.`);
    if (team && s.calls >= team.avgCalls * 1.2 && s.calls >= 50) out.push(`Very active: ${s.calls} calls, above the team average of ${Math.round(team.avgCalls)}.`);
    if (s.conv >= 5 && s.avg >= 90) out.push(`Keeps people talking: about ${mmss(s.avg)} per conversation.`);
    if (team && s.pickup != null && team.pickup && s.calls >= 30 && s.pickup > team.pickup * 1.2) out.push(`Reaches people more often than the team (${Math.round(s.pickup * 100)}% vs ${Math.round(team.pickup * 100)}%).`);
    return out;
  }

  // ---------- the PDF ----------
  const W = 595.28, H = 841.89, M = 42;
  const COL = { blue: [50, 87, 247], blueL: [238, 242, 255], ink: [16, 24, 40], txt: [52, 64, 84], mut: [102, 112, 133], line: [234, 236, 240], soft: [249, 250, 251],
    green: [18, 183, 106], amber: [247, 144, 9], red: [240, 68, 56], purple: [122, 90, 248], grey: [208, 213, 221], sky: [11, 165, 236] };
  // the standard PDF fonts only know Western characters: swap the rest for close matches
  const clean = s => String(s ?? '').replace(/[‘’ʼ]/g, "'").replace(/[“”]/g, '"').replace(/[–—]/g, '-').replace(/[•·]/g, '-').replace(/→/g, ' to ').replace(/…/g, '...')
    .replace(/[^\x09\x0A\x0D\x20-\x7E\xA0-\xFF]/g, '');
  // the bot greets whoever reads the report (a different line each time)
  const HELLO = ['Hey team, I made this report for you. Hope you find it useful!', 'Hi team! Here’s everything I saw on the calls. Hope it helps.',
    'Hey team, I put this together from every call. Enjoy the read!', 'Hello team! I went through all the calls and wrote this up for you.',
    'Hi everyone, here’s your report. I hope it makes the next calls easier.', 'Hey team, I counted every call so you don’t have to. Here’s what I found.',
    'Hi team, your report is ready. I kept it clear and to the point.', 'Hey team! I watched the calls come in and summed it all up here.',
    'Hello everyone, here’s how things went. Hope you find it useful.', 'Hi team, I made this just for you. Let’s see what the calls say.',
    'Hey team, here’s the full picture, page by page. Hope it helps!', 'Hi team! I’ve gathered the numbers, the leads and the call backs for you.',
    'Hey everyone, I wrote this report from your call records. Enjoy!', 'Hello team, I sorted through every call. Here’s what stood out.',
    'Hi team, a fresh report, straight from the calls. Hope it’s useful.', 'Hey team, I’ve done the counting. The highlights are all in here.',
    'Hi everyone! Here’s my report. I hope it helps you plan the next calls.', 'Hey team, I made this report for you with care. Happy reading!',
    'Hello team! Everything that happened on the calls is right here.', 'Hi team, here’s your report. You can get another one any time from the Reports page.'];
  // ---------- PDF drawing kit (shared by the call report and the Insights report) ----------
  let doc = null, y = 0, curDay = true;
  function startDoc(day) { const { jsPDF } = window.jspdf; doc = new jsPDF({ unit: 'pt', format: 'a4' }); y = M; curDay = day; return doc; }
  const set = (size, color = COL.txt, style = 'normal') => { doc.setFont('helvetica', style); doc.setFontSize(size); doc.setTextColor(...color); };
  const need = h => { if (y + h > H - 50) { doc.addPage(); y = M + 18; } };
  const text = (s, x, yy, o) => doc.text(clean(s), x, yy, o);
  const para = (s, size = 10, color = COL.txt, indent = 0) => {
    set(size, color); const lines = doc.splitTextToSize(clean(s), W - 2 * M - indent);
    for (const l of lines) { need(size * 1.45); text(l, M + indent, y); y += size * 1.45; }
  };
  const bullets = (list, color = COL.blue) => {
    for (const s of list) {
      set(10, COL.txt); const lines = doc.splitTextToSize(clean(s), W - 2 * M - 14);
      need(lines.length * 14.5 + 2); doc.setFillColor(...color); doc.circle(M + 3, y - 3.4, 2, 'F');
      lines.forEach((l, i) => text(l, M + 14, y + i * 14.5)); y += lines.length * 14.5 + 3;
    }
  };
  const h1 = s => { need(40); set(17, COL.ink, 'bold'); text(s, M, y + 6); y += 26; };
  const h2b = (s, sub) => { need(110); y += 20; set(12.5, COL.ink, 'bold'); text(s, M, y); const w = doc.getTextWidth(clean(s)); if (sub) { set(9, COL.mut); text(sub, M + w + 8, y); } y += 6; doc.setDrawColor(...COL.line); doc.setLineWidth(0.8); doc.line(M, y, W - M, y); y += 18; };
  const kpis = (list, cols = 5) => {
    const gap = 8, w = (W - 2 * M - gap * (cols - 1)) / cols, h = 50;
    list.forEach((k, i) => {
      if (i % cols === 0) need(h + gap);
      const x = M + (i % cols) * (w + gap), yy = y;
      doc.setFillColor(...COL.soft); doc.setDrawColor(...COL.line); doc.roundedRect(x, yy, w, h, 6, 6, 'FD');
      doc.setFillColor(...(k[2] || COL.blue)); doc.roundedRect(x, yy, w, 3, 1.5, 1.5, 'F');
      set(15, k[2] || COL.ink, 'bold'); text(String(k[0]), x + 9, yy + 25);
      set(8, COL.mut); text(k[1], x + 9, yy + 40);
      if (i % cols === cols - 1 || i === list.length - 1) y += h + gap;
    });
    y += 4;
  };
  const colFit = head => Object.fromEntries(head.map((h, i) => [i, /^number$/i.test(h) ? { cellWidth: 82 } : /^(time|called at)$/i.test(h) ? { cellWidth: curDay ? 52 : 74 } : /^length$/i.test(h) ? { cellWidth: 38 } : null]).filter(x => x[1]));
  const table = (head, body, opts = {}) => {
    need(60);
    doc.autoTable({ startY: y, head: [head.map(clean)], body: body.map(r => r.map(v => clean(v))), margin: { left: M, right: M, top: M + 18, bottom: 50 },
      styles: { font: 'helvetica', fontSize: 8.4, cellPadding: 4.5, textColor: COL.txt, lineColor: COL.line, lineWidth: 0.5, overflow: 'linebreak', valign: 'top' },
      headStyles: { fillColor: COL.blueL, textColor: COL.ink, fontStyle: 'bold', lineWidth: 0 }, alternateRowStyles: { fillColor: [252, 252, 253] },
      rowPageBreak: 'avoid', theme: 'grid', ...opts, columnStyles: { ...colFit(head), ...(opts.columnStyles || {}) } });
    y = doc.lastAutoTable.finalY + 22;
  };
  // vertical bars: [label, value, value2?] stacked green (value) + light blue (value2)
  const bars = (title, data, legend) => {
    const h = 150; need(h + 50); set(10.5, COL.ink, 'bold'); text(title, M, y); y += 12;
    const x0 = M + 26, w = W - 2 * M - 26, y0 = y + h, max = Math.max(1, ...data.map(d => d[1] + (d[2] || 0)));
    const unit = Math.pow(10, Math.floor(Math.log10(max / 4 || 1))), step = [1, 2, 2.5, 5, 10].map(k => Math.max(1, k * unit)).find(k => k * 4 >= max) || Math.ceil(max / 4), top = step * 4;
    set(7, COL.mut);
    for (let i = 0; i <= 4; i++) { const v = step * i, yy = y0 - h * i / 4; doc.setDrawColor(...COL.line); doc.setLineWidth(0.5); doc.line(x0, yy, x0 + w, yy); text(String(Math.round(v)), x0 - 5, yy + 2.5, { align: 'right' }); }
    const bw = w / data.length;
    data.forEach(([l, a, b], i) => {
      const x = x0 + i * bw + bw * 0.18, ww = bw * 0.64, ha = h * a / top, hb = h * (b || 0) / top;
      if (hb) { doc.setFillColor(199, 210, 254); doc.rect(x, y0 - ha - hb, ww, hb, 'F'); }
      if (ha) { doc.setFillColor(...COL.green); doc.rect(x, y0 - ha, ww, ha, 'F'); }
      if (data.length <= 16 || i % 2 === 0) { set(6.8, COL.mut); text(l, x + ww / 2, y0 + 10, { align: 'center' }); }
    });
    y = y0 + 22;
    if (legend) { let lx = M; set(8, COL.txt); for (const [c, t] of legend) { doc.setFillColor(...c); doc.rect(lx, y - 6, 8, 8, 'F'); text(t, lx + 12, y + 1); lx += doc.getTextWidth(t) + 32; } y += 16; }
    y += 26; // room before the next section
  };
  // horizontal bars: [label, value, color]
  const hbars = (title, data) => {
    const rowH = 17; need(30 + data.length * rowH); if (title) { set(10.5, COL.ink, 'bold'); text(title, M, y); y += 14; }
    const max = Math.max(1e-9, ...data.map(d => d[1])), lw = 150, bwMax = W - 2 * M - lw - 70;
    for (const [l, v, c, shown] of data) {
      set(8.6, COL.txt); text(l, M, y + 9);
      doc.setFillColor(...COL.soft); doc.rect(M + lw, y, bwMax, 11, 'F');
      doc.setFillColor(...c); doc.rect(M + lw, y, Math.max(1, bwMax * v / max), 11, 'F');
      set(8.6, COL.ink, 'bold'); text(String(shown ?? v), M + lw + bwMax + 6, y + 9); y += rowH;
    }
    y += 22;
  };
  function finishDoc(top, foot) {
    const n = doc.getNumberOfPages();
    for (let i = 1; i <= n; i++) {
      doc.setPage(i);
      if (i > 1) { set(8, COL.mut); text(top, M, M - 8); doc.setDrawColor(...COL.line); doc.setLineWidth(0.6); doc.line(M, M - 2, W - M, M - 2); }
      credit(H - 24); set(7.5, [152, 162, 179]); text(`${i} / ${n}`, W - M, H - 24, { align: 'right' });
    }
    return doc;
  }
  // footer credit, centred, like the website: "TrucksMate AI Pilot · Developed by [palm] veefivee" (veefivee links to veefivee.com)
  function credit(yy) {
    const a1 = 'TeamLook AI Pilot', a2 = 'Developed by', b = 'veefivee', sep = 12, ip = palm ? 10 : 0;
    set(8, COL.mut); const w1 = doc.getTextWidth(a1), w2 = doc.getTextWidth(a2); set(10, [40, 35, 64], 'bold'); const wb = doc.getTextWidth(b);
    const x0 = (W - (w1 + sep + w2 + 4 + ip + 1 + wb)) / 2;
    set(8, COL.mut); text(a1, x0, yy);
    doc.setFillColor(...COL.grey); doc.circle(x0 + w1 + sep / 2, yy - 2.6, 1.1, 'F');
    text(a2, x0 + w1 + sep, yy);
    const xp = x0 + w1 + sep + w2 + 4;
    if (palm) { try { doc.addImage(palm, 'PNG', xp, yy - 8.6, 10, 10); } catch (e) { /* no image */ } }
    set(10, [40, 35, 64], 'bold'); text(b, xp + ip + 1, yy + 0.4);
    doc.link(xp, yy - 10, ip + 1 + wb, 13, { url: 'https://veefivee.com' });
  }
  // the bot (blue blob with two white eyes) next to its line, on the left, then some room below
  function botNote(line) {
    need(70); y += 22;
    let size = 11; set(size, COL.txt); let tw = doc.getTextWidth(clean(line));
    while (tw > W - 2 * M - 30 && size > 8.5) { size -= 0.5; set(size, COL.txt); tw = doc.getTextWidth(clean(line)); }
    const r = size * 0.62, gap = 8, x0 = M, cy = y - size * 0.34; // left, in line with the page
    doc.setFillColor(50, 87, 247); doc.ellipse(x0 + r, cy, r, r * 0.94, 'F');
    doc.setFillColor(255, 255, 255); doc.ellipse(x0 + r - r * 0.33, cy - r * 0.08, r * 0.16, r * 0.27, 'F'); doc.ellipse(x0 + r + r * 0.33, cy - r * 0.08, r * 0.16, r * 0.27, 'F');
    text(line, x0 + r * 2 + gap, y);
    y += 34;
  }
  function cover(title, sub, right) {
    doc.setFillColor(...COL.blue); doc.rect(0, 0, W, 6, 'F');
    if (palm) { try { doc.addImage(palm, 'PNG', M, y - 2, 24, 24); } catch (e) { /* no image */ } }
    set(19, [40, 35, 64], 'bold'); text('veefivee', M + 25, y + 17);
    set(8.5, COL.mut); text(`Generated ${new Date().toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`, W - M, y + 8, { align: 'right' });
    if (right) text(right, W - M, y + 20, { align: 'right' });
    y += 50; set(22, COL.ink, 'bold'); text(title, M, y); y += 20;
    set(11.5, COL.mut); text(sub, M, y); y += 22;
  }
  function build(R, { rows, brief }) {
    startDoc(R.day);
    const when = ts => (R.day ? tm(ts) : dtm(ts));
    const lname = c => C.cleanLabel(c.label) || '-';
    const who = c => C.agentName(c.agent_id) || c.agent_label || '-';
    const team = stats(rows);
    const agentsAll = C.profiles.filter(p => p.role === 'agent' && !p.disabled);
    const ids = st.agent ? [st.agent] : [...new Set([...agentsAll.map(p => p.id), ...rows.map(c => c.agent_id)])];
    const per = ids.map(id => ({ id, name: C.agentName(id) || 'Agent', rows: rows.filter(c => c.agent_id === id) })).map(a => ({ ...a, s: stats(a.rows) }));
    const active = per.filter(a => a.s.calls), absent = per.filter(a => !a.s.calls);
    const teamRef = { ...team, avgCalls: active.length ? team.calls / active.length : 0 };
    const single = !!st.agent, name = single ? per[0].name : 'Whole team';

    // ----- cover / overview -----
    cover(R.day ? 'Daily call report' : 'Call report', `${R.label}  ·  ${name}`, st.tz ? (AIPage.tz.TZS.find(z => z[0] === st.tz) || [0, st.tz])[1] : 'Local time');
    const s = team;
    kpis([[s.calls.toLocaleString(), 'Calls'], [s.numbers.toLocaleString(), 'Numbers dialed'], [s.conv, 'Conversations', COL.sky], [s.interested, 'Interested', COL.green], [s.callbacks, 'Call backs', COL.amber],
      [mins(s.talk), 'Talk time', COL.purple], [s.connectivity == null ? '-' : Math.round(s.connectivity * 100) + '%', 'Live numbers'], [s.pickup == null ? '-' : Math.round(s.pickup * 100) + '%', 'Person picked up', COL.green],
      [s.vmRate == null ? '-' : Math.round(s.vmRate * 100) + '%', 'Went to voicemail', COL.purple], [s.deadRate == null ? '-' : Math.round(s.deadRate * 100) + '%', 'Dead numbers', COL.red]]);
    botNote(pick(HELLO));
    h2b('Overview');
    if (brief && brief.text) {
      y += 2; set(8.5, COL.mut); need(20); text(`AI briefing, saved ${new Date(brief.at).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' })}`, M, y); y += 17;
      bullets(String(brief.text).split(/\n+/).map(l => l.replace(/^[-•*]\s*/, '').trim()).filter(Boolean), COL.purple); y += 4;
    }
    y += 6; set(8.5, COL.mut); need(20); text('From the call records', M, y); y += 17;
    // the dashboard talks to "you"; a report is about the team (or the agent), so reword those lines
    const subject = single ? per[0].name : 'The team';
    bullets(Conn.explain(s.cs, '').map(h => h.replace(/<[^>]+>/g, '').replace(/^You dialed/, `${subject} dialed`).replace(/\byour lists\b/g, 'the lists').replace(/\(your time\)/g, '(local time)')));
    if (!single) {
      const top = [...active].sort((a, b) => score(b.s) - score(a.s));
      if (top.length) bullets([`Most interested leads: ${[...active].sort((a, b) => b.s.interested - a.s.interested)[0].name}. Most calls: ${[...active].sort((a, b) => b.s.calls - a.s.calls)[0].name}. Most talk time: ${[...active].sort((a, b) => b.s.talk - a.s.talk)[0].name}.`]);
    }
    // ----- charts (the same pictures are reused on each agent's page) -----
    const hrsOf = list => { const u = list.map(hourOf); return u.length ? [Math.min(...u), Math.max(...u)] : [8, 18]; };
    const daysOf = () => { const l = []; for (let d = R.d1; d <= R.d2; d = addDay(d, 1)) l.push(d); return l; };
    const hl = h => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
    function callsChart(list, title) {
      const leg = [[COL.green, 'Reached a person'], [[199, 210, 254], 'No conversation']];
      if (R.day) { const [a, b] = hrsOf(rows); const hs = []; for (let h = a; h <= b; h++) hs.push(h);
        bars(title || 'Calls per hour', hs.map(h => { const r = list.filter(c => hourOf(c) === h), k = r.filter(isHuman).length; return [hl(h), k, r.length - k]; }), leg); }
      else bars(title || 'Calls per day', daysOf().map(d => { const r = list.filter(c => dayOf(c) === d), k = r.filter(isHuman).length; return [nice(d), k, r.length - k]; }), leg);
    }
    // share of calls that reached a person, per hour (or per day); slots with fewer than 3 calls are left at 0
    function pickupChart(list, title) {
      const rate = r => { const n = r.filter(c => c.disposition !== 'cancelled'); return n.length >= 3 ? Math.round(n.filter(isHuman).length / n.length * 100) : 0; };
      if (R.day) { const [a, b] = hrsOf(rows); const hs = []; for (let h = a; h <= b; h++) hs.push(h);
        bars(title || 'Pick-up rate by hour (% of calls that reached a person)', hs.map(h => [hl(h), rate(list.filter(c => hourOf(c) === h)), 0])); }
      else bars(title || 'Pick-up rate by day (% of calls that reached a person)', daysOf().map(d => [nice(d), rate(list.filter(c => dayOf(c) === d)), 0]));
    }
    function outcomes(list, x, title) {
      hbars(title, [['Interested', x.interested, COL.green], ['Call back', x.callbacks, COL.amber], ['Not interested', x.notInt, [249, 112, 102]],
        ['Answered (other)', list.filter(c => c.disposition === 'answered').length, COL.sky], ['Voicemail', x.vm, COL.purple], ['No answer', x.noAns, COL.grey],
        ['Dead / failed', x.dead, COL.red], ['Wrong number / DNC', x.wrong + x.dnc, [180, 35, 24]], ['Cancelled before ringing', x.cancelled, [152, 162, 179]]].filter(v => v[1]));
    }
    callsChart(rows);
    pickupChart(rows);
    outcomes(rows, s, 'What happened on the calls');

    // ----- team -----
    if (!single) {
      h2b('Team performance', 'ranked by interested, call backs, conversations');
      const ranked = [...active].sort((a, b) => score(b.s) - score(a.s));
      table(['#', 'Agent', 'Calls', 'Numbers', 'Convers.', 'Interested', 'Call backs', 'Talk', 'Avg conv.', 'Picked up', 'First / last call'],
        ranked.map((a, i) => [i + 1, a.name, a.s.calls, a.s.numbers, a.s.conv, a.s.interested, a.s.callbacks, mins(a.s.talk), mmss(a.s.avg), a.s.pickup == null ? '-' : Math.round(a.s.pickup * 100) + '%', R.day ? `${tm(a.s.first)} - ${tm(a.s.last)}` : `${dtm(a.s.first)} - ${dtm(a.s.last)}`]),
        { columnStyles: { 0: { cellWidth: 18 }, 1: { fontStyle: 'bold' } } });
      if (ranked.length > 1) {
        hbars('Calls by agent', ranked.map(a => [a.name, a.s.calls, COL.blue, `${a.s.calls} calls · ${a.s.conv} conv.`]));
        hbars('Leads by agent (interested + call backs)', ranked.map(a => [a.name, a.s.interested + a.s.callbacks, COL.green, `${a.s.interested} int. · ${a.s.callbacks} cb`]));
        hbars('Talk time by agent', ranked.map(a => [a.name, a.s.talk, COL.purple, mins(a.s.talk)]));
        hbars('Pick-up rate by agent', ranked.map(a => [a.name, a.s.pickup || 0, COL.sky, a.s.pickup == null ? '-' : Math.round(a.s.pickup * 100) + '%']));
      }
      if (ranked.length) {
        h2b('Top performers');
        const nTop = ranked.length === 1 ? 1 : Math.min(3, Math.ceil(ranked.length / 2)), nLow = Math.min(2, ranked.length - nTop);
        bullets(ranked.slice(0, nTop).map(a => `${a.name}: ${a.s.interested} interested, ${a.s.callbacks} call backs, ${a.s.conv} conversations from ${a.s.calls} calls (${mins(a.s.talk)} talk).`), COL.green);
        if (nLow > 0) {
          h2b('Needs a push');
          bullets(ranked.slice(-nLow).reverse().map(a => `${a.name}: ${a.s.interested} interested, ${a.s.callbacks} call backs, ${a.s.conv} conversations from ${a.s.calls} calls.${fixes(a.s, teamRef)[0] ? ' ' + fixes(a.s, teamRef)[0] : ''}`), COL.amber);
        }
      }
      if (absent.length) { h2b('Absent'); bullets(absent.map(a => `${a.name}: no calls in this period.`), COL.grey); }
      const cbs = rows.filter(c => c.disposition === 'callback');
      if (cbs.length) {
        h2b('Call-back schedule', `${cbs.length} people asked to be called back`);
        table(['Agent', 'Number', 'Name', 'Called at', 'When they asked', 'Notes'], cbs.map(c => [who(c), C.fmtPhone(c.number), lname(c), when(c.started_at), (c.ai && c.ai.callback) || '-', c.ai_summary || c.notes || '']),
          { columnStyles: { 4: { cellWidth: 80, fontStyle: 'bold' }, 5: { cellWidth: 170 } } });
      }
      const ws = warnings(rows);
      h2b('Needs attention');
      if (ws.length) table(['Agent', 'Time', 'Number', 'Why', 'What was said'], ws.map(w => [who(w.c), when(w.c.started_at), C.fmtPhone(w.c.number), w.why, w.snip]), { columnStyles: { 3: { cellWidth: 95 }, 4: { cellWidth: 190 } }, headStyles: { fillColor: [254, 243, 242], textColor: COL.ink, fontStyle: 'bold' } });
      else para('Nothing flagged: no arguments, complaints or do-not-call requests found in the recorded calls.', 10, COL.mut);
    }

    // ----- each agent -----
    for (const a of (single ? per : [...active].sort((x, z) => score(z.s) - score(x.s)))) {
      const s2 = a.s;
      if (!single) { doc.addPage(); y = M + 18; }
      else y += 6;
      if (!single) { set(9, COL.mut); text('Agent report', M, y); y += 18; h1(a.name); }
      else h2b(`${a.name}: detailed report`);
      if (!s2.calls) { para('Absent: no calls in this period.', 11, COL.mut); continue; }
      if (!single) kpis([[s2.calls, 'Calls'], [s2.conv, 'Conversations', COL.sky], [s2.interested, 'Interested', COL.green], [s2.callbacks, 'Call backs', COL.amber], [mins(s2.talk), 'Talk time', COL.purple]]);
      h2b(`How ${a.name} handled the calls`);
      const good = strengths(s2, single ? null : teamRef);
      bullets([`${s2.calls} calls to ${s2.numbers} numbers; ${s2.conv} real conversations (${pct(s2.conv, s2.calls)}% of calls), averaging ${mmss(s2.avg)}.`,
        `Worked from ${R.day ? tm(s2.first) : dtm(s2.first)} to ${R.day ? tm(s2.last) : dtm(s2.last)}.`, ...good]);
      if (!single) { callsChart(a.rows, R.day ? `${a.name}'s calls per hour` : `${a.name}'s calls per day`); outcomes(a.rows, s2, `What happened on ${a.name}'s calls`); }  // (a single-agent report already shows these charts at the top)
      const said = a.rows.filter(c => c.ai_summary && isHuman(c)).sort((x, z) => (z.disposition === 'interested') - (x.disposition === 'interested') || (z.disposition === 'callback') - (x.disposition === 'callback') || (z.duration_sec || 0) - (x.duration_sec || 0)).slice(0, 8);
      if (said.length) { y += 8; set(8.5, COL.mut); need(20); text('From the saved call summaries', M, y); y += 17; bullets(said.map(c => `${lname(c) !== '-' ? lname(c) + ' (' + C.fmtPhone(c.number) + ')' : C.fmtPhone(c.number)}, ${mmss(c.duration_sec)}: ${c.ai_summary}`), COL.purple); }
      const fx = fixes(s2, single ? null : teamRef);
      h2b('What to work on'); if (fx.length) bullets(fx, COL.amber); else para('Nothing stands out. Keep it up.', 10, COL.mut);
      const ws = warnings(a.rows);
      if (ws.length) { h2b('Warnings'); bullets(ws.map(w => `${when(w.c.started_at)}, ${C.fmtPhone(w.c.number)}${lname(w.c) !== '-' ? ' (' + lname(w.c) + ')' : ''}: ${w.why}. ${w.snip}`), COL.red); }
      if (!R.day) {
        const list = []; for (let d = R.d1; d <= R.d2; d = addDay(d, 1)) list.push(d);
        const dd = list.map(d => [d, stats(a.rows.filter(c => dayOf(c) === d))]).filter(x => x[1].calls);
        if (dd.length) { h2b('Day by day'); table(['Day', 'Calls', 'Conversations', 'Interested', 'Call backs', 'Talk', 'First / last call'], dd.map(([d, x]) => [nice(d, { weekday: 'short' }), x.calls, x.conv, x.interested, x.callbacks, mins(x.talk), `${tm(x.first)} - ${tm(x.last)}`])); }
      }
      const tbl = (title, list, cols) => { if (!list.length) return; h2b(title, `${list.length}`); table(...cols(list)); };
      tbl('Interested', a.rows.filter(c => c.disposition === 'interested'), l => [['Time', 'Number', 'Name', 'Length', 'Trucks / lanes', 'Summary'],
        l.map(c => [when(c.started_at), C.fmtPhone(c.number), lname(c), mmss(c.duration_sec), [c.ai && c.ai.trucks ? c.ai.trucks + ' trucks' : '', c.ai && c.ai.equipment, c.ai && c.ai.lanes, c.ai && c.ai.rate].filter(Boolean).join(', ') || '-', c.ai_summary || c.notes || '']), { columnStyles: { 5: { cellWidth: 170 } } }]);
      tbl('Call backs', a.rows.filter(c => c.disposition === 'callback'), l => [['Number', 'Name', 'Called at', 'When they asked', 'Summary'],
        l.map(c => [C.fmtPhone(c.number), lname(c), when(c.started_at), (c.ai && c.ai.callback) || '-', c.ai_summary || c.notes || '']), { columnStyles: { 3: { fontStyle: 'bold', cellWidth: 85 }, 4: { cellWidth: 190 } } }]);
      tbl('Closed (not interested, do not call, wrong number)', a.rows.filter(c => ['not_interested', 'do_not_call', 'wrong_number'].includes(c.disposition)), l => [['Time', 'Number', 'Name', 'Result', 'Length', 'Summary'],
        l.map(c => [when(c.started_at), C.fmtPhone(c.number), lname(c), { not_interested: 'Not interested', do_not_call: 'Do not call', wrong_number: 'Wrong number' }[c.disposition], mmss(c.duration_sec), c.ai_summary || c.notes || '']), { columnStyles: { 5: { cellWidth: 170 } } }]);
    }

    return finishDoc(`TeamLook  ·  ${R.label}  ·  ${name}`, 'Made by TeamLook AI Pilot from your call records. Call summaries are AI-written and can be wrong.');
  }
  // ---------- Insights page as a PDF (same numbers as on screen) ----------
  async function insightsPdf(calls, meta, ctx) {
    C = ctx || C;
    await libs(); await logoData();
    const A = BestTime.analyse(calls), M0 = BestTime.METRICS[BestTime.ui.metric][0];
    const rate = x => (x.n ? x.hit / x.n : 0), P = x => (x.n ? Math.round(rate(x) * 100) + '%' : '-');
    startDoc(false);
    cover('Insights report', `${meta.period}  ·  ${meta.agent}`, meta.tzLabel);
    const [ph, pn] = BestTime.rate(calls, 'person'), [lh, ln] = BestTime.rate(calls, 'live');
    const days = A.byDay.map((x, i) => ({ x, l: BestTime.DAYS[i] })), hours = A.byHour.map((x, h) => ({ x, h })).filter(o => o.x.n);
    const bestOf = list => list.filter(o => o.x.n >= 3).sort((a, b) => rate(b.x) - rate(a.x))[0];
    const bd = bestOf(days), bh = bestOf(hours), states = Object.entries(A.byState).filter(([k, x]) => k !== '??' && x.n).map(([k, x]) => ({ k, x })).sort((a, b) => rate(b.x) - rate(a.x) || b.x.n - a.x.n);
    const bs = states.find(o => o.x.n >= 5);
    kpis([[pn ? Math.round(ph / pn * 100) + '%' : '-', 'Talked to a person', COL.green], [ln ? Math.round(lh / ln * 100) + '%' : '-', 'Number connect rate', COL.blue],
      [bh ? BestTime.hourLong(bh.h) : '-', 'Best hour', COL.sky], [bd ? bd.l : '-', 'Best day', COL.purple], [bs ? bs.k : '-', 'Best state', COL.amber]]);
    para(`Measuring: ${M0}. ${A.total.n.toLocaleString()} outgoing calls. Hours are ${meta.tzMode}.${meta.state ? ' Filtered to ' + meta.state + '.' : ''}`, 9.5, COL.mut);
    y += 4;
    // heat map: day x hour, shaded by rate
    const used = hours.map(o => o.h), h0 = used.length ? Math.min(...used) : 8, h1 = used.length ? Math.max(...used) : 18;
    const hs = []; for (let h = h0; h <= h1; h++) hs.push(h);
    const maxR = Math.max(0.01, ...A.cells.flat().filter(x => x.n >= 2).map(rate));
    h2b(`${M0} by day and hour`, 'darker = better');
    table(['', ...hs.map(BestTime.hourLabel)], A.cells.map((row, d) => [BestTime.DAYS[d], ...hs.map(h => (row[h].n ? Math.round(rate(row[h]) * 100) : ''))]), {
      styles: { fontSize: 7, cellPadding: 3, halign: 'center', lineColor: [255, 255, 255], lineWidth: 1.2 }, headStyles: { fillColor: [255, 255, 255], textColor: COL.mut, fontStyle: 'normal', halign: 'center' },
      columnStyles: { 0: { halign: 'left', fontStyle: 'bold', textColor: COL.txt, cellWidth: 34 } }, alternateRowStyles: {},
      didParseCell: d => { if (d.section !== 'body' || d.column.index === 0) return; const x = A.cells[d.row.index][hs[d.column.index - 1]];
        if (!x.n) { d.cell.styles.fillColor = [249, 250, 251]; return; } const a = Math.min(1, rate(x) / maxR) * 0.85 + 0.12;
        d.cell.styles.fillColor = [Math.round(255 - (255 - 50) * a), Math.round(255 - (255 - 87) * a), Math.round(255 - (255 - 247) * a)]; d.cell.styles.textColor = a > 0.55 ? [255, 255, 255] : [29, 43, 107]; } });
    h2b('Best days');
    hbars('', days.map(o => [o.l, rate(o.x), COL.purple, o.x.n ? `${P(o.x)} · ${o.x.n}` : '-']));
    h2b('Best hours');
    hbars('', hours.map(o => [BestTime.hourLong(o.h), rate(o.x), COL.green, `${P(o.x)} · ${o.x.n}`]));
    if (states.length) { h2b(`${M0} by state`, `${states.length} states`); table(['State', 'Calls', M0, 'Best hour'], states.map(o => { const b = bestOf(o.x.hours.map((x, h) => ({ x, h }))); return [BestTime.NAMES[o.k] || o.k, o.x.n, `${P(o.x)} (${o.x.hit})`, b ? BestTime.hourLong(b.h) : '-']; }), { headStyles: { fillColor: [236, 253, 243], textColor: COL.ink, fontStyle: 'bold' } }); }
    const areas = Object.values(A.byArea).filter(a => !meta.stateCode || a.st === meta.stateCode).sort((a, b) => rate(b) - rate(a) || b.n - a.n);
    if (areas.length) { h2b('By area code', `${areas.length} area codes`); table(['Area code', 'State', 'Calls', M0, 'Best hour'], areas.map(a => { const b = bestOf(a.hours.map((x, h) => ({ x, h }))); return [a.code, a.st ? BestTime.NAMES[a.st] : 'Unknown', a.n, `${P(a)} (${a.hit})`, b ? BestTime.hourLong(b.h) : '-']; }), { headStyles: { fillColor: [255, 250, 235], textColor: COL.ink, fontStyle: 'bold' } }); }
    finishDoc(`TeamLook  ·  Insights  ·  ${meta.period}`, 'Made by TeamLook AI Pilot from your call records.');
    doc.save(`TeamLook-insights-${meta.file}.pdf`);
  }
  return { render, insightsPdf };
})();
