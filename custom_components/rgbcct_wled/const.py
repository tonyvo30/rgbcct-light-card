"""Constants for the RGBCCT WLED integration."""

from __future__ import annotations

DOMAIN = "rgbcct_wled"

# Config-entry / options keys.
CONF_HOST = "host"
CONF_POLL_INTERVAL = "poll_interval"
CONF_PUSH = "push"

# The card's entity-naming convention (src/entities.js) is preserved: the
# whole-device "group" light has no suffix and reads/writes across all real
# segments (0..N-1); each segment light is "..._segment_<n>".

# Fallback HTTP poll cadence when the push websocket is down (or disabled).
# Gentle by default — the ESP has little heap and the websocket carries the
# fast path; this is only a safety net.
DEFAULT_POLL_INTERVAL = 30

# WLED broadcasts full state over ws://<host>/ws. Reconnect uses capped
# exponential backoff so a rebooting/absent device isn't hammered.
WS_RECONNECT_INITIAL = 5
WS_RECONNECT_MAX = 60

# Seconds between aiohttp websocket pings. A half-open TCP connection can sit in
# readyState OPEN for minutes after an ungraceful drop; the ping forces it to
# surface so the reconnect loop (and the poll fallback) actually engage.
WS_HEARTBEAT = 25

# NOTE: constants used by the dependency-free leaf modules live *in* those modules
# (`models.DEFAULT_CCT`, `payload.MASTER_BRIGHTNESS_FULL`), not here. Those modules
# must import nothing from the package so they stay testable on a bare `pytest`
# with no Home Assistant installed — importing `const` would break that, since a
# relative import needs package context the tests deliberately avoid.

# Per-request HTTP timeout (seconds) — matches the old get_wled_state rest_command.
HTTP_TIMEOUT = 5

# Minimum gap between POSTs to WLED. The first write of a burst goes out
# immediately (so a single command stays responsive and its errors still surface
# to the caller); anything arriving inside the window is merged and sent once when
# it closes. This caps the device at ~7 writes/second no matter how fast the
# frontend drives it — a colour-wheel drag would otherwise emit one POST per
# pointer event. The ESP has little heap and destabilises under bursts
# (integration-plan.md Risks), and unlike the old card's client-side 100ms send
# debounce this limit is server-side, so it holds regardless of how many
# dashboards, scripts or automations write at once.
WRITE_MIN_INTERVAL = 0.15
