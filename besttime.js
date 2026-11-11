// "Best time to call": connect rate by hour, weekday, area code and state, from your own call history.
const BestTime = (() => {
  const AREA = {
    AL: '205 251 256 334 659 938', AK: '907', AZ: '480 520 602 623 928', AR: '479 501 870',
    CA: '209 213 279 310 323 341 350 369 408 415 424 442 510 530 559 562 619 626 628 650 657 661 669 707 714 747 760 805 818 820 831 840 858 909 916 925 949 951',
    CO: '303 719 720 970 983', CT: '203 475 860 959', DE: '302', DC: '202 771',
    FL: '239 305 321 324 352 386 407 448 561 645 656 727 754 772 786 813 850 863 904 941 954',
    GA: '229 404 470 478 678 706 762 770 912 943', HI: '808', ID: '208 986',
    IL: '217 224 309 312 331 447 464 618 630 708 730 773 779 815 847 872', IN: '219 260 317 463 574 765 812 930',
    IA: '319 515 563 641 712', KS: '316 620 785 913', KY: '270 364 502 606 859', LA: '225 318 337 504 985', ME: '207',
    MD: '240 301 410 443 667', MA: '339 351 413 508 617 774 781 857 978', MI: '231 248 269 313 517 586 616 734 810 906 947 989',
    MN: '218 320 507 612 651 763 952', MS: '228 601 662 769', MO: '314 417 573 636 660 816 975', MT: '406',
    NE: '308 402 531', NV: '702 725 775', NH: '603', NJ: '201 551 609 640 732 848 856 862 908 973', NM: '505 575',
    NY: '212 315 332 347 363 516 518 585 607 631 646 680 716 718 838 845 914 917 929 934',
    NC: '252 336 704 743 828 910 919 980 984', ND: '701', OH: '216 220 234 326 330 380 419 440 513 567 614 740 937',
    OK: '405 539 572 580 918', OR: '458 503 541 971', PA: '215 223 267 272 412 445 484 570 610 717 724 814 835 878',
    RI: '401', SC: '803 839 843 854 864', SD: '605', TN: '423 615 629 731 865 901 931',
    TX: '210 214 254 281 325 346 361 409 430 432 469 512 682 713 726 737 806 817 830 832 903 915 936 940 956 972 979',
    UT: '385 435 801', VT: '802', VA: '276 434 540 571 703 757 804 948', WA: '206 253 360 425 509 564', WV: '304 681',
    WI: '262 274 414 534 608 715 920', WY: '307'
  };
  const STATE_OF = {};
  for (const [st, codes] of Object.entries(AREA)) for (const c of codes.split(' ')) STATE_OF[c] = st;

  const NAMES = { AL:'Alabama',AK:'Alaska',AZ:'Arizona',AR:'Arkansas',CA:'California',CO:'Colorado',CT:'Connecticut',DE:'Delaware',DC:'Washington DC',FL:'Florida',GA:'Georgia',HI:'Hawaii',ID:'Idaho',IL:'Illinois',IN:'Indiana',IA:'Iowa',KS:'Kansas',KY:'Kentucky',LA:'Louisiana',ME:'Maine',MD:'Maryland',MA:'Massachusetts',MI:'Michigan',MN:'Minnesota',MS:'Mississippi',MO:'Missouri',MT:'Montana',NE:'Nebraska',NV:'Nevada',NH:'New Hampshire',NJ:'New Jersey',NM:'New Mexico',NY:'New York',NC:'North Carolina',ND:'North Dakota',OH:'Ohio',OK:'Oklahoma',OR:'Oregon',PA:'Pennsylvania',RI:'Rhode Island',SC:'South Carolina',SD:'South Dakota',TN:'Tennessee',TX:'Texas',UT:'Utah',VT:'Vermont',VA:'Virginia',WA:'Washington',WV:'West Virginia',WI:'Wisconsin',WY:'Wyoming' };

  const ET = 'America/New_York', CT = 'America/Chicago', MT = 'America/Denver', PT = 'America/Los_Angeles';
  const TZ = { CT: ET, DE: ET, DC: ET, GA: ET, ME: ET, MD: ET, MA: ET, NH: ET, NJ: ET, NY: ET, NC: ET, OH: ET, PA: ET, RI: ET, SC: ET, VT: ET, VA: ET, WV: ET, FL: ET, IN: ET, MI: ET, KY: ET,
    AL: CT, AR: CT, IL: CT, IA: CT, KS: CT, LA: CT, MN: CT, MS: CT, MO: CT, NE: CT, ND: CT, OK: CT, SD: CT, TX: CT, WI: CT, TN: CT,
    CO: MT, ID: MT, MT: MT, NM: MT, UT: MT, WY: MT, AZ: 'America/Phoenix', CA: PT, NV: PT, OR: PT, WA: PT, AK: 'America/Anchorage', HI: 'Pacific/Honolulu' };

  // Tile map: [column, row] per state
  const TILE = { AK:[0,0], ME:[10,0], WI:[5,1], VT:[9,1], NH:[10,1],
    WA:[0,2], ID:[1,2], MT:[2,2], ND:[3,2], MN:[4,2], IL:[5,2], MI:[6,2], NY:[8,2], MA:[9,2],
    OR:[0,3], NV:[1,3], WY:[2,3], SD:[3,3], IA:[4,3], IN:[5,3], OH:[6,3], PA:[7,3], NJ:[8,3], CT:[9,3], RI:[10,3],
    CA:[0,4], UT:[1,4], CO:[2,4], NE:[3,4], MO:[4,4], KY:[5,4], WV:[6,4], VA:[7,4], MD:[8,4], DE:[9,4],
    AZ:[1,5], NM:[2,5], KS:[3,5], AR:[4,5], TN:[5,5], NC:[6,5], SC:[7,5], DC:[8,5],
    OK:[3,6], LA:[4,6], MS:[5,6], AL:[6,6], GA:[7,6], HI:[0,7], TX:[3,7], FL:[8,7] };

  const DAYS = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
  let H0 = 7, H1 = 21; // hours shown: set from the data on each render (agents may call another time zone's day)
  const hourLabel = h => (h % 12 || 12) + (h < 12 ? 'a' : 'p');
  const hourLong = h => (h % 12 || 12) + (h < 12 ? ' AM' : ' PM');

  // Same rules as the dashboard (connectivity.js):
  //  person: a real person picked up (interested, not interested, call back, wrong number, do not call, Answered marked by agent)
  //  live:   the number is a live line (person, voicemail, no answer, busy, auto "answered") vs dead / failed
  // [label, counts as a hit, counts in the denominator]
  const cls = c => (typeof Conn !== 'undefined' ? Conn.callClass(c) : 'none');
  const METRICS = {
    person: ['Talked to a person', c => cls(c) === 'human', c => c.disposition !== 'cancelled'],
    live: ['Number connect rate (live line)', c => cls(c) === 'human' || cls(c) === 'active', c => cls(c) !== 'none'],
    interested: ['Interested rate', c => c.disposition === 'interested', c => c.disposition !== 'cancelled']
  };
  const rate = (calls, m) => { const d = calls.filter(c => c.direction !== 'incoming' && METRICS[m][2](c)); return d.length ? [d.filter(METRICS[m][1]).length, d.length] : [0, 0]; };

  const ui = { metric: 'person', tz: 'lead', state: null, tip: null };
  const fmts = new Map();
  const parts = (tz, ts) => {
    let f = fmts.get(tz);
    if (!f) fmts.set(tz, f = new Intl.DateTimeFormat('en-US', { timeZone: tz, weekday: 'short', hour: 'numeric', hourCycle: 'h23' }));
    const o = {}; for (const p of f.formatToParts(new Date(ts))) o[p.type] = p.value;
    return { day: (['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].indexOf(o.weekday) + 6) % 7, hour: +o.hour % 24 };
  };
  const areaOf = n => {
    const d = String(n || '').replace(/\D/g, '');
    const a = d.length === 11 && d[0] === '1' ? d.slice(1, 4) : d.length === 10 ? d.slice(0, 3) : '';
    return a;
  };

  const pct = x => (x * 100).toFixed(x < .1 && x > 0 ? 1 : 0) + '%';
  const shade = (rate, n, lo, hi, rgb = '50,87,247', ink = '#1d2b6b') => {
    if (!n) return ['#f9fafb', '#98a2b3'];
    const a = Math.max(0, Math.min(1, (rate - lo) / ((hi - lo) || 1))); // stretch so differences are visible
    const bg = `rgba(${rgb},${(0.1 + a * 0.9).toFixed(2)})`;
    return [bg, a > 0.55 ? '#fff' : ink];
  };
  // each section has its own colour
  const SEC = { heat: '#3257F7', map: '#0e9384', days: '#7a5af8', hours: '#12b76a', area: '#f79009' };
  const sec = (node, c) => { node.classList.add('bt-sec'); node.style.setProperty('--sc', c); return node; };

  function analyse(calls, helpers) {
    const isMetric = METRICS[ui.metric][1];
    const rows = calls.filter(c => c.direction !== 'incoming' && METRICS[ui.metric][2](c));
    const total = { n: 0, hit: 0 };
    const cells = Array.from({ length: 7 }, () => Array.from({ length: 24 }, () => ({ n: 0, hit: 0 })));
    const byHour = Array.from({ length: 24 }, () => ({ n: 0, hit: 0 }));
    const byDay = Array.from({ length: 7 }, () => ({ n: 0, hit: 0 }));
    const byState = {}, byArea = {};
    for (const c of rows) {
      const code = areaOf(c.number), st = STATE_OF[code] || null;
      const hit = isMetric(c) ? 1 : 0;
      const stateStats = (byState[st || '??'] = byState[st || '??'] || { n: 0, hit: 0, hours: Array.from({ length: 24 }, () => ({ n: 0, hit: 0 })) });
      stateStats.n++; stateStats.hit += hit;
      if (code) { const a = (byArea[code] = byArea[code] || { code, st, n: 0, hit: 0, hours: Array.from({ length: 24 }, () => ({ n: 0, hit: 0 })) }); a.n++; a.hit += hit; }
      if (ui.state && st !== ui.state) continue;
      const tz = ui.tz === 'lead' ? (st ? TZ[st] : undefined) : ui.tz === 'pk' ? 'Asia/Karachi' : undefined;
      const t = tz ? parts(tz, c.started_at) : (() => { const d = new Date(c.started_at); return { day: (d.getDay() + 6) % 7, hour: d.getHours() }; })();
      const x = cells[t.day][t.hour]; x.n++; x.hit += hit;
      byHour[t.hour].n++; byHour[t.hour].hit += hit; byDay[t.day].n++; byDay[t.day].hit += hit;
      total.n++; total.hit += hit;
      stateStats.hours[t.hour].n++; stateStats.hours[t.hour].hit += hit;
      if (code) { const a = byArea[code]; a.hours[t.hour].n++; a.hours[t.hour].hit += hit; }
    }
    return { rows, total, cells, byHour, byDay, byState, byArea };
  }

  // Shrink small samples toward the overall rate so one lucky call doesn't top the chart.
  const K = 5;
  const smooth = (x, base) => (x.hit + base * K) / (x.n + K);
  const bestHour = (hours, base) => {
    let best = null;
    hours.forEach((x, h) => { if (h < H0 || h > H1 || x.n < 2) return; const r = smooth(x, base); if (!best || r > best.r) best = { h, r, x }; });
    return best;
  };

  function render(box, calls, el, onChange) {
    if (!METRICS[ui.metric]) ui.metric = 'person';
    const base0 = (() => { const [h, n] = rate(calls, ui.metric); return n ? h / n : 0; })();
    const A = analyse(calls);
    { const used = A.byHour.map((x, h) => (x.n ? h : -1)).filter(h => h >= 0);
      H0 = used.length ? Math.min(...used) : 7; H1 = used.length ? Math.max(...used) : 21;
      while (H1 - H0 < 9) { if (H0 > 0) H0--; if (H1 - H0 < 9 && H1 < 23) H1++; if (H0 === 0 && H1 === 23) break; } }
    const base = A.total.n ? A.total.hit / A.total.n : base0;
    const mLabel = METRICS[ui.metric][0];

    const sel = (opts, val, fn) => { const s = el('select', {}, Object.entries(opts).map(([k, v]) => el('option', { value: k, textContent: v, selected: k === val }))); s.onchange = () => fn(s.value); return s; };
    const controls = el('div', { className: 'bt-controls' },
      el('label', {}, 'Measure ', sel({ person: 'Talked to a person', live: 'Number connect rate (live line)', interested: 'Interested rate' }, ui.metric, v => { ui.metric = v; onChange(); })),
      el('label', {}, 'Time zone ', sel({ lead: "Lead's local time (from area code)", you: 'Your time (this computer)', pk: 'Pakistan time (PKT)' }, ui.tz, v => { ui.tz = v; onChange(); })),
      ui.state ? el('button', { className: 'btn', textContent: `Showing ${NAMES[ui.state]} ✕ clear`, onclick: () => { ui.state = null; onChange(); } }) : null);

    // ---- headline cards
    const dayAgg = A.byDay.map((x, i) => ({ i, x, r: smooth(x, base) })).filter(d => d.x.n >= 2).sort((a, b) => b.r - a.r);
    const hourAgg = A.byHour.map((x, h) => ({ h, x, r: smooth(x, base) })).filter(d => d.h >= H0 && d.h <= H1 && d.x.n >= 2).sort((a, b) => b.r - a.r);
    const stAgg = Object.entries(A.byState).filter(([k, x]) => k !== '??' && x.n >= 5).map(([k, x]) => ({ k, x, r: smooth(x, base0 || base) })).sort((a, b) => b.r - a.r);
    const card = (l, v, sub, c) => el('div', { className: 'kpi', style: `--c:${c}` }, el('div', { className: 'v', textContent: v }), el('div', { className: 'l', textContent: l }), sub ? el('div', { className: 'sub', style: 'margin:2px 0 0;font-size:12px', textContent: sub }) : null);
    const cards = el('div', { className: 'kpis' },
      ...(() => { const scope = ui.state ? calls.filter(c => STATE_OF[areaOf(c.number)] === ui.state) : calls;
        const [ph, pn] = rate(scope, 'person'), [lh, ln] = rate(scope, 'live');
        return [card('Talked to a person', pn ? pct(ph / pn) : '—', `${ph} of ${pn} calls · a real person picked up`, '#12b76a'),
          card('Number connect rate', ln ? pct(lh / ln) : '—', `${lh} of ${ln} calls rang a live line`, 'var(--blue)')]; })(),
      card('Best hour', hourAgg[0] ? hourLong(hourAgg[0].h) : '—', hourAgg[0] ? `${pct(hourAgg[0].x.hit / hourAgg[0].x.n)} of ${hourAgg[0].x.n} calls` : 'Need more calls', 'var(--green)'),
      card('Best day', dayAgg[0] ? DAYS[dayAgg[0].i] : '—', dayAgg[0] ? `${pct(dayAgg[0].x.hit / dayAgg[0].x.n)} of ${dayAgg[0].x.n} calls` : 'Need more calls', 'var(--purple)'),
      card('Best state', stAgg[0] ? NAMES[stAgg[0].k] : '—', stAgg[0] ? `${pct(stAgg[0].x.hit / stAgg[0].x.n)} of ${stAgg[0].x.n} calls` : 'Needs 5+ calls in a state', '#f79009'));

    // ---- heatmap
    const cellRates = A.cells.flat().filter(x => x.n >= 2).map(x => smooth(x, base));
    const maxCell = Math.max(0.01, ...cellRates), minCell = cellRates.length ? Math.min(...cellRates) : 0;
    const hm = el('div', { className: 'hm' });
    hm.style.gridTemplateColumns = `46px repeat(${H1 - H0 + 1}, minmax(34px, 1fr))`;
    hm.append(el('div', {}));
    for (let h = H0; h <= H1; h++) hm.append(el('div', { className: 'hm-h', textContent: hourLabel(h) }));
    for (let d = 0; d < 7; d++) {
      hm.append(el('div', { className: 'hm-d', textContent: DAYS[d] }));
      for (let h = H0; h <= H1; h++) {
        const x = A.cells[d][h];
        const r = x.n ? smooth(x, base) : 0;
        const [bg, fg] = shade(r, x.n, minCell, maxCell);
        const c = el('div', { className: 'hm-c' + (x.n && x.n < 3 ? ' thin' : ''), textContent: x.n ? Math.round((x.hit / x.n) * 100) : '', style: `background:${bg};color:${fg}` });
        c.onmouseenter = e => tip(box, e, `${DAYS[d]} ${hourLong(h)}`, x.n ? `${x.hit} of ${x.n} calls · ${pct(x.hit / x.n)}` : 'No calls');
        c.onmouseleave = () => hideTip();
        hm.append(c);
      }
    }
    const heat = sec(el('div', { className: 'card pad' },
      el('h3', { textContent: `${mLabel} by day and hour` }),
      el('p', { className: 'sub', textContent: (ui.tz === 'lead' ? "Hours are the lead's local time, worked out from the area code. " : ui.tz === 'pk' ? 'Hours are Pakistan time (PKT). ' : 'Hours are your local time. ') + 'Darker = better. Faded cells have under 3 calls, so trust them less.' }),
      el('div', { className: 'scroll', style: 'max-height:none;overflow-x:auto' }, hm)), SEC.heat);

    // ---- bar charts
    const bars = (title, items, fmt, color) => {
      const mx = Math.max(0.01, ...items.map(i => i.n ? i.hit / i.n : 0));
      return sec(el('div', { className: 'card pad' }, el('h3', { textContent: title }),
        el('div', { className: 'bars' }, items.map(i => {
          const r = i.n ? i.hit / i.n : 0;
          const row = el('div', { className: 'bar-row' }, el('span', { className: 'bl', textContent: fmt(i) }),
            el('div', { className: 'bt' }, el('i', { style: `width:${(r / mx) * 100}%;opacity:${i.n < 3 ? .35 : 1};background:${color}` })),
            el('span', { className: 'bv', textContent: i.n ? `${pct(r)} · ${i.n}` : '—' }));
          return row;
        }))), color);
    };
    const dayBars = bars('Best days', A.byDay.map((x, i) => ({ ...x, i })), x => DAYS[x.i], SEC.days);
    const hourBars = bars('Best hours', A.byHour.map((x, h) => ({ ...x, h })).filter(x => x.h >= H0 && x.h <= H1), x => hourLabel(x.h), SEC.hours);

    // ---- map
    const rateBySt = {}; let mxS = 0.01, mnS = 1;
    for (const [k, x] of Object.entries(A.byState)) if (k !== '??') { rateBySt[k] = smooth(x, base0 || base); if (x.n >= 3) { mxS = Math.max(mxS, rateBySt[k]); mnS = Math.min(mnS, rateBySt[k]); } }
    const map = el('div', { className: 'tilemap' });
    for (const [st, [cx, cy]] of Object.entries(TILE)) {
      const x = A.byState[st];
      const [bg, fg] = shade(x ? rateBySt[st] : 0, x ? x.n : 0, Math.min(mnS, mxS), mxS, '14,147,132', '#0b4f47');
      const t = el('button', { className: 'tile' + (ui.state === st ? ' sel' : '') + (x && x.n < 3 ? ' thin' : ''), textContent: st, style: `grid-column:${cx + 1};grid-row:${cy + 1};background:${bg};color:${fg}` });
      t.onmouseenter = e => tip(box, e, NAMES[st], x ? `${x.hit} of ${x.n} calls · ${pct(x.hit / x.n)}${bestHour(x.hours, base) ? ' · best ' + hourLong(bestHour(x.hours, base).h) : ''}` : 'No calls yet');
      t.onmouseleave = () => hideTip();
      t.onclick = () => { ui.state = ui.state === st ? null : st; onChange(); };
      map.append(t);
    }
    const unknown = A.byState['??'];
    const mapCard = sec(el('div', { className: 'card pad' }, el('h3', { textContent: `${mLabel} by state` }),
      el('p', { className: 'sub', textContent: 'Click a state to filter everything on this page to it. Each tile is one state.' }), map,
      unknown ? el('p', { className: 'sub', style: 'font-size:12px', textContent: `${unknown.n} calls to non-US or unknown area codes are not on the map.` }) : null), SEC.map);

    // ---- area code table
    const areas = Object.values(A.byArea).filter(a => !ui.state || a.st === ui.state).map(a => ({ ...a, r: smooth(a, base0 || base), bh: bestHour(a.hours, base) })).sort((a, b) => b.r - a.r || b.n - a.n);
    const at = el('table');
    at.append(el('tr', {}, ...['Area code', 'State', 'Calls', METRICS[ui.metric][0], 'Best hour'].map(h => el('th', { textContent: h }))));
    for (const a of areas.slice(0, 200)) at.append(el('tr', {},
      el('td', { className: 'num', textContent: a.code }), el('td', { textContent: a.st ? NAMES[a.st] : 'Unknown' }), el('td', { textContent: a.n }),
      el('td', {}, el('div', { className: 'minibar' }, el('i', { style: `width:${Math.round((a.hit / a.n) * 100)}%;background:#fedf89` }), el('span', { textContent: `${pct(a.hit / a.n)} (${a.hit})` }))),
      el('td', { textContent: a.bh ? hourLong(a.bh.h) : '—' })));
    if (!areas.length) at.append(el('tr', {}, el('td', { colSpan: 5, className: 'empty', textContent: 'No calls yet for this selection.' })));
    const areaCard = sec(el('div', { className: 'card' }, el('div', { className: 'pad', style: 'padding-bottom:0' }, el('h3', { textContent: 'By area code' }),
      el('p', { className: 'sub', textContent: 'Best performing first. Small samples are pulled toward your average so a single lucky call does not top the list.' })),
      el('div', { className: 'scroll', style: 'max-height:420px' }, at)), SEC.area);

    box.replaceChildren(controls, cards, heat, el('div', { className: 'grid-2c' }, mapCard, el('div', { className: 'stack' }, dayBars, hourBars)), el('div', { style: 'height:16px' }), areaCard);
    if (!A.rows.length) box.prepend(el('div', { className: 'note', textContent: 'No outgoing calls in this period. Pick “Last 30 days” or “All time” above to see more.' }));
  }

  let tipEl = null;
  function tip(box, e, title, body) {
    if (!tipEl) { tipEl = document.createElement('div'); tipEl.className = 'bt-tip'; document.body.append(tipEl); }
    tipEl.replaceChildren(Object.assign(document.createElement('b'), { textContent: title }), document.createElement('br'), document.createTextNode(body));
    const r = e.target.getBoundingClientRect();
    tipEl.style.display = 'block';
    tipEl.style.left = Math.min(window.innerWidth - 230, Math.max(8, r.left + r.width / 2 - 100)) + 'px';
    tipEl.style.top = (r.top + window.scrollY - 54) + 'px';
  }
  function hideTip() { if (tipEl) tipEl.style.display = 'none'; }

  return { render, areaOf, STATE_OF, analyse, ui, METRICS, rate, DAYS, NAMES, hourLabel, hourLong };
})();
if (typeof module !== 'undefined') module.exports = BestTime;
