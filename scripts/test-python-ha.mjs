// Dev-only: run the FULL Python suite (pure tier + HA-harness tier) in a Linux
// container, because Home Assistant cannot be imported on Windows.
//
//   npm run test:python:ha
//   npm run test:python:ha -- -k config_flow -v
//
// Extra arguments pass straight through to pytest. Requires Docker Desktop to be
// running. See Dockerfile.test for the full rationale, and scripts/test-python.mjs
// for the fast Windows-native pure-tier runner.

import path from 'node:path';
import process from 'node:process';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const IMAGE_TAG = 'rgbcct-wled-tests';

function docker(args, options = {}) {
  return spawnSync('docker', args, { cwd: repoRoot, stdio: 'inherit', ...options });
}

// Check the daemon first, so a stopped Docker Desktop produces one clear line
// instead of a named-pipe connect error from somewhere inside the build.
const daemon = spawnSync('docker', ['info', '--format', '{{.ServerVersion}}'], {
  encoding: 'utf8',
});
if (daemon.status !== 0) {
  console.error('Docker is not reachable — start Docker Desktop and try again.');
  process.exit(1);
}
console.log(`Docker engine ${daemon.stdout.trim()}`);

// The dependency layer is cached, so only the source layer rebuilds after the
// first run. Nothing to stage: .dockerignore trims the context to a few files.
console.log(`Building ${IMAGE_TAG}...`);
const build = docker(['build', '-f', 'Dockerfile.test', '-t', IMAGE_TAG, '.']);
if (build.status !== 0) {
  console.error('\nImage build failed.');
  process.exit(build.status ?? 1);
}

const pytestArguments = process.argv.slice(2);
console.log('\nRunning tests in container...\n');
const tests = docker([
  'run',
  '--rm',
  IMAGE_TAG,
  'pytest',
  ...(pytestArguments.length > 0 ? pytestArguments : ['-q']),
]);

process.exit(tests.status ?? 1);
