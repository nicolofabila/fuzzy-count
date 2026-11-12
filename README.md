# Fuzzy Count

Count patients (or scripts, results, rows) for a term however it is spelled:
`Metformin`, `METFORMN`, `metformin hcl`, and so on. Runs in your browser; your
files are never uploaded anywhere, and the app ships with no data.

## Run it

```bash
npm install      # first time only
npm run dev      # then open http://localhost:5173
```

`npm run build` writes a static copy to `dist/`. `npm test` checks the matching and
counting logic on made-up rows.

## Using it

1. **Add CSV files** (or drop them anywhere on the page). Text columns are searched;
   number columns are added up.
2. **Search a term.** The box autofills the most common matching word in your files
   (`tirzep` shows `tirzepatide`, with a **Tab** hint); Tab or → fills it in, Esc
   searches only what you typed. Every spelling within the typo setting is listed
   (20% is about 1 wrong letter in 5), with a badge on those that needed typos.
   Nothing starts ticked: tick the spellings that mean your term and press Enter or
   **Save**. Saving the same term again adds the new spellings to it.
3. **The table** keeps one row per saved term (and per file, if a term was found in
   more than one), with a bar graph below. **Download CSV** saves it as shown.

Counts of 1 to 9 always show as "–" (blank in the CSV, left out of the graph). If
only one count in a column is hidden, the next smallest is too, so it cannot be
worked out from a total.

## Standardise names (suggestions only)

The **Standardise names** tab suggests one standard name per drug: it drops salt and
form words and doses (`Metformin Hydrochloride 500mg tablets` -> `metformin`), splits
combinations (`Sitagliptin, Metformin` -> `metformin + sitagliptin`) and uses current
Australian names (`frusemide` -> `furosemide`). Nothing is changed: every suggestion
starts unticked, and **Download mapping** saves `original, suggested, accepted`.
Nitrate salts and leading words such as `sodium` are kept on purpose (isosorbide
mononitrate and dinitrate are different drugs). The rules are in `src/lib.js`
(`SALTS`, `FORMS`, `VARIANTS`).

## Drug and indication list (optional)

**Add drug list** loads your own CSV of approved drugs and what they are approved
for. Start from `drug_list_template.csv`, one row per drug and indication:

| drug | indication | regulator | source |
|---|---|---|---|
| (generic name) | (approved use) | e.g. TGA or FDA | (where it came from) |

`drug` and `indication` are required. Names are matched after the same
standardising, so salts and capitals don't matter. With a list loaded, each standard
name and saved count shows **Approved for** chips tagged by regulator (a
combination shows each ingredient's), and both downloads gain an `approved_for`
column. Drugs missing from the list show "not in list".
