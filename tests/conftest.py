"""Shared test setup.

Pure-logic tests (`test_color`, `test_models`) import the dependency-free leaf
modules directly, so we put both the repo root (for `custom_components.*` in the
HA-based tests) and the package dir (for bare `import color` / `import models`)
on the path. The HA-based tests under `tests/integration/` `importorskip` the HA
harness, so they skip cleanly when it isn't installed.
"""

import sys
from pathlib import Path

_REPO_ROOT = Path(__file__).resolve().parents[1]
_PACKAGE_DIR = _REPO_ROOT / "custom_components" / "rgbcct_wled"

for _path in (str(_REPO_ROOT), str(_PACKAGE_DIR)):
    if _path not in sys.path:
        sys.path.insert(0, _path)
