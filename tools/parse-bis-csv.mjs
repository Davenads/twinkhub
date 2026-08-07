/**
 * Faithful parser for the Cowblackout level-19 WSG BiS chart CSV export.
 *
 * The Google Sheets CSV export flattens each build into a 4-column block
 * (item, enchant, spacer, spacer) starting at column index 2; the header row
 * names each block ("Druid\nFlag Carrier" etc.). Slots are POSITIONAL — there
 * are no slot labels in the export — so this tool emits rows in sheet order and
 * leaves slot naming to the authoring step. Cells are plain display text (the
 * HYPERLINK item ids do NOT survive CSV export), so no Wowhead ids are recovered.
 *
 * This is a re-import utility: when the sheet updates (or the Alliance tab lands),
 * drop the new CSV in and re-run to refresh the parsed reference. Faithful
 * transcription only — it never invents data.
 *
 * Usage: node tools/parse-bis-csv.mjs [path-to-csv]
 * Writes <csv-basename>.parsed.json next to the CSV and prints a row summary.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const src =
  process.argv[2] ??
  fileURLToPath(new URL('../plans/data-sources/bis-chart-19-horde.csv', import.meta.url));
const text = readFileSync(src, 'utf8');

/** RFC4180-ish parse: quoted fields may contain commas and newlines; "" escapes ". */
function parseCsv(str) {
  const rows = [];
  let row = [];
  let field = '';
  let inQuotes = false;
  const pushField = () => {
    row.push(field);
    field = '';
  };
  const pushRow = () => {
    rows.push(row);
    row = [];
  };
  for (let i = 0; i < str.length; i++) {
    const c = str[i];
    if (inQuotes) {
      if (c === '"') {
        if (str[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else field += c;
      continue;
    }
    if (c === '"') inQuotes = true;
    else if (c === ',') pushField();
    else if (c === '\r') continue;
    else if (c === '\n') {
      pushField();
      pushRow();
    } else field += c;
  }
  pushField();
  if (row.length > 1 || row[0] !== '') pushRow();
  return rows;
}

const clean = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

const rows = parseCsv(text);

// Build headers live at column 2 + 4*k on row 0.
const builds = [];
for (let k = 0; k < 40; k++) {
  const label = clean(rows[0]?.[2 + 4 * k]);
  if (!label) break;
  builds.push({ index: k, label, itemCol: 2 + 4 * k, enchCol: 3 + 4 * k });
}

// Data rows: everything after the header (row 0) and separator (row 1) that has
// at least one non-empty item cell.
const dataRows = [];
for (let r = 2; r < rows.length; r++) {
  const cells = rows[r];
  if (!builds.some((b) => clean(cells[b.itemCol]))) continue;
  const picks = {};
  for (const b of builds) {
    const item = clean(cells[b.itemCol]);
    const enchant = clean(cells[b.enchCol]);
    if (item || enchant) picks[b.label] = { item, enchant: enchant || null };
  }
  dataRows.push({ srcRow: r, picks });
}

const out = {
  source: src.split(/[\\/]/).pop(),
  builds: builds.map((b) => b.label),
  slotOrder: dataRows.length,
  rows: dataRows
};
const dest = src.replace(/\.csv$/i, '.parsed.json');
writeFileSync(dest, `${JSON.stringify(out, null, 2)}\n`);

console.log(`builds: ${builds.length}`);
console.log(builds.map((b) => b.label).join(' | '));
console.log(`data rows (slots): ${dataRows.length}`);
console.log('idx srcRow  Druid-FC item          Rogue-Mid item         Rogue-Off item');
dataRows.forEach((d, i) => {
  const g = (label) => (d.picks[label]?.item || '-').padEnd(22).slice(0, 22);
  console.log(
    String(i).padStart(3),
    String(d.srcRow).padStart(6),
    ' ',
    g('Druid Flag Carrier'),
    g('Rogue Midfield'),
    g('Rogue Offense')
  );
});
console.log(`\nwrote ${dest}`);
