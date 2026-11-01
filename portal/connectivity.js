// Connectivity: how many numbers are live lines, and how many real people picked up.
// Counted per unique phone number (a number called 3 times counts once, by its best outcome).
// "Answered" set automatically by the extension is NOT trusted as a person: a voicemail greeting can look answered.
const Conn = (() => {
  const HUMAN = new Set(['interested', 'not_interested', 'callback', 'wrong_number', 'do_not_call']);
  const ACTIVE = new Set(['voicemail', 'no_answer', 'busy', 'missed']);
  const DEAD = new Set(['dead_number', 'failed']);
  const RANK = { human: 3, active: 2, dead: 1, none: 0 };
  const COL = { human: '#12b76a', active: '#3257F7', dead: '#f04438', none: '#d0d5dd' };
  const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  function callClass(c) {
    const d = c.disposition;
    if (d === 'answered') return c.disposition_source === 'agent' || c.disposition_source === 'admin' ? 'human' : 'active';
    if (HUMAN.has(d)) return 'human';
    if (ACTIVE.has(d)) return 'active';
    if (DEAD.has(d)) return 'dead';
    return 'none'; // cancelled before it rang, other
  }
  const isHuman = c => callClass(c) === 'human';

  function analyse(calls, hourOf = c => new Date(c.started_at).getHours()) {
    const best = new Map(), sig = {}, hours = Array(24).fill(0), hoursAll = Array(24).fill(0);
    let humanCalls = 0;
    for (const c of calls) {
      const k = c.number; const cls = callClass(c);
      if (!best.has(k) || RANK[cls] > RANK[best.get(k)]) best.set(k, cls);
      const key = c.disposition === 'answered' ? (cls === 'human' ? 'answered_agent' : 'answered_auto') : c.disposition;
      sig[key] = (sig[key] || 0) + 1;
      const h = hourOf(c);
      if (cls !== 'none') hoursAll[h]++;
      if (cls === 'human') { humanCalls++; hours[h]++; }
    }
    const n = { human: 0, active: 0, dead: 0, none: 0 };
    for (const v of best.values()) n[v]++;
    const reached = n.human + n.active + n.dead; // numbers we got a real result for
    return { total: best.size, calls: calls.length, humanCalls, n, reached, sig, hours, hoursAll,
      connectivity: reached ? (n.human + n.active) / reached : null,
      pickup: reached ? n.human / reached : null,
      pickupOfLive: n.human + n.active ? n.human / (n.human + n.active) : null,
      deadRate: reached ? n.dead / reached : null };
  }

  const pct = v => (v == null ? '—' : Math.round(v * 100) + '%');
  const SIG = [
    ['Person picked up', 'human', [['interested', 'Interested'], ['not_interested', 'Not interested'], ['callback', 'Call back'], ['answered_agent', 'Answered (marked by agent)'], ['wrong_number', 'Wrong number'], ['do_not_call', 'Do not call']]],
    ['Line active, no person', 'active', [['voicemail', 'Voicemail'], ['no_answer', 'No answer'], ['busy', 'Busy'], ['answered_auto', 'Answered (auto · often voicemail)'], ['missed', 'Missed']]],
    ['Not a live number', 'dead', [['dead_number', 'Dead number'], ['failed', 'Call failed']]],
    ['Not counted', 'none', [['cancelled', 'Cancelled before it rang'], ['other', 'Other']]]
  ];

  // HTML card. opts: { title, sub, compact, hourLabel }
  function card(s, opts = {}) {
    const { title = 'Connectivity', sub = 'Per unique number: is the line live, and did a real person pick up?', compact = false } = opts;
    if (!s.total) return `<div class="hc conn"><div class="hc-h"><div class="hc-t">${esc(title)}</div><div class="hc-s">${esc(sub)}</div></div><div class="empty">No calls in this period.</div></div>`;
    const tile = (cls, big, lab, foot, col) => `<div class="ct ${cls}"><div class="ct-v" style="color:${col || 'inherit'}">${big}</div><div class="ct-l">${lab}</div><div class="ct-f">${foot}</div></div>`;
    const segs = [['human', 'Picked up by a person'], ['active', 'Active line, no person'], ['dead', 'Dead / invalid'], ['none', 'Not reached yet']];
    const bar = `<div class="cbar">${segs.map(([k, l]) => s.n[k] ? `<i style="width:${s.n[k] / s.total * 100}%;background:${COL[k]}" title="${l}: ${s.n[k]} numbers (${Math.round(s.n[k] / s.total * 100)}%)"></i>` : '').join('')}</div>
      <div class="legend">${segs.map(([k, l]) => `<span><i style="background:${COL[k]}"></i>${l} <b>${s.n[k].toLocaleString()}</b></span>`).join('')}</div>`;
    const tiles = `<div class="ctiles">
      ${tile('', s.total.toLocaleString(), 'Different numbers dialed', s.calls === s.total ? `${s.calls.toLocaleString()} calls, one per number` : `${s.calls.toLocaleString()} calls · ${(s.calls - s.total).toLocaleString()} were repeats`)}
      ${tile('', pct(s.connectivity), 'Connectivity (live numbers)', `${(s.n.human + s.n.active).toLocaleString()} of ${s.reached.toLocaleString()} numbers rang through`, COL.active)}
      ${tile('', pct(s.pickup), 'Numbers a person picked up', `${s.n.human.toLocaleString()} numbers · ${s.humanCalls.toLocaleString()} calls`, COL.human)}
      ${tile('', pct(s.deadRate), 'Dead numbers', `${s.n.dead.toLocaleString()} numbers`, COL.dead)}
    </div>`;
    if (compact) return `<div class="hc conn"><div class="hc-h"><div class="hc-t">${esc(title)}</div><div class="hc-s">${esc(sub)}</div></div>${tiles}${bar}</div>`;
    const sigHtml = SIG.map(([g, cls, items]) => {
      const rows = items.filter(([k]) => s.sig[k]);
      if (!rows.length) return '';
      return `<div class="cg"><div class="cg-h"><i style="background:${COL[cls]}"></i>${g}</div>${rows.map(([k, l]) => `<div class="cg-r"><span>${l}</span><b>${s.sig[k].toLocaleString()}</b></div>`).join('')}</div>`;
    }).join('');
    const usedH = s.hoursAll.map((a, h) => (a ? h : -1)).filter(h => h >= 0);
    const hrs = usedH.length ? Array.from({ length: Math.max(...usedH) - Math.min(...usedH) + 1 }, (_, i) => Math.min(...usedH) + i).map(h => [h, s.hours[h], s.hoursAll[h]]) : [];
    const mx = Math.max(1, ...hrs.map(x => x[1]));
    const bestH = hrs.filter(x => x[2] >= 5).sort((a, b) => b[1] / b[2] - a[1] / a[2])[0];
    const hl = h => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
    const hourHtml = hrs.length ? `<div class="chours">${hrs.map(([h, v, a]) => `<div class="ch" title="${hl(h)}: ${a ? `${v} people picked up out of ${a} calls (${Math.round(v / a * 100)}%)` : 'no calls'}"><div class="ch-b"><i style="height:${v / mx * 100}%"></i></div><div class="ch-l">${(h % 12 || 12) + (h < 12 ? 'a' : 'p')}</div></div>`).join('')}</div>
      <div class="hc-s" style="margin-top:6px">${bestH ? `Best pickup hour: <b>${hl(bestH[0])}</b> · ${Math.round(bestH[1] / bestH[2] * 100)}% of calls reached a person` : 'Hover a bar for details'}${opts.hourLabel ? ' · ' + esc(opts.hourLabel) : ''}</div>` : '<div class="sub">No calls yet.</div>';
    return `<div class="hc conn"><div class="hc-h"><div class="hc-t">${esc(title)}</div><div class="hc-s">${esc(sub)}</div></div>
      ${tiles}${bar}
      <div class="cgrid"><div><div class="cs-t">What the calls tell us <span class="sub">(calls)</span></div><div class="cgroups">${sigHtml}</div></div>
      <div><div class="cs-t">When real people pick up <span class="sub">(people reached per hour)</span></div>${hourHtml}</div></div></div>`;
  }
  return { callClass, isHuman, analyse, card, COL };
})();
