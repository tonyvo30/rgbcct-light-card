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

# Per-request HTTP timeout (seconds) — matches the old get_wled_state rest_command.
HTTP_TIMEOUT = 5
