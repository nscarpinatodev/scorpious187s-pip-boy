# Changelog

All notable changes to this module are documented here. This project follows
[Semantic Versioning](https://semver.org/).

## [1.5.0] — 2026-09-24

### Added

- **The Pip-Boy can be your character sheet.** It is now registered as a real
  Foundry sheet for `character` and `robot` actors, so any player who owns their
  character can pick it from **Sheet Configuration** and have it open on every
  click of their token or their name in the directory. It is not a default:
  nobody is switched over without choosing it.
  - A **gear** in the Pip-Boy's own top bar opens Sheet Configuration, because
    the casing hides the window header the gear normally lives in. Without it
    the Pip-Boy would be a one-way door — chosen as your sheet with no way back
    to the system's own.
  - The Token HUD button and the sheet are the **same window**: opening from the
    HUD routes through the document's sheet when the Pip-Boy is the sheet, so a
    character never ends up with two Pip-Boys on screen.
- **XP awards when a combat ends.** Ending a combat totals the XP of the NPCs
  and creatures that were in it and opens a Vault-Tec tally for the GM, with the
  running total on the same mechanical reels the travel counter uses.
  - The XP per foe is the system's own derived reward value, from that NPC's
    level and category (minion / normal / mighty / legendary) — nothing new to
    fill in on a statblock.
  - Foes marked **defeated** are ticked by default; anything that fled or was
    talked down can be ticked back in, and the total re-spins as you go.
  - The award is **split between the characters** by default, or can go **full
    to each**; flipped per award or set as the default.
  - A chat card records who received what, and flags anyone who has just crossed
    their next-level threshold.
  - Available by hand as well:
    `game.modules.get("scorpious187s-pip-boy").api.awardXp()`.
- **Level-up advancement wizard.** When a character banks enough XP, a pulsing
  **LEVEL UP** appears on STATUS and opens a four-step wizard drawn over the CRT
  — the new level, skill ranks, a perk, then confirmation. Nothing is written to
  the actor until the last step is confirmed, and the whole thing can be
  cancelled.
  - **Skills** — a pool of ranks (1 per level by default) spent freely across
    skills up to a cap of 6. Both are world settings. A **Bonus** stepper adds
    points for that level alone, for a feature such as Tag! that grants extra
    ranks.
  - **Perks** — the eligible list comes from the system's own perk manager, so
    level, per-rank level steps for multi-rank perks, attribute minimums, and
    magazine prerequisites are all honoured. Hovering a perk shows its
    description in the casing's lower readout. Requirements the system records
    but cannot check — *not ghouls*, *companions only* — are shown as advisory
    notes rather than silently ignored.
  - **Max HP is never written.** The system derives it as
    `END + LUC + (level − 1) − radiation + bonus`, so raising the level does it;
    the wizard only shows the consequence. What happens to *current* HP is a
    setting: leave it, +1 to match, or heal to full as in the games.
  - **Perk effects, built as the perk is taken.** Perks like Intense Training,
    Life Giver and Tag! change a score, but need a *choice* first, so the system
    ships them with no Active Effect. The wizard asks the question, builds the
    effect, attaches it to the perk item, and **remembers the shape of it** so
    the next character to take that perk gets it without being asked again.
    - Configured out of the box, from the perks' own printed text: **Intense
      Training**, **Life Giver**, **Tag!** (tags a skill and raises it 2
      ranks), **Skilled** (2 ranks to spend), **Toughness**, **Rad
      Resistance**, **Refractor**, **Snakeater** and **Strong Back**.
    - Anything else can be built in the wizard: pick a target (a SPECIAL,
      max HP, defense, initiative, melee damage, a resistance, luck points,
      carry weight, or any data path), a mode, and a value.
    - Values may be **live references** — Life Giver uses
      `@attributes.end.value`, so it tracks Endurance rather than freezing the
      number it had on the day.
    - The effect goes on the *perk item*, so removing the perk removes it, and
      taking another rank adds another effect rather than editing the first.
    - **SPECIAL cap** — an attribute already at the cap (10 by default, a
      setting) can't be raised again. The check is against the character's
      *current* value, so an earlier Intense Training counts towards it.
  - **Locked perks stay on the list, in red.** The system's own helper drops
    every perk whose requirements aren't met, so there was no way to see what a
    character was working towards. The wizard now reads the whole perk
    compendium itself and shows everything still takeable, eligible first, with
    locked ones in red and the missing requirement marked. Perks already at
    maximum rank are still dropped — there is nothing left to take.
  - **Perk requirements are shown and enforced.** Each perk in the list
    carries its requirements as chips — `LVL 4`, `INT 6`, `MAGAZINE` — and
    anything unmet is greyed out and refuses to be selected. The wizard
    checks them itself rather than trusting the list it was handed, so it
    also catches the per-rank level step on multi-rank perks and blocks
    robot-excluded perks on robots. Requirements and the cap are re-checked
    when CONFIRM is pressed, so nothing gets through by skipping a step.
  - A chat card records the level, the perk, and the skills raised.
- **Quantity editor** in the inventory right-click menu, for any stackable item.
  It opens the same fly-out used by RADS, CAPS, and XP.

### Changed

- **The numeric fly-out editor gained `−` / `+` buttons** on either side of the
  field — so RADS, LUCK, CAPS, fatigue, intoxication, level, XP, power-armor
  piece health, and item quantity are all adjustable without typing. Hold a
  button to run the number, hold **Shift** to step by 10, and the buttons dim at
  the value's limits. The value is still written on ✓ or Enter, so a run of
  presses is one update. The browser's own spinner is hidden.
- **V.A.T.S. retarget.** Attack and damage cards carry a target reticle: target
  a token, click it, and the roll is re-aimed without rolling again. GM only.

## [1.4.0] — 2026-08-30

### Changed

- **Now requires Scorpious187's Module Library**, installed automatically as a
  dependency. The library hosts the family update notifier, so Pip-Boy can tell
  you about its own releases; without it the module's entry in the shared update
  feed was read by nothing.

## [1.3.0] — 2026-08-29

### Added

- **Hex travel — Fallout 1-style fast travel.** Dragging the party token across a
  hex-gridded World Map scene is intercepted and replayed **one hex at a time**:
  each hex advances world time and rolls for a random encounter, and the journey
  halts where an encounter fires.
  - **Party actor** — the fallout system has no group actor type, so the module
    creates one on request (an `npc` with real health, owned by all players,
    never a 0 HP character in the directory) and selects it as the map's token.
    Its roster records who is travelling.
  - **Encounters** — chance per hex, reduced by the party's best **Survival**
    rank (the Outdoorsman analogue) down to a configurable floor. Tables are a
    world default, overridable per terrain by a table picker added to **Region**
    configs.
  - **Pace** — a **Seconds per Hex** setting drives the whole journey: the
    token's glide, the counter's spin, and the clock all derive from it, so
    nothing drifts out of step. The party walks the route rather than teleporting.
  - **The Wayfarer** — encounter checks are shown as a Vault-Tec counter with
    three mechanical number reels that spin up and settle left to right, in
    place of dice. It reports the target, the result, and CLEAR or ENCOUNTER.
  - **Every roll is recorded** — the journey's chat card lists each hex's roll
    against the chance, so a quiet crossing is as legible as an eventful one.
  - **Time** — advanced once per hex as it is crossed, through Calendaria's own
    `advanceTime` API when present and core `game.time` otherwise, so Simple
    Calendar and Seasons & Stars follow along without a dependency.
  - **Undo** — every journey posts a chat card with **UNDO TRAVEL**, restoring
    position, rewinding the clock, un-marking any drawn table results, and
    voiding the encounter card. Only the most recent journey can be undone.
  - Travel requires a hexagonal world map and a GM online; both are enforced
    rather than silently skipped. Configured under **Configure World Map**.
- **Scene-linked encounters** — an encounter can name a prepared **scene**, so a
  roll on the world map resolves into an actual map.
  - **Encounter Builder** (Game Settings → Build Encounter Tables) edits
    encounters as rows: name, weight, scene, playlist, journal, and GM notes.
    It writes an ordinary **RollTable**, so weights, draw-without-replacement,
    compendium export, and per-Region overrides all keep working — the scene and
    its trimmings ride along in module flags on each result.
  - **The GM confirms.** A scene-linked encounter halts the party and prompts the
    GM with **Activate / Reroll / Ignore**; players only ever see the encounter
    card. Rerolling draws again and re-prompts. The card keeps an ACTIVATE
    button, so a dismissed prompt is not a dead end.
  - **Activation** preloads the scene's art (begun as the encounter is rolled),
    activates it, optionally pulls players in, starts the encounter's playlist,
    and opens its journal for the GM alone.
  - **RETURN TO MAP** reactivates the world map afterwards; the party token is
    still on the hex where the journey stopped, so travel resumes on the next
    drag. The control is a standing GM banner rather than only a chat card,
    since chat scrolls away long before an encounter ends: it survives a reload,
    hides itself once you are back, and can be **dragged between six snap
    positions** — the four corners plus top and bottom centre, the latter lifted
    clear of the Overseer and Party AP counters. Ghost outlines show every
    position while dragging, and the choice is remembered per client.
  - Plain text encounter tables are unaffected and need no changes.

## [1.2.0] — 2026-08-23

### Fixed

- **Maps on tile-built scenes** — the MAP tab treated a scene as unavailable
  unless it had a background image, so the **LOCAL** (or **WORLD**) button
  disappeared on scenes assembled purely from tiles. A scene now qualifies if it
  has a background image **or** any tiles tagged "Show on Pip-Boy map"; with no
  background to measure, the map sizes itself from the scene's own dimensions
  and draws the tiles in their proper places. The gate dated from v0.1.0 and had
  been wrong since tile support arrived in v0.3.0.

## [1.1.0] — 2026-08-15

### Added

- **V.A.T.S. damage automation (Phase 1)** — the roller's targets are stamped
  onto fallout roll cards, and damage cards gain a V.A.T.S. block: one row per
  target showing the damage-resistance math for the rolled hit location and
  damage type (Piercing X honoured; Radioactive adds rads, reduced by the
  location's radiation resistance), with GM-only
  APPLY / APPLY TO ALL buttons and an UNDO on each outcome card. World setting
  to turn it off.
- **V.A.T.S. HIT/MISS verdicts** — attack cards show successes vs a difficulty
  that defaults to the **targeted actor's Defense rating** (highest, when
  several targets are marked; tagged DEF on the card) and can be overridden by
  the GM right on the card, with a HIT or MISS badge and excess successes shown
  as AP. **Re-roll cards get their own verdict strip** — they inherit the
  original attack's hit location, targets, and difficulty, and the latest roll
  of an attack is the one damage cards link to. Damage cards linked to a missed
  attack carry an "ATTACK MISSED" warning (apply stays available as an
  override).
- **V.A.T.S. injury prompts** — when applied damage is 5+ to one location or
  drops the target to 0 HP, the GM is prompted to mark an open injury on that
  limb; UNDO restores injuries along with HP and rads. Characters and robots
  get an injury slot (as on their sheets); NPCs and creatures get their
  sheet's open-injury count incremented instead. World setting to disable.
- **V.A.T.S. AP banking** — on a hit with excess successes, the roller (or GM)
  can bank them into the system's AP tracker with one click on the attack card.
  Player attacks feed the party pool; GM-rolled attacks feed the GM pool. Each
  card banks once.
- **V.A.T.S. conditions (Phase 3)** — Stun weapons that roll Effects prompt the
  GM to apply the Stunned status; Persistent weapons prompt the GM to track
  recurring damage — the weapon's damage repeating at the **end** of each of
  the target's next N turns (N = Effects rolled), through damage resistance,
  with APPLY / END EFFECT prompts and automatic expiry when the duration runs
  out. Burst, Spread, Breaking,
  Freeze, Arc, and Tranquilize show reminder chips on the damage card for GM
  adjudication. UNDO clears applied conditions too.
- **V.A.T.S. power-armor ablation** — damage to a location covered by powered
  power armor reduces that piece's health first, and only the overflow reaches
  the wearer. The damage card shows the split ("armor soaks 5 (8→3) → wearer
  0"), the outcome card reports the piece's health and flags a breach at 0, and
  UNDO restores the piece. World setting to disable.
- **V.A.T.S. bonus dice for AP** — attacks *and damage rolls* made from the
  Pip-Boy first offer to buy extra dice with AP (d20s for attacks, combat dice
  for damage), showing the pool balance and only listing what's affordable. The
  cost is deducted from the party (or GM) pool and announced in chat. Bought
  damage dice are primed into the roll dialog's Extra Dice field, which the
  system excludes from its ammunition maths, so they cost AP and not ammo. Cost
  model for attack dice is configurable — escalating 1/3/6 by default, or flat.
  Damage dice follow the rules by weapon class: melee, unarmed, and thrown
  weapons spend up to 3 AP at +1 DC each, while ranged weapons buy extra DC
  with **ammunition** through the system's Fire Rate selector and are not
  offered an AP purchase at all.
- **AIM minor action** — an AIM button beside the action pips spends the minor
  action and marks the character as aiming until their next attack, lighting up
  while active and clearing when the attack is rolled or the round advances. An
  **Accurate** weapon fired while aiming buys bonus damage at the rules' flat
  rate (1 AP per +1 DC, up to 3) instead of with ammunition.
- **Major / minor action tracking** — action pips on the STATUS tab (MAJOR
  shown as two dots, MINOR as one) that dim as they're spent and reset when the
  combat round advances. Attacking spends the major action; when none remains,
  the Pip-Boy offers to buy another with AP (2 for a major, 1 for a minor),
  deducting from the party or GM pool and announcing it in chat. Warns rather
  than blocks if the purchase is declined. World setting to disable.
- **FAVORITES on the STATUS tab** — weapons and consumables flagged as
  favourites get their own section, split into WEAPONS (attack / damage
  buttons) and CONSUMABLES (use button, quantity shown), for quick access
  without leaving STATUS. Favourites can be managed entirely from the Pip-Boy:
  the inventory right-click menu gains **Favorite / Unfavorite** for weapons
  and consumables, favourited rows are starred in the inventory list, and each
  FAVORITES row has a star button to drop it again. Uses the same
  `system.favorite` flag as the character sheet, so the two stay in sync.
- **Add items from the compendiums** — an **ADD ITEM** button on the INV tab
  opens the fallout system's own item-type menu and compendium browser, adding
  the chosen item straight to the character (the character sheet's flow,
  reproduced in the Pip-Boy).
- **Pip-Boy size setting** — a per-client scale for the whole Pip-Boy window
  and its text (100% / 115% / 130% / 150%), defaulting to **115%** after
  players reported the screen being hard to read. Layout inside the casing is
  percentage-based, so the artwork, controls, and type all scale together.
- **Pip-Boy light distances** — new world settings for the light's bright and
  dim radii (defaults 10 / 20 scene units).

### Changed

- **Drop now puts items on the ground** — the inventory context menu's Drop
  creates an **Item Pile** at your token instead of deleting the item. Piles are
  backed by a single module-owned `npc` actor with real health, so no 0 HP
  character actors accumulate in the directory, and player drops are executed by
  the GM's client. With no token on the scene (or without the Item Piles module)
  the item is unequipped and kept — dropping never destroys anything.
- **V.A.T.S. card layout and styling** — cards are now a self-contained
  terminal panel laid out over two rows (identity and verdict on top, the
  maths and controls beneath) so they read in a narrow chat sidebar. All
  colours, buttons, and selects are set explicitly from the block's own tokens
  rather than inherited, hardened against chat restyling by UI modules such as
  Carolingian UI.
- **V.A.T.S. auto-damage chaining** — after an attack rolled from the Pip-Boy,
  the damage dialog (rate of fire, extra dice, ammo) opens automatically, so a
  full exchange runs attack → damage → apply. Missed attacks don't chain
  (damage can still be rolled manually if the GM overrules the verdict).
  World setting to disable.

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
