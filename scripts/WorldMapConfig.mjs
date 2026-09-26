import { MODULE_ID } from "./constants.mjs";
import { PipBoyTravel } from "./travel.mjs";

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
		position: { width: 780, height: "auto" },
		form: {
			handler: WorldMapConfig.#onSubmit,
			closeOnSubmit: true,
		},
		actions: {
			createParty: WorldMapConfig.#onCreateParty,
			openBuilder: WorldMapConfig.#onOpenBuilder,
		},
	};

	static PARTS = {
		form: { template: `modules/${MODULE_ID}/templates/world-map-config.hbs` },
	};

	async _prepareContext() {
		const sceneId = game.settings.get(MODULE_ID, "worldMapSceneId");
		const actorId = game.settings.get(MODULE_ID, "worldMapActorId");
		const party = PipBoyTravel.findPartyActor();
		const members = party?.getFlag(MODULE_ID, "members") ?? [];
		const tableUuid = game.settings.get(MODULE_ID, "encounterTableUuid");

		return {
			enabled: game.settings.get(MODULE_ID, "worldMapEnabled"),
			zoom: game.settings.get(MODULE_ID, "worldMapZoom"),
			scenes: game.scenes.map((s) => ({
				id: s.id,
				name: s.name,
				selected: s.id === sceneId,
				// Travel needs hexes; flag the rest so the GM can see why.
				hex: s.grid?.isHexagonal === true,
			})),
			actors: game.actors
				.filter((a) => a.hasPlayerOwner || a.type === "character"
					|| a.getFlag(MODULE_ID, "partyActor") === true)
				.map((a) => ({ id: a.id, name: a.name, selected: a.id === actorId })),

			hasParty: !!party,
			partyName: party?.name ?? "",
			roster: game.actors
				.filter((a) => a.type === "character")
				.map((a) => ({ uuid: a.uuid, name: a.name, member: members.includes(a.uuid) })),

			travelEnabled: game.settings.get(MODULE_ID, "travelEnabled"),
			travelAnyToken: game.settings.get(MODULE_ID, "travelAnyToken"),
			travelHexHours: game.settings.get(MODULE_ID, "travelHexHours"),
			travelMaxHexes: game.settings.get(MODULE_ID, "travelMaxHexes"),
			// Snapped to the input's step grid. A value off the grid — from an
			// older build, or set through the API — fails HTML5 validation, and
			// one invalid field blocks the whole form from submitting.
			travelHexSeconds: Math.max(0.5,
				Math.round(Number(game.settings.get(MODULE_ID, "travelHexSeconds")) * 2) / 2),
			encounterPullUsers: game.settings.get(MODULE_ID, "encounterPullUsers"),
			encounterPreload: game.settings.get(MODULE_ID, "encounterPreload"),
			encounterChance: game.settings.get(MODULE_ID, "encounterChance"),
			encounterSurvivalReduction: game.settings.get(MODULE_ID, "encounterSurvivalReduction"),
			encounterChanceFloor: game.settings.get(MODULE_ID, "encounterChanceFloor"),
			tables: game.tables.map((t) => ({
				uuid: t.uuid, name: t.name, selected: t.uuid === tableUuid,
			})),
		};
	}

	/** Open the scene-linked encounter editor. */
	static async #onOpenBuilder() {
		const { EncounterBuilder } = await import("./EncounterBuilder.mjs");
		new EncounterBuilder().render(true);
	}

	/** Create the module-owned party actor and select it as the map's token. */
	static async #onCreateParty() {
		const party = await PipBoyTravel.ensurePartyActor();
		if (!party) return;
		await game.settings.set(MODULE_ID, "worldMapActorId", party.id);
		ui.notifications?.info(
			`Created "${party.name}". Drag it onto the world-map scene to place the party.`);
		this.render();
	}

	static async #onSubmit(event, form, formData) {
		const d = formData.object;
		await game.settings.set(MODULE_ID, "worldMapEnabled", d.enabled === true);
		await game.settings.set(MODULE_ID, "worldMapSceneId", d.sceneId ?? "");
		await game.settings.set(MODULE_ID, "worldMapActorId", d.actorId ?? "");
		await game.settings.set(MODULE_ID, "worldMapZoom", Number(d.zoom) || 1.5);

		// Travel requires a hexagonal world map: refuse rather than silently
		// enabling something that can never fire.
		let travelEnabled = d.travelEnabled === true;
		if (travelEnabled) {
			const scene = game.scenes.get(d.sceneId ?? "");
			if (!scene?.grid?.isHexagonal) {
				travelEnabled = false;
				ui.notifications?.error(
					"Hex travel needs a world-map scene with a hexagonal grid. Travel was left off.");
			}
		}
		await game.settings.set(MODULE_ID, "travelEnabled", travelEnabled);
		await game.settings.set(MODULE_ID, "travelAnyToken", d.travelAnyToken === true);
		await game.settings.set(MODULE_ID, "travelHexHours", Number(d.travelHexHours) || 2);
		await game.settings.set(MODULE_ID, "travelMaxHexes", Number(d.travelMaxHexes) || 50);
		await game.settings.set(MODULE_ID, "travelHexSeconds",
			Math.min(30, Math.max(0.5, Number(d.travelHexSeconds) || 3)));
		await game.settings.set(MODULE_ID, "encounterTableUuid", d.encounterTableUuid ?? "");
		await game.settings.set(MODULE_ID, "encounterChance", Number(d.encounterChance) || 0);
		await game.settings.set(MODULE_ID, "encounterSurvivalReduction",
			Number(d.encounterSurvivalReduction) || 0);
		await game.settings.set(MODULE_ID, "encounterChanceFloor",
			Number(d.encounterChanceFloor) || 0);
		await game.settings.set(MODULE_ID, "encounterPullUsers", d.encounterPullUsers === true);
		await game.settings.set(MODULE_ID, "encounterPreload", d.encounterPreload === true);

		// Roster checkboxes are named member.<uuid>.
		const party = PipBoyTravel.findPartyActor();
		if (party) {
			const members = Object.entries(d)
				.filter(([key, value]) => key.startsWith("member.") && value === true)
				.map(([key]) => key.slice("member.".length));
			await party.setFlag(MODULE_ID, "members", members);
		}

		// Refresh any open Pip-Boys so the MAP tab updates immediately.
		for (const app of foundry.applications.instances.values()) {
			if (app.constructor?.name === "PipBoyApp") app.render();
		}
	}
}
