import { useMemo, useRef, useState } from 'react';
import Papa from 'papaparse';
import { stackFiles, search, tally, suppress, toCSV, wordList, completion,
  standardName, suggestStandard, readDrugList, indicationsFor } from './lib.js';

const MIN = 10; // counts of 1 to 9 are hidden (small-cell suppression)
const fmt = (n) => (n == null ? '' : n.toLocaleString('en-AU'));

function readCSV(file) {
  return new Promise((resolve, reject) =>
    Papa.parse(file, {
      header: true,
      skipEmptyLines: true,
      transformHeader: (h) => h.replace(/^﻿/, '').trim(),
      complete: (r) => resolve({ name: file.name, fields: r.meta.fields, rows: r.data }),
      error: reject,
    }));
}

export default function App() {
  const [files, setFiles] = useState([]);
  const [counts, setCounts] = useState([]); // { term, rows: Set<rowIndex> }
  const [drugList, setDrugList] = useState(null); // { name, map }
  const [listError, setListError] = useState('');
  const [view, setView] = useState('count');
  const [accepted, setAccepted] = useState(new Set()); // standard-name ticks, kept across tabs
  const table = useMemo(() => (files.length ? stackFiles(files) : null), [files]);
  const input = useRef(null);
  const listInput = useRef(null);

  async function addList(file) {
    if (!file) return;
    const f = await readCSV(file);
    const map = readDrugList(f.rows, f.fields);
    if (!map) { setListError(`${f.name} needs a drug column and an indication column.`); return; }
    setListError('');
    setDrugList({ name: f.name, map });
  }

  async function addFiles(list) {
    const csvs = [...list].filter((f) => /\.(csv|tsv|txt)$/i.test(f.name));
    const read = await Promise.all(csvs.map(readCSV));
    setFiles((old) => [...old.filter((o) => !read.some((r) => r.name === o.name)), ...read]);
    setCounts([]);
    setAccepted(new Set());
  }
  function save(term, rows) {
    setCounts((old) => {
      const found = old.find((c) => c.term === term);
      if (!found) return [...old, { term, rows: new Set(rows) }];
      return old.map((c) => (c === found ? { term, rows: new Set([...c.rows, ...rows]) } : c));
    });
  }

  return (
    <div className="app" onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => { e.preventDefault(); addFiles(e.dataTransfer.files); }}>
      <div className="files">
        <button className="primary" onClick={() => input.current.click()}>Add CSV files</button>
        <input ref={input} type="file" accept=".csv,.tsv,.txt" multiple hidden
          onChange={(e) => { addFiles(e.target.files); e.target.value = ''; }} />
        {files.map((f) => (
          <span key={f.name} className="chip">
            {f.name}
            <button className="x" aria-label={'Remove ' + f.name}
              onClick={() => { setFiles((old) => old.filter((o) => o !== f)); setCounts([]); }}>×</button>
          </span>
        ))}
        <span className="spacer" />
        {drugList ? (
          <span className="chip list">
            Drug list: {drugList.name}
            <button className="x" aria-label="Remove drug list" onClick={() => setDrugList(null)}>×</button>
          </span>
        ) : (
          <button onClick={() => listInput.current.click()}>Add drug list</button>
        )}
        <input ref={listInput} type="file" accept=".csv,.tsv,.txt" hidden
          onChange={(e) => { addList(e.target.files[0]); e.target.value = ''; }} />
      </div>
      {listError && <p className="error small">{listError}</p>}
      {table && (
        <div className="tabs" role="tablist">
          {[['count', 'Count'], ['standardise', 'Standardise names']].map(([k, t]) => (
            <button key={k} role="tab" aria-selected={view === k} className={view === k ? 'on' : ''}
              onClick={() => setView(k)}>{t}</button>
          ))}
        </div>
      )}
      {table && view === 'count' && <Search table={table} onSave={save} />}
      {table && view === 'count' && counts.length > 0 &&
        <Results table={table} counts={counts} setCounts={setCounts} drugList={drugList} />}
      {table && view === 'standardise' &&
        <Standardise table={table} drugList={drugList} accepted={accepted} setAccepted={setAccepted} />}
    </div>
  );
}

function rowLabel(table, r) {
  return table.text.filter((c) => c !== 'file' && r[c] != null).map((c) => r[c]).join(' · ');
}

function Search({ table, onSave }) {
  const [word, setWord] = useState('');
  const [frac, setFrac] = useState(0.2);
  // Autofill: the rest of the most common word starting with what was typed.
  // Used straight away; Tab or right arrow fills it in, Esc drops it.
  const words = useMemo(() => wordList(table), [table]);
  const [dismissed, setDismissed] = useState(null);
  const rest = dismissed === word ? '' : completion(words, word);
  const term = word + rest;
  // Ticks belong to one exact search; a new search starts with none ticked
  const [tickState, setTickState] = useState({ key: '', set: null });
  const searchKey = term.trim().toLowerCase() + '|' + frac;
  const ticked = tickState.key === searchKey ? tickState.set : null;
  const setTicked = (set) => setTickState({ key: searchKey, set });
  const hits = useMemo(() => search(table, term, frac), [table, term, frac]);
  const main = table.numeric.includes('patients') ? 'patients' : table.numeric[0];
  const isTicked = (i) => (ticked ? ticked.has(i) : false);
  const keep = hits.filter((h) => isTicked(h.i)).map((h) => h.i);
  const live = tally(table, keep);
  const multiFile = new Set(hits.map((h) => table.rows[h.i].file)).size > 1;

  function toggle(i) {
    const next = new Set(ticked ?? []);
    next.has(i) ? next.delete(i) : next.add(i);
    setTicked(next);
  }
  function add() {
    if (!term.trim() || keep.length === 0) return;
    onSave(term.trim(), keep);
    setWord('');
  }

  return (
    <div className="block">
      <div className="searchrow">
        <div className="termbox">
          <div className="ghost" aria-hidden="true"><span className="typed">{word}</span>{rest}</div>
          <input className="term" value={word} placeholder="Search a term, e.g. metformin" autoFocus
            aria-label="Search a term" spellCheck={false} autoComplete="off"
            onChange={(e) => setWord(e.target.value)}
            onKeyDown={(e) => {
              const atEnd = e.target.selectionStart === word.length;
              if (rest && (e.key === 'Tab' || (e.key === 'ArrowRight' && atEnd))) { e.preventDefault(); setWord(term); }
              else if (rest && e.key === 'Escape') setDismissed(word);
              else if (e.key === 'Enter') add();
            }} />
          {rest && <span className="tabhint"><kbd>Tab</kbd> {term}</span>}
        </div>
        <label className="muted small" title="20% allows about 1 wrong letter in 5">
          Typos {Math.round(frac * 100)}%
          <input type="range" min="0" max="0.4" step="0.05" value={frac}
            onChange={(e) => setFrac(Number(e.target.value))} />
        </label>
      </div>
      {term.trim() && (
        <>
          {hits.length === 0 ? <p className="muted">No matches.</p> : (
            <>
              <div className="hitbar small">
                <button className="link" onClick={() => setTicked(new Set(hits.map((h) => h.i)))}>all</button>
                <button className="link" onClick={() => setTicked(new Set())}>none</button>
              </div>
              <ul className="hits">
                {hits.slice(0, 500).map((h) => {
                  const r = table.rows[h.i];
                  return (
                    <li key={h.i}>
                      <label>
                        <input type="checkbox" checked={isTicked(h.i)} onChange={() => toggle(h.i)} />
                        <span className="hitlabel">{rowLabel(table, r)}</span>
                        {h.d > 0 && <span className="badge">{h.d} typo{h.d > 1 ? 's' : ''}</span>}
                        {multiFile && <span className="muted small">{r.file}</span>}
                        {main && <span className="num">{fmt(r[main])}</span>}
                      </label>
                    </li>
                  );
                })}
              </ul>
            </>
          )}
          {keep.length > 0 && (
            <div className="total">
              <span>
                {[...live].map(([file, t]) => (
                  <span key={file} className="line">
                    {table.numeric.filter((c) => t.sums[c] != null).map((c) => (
                      <span key={c}><strong>{fmt(t.sums[c])}</strong> {c} </span>
                    ))}
                    {multiFile && <span className="muted small">in {file}</span>}
                  </span>
                ))}
              </span>
              <button className="primary" onClick={add}>Save</button>
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Results({ table, counts, setCounts, drugList }) {
  // One line per term, and per file when a term was found in more than one
  const lines = counts.flatMap((c) => [...tally(table, c.rows)].map(([file, t]) => ({ term: c.term, file, ...t })));
  const multiFile = new Set(lines.map((l) => l.file)).size > 1;
  const cols = table.numeric.filter((c) => lines.some((l) => l.sums[c] != null));
  const id = (l) => l.term + '|' + l.file;

  const hidden = new Set();
  for (const c of cols) {
    const cells = new Map(lines.filter((l) => l.sums[c] != null).map((l) => [id(l), l.sums[c]]));
    for (const k of suppress(cells, MIN)) hidden.add(k + '|' + c);
  }
  const value = (l, c) => (hidden.has(id(l) + '|' + c) ? null : l.sums[c]);
  const approved = (term) => indicationsFor(drugList?.map, standardName(term));

  function download() {
    const header = ['term', ...(multiFile ? ['file'] : []), 'spellings', ...cols, ...(drugList ? ['approved_for'] : [])];
    const rows = lines.map((l) => [l.term, ...(multiFile ? [l.file] : []), l.rows, ...cols.map((c) => value(l, c)),
      ...(drugList ? [approved(l.term).map((x) => x.indication).join('; ')] : [])]);
    const url = URL.createObjectURL(new Blob([toCSV(header, rows)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'counts.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="block">
      <table>
        <thead>
          <tr>
            <th>Term</th>
            {multiFile && <th>File</th>}
            <th className="num">Spellings</th>
            {cols.map((c) => <th key={c} className="num">{c}</th>)}
            {drugList && <th>Approved for</th>}
            <th />
          </tr>
        </thead>
        <tbody>
          {lines.map((l) => (
            <tr key={id(l)}>
              <td>{l.term}</td>
              {multiFile && <td className="muted">{l.file}</td>}
              <td className="num">{l.rows}</td>
              {cols.map((c) => (
                <td key={c} className="num">{hidden.has(id(l) + '|' + c) ? <span className="muted" title={`Under ${MIN}`}>–</span> : fmt(l.sums[c])}</td>
              ))}
              {drugList && <td><Indications items={approved(l.term)} /></td>}
              <td>
                <button className="x" aria-label={'Remove ' + l.term}
                  onClick={() => setCounts((old) => old.filter((c) => c.term !== l.term))}>×</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="foot">
        <button onClick={download}>Download CSV</button>
      </div>
      <Bars lines={lines} cols={cols} value={value} label={(l) => (multiFile ? `${l.term} · ${l.file}` : l.term)} />
    </div>
  );
}

// Horizontal bars of one number column; hidden small counts are left out
function Bars({ lines, cols, value, label }) {
  const [pick, setPick] = useState(cols.includes('patients') ? 'patients' : cols[0]);
  const col = cols.includes(pick) ? pick : cols[0];
  if (!col) return null;
  const bars = lines.map((l) => ({ name: label(l), v: value(l, col) }))
    .filter((b) => b.v != null).sort((a, b) => b.v - a.v);
  if (bars.length === 0) return null;
  const max = Math.max(...bars.map((b) => b.v), 1);
  return (
    <div className="bars">
      {cols.length > 1 && (
        <div className="barpick">
          {cols.map((c) => (
            <button key={c} className={c === col ? 'on' : ''} onClick={() => setPick(c)}>{c}</button>
          ))}
        </div>
      )}
      {bars.map((b) => (
        <div key={b.name} className="bar">
          <span className="barname" title={b.name}>{b.name}</span>
          <span className="bartrack"><span className="barfill" style={{ width: (100 * b.v) / max + '%' }} /></span>
          <span className="num">{fmt(b.v)}</span>
        </div>
      ))}
    </div>
  );
}

// Indication chips, marked with the regulator that lists them
function Indications({ items }) {
  if (items.length === 0) return <span className="muted small">not in list</span>;
  const seen = new Map();
  for (const x of items) {
    const k = (x.part ?? '') + '|' + x.indication.toLowerCase();
    if (!seen.has(k)) seen.set(k, { ...x, regs: new Set() });
    if (x.regulator) seen.get(k).regs.add(String(x.regulator).toUpperCase());
  }
  return (
    <span className="inds">
      {[...seen.values()].map((x) => (
        <span key={(x.part ?? '') + x.indication} className="ind" title={x.source || undefined}>
          {x.part && <span className="muted">{x.part}: </span>}{x.indication}
          {[...x.regs].map((r) => <span key={r} className="reg">{r}</span>)}
        </span>
      ))}
    </span>
  );
}

// Suggested standard names. Nothing is applied: every suggestion starts
// unticked, and the ticked ones are only saved in the downloaded mapping.
function Standardise({ table, drugList, accepted, setAccepted }) {
  const textCols = table.text.filter((c) => c !== 'file');
  const guess = textCols.find((c) => /^(label|name|drug|medicine|description)$/i.test(c)) ?? textCols[0];
  const [col, setCol] = useState(guess);
  const [filter, setFilter] = useState('');
  const value = table.numeric.includes('patients') ? 'patients' : table.numeric[0];
  const groups = useMemo(() => suggestStandard(table, col, value), [table, col, value]);
  const f = filter.trim().toLowerCase();
  const shown = (f ? groups.filter((g) => g.std.includes(f) || [...g.names.keys()].some((n) => n.toLowerCase().includes(f))) : groups).slice(0, 200);
  const totalNames = groups.reduce((s, g) => s + g.names.size, 0);

  const toggle = (names, on) => setAccepted((old) => {
    const next = new Set(old);
    for (const n of names) on ? next.add(n) : next.delete(n);
    return next;
  });

  function download() {
    const lines = groups.flatMap((g) => [...g.names.keys()].map((n) => [n, g.std, accepted.has(n) ? 'yes' : 'no',
      ...(drugList ? [indicationsFor(drugList.map, g.std).map((x) => x.indication).join('; ')] : [])]));
    const header = ['original', 'suggested', 'accepted', ...(drugList ? ['approved_for'] : [])];
    const url = URL.createObjectURL(new Blob([toCSV(header, lines)], { type: 'text/csv' }));
    const a = document.createElement('a');
    a.href = url; a.download = 'standard_names.csv'; a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="block">
      <div className="searchrow">
        <input className="term" value={filter} placeholder="Filter, e.g. metformin" onChange={(e) => setFilter(e.target.value)} />
        {textCols.length > 1 && (
          <select value={col} onChange={(e) => { setCol(e.target.value); setAccepted(new Set()); }} aria-label="Column to standardise">
            {textCols.map((c) => <option key={c}>{c}</option>)}
          </select>
        )}
      </div>
      <div className="hitbar small">
        <span className="muted">{fmt(totalNames)} names → {fmt(groups.length)} suggested · {fmt(accepted.size)} accepted</span>
        <button onClick={download}>Download mapping</button>
      </div>
      <div className="groups">
        {shown.map((g) => {
          const names = [...g.names].sort((a, b) => b[1] - a[1]);
          const all = names.every(([n]) => accepted.has(n));
          return (
            <div key={g.std} className="group">
              <div className="grouphead">
                <span className="suggest" title="Suggested standard name">→ {g.std}</span>
                {drugList && <Indications items={indicationsFor(drugList.map, g.std)} />}
                <button className="link" onClick={() => toggle(names.map(([n]) => n), !all)}>{all ? 'untick all' : 'accept all'}</button>
              </div>
              <ul className="hits">
                {names.map(([n, v]) => (
                  <li key={n}>
                    <label>
                      <input type="checkbox" checked={accepted.has(n)} onChange={(e) => toggle([n], e.target.checked)} />
                      <span className="hitlabel">{n}</span>
                      {value && <span className="num">{fmt(v)}</span>}
                    </label>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </div>
      {groups.length > shown.length && <p className="muted small">Showing {shown.length} of {fmt(groups.length)}; filter to find others. The download has them all.</p>}
    </div>
  );
}
