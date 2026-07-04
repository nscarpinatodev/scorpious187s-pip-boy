import { MODULE_ID } from "./constants.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/**
 * GM settings dialog for the Pip-Boy World Map: pick the world-map scene and the
 * party token (actor) that the map centres on.
 */
export class WorldMapConfig extends HandlebarsApplicationMixin(ApplicationV2) {
	static DEFAULT_OPTIONS = {
		id: "scorpious-pipboy-worldmap-config",
		tag: "form",
		window: { title: "Pip-Boy World Map", icon: "fas fa-map-location-dot" },
		position: { width: 480, height: "auto" },
		form: {
			handler: WorldMapConfig.#onSubmit,
			closeOnSubmit: true,
		},
	};

	static PARTS = {
		form: { template: `modules/${MODULE_ID}/templates/world-map-config.hbs` },
	};

	async _prepareContext() {
		const sceneId = game.settings.get(MODULE_ID, "worldMapSceneId");
		const actorId = game.settings.get(MODULE_ID, "worldMapActorId");
		return {
			enabled: game.settings.get(MODULE_ID, "worldMapEnabled"),
			zoom: game.settings.get(MODULE_ID, "worldMapZoom"),
			scenes: game.scenes.map((s) => ({ id: s.id, name: s.name, selected: s.id === sceneId })),
			actors: game.actors
				.filter((a) => a.hasPlayerOwner || a.type === "character")
				.map((a) => ({ id: a.id, name: a.name, selected: a.id === actorId })),
		};
	}

	static async #onSubmit(event, form, formData) {
		const d = formData.object;
		await game.settings.set(MODULE_ID, "worldMapEnabled", d.enabled === true);
		await game.settings.set(MODULE_ID, "worldMapSceneId", d.sceneId ?? "");
		await game.settings.set(MODULE_ID, "worldMapActorId", d.actorId ?? "");
		await game.settings.set(MODULE_ID, "worldMapZoom", Number(d.zoom) || 1.5);

		// Refresh any open Pip-Boys so the MAP tab updates immediately.
		for (const app of foundry.applications.instances.values()) {
			if (app.constructor?.name === "PipBoyApp") app.render();
		}
	}
}
