# rgbcct-light-card

A custom Home Assistant Lovelace card for
controlling **WLED-based RGBCCT** LED strips — RGB colour _and_ tunable white
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

The card is paired with a small custom integration, **`rgbcct_wled`**, which
holds the connection to the strip server-side and exposes each segment as a
standard RGBWW light. So **no device IPs are hardcoded or mapped anywhere**,
there are no CORS issues, and the card itself makes no network calls at all — it
calls `light.turn_on` and reads entity state like any other Lovelace card.
Changes made elsewhere (the WLED app, another dashboard) appear within about a
second, on HTTP and HTTPS alike.

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

This project works around that limitation by modelling each segment as an
**RGBWW** light, a colour mode that carries red, green, blue, cold-white and
warm-white together — so colour temperature rides the cold/warm ratio and RGB
stays independent of it. One write sets the whole multi-channel state, and
because it is a normal light entity, Home Assistant's own dialogs, scenes and
voice control drive it too. The card is just one client of it.

This is also my first AI-assisted project: the implementation, the refactoring,
and this documentation were developed collaboratively with
Anthropic's Claude.

---

## Requirements

- **Home Assistant 2024.11 or newer.** The integration uses three APIs with
  different minimums — `entry.runtime_data` (2024.6), the
  `homeassistant.helpers.service_info` location of `ZeroconfServiceInfo` (2024.9),
  and an `OptionsFlow` that takes its config entry implicitly (2024.11) — so the
  highest of them is the floor. It has only been exercised against 2026.6.
- A WLED strip configured for **RGBCCT** output, reachable on your network.

Nothing else — the card ships as a prebuilt file. Node.js is needed only to
[work on the card](#development), not to use it.

### Tested hardware & software

Developed and tested against SPI RGBCCT strip, specifically BTF's model: **BTF-SPI FCOB RGBCCT**, driven by **WLED v0.15.1** and configured in WLED with the **FW1906 GRBCW** LED type.
The card is built specifically for RGBCCT hardware; **RGB-only, RGBW, and
plain PWM strips are untested and may not work as expected**

---

## Installation

There are two pieces, and they install separately: the **integration**, which
talks to the strip and creates the entities, and the **card**, which is the UI
for them. The integration is the part that must be installed — the entities it
creates work with Home Assistant's own light card too.

### 1. Install the `rgbcct_wled` integration

**Via HACS** — this repo is not in HACS's default store, so add it as a custom
repository: **HACS ▸ ⋮ ▸ Custom repositories**, URL
`https://github.com/tonyvo30/rgbcct-light-card`, category **Integration**, then
**Add**. Find **RGBCCT WLED** in the list and download it.

**By hand** — copy the `custom_components/rgbcct_wled/` folder from this repo
into your Home Assistant config folder, so it ends up at
`config/custom_components/rgbcct_wled/`.

Either way, **restart Home Assistant** afterwards.

> Restarting is not optional, and neither is it interchangeable with the config
> entry's ⋮ ▸ _Reload_. Home Assistant imports an integration once and Python
> caches the module, so after new or changed code a reload re-runs setup against
> the **old** module and appears to have worked.

### 2. Add your strip

**Settings ▸ Devices & Services ▸ Add Integration ▸ RGBCCT WLED**, and enter the
strip's hostname or IP. If the strip is on the same network, Home Assistant will
usually discover it over zeroconf and offer it without your typing anything.

This creates **N + 1** light entities — one per WLED segment, plus a
whole-device group entity. See [Master / segment model](#master--segment-model).

> **This replaces the native WLED integration for that strip.** The two can
> coexist without colliding (they register as separate devices on purpose), but
> you will get two sets of entities for one strip. Native WLED still has effects,
> presets and playlists that this integration does not expose, so keep it if you
> use those — otherwise remove that strip from it.

### 3. Install the card

Download **`rgbcct-light-card.js`** from the
[latest release](https://github.com/tonyvo30/rgbcct-light-card/releases/latest)
and copy it into your Home Assistant `config/www/` folder, which Home Assistant
serves at `/local/`. That makes the resource URL `/local/rgbcct-light-card.js`.

Prefer to build it yourself? See [Development](#development) — the built bundle
is the same single self-contained file.

### 4. Register the Lovelace resource

**Settings ▸ Dashboards ▸ ⋮ ▸ Resources ▸ Add resource**:

- **URL:** `/local/rgbcct-light-card.js`
- **Type:** `JavaScript Module`

Or, on a YAML-mode dashboard:

```yaml
resources:
  - url: /local/rgbcct-light-card.js
    type: module
```

The card logs its version to the browser console on load
(`RGBCCT-LIGHT-CARD v0.2.0`), so you can confirm which build is live.

> The filename carries **no content hash** on purpose — the resource URL stays
> stable across updates, so you never have to re-register it. The flip side is
> that browsers cache it: after updating the card, hard-refresh the dashboard
> (or bump the resource's `?v=` query) to be sure you are running the new one.

### Updating

The card and the integration are versioned together and released from one tag.
Update the integration through HACS (or by re-copying the folder) and **restart**;
replace `config/www/rgbcct-light-card.js` with the new release asset and
hard-refresh the dashboard.

---

## Configuration

Add a card to your dashboard:

```yaml
type: custom:rgbcct-light-card
entity: light.living_room_wled
name: Living Room
```

### Options

| Option     | Type        | Default       | Description                                                                                                                                                                   |
| ---------- | ----------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `entity`   | string      | **required**  | The WLED light entity. The whole-device (group) entity makes a **master** card; a per-segment entity makes a **segment** card.                                                |
| `name`     | string      | the entity id | Title shown in the card header.                                                                                                                                               |
| `compact`  | boolean     | `false`       | One-line mode: icon + name + brightness % + power toggle, no colour controls.                                                                                                 |
| `master`   | boolean     | auto-detected | Force master (`true`) or segment (`false`) behaviour. Auto-detection reads the entity's `is_group` / `segment_id` attributes, never its name — so you rarely need this.       |
| ~~`push`~~ | ~~boolean~~ | —             | **Removed.** It disabled the card's direct WLED WebSocket, which no longer exists — the card gets pushed updates through Home Assistant instead. Setting it now does nothing. |

### When the entity is wrong

If `entity` names something that does not exist, the card is replaced by
**"Entity not found: `<id>`"**. If it names a real entity that is not one of the
`rgbcct_wled` integration's lights — a typo landing on another light, or the
native WLED integration's entity for the same strip — it says **"Not an
rgbcct_wled light: `<id>`"**.

A light that exists but is currently **unavailable** is not an error: the card
renders as normal and shows the segments as unavailable, because the
configuration is fine and the device is simply offline.

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
- one **segment** entity per segment, named "Segment _n_" — which usually gives
  ids like `light.living_room_wled_segment_0`, `..._segment_1`, …

Those ids are only a naming _default_, not a contract. Home Assistant fixes an
entity id when the entity is first created and never revises it, so renaming the
device — or just assigning it to an area — leaves older siblings on the old
pattern while new ones get the new one. The card therefore finds an entity's
siblings by **device**, and tells the two kinds apart by the attributes each one
declares: a segment carries `segment_id`, the group carries `is_group`.

**Rename any of these freely.** Nothing in the card or the integration reads an
entity id for meaning.

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

`master: true` / `master: false` forces the choice, but the detection does not
depend on naming, so you should not normally need it.

---

## Limitations

- **The segment list is fixed when the device is set up.** The integration reads
  the strip's segments once, at startup, and creates one entity for each. Add or
  remove a segment in WLED afterwards and Home Assistant will not notice: the new
  one gets no entity, and a removed one leaves an entity that reads
  _Unavailable_. **Reload the integration** (Settings ▸ Devices & Services ▸
  RGBCCT WLED ▸ ⋮ ▸ Reload) after changing your segment layout. This is an
  accepted simplification, not a bug being worked around.
- **Turning the whole device on from Home Assistant resets a master brightness
  set in the WLED app.** WLED has a device-level brightness that multiplies every
  segment's own, but a Home Assistant light has only one brightness, and this
  integration maps it to the **segment**. So a whole-device turn-on pins the
  device master back to 100%. Without that, a master left at 20% in the app would
  make "turn on at full brightness" from Home Assistant come up dim with nothing
  in Home Assistant able to explain why. Turning on a **single segment** never
  touches the master — changing a device-wide setting from one segment's entity
  would move every other segment too.
- **While the WLED master is below 100%, reported brightness reads high.** For
  the same reason: Home Assistant shows the segment's brightness, and the light
  you actually see is `master × segment`. With the master at 50%, a segment
  reported as 100% is really at half output. Set the master to 100% in the WLED
  app — where it stays, unless a whole-device turn-on resets it as above — and
  the two agree.
- **WLED / RGBCCT specific.** The card assumes WLED's `/json/state` segment
  model and the entities the `rgbcct_wled` integration creates from it. It isn't
  a general light card. It has only been tested on RGBCCT hardware (BTF-SPI FCOB
  RGBCCT strip); behaviour on RGB-only, RGBW, or plain PWM strips is unknown.
- **The master's segment list is read-only.** From a master card you can _see_
  each segment's colour and brightness, but not edit an individual segment —
  point a second card at that segment's entity to control it directly.
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
- **Opening Home Assistant's more-info dialog** from the card, for the entity
  settings native cards expose (name, icon, area, labels, visibility).
- **Following segment changes without a reload**, removing the first limitation
  above.

---

## Development

Node 20+, Windows/macOS/Linux. Line endings are normalised to LF. Start with
`npm install`.

| Command                             | What it does                                                                        |
| ----------------------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`                     | Production build → `dist/rgbcct-light-card.js` (minified, no sourcemap).            |
| `npm run build:dev`                 | Same bundle **with a sourcemap**, for debugging live in HA devtools against `src/`. |
| `npm run watch`                     | Dev build that rebuilds on every save.                                              |
| `npm run lint` / `lint:fix`         | ESLint 9 (flat config).                                                             |
| `npm run format` / `format:check`   | Prettier, over the whole repo (see `.prettierignore`).                              |
| `npm run test`                      | Card tests plus the Home-Assistant-free integration tests.                          |
| `npm run test:js` / `test:js:watch` | Vitest, for the card (`tests/card/`).                                               |
| `npm run setup:python-env`          | One-time: creates the Python test venv (needs Python ≥ 3.10).                       |
| `npm run test:python`               | Integration tests that need no Home Assistant.                                      |
| `npm run test:python:ha`            | The full Python suite, in Docker.                                                   |
| `npm run deploy:integration`        | Copies `custom_components/rgbcct_wled/` into your HA config. **Restart after.**     |

All tests live under `tests/` — the card's in `tests/card/`, mirroring the
`src/` layout; the integration's alongside it. The Home Assistant tier is
Docker-only, because Home Assistant cannot be imported on Windows, which is why
`npm run test` runs the other two. See [`tests/README.md`](tests/README.md).

**Rebuild `dist/` after every `src/` change** — Home Assistant loads the built
bundle, not the source.

### Layout

The card is a vanilla ES-module Web Component (no framework), built with Vite
into an IIFE bundle:

- `src/rgbcct-light-card.js` — the custom element: lifecycle, colour state, send.
- `src/mixins/` — prototype mixins (`sync`, `segments`, `ui`) merged onto the class.
- `src/render.js`, `events.js`, `styles.js`, `wled.js` — per-lifecycle `fn(card)` modules.
- `src/color.js` — pure helpers (colour maths, and the white/cct ↔ cold/warm
  conversion shared with the integration).

The integration is a standard Home Assistant custom component in
`custom_components/rgbcct_wled/`. Its `color.py`, `models.py` and `payload.py`
import nothing from Home Assistant, which is what lets most of its tests run on a
bare `pytest`; adding an import there — even a relative one — would quietly break
that tier.

### Cutting a release

Bump the version in **both** `package.json` and
`custom_components/rgbcct_wled/manifest.json` — one tag ships the card and the
integration together — then tag and push:

```bash
git tag v0.3.0
git push origin v0.3.0
```

The release workflow lints, tests, builds, and attaches
`dist/rgbcct-light-card.js` to the GitHub release. It **fails the build** if the
tag disagrees with either version file, so a published bundle never misreports
itself in the console banner.

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
