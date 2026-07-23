// Shared WebSocket "doorbell" connections to WLED devices, one per host.
//
// WLED pushes a full-state frame over ws://<host>/ws on every state change
// (plus one on connect). The card uses those frames purely as a doorbell:
// the payload is discarded and each subscriber re-reads the true state
// through the "get wled with cct" HA script, so state parsing stays in one
// place and the sync engine's interaction guards keep protecting edits.
//
// The connection is shared per device, not per card — WLED caps concurrent
// WebSocket clients at a small number (and the WLED app itself takes a
// slot), so a master card plus its segment cards must not open one each.
// The first subscriber opens the socket, the last one out closes it.

const RECONNECT_INITIAL_MS = 5000;
const RECONNECT_MAX_MS = 60000;
const KEEPALIVE_INTERVAL_MS = 45000;

// host -> { socket, subscribers, reconnectTimer, reconnectDelayMs, keepaliveTimer }
const connections = new Map();

// Join (or open) the shared socket for a WLED host. `onPush` is called on
// every frame, payload ignored. Returns an unsubscribe function.
export function subscribeToWledPush(host, onPush) {
  // A page served over HTTPS can't open an insecure ws:// connection
  // (mixed content) and WLED speaks nothing else — don't even try. The
  // caller can't tell the difference; the card's poll tier covers it.
  if (window.location.protocol === 'https:') return () => {};

  let connection = connections.get(host);
  if (!connection) {
    connection = {
      socket: null,
      subscribers: new Set(),
      reconnectTimer: null,
      reconnectDelayMs: RECONNECT_INITIAL_MS,
      keepaliveTimer: null,
    };
    connections.set(host, connection);
  }

  connection.subscribers.add(onPush);
  ensureSocketOpen(host, connection);

  return () => {
    connection.subscribers.delete(onPush);
    if (connection.subscribers.size > 0) return;

    clearTimeout(connection.reconnectTimer);
    connection.reconnectTimer = null;
    clearInterval(connection.keepaliveTimer);
    connection.keepaliveTimer = null;

    if (connection.socket) {
      // Detach the handler first so this deliberate close doesn't
      // schedule a reconnect.
      connection.socket.onclose = null;
      connection.socket.close();
      connection.socket = null;
    }

    connections.delete(host);
  };
}

// Is there an open socket for this host right now? Drives the card's poll
// tier: live socket -> slow safety-net poll; anything else -> 3s poll.
export function wledPushIsLive(host) {
  const connection = connections.get(host);
  return !!connection?.socket && connection.socket.readyState === WebSocket.OPEN;
}

function ensureSocketOpen(host, connection) {
  if (connection.socket) {
    const readyState = connection.socket.readyState;
    if (readyState === WebSocket.OPEN || readyState === WebSocket.CONNECTING) return;
  }

  let socket;
  try {
    socket = new WebSocket(`ws://${host}/ws`);
  } catch (e) {
    // Malformed host — retrying won't fix it, but the backoff caps the
    // noise and the poll keeps the card working regardless.
    scheduleReconnect(host, connection);
    return;
  }

  connection.socket = socket;

  // Every handler ignores events from a socket that is no longer the
  // connection's current one — a stale socket must not reset the backoff,
  // ring the doorbell, null out its replacement, or schedule a spurious
  // reconnect.
  socket.onopen = () => {
    if (connection.socket !== socket) return;
    connection.reconnectDelayMs = RECONNECT_INITIAL_MS;
    startKeepalive(connection);
  };

  socket.onmessage = () => {
    if (connection.socket !== socket) return;
    // Doorbell only (see file header). The on-connect frame doubles as a
    // free catch-up sync after every reconnect.
    for (const subscriber of connection.subscribers) subscriber();
  };

  // A failed connection attempt also fires onclose, so this single handler
  // covers refusals, drops, and WLED reboots alike.
  socket.onclose = () => {
    if (connection.socket !== socket) return;
    clearInterval(connection.keepaliveTimer);
    connection.keepaliveTimer = null;
    connection.socket = null;
    scheduleReconnect(host, connection);
  };
}

// A half-open TCP connection (Wi-Fi blip, WLED power-cut with no FIN/RST)
// can leave readyState OPEN for minutes while delivering nothing — which
// would wrongly suppress the card's fallback poll via wledPushIsLive().
// WLED never pings and the browser WebSocket API can't, but *sending*
// forces TCP to notice a dead peer: the failed retransmits error the
// socket and fire onclose, dropping the poll tier to 3s and starting the
// reconnect backoff. `{}` is a no-op WLED command that gets no reply, so
// on a healthy connection this stays completely silent (no doorbell ring).
function startKeepalive(connection) {
  clearInterval(connection.keepaliveTimer);

  connection.keepaliveTimer = setInterval(() => {
    const socket = connection.socket;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;

    try {
      socket.send('{}');
    } catch (e) {
      // A socket mid-close can throw; its onclose handles the rest.
    }
  }, KEEPALIVE_INTERVAL_MS);
}

function scheduleReconnect(host, connection) {
  if (connection.reconnectTimer || connection.subscribers.size === 0) return;

  connection.reconnectTimer = setTimeout(() => {
    connection.reconnectTimer = null;
    if (connection.subscribers.size === 0) return;
    ensureSocketOpen(host, connection);
  }, connection.reconnectDelayMs);

  connection.reconnectDelayMs = Math.min(connection.reconnectDelayMs * 2, RECONNECT_MAX_MS);
}
