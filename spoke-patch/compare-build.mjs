/**
 * Compares a local build of @firebase/firestore with the published package: the
 * JavaScript bundles of the main build and the rolled-up type files.
 *
 * Usage: node compare-build.mjs <published dist> <built dist> (--expect-identical | --write <dir>)
 *
 * The main build (rollup.config.js) writes every bundle except lite/ and
 * intermediate/lite/, which come from rollup.config.lite.js. The type files are the
 * dist/*.d.ts and dist/lite/*.d.ts that the package's api-report scripts write;
 * consumers read those, not the per-module declarations under dist/firestore/.
 * Shared chunks are
 * named after a hash of their contents (common-456515ba.esm.js), and the files
 * that import them name them too, so the comparison first maps each built chunk
 * name to the published one by matching the imports of files with the same name.
 *
 * --expect-identical exits with status 1 unless every file matches byte for byte.
 * --write writes each changed file, under its published name, into <dir>.
 */
import fs from 'node:fs';
import path from 'node:path';

const [published, built, mode, outDir] = process.argv.slice(2);
if (!published || !built || !['--expect-identical', '--write'].includes(mode)) {
  console.error('Usage: compare-build.mjs <published dist> <built dist> (--expect-identical | --write <dir>)');
  process.exit(2);
}

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(entry =>
    entry.isDirectory()
      ? walk(path.join(dir, entry.name)).map(f => path.join(entry.name, f))
      : [entry.name]
  );
}

const isMainBundle = f =>
  /\.(m?js)$/.test(f) && !f.startsWith('lite/') && !f.startsWith('intermediate/lite/');
const isTypeRollup = f => /^(lite\/)?[^/]+\.d\.ts$/.test(f);
const chunkName = /common-([0-9a-f]{8})\./;
const chunkHashes = text => [...text.matchAll(/common-([0-9a-f]{8})\./g)].map(m => m[1]);
const read = f => fs.readFileSync(f, 'utf8');

const files = walk(published).filter(f => isMainBundle(f) || isTypeRollup(f));

// Built chunk hash -> published chunk hash, paired through the files that import them.
const hashes = new Map();
for (const f of files.filter(f => !chunkName.test(path.basename(f)))) {
  const builtFile = path.join(built, f);
  if (!fs.existsSync(builtFile)) continue;
  const before = chunkHashes(read(path.join(published, f)));
  const after = chunkHashes(read(builtFile));
  before.forEach((hash, i) => after[i] && hashes.set(after[i], hash));
}

// rollup also names the imported chunk's variable after the hash, eg. common30385a2e_node.
const capitalize = hash => hash[0].toUpperCase() + hash.slice(1);
function toPublishedNames(text) {
  for (const [builtHash, publishedHash] of hashes) {
    text = text
      .split('common' + capitalize(builtHash)).join('common' + capitalize(publishedHash))
      .split(builtHash).join(publishedHash);
  }
  return text;
}

let changed = 0;
let problems = 0;
for (const f of files) {
  const match = path.basename(f).match(chunkName);
  let builtName = f;
  if (match) {
    const builtHash = [...hashes].find(([, publishedHash]) => publishedHash === match[1])?.[0];
    if (!builtHash) {
      console.error(`no built chunk for ${f}`);
      problems++;
      continue;
    }
    builtName = f.replace(match[1], builtHash);
  }
  const builtFile = path.join(built, builtName);
  if (!fs.existsSync(builtFile)) {
    console.error(`not built: ${f}`);
    problems++;
    continue;
  }
  const text = toPublishedNames(read(builtFile));
  if (text === read(path.join(published, f))) continue;
  changed++;
  console.log(`changed: ${f}`);
  if (mode === '--write') {
    fs.mkdirSync(path.dirname(path.join(outDir, f)), { recursive: true });
    fs.writeFileSync(path.join(outDir, f), text);
  }
}

console.log(`${files.length} files compared, ${changed} changed`);
if (problems > 0 || (mode === '--expect-identical' && changed > 0)) {
  process.exit(1);
}
