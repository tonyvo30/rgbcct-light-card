// Dev-only: run the HA-free (T1) tests with the out-of-repo test environment.
//
//   npm run test:python                     # HA-free tier
//   npm run test:python -- tests/test_color.py -k round_trip
//
// tests/integration/ skips here (it importorskips the HA harness, which cannot be
// installed on Windows) — run `npm run test:python:ha` for the full suite.
//
// Any extra arguments are passed straight through to pytest. The working directory
// is the repo root, so pytest.ini and testpaths resolve normally — only the
// interpreter lives elsewhere (see python-env.mjs).

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { venvDirectory, venvExists, venvPythonExecutable } from './python-env.mjs';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

if (!venvExists()) {
  console.error(`No Python test environment at ${venvDirectory}`);
  console.error('Create it with:\n  npm run setup:python-env');
  process.exit(1);
}

const pytestArguments = process.argv.slice(2);
const result = spawnSync(venvPythonExecutable, ['-m', 'pytest', ...pytestArguments], {
  cwd: repoRoot,
  stdio: 'inherit',
});

process.exit(result.status ?? 1);
