// Owns ONE convention: where the HA-free (T1) Python test environment lives.
// Imported by setup-python-env.mjs and test-python.mjs so the location is defined
// in exactly one place.
//
// SCOPE: this environment runs the HA-free tier only. The HA-harness tier runs in
// a Linux container — see Dockerfile.test — because Home Assistant cannot be
// imported on Windows. Nothing here installs Home Assistant.
//
// WHY THE VENV LIVES OUTSIDE THE REPO
// Partly hygiene: it is a few hundred MB of platform-specific binaries that no
// checkout should carry. Mostly, though, this project is commonly cloned *inside*
// a Home Assistant config directory so the built card is served from /local/ — and
// that directory is frequently a network share (SMB), backed up by HA, and served
// over HTTP without authentication. A venv there is slow to write (small-file
// writes over SMB cost a network round-trip each — measured at ~26,000 files
// crawling along at ~4% CPU), bloats every backup, and is web-reachable.
// Keeping it on local disk avoids all of that. pytest only cares about the
// directory it runs in, not where its interpreter lives.
//
// Override the location with RGBCCT_VENV (e.g. to put it on a roomier drive).

import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import process from 'node:process';

/**
 * The floor OUR OWN CODE needs, and nothing more. `models.py` uses
 * `@dataclass(slots=True)`, added in Python 3.10; everything else in the HA-free
 * modules is older than that. Bump this only when this repo's code starts needing
 * something newer.
 *
 * Deliberately NOT Home Assistant's floor. HA's requirement belongs to the pinned
 * harness, is declared by that package as `requires_python`, and is enforced by pip
 * inside the container — see requirements_test.txt and Dockerfile.test. Mirroring it
 * here would duplicate a number that changes on someone else's schedule, and would
 * block contributors from running tests that have no connection to Home Assistant.
 * setup-python-env.mjs still *prefers* the newest interpreter available, so a
 * machine that has the container's version will use it without being forced to.
 */
export const MINIMUM_PYTHON_VERSION = [3, 10];

/** Conventional name for a conda env holding a suitable interpreter, if you use one. */
export const CONDA_ENVIRONMENT_NAME = 'rgbcct-ha314';

/**
 * Platform-standard per-user location for generated data — %LOCALAPPDATA% on
 * Windows, $XDG_CACHE_HOME or ~/.cache elsewhere. Deliberately not a path inside
 * the repo, and deliberately not a guessed "big" drive: if you want it somewhere
 * specific, set RGBCCT_VENV.
 */
function defaultVenvDirectory() {
  const applicationDirectory = 'rgbcct-light-card';
  if (process.platform === 'win32') {
    const localAppData = process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local');
    return path.join(localAppData, applicationDirectory, 'venv');
  }
  const cacheHome = process.env.XDG_CACHE_HOME || path.join(os.homedir(), '.cache');
  return path.join(cacheHome, applicationDirectory, 'venv');
}

export const venvDirectory = process.env.RGBCCT_VENV || defaultVenvDirectory();

/** Scripts/ on Windows, bin/ elsewhere — the venv layout differs by platform. */
export const venvPythonExecutable =
  process.platform === 'win32'
    ? path.join(venvDirectory, 'Scripts', 'python.exe')
    : path.join(venvDirectory, 'bin', 'python');

export function venvExists() {
  return fs.existsSync(venvPythonExecutable);
}
