const fs = require('fs');

async function run() {
  const base = 'https://tarifrechner.software';
  const pageUrl = `${base}/whitelabel/whitelabel/calculator?id=34ec3a70-d7d4-11ef-982f-df6ea12393d2`;
  const html = await (await fetch(pageUrl)).text();

  const scripts = [...html.matchAll(/<script[^>]*src="([^"]+)"/g)]
    .map((m) => m[1])
    .filter((s) => s.includes('/whitelabel/_next/static/chunks/'));

  const indexChunk = scripts.find((s) => s.includes('/chunks/pages/index-'));
  const mainChunk = scripts.find((s) => s.includes('/chunks/main-'));

  console.log('INDEX_CHUNK', indexChunk || '');
  console.log('MAIN_CHUNK', mainChunk || '');

  const targets = [indexChunk, mainChunk].filter(Boolean);
  const candidateSet = new Set();

  for (const rel of targets) {
    const url = rel.startsWith('http') ? rel : `${base}${rel}`;
    const js = await (await fetch(url)).text();

    for (const m of js.matchAll(/https?:\/\/[^"'`\s)]+/g)) {
      candidateSet.add(m[0]);
    }
    for (const m of js.matchAll(/\/api\/[a-zA-Z0-9_\/-]+/g)) {
      candidateSet.add(m[0]);
    }

    const hints = js.match(/graphql|axios|fetch\(|\.post\(|\.get\(/gi) || [];
    console.log('HINT_COUNT', rel, hints.length);
  }

  const candidates = [...candidateSet].sort();
  console.log('CANDIDATE_COUNT', candidates.length);
  for (const c of candidates.slice(0, 300)) console.log(c);

  fs.writeFileSync('tmp_whitelabel_candidates.txt', candidates.join('\n'));
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
