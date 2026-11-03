// Builds dist/esm (ES modules) and dist/cjs (CommonJS) plus their .d.ts with the TypeScript compiler.
// The CJS build compiles a copy of src/ that sits under a package.json with "type": "commonjs",
// so tsc (module: node16) emits real CommonJS and a matching CJS-flavoured .d.ts, whatever the
// root package's "type" is.
import { cpSync, existsSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

const rm = (p) => rmSync(join(root, p), { recursive: true, force: true });

if (process.argv.includes('--clean')) {
  for (const p of ['dist', 'build-cjs', 'build-test']) rm(p);
  process.exit(0);
}

if (!existsSync(tsc)) {
  console.error('typescript is not installed: run `npm ci` first.');
  process.exit(1);
}

function run(project) {
  const r = spawnSync(process.execPath, [tsc, '-p', join(root, project)], { stdio: 'inherit', cwd: root });
  if (r.status !== 0) {
    rm('build-cjs');
    process.exit(r.status ?? 1);
  }
}

rm('dist');
rm('build-cjs');

run('tsconfig.esm.json');

mkdirSync(join(root, 'build-cjs'));
cpSync(join(root, 'src'), join(root, 'build-cjs'), { recursive: true });
writeFileSync(join(root, 'build-cjs', 'package.json'), '{"type":"commonjs"}\n');
run('tsconfig.cjs.json');
rm('build-cjs');

writeFileSync(join(root, 'dist', 'esm', 'package.json'), '{"type":"module"}\n');
writeFileSync(join(root, 'dist', 'cjs', 'package.json'), '{"type":"commonjs"}\n');
console.log('built dist/esm and dist/cjs');
