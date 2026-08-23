import { MODULE_ID, FRAME_COLORS } from "./constants.mjs";
import { PipBoyApp } from "./PipBoyApp.mjs";
import { PipBoyRadio } from "./radio.mjs";
import { PipBoyVats } from "./vats.mjs";
import { WorldMapConfig } from "./WorldMapConfig.mjs";
import { registerTokenHudButton } from "./token-hud.mjs";

export { MODULE_ID };

/**
 * Handlebars partials that make up the Pip-Boy tabs. Registered at init so the
 * main template can pull them in with `{{> "path"}}`.
 */
const TEMPLATE_PARTIALS = [
	`modules/${MODULE_ID}/templates/tabs/status.hbs`,
	`modules/${MODULE_ID}/templates/tabs/inventory.hbs`,
	`modules/${MODULE_ID}/templates/tabs/data.hbs`,
	`modules/${MODULE_ID}/templates/tabs/map.hbs`,
	`modules/${MODULE_ID}/templates/tabs/radio.hbs`,
];

Hooks.once("init", async () => {
	console.log(`${MODULE_ID} | Initialising Scorpious187's Pip Boy`);

	game.settings.register(MODULE_ID, "frameColor", {
		name: "Pip-Boy Frame Colour",
		hint: "The casing colour used for the Pip-Boy window. The screen tint follows the frame.",
		scope: "client",
		config: true,
		type: String,
		default: "green",
		choices: Object.fromEntries(
			FRAME_COLORS.map((c) => [c, c.charAt(0).toUpperCase() + c.slice(1)]),
		),
		onChange: () => {
			for (const app of foundry.applications.instances.values()) {
				if (app instanceof PipBoyApp) app.render();
			}
		},
	});

	game.settings.register(MODULE_ID, "uiScale", {
		name: "Pip-Boy Size",
		hint: "Scales the whole Pip-Boy window and its text. 115% is the default; raise it "
			+ "further if players find the screen hard to read.",
		scope: "client",
		config: true,
		type: Number,
		default: 1.15,
		choices: {
			1: "100%",
			1.15: "115% (default)",
			1.3: "130%",
			1.5: "150%",
		},
		onChange: () => {
			for (const app of foundry.applications.instances.values()) {
				if (app instanceof PipBoyApp) app.applyUiScale();
			}
		},
	});

	game.settings.register(MODULE_ID, "scanlines", {
		name: "CRT Scanlines",
		hint: "Show the CRT scanline overlay on the Pip-Boy screen. Disable if the scanlines make text hard to read.",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
		onChange: () => {
			for (const app of foundry.applications.instances.values()) {
				if (app instanceof PipBoyApp) app.render();
			}
		},
	});

	game.settings.register(MODULE_ID, "bootScreen", {
		name: "PIP-OS Boot Screen",
		hint: "Play the PIP-OS boot sequence on the screen when the Pip-Boy opens. Click the screen to skip it.",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
	});

	game.settings.register(MODULE_ID, "uiSounds", {
		name: "Pip-Boy Sounds",
		hint: "Play the Pip-Boy activation and page-change sounds (heard only by you).",
		scope: "client",
		config: true,
		type: Boolean,
		default: true,
	});

	game.settings.register(MODULE_ID, "customSoundDir", {
		name: "Custom Sound Folder",
		hint: "Optional folder (inside your Foundry user data) with replacement Pip-Boy sounds: "
			+ "activate.wav, tab.wav, light-on.wav, light-off.wav, close.wav. Missing files fall "
			+ "back to the bundled sounds. Files placed here are served to all players but are "
			+ "NOT part of this module — do not redistribute copyrighted audio.",
		scope: "world",
		config: true,
		type: String,
		default: "",
		filePicker: "folder",
		onChange: () => PipBoyApp.probeCustomSounds(),
	});

	game.settings.register(MODULE_ID, "vatsMode", {
		name: "V.A.T.S. Damage Automation",
		hint: "Adds a V.A.T.S. block to fallout damage cards: per-target damage-resistance "
			+ "math for the rolled hit location, with GM-only apply buttons and undo.",
		scope: "world",
		config: true,
		type: String,
		default: "cards",
		choices: {
			off: "Off",
			cards: "Damage cards with GM apply buttons",
		},
	});

	game.settings.register(MODULE_ID, "actionTracking", {
		name: "Major / Minor Action Tracking",
		hint: "Show action pips on the STATUS tab. Attacking spends the major action, and "
			+ "extra actions can be bought with AP (2 for a major, 1 for a minor). Actions "
			+ "reset when the combat round advances.",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	game.settings.register(MODULE_ID, "vatsPaAblation", {
		name: "V.A.T.S.: Power Armor Ablation",
		hint: "Damage to a location covered by powered power armor reduces that piece's "
			+ "health first; only the overflow reaches the wearer.",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	game.settings.register(MODULE_ID, "vatsBuyDice", {
		name: "V.A.T.S.: Buy Bonus Dice with AP",
		hint: "Before an attack rolled from the Pip-Boy, offer to spend AP on bonus d20s "
			+ "and deduct the cost from the pool.",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	game.settings.register(MODULE_ID, "vatsDiceCost", {
		name: "V.A.T.S.: Bonus Dice AP Cost",
		hint: "Escalating charges 1 AP for the first bonus die, 2 for the second, 3 for the "
			+ "third (1/3/6 total). Flat charges 1 AP per die. Check against your book.",
		scope: "world",
		config: true,
		type: String,
		default: "escalating",
		choices: {
			escalating: "Escalating — 1 / 3 / 6 total",
			flat: "Flat — 1 AP per die",
		},
	});

	game.settings.register(MODULE_ID, "vatsInjuries", {
		name: "V.A.T.S.: Injury Prompts",
		hint: "When applied damage is 5+ to one location or reduces the target to 0 HP, "
			+ "prompt the GM to mark an open injury on that limb.",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	game.settings.register(MODULE_ID, "vatsAutoDamage", {
		name: "V.A.T.S.: Auto-Roll Damage",
		hint: "After an attack is rolled from the Pip-Boy, immediately open the damage dialog "
			+ "(rate of fire, extra dice, ammo) so the flow runs attack → damage → apply.",
		scope: "world",
		config: true,
		type: Boolean,
		default: true,
	});

	game.settings.register(MODULE_ID, "radioFolder", {
		name: "Radio Station Folder",
		hint: "Playlists inside a playlist folder with this name appear as stations on the "
			+ "Pip-Boy RADIO tab. The radio plays locally per player and never affects others.",
		scope: "world",
		config: true,
		type: String,
		default: "Pip-Boy Radio",
	});
	game.settings.register(MODULE_ID, "radioVolume", {
		scope: "client", config: false, type: Number, default: 0.5,
	});
	game.settings.register(MODULE_ID, "uiVolume", {
		scope: "client", config: false, type: Number, default: 0.8,
	});

	game.settings.register(MODULE_ID, "lightBright", {
		name: "Pip-Boy Light: Bright Radius",
		hint: "Bright-light radius of the Pip-Boy token light, in scene distance units.",
		scope: "world",
		config: true,
		type: Number,
		default: 10,
	});
	game.settings.register(MODULE_ID, "lightDim", {
		name: "Pip-Boy Light: Dim Radius",
		hint: "Dim-light radius of the Pip-Boy token light, in scene distance units.",
		scope: "world",
		config: true,
		type: Number,
		default: 20,
	});

	game.settings.register(MODULE_ID, "lightColor", {
		name: "Pip-Boy Light Colour",
		hint: "Colour of the token light toggled from the POWER lamp on the casing.",
		scope: "client",
		config: true,
		type: String,
		default: "green",
		choices: {
			green: "Fallout Green",
			screen: "Match my screen colour",
		},
	});

	// --- World Map settings (GM) -----------------------------------------
	game.settings.register(MODULE_ID, "worldMapEnabled", {
		scope: "world", config: false, type: Boolean, default: false,
	});
	game.settings.register(MODULE_ID, "worldMapSceneId", {
		scope: "world", config: false, type: String, default: "",
	});
	game.settings.register(MODULE_ID, "worldMapActorId", {
		scope: "world", config: false, type: String, default: "",
	});
	game.settings.register(MODULE_ID, "worldMapZoom", {
		scope: "world", config: false, type: Number, default: 1.5,
	});
	game.settings.registerMenu(MODULE_ID, "worldMapConfig", {
		name: "World Map",
		label: "Configure World Map",
		hint: "Choose the world-map scene and party token shown on the Pip-Boy MAP tab.",
		icon: "fas fa-map-location-dot",
		type: WorldMapConfig,
		restricted: true,
	});

	// Radio re-renders open Pip-Boys on track/station changes (callback rather
	// than an import so radio.mjs stays cycle-free).
	PipBoyRadio.onUpdate = () => PipBoyApp.refreshAll();

	// Expose a small API for macros / other modules.
	game.modules.get(MODULE_ID).api = {
		open: (actor) => PipBoyApp.open(actor),
		radio: PipBoyRadio,
	};

	await foundry.applications.handlebars.loadTemplates(TEMPLATE_PARTIALS);
});

Hooks.once("ready", () => {
	if (game.system.id !== "fallout") {
		ui.notifications?.warn(
			"Fallout Pip-Boy is designed for the 'fallout' system and may not work with the active system.",
		);
	}
	// Discover any GM-provided replacement sounds.
	PipBoyApp.probeCustomSounds();

	// Cross-player item transfers: players can't create items on actors they
	// don't own, so the active GM's client executes the move on their behalf.
	game.socket.on(`module.${MODULE_ID}`, async (msg) => {
		if (!game.users.activeGM?.isSelf) return; // exactly one executor

		// Dropping to the canvas needs token/actor creation rights.
		if (msg?.action === "dropItem") {
			const source = await fromUuid(msg.actorUuid);
			const actor = source?.actor ?? source;
			const requester = game.users.get(msg.userId);
			if (!actor || !requester) return;
			if (!actor.testUserPermission(requester, "OWNER")) return;
			await PipBoyApp.dropToGround(msg);
			return;
		}

		if (msg?.action !== "transferItem") return;
		const source = game.actors.get(msg.sourceActorId);
		const target = game.actors.get(msg.targetActorId);
		const item = source?.items.get(msg.itemId);
		const requester = game.users.get(msg.userId);
		if (!source || !target || !item || !requester) return;
		// The requester must own the actor the item is leaving.
		if (!source.testUserPermission(requester, "OWNER")) return;
		await target.createEmbeddedDocuments("Item", [item.toObject()]);
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: source }),
			content: `<p><strong>${source.name}</strong> gives <strong>${item.name}</strong> to <strong>${target.name}</strong>.</p>`,
		});
		await item.delete();
	});
});

// Token HUD launch button.
Hooks.on("renderTokenHUD", registerTokenHudButton);

// V.A.T.S. — stamp targets onto fallout roll cards at creation (rolling client
// only) and add the damage-application block when cards render.
Hooks.on("preCreateChatMessage", (message) => PipBoyVats.onPreCreateChatMessage(message));
Hooks.on("renderChatMessageHTML", (message, html) =>
	PipBoyVats.onRenderChatMessageHTML(message, html instanceof HTMLElement ? html : html?.[0]));
// Persistent-damage prompts as each combatant's turn ends (GM client).
Hooks.on("combatTurnChange", (combat, prior) => PipBoyVats.onCombatTurnChange(combat, prior));

// Keep any open Pip-Boy in sync with live actor / item changes.
Hooks.on("updateActor", (actor) => PipBoyApp.refreshFor(actor));
Hooks.on("createItem", (item) => PipBoyApp.refreshFor(item.parent));
Hooks.on("updateItem", (item) => PipBoyApp.refreshFor(item.parent));
Hooks.on("deleteItem", (item) => PipBoyApp.refreshFor(item.parent));

// Refresh open Pip-Boys when the party token moves, so the MAP re-centres on its
// current position. We don't gate on `x`/`y` in the change set — v13/v14 commits
// token movement in ways that don't always surface those keys here — instead we
// refresh whenever the configured party/scene token updates and read its live
// position in PipBoyApp#prepareMap.
function refreshMapForToken(tokenDoc) {
	// Local maps show the active scene, so any move there should re-centre them.
	if (tokenDoc.parent?.id === canvas?.scene?.id) return PipBoyApp.refreshAll();
	// World map: the configured scene / party token.
	if (game.settings.get(MODULE_ID, "worldMapEnabled")) {
		const sceneId = game.settings.get(MODULE_ID, "worldMapSceneId");
		const actorId = game.settings.get(MODULE_ID, "worldMapActorId");
		if (tokenDoc.parent?.id === sceneId || (actorId && tokenDoc.actorId === actorId)) {
			PipBoyApp.refreshAll();
		}
	}
}
// `moveToken` fires when a move is committed (destination known immediately);
// `updateToken` covers non-movement changes and other cores.
Hooks.on("moveToken", (tokenDoc) => refreshMapForToken(tokenDoc));
Hooks.on("updateToken", (tokenDoc) => refreshMapForToken(tokenDoc));

// "Show on Pip-Boy map" checkbox in the Tile configuration sheet. The input is
// named into our flag scope, so Foundry's form handling saves it with the rest
// of the tile — no custom submit logic needed.
Hooks.on("renderTileConfig", (app, html) => {
	const element = html instanceof HTMLElement ? html : html?.[0];
	const doc = app.document ?? app.object;
	if (!element || !doc) return;
	const flagName = `flags.${MODULE_ID}.showOnMap`;
	if (element.querySelector(`[name="${flagName}"]`)) return;
	const checked = doc.getFlag(MODULE_ID, "showOnMap") ? "checked" : "";
	const group = document.createElement("div");
	group.className = "form-group";
	group.innerHTML = `
		<label>${game.i18n.localize("SCORPIOUS_PIPBOY.TileShowOnMap")}</label>
		<div class="form-fields">
			<input type="checkbox" name="${flagName}" ${checked} />
		</div>
		<p class="hint">${game.i18n.localize("SCORPIOUS_PIPBOY.TileShowOnMapHint")}</p>`;
	// v13+ TileConfig is tabbed and its footer sits outside the tab panes, so
	// anchoring on the footer makes the checkbox show on every tab. Inject into
	// the Appearance pane instead; fall back to the form end on older layouts.
	const tab = element.querySelector('.tab[data-tab="appearance"]');
	if (tab) tab.appendChild(group);
	else {
		const anchor = element.querySelector("footer, .form-footer");
		if (anchor) anchor.before(group);
		else element.querySelector("form")?.appendChild(group);
	}
	// Defer + guard: v14's tile config throws if setPosition runs before the
	// element is laid out (TilePalette._updatePosition reads offsetWidth of null).
	requestAnimationFrame(() => {
		try {
			if (app.element?.isConnected) app.setPosition?.({ height: "auto" });
		} catch (_e) { /* non-fatal */ }
	});
});

// Tagged tiles draw on the map, so tile changes on a shown scene refresh it.
function refreshMapForTile(tileDoc) {
	const parentId = tileDoc.parent?.id;
	if (!parentId) return;
	const worldSceneId = game.settings.get(MODULE_ID, "worldMapEnabled")
		? game.settings.get(MODULE_ID, "worldMapSceneId")
		: null;
	if (parentId === canvas?.scene?.id || parentId === worldSceneId) PipBoyApp.refreshAll();
}
Hooks.on("createTile", (tileDoc) => refreshMapForTile(tileDoc));
Hooks.on("updateTile", (tileDoc) => refreshMapForTile(tileDoc));
Hooks.on("deleteTile", (tileDoc) => refreshMapForTile(tileDoc));
