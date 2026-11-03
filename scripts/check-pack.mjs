// Fails unless `npm pack` would publish exactly dist/ + README.md + LICENSE + package.json.
import { execFileSync } from 'node:child_process';

const out = execFileSync('npm', ['pack', '--dry-run', '--json', '--ignore-scripts'], { encoding: 'utf8' });
const files = JSON.parse(out)[0].files.map((f) => f.path);
const allowed = (p) => p.startsWith('dist/') || ['README.md', 'LICENSE', 'package.json'].includes(p);
const stray = files.filter((p) => !allowed(p));
const missing = ['dist/esm/index.js', 'dist/esm/index.d.ts', 'dist/cjs/index.js', 'dist/cjs/index.d.ts', 'README.md', 'LICENSE', 'package.json'].filter(
  (p) => !files.includes(p),
);
if (stray.length || missing.length) {
  console.error('unexpected files:', stray, 'missing files:', missing);
  process.exit(1);
}
if (files.some((p) => p.endsWith('.map') || p.includes('test'))) {
  console.error('maps or tests in the package');
  process.exit(1);
}
console.log(`pack ok: ${files.length} files (dist + README + LICENSE + package.json)`);
