// Pure data logic: stacking CSVs, fuzzy matching, totals, small-count hiding.
// Fuzzy matching works like R's agrep, so results can be checked against R.

const NUM = /^\s*-?(\d+\.?\d*|\.\d+)([eE][-+]?\d+)?\s*$/;
const MISSING = new Set(['', 'NA', 'NULL', 'null', 'NaN']);

// files: [{ name, fields: [...], rows: [{col: string}] }]
// Returns one table: every row tagged with its file, missing columns left null.
export function stackFiles(files) {
  const columns = ['file'];
  for (const f of files) for (const c of f.fields) if (!columns.includes(c)) columns.push(c);
  const numeric = new Set();
  for (const c of columns.slice(1)) {
    let seen = 0, ok = true;
    for (const f of files) {
      if (!f.fields.includes(c)) continue;
      for (const r of f.rows) {
        const v = r[c];
        if (v == null || MISSING.has(v.trim())) continue;
        seen++;
        if (!NUM.test(v)) { ok = false; break; }
      }
      if (!ok) break;
    }
    if (ok && seen > 0) numeric.add(c);
  }
  const rows = [];
  for (const f of files) {
    for (const r of f.rows) {
      const out = { file: f.name };
      for (const c of columns.slice(1)) {
        const v = r[c];
        if (v == null || MISSING.has(String(v).trim())) out[c] = null;
        else out[c] = numeric.has(c) ? Number(v) : String(v).trim();
      }
      rows.push(out);
    }
  }
  const text = columns.filter((c) => !numeric.has(c));
  // Searchable text per row: its text columns, skipping blanks and the file name
  const haystack = rows.map((r) =>
    text.filter((c) => c !== 'file' && r[c] != null).map((c) => r[c]).join('  ').toLowerCase());
  return { columns, numeric: [...numeric], text, rows, haystack };
}

// Smallest number of edits (insert, delete, substitute) to make `pattern`
// appear somewhere inside `text`: approximate substring match, like R's agrep.
export function fuzzyDistance(pattern, text, limit = Infinity) {
  const m = pattern.length;
  if (m === 0) return 0;
  let prev = new Array(m + 1);
  let cur = new Array(m + 1);
  for (let i = 0; i <= m; i++) prev[i] = i;
  let best = prev[m];
  for (let j = 1; j <= text.length; j++) {
    cur[0] = 0;
    const tc = text.charCodeAt(j - 1);
    for (let i = 1; i <= m; i++) {
      const sub = prev[i - 1] + (pattern.charCodeAt(i - 1) === tc ? 0 : 1);
      cur[i] = Math.min(sub, prev[i] + 1, cur[i - 1] + 1);
    }
    if (cur[m] < best) { best = cur[m]; if (best === 0) return 0; }
    [prev, cur] = [cur, prev];
  }
  return best <= limit ? best : Infinity;
}

// agrep's max.distance as a fraction of the pattern length, rounded up
export const allowedEdits = (word, frac) => Math.ceil(frac * word.length);

export function search(table, word, frac) {
  const w = word.trim().toLowerCase();
  if (!w) return [];
  const k = allowedEdits(w, frac);
  const hits = [];
  table.haystack.forEach((h, i) => {
    const d = fuzzyDistance(w, h, k);
    if (d <= k) hits.push({ i, d });
  });
  return hits.sort((a, b) => a.d - b.d);
}

// Hide counts from 1 to min-1. If exactly one cell is hidden, also hide the
// next smallest, so the hidden one cannot be worked out from a total.
export function suppress(cells, min) {
  const hidden = new Set();
  for (const [k, v] of cells) if (v > 0 && v < min) hidden.add(k);
  if (hidden.size === 1) {
    let next = null;
    for (const [k, v] of cells) {
      if (hidden.has(k)) continue;
      if (next === null || v < cells.get(next)) next = k;
    }
    if (next !== null) hidden.add(next);
  }
  return hidden;
}

export function toCSV(header, lines) {
  const q = (v) => {
    const s = v == null ? '' : String(v);
    return /[",\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  };
  return [header, ...lines].map((l) => l.map(q).join(',')).join('\n') + '\n';
}

// Totals of every number column over the chosen rows, kept apart per file
// (files can describe the same records, so they are never added together).
export function tally(table, rowIdx) {
  const out = new Map();
  for (const i of rowIdx) {
    const r = table.rows[i];
    let t = out.get(r.file);
    if (!t) out.set(r.file, (t = { rows: 0, sums: {} }));
    t.rows++;
    for (const c of table.numeric) if (r[c] != null) t.sums[c] = (t.sums[c] ?? 0) + r[c];
  }
  return out;
}

// Every word in the searchable text, most common first, for autocomplete
export function wordList(table) {
  const n = new Map();
  for (const h of table.haystack) {
    for (const w of new Set(h.split(/[^a-z0-9]+/))) {
      if (w.length >= 4 && /^[a-z]/.test(w)) n.set(w, (n.get(w) ?? 0) + 1);
    }
  }
  return [...n].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([w]) => w);
}

// The rest of the most common word starting with the last word typed,
// e.g. "tirzep" -> "atide". Empty when there is nothing to suggest.
export function completion(words, typed) {
  const m = typed.toLowerCase().match(/([a-z][a-z0-9]{2,})$/);
  if (!m) return '';
  const hit = words.find((w) => w.startsWith(m[1]) && w.length > m[1].length);
  return hit ? hit.slice(m[1].length) : '';
}

// ---- Standard names (always offered as suggestions, never applied) ----

// Salt and form words dropped after the drug name: "metformin hydrochloride" -> "metformin".
// Nitrates are left alone because mononitrate, dinitrate and trinitrate are different drugs.
const SALTS = new Set(('hydrochloride dihydrochloride hcl hydrobromide sodium disodium potassium ' +
  'calcium magnesium maleate mesylate mesilate besylate besilate succinate tartrate bitartrate ' +
  'fumarate citrate acetate phosphate sulfate sulphate bisulfate bromide hyclate monohydrate ' +
  'dihydrate trihydrate hemihydrate propionate dipropionate valerate butyrate furoate ' +
  'lactate gluconate trometamol tromethamine dimesylate dimaleate hemifumarate dipotassium ' +
  'tosylate embonate pamoate oxalate hydrate anhydrous xinafoate monosodium').split(' '));
const FORMS = new Set(('tablet tablets tab tabs capsule capsules cap caps injection inj oral ' +
  'solution suspension syrup cream ointment gel drops spray inhaler patch modified extended ' +
  'release mr xr sr cr er cd sachet sachets powder mg mcg microgram micrograms ml g units').split(' '));
// Older Australian names and spelling variants -> the current approved name
const VARIANTS = {
  frusemide: 'furosemide', amoxycillin: 'amoxicillin', cephalexin: 'cefalexin',
  cephazolin: 'cefazolin', lignocaine: 'lidocaine', oestradiol: 'estradiol',
  thyroxine: 'levothyroxine', cyclosporin: 'ciclosporin', cyclosporine: 'ciclosporin',
  chlorpheniramine: 'chlorphenamine', dothiepin: 'dosulepin', sulphasalazine: 'sulfasalazine',
  trimeprazine: 'alimemazine', riboflavine: 'riboflavin', dimethicone: 'dimeticone',
  cholecalciferol: 'colecalciferol', acetaminophen: 'paracetamol', albuterol: 'salbutamol',
};

function cleanPart(part) {
  const words = part.toLowerCase().replace(/[()[\]]/g, ' ').replace(/\d+(\.\d+)?\s*%?/g, ' ')
    .split(/[^a-z-]+/).filter((w) => w && !FORMS.has(w));
  if (words.length === 0) return '';
  // Drop salt words after the first word, unless that leaves only a salt word
  const kept = [words[0], ...words.slice(1).filter((w) => !SALTS.has(w))];
  const out = kept.length === 1 && SALTS.has(kept[0]) ? words : kept;
  return out.map((w) => VARIANTS[w] ?? w).join(' ');
}

// "Sitagliptin, Metformin Hydrochloride" -> "metformin + sitagliptin"
export function standardName(name) {
  if (!name) return '';
  const parts = String(name).split(/\s*(?:,|\/|\+|&|;)\s*/).map(cleanPart).filter(Boolean);
  return [...new Set(parts)].sort().join(' + ');
}

// Group distinct names under their suggested standard name, biggest first.
// Only groups where the suggestion changes something are returned.
export function suggestStandard(table, col, value) {
  const groups = new Map();
  table.rows.forEach((r) => {
    const name = r[col];
    if (name == null) return;
    const std = standardName(name);
    if (!std) return;
    let g = groups.get(std);
    if (!g) groups.set(std, (g = { std, names: new Map(), total: 0 }));
    const v = value ? r[value] ?? 0 : 1;
    g.names.set(name, (g.names.get(name) ?? 0) + v);
    g.total += v;
  });
  return [...groups.values()]
    .filter((g) => g.names.size > 1 || [...g.names.keys()][0].toLowerCase().trim() !== g.std)
    .sort((a, b) => b.total - a.total);
}

// ---- Drug and indication list ----
// Expected columns (any order, any case): drug, indication, and optionally
// regulator (TGA / FDA) and source. One row per drug and indication.
export function readDrugList(rows, fields) {
  const find = (want) => fields.find((f) => f.toLowerCase().replace(/[^a-z]/g, '') === want);
  const drug = find('drug') ?? find('name') ?? find('ingredient');
  const ind = find('indication') ?? find('indications');
  if (!drug || !ind) return null;
  const reg = find('regulator') ?? find('agency');
  const src = find('source');
  const out = new Map();
  for (const r of rows) {
    const key = standardName(r[drug]);
    if (!key || !r[ind]) continue;
    if (!out.has(key)) out.set(key, []);
    out.get(key).push({ indication: String(r[ind]).trim(), regulator: reg ? r[reg] : '', source: src ? r[src] : '' });
  }
  return out;
}

// Indications for a standard name; a combination gets each ingredient's
export function indicationsFor(list, std) {
  if (!list || !std) return [];
  const direct = list.get(std);
  if (direct) return direct;
  return std.split(' + ').flatMap((p) => (list.get(p) ?? []).map((x) => ({ ...x, part: p })));
}
