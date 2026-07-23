# rgbcct-light-card

A custom Home Assistant Lovelace card for
controlling **WLED-based RGBCCT** LED strips — RGB colour *and* tunable white
(CCT) on the same strip — with a proper colour wheel instead of the stock
light dialog.

- **HSV colour wheel** (red at top, hue clockwise) with a separate **Value**
  slider and an eyedropper for exact RGB / HEX / HSL entry.
- Independent **Brightness**, **White**, and **CCT** sliders with WLED-style
  gradient tracks.
- **Master / segment model**: a whole-device "master" card shows a read-only
  list of its segments and a **Mixed** indicator when they differ; power
  propagates across every segment.
- **Compact mode**: a one-line icon + name + brightness + toggle.

All reads and writes go through two Home Assistant scripts, so **no device IPs
are hardcoded or mapped anywhere** and there are no CORS issues — Home Assistant
makes the HTTP requests server-side. On HTTP-served dashboards the card also
listens to the strip's own WebSocket (host auto-resolved from HA's device
registry) so changes made elsewhere — the WLED app, another dashboard — appear
within about a second.

---

## Screenshots

A **master** card — showing the **Mixed** indicator and its read-only
**Segments** list — next to two individual segment cards:

![A master rgbcct-light-card with a Mixed badge and Segments list, beside two per-segment cards](https://github.com/user-attachments/assets/55d6570e-d501-4246-ae10-02423a353f55)

**Compact mode** — a one-line icon, name, brightness, and power toggle:

![Three rgbcct-light-cards in compact mode](https://github.com/user-attachments/assets/1071f769-20a9-49b2-8d54-a8964290db7d)

---

## Motivation

Home Assistant's native WLED integration can't drive the RGB and CCT channels of
an RGBCCT strip independently. From the integration's own documentation:

> WLED exposes a single color model per segment in Home Assistant. This means
> that mixed-type LED strips — for example RGB + CCT or RGBW + CCT combinations —
> cannot currently have their RGB and CCT channels controlled independently in
> Home Assistant. When such strips are used, only one color temperature or hue is
> active at a time.

This card works around that limitation: it writes the full multi-channel state
(RGB + white + CCT) to WLED in a single write via the helper scripts — so RGB
and CCT are active at the same time — while still surfacing as a normal Lovelace
card.

This is also my first AI-assisted project: the implementation, the refactoring,
and this documentation were developed collaboratively with
Anthropic's Claude.

---

## Requirements

- Home Assistant with the **WLED integration** set up (each strip appears as a
  device with a `configuration_url`, from which the scripts derive its IP).
- A WLED strip configured for **RGBCCT** output.
- Node.js 20+ to build the card bundle.

### Tested hardware & software

Developed and tested against SPI RGBCCT strip, specifically BTF's model: **BTF-SPI FCOB RGBCCT**, driven by **WLED v0.15.1** and configured in WLED with the **FW1906 GRBCW** LED type.
The card is built specifically for RGBCCT hardware; **RGB-only, RGBW, and
plain PWM strips are untested and may not work as expected**

---

## Installation

### 1. Build the card

```bash
npm install
npm run build
```

This produces the bundle at `dist/rgbcct-light-card.js` — a single
self-contained file (the `dist/` folder is gitignored; you build it as part of
deploying). The Lovelace resource must point at this **generated bundle**, not
at the `src/` files.

### 2. Add it to Home Assistant as a resource

Make the built bundle reachable from HA's `www/` folder (served at `/local/`),
then register it as a Lovelace resource. Two common layouts:

- **Copy just the bundle:** copy `dist/rgbcct-light-card.js` to
  `config/www/rgbcct-light-card.js` → resource URL `/local/rgbcct-light-card.js`.
- **Keep the whole project under `www/`:** if the repo lives at
  `config/www/rgbcct-light-card/`, point the resource at the bundle inside it →
  `/local/rgbcct-light-card/dist/rgbcct-light-card.js`.

Register it via **Settings ▸ Dashboards ▸ ⋮ ▸ Resources ▸ Add resource**:

- **URL:** the `/local/...` path to the bundle (from whichever layout above)
- **Type:** `JavaScript Module`

Or in YAML-mode dashboards:

```yaml
resources:
  - url: /local/rgbcct-light-card/dist/rgbcct-light-card.js
    type: module
```

The bundle logs its version to the browser console on load
(`RGBCCT-LIGHT-CARD v0.2.0`), so you can confirm which build is live.

> The filename has **no content hash** on purpose — the HA resource URL stays
> stable across rebuilds, so you never have to re-register it. After updating
> the card, hard-refresh the dashboard (or bump the resource's `?v=` query) to
> clear the browser cache.

### 3. Install the two Home Assistant scripts

The card writes to and reads from WLED via two HA scripts plus a pair of REST
commands. All three are in the [`HA Scripts/`](HA%20Scripts/) folder.

**a. REST commands** — add the contents of
[`HA Scripts/rest_commands.yaml`](HA%20Scripts/rest_commands.yaml) to your
`configuration.yaml` (under a top-level `rest_command:` key), then restart Home
Assistant. These do the actual `POST`/`GET` to WLED's `/json/state`.

**b. Scripts** — create two scripts via
**Settings ▸ Automations & Scenes ▸ Scripts ▸ Add Script ▸ Edit in YAML**, and
paste in:

| File | What it does |
| --- | --- |
| [`HA Scripts/send wled with cct.yaml`](HA%20Scripts/send%20wled%20with%20cct.yaml) | Writes colour / brightness / white / CCT to WLED (`script.send_wled_with_cct`). |
| [`HA Scripts/get wled with cct.yaml`](HA%20Scripts/get%20wled%20with%20cct.yaml) | Reads WLED's true live state back for the card (`get_wled_with_cct`). |

Both scripts parse the target **segment** from the entity's `_segment_<n>`
suffix (the bare group entity is treated as segment `-1`, i.e. segment 0), and
resolve the strip's IP from the WLED device's `configuration_url` — so there's
no entity→IP map to maintain.

> **Note:** after editing the `get` script, reload it in HA (or restart) so its
> per-segment `on` output is available. The card has a safe fallback if it
> isn't, but the master's segment on/off list is most accurate once it's live.

---

## Configuration

Add a card to your dashboard:

```yaml
type: custom:rgbcct-light-card
entity: light.living_room_wled
name: Living Room
```

### Options

| Option    | Type      | Default        | Description                                                                 |
| --------- | --------- | -------------- | --------------------------------------------------------------------------- |
| `entity`  | string    | **required**   | The WLED light entity. A whole-device entity makes a **master** card; a `_segment_<n>` entity makes a **segment** card. |
| `name`    | string    | the entity id  | Title shown in the card header.                                             |
| `compact` | boolean   | `false`        | One-line mode: icon + name + brightness % + power toggle, no colour controls. |
| `master`  | boolean   | auto-detected  | Force master (`true`) or segment (`false`) behaviour, overriding the auto-detection based on the entity name. |
| `push`    | boolean   | `true`         | Set `false` to disable the direct WLED WebSocket (instant external updates) and rely on the 3 s poll instead — e.g. to spare WLED's limited WebSocket client slots. |

### Examples

**Master card** (whole strip, with the collapsible Segments list):

```yaml
type: custom:rgbcct-light-card
entity: light.living_room_wled
name: Living Room
```

**Single segment**:

```yaml
type: custom:rgbcct-light-card
entity: light.living_room_wled_segment_0
name: Desk Underglow
```

**Compact**:

```yaml
type: custom:rgbcct-light-card
entity: light.living_room_wled
compact: true
```

---

## Master / segment model

A WLED strip with **N segments** surfaces **N + 1** Home Assistant entities:

- the **group** entity for the whole device — no suffix, e.g.
  `light.living_room_wled`
- one **segment** entity per segment, suffixed `_segment_<n>`, e.g.
  `light.living_room_wled_segment_0`, `..._segment_1`, …

A card whose `entity` is the **group** entity is a **master** card:

- It shows a collapsible **Segments** list (read-only: per-segment colour swatch
  and brightness, or "Off").
- When the segments aren't uniform, the header swatch becomes a rainbow disc and
  a **Mixed** chip appears.
- Its power toggle drives the whole group **and** every segment, so an
  individually-off segment comes back on with the master. The toggle reads as
  "on" when any segment is lit.

A card whose `entity` is a **segment** entity controls just that segment.
Turning a single segment on also powers the device on so it actually lights.

Set `master: true` / `master: false` to override this if your entity naming
doesn't follow the convention.

---

## Limitations

- **Setup has moving parts.** The card isn't a drop-in — it needs the two Home
  Assistant scripts and the REST commands (above) installed and named as
  expected before it can talk to WLED.
- **On HTTPS dashboards, colour changes made elsewhere can lag ~3 s.** The card
  subscribes directly to the strip's WebSocket (`ws://<ip>/ws`) so external
  changes — including pure *colour* changes — normally appear within ~1 second.
  But WLED only speaks plain `ws://`, which a browser refuses to open from an
  **HTTPS** page (mixed content). So on HTTPS-served dashboards — Nabu Casa
  remote access, most reverse-proxy setups — the card automatically falls back
  to a 3-second poll for external colour changes. (Brightness and CCT changes
  are instant everywhere: they surface on the HA entity, which the card watches
  regardless.) Closing this gap fully would take a **custom integration** that
  holds the WLED WebSocket connection server-side and re-broadcasts its frames
  as Home Assistant events: the browser then receives the push over HA's own
  authenticated WebSocket (`wss://`, so no mixed-content block), exactly how
  native `local_push` integrations stay live through Nabu Casa. That's how every
  standard integration works remotely — but it's a separate component to build,
  install, and maintain, so this card keeps the poll fallback instead.
- **WLED / RGBCCT specific.** The card assumes WLED's `/json/state` segment
  model and the `_segment_<n>` entity-naming convention. It isn't a general
  light card. It has only been tested on RGBCCT hardware (BTF-SPI FCOB RGBCCT
  strip); behaviour on RGB-only, RGBW, or plain PWM strips is unknown.
- **The master's segment list is read-only.** From a master card you can *see*
  each segment's colour and brightness, but not edit an individual segment —
  use a per-segment card (`entity: ..._segment_<n>`) to control one directly.
- **YAML configuration only.** There's no visual (GUI) card editor yet; cards
  are configured by hand in YAML.
- **Primary colour + white + CCT only.** Per-segment secondary and tertiary
  colours, plus WLED effects, palettes, presets, and playlists, aren't exposed.

## Future development

Ideas under consideration (not commitments):

- A **visual config editor** (`getConfigElement` / `getStubConfig`) so cards can
  be added and edited from the UI without hand-writing YAML.
- **Editing segments from the master card**, turning the read-only list into
  per-segment controls.
- **Secondary / tertiary colours, effects, and presets** — surfacing more of
  WLED's per-segment colour model alongside its effects and saved presets.
- **Easier install** — shipping the HA scripts as a reusable blueprint to shrink
  the setup steps.
- **Instant colour updates on HTTPS dashboards** — closing the ~3 s
  remote-access gap noted in the limitations above. Two routes: a lightweight
  opt-in "doorbell entity" (an MQTT sensor on WLED's `…/c` topic the card
  watches), or a **custom integration** that holds the WLED WebSocket
  server-side and re-broadcasts its frames as HA events, delivered to the card
  over HA's own `wss://` connection — heavier to build and maintain, but the
  same push mechanism native `local_push` integrations use to stay live through
  Nabu Casa.

---

## Development

Node 20+, Windows/macOS/Linux. Line endings are normalised to LF.

| Command | What it does |
| --- | --- |
| `npm run build` | Production build → `dist/rgbcct-light-card.js` (minified, no sourcemap). |
| `npm run build:dev` | Same bundle **with a sourcemap**, for debugging live in HA devtools against `src/`. |
| `npm run watch` | Dev build that rebuilds on every save. |
| `npm run lint` / `lint:fix` | ESLint 9 (flat config). |
| `npm run format` / `format:check` | Prettier, scoped to `src/**/*.js`. |

**Rebuild `dist/` after every `src/` change** — Home Assistant loads the built
bundle, not the source.

The card is a vanilla ES-module Web Component (no framework), built with
Vite into an IIFE bundle. Source layout:

- `src/rgbcct-light-card.js` — the custom element: lifecycle, colour state, send.
- `src/mixins/` — prototype mixins (`sync`, `segments`, `ui`) merged onto the class.
- `src/render.js`, `events.js`, `styles.js`, `wled.js` — per-lifecycle `fn(card)` modules.
- `src/color.js`, `entities.js` — pure helpers (colour math, entity-naming).

---

## Disclaimer

This is a personal hobby project, provided **as-is and without warranty of any
kind**. It is not affiliated with or endorsed by Home Assistant, WLED,
BTF-Lighting, or Anthropic. Use it at your own risk: you are responsible for what
you install on your Home Assistant instance and for anything you connect it to.
Installing this card involves editing your Home Assistant configuration and
sending commands to networked LED hardware — proceed at your own discretion, and
the author accepts no responsibility for any resulting damage or data loss.

---

## License

Released under the [MIT License](LICENSE) — © 2026 Tony Vo.
