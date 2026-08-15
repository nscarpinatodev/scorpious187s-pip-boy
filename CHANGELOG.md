# Changelog

All notable changes to this module are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-08-14

### Added

- **Right-click editing** — RADS, LUCK, and CAPS on the STATUS tab, Fatigue and
  Intoxication in NEEDS, power-armor piece health, and LEVEL and current XP on
  the DATA tab can now be edited from the Pip-Boy: right-click opens a fly-out
  with a number input (Enter or ✓ applies, Escape or clicking elsewhere
  cancels). The XP threshold shown after current XP stays display-only (the
  system derives it from character level).
- **Inventory context menu** — right-click an item on the INV tab for
  **Drop** (removes it and announces it in chat so the GM can place it),
  **Transfer** (move it to another player character — handled via the GM's
  client when you don't own the target, so a GM must be online for
  cross-player transfers), and **Delete** (with confirmation).
- **Drag-and-drop items** — dropping an Item onto the Pip-Boy (from the items
  sidebar, a compendium, or another actor's sheet) adds a copy to the
  character, just like dropping it on the character sheet. Dropping the
  actor's own items back onto it is ignored rather than duplicating them.
- **Power-armor frame power toggle** — equipped frames now show in the POWER
  ARMOR section with a POWERED/OFFLINE button that powers the frame and all
  attached pieces on or off (the same cascade the character sheet performs).
  The frame row stays visible while unpowered, so armor can be powered back up
  from the Pip-Boy even though unpowered pieces drop out of the health monitor
  and resistances.

## [0.4.0] — 2026-08-14

### Added

- **Pip-Boy sounds** — an activation sound when the Pip-Boy opens and a
  page-change sound when switching tabs. Original synthesized retro UI audio
  (no game assets); per-client "Pip-Boy Sounds" setting to turn them off,
  volume follows the core Interface volume slider.
- **Pip-Boy light** — the POWER lamp on the casing is now clickable and toggles
  a 10 bright / 20 dim light on the actor's token (the lamp glows while on, and
  the token's previous lighting is restored when switched off). A per-client
  setting picks the colour: classic Fallout Green (default) or matching your
  Pip-Boy screen colour.
- **RADIO tab** — playlists inside a GM-named playlist folder (default
  "Pip-Boy Radio") appear as stations. Tuning plays the playlist **locally
  only** — nothing is broadcast, so every player hears their own station (or
  silence). Includes now-playing readout, next-track and off buttons, plus
  per-client RADIO and SOUNDS volume sliders.
- **PIP-OS boot screen** — an FO3-style boot sequence plays on the CRT when the
  Pip-Boy opens: fast POST diagnostics, the PIP-OS(R) V7.1.0.8 readout, and a
  blinking cursor, timed to the activation sound (~5s). Click the screen to
  skip; per-client setting to disable.
- **Select, map-rollover, zoom, and radio on/off sounds** — clicking Pip-Boy
  controls plays a select blip, hovering a GM-tagged tile on the MAP tab plays
  a rollover blip, the map zoom buttons blip, and tuning the radio in/out has
  its own on/off sounds.
- **Custom Sound Folder** (world setting) — point the module at a folder in
  your Foundry user data containing replacement sounds (activate.wav, tab.wav,
  select.wav, rollover.wav, zoom.wav, radio-on.wav, radio-off.wav,
  light-on.wav, light-off.wav, close.wav); missing
  files fall back to the bundled synthesized audio. User-provided files are
  never part of the module — do not redistribute copyrighted audio.

### Fixed

- **Tile config checkbox on every tab** — the "Show on Pip-Boy map" checkbox now
  sits inside the Appearance tab of the Tile configuration instead of floating
  below every tab.

## [0.3.0] — 2026-07-31

### Added

- **NEEDS selectors** — Hunger, Thirst, and Sleep on the STATUS tab are now
  dropdowns (using the system's own condition levels) that write straight back
  to the character.
- **POWER ARMOR section** — equipped, powered power-armor pieces show per-location
  health with a bar and −/+ damage/repair buttons, mirroring the character
  sheet's Power Armor Health monitor.
- **RESISTANCES section** — per-limb Physical / Energy / Radiation / Poison
  damage resistances (armour bonuses included, as derived by the system).
- **EFFECTS on the DATA tab** — active effects from the character and its items,
  grouped like the sheet: temporary (with remaining duration), passive, and
  inactive (dimmed).

- **Tile visibility on the map** — a "Show on Pip-Boy map" checkbox in the Tile
  configuration (same mechanism as Scorpious187's In-Game Map). Tagged tiles are
  drawn on the MAP tab in scene coordinates — panning, zooming, and taking the
  phosphor tint along with the scene image — and the map refreshes live as tiles
  change. Hidden tiles stay hidden.

## [0.2.1] — 2026-07-17

### Fixed

- **Settings dial** — the dial now opens the settings sheet directly on this
  module's settings tab instead of landing on the top of the Foundry settings
  list.

## [0.2.0] — 2026-07-17

### Added

- **CRT Scanlines setting** — a per-client toggle in Module Settings to hide the
  scanline overlay (and its flicker) for players who find it hard to read.
  Defaults to on; takes effect immediately on any open Pip-Boy.
- **Settings dial shortcut** — the dial wheel on the right edge of the casing is
  now clickable (with a phosphor hover glow) and opens the Foundry settings sheet.

### Removed

- **Local Map fog-of-war mask** — it didn't reliably reflect explored areas, so
  the Local Map now shows the full scene background art. Only the background and
  your own position marker are drawn — enemy tokens were never rendered and still
  aren't.

## [0.1.0] — 2026-07-04

Initial release.

### Added

- **Token HUD launcher** — a Pip-Boy button on the Token HUD opens the Pip-Boy for
  a character token.
- **Authentic casing** — the CRT screen is inset into a Pip-Boy frame image, with 8
  selectable frame colours (green, blue, bronze, beige, gray, purple, red, yellow)
  and a matching phosphor screen tint. Transparent window background.
- **STATUS tab** — HP bar with `+/-` adjust, DEF / INIT / RADS / LUCK / CAPS /
  carried-weight vitals, a Vault-Boy-style limb condition figure (using the system's
  body art) with clickable injury pips, S.P.E.C.I.A.L. stats, and NEEDS
  (hunger/thirst/sleep as text, plus fatigue/intoxication).
- **INV tab** — items grouped into Weapons / Apparel / Aid / Ammo / Misc with
  equip toggles, weapon **attack** and **damage** rolls, and consumable **use**
  (all via the fallout system's own dialogs). Zero-quantity items are hidden.
- **DATA tab** — level & XP, skills (left-click to roll with the default attribute,
  right-click to pick an attribute), perks, and traits.
- **MAP tab** — toggle between a GM-configured **World Map** (a chosen scene centred
  on a party token) and a **Local Map** (the active scene centred on your token,
  fog-of-war masked). Both support wheel-zoom, drag-pan, and recentre.
- **Lower readout** — clicking an item/perk/trait (or rolling a skill) shows its
  description in the lower panel of the casing instead of opening a new window.
- **Live updates** — the Pip-Boy reflects actor/item/token changes as they happen,
  and preserves per-tab scroll position across re-renders.
- **GM settings** — World Map configuration (scene, party token, zoom) and a
  per-client frame-colour setting.
