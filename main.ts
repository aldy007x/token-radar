// Token launch radar: the hand-in program for make.fun's token-radar-01 bounty.
//
// It reads the sealed snapshot (in the grader, /input/snapshot.json; here, --input names the
// file or the folder holding it), fits the value model in lib/model.ts on the protocols whose
// tokens already trade, ranks every protocol that records no token by what its token would be
// worth at its peers' multiples, and writes the hand-in to the output folder:
//
//   board.json    the ranked board the gate reads
//   data.js       the same radar, as the one assignment the dashboard renders from
//   dashboard/    the page itself, copied from beside this file
//   screenshots/  the three views of it, copied from beside this file
//   dossier.json  buildDossier's summary of the page and the views, written last
//
// Node 22, standard library only, no network, and deterministic: the same snapshot in, the
// same bytes out, on every run.
//
//   mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input ../token-radar-01-kit/input/snapshot.json

import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { boardIssue, boardRows, buildRadar, dataScript, parseSnapshot } from './lib/model.ts';
import { buildDossier } from './vendor/makefun-board.ts';

const repoDir = fileURLToPath(new URL('.', import.meta.url));

/** Read a `--name value` or `--name=value` argument, with a fallback when absent. */
function flag(name: string, fallback: string): string {
  const args = process.argv.slice(2);
  const at = args.indexOf(`--${name}`);
  if (at !== -1) {
    const value = args[at + 1];
    if (value === undefined) throw new Error(`--${name} needs a value`);
    return value;
  }
  const joined = args.find((a) => a.startsWith(`--${name}=`));
  return joined === undefined ? fallback : joined.slice(name.length + 3);
}

function fail(message: string): never {
  process.stderr.write(`token radar: ${message}\n`);
  process.exit(1);
}

// The gate's own caps, restated so the program refuses what the scorer would refuse.
const DOSSIER_TEXT_BYTES = 65_536;
const SHOT_CAPS = { max: 4, max_bytes: 524_288 };
const DASH_CAPS = { max_files: 400, max_bytes: 4_194_304 };
const PLAIN_FILE = /^[A-Za-z0-9_][A-Za-z0-9._-]{0,127}$/;

const inputFlag = flag('input', '/input');
const snapshotPath = inputFlag.endsWith('.json') ? inputFlag : join(inputFlag, 'snapshot.json');
if (!existsSync(snapshotPath)) {
  fail(`no snapshot at ${snapshotPath}: pass --input <snapshot.json|folder> or mount the sealed /input`);
}
const outDir = flag('output', process.env.MAKEFUN_OUTPUT_DIR ?? '/output');

const snapshot = parseSnapshot(readFileSync(snapshotPath, 'utf8'));
const radar = buildRadar(snapshot);
const rows = boardRows(radar);
const issue = boardIssue(rows, snapshot);
if (issue !== null) fail(`the model wrote a board the gate refuses: ${issue}`);

mkdirSync(outDir, { recursive: true });
writeFileSync(join(outDir, 'board.json'), `${JSON.stringify({ model: radar.model_version, as_of: radar.as_of, rows })}\n`);
writeFileSync(join(outDir, 'data.js'), dataScript(radar));

/** Copy a folder tree into the output, skipping dot names; returns the file names copied. */
function copyTree(from: string, to: string): string[] {
  if (!existsSync(from)) return [];
  mkdirSync(to, { recursive: true });
  const copied: string[] = [];
  for (const entry of readdirSync(from, { withFileTypes: true })) {
    if (entry.name.startsWith('.')) continue;
    const src = join(from, entry.name);
    const dst = join(to, entry.name);
    if (entry.isDirectory()) copied.push(...copyTree(src, dst));
    else if (entry.isFile()) {
      copyFileSync(src, dst);
      copied.push(entry.name);
    }
  }
  return copied;
}

const pageFiles = copyTree(join(repoDir, 'dashboard'), join(outDir, 'dashboard'));
if (!pageFiles.includes('index.html')) fail('dashboard/ holds no index.html: the page is the entry');

const shotNames = copyTree(join(repoDir, 'screenshots'), join(outDir, 'screenshots'));
if (shotNames.length < 3 || shotNames.length > 4) {
  fail(`screenshots/ holds ${shotNames.length} files: hand in 3 or 4, the board, a detail view and a filtered view`);
}
for (const name of shotNames) {
  if (!PLAIN_FILE.test(name)) fail(`screenshots/${name}: a name is letters, digits and . _ -, 1 to 128 characters`);
  const size = statSync(join(outDir, 'screenshots', name)).size;
  if (size > SHOT_CAPS.max_bytes) fail(`screenshots/${name} is ${size} bytes, over the ${SHOT_CAPS.max_bytes} cap`);
}

// The dossier goes last: the scorer rebuilds it from this same output and compares bytes.
const dossier = buildDossier(outDir, {
  text_max_bytes: DOSSIER_TEXT_BYTES,
  screenshots: SHOT_CAPS,
  dashboard: DASH_CAPS,
});
writeFileSync(join(outDir, 'dossier.json'), dossier);

const watchCount = rows.filter((r) => r.watchlist).length;
process.stdout.write(
  `token radar: scanned ${radar.scanned} protocols, fitted ${radar.fit.sampleSize} comparables, ranked ${rows.length} pre-token (${watchCount} watchlist, ${rows.length - watchCount} early)\n` +
    `token radar: wrote board.json, data.js, dashboard/ (${pageFiles.length} files), screenshots/ (${shotNames.length} images), dossier.json (${dossier.length} bytes)\n`,
);
