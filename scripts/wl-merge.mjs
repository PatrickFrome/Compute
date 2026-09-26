// wl-merge.mjs — sectional union-merge of worklog files (CTX-4 protocol:
// blocks "---\nTask ID: ...", dedup ONLY by body sha; same-ID-different-body kept both)
import fs from 'fs';
import crypto from 'crypto';

const sha = (s) => crypto.createHash('sha256').update(s).digest('hex');

function parse(file) {
  const lines = fs.readFileSync(file, 'utf8').split('\n');
  const starts = [];
  for (let i = 0; i < lines.length; i++) {
    const isSepBlock = lines[i] === '---' && i + 1 < lines.length && /^Task ID: /.test(lines[i + 1]);
    const isFileStartBlock = i === 0 && /^Task ID: /.test(lines[0] || '');
    if (isSepBlock || isFileStartBlock) starts.push(i);
  }
  const first = starts.length ? starts[0] : lines.length;
  const preamble = lines.slice(0, first).join('\n');
  const blocks = [];
  starts.forEach((s, idx) => {
    const e = idx + 1 < starts.length ? starts[idx + 1] : lines.length;
    let blk = lines.slice(s, e);
    let end = blk.length;
    while (end > 0 && blk[end - 1].trim() === '') end--;
    const body = blk.slice(1, end).join('\n'); // exclude separator line
    const raw = blk.slice(0, end).join('\n');
    blocks.push({ body, raw });
  });
  return { preamble, blocks };
}

const [localF, donorF, railF, outF] = process.argv.slice(2);
const local = parse(localF), donor = parse(donorF), rail = parse(railF);

const seen = new Set();
const outBlocks = [];
const take = (blocks) => {
  let added = 0;
  for (const b of blocks) {
    const k = sha(b.body);
    if (seen.has(k)) continue;
    seen.add(k);
    outBlocks.push(b);
    added++;
  }
  return added;
};
const nLocal = take(local.blocks);
const nDonor = take(donor.blocks);
const nRail = take(rail.blocks);

let out = local.preamble.replace(/\n+$/, '');
for (const b of outBlocks) out += '\n\n' + b.raw;
out = out.replace(/\n+$/, '') + '\n';
fs.writeFileSync(outF, out);

// verification: re-parse output, ensure no dup shas and superset property
const check = parse(outF);
const shas = check.blocks.map((b) => sha(b.body));
const uniq = new Set(shas);
const allIn = (f) => parse(f).blocks.every((b) => uniq.has(sha(b.body)));
console.log(JSON.stringify({
  local: { blocks: local.blocks.length, added: nLocal },
  donor: { blocks: donor.blocks.length, added: nDonor },
  rail: { blocks: rail.blocks.length, added: nRail },
  outBytes: out.length,
  outBlocks: check.blocks.length,
  outTaskIDs: (fs.readFileSync(outF, 'utf8').match(/^Task ID: /gm) || []).length,
  noDupShas: uniq.size === shas.length,
  localAllPresent: allIn(localF),
  donorAllPresent: allIn(donorF),
  railAllPresent: allIn(railF),
}, null, 1));
