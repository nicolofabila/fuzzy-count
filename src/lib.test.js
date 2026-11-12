import test from 'node:test';
import assert from 'node:assert/strict';
import { fuzzyDistance, stackFiles, search, tally, suppress, wordList, completion } from './lib.js';

// Made-up rows only: these tests never read real data

test('fuzzy distance finds approximate substrings', () => {
  assert.equal(fuzzyDistance('metformin', 'tab metformin 500mg'), 0);
  assert.equal(fuzzyDistance('metfromin', 'metformin'), 2);
  assert.equal(fuzzyDistance('hba1c', 'glycated hb (hba1c)'), 0);
  assert.equal(fuzzyDistance('hba1c', 'hb a1c'), 1);
});

test('suppress hides 1-9 and a second cell when only one is hidden', () => {
  const cells = new Map([['a', 5], ['b', 50], ['c', 60]]);
  assert.deepEqual([...suppress(cells, 10)].sort(), ['a', 'b']);
  const two = new Map([['a', 5], ['b', 3], ['c', 60]]);
  assert.deepEqual([...suppress(two, 10)].sort(), ['a', 'b']);
});

test('stacks files with different columns, then searches and counts per file', () => {
  const t = stackFiles([
    { name: 'a.csv', fields: ['label', 'n'], rows: [{ label: 'Semaglutide', n: '40' }, { label: 'Liraglutide', n: '20' }] },
    { name: 'b.csv', fields: ['label', 'kind', 'n'], rows: [{ label: 'HbA1c', kind: 'test', n: '7' }, { label: 'Hb A1c %', kind: 'test', n: 'NA' }] },
  ]);
  assert.deepEqual(t.columns, ['file', 'label', 'n', 'kind']);
  assert.deepEqual(t.numeric, ['n']);
  assert.equal(t.rows[3].n, null);
  assert.deepEqual(search(t, 'semaglutide', 0.2).map((h) => [h.i, h.d]), [[0, 0], [1, 3]]);
  assert.deepEqual(search(t, 'hba1c', 0.2).map((h) => h.i), [2, 3]);
  const semaglutide = tally(t, search(t, 'semaglutide', 0.2).filter((h) => h.d === 0).map((h) => h.i));
  assert.deepEqual(semaglutide.get('a.csv'), { rows: 1, sums: { n: 40 } });
  const hba1c = tally(t, search(t, 'hba1c', 0.2).map((h) => h.i));
  assert.deepEqual(hba1c.get('b.csv'), { rows: 2, sums: { n: 7 } });
  const both = tally(t, [0, 2]);
  assert.deepEqual([...both.keys()], ['a.csv', 'b.csv']);
});

test('autocomplete finishes the last word from the most common match', () => {
  const t = stackFiles([{ name: 'a.csv', fields: ['drug'], rows: [
    { drug: 'Tirzepatide' }, { drug: 'tirzepatide 5mg' }, { drug: 'Tirzepam' }, { drug: 'Glycated Hb' }] }]);
  const words = wordList(t);
  assert.equal(completion(words, 'tirzep'), 'atide');
  assert.equal(completion(words, 'Tirzep'), 'atide');
  assert.equal(completion(words, 'glycated h'), '');
  assert.equal(completion(words, 'gly'), 'cated');
  assert.equal(completion(words, 'ti'), '');
  assert.equal(completion(words, 'tirzepatide'), '');
  assert.equal(completion(words, 'xyz'), '');
});

test('standard names drop salts, forms and doses, and split combinations', async () => {
  const { standardName } = await import('./lib.js');
  assert.equal(standardName('Metformin Hydrochloride'), 'metformin');
  assert.equal(standardName('METFORMIN 500mg tablets'), 'metformin');
  assert.equal(standardName('Sitagliptin, Metformin Hydrochloride'), 'metformin + sitagliptin');
  assert.equal(standardName('METFORMIN/SITAGLIPTIN'), 'metformin + sitagliptin');
  assert.equal(standardName('Frusemide'), 'furosemide');
  assert.equal(standardName('Amoxycillin'), 'amoxicillin');
  assert.equal(standardName('Sodium Phosphate'), 'sodium phosphate');
  assert.equal(standardName('Isosorbide Mononitrate'), 'isosorbide mononitrate');
  assert.equal(standardName('Calcium Carbonate'), 'calcium carbonate');
  assert.equal(standardName('Lisdexamfetamine dimesylate'), 'lisdexamfetamine');
});

test('drug list links indications by standard name, also for combinations', async () => {
  const { readDrugList, indicationsFor } = await import('./lib.js');
  const list = readDrugList([
    { Drug: 'Metformin hydrochloride', Indication: 'condition A', Regulator: 'TGA' },
    { Drug: 'Sitagliptin', Indication: 'condition B', Regulator: 'FDA' },
  ], ['Drug', 'Indication', 'Regulator']);
  assert.deepEqual(indicationsFor(list, 'metformin').map((x) => x.indication), ['condition A']);
  assert.deepEqual(indicationsFor(list, 'metformin + sitagliptin').map((x) => x.indication), ['condition A', 'condition B']);
  assert.equal(readDrugList([{ a: 1 }], ['a']), null);
});
