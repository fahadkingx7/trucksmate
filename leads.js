// Pure helpers for turning a spreadsheet into assignable leads (no DOM; unit-testable).
const LeadsUtil = (() => {
  const digits = s => String(s ?? '').replace(/\D/g, '');

  // -> "+15551234567" or null. cc = default country code digits, e.g. "1".
  function normalizeNumber(raw, cc = '1') {
    let str = String(raw ?? '').trim();
    if (!str) return null;
    if (/^\d+(\.\d+)?e\+?\d+$/i.test(str)) str = String(Math.round(Number(str))); // Excel "1.555E+10"
    if (/^\d+\.0+$/.test(str)) str = str.split('.')[0];                              // "5551234567.0"
    let d = digits(str);
    if (str.startsWith('+')) return d.length >= 8 && d.length <= 15 ? '+' + d : null;
    if (d.startsWith('00') && d.length >= 12) return '+' + d.slice(2);
    d = d.replace(/^0+/, '');
    // US/Canada: area code and exchange can't start with 0 or 1 ("1870278239" is not a real number)
    const nanp = x => /^[2-9]\d{2}[2-9]\d{6}$/.test(x);
    if (d.length === 10) return cc === '1' ? (nanp(d) ? '+1' + d : null) : '+' + cc + d;
    if (cc === '1' && d.length === 11 && d[0] === '1') return nanp(d.slice(1)) ? '+' + d : null;
    if (d.startsWith(cc) && d.length - cc.length >= 8 && d.length <= 15) return '+' + d;
    // 11-15 digits that didn't match the default country: it already carries its own country code
    // (e.g. Mexico "527224868335" -> +52 722 486 8335).
    if (d.length >= 11 && d.length <= 15) return '+' + d;
    return null;
  }

  // Forgiving version for messy cells: "Tel: (555) 123-4567 ext 12", "555-123-4567 / 555-999-0000".
  function extractNumber(raw, cc = '1') {
    const str = String(raw ?? '').trim();
    if (!str) return null;
    if (!/[a-df-z]/i.test(str)) { const n = normalizeNumber(str, cc); if (n) return n; }
    for (const c of str.match(/\+?\d[\d\s().\-]{6,}\d/g) || []) {
      const n = normalizeNumber(c.trim(), cc);
      if (n) return n;
    }
    return null;
  }

  const looksLikeHeader = row => !row.some(v => digits(v).length >= 7);

  function detectColumns(headers) {
    const h = headers.map(x => String(x ?? '').toLowerCase());
    const find = (re, skip = []) => h.findIndex((v, i) => !skip.includes(i) && re.test(v));
    let phone = find(/phone|mobile|cell|whatsapp|\btel\b|telno|tel_no/);
    if (phone < 0) phone = find(/number|contact no|contact #/);
    const used = phone >= 0 ? [phone] : [];
    const name = find(/^(full ?)?name$|contact name|driver|first name|person|^name|officer|owner/, used);
    if (name >= 0) used.push(name);
    const company = find(/company|business|carrier|organi[sz]ation|firm|account|legal|dba/, used);
    if (company >= 0) used.push(company);
    const notes = find(/note|comment|remark|detail|info/, used);
    return { phone, name, company, notes };
  }

  // How many non-empty values in a column look like phone numbers (first `max` rows).
  function columnStats(rows, idx, cc = '1', max = 100) {
    let filled = 0, valid = 0, sample = '';
    for (const r of rows.slice(0, max)) {
      const v = r[idx];
      if (v == null || !String(v).trim()) continue;
      filled++;
      if (!sample) sample = String(v).trim();
      if (extractNumber(v, cc)) valid++;
    }
    return { filled, valid, sample };
  }

  // Trust the header name only if the column's data really looks like phone numbers.
  function pickPhoneColumn(headers, rows, cc = '1') {
    const byHeader = detectColumns(headers).phone;
    const stats = headers.map((_, i) => columnStats(rows, i, cc));
    const ok = i => stats[i].filled > 0 && stats[i].valid / stats[i].filled >= 0.5;
    if (byHeader >= 0 && ok(byHeader)) return byHeader;
    let best = -1, bestScore = 0;
    stats.forEach((s, i) => { const score = s.valid * (s.valid / Math.max(1, s.filled)); if (ok(i) && score > bestScore) { best = i; bestScore = score; } });
    if (best >= 0) return best;
    // Nothing looks like phone numbers. Only fall back to a header that literally says phone/mobile/tel.
    const strong = headers.findIndex((h, i) => /phone|mobile|cell|whatsapp|\btel\b|telno|tel_no/i.test(String(h)) && stats[i].filled > 0);
    return strong;
  }

  // extras: [{ col, label }] extra columns to show agents, with the display name the admin chose
  function buildLeads(rows, map, cc, extras = []) {
    const seen = new Set(), leads = [], invalidSamples = [];
    let invalid = 0, duplicates = 0, empty = 0;
    // "123456.0" (a whole number saved as a decimal by Excel/pandas) is shown as "123456"
    const cell = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim().replace(/^(\d+)\.0+$/, '$1') : '');
    for (const r of rows) {
      if (!r || !r.some(v => String(v ?? '').trim())) continue; // blank row
      const raw = cell(r, map.phone);
      if (!raw) { empty++; continue; }
      const number = extractNumber(raw, cc);
      if (!number) { invalid++; if (invalidSamples.length < 5) invalidSamples.push(raw || '(empty)'); continue; }
      if (seen.has(number)) { duplicates++; continue; }
      seen.add(number);
      const lead = { number, name: cell(r, map.name), company: cell(r, map.company), notes: cell(r, map.notes) };
      const ex = extras.filter(e => e.col >= 0).map(e => ({ l: e.label || 'Field', v: cell(r, e.col) })).filter(x => x.v);
      if (extras.some(e => e.col >= 0)) lead.extra = ex;
      leads.push(lead);
    }
    return { leads, invalid, duplicates, empty, invalidSamples };
  }

  // Round-robin so every agent gets a fair mix; keeps file order inside each agent's queue.
  function assign(leads, agentIds, basePosition) {
    return leads.map((l, i) => ({ ...l, agent_id: agentIds[i % agentIds.length], position: basePosition + i }));
  }

  return { normalizeNumber, extractNumber, looksLikeHeader, detectColumns, columnStats, pickPhoneColumn, buildLeads, assign };
})();
if (typeof module !== 'undefined') module.exports = LeadsUtil;
