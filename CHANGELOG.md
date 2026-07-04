# Changelog

All notable changes to this module are documented here. This project follows
[Semantic Versioning](https://semver.org/).

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
