// Home dashboard: today at a glance, trends, funnel, outcomes, alerts and activity. Plain SVG, no chart library.
// Colors mean the same everywhere: blue = calls, green = reached a person, red = bad, amber = call backs / attention, purple = voicemail, grey = no answer.
const Home = (() => {
  const C = { blue: '#3257F7', green: '#12b76a', red: '#f04438', amber: '#f79009', purple: '#7a5af8', grey: '#d0d5dd', dark: '#344054', orange: '#fb6514' };
  const DCOL = { answered: C.green, interested: C.blue, callback: C.amber, not_interested: '#f97066', voicemail: C.purple, no_answer: C.grey,
    busy: '#fdb022', dead_number: C.red, wrong_number: C.orange, do_not_call: '#b42318', cancelled: '#98a2b3', failed: '#d92d20', missed: '#98a2b3', other: '#667085' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const dayKey = d => { const x = new Date(d); return x.getFullYear() + '-' + (x.getMonth() + 1) + '-' + x.getDate(); };
  const CONN = new Set(['answered', 'interested', 'not_interested', 'callback']);
  const ICON = {
    phone: '<path d="M6.6 10.8a15.1 15.1 0 0 0 6.6 6.6l2.2-2.2a1 1 0 0 1 1-.25 11.4 11.4 0 0 0 3.6.57 1 1 0 0 1 1 1V20a1 1 0 0 1-1 1A17 17 0 0 1 3 4a1 1 0 0 1 1-1h3.5a1 1 0 0 1 1 1c0 1.25.2 2.45.57 3.57a1 1 0 0 1-.25 1z"/>',
    check: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm-1.2 14.2-4-4 1.4-1.4 2.6 2.6 5.6-5.6 1.4 1.4z"/>',
    star: '<path d="m12 2.5 2.9 6 6.6.9-4.8 4.6 1.2 6.5L12 17.4l-5.9 3.1 1.2-6.5L2.5 9.4l6.6-.9z"/>',
    back: '<path d="M12 4a8 8 0 1 1-7.4 5H2l3.5-4L9 9H6.7A6 6 0 1 0 12 6z"/>',
    clock: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm1 10.4 3.5 2.1-.9 1.5L11 13V7h2z"/>',
    chat: '<path d="M4 4h16a1 1 0 0 1 1 1v11a1 1 0 0 1-1 1H8l-5 4V5a1 1 0 0 1 1-1z"/>'
  };
  const icon = k => `<svg viewBox="0 0 24 24" width="19" height="19" fill="currentColor">${ICON[k]}</svg>`;
  const pctTxt = (a, b) => (b ? Math.round(a / b * 100) : 0);

  // ---- period + time zone (remembered per browser) ----
  const TZS = [['', 'Your time'], ['Asia/Karachi', 'Pakistan (PKT)'], ['America/New_York', 'US Eastern'], ['America/Chicago', 'US Central'], ['America/Denver', 'US Mountain'], ['America/Los_Angeles', 'US Pacific']];
  const PERIODS = [['today', 'Today'], ['yesterday', 'Yesterday'], ['date', 'Pick a day…'], ['7', 'Last 7 days'], ['30', 'Last 30 days']];
  let st = { mode: 'today', date: '', tz: '' };
  try { st = { ...st, ...JSON.parse(localStorage.getItem('tm_home') || '{}') }; } catch (e) { /* private mode */ }
  const save = () => { try { localStorage.setItem('tm_home', JSON.stringify(st)); } catch (e) { /* ignore */ } };
  const fmts = new Map();
  function parts(d) {
    const x = new Date(d);
    if (!st.tz) return { y: x.getFullYear(), m: x.getMonth() + 1, d: x.getDate(), h: x.getHours() };
    let f = fmts.get(st.tz);
    if (!f) fmts.set(st.tz, f = new Intl.DateTimeFormat('en-US', { timeZone: st.tz, year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', hourCycle: 'h23' }));
    const o = {}; for (const p of f.formatToParts(x)) o[p.type] = p.value;
    return { y: +o.year, m: +o.month, d: +o.day, h: +o.hour % 24 };
  }
  const pad = n => String(n).padStart(2, '0');
  const keyOf = d => { const p = parts(d); return `${p.y}-${pad(p.m)}-${pad(p.d)}`; };
  const addDays = (k, n) => { const d = new Date(k + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n); return d.toISOString().slice(0, 10); };
  const range = (endKey, n) => Array.from({ length: n }, (_, i) => addDays(endKey, i - n + 1));
  function period() {
    const today = keyOf(new Date());
    if (st.mode === 'yesterday') return range(addDays(today, -1), 1);
    if (st.mode === 'date') return range(st.date && st.date <= today ? st.date : today, 1);
    if (st.mode === '7') return range(today, 7);
    if (st.mode === '30') return range(today, 30);
    return range(today, 1);
  }
  function windows() {
    const P = period(), prev = range(addDays(P[0], -1), P.length), trend = range(P[P.length - 1], Math.max(14, P.length));
    return { P, prev, trend };
  }
  // earliest moment the dashboard needs data from (with a day of slack for time zones)
  function since() { const { prev, trend } = windows(); const first = prev[0] < trend[0] ? prev[0] : trend[0]; return new Date(addDays(first, -1) + 'T00:00:00Z').toISOString(); }
  const keyLabel = k => new Date(k + 'T12:00:00Z').toLocaleDateString([], { month: 'short', day: 'numeric', timeZone: 'UTC' });

  function delta(now, before, higherIsGood = true) {
    if (!before && !now) return '<span class="dz">—</span> same as yesterday';
    if (!before) return '<span class="up">New</span> today';
    const p = Math.round((now - before) / before * 100);
    const good = higherIsGood ? p >= 0 : p <= 0;
    return `<span class="${good ? 'up' : 'down'}">${p >= 0 ? '▲' : '▼'} ${Math.abs(p)}%</span> vs yesterday`;
  }

  // ---- charts ----
  function axes(W, H, pl, pt, pb, nice, fmt) {
    let g = '';
    for (let i = 0; i <= 4; i++) { const y = pt + (H - pt - pb) * (1 - i / 4); g += `<line x1="${pl}" x2="${W}" y1="${y}" y2="${y}" class="gl"/><text x="${pl - 8}" y="${y + 4}" class="ax" text-anchor="end">${esc(fmt(nice * i / 4))}</text>`; }
    return g;
  }
  const niceMax = m => { if (m <= 4) return 4; const p = Math.pow(10, Math.floor(Math.log10(m))); for (const k of [1, 2, 2.5, 5, 10]) if (k * p * 4 >= m) return Math.ceil(m / (k * p)) * k * p; return m; };
  // stacked bars: series = [{ vals, color, name }]
  function bars(series, labels, { h = 200, hl = -1, fmt = v => Math.round(v), W = 560 } = {}) {
    const H = h, pl = 36, pb = 26, pt = 12, n = labels.length;
    const tot = labels.map((_, i) => series.reduce((s, x) => s + x.vals[i], 0));
    const nice = niceMax(Math.max(1, ...tot)), bw = (W - pl - 6) / n;
    let g = axes(W, H, pl, pt, pb, nice, fmt);
    labels.forEach((lab, i) => {
      let y0 = H - pb; const x = pl + i * bw + bw * 0.2, w = bw * 0.6;
      series.forEach((s, si) => {
        const v = s.vals[i]; if (!v) return;
        const bh = (H - pt - pb) * (v / nice); y0 -= bh;
        const top = si === series.length - 1 || !series.slice(si + 1).some(t => t.vals[i]);
        g += `<rect x="${x}" y="${y0}" width="${w}" height="${bh}" rx="${top ? 4 : 0}" fill="${s.color}" opacity="${hl >= 0 && i !== hl ? .55 : 1}"><title>${esc(lab)} · ${esc(s.name)}: ${v}</title></rect>`;
      });
      if (n <= 16 || (n - 1 - i) % 3 === 0) g += `<text x="${x + w / 2}" y="${H - 8}" class="ax" text-anchor="middle">${esc(lab)}</text>`;
    });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}</svg>`;
  }
  function line(vals, labels, { h = 200, max = null, fmt = v => v, color = C.blue, tips = null, weak = null } = {}) {
    const W = 560, H = h, pl = 40, pb = 26, pt = 12, n = vals.length;
    const nice = max ?? niceMax(Math.max(1, ...vals.filter(v => v != null))), step = (W - pl - 14) / Math.max(1, n - 1);
    const X = i => pl + 6 + i * step, Y = v => pt + (H - pt - pb) * (1 - v / nice);
    let g = `<defs><linearGradient id="lg${color.slice(1)}" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="${color}" stop-opacity=".22"/><stop offset="1" stop-color="${color}" stop-opacity="0"/></linearGradient></defs>` + axes(W, H, pl, pt, pb, nice, fmt);
    const pts = vals.map((v, i) => v == null ? null : [X(i), Y(v)]);
    const segs = []; let cur = [];
    pts.forEach(p => { if (p) cur.push(p); else if (cur.length) { segs.push(cur); cur = []; } }); if (cur.length) segs.push(cur);
    for (const s of segs) {
      g += `<path d="M${s[0][0]},${H - pb} L${s.map(p => p.join(',')).join(' L')} L${s[s.length - 1][0]},${H - pb} Z" fill="url(#lg${color.slice(1)})"/>`;
      g += `<polyline points="${s.map(p => p.join(',')).join(' ')}" class="ln" stroke="${color}"/>`;
    }
    pts.forEach((p, i) => { if (p) g += `<circle cx="${p[0]}" cy="${p[1]}" r="${weak && weak[i] ? 3 : 3.8}" class="dot" stroke="${color}" opacity="${weak && weak[i] ? .45 : 1}"><title>${esc(tips ? tips[i] : labels[i] + ': ' + fmt(vals[i]))}</title></circle>`; });
    const every = n <= 8 ? 1 : n <= 16 ? 2 : 4;
    labels.forEach((l, i) => { if ((n - 1 - i) % every === 0) g += `<text x="${X(i)}" y="${H - 8}" class="ax" text-anchor="middle">${esc(l)}</text>`; });
    return `<svg viewBox="0 0 ${W} ${H}" class="chart">${g}</svg>`;
  }
  function donut(parts, centerTop, centerSub) {
    const R = 54, S = 2 * Math.PI * R, total = parts.reduce((s, p) => s + p.v, 0);
    let off = 0, g = `<circle cx="75" cy="75" r="${R}" fill="none" stroke="#f2f4f7" stroke-width="18"/>`;
    if (total) for (const p of parts) { const len = S * p.v / total; g += `<circle cx="75" cy="75" r="${R}" fill="none" stroke="${p.c}" stroke-width="18" stroke-dasharray="${len} ${S - len}" stroke-dashoffset="${-off}" transform="rotate(-90 75 75)"><title>${esc(p.l)}: ${p.v}</title></circle>`; off += len; }
    g += `<text x="75" y="73" text-anchor="middle" font-size="24" font-weight="700" fill="#101828">${esc(centerTop)}</text><text x="75" y="93" text-anchor="middle" font-size="11" fill="#98a2b3">${esc(centerSub)}</text>`;
    return `<svg viewBox="0 0 150 150" class="donut">${g}</svg>`;
  }

  function render(box, ctx) {
    const { calls, profiles, status, lists, progress, label, agentName, callAgent, fmtDur, ago, onAgent, onList, ONLINE_SEC, cleanLabel, reload } = ctx;
    const fmtPhone = n => { const m = String(n || '').match(/^\+1(\d{3})(\d{3})(\d{4})$/); return m ? `(${m[1]}) ${m[2]}-${m[3]}` : String(n || ''); };
    const now = new Date();
    const W = windows(), PS = new Set(W.P), PPS = new Set(W.prev);
    const groups = new Map(); for (const c of calls) { const k = keyOf(c.started_at); (groups.get(k) || groups.set(k, []).get(k)).push(c); }
    const byDay = k => groups.get(k) || [];
    const T = W.P.flatMap(byDay), Y = W.prev.flatMap(byDay);
    const isToday = st.mode === 'today';
    const one = W.P.length === 1;
    const pName = isToday ? 'today' : st.mode === 'yesterday' ? 'yesterday' : one ? keyLabel(W.P[0]) : `the last ${W.P.length} days`;
    const vsTxt = isToday ? 'vs yesterday' : one ? 'vs day before' : `vs previous ${W.P.length} days`;
    // "attempts" leave out calls the agent cancelled before it rang, so the connect rate isn't dragged down by mis-dials
    const att = a => a.filter(c => c.disposition !== 'cancelled');
    const conn = a => a.filter(c => Conn.isHuman(c)).length;
    const cnt = (a, d) => a.filter(c => c.disposition === d).length;
    const ansAgent = a => a.filter(c => c.disposition === 'answered' && c.disposition_source === 'agent').length;
    const talk = a => a.reduce((s, c) => s + (c.duration_sec || 0), 0);
    const avgConv = a => { const x = a.filter(c => Conn.isHuman(c)); return x.length ? talk(x) / x.length : 0; };
    const rate = a => pctTxt(conn(a), att(a).length);
    const online = status.filter(s => (Date.now() - new Date(s.last_seen)) / 1000 < ONLINE_SEC);
    const agents = profiles.filter(p => p.role === 'agent');
    const dlt = (n, b) => delta(n, b).replace('vs yesterday', vsTxt).replace('same as yesterday', 'same as before').replace('New</span> today', 'New</span>');

    // ---- KPIs ----
    const kpi = (ic, col, l, v, foot) => `<div class="hk"><div class="hk-top"><div style="min-width:0"><div class="hk-l">${l}</div><div class="hk-v">${v}</div></div><div class="hk-ic" style="background:linear-gradient(135deg,${col},${col}cc)">${icon(ic)}</div></div><div class="hk-f">${foot}</div></div>`;
    const kpis = `<div class="hkpis">
      ${kpi('phone', C.blue, 'Calls', T.length.toLocaleString(), dlt(T.length, Y.length))}
      ${kpi('check', C.green, 'Calls reached a person', conn(T).toLocaleString(), `<span class="${rate(T) >= rate(Y) ? 'up' : 'down'}">${rate(T)}%</span> of calls · ${rate(Y)}% before`)}
      ${kpi('star', '#2443d9', 'Interested', cnt(T, 'interested'), dlt(cnt(T, 'interested'), cnt(Y, 'interested')))}
      ${kpi('phone', '#0e9384', 'Answered calls', pctTxt(ansAgent(T), att(T).length) + '%', `<b style="color:#101828">${ansAgent(T).toLocaleString()}</b> answered calls · ${pctTxt(ansAgent(Y), att(Y).length)}% before`)}
      ${kpi('clock', C.purple, 'Talk time', fmtDur(talk(T)), dlt(talk(T), talk(Y)))}
      ${kpi('chat', '#475467', 'Avg conversation', fmtDur(avgConv(T)), dlt(avgConv(T), avgConv(Y)))}
    </div>`;

    // ---- trend charts (window ends on the chosen day) ----
    const TK = W.trend;
    const reachedD = TK.map(k => conn(byDay(k))), otherD = TK.map(k => byDay(k).length - conn(byDay(k)));
    const attD = TK.map(k => att(byDay(k)).length);
    const rateD = TK.map((k, i) => attD[i] ? Math.round(conn(byDay(k)) / attD[i] * 100) : null);
    const intD = TK.map(k => cnt(byDay(k), 'interested'));
    const lblD = TK.map(k => String(+k.slice(8)));
    const hlIdx = TK.map((k, i) => PS.has(k) ? i : -1).filter(i => i >= 0);
    const lg = items => `<div class="legend">${items.map(([c, t]) => `<span><i style="background:${c}"></i>${t}</span>`).join('')}</div>`;
    const card = (t, sub, body, foot, extra = '') => `<div class="hc"><div class="hc-h row-h"><div><div class="hc-t">${t}</div><div class="hc-s">${sub}</div></div>${extra}</div>${body}${foot ? `<div class="hc-f">${foot}</div>` : ''}</div>`;
    const tot = a => a.reduce((x, y) => x + y, 0);
    const avgRate = (() => { const a = tot(attD); return a ? Math.round(tot(reachedD) / a * 100) : null; })();
    const tzName = (TZS.find(t => t[0] === st.tz) || TZS[0])[1];
    // hours: show the hours that actually have calls (agents may work another time zone's day)
    const hourCount = Array.from({ length: 24 }, (_, h) => T.filter(c => parts(c.started_at).h === h));
    const used = hourCount.map((a, h) => a.length ? h : -1).filter(h => h >= 0);
    let h0 = used.length ? Math.min(...used) : 8, h1 = used.length ? Math.max(...used) : 20;
    while (h1 - h0 < 9) { if (h0 > 0) h0--; if (h1 - h0 < 9 && h1 < 23) h1++; if (h0 === 0 && h1 === 23) break; }
    const hrs = Array.from({ length: h1 - h0 + 1 }, (_, i) => h0 + i);
    const hReached = hrs.map(h => conn(hourCount[h])), hOther = hrs.map(h => hourCount[h].length - conn(hourCount[h]));
    const curH = isToday ? hrs.indexOf(parts(now).h) : -1;
    const busiest = (() => { const t = hrs.map((h, i) => hReached[i] + hOther[i]); const m = Math.max(0, ...t); if (!m) return 'No calls in this period'; const h = hrs[t.indexOf(m)]; return `Busiest hour: <b>${(h % 12 || 12) + (h < 12 ? ' AM' : ' PM')}</b> (${m} calls)`; })();
    const trendSub = `${keyLabel(TK[0])} – ${keyLabel(TK[TK.length - 1])}`;
    const charts = `<div class="hgrid3">
      ${card('Calls per day', trendSub, bars([{ vals: reachedD, color: C.green, name: 'Reached' }, { vals: otherD, color: '#c7d2fe', name: 'No conversation' }], lblD, { hl: hlIdx.length === 1 ? hlIdx[0] : -1 }) + lg([[C.green, 'Reached a person'], ['#c7d2fe', 'No conversation']]), `<b>${tot(reachedD) + tot(otherD)}</b> calls in ${TK.length} days`)}
      ${card('Connect rate', 'Calls where a person picked up ÷ calls placed (cancelled excluded)', line(rateD, lblD, { max: 100, fmt: v => Math.round(v) + '%', color: C.green, weak: attD.map(a => a < 10), tips: TK.map((k, i) => attD[i] ? `${keyLabel(k)}: ${rateD[i]}% (${reachedD[i]} of ${attD[i]} calls)` : `${keyLabel(k)}: no calls`) }), avgRate == null ? 'No calls yet' : `Overall <b>${avgRate}%</b> · faint dots = fewer than 10 calls that day`)}
      ${card('Interested per day', 'Leads marked interested', line(intD, lblD, { color: C.blue, tips: TK.map((k, i) => `${keyLabel(k)}: ${intD[i]} interested`) }), `<b>${tot(intD)}</b> interested in ${TK.length} days`)}
    </div>
    <div class="hgrid2">
      ${card('Calls by hour', `${pName[0].toUpperCase() + pName.slice(1)} · ${tzName}`, bars([{ vals: hReached, color: C.green, name: 'Reached' }, { vals: hOther, color: '#c7d2fe', name: 'No conversation' }], hrs.map(h => (h % 12 || 12) + (h < 12 ? 'a' : 'p')), { hl: curH, W: 1000, h: 230 }) + lg([[C.green, 'Reached a person'], ['#c7d2fe', 'No conversation']]), busiest)}
      ${funnelCard()}
    </div>`;

    function funnelCard() {
      const steps = [['Dialed', T.length, C.blue], ['Reached', conn(T), C.green], ['Answered', ansAgent(T), '#0e9384'], ['Interested', cnt(T, 'interested'), '#2443d9']];
      const top = Math.max(1, steps[0][1]);
      return card('Funnel', 'From dial to interest · ' + pName, `<div class="funnel">${steps.map(([l, v, c], i) =>
        `<div class="fstep"><span>${l}</span><div><div class="fbar" style="width:${Math.max(8, v / top * 100)}%;background:${c}">${v}</div></div><span class="fpct" title="of dialed">${i ? pctTxt(v, steps[0][1]) + '%' : ''}</span></div>`).join('')}</div>`,
        T.length ? `${pctTxt(cnt(T, 'interested'), conn(T))}% of conversations turned into interest` : 'No calls in this period');
    }

    // ---- outcomes donut + alerts ----
    const counts = {}; for (const c of T) counts[c.disposition] = (counts[c.disposition] || 0) + 1;
    const dparts = Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([k, v]) => ({ l: label(k), v, c: DCOL[k] || '#98a2b3' }));
    const donutCard = card('Results', `${T.length} calls · ${pName}`, `<div class="donut-w">${donut(dparts, rate(T) + '%', 'connect rate')}<div class="dleg">${dparts.map(p => `<div><span><i style="background:${p.c}"></i>${esc(p.l)}</span><b>${p.v}</b></div>`).join('') || '<div class="sub">No calls in this period.</div>'}</div></div>`);

    const alerts = [];
    for (const l of lists) {
      const rows = progress.filter(p => p.list_id === l.id);
      const left = rows.filter(r => r.status === 'pending').reduce((s, r) => s + Number(r.n), 0);
      const total = rows.reduce((s, r) => s + Number(r.n), 0);
      if (!total) continue;
      if (l.enabled !== false && left === 0) alerts.push(['green', '✓', `${l.name} is finished`, `All ${total.toLocaleString()} numbers called. Upload a new list or re-queue.`, l.id]);
      else if (l.enabled !== false && left < 50) alerts.push(['amber', '!', `${l.name} is almost done`, `${left} numbers left to call.`, l.id]);
      else if (l.enabled === false && left) alerts.push(['blue', 'i', `${l.name} is disabled`, `${left.toLocaleString()} numbers are waiting.`, l.id]);
    }
    for (const p of agents) {
      const has = progress.some(r => r.agent_id === p.id && r.status === 'pending');
      const mine = T.filter(c => c.agent_id === p.id).length;
      if (isToday && has && !mine && parts(now).h >= 11) alerts.push(['red', '!', `${p.full_name || p.email} hasn't called today`, 'They have numbers waiting.', null, p.id]);
    }
    const deadRate = pctTxt(cnt(T, 'dead_number'), T.length);
    if (T.length >= 20 && deadRate >= 15) alerts.push(['red', '!', `${deadRate}% dead numbers ${pName}`, 'Check the quality of the list being dialed.']);
    if (isToday && Y.length >= 10 && T.length && parts(now).h >= 14 && T.length < Y.length * 0.5) alerts.push(['amber', '↓', 'Fewer calls than yesterday', `${T.length} so far vs ${Y.length} yesterday.`]);
    if (online.length) alerts.unshift(['blue', '●', `${online.length} agent${online.length > 1 ? 's' : ''} online now`, online.filter(s => s.on_call).length + ' on a call.']);
    const alertCard = card('Needs attention', 'Things worth a look right now', `<div class="alerts">${alerts.slice(0, 7).map(([cls, ic, t, s, lid, aid]) =>
      `<div class="al ${cls}" ${lid ? `data-list="${esc(lid)}" style="cursor:pointer"` : aid ? `data-agent="${esc(aid)}" style="cursor:pointer"` : ''}><span class="ai">${ic}</span><div><b>${esc(t)}</b><span class="s">${esc(s)}</span></div></div>`).join('') || '<div class="al green"><span class="ai">✓</span><div><b>All good</b><span class="s">Nothing needs your attention.</span></div></div>'}</div>`);

    // ---- lists ----
    const listRows = lists.map(l => {
      const rows = progress.filter(p => p.list_id === l.id);
      const sum = st => rows.filter(r => r.status === st).reduce((s, r) => s + Number(r.n), 0);
      const total = sum('pending') + sum('called') + sum('skipped'), done = total - sum('pending');
      const ag = [...new Set(rows.map(r => r.agent_id))];
      const pct = total ? Math.round(done / total * 100) : 0;
      return `<tr class="click" data-list="${esc(l.id)}"><td><b>${esc(l.name)}</b>${l.enabled === false ? ' <span class="badge off">Disabled</span>' : ''}<div class="sub" style="margin:0;font-size:12px">${total.toLocaleString()} numbers</div></td>
        <td><div class="avs">${ag.slice(0, 5).map(id => `<span class="avc" title="${esc(agentName(id))}">${esc((agentName(id) || '?').split(/\s+/).map(w => w[0]).join('').slice(0, 2).toUpperCase())}</span>`).join('')}${ag.length > 5 ? `<span class="avc more">+${ag.length - 5}</span>` : ''}</div></td>
        <td class="num">${done.toLocaleString()} / ${total.toLocaleString()}</td>
        <td style="min-width:150px"><div class="pbar2"><i class="${pct === 100 ? 'done' : ''}" style="width:${pct}%"></i></div><div class="sub" style="margin:2px 0 0;font-size:12px">${pct}% done</div></td></tr>`;
    }).join('') || '<tr><td colspan="4" class="empty">No lead lists yet.</td></tr>';
    const listsCard = card('Lead lists', `${lists.filter(l => l.enabled !== false).length} active`, `<div class="scroll" style="max-height:380px"><table class="htable"><tr><th>List</th><th>Agents</th><th>Called</th><th>Progress</th></tr>${listRows}</table></div>`, '', '<a class="link" href="#/lists">View all →</a>');

    // ---- activity ----
    const recent = [...T].sort((a, b) => new Date(b.started_at) - new Date(a.started_at)).slice(0, 10).map(c =>
      `<div class="tl"><span class="tl-d" style="background:${DCOL[c.disposition] || '#98a2b3'}"></span><div><div class="tl-t">${esc(label(c.disposition))}${cleanLabel(c.label) ? ' · ' + esc(cleanLabel(c.label)) : ''}</div><div class="tl-s">${esc(callAgent(c))} · ${esc(fmtPhone(c.number))} · ${esc(ago(c.started_at))}${c.duration_sec ? ' · ' + fmtDur(c.duration_sec) : ''}</div></div></div>`).join('') || '<div class="empty">No calls yet.</div>';
    const actCard = card('Recent activity', 'Latest calls · ' + pName, `<div class="tlw">${recent}</div>`, '', '<a class="link" href="#/calls">All calls →</a>');

    // ---- agents today ----
    const rowsA = agents.map(p => {
      const m = T.filter(c => c.agent_id === p.id);
      const st = status.find(s => s.agent_id === p.id);
      const on = st && (Date.now() - new Date(st.last_seen)) / 1000 < ONLINE_SEC;
      return { p, m, on, call: on && st.on_call };
    }).sort((a, b) => cnt(b.m, 'interested') - cnt(a.m, 'interested') || b.m.length - a.m.length);
    const maxCalls = Math.max(1, ...rowsA.map(r => r.m.length));
    const agRows = rowsA.map(({ p, m, on, call }, i) =>
      `<tr class="click" data-agent="${esc(p.id)}"><td><span class="sd ${call ? 'call' : on ? 'on' : ''}" title="${call ? 'On a call' : on ? 'Online' : 'Offline'}"></span><b>${esc(p.full_name || p.email)}</b>${i === 0 && m.length ? ' <span title="Top today">🏆</span>' : ''}</td>
        <td class="num">${m.length}<span class="minibar2"><i style="width:${m.length / maxCalls * 100}%"></i></span></td><td class="num">${rate(m)}%</td><td class="num">${ansAgent(m)}</td><td class="num">${cnt(m, 'interested')}</td><td class="num">${fmtDur(talk(m))}</td></tr>`).join('') || '<tr><td colspan="6" class="empty">No agents yet.</td></tr>';
    const agCard = card('Agents · ' + pName, `${online.length} online · ${online.filter(s => s.on_call).length} on a call`, `<div class="scroll" style="max-height:380px"><table class="htable"><tr><th>Agent</th><th>Calls</th><th>Reached</th><th>Answered</th><th>Interested</th><th>Talk</th></tr>${agRows}</table></div>`, '', '<a class="link" href="#/agents">Details →</a>');

    // ---- where people pick up (last 14 days, by state) ----
    let stateCard = '';
    if (typeof BestTime !== 'undefined') {
      const st = {}; for (const c of W.trend.flatMap(byDay)) { const s = BestTime.STATE_OF[BestTime.areaOf(c.number)]; if (!s) continue; const x = st[s] || (st[s] = { n: 0, k: 0 }); x.n++; if (Conn.isHuman(c)) x.k++; if (c.disposition === 'cancelled') x.n--; }
      const top = Object.entries(st).filter(([, x]) => x.n >= 5).map(([s, x]) => [s, x, x.k / x.n]).sort((a, b) => b[2] - a[2]).slice(0, 8);
      stateCard = card('Where people pick up', 'Connect rate by state · ' + trendSub + ' (5+ calls)', `<div class="rbars">${top.map(([s, x, r]) => `<div class="rb"><span class="rb-l">${esc(s)}</span><span class="rb-t"><i style="width:${r * 100}%;background:${r >= .5 ? C.green : r >= .3 ? C.amber : C.red}"></i></span><span class="rb-v">${Math.round(r * 100)}%</span></div>`).join('') || '<div class="sub">Not enough calls yet.</div>'}</div>`, '', '<a class="link" href="#/insights">Insights →</a>');
    }

    const onlinePill = `<span class="pill"><i style="background:${online.length ? C.green : '#d0d5dd'}"></i>${online.length} online</span>`;
    const callPill = `<span class="pill"><i style="background:${C.amber}"></i>${online.filter(s => s.on_call).length} on a call</span>`;
    const opt = (list, v) => list.map(([k, n]) => `<option value="${k}"${k === v ? ' selected' : ''}>${n}</option>`).join('');
    const controls = `<div class="hctl"><select id="h-period" title="Period">${opt(PERIODS, st.mode)}</select>
      <input id="h-date" type="date" value="${esc(st.date || keyOf(now))}" max="${keyOf(now)}"${st.mode === 'date' ? '' : ' hidden'}>
      <select id="h-tz" title="Which clock defines a day">${opt(TZS, st.tz)}</select></div>`;
    const html = `<div class="hhead"><div><div class="crumb">Pages / Dashboard</div><h1>Dashboard</h1><p>${W.P.length === 1 ? keyLabel(W.P[0]) + (isToday ? ' (today)' : '') : keyLabel(W.P[0]) + ' – ' + keyLabel(W.P[W.P.length - 1])} · ${tzName}</p></div><div class="live">${onlinePill}${callPill}${controls}</div></div>
      ${kpis}
      ${Conn.card(Conn.analyse(T, c => parts(c.started_at).h), { sub: 'Counts phone numbers, not calls (a number called 3 times counts once, by its best result). The cards above count calls.', hourLabel: tzName })}
      ${charts}
      <div class="hgrid3">${donutCard}${alertCard}${stateCard}</div>
      <div class="hgrid2">${listsCard}${actCard}</div>
      <div class="hgrid2" style="grid-template-columns:minmax(0,1fr)">${agCard}</div>`;
    // keep the page still while refreshing: only replace when something changed
    if (box.__html !== html) { box.innerHTML = html; box.__html = html; }
    const ps = box.querySelector('#h-period'), dt = box.querySelector('#h-date'), tz = box.querySelector('#h-tz');
    ps.onchange = () => { st.mode = ps.value; if (st.mode === 'date' && !st.date) st.date = keyOf(new Date()); save(); box.__html = ''; reload(); };
    dt.onchange = () => { if (!dt.value) return; st.mode = 'date'; st.date = dt.value; save(); box.__html = ''; reload(); };
    tz.onchange = () => { st.tz = tz.value; save(); box.__html = ''; reload(); };
    box.querySelectorAll('[data-list]').forEach(r => r.onclick = () => onList(r.dataset.list));
    box.querySelectorAll('[data-agent]').forEach(r => r.onclick = () => onAgent(r.dataset.agent));
  }
  function skeleton(box) {
    if (box.__html) return;
    const blk = (h, cls = '') => `<div class="sk ${cls}" style="height:${h}px"></div>`;
    box.innerHTML = `<div class="hhead"><div><div class="crumb">Pages / Dashboard</div><h1>Dashboard</h1><p>Loading your numbers…</p></div></div>
      <div class="hkpis">${blk(110).repeat(6)}</div><div class="hgrid3">${blk(300).repeat(3)}</div><div class="hgrid2">${blk(320)}${blk(320)}</div>`;
  }
  return { render, since, skeleton };
})();
