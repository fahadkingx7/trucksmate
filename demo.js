// TeamLook demo: a fake backend that lives in the browser.
// Every request the portal makes to the database or the recordings service is answered here
// with simulated truck-dispatch sales calls, so the demo always shows today, yesterday and the whole month.
(function () {
  'use strict';
  const API = 'https://demo-db.teamlook.local', REC = 'https://demo-rec.teamlook.local';
  window.DEMO = { API, REC };

  // ---------- seeded random numbers (same data on every visit for the same day) ----------
  const hash = s => { let h = 2166136261; for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; };
  const rng = seed => { let a = hash(String(seed)); return () => { a |= 0; a = a + 0x6D2B79F5 | 0; let t = Math.imul(a ^ a >>> 15, 1 | a); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; }; };
  const pick = (r, a) => a[Math.floor(r() * a.length)];
  const int = (r, a, b) => a + Math.floor(r() * (b - a + 1));
  const gauss = r => { let u = 0, v = 0; while (!u) u = r(); while (!v) v = r(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v); };
  const wpick = (r, items) => { const t = items.reduce((s, x) => s + x[1], 0); let k = r() * t; for (const [v, w] of items) { if ((k -= w) <= 0) return v; } return items[0][0]; };

  // ---------- the team ----------
  const ME = { id: 'demo-admin', email: 'demo', full_name: 'Alex Morgan', role: 'admin', disabled: false };
  const AGENTS = [
    ['a1', 'Sarah Mitchell', 1.15, .30], ['a2', 'David Chen', 1.05, .26], ['a3', 'Maria Lopez', 1.0, .28],
    ['a4', 'James Carter', .9, .22], ['a5', 'Priya Shah', .95, .27], ['a6', 'Tom Reilly', .78, .18]];
  const profiles = [...AGENTS.map(([id, n]) => ({ id, email: n.split(' ')[0].toLowerCase() + '@teamlook.demo', full_name: n, role: 'agent', disabled: false })), ME];
  const agentName = id => (AGENTS.find(a => a[0] === id) || [0, 'Agent'])[1];

  // ---------- carriers and what they say ----------
  const WORD1 = 'Arsenal Lotus Vibrant Eagle Prime Swift Lone Star Blue Ridge Iron Horse Red River Golden Gate Summit Patriot Falcon Liberty Northstar Apex Titan Silver Line Big Sky Rocky Road Highway Cardinal Desert Wind Gulf Coast Maverick Steel City Freedom Royal Crown Express Way Black Bear Sunrise Pioneer Thunder Road Victory Diamond Atlas Heartland Coyote'.split(' ');
  const WORD2 = ['TRUCKING LLC', 'TRANSPORT INC', 'LOGISTICS LLC', 'FREIGHT LLC', 'CARRIERS INC', 'HAULING LLC', 'EXPRESS LLC', 'TRANSPORTATION LLC'];
  const FIRST = 'James Robert Michael William David Richard Joseph Thomas Charles Daniel Matthew Anthony Mark Donald Steven Paul Andrew Kevin Brian George Ronald Jason Ryan Gary Eric Larry Frank Scott Justin Carlos Luis Jose Juan Miguel Ahmed Victor Andre Marcus Darnell Malik Hector Ivan Sergei Gurpreet Harjit'.split(' ');
  const LAST = 'Smith Johnson Williams Brown Jones Garcia Miller Davis Rodriguez Martinez Hernandez Lopez Gonzalez Wilson Anderson Thomas Taylor Moore Jackson Martin Lee Perez Thompson White Harris Sanchez Clark Ramirez Lewis Robinson Walker Young Allen King Wright Scott Torres Nguyen Hill Flores Singh Khan Petrov'.split(' ');
  const AREAS = ['214', '469', '713', '832', '512', '210', '305', '786', '407', '813', '404', '678', '602', '480', '312', '773', '919', '704', '615', '901', '317', '614', '816', '702'];
  const CITIES = ['Dallas', 'Houston', 'Atlanta', 'Chicago', 'Memphis', 'Nashville', 'Phoenix', 'Los Angeles', 'Charlotte', 'Indianapolis', 'Columbus', 'Kansas City', 'Denver', 'Jacksonville', 'Laredo', 'El Paso'];
  const EQUIP = [['Dry van', 5], ['Reefer', 3], ['Flatbed', 2], ['Power only', 1], ['Hotshot', 1], ['Box truck', 1]];
  const WHEN = ['tomorrow at 10 AM', 'Monday after 2 PM', 'Tuesday morning', 'Wednesday at 4 PM', 'Thursday after 5', 'Friday before noon', 'tomorrow after lunch'];
  const carrierName = r => r() < .62 ? pick(r, WORD1).toUpperCase() + ' ' + pick(r, WORD2) : pick(r, FIRST) + ' ' + pick(r, LAST);
  const lane = r => { const a = pick(r, CITIES); let b = pick(r, CITIES); while (b === a) b = pick(r, CITIES); return a + ' → ' + b; };

  function talk(r, d, who) {
    const eq = wpick(r, EQUIP), trucks = r() < .55 ? 1 : int(r, 2, 8), ln = lane(r), rate = '$' + (2 + r() * .9).toFixed(2) + '/mile';
    const owner = trucks === 1 ? 'Owner-operator' : `Small fleet (${trucks} trucks)`;
    if (d === 'interested') return pick(r, [
      [`${owner} running ${eq.toLowerCase()} out of ${ln.split(' → ')[0]}. Wants steady loads ${ln} at ${rate} or better. Asked for the carrier packet and our 5% fee terms by email.`, { trucks, equipment: eq, lanes: ln, rate, next: 'Email carrier packet' }],
      [`Current broker loads have been slow; ${who} has ${trucks} ${eq.toLowerCase()} truck${trucks > 1 ? 's' : ''} sitting two days a week. Liked that we handle paperwork and detention. Ready to sign the dispatch agreement.`, { trucks, equipment: eq, lanes: ln, rate, next: 'Send dispatch agreement' }],
      [`New MC (authority 4 months old) with ${trucks} ${eq.toLowerCase()}. Needs help getting set up with brokers and factoring. Very interested; asked for a call with the onboarding team.`, { trucks, equipment: eq, lanes: ln, next: 'Onboarding call' }],
      [`Runs ${ln} every week and wants a backhaul plan to avoid deadhead. Agreed to a 2-week trial at 5%.`, { trucks, equipment: eq, lanes: ln, rate, next: 'Start trial Monday' }]]);
    if (d === 'callback') { const w = pick(r, WHEN); return pick(r, [
      [`${who} is on the road right now and asked us to call back ${w} to talk about dispatch rates.`, { callback: w, trucks, equipment: eq, next: 'Call back' }],
      [`Truck is in the shop this week. Interested in dispatch once it is back; call back ${w}.`, { callback: w, trucks, equipment: eq, next: 'Call back' }],
      [`Business partner handles the loads; asked us to call back ${w} when both are available.`, { callback: w, next: 'Call back with partner' }]]); }
    if (d === 'not_interested') return pick(r, [
      ['Already has an in-house dispatcher and is happy with the setup.', {}],
      ['Only runs dedicated contract freight; does not need a dispatcher.', { equipment: eq }],
      ['Asked to be removed from the call list. Marked do-not-call.', {}],
      [`Thinks 5% is too high; currently paying a flat $150/week to another service.`, { rate: '$150/week elsewhere' }]]);
    return pick(r, [
      ['Asked how the 5% fee works and whether we cover weekends. Wants to think about it.', { next: 'Send fee sheet' }],
      [`Wrong contact; the owner is ${pick(r, FIRST)}. Gave a better number to reach him.`, { next: 'Update contact' }],
      [`Asked if we can find ${eq.toLowerCase()} loads out of ${ln.split(' → ')[0]}; agent explained typical rates. No decision yet.`, { equipment: eq, lanes: ln, next: 'Follow up next week' }]]);
  }

  // ---------- the calls ----------
  const DAYS_BACK = 45, START_H = 9, END_H = 19;
  const HW = [[9, 6], [10, 10], [11, 11], [12, 7], [13, 8], [14, 10], [15, 11], [16, 10], [17, 8], [18, 5]];
  const ymd = d => d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  const POOLS = {}; // numbers per list, so some numbers get called more than once
  const LISTS = [['L1', 'Texas & Oklahoma carriers', 21, 2400], ['L2', 'New MC authorities – this month', 14, 1800], ['L3', 'Reefer fleets – Southeast', 9, 1500], ['L4', 'Flatbed owner-operators', 4, 1200]];
  const memo = new Map();
  function dayCalls(day) {
    const key = ymd(day); if (memo.has(key)) return memo.get(key);
    const out = [], wd = day.getDay();
    if (wd !== 0) {
      const vol = wd === 6 ? .35 : 1;
      AGENTS.forEach(([aid, an, speed, conv], ai) => {
        if (wd === 6 && (aid === 'a4' || aid === 'a6')) return;
        const r = rng(key + aid);
        const n = Math.max(0, Math.round((88 + gauss(r) * 9) * speed * vol));
        for (let i = 0; i < n; i++) {
          const h = wpick(r, HW), t = new Date(day.getFullYear(), day.getMonth(), day.getDate(), h, int(r, 0, 59), int(r, 0, 59));
          const p = conv * 1.3 * ([10, 11, 15, 16].includes(h) ? 1.15 : .9), x = r();
          const d = x < p ? wpick(r, [['answered', 44], ['interested', 16 * speed ** 1.6], ['callback', 16], ['not_interested', 22]])
            : x < p + .32 ? 'voicemail' : x < p + .345 ? 'dead_number' : 'no_answer';
          const dur = { answered: int(r, 50, 360), interested: int(r, 240, 660), callback: int(r, 70, 260), not_interested: int(r, 25, 120), voicemail: int(r, 22, 48), dead_number: int(r, 3, 12), no_answer: int(r, 18, 32) }[d];
          const human = ['answered', 'interested', 'callback', 'not_interested'].includes(d);
          const list = LISTS[Math.floor(r() * LISTS.length)][0];
          const pool = POOLS[list] || (POOLS[list] = []);
          let number, label;
          if (pool.length && r() < .12) ({ number, label } = pick(r, pool));
          else { number = '+1' + pick(r, AREAS) + String(int(r, 2000000, 9999999)); label = human || r() < .55 ? carrierName(r) : ''; pool.push({ number, label }); }
          const c = { id: `c-${key}-${aid}-${i}`, agent_id: aid, agent_label: an, number, label, direction: 'outgoing', started_at: t.toISOString(), duration_sec: dur,
            auto_disposition: d, disposition: d, disposition_source: human ? 'agent' : 'auto', ended_by: r() < .5 ? 'remote' : 'local', notes: '',
            list_id: list, lead_id: null, transcript_status: null, ai_summary: null, ai: null, updated_at: t.toISOString() };
          if (human) {
            c.transcript_status = 'done';
            const who = /LLC|INC/.test(label) ? 'the owner' : label.split(' ')[0];
            const [s, ai] = talk(r, d, who); ai.outcome = d === 'answered' ? 'other' : d;
            c.ai_summary = s; c.ai = ai;
            if (d === 'interested' && r() < .3) c.notes = pick(r, ['Hot lead', 'Send packet ASAP', 'Wants Monday start']);
          } else if (d === 'voicemail') c.transcript_status = 'done';
          out.push(c);
        }
      });
    }
    memo.set(key, out); return out;
  }
  function allCalls() {
    const now = new Date(), res = [];
    for (let b = DAYS_BACK; b >= 0; b--) { const d = new Date(now.getFullYear(), now.getMonth(), now.getDate() - b); for (const c of dayCalls(d)) if (new Date(c.started_at) <= now) res.push(c); }
    return res;
  }
  const edits = new Map(); // changes made in this browser (disposition fixes, notes)
  const calls = () => allCalls().map(c => (edits.has(c.id) ? { ...c, ...edits.get(c.id) } : c));

  // ---------- transcripts + audio ----------
  function transcript(c) {
    const r = rng(c.id + 't'), ag = agentName(c.agent_id).split(' ')[0], ai = c.ai || {}, d = c.disposition;
    const L = [['agent', `Hi, this is ${ag} with TeamLook Dispatch. Am I speaking with the owner?`], ['caller', 'Yeah, speaking. What is this about?'],
      ['agent', `We help carriers like you keep the truck loaded with good-paying freight. Are you running ${String(ai.equipment || 'dry van').toLowerCase()} right now?`],
      ['caller', ai.trucks ? `Yes, ${ai.trucks} truck${ai.trucks > 1 ? 's' : ''}. Mostly ${ai.lanes || 'regional'}.` : 'Something like that, yeah.']];
    if (d === 'interested') L.push(['agent', `We usually get ${ai.rate || 'around $2.50 a mile'} on that lane and handle all the broker paperwork for 5%.`], ['caller', 'That sounds better than what I am getting now.'],
      ['agent', 'I can email you our carrier packet today and get you on the board this week.'], ['caller', 'Okay, send it over. I will read it tonight.'], ['agent', 'Perfect, it is on its way. Talk soon!']);
    else if (d === 'callback') L.push(['caller', `I am driving right now. Can you call me back ${ai.callback || 'later'}?`], ['agent', `Of course, I will call you ${ai.callback || 'then'}. Drive safe!`]);
    else if (d === 'not_interested') L.push(['caller', 'I already have someone doing my dispatch, thanks.'], ['agent', 'No problem at all. If anything changes, we are here. Have a good one!']);
    else L.push(['caller', 'How does your fee work exactly?'], ['agent', 'It is 5% of the load, no contracts, and you choose which loads you take.'], ['caller', 'Let me think about it.'], ['agent', 'Sure, I will send you the details by email.']);
    const step = Math.max(4, (c.duration_sec - 8) / L.length);
    return L.map(([s, x], i) => ({ t: Math.round(i * step + r() * 2), s, x }));
  }
  function wav(sec) {
    const rate = 8000, n = Math.round(rate * Math.min(sec, 900)), buf = new ArrayBuffer(44 + n), v = new DataView(buf);
    const s = (o, t) => [...t].forEach((ch, i) => v.setUint8(o + i, ch.charCodeAt(0)));
    s(0, 'RIFF'); v.setUint32(4, 36 + n, true); s(8, 'WAVE'); s(12, 'fmt '); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
    v.setUint32(24, rate, true); v.setUint32(28, rate, true); v.setUint16(32, 1, true); v.setUint16(34, 8, true); s(36, 'data'); v.setUint32(40, n, true);
    let x = 1; for (let i = 0; i < n; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; v.setUint8(44 + i, 128 + ((x >> 16) % 7) - 3); }
    return new Blob([buf], { type: 'audio/wav' });
  }

  // ---------- AI briefing (written from the numbers, no AI needed in the demo) ----------
  function digest(agent, from, to) {
    const rows = calls().filter(c => (!from || c.started_at >= from) && (!to || c.started_at < to) && (!agent || c.agent_id === agent));
    if (!rows.length) return 'No calls in this period yet. The team usually starts dialing at 9 AM.';
    const conv = rows.filter(c => c.ai), intr = rows.filter(c => c.disposition === 'interested'), cb = rows.filter(c => c.disposition === 'callback');
    const mins = Math.round(conv.reduce((s, c) => s + c.duration_sec, 0) / 60);
    const best = [...intr].sort((a, b) => b.duration_sec - a.duration_sec).slice(0, 2);
    const lead = c => `${c.label || c.number} (${[c.ai.trucks ? c.ai.trucks + ' truck' + (c.ai.trucks > 1 ? 's' : '') : '', c.ai.equipment, c.ai.lanes].filter(Boolean).join(', ')})`;
    let b;
    if (agent) {
      const nm = agentName(agent).split(' ')[0];
      b = [`${nm} made ${rows.length} calls with ${conv.length} real conversations and ${mins} minutes of talk time.`,
        `${intr.length} interested carrier${intr.length === 1 ? '' : 's'} and ${cb.length} call back${cb.length === 1 ? '' : 's'} booked.` + (best[0] ? ` Strongest: ${lead(best[0])}.` : ''),
        `${nm} does well when leading with the lane rate; most interested carriers agreed after hearing a $/mile number.`];
    } else {
      const per = AGENTS.map(([id]) => [id, intr.filter(c => c.agent_id === id).length, rows.filter(c => c.agent_id === id).length]).filter(x => x[2]);
      per.sort((a, b) => b[1] - a[1]);
      b = [`The team made ${rows.length.toLocaleString()} calls with ${conv.length} real conversations and ${Math.floor(mins / 60)}h ${mins % 60}m of talk time.`,
        `${agentName(per[0][0])} leads with ${per[0][1]} interested carriers; ${agentName(per[per.length - 1][0])} has ${per[per.length - 1][1]} and may need help with openers.`,
        best.length ? `Best leads: ${best.map(lead).join('; ')}.` : 'No interested carriers yet.',
        `${cb.length} carriers asked for a call back. Owner-operators answer most between 10–11 AM and 3–4 PM.`];
    }
    return b.map(x => '• ' + x).join('\n');
  }

  // ---------- lists + leads ----------
  const lists = () => LISTS.map(([id, name, ago]) => ({ id, name, created_at: new Date(Date.now() - ago * 864e5).toISOString(), enabled: true }));
  function leads(listId) {
    const out = [], seen = new Map(), all = calls().filter(c => c.list_id === listId);
    for (const c of all) { const k = c.number + c.agent_id; const x = seen.get(k); if (x) { x.attempts++; continue; }
      const l = { id: 'ld-' + k, list_id: listId, agent_id: c.agent_id, number: c.number, name: /LLC|INC/.test(c.label) ? '' : c.label, company: /LLC|INC/.test(c.label) ? c.label : '', notes: '', position: out.length, status: 'called', attempts: 1, called_at: c.started_at, last_call_at: c.started_at, last_disposition: c.disposition, created_at: c.started_at };
      seen.set(k, l); out.push(l); }
    const r = rng(listId + 'pending'), total = LISTS.find(l => l[0] === listId)[3];
    for (let i = out.length; i < Math.max(out.length + 60, total); i++) { const a = AGENTS[i % AGENTS.length][0]; out.push({ id: `ld-${listId}-p${i}`, list_id: listId, agent_id: a, number: '+1' + pick(r, AREAS) + String(int(r, 2000000, 9999999)), name: '', company: carrierName(r), notes: '', position: i, status: 'pending', attempts: 0, called_at: null, created_at: new Date().toISOString() }); }
    return out;
  }
  function listProgress() {
    const rows = [], cs = calls();
    for (const [id, , , total] of LISTS) for (const [aid] of AGENTS) {
      const called = new Set(cs.filter(c => c.list_id === id && c.agent_id === aid).map(c => c.number)).size;
      rows.push({ list_id: id, agent_id: aid, status: 'called', n: called }, { list_id: id, agent_id: aid, status: 'pending', n: Math.max(Math.round(total / AGENTS.length) - called, 25) });
    }
    return rows;
  }
  function agentStatus() {
    const now = new Date(), h = now.getHours() + now.getMinutes() / 60, working = now.getDay() !== 0 && h >= START_H && h < END_H, last = calls();
    return AGENTS.map(([id], i) => {
      const mine = last.filter(c => c.agent_id === id); const lc = mine[mine.length - 1];
      const on = working && id !== 'a6';
      return { agent_id: id, last_seen: on ? new Date(now - 6000).toISOString() : (lc ? lc.started_at : new Date(now - 864e5).toISOString()), on_call: on && i % 3 === 0, current_number: on && i % 3 === 0 ? '(713) 555-01' + (40 + i) : null };
    });
  }

  // ---------- a tiny PostgREST ----------
  function filter(rows, q) {
    for (const [k, v] of q) {
      if (['select', 'order', 'limit', 'offset'].includes(k)) continue;
      const i = v.indexOf('.'), op = v.slice(0, i), val = v.slice(i + 1);
      rows = rows.filter(r => {
        const x = r[k];
        switch (op) {
          case 'eq': return String(x) === val; case 'neq': return String(x) !== val;
          case 'gte': return x != null && x >= val; case 'gt': return x != null && x > val;
          case 'lt': return x != null && x < val; case 'lte': return x != null && x <= val;
          case 'in': return val.replace(/^\(|\)$/g, '').split(',').includes(String(x));
          case 'not': return val === 'is.null' ? x != null : true; case 'is': return val === 'null' ? x == null : true;
          case 'ilike': return String(x || '').toLowerCase().includes(val.replace(/\*/g, '').toLowerCase());
          default: return true;
        }
      });
    }
    const ord = q.find(([k]) => k === 'order');
    if (ord) { const [f, dir] = ord[1].split(',')[0].split('.'); rows = [...rows].sort((a, b) => (a[f] < b[f] ? -1 : a[f] > b[f] ? 1 : 0) * (dir === 'desc' ? -1 : 1)); }
    return rows;
  }
  const json = (body, status = 200, extra = {}) => new Response(status === 204 ? null : JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json', ...extra } });
  function paged(rows, q) {
    const off = +(q.find(([k]) => k === 'offset') || [0, 0])[1], lim = +(q.find(([k]) => k === 'limit') || [0, 1e9])[1];
    const body = rows.slice(off, off + lim);
    return json(body, 200, { 'Content-Range': `${off}-${off + Math.max(body.length - 1, 0)}/${rows.length}` });
  }
  const session = () => ({ access_token: 'demo-' + Date.now(), refresh_token: 'demo-refresh', expires_in: 86400, expires_at: Math.floor(Date.now() / 1000) + 86400, user: { id: ME.id, email: ME.email } });

  async function handle(url, init) {
    const u = new URL(url), q = [...u.searchParams.entries()], method = (init && init.method || 'GET').toUpperCase();
    let body = {}; try { body = init && init.body ? JSON.parse(init.body) : {}; } catch (e) { /* not JSON */ }
    await new Promise(r => setTimeout(r, 60 + Math.random() * 90)); // feels like a real server
    if (u.origin === REC) {
      if (u.pathname === '/digest') { const f = new Date(Date.now() - 4 * 60000); return json({ text: digest(body.agent, body.from, body.to), at: f.getTime(), stats: {} }); }
      if (u.pathname.startsWith('/rec/')) { const c = calls().find(x => x.id === decodeURIComponent(u.pathname.slice(5))); return new Response(wav(c ? c.duration_sec : 60), { headers: { 'Content-Type': 'audio/wav' } }); }
      return json({ ok: true });
    }
    const p = u.pathname;
    if (p.startsWith('/auth/v1/token')) {
      if (u.searchParams.get('grant_type') === 'password' && !(String(body.email).trim().toLowerCase() === 'demo' && body.password === 'demo'))
        return json({ error_code: 'invalid_credentials', msg: 'Use demo / demo to sign in to the demo.' }, 400);
      return json(session());
    }
    if (p.startsWith('/auth/v1')) return json({});
    if (p.startsWith('/functions/v1/')) return json({ ok: true, note: 'Demo: changes are not saved.' });
    const t = p.replace('/rest/v1/', '');
    if (t === 'rpc/list_progress') return json(listProgress());
    if (t === 'rpc/report_days') {
      const by = {}; for (const c of calls()) { if (body.p_agent && c.agent_id !== body.p_agent) continue; const d = ymd(new Date(c.started_at));
        const o = by[d] || (by[d] = { day: d, calls: 0, conversations: 0, interested: 0, callbacks: 0, agents: new Set() }); o.calls++; o.agents.add(c.agent_id);
        if (c.ai) o.conversations++; if (c.disposition === 'interested') o.interested++; if (c.disposition === 'callback') o.callbacks++; }
      return json(Object.values(by).map(o => ({ ...o, agents: o.agents.size })).sort((a, b) => b.day.localeCompare(a.day)));
    }
    if (method === 'PATCH' && t === 'calls') { const id = (q.find(([k]) => k === 'id') || [0, ''])[1].replace('eq.', ''); edits.set(id, { ...(edits.get(id) || {}), ...body, updated_at: new Date().toISOString() }); return json(null, 204); }
    if (method !== 'GET') return json(null, 204);
    if (t === 'calls') {
      const one = q.find(([k, v]) => k === 'id' && v.startsWith('eq.'));
      if (one) { const c = calls().find(x => x.id === one[1].slice(3)); return json(c ? [{ ...c, transcript: c.transcript_status === 'done' && c.ai ? transcript(c) : [], transcript_text: c.ai ? transcript(c).map(l => l.x).join('\n') : '' }] : []); }
      return paged(filter(calls(), q), q);
    }
    if (t === 'profiles') return paged(filter(profiles, q), q);
    if (t === 'agent_status') return paged(filter(agentStatus(), q), q);
    if (t === 'lead_lists') return paged(filter(lists(), q), q);
    if (t === 'leads') { const l = (q.find(([k]) => k === 'list_id') || [0, ''])[1].replace('eq.', ''); return paged(filter(l ? leads(l) : LISTS.flatMap(x => leads(x[0])), q), q); }
    return paged([], q);
  }

  const real = window.fetch.bind(window);
  window.fetch = (input, init) => {
    const url = typeof input === 'string' ? input : input.url;
    if (url.startsWith(API) || url.startsWith(REC)) return handle(url, init);
    return real(input, init);
  };
})();
