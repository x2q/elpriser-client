// Compiles src/ and test/ (type-checked, strict) into build-test/ and runs the node:test files.
import { readdirSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const tsc = join(root, 'node_modules', 'typescript', 'bin', 'tsc');

rmSync(join(root, 'build-test'), { recursive: true, force: true });
let r = spawnSync(process.execPath, [tsc, '-p', join(root, 'tsconfig.test.json')], { stdio: 'inherit', cwd: root });
if (r.status !== 0) process.exit(r.status ?? 1);

const dir = join(root, 'build-test', 'test');
const files = readdirSync(dir)
  .filter((f) => f.endsWith('.test.js'))
  .map((f) => join(dir, f));
r = spawnSync(process.execPath, ['--test', ...files], { stdio: 'inherit', cwd: root });
process.exit(r.status ?? 1);
