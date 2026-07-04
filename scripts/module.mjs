import { MODULE_ID, FRAME_COLORS } from "./constants.mjs";
import { PipBoyApp } from "./PipBoyApp.mjs";
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

	// Expose a small API for macros / other modules.
	game.modules.get(MODULE_ID).api = {
		open: (actor) => PipBoyApp.open(actor),
	};

	await foundry.applications.handlebars.loadTemplates(TEMPLATE_PARTIALS);
});

Hooks.once("ready", () => {
	if (game.system.id !== "fallout") {
		ui.notifications?.warn(
			"Fallout Pip-Boy is designed for the 'fallout' system and may not work with the active system.",
		);
	}
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
