// Connectivity: how many numbers are live lines, and how many real people picked up.
// Counted per unique phone number (a number called 3 times counts once, by its best outcome).
// "Answered" set automatically by the extension is NOT trusted as a person: a voicemail greeting can look answered.
const Conn = (() => {
  const HUMAN = new Set(['interested', 'not_interested', 'callback', 'wrong_number', 'do_not_call']);
  const ACTIVE = new Set(['voicemail', 'no_answer', 'busy', 'missed']);
  const DEAD = new Set(['dead_number', 'failed']);
  const RANK = { human: 3, active: 2, dead: 1, none: 0 };
  const COL = { human: '#12b76a', active: '#3257F7', dead: '#f04438', none: '#d0d5dd', vm: '#7a5af8' };
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
    const vmSeen = new Set(); // numbers where at least one call went to voicemail
    for (const c of calls) {
      const k = c.number; const cls = callClass(c);
      if (c.disposition === 'voicemail') vmSeen.add(k);
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
    // voicemail numbers: went to voicemail and no person ever picked up on that number
    let vmNums = 0; for (const k of vmSeen) if (best.get(k) !== 'human') vmNums++;
    const vmCalls = sig.voicemail || 0;
    return { total: best.size, calls: calls.length, humanCalls, n, reached, sig, hours, hoursAll, vmNums, vmCalls,
      vmRate: best.size ? vmNums / best.size : null, vmCallRate: calls.length ? vmCalls / calls.length : null,
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

  // The assistant's read of the numbers: short plain sentences, built from the counts above (no AI cost).
  function explain(s, hourLabel) {
    const f = v => v.toLocaleString(), g = k => s.sig[k] || 0, P = (a, b) => (b ? Math.round(a / b * 100) : 0);
    const plural = (n, one, many) => `${f(n)} ${n === 1 ? one : many}`;
    const out = [];
    out.push(`You dialed <b>${plural(s.total, 'different number', 'different numbers')}</b>${s.calls !== s.total ? ` in ${plural(s.calls, 'call', 'calls')} (${f(s.calls - s.total)} were repeat dials)` : ''}.`);
    if (s.n.human) {
      const bits = [['interested', 'interested'], ['callback', 'asked for a call back'], ['not_interested', 'not interested'], ['wrong_number', 'wrong number'], ['do_not_call', 'do not call']].filter(([k]) => g(k)).map(([k, l]) => `${f(g(k))} ${l}`);
      out.push(`<b>A real person picked up on ${plural(s.n.human, 'number', 'numbers')}</b> — ${P(s.n.human, s.total)}% of the ${f(s.total)} numbers dialed, over ${plural(s.humanCalls, 'call', 'calls')}${bits.length ? '. Results: ' + bits.join(', ') : ''}.`);
    } else if (s.reached) out.push('<b>Nobody has picked up yet</b> in this period.');
    if (s.vmCalls) out.push(`<b>${plural(s.vmNums, 'number', 'numbers')} went to voicemail</b> — ${P(s.vmNums, s.total)}% of the ${f(s.total)} numbers dialed, with no person reached on ${s.vmNums === 1 ? 'it' : 'them'}. That's ${plural(s.vmCalls, 'voicemail call', 'voicemail calls')} in total (${P(s.vmCalls, s.calls)}% of all calls).`);
    else if (s.calls) out.push('<b>No calls went to voicemail</b> in this period.');
    if (s.n.active) {
      const bits = [['no_answer', 'rang with no answer'], ['answered_auto', 'auto-answered (usually a voicemail greeting)'], ['busy', 'busy'], ['missed', 'missed']].filter(([k]) => g(k)).map(([k, l]) => `${f(g(k))} ${l}`);
      out.push(`<b>${plural(s.n.active, 'number is', 'numbers are')} active but no person answered</b>${s.vmNums ? ' (this includes the voicemail numbers)' : ''}${bits.length ? '; other calls: ' + bits.join(', ') : ''}. Worth trying again at a different time.`);
    }
    if (s.n.dead) out.push(`<b>${plural(s.n.dead, 'number is', 'numbers are')} dead or invalid</b> (${P(s.n.dead, s.reached)}%)${g('failed') ? `, ${f(g('failed'))} calls failed to connect` : ''}. No need to call ${s.n.dead === 1 ? 'it' : 'them'} again.`);
    if (g('cancelled')) out.push(`${plural(g('cancelled'), 'call was', 'calls were')} cancelled before ringing, so ${g('cancelled') === 1 ? 'it isn’t' : 'they aren’t'} counted.`);
    if (s.n.none && s.n.none !== g('cancelled')) out.push(`${plural(s.n.none, 'number has', 'numbers have')} no result yet.`);
    const used = s.hoursAll.map((a, h) => [h, s.hours[h], a]).filter(x => x[2] >= 5);
    const best = used.sort((a, b) => b[1] / b[2] - a[1] / a[2])[0];
    if (best && best[1]) out.push(`People picked up most around <b>${(best[0] % 12 || 12) + (best[0] < 12 ? ' AM' : ' PM')}</b>${hourLabel ? ' (' + esc(hourLabel.toLowerCase().startsWith('your') ? 'your time' : hourLabel) + ')' : ''} — ${P(best[1], best[2])}% of calls reached a person.`);
    if (s.reached >= 20) {
      const c = s.connectivity, d = s.deadRate;
      out.push(d >= 0.25 ? `Heads-up: about 1 in ${Math.max(2, Math.round(1 / d))} numbers is dead — this list may need cleaning.` : c >= 0.85 ? 'Overall most numbers on your lists are live.' : 'Overall connectivity is fair.');
    }
    return out;
  }
  // How the bot opens the report: a different line each time the portal opens, always talking to you.
  const OPEN = [
    ['Hey {name}, I made this quick report for you', 'I went through {calls} from this period. Here’s what I found:'],
    ['Hi {name}! I wrote up a little summary for you', 'I read all {calls} so you don’t have to:'],
    ['{name}, here’s what I noticed', 'I looked at {calls} and pulled out the important bits for you:'],
    ['Hey {name}, your report is ready', 'I counted every one of the {calls} for you:'],
    ['{name}, I’ve done the counting', 'Here’s what {calls} tell us:'],
    ['Hi {name}, I put this together for you', 'A quick look at {calls}, in plain words:'],
    ['{name}, I’ve got your numbers', 'I sorted through {calls}. Here’s the short version:'],
    ['Hey {name}! Here’s my quick read', 'I went over {calls} and this is what stood out to me:'],
    ['Hi {name}, I summed things up for you', 'From {calls}, this is what I see:'],
    ['{name}, I made you a little cheat sheet', 'Everything you need from {calls}, at a glance:'],
    ['Hey {name}, here’s how things are going', 'I checked {calls} for you. Here you go:'],
    ['Hi {name}, I’ve read through your calls', '{calls} in total. Here’s what I learned:'],
    ['{name}, I wrote this up just for you', 'My quick notes from {calls}:'],
    ['Hey {name}, let me catch you up', 'I went through {calls}. Here’s the story so far:'],
    ['Hi {name}, here’s your quick briefing', 'I looked at {calls} and kept it short for you:'],
    ['{name}, I did the math for you', 'Here’s what {calls} add up to:'],
    ['Hey {name}, I’ve got a quick update for you', 'I read through {calls}. These are the highlights:'],
    ['Hi {name}, here’s what I found', 'I dug through {calls} so you can see it all in one place:'],
    ['{name}, ready for your report?', 'I went over {calls} and summed them up for you:'],
    ['Hey {name}, here’s your summary', 'I checked {calls} and wrote down what matters:']
  ];
  let pick = Math.floor(Math.random() * OPEN.length); // same line while you stay on the page; a new one each visit
  const newGreeting = () => { let n; do { n = Math.floor(Math.random() * OPEN.length); } while (n === pick && OPEN.length > 1); pick = n; };
  const firstName = me => { const n = String(me || '').split(/[\s@._]/)[0]; return n ? n[0].toUpperCase() + n.slice(1) : ''; };
  function opener(me, calls) {
    const name = firstName(me);
    const fill = t => esc(t.replace('{calls}', `${calls.toLocaleString()} ${calls === 1 ? 'call' : 'calls'}`))
      .replace('{name}', name ? esc(name) : 'there');
    let [t, sub] = OPEN[pick];
    if (!name) t = t.replace(/^\{name\}, /, '').replace(/^./, c => c.toUpperCase());
    sub = fill(sub); return [fill(t), sub.charAt(0).toUpperCase() + sub.slice(1)];
  }
  function botStrip(s, opts) {
    const A = typeof AIPage !== 'undefined' ? AIPage : null;
    const lines = explain(s, opts.hourLabel);
    return `<div class="cbot"><div class="cbot-av">${A ? A.botHtml('mini') : ''}</div><div class="cbot-main">
      <div class="cbot-h"><div>${(([t, sub]) => `<div class="cbot-t">${t}</div><div class="cbot-s">${sub}</div>`)(opener(opts.me, s.calls))}</div></div>
      <ul class="ai-bullets cbot-text">${lines.map((l, i) => `<li style="animation-delay:${(i * 0.1).toFixed(1)}s">${l}</li>`).join('')}</ul></div></div>`;
  }

  // HTML card. opts: { title, sub, compact, hourLabel, bot }
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
      ${tile('', pct(s.vmRate), 'Went to voicemail', `${s.vmNums.toLocaleString()} of ${s.total.toLocaleString()} numbers · ${s.vmCalls.toLocaleString()} voicemail calls`, COL.vm)}
      ${tile('', pct(s.deadRate), 'Dead numbers', `${s.n.dead.toLocaleString()} numbers`, COL.dead)}
    </div>`;
    if (compact) return `<div class="hc conn"><div class="hc-h"><div class="hc-t">${esc(title)}</div><div class="hc-s">${esc(sub)}</div></div>${tiles}${bar}</div>`;
    const sigHtml = SIG.map(([g, cls, items]) => {
      const rows = items.filter(([k]) => s.sig[k]);
      if (!rows.length) return '';
      return `<div class="cg"><div class="cg-h"><i style="background:${COL[cls]}"></i>${g}</div>${rows.map(([k, l]) => `<div class="cg-r"><span>${l}</span><b>${s.sig[k].toLocaleString()}</b></div>`).join('')}</div>`;
    }).join('');
    const any = s.hoursAll.some(a => a);
    const hrs = any ? Array.from({ length: 24 }, (_, h) => [h, s.hours[h], s.hoursAll[h]]) : []; // the whole day, midnight to 11 PM
    const mx = Math.max(1, ...hrs.map(x => x[1]));
    const bestH = hrs.filter(x => x[2] >= 5).sort((a, b) => b[1] / b[2] - a[1] / a[2])[0];
    const hl = h => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');
    const hourHtml = hrs.length ? `<div class="chours">${hrs.map(([h, v, a]) => `<div class="ch" title="${hl(h)}: ${a ? `${v} people picked up out of ${a} calls (${Math.round(v / a * 100)}%)` : 'no calls'}"><div class="ch-b"><i style="height:${v / mx * 100}%"></i></div><div class="ch-l">${(h % 12 || 12) + (h < 12 ? 'a' : 'p')}</div></div>`).join('')}</div>
      <div class="hc-s" style="margin-top:6px">${bestH ? `Best pickup hour: <b>${hl(bestH[0])}</b> · ${Math.round(bestH[1] / bestH[2] * 100)}% of calls reached a person` : 'Hover a bar for details'}${opts.hourLabel ? ' · ' + esc(opts.hourLabel) : ''}</div>` : '<div class="sub">No calls yet.</div>';
    return `<div class="hc conn"><div class="hc-h"><div class="hc-t">${esc(title)}</div><div class="hc-s">${esc(sub)}</div></div>
      ${tiles}${bar}${opts.bot ? botStrip(s, opts) : ''}
      <div class="cgrid"><div><div class="cs-t">What the calls tell us <span class="sub">(calls)</span></div><div class="cgroups">${sigHtml}</div></div>
      <div><div class="cs-t">When real people pick up <span class="sub">(people reached per hour)</span></div>${hourHtml}</div></div></div>`;
  }
  return { callClass, isHuman, analyse, card, explain, newGreeting, COL };
})();
