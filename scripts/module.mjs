import { MODULE_ID, FRAME_COLORS } from "./constants.mjs";
import { PipBoyApp } from "./PipBoyApp.mjs";
import { PipBoyRadio } from "./radio.mjs";
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
		if (msg?.action !== "transferItem") return;
		if (!game.users.activeGM?.isSelf) return; // exactly one executor
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
