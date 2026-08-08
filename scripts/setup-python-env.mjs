// Dev-only: build the HA-free (T1) Python test environment.
//
//   npm run setup:python-env              # create if missing, then install
//   npm run setup:python-env -- --recreate
//
// Creates a venv outside the repo (see python-env.mjs for where and why) and
// installs bare `pytest`. That is the whole dependency list: tests/test_color.py,
// test_models.py and test_payload.py import color/models/payload directly, and
// those modules import nothing at all.
//
// It deliberately does NOT install requirements_test.txt. Home Assistant cannot be
// imported on Windows, and the harness registers a pytest plugin that loads at
// startup, so installing it would break even these HA-free tests. The HA tier runs
// in a container instead — see Dockerfile.test and `npm run test:python:ha`.
//
// Any Python meeting MINIMUM_PYTHON_VERSION (see python-env.mjs — it is this
// repo's own floor, not Home Assistant's) will do. The script probes several
// sources and picks the NEWEST it finds, so a machine that happens to have the
// container's interpreter gets parity with the HA tier for free, while a machine
// with something older can still run these tests. RGBCCT_PYTHON overrides all of it.

import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import {
  CONDA_ENVIRONMENT_NAME,
  MINIMUM_PYTHON_VERSION,
  venvDirectory,
  venvExists,
  venvPythonExecutable,
} from './python-env.mjs';

const shouldRecreate = process.argv.includes('--recreate');
const minimumText = MINIMUM_PYTHON_VERSION.join('.');

// Interpreter series to probe by name, newest first. Purely a search hint: the
// version check is what decides, so an unknown-to-this-list interpreter found via
// PATH, conda or RGBCCT_PYTHON still works.
const KNOWN_PYTHON_SERIES = ['3.15', '3.14', '3.13', '3.12', '3.11', '3.10'];

function run(command, args) {
  const result = spawnSync(command, args, { stdio: 'inherit' });
  if (result.status !== 0) {
    console.error(`\nFailed: ${command} ${args.join(' ')}`);
    process.exit(result.status ?? 1);
  }
}

/**
 * [major, minor, micro] for an interpreter, or null if it will not run — which is
 * also how a candidate that simply is not installed reports itself (spawn fails,
 * status is null). Note: no `shell: true`. It looks tempting on Windows, but the
 * shell then re-parses the `-c` argument and splits it at the semicolon.
 */
function interpreterVersion(command, args) {
  const result = spawnSync(command, [...args, '-c', 'import sys; print(*sys.version_info[:3])'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) return null;
  const parts = result.stdout.trim().split(/\s+/).map(Number);
  return parts.length >= 3 && parts.every(Number.isFinite) ? parts : null;
}

function isAtLeast(version, minimum) {
  for (let index = 0; index < minimum.length; index += 1) {
    if ((version[index] ?? 0) !== minimum[index]) return (version[index] ?? 0) > minimum[index];
  }
  return true;
}

/**
 * Every way an interpreter might be available. Single source of truth: the search
 * and the failure message both read this, so the error can never disagree with what
 * was actually tried. Candidates that do not exist are skipped silently; only the
 * version check rejects anything.
 */
function interpreterCandidates() {
  if (process.env.RGBCCT_PYTHON) {
    return [{ label: 'RGBCCT_PYTHON', command: process.env.RGBCCT_PYTHON, args: [] }];
  }

  const candidates = [];

  for (const series of KNOWN_PYTHON_SERIES) {
    candidates.push({ label: `python${series} (PATH)`, command: `python${series}`, args: [] });
    if (process.platform === 'win32') {
      candidates.push({ label: `py -${series}`, command: 'py', args: [`-${series}`] });
    }
  }

  const home = process.env.USERPROFILE || process.env.HOME || '';
  const relativeExecutable = process.platform === 'win32' ? 'python.exe' : 'bin/python';
  for (const root of [process.env.CONDA_PREFIX, 'miniconda3', 'anaconda3', '.conda'].filter(
    Boolean,
  )) {
    const base = path.isAbsolute(root) ? root : path.join(home, root);
    const environmentDirectory = path.join(base, 'envs', CONDA_ENVIRONMENT_NAME);
    candidates.push({
      label: `conda env ${environmentDirectory}`,
      command: path.join(environmentDirectory, relativeExecutable),
      args: [],
    });
  }

  // Last resort: whatever plain `python`/`python3` resolves to. The version check
  // decides whether it is usable.
  candidates.push({ label: 'python3 (PATH)', command: 'python3', args: [] });
  candidates.push({ label: 'python (PATH)', command: 'python', args: [] });

  return candidates;
}

const usable = [];
const tooOld = [];

for (const candidate of interpreterCandidates()) {
  const version = interpreterVersion(candidate.command, candidate.args);
  if (!version) continue;
  if (isAtLeast(version, MINIMUM_PYTHON_VERSION)) usable.push({ ...candidate, version });
  else tooOld.push(`${candidate.label} — found ${version.join('.')}`);
}

// Prefer the NEWEST usable interpreter rather than the first match: on a machine
// that also has the container's Python, the HA-free tests then run on the same
// version as the HA tier without that being a hard requirement for anyone else.
usable.sort((left, right) => (isAtLeast(left.version, right.version) ? -1 : 1));
const baseInterpreter = usable[0];

if (!baseInterpreter) {
  console.error(`No Python >= ${minimumText} found.`);
  if (tooOld.length > 0) {
    console.error('\nToo old:');
    for (const entry of tooOld) console.error(`  ${entry}`);
  }
  console.error(`\nAnything >= ${minimumText} works. Get one by any of:`);
  console.error('  - install Python from python.org');
  console.error(
    `  - conda create -n ${CONDA_ENVIRONMENT_NAME} python=3.14 -y   (3.14 matches Dockerfile.test)`,
  );
  console.error('  - point at an existing one: RGBCCT_PYTHON=/path/to/python');
  process.exit(1);
}

const baseVersion = baseInterpreter.version;

if (shouldRecreate && fs.existsSync(venvDirectory)) {
  console.log(`Removing existing venv ${venvDirectory}`);
  fs.rmSync(venvDirectory, { recursive: true, force: true });
}

if (venvExists()) {
  console.log(`Reusing venv   ${venvDirectory}`);
} else {
  console.log(`Creating venv  ${venvDirectory}`);
  console.log(`  from         ${baseInterpreter.label} (${baseVersion.join('.')})`);
  run(baseInterpreter.command, [...baseInterpreter.args, '-m', 'venv', venvDirectory]);
}

console.log('Installing     pytest\n');
run(venvPythonExecutable, ['-m', 'pip', 'install', '--upgrade', 'pip']);
run(venvPythonExecutable, ['-m', 'pip', 'install', 'pytest']);

console.log('\nPython test environment ready (HA-free tier).');
console.log(`  interpreter  ${venvPythonExecutable}`);
console.log('  run tests    npm run test:python');
console.log('  full suite   npm run test:python:ha   (adds the HA tier, needs Docker)');
