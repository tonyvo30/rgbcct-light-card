# Python tests

The `rgbcct_wled` integration is tested in two tiers.

| Command | Tier | Needs | Result |
| --- | --- | --- | --- |
| `npm run setup:python-env` | — | any Python ≥ 3.10 | one-time; creates the venv |
| `npm run test:python` | pure only | that venv | 847 passed, 154 skipped |
| `npm run test:python:ha` | **everything** | Docker | 850 passed, 153 skipped |

## The two tiers

**Pure tier** — `test_color.py`, `test_models.py`, `test_payload.py`. These import
`color.py` / `models.py` / `payload.py` directly, and *those modules import nothing
at all* — not Home Assistant, not each other's frameworks. A bare `pytest` runs
them. That is not a limitation, it is the assertion: this tier is the only place
the "no Home Assistant in the leaf modules" property is actually verified, because
the container has Home Assistant installed and so cannot prove its absence.

**Harness tier** — `tests/integration/`, which needs a simulated `hass`. Supplied by
`pytest-homeassistant-custom-component` (PHACC), pinned in `requirements_test.txt`
and installed only inside `Dockerfile.test`.

## Why the harness only runs in a container

**Home Assistant cannot be imported on Windows at all.** `homeassistant/runner.py`
has a bare, unguarded `import fcntl`, and `fcntl` is POSIX-only — CPython does not
ship it on Windows, because it wraps `fcntl()`/`ioctl()`/`flock()` syscalls Windows
does not have.

It is worse than "the harness tests fail". PHACC registers a `pytest11` setuptools
entry point, which pytest loads **at startup regardless of which tests you select**.
So merely having it installed makes every `pytest` invocation import Home Assistant
— breaking even the pure tests, which have no connection to it.

Hence: `npm run setup:python-env` installs bare `pytest` and deliberately does *not*
install `requirements_test.txt`. The container is the only place the harness lives.

`Dockerfile.test` uses `COPY` rather than a bind mount, which also matters here:
this project is often cloned inside a Home Assistant config directory so the built
card is served from `/local/`, and that directory is frequently a network share —
which Docker Desktop cannot bind-mount (it shares local drives only).

## Why PHACC is pinned to an exact version

PHACC pins one *exact* `homeassistant` release per PHACC version, and declares a
`requires_python` floor to match. **pip treats an unsatisfiable `requires_python` as
"this release does not exist"** and keeps walking backwards until something
installs — so an unpinned install on too old an interpreter does not fail, it
silently succeeds against an ancient Home Assistant.

Measured: on Python 3.12, pip reports the newest available PHACC as `0.13.205`,
which pins `homeassistant==2025.1.4` — roughly 19 months stale at the time of
writing. A mismatched simulator is worse than none, because it green-lights APIs
the Home Assistant you actually run may not have.

Sample of PyPI metadata (2026-08-08), PHACC version → HA pinned:

| PHACC | homeassistant | python | |
| --- | --- | --- | --- |
| 0.13.205 | 2025.1.4 | ≥ 3.12 | the silent-downgrade trap |
| 0.13.316 | 2026.2.3 | ≥ 3.13 | |
| 0.13.317 | 2026.3.1 | ≥ 3.14 | floor jumps to 3.14 here |
| 0.13.339 | 2026.6.3 | ≥ 3.14 | currently pinned |
| 0.13.355 | 2026.8.1 | ≥ 3.14 | |

**To target a different Home Assistant release**, re-pin to the PHACC version whose
`homeassistant==` pin matches it, and check whether the Python floor moved with it.
Pin to the release you actually run, not simply the newest. Look the floor up
rather than trusting the table above:

```sh
pip download --no-deps pytest-homeassistant-custom-component==<version>
# or read requires_python at
# https://pypi.org/pypi/pytest-homeassistant-custom-component/<version>/json
```

Do **not** pin `pytest` separately in `requirements_test.txt` — PHACC pins its own
exact `pytest`, and the two constraints would conflict.

## Two Python floors, deliberately not shared

| Floor | Owned by | Enforced by |
| --- | --- | --- |
| **3.10** | this repo's code — `models.py` uses `@dataclass(slots=True)` | `MINIMUM_PYTHON_VERSION` in `scripts/python-env.mjs` |
| whatever PHACC declares | the pinned harness | pip, inside the container |

Mirroring Home Assistant's floor into the JS constant would duplicate a number that
moves on someone else's schedule, and would block contributors from running tests
that have nothing to do with Home Assistant. `Dockerfile.test` does name a Python
series in `ARG PYTHON_VERSION`, but that copy is self-verifying: pip fails the build
on the very next line if it does not satisfy the pin.

`setup-python-env.mjs` still *prefers* the newest interpreter it can find, so a
machine that happens to have the container's version gets parity for free — as a
preference, not a requirement.

## Environment overrides

| Variable | Effect |
| --- | --- |
| `RGBCCT_PYTHON` | use this interpreter to build the venv, skipping all probing |
| `RGBCCT_VENV` | put the venv somewhere other than the platform default |

The venv lives outside the repo by default (`%LOCALAPPDATA%` on Windows,
`$XDG_CACHE_HOME` elsewhere). Beyond ordinary hygiene, that is because a checkout
inside a Home Assistant config directory is often on a network share: small-file
writes over SMB cost a round-trip each (~26,000 files at ~4% CPU, measured), and
`/config` is both backed up by HA and served over HTTP without authentication.
