import { MODULE_ID } from "./constants.mjs";
import { rollWeaponAttack, rollWeaponDamage, rollSkill } from "./attacks.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Ordered SPECIAL definition: [key, full label, single letter]. */
const SPECIAL = [
	["str", "Strength", "S"],
	["per", "Perception", "P"],
	["end", "Endurance", "E"],
	["cha", "Charisma", "C"],
	["int", "Intelligence", "I"],
	["agi", "Agility", "A"],
	["luc", "Luck", "L"],
];

const LIMBS = ["head", "torso", "armL", "armR", "legL", "legR"];

const TABS = [
	{ id: "status", label: "STATUS", icon: "fa-heart-pulse" },
	{ id: "inventory", label: "INV", icon: "fa-briefcase" },
	{ id: "data", label: "DATA", icon: "fa-microchip" },
	{ id: "map", label: "MAP", icon: "fa-map" },
];

/**
 * The Pip-Boy window. One instance per actor; opened from the Token HUD.
 */
export class PipBoyApp extends HandlebarsApplicationMixin(ApplicationV2) {
	/** @type {Map<string, PipBoyApp>} live instances keyed by actor id */
	static #instances = new Map();

	#activeTab = "status";

	constructor(actor, options = {}) {
		super(options);
		this.actor = actor;
	}

	static DEFAULT_OPTIONS = {
		classes: ["fallout-pipboy"],
		window: {
			icon: "fas fa-mobile-screen-button",
			resizable: true,
		},
		position: {
			width: 600,
			height: "auto",
		},
		actions: {
			switchTab: PipBoyApp.#onSwitchTab,
			toggleMapMode: PipBoyApp.#onToggleMapMode,
			zoomMap: PipBoyApp.#onZoomMap,
			recenterMap: PipBoyApp.#onRecenterMap,
			adjustHp: PipBoyApp.#onAdjustHp,
			cycleInjury: PipBoyApp.#onCycleInjury,
			openItem: PipBoyApp.#onOpenItem,
			showInfo: PipBoyApp.#onShowInfo,
			rollSkill: PipBoyApp.#onRollSkill,
			attackWeapon: PipBoyApp.#onAttackWeapon,
			damageWeapon: PipBoyApp.#onDamageWeapon,
			useConsumable: PipBoyApp.#onUseConsumable,
			rollItem: PipBoyApp.#onRollItem,
			toggleEquip: PipBoyApp.#onToggleEquip,
			openSettings: PipBoyApp.#onOpenSettings,
		},
	};

	static PARTS = {
		main: { template: `modules/${MODULE_ID}/templates/pipboy.hbs` },
	};

	/** Remembered scroll position per tab, so re-renders don't jump to the top. */
	#scroll = {};

	/** Id of the item/skill whose description is shown in the lower readout. */
	#infoItemId = null;

	/** MAP tab state: "world" | "local", and the pan/zoom view transform. */
	#mapMode = null;
	#mapView = { zoom: null, panX: 0, panY: 0 };

	get title() {
		return `Pip-Boy — ${this.actor?.name ?? ""}`;
	}

	/* -------------------------------------------- */
	/*  Lifecycle helpers                            */
	/* -------------------------------------------- */

	/** Open (or focus) the Pip-Boy for an actor. */
	static open(actor) {
		if (!actor) {
			ui.notifications?.warn("No character is available for the Pip-Boy.");
			return null;
		}
		const existing = PipBoyApp.#instances.get(actor.id);
		if (existing) {
			existing.render({ force: true });
			existing.bringToFront?.();
			return existing;
		}
		const app = new PipBoyApp(actor, { id: `${MODULE_ID}-${actor.id}` });
		PipBoyApp.#instances.set(actor.id, app);
		app.render({ force: true });
		return app;
	}

	/** Re-render the open Pip-Boy for an actor, if any. */
	static refreshFor(actor) {
		const app = actor ? PipBoyApp.#instances.get(actor.id) : null;
		if (app?.rendered) app.render();
	}

	/** Re-render every open Pip-Boy (e.g. when shared world-map state changes). */
	static refreshAll() {
		for (const app of PipBoyApp.#instances.values()) {
			if (app.rendered) app.render();
		}
	}

	_onClose(options) {
		PipBoyApp.#instances.delete(this.actor.id);
		return super._onClose(options);
	}

	/* -------------------------------------------- */
	/*  Context                                      */
	/* -------------------------------------------- */

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const actor = this.actor;
		const sys = actor.system ?? {};

		context.actor = actor;
		context.moduleId = MODULE_ID;
		context.frameColor = game.settings.get(MODULE_ID, "frameColor") ?? "green";
		context.showScanlines = game.settings.get(MODULE_ID, "scanlines") ?? true;
		// Resolve to a root-absolute URL so the inline-style url() isn't broken by
		// Foundry's route prefix / trailing slash (relative url() 404s otherwise).
		const framePath = `modules/${MODULE_ID}/frames/pipboy-frame-${context.frameColor}.png`;
		context.frameSrc = foundry.utils.getRoute(framePath);
		context.tabs = TABS.map((t) => ({ ...t, active: t.id === this.#activeTab }));
		context.activeTab = this.#activeTab;

		context.status = this.#prepareStatus(actor, sys);
		context.inventory = this.#prepareInventory(actor);
		context.data = this.#prepareData(actor, sys);
		context.map = this.#prepareMap();

		return context;
	}

	#prepareMap() {
		const isGM = game.user.isGM;
		const world = this.#worldMapData();
		const local = this.#localMapData();
		const worldAvailable = !!world;
		const localAvailable = !!local;

		// Resolve which mode to show (respecting the toggle, falling back sensibly).
		let mode = this.#mapMode;
		if (mode === "world" && !worldAvailable) mode = null;
		if (mode === "local" && !localAvailable) mode = null;
		if (!mode) mode = worldAvailable ? "world" : localAvailable ? "local" : "world";
		this.#mapMode = mode;

		const view = mode === "world" ? world : local;
		return {
			available: worldAvailable || localAvailable,
			worldAvailable,
			localAvailable,
			isWorld: mode === "world",
			isLocal: mode === "local",
			isGM,
			view,
		};
	}

	/** Fraction (0..1) of a token document's centre within a scene rect. */
	#tokenCenter(scene, token) {
		if (!token) return { fx: 0.5, fy: 0.5, hasToken: false };
		const dim = scene.dimensions;
		const grid = scene.grid?.size ?? dim?.size ?? 100;
		// v14 animates token.x/.y; movement.destination is the settled position.
		const pos = token.movement?.destination ?? token;
		const cx = (pos.x ?? token.x) + ((pos.width ?? token.width ?? 1) * grid) / 2;
		const cy = (pos.y ?? token.y) + ((pos.height ?? token.height ?? 1) * grid) / 2;
		return {
			fx: Math.clamp((cx - dim.sceneX) / dim.sceneWidth, 0, 1),
			fy: Math.clamp((cy - dim.sceneY) / dim.sceneHeight, 0, 1),
			hasToken: true,
		};
	}

	/** Find this Pip-Boy actor's token document on the given scene. */
	#findMyToken(scene) {
		const actor = this.actor;
		// Unlinked/synthetic token actor: it carries its own token document.
		if (actor.isToken && actor.token?.parent?.id === scene.id) return actor.token;
		// Active tokens for this actor on the current canvas.
		const active = actor.getActiveTokens?.(false, true) ?? [];
		const onScene = active.find((t) => t.parent?.id === scene.id);
		if (onScene) return onScene;
		// Fallback: match by base actor id within the scene's token collection.
		return scene.tokens.find((t) => t.actorId === actor.id) ?? null;
	}

	#resolveSrc(path) {
		if (!path) return null;
		return /^https?:|^data:/i.test(path) ? path : foundry.utils.getRoute(path);
	}

	/** GM-configured world map: a chosen scene centred on the party token. */
	#worldMapData() {
		if (!game.settings.get(MODULE_ID, "worldMapEnabled")) return null;
		const scene = game.scenes.get(game.settings.get(MODULE_ID, "worldMapSceneId"));
		const bg = scene?.background?.src ?? scene?.img ?? null;
		if (!scene || !bg) return null;
		const actorId = game.settings.get(MODULE_ID, "worldMapActorId");
		const token = actorId ? scene.tokens.find((t) => t.actorId === actorId) : null;
		const { fx, fy, hasToken } = this.#tokenCenter(scene, token);
		return {
			bgSrc: this.#resolveSrc(bg),
			fx, fy, hasToken,
			sceneName: scene.name,
			defaultZoom: game.settings.get(MODULE_ID, "worldMapZoom") || 1.5,
		};
	}

	/** Local map: the active scene centred on this character's token. Only the
	 *  scene background art is shown — no tokens — so nothing hostile leaks. */
	#localMapData() {
		const scene = canvas?.scene;
		const bg = scene?.background?.src ?? scene?.img ?? null;
		if (!scene || !bg) return null;
		const { fx, fy, hasToken } = this.#tokenCenter(scene, this.#findMyToken(scene));
		return {
			bgSrc: this.#resolveSrc(bg),
			fx, fy, hasToken,
			sceneName: scene.name,
			defaultZoom: 2.5,
		};
	}

	#prepareStatus(actor, sys) {
		const value = sys.health?.value ?? 0;
		const max = sys.health?.max ?? 0;
		const pct = max > 0 ? Math.clamp(Math.round((value / max) * 100), 0, 100) : 0;

		// Vault-Boy-style body figure: one masked layer per limb, coloured by the
		// limb's status. Reuses the fallout system's own body art (600x600 layers).
		const bodyType = actor.type === "robot" ? "robot" : "character";
		const bodyFigure = LIMBS.map((key) => {
			const status = sys.body_parts?.[key]?.status ?? "healthy";
			return {
				key,
				status,
				src: foundry.utils.getRoute(
					`systems/fallout/assets/ui/pipboy-body/${bodyType}/${status}/${key}.png`,
				),
			};
		});

		const special = SPECIAL.map(([key, label, letter]) => ({
			key,
			label,
			letter,
			value: sys.attributes?.[key]?.value ?? 0,
		}));

		const limbs = LIMBS.map((key) => {
			const bp = sys.body_parts?.[key] ?? {};
			const injuries = Array.isArray(bp.injuries) ? bp.injuries : [];
			return {
				key,
				label: game.i18n.localize(`FALLOUT.BODYLOCATION.character.${key}`),
				status: bp.status ?? "healthy",
				injuryOpen: bp.injuryOpenCount ?? 0,
				injuryTreated: bp.injuryTreatedCount ?? 0,
				// Clickable injury slots (0 none, 1 wounded, 2 crippled).
				injuries: injuries.map((value, index) => ({ index, value })),
			};
		});

		return {
			health: { value, max, pct },
			radiation: sys.radiation ?? 0,
			luckPoints: sys.luckPoints ?? 0,
			defense: sys.defense?.value ?? 0,
			initiative: sys.initiative?.value ?? 0,
			caps: sys.currency?.caps ?? 0,
			carryWeight: {
				// `total` = weight currently carried; `value` = max capacity.
				current: sys.carryWeight?.total ?? 0,
				max: sys.carryWeight?.value ?? 0,
				level: sys.encumbranceLevel ?? sys.carryWeight?.encumbranceLevel ?? 0,
			},
			special,
			limbs,
			bodyType,
			bodyFigure,
			conditions: this.#prepareConditions(sys.conditions ?? {}),
		};
	}

	#prepareConditions(conditions) {
		const F = CONFIG.FALLOUT ?? {};
		const text = (map, value) => {
			const key = map?.[value ?? 0];
			return key ? game.i18n.localize(key) : String(value ?? 0);
		};
		return [
			{ key: "hunger", label: "Hunger", value: text(F.HUNGER_BY_NUMBER, conditions.hunger) },
			{ key: "thirst", label: "Thirst", value: text(F.THIRST_BY_NUMBER, conditions.thirst) },
			{ key: "sleep", label: "Sleep", value: text(F.SLEEP_BY_NUMBER, conditions.sleep) },
			{ key: "fatigue", label: "Fatigue", value: conditions.fatigue ?? 0 },
			{ key: "intoxication", label: "Intoxication", value: conditions.intoxication ?? 0 },
		];
	}

	#prepareInventory(actor) {
		const groups = {
			weapon: { label: "Weapons", icon: "fa-gun", items: [] },
			apparel: { label: "Apparel", icon: "fa-shirt", items: [] },
			aid: { label: "Aid", icon: "fa-kit-medical", items: [] },
			ammo: { label: "Ammo", icon: "fa-bomb", items: [] },
			misc: { label: "Misc", icon: "fa-boxes-stacked", items: [] },
		};

		const APPAREL = new Set(["apparel", "apparel_mod", "robot_armor"]);
		const AID = new Set(["consumable", "books_and_magz", "disease", "addiction"]);
		const MISC = new Set(["miscellany", "object_or_structure", "weapon_mod", "robot_mod"]);

		for (const item of actor.items) {
			const isys = item.system ?? {};
			// Hide depleted stacks (quantity 0) from the list.
			if (typeof isys.quantity === "number" && isys.quantity <= 0) continue;

			const entry = {
				id: item.id,
				name: item.name,
				img: item.img,
				type: item.type,
				isWeapon: item.type === "weapon",
				isConsumable: item.type === "consumable",
				quantity: isys.quantity ?? null,
				weight: isys.weight ?? null,
				equippable: typeof isys.equipped === "boolean",
				equipped: isys.equipped === true,
				subtitle: this.#itemSubtitle(item),
			};

			if (item.type === "weapon") groups.weapon.items.push(entry);
			else if (APPAREL.has(item.type)) groups.apparel.items.push(entry);
			else if (item.type === "ammo") groups.ammo.items.push(entry);
			else if (AID.has(item.type)) groups.aid.items.push(entry);
			else if (MISC.has(item.type)) groups.misc.items.push(entry);
		}

		const sections = Object.entries(groups)
			.map(([key, g]) => ({ key, ...g, count: g.items.length }))
			.filter((g) => g.items.length > 0);

		// Use the system's own carried-weight total (includes junk + materials).
		const cw = actor.system?.carryWeight ?? {};
		return {
			sections,
			carriedWeight: cw.total ?? 0,
			maxWeight: cw.value ?? 0,
		};
	}

	#itemSubtitle(item) {
		const s = item.system ?? {};
		switch (item.type) {
			case "weapon": {
				const types = Object.entries(s.damage?.damageType ?? {})
					.filter(([, on]) => on)
					.map(([t]) => t.charAt(0).toUpperCase());
				const dmg = s.damage?.rating ?? 0;
				return `DMG ${dmg}${types.length ? ` (${types.join("/")})` : ""}`;
			}
			case "apparel":
				return s.apparelType ? String(s.apparelType) : "";
			case "consumable":
				return s.consumableType ? String(s.consumableType) : "";
			case "ammo": {
				const shots = s.shots;
				return shots ? `${shots.current ?? 0}/${shots.max ?? 0} shots` : "";
			}
			default:
				return "";
		}
	}

	#prepareData(actor, sys) {
		const skills = actor.items
			.filter((i) => i.type === "skill")
			.map((i) => ({
				id: i.id,
				name: i.name,
				rank: i.system?.value ?? 0,
				tagged: i.system?.tag === true,
				attribute: (i.system?.defaultAttribute ?? "").toUpperCase(),
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		const perks = actor.items
			.filter((i) => i.type === "perk")
			.map((i) => ({
				id: i.id,
				name: i.name,
				img: i.img,
				rank: i.system?.rank?.value ?? 0,
				rankMax: i.system?.rank?.max ?? 1,
				multiRank: (i.system?.rank?.max ?? 1) > 1,
			}))
			.sort((a, b) => a.name.localeCompare(b.name));

		const traits = actor.items
			.filter((i) => i.type === "trait")
			.map((i) => ({ id: i.id, name: i.name, img: i.img }));

		return {
			level: sys.level?.value ?? 1,
			currentXP: sys.level?.currentXP ?? 0,
			nextLevelXP: sys.level?.nextLevelXP ?? 0,
			origin: sys.origin ?? "",
			skills,
			perks,
			traits,
			attrs: SPECIAL.map(([key, label, letter]) => ({ key, label, letter })),
		};
	}

	/* -------------------------------------------- */
	/*  Rendering                                    */
	/* -------------------------------------------- */

	_onRender(context, options) {
		super._onRender(context, options);

		// Track each pane's scroll so it can be restored across re-renders.
		for (const pane of this.element.querySelectorAll(".pip-pane")) {
			pane.addEventListener(
				"scroll",
				() => { this.#scroll[pane.dataset.tabContent] = pane.scrollTop; },
				{ passive: true },
			);
		}

		this.#applyActiveTab(this.element);

		// Right-click a skill to reveal its attribute picker.
		for (const row of this.element.querySelectorAll(".pip-skill")) {
			row.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				row.classList.toggle("show-attrs");
			});
		}

		if (this.#activeTab === "map") this.#layoutMap();
	}

	#applyActiveTab(root) {
		if (!root) return;
		for (const el of root.querySelectorAll("[data-tab-content]")) {
			el.classList.toggle("active", el.dataset.tabContent === this.#activeTab);
		}
		for (const el of root.querySelectorAll("[data-tab]")) {
			el.classList.toggle("active", el.dataset.tab === this.#activeTab);
		}

		// Restore the active pane's remembered scroll position.
		const activePane = root.querySelector(
			`.pip-pane[data-tab-content="${this.#activeTab}"]`,
		);
		if (activePane && this.#scroll[this.#activeTab] != null) {
			activePane.scrollTop = this.#scroll[this.#activeTab];
		}

		// The map image can only be measured once its pane is visible.
		if (this.#activeTab === "map") this.#layoutMap();
		this.#attachMapControls();

		// Re-populate the lower readout (it is rebuilt on every render).
		this.#renderInfo();
	}

	#currentZoom(vp) {
		return this.#mapView.zoom ?? (parseFloat(vp.dataset.zoom) || 1.5);
	}

	/** Position the map background: centre on the token, then apply pan + zoom. */
	#layoutMap() {
		const vp = this.element?.querySelector(".pip-map-viewport");
		const img = vp?.querySelector(".pip-map-scene");
		if (!vp || !img) return;

		const apply = () => {
			const vw = vp.clientWidth;
			const vh = vp.clientHeight;
			if (!vw || !vh || !img.naturalWidth) return;
			const zoom = this.#currentZoom(vp);
			const fx = parseFloat(vp.dataset.fx) || 0.5;
			const fy = parseFloat(vp.dataset.fy) || 0.5;
			const dispW = vw * zoom;
			const dispH = dispW * (img.naturalHeight / img.naturalWidth);
			img.style.width = `${dispW}px`;
			img.style.height = `${dispH}px`;
			img.style.left = `${vw / 2 - fx * dispW + this.#mapView.panX}px`;
			img.style.top = `${vh / 2 - fy * dispH + this.#mapView.panY}px`;

			// Keep the token marker on the token as the view pans/zooms.
			const marker = vp.querySelector(".pip-map-marker");
			if (marker) {
				marker.style.left = `${vw / 2 + this.#mapView.panX}px`;
				marker.style.top = `${vh / 2 + this.#mapView.panY}px`;
			}
		};

		if (img.complete && img.naturalWidth) apply();
		else img.addEventListener("load", apply, { once: true });
	}

	/** Wheel-zoom and drag-pan on the map viewport. */
	#attachMapControls() {
		const vp = this.element?.querySelector(".pip-map-viewport");
		if (!vp) return;

		vp.addEventListener("wheel", (event) => {
			event.preventDefault();
			const factor = event.deltaY < 0 ? 1.15 : 1 / 1.15;
			this.#setZoom(this.#currentZoom(vp) * factor);
		}, { passive: false });

		let dragging = false;
		let lastX = 0;
		let lastY = 0;
		vp.addEventListener("pointerdown", (event) => {
			dragging = true;
			lastX = event.clientX;
			lastY = event.clientY;
			vp.setPointerCapture(event.pointerId);
			vp.classList.add("dragging");
		});
		vp.addEventListener("pointermove", (event) => {
			if (!dragging) return;
			this.#mapView.panX += event.clientX - lastX;
			this.#mapView.panY += event.clientY - lastY;
			lastX = event.clientX;
			lastY = event.clientY;
			this.#layoutMap();
		});
		const end = (event) => {
			dragging = false;
			vp.classList.remove("dragging");
			try { vp.releasePointerCapture(event.pointerId); } catch (_e) { /* ignore */ }
		};
		vp.addEventListener("pointerup", end);
		vp.addEventListener("pointercancel", end);
	}

	#setZoom(zoom) {
		this.#mapView.zoom = Math.clamp(zoom, 1, 8);
		this.#layoutMap();
	}

	/* -------------------------------------------- */
	/*  Actions                                      */
	/* -------------------------------------------- */

	/** Dial wheel on the casing: open the settings sheet on this module's tab. */
	static async #onOpenSettings() {
		const sheet = game.settings.sheet;
		await sheet.render({ force: true });
		// v13+ SettingsConfig is a CategoryBrowser whose sidebar tabs (group
		// "categories") are keyed by package namespace; fall back to clicking the
		// sidebar entry if the tab API doesn't take.
		try {
			sheet.changeTab(MODULE_ID, "categories");
		} catch (_e) {
			sheet.element
				?.querySelector(`[data-tab="${MODULE_ID}"], [data-category="${MODULE_ID}"]`)
				?.click();
		}
	}

	static #onSwitchTab(event, target) {
		const tab = target.dataset.tab;
		if (!tab || tab === this.#activeTab) return;
		this.#activeTab = tab;
		this.#applyActiveTab(this.element);
		// Clear the lower readout when moving to a different tab.
		this.#infoItemId = null;
		this.#renderInfo();
	}

	static #onToggleMapMode(event, target) {
		const mode = target.dataset.mode;
		if (!mode || mode === this.#mapMode) return;
		this.#mapMode = mode;
		this.#mapView = { zoom: null, panX: 0, panY: 0 };
		this.render();
	}

	static #onZoomMap(event, target) {
		const vp = this.element?.querySelector(".pip-map-viewport");
		if (!vp) return;
		const dir = Number(target.dataset.dir) || 0;
		this.#setZoom(this.#currentZoom(vp) * (dir > 0 ? 1.25 : 1 / 1.25));
	}

	static #onRecenterMap() {
		this.#mapView = { zoom: null, panX: 0, panY: 0 };
		this.#layoutMap();
	}

	static async #onAdjustHp(event, target) {
		event.stopPropagation();
		const delta = Number(target.dataset.delta) || 0;
		const health = this.actor.system.health ?? {};
		const max = health.max ?? 0;
		const next = Math.clamp((health.value ?? 0) + delta, 0, max);
		if (next !== health.value) await this.actor.update({ "system.health.value": next });
	}

	/** Cycle a limb injury slot 0 → 1 → 2 → 0 and recompute the limb status. */
	static async #onCycleInjury(event, target) {
		event.stopPropagation();
		const limb = target.dataset.limb;
		const index = Number(target.dataset.index);
		const bp = this.actor.system.body_parts?.[limb];
		if (!bp || !Array.isArray(bp.injuries)) return;

		const injuries = [...bp.injuries];
		injuries[index] = ((injuries[index] ?? 0) + 1) % 3;
		const status = PipBoyApp.#bodyPartStatus(injuries);

		await this.actor.update({
			[`system.body_parts.${limb}.injuries`]: injuries,
			[`system.body_parts.${limb}.status`]: status,
		});
	}

	/** Matches FalloutPcSheet#_getBodyPartStatus: max slot → healthy/wounded/crippled. */
	static #bodyPartStatus(injuries) {
		const max = Math.max(0, ...injuries);
		if (max === 2) return "crippled";
		if (max === 1) return "wounded";
		return "healthy";
	}

	#getItem(target) {
		const id = target.closest("[data-item-id]")?.dataset.itemId;
		return id ? this.actor.items.get(id) : null;
	}

	static #onOpenItem(event, target) {
		this.#getItem(target)?.sheet?.render(true);
	}

	static #onShowInfo(event, target) {
		event.stopPropagation();
		const item = this.#getItem(target);
		if (!item) return;
		this.#infoItemId = item.id;
		this.#renderInfo();
	}

	static #onRollSkill(event, target) {
		event.stopPropagation();
		const item = this.#getItem(target);
		if (!item) return;
		// Rolling a skill also shows its description in the lower readout.
		this.#infoItemId = item.id;
		this.#renderInfo();
		rollSkill(this.actor, item, target.dataset.attr);
	}

	/** Populate the lower readout with the selected item/skill's description. */
	async #renderInfo() {
		const panel = this.element?.querySelector(".pipboy-lower");
		if (!panel) return;
		const titleEl = panel.querySelector(".pip-info-title");
		const imgEl = panel.querySelector(".pip-info-img");
		const bodyEl = panel.querySelector(".pip-info-body");

		// Always clear first, so switching selection/tab blanks the readout before
		// the new details appear.
		panel.dataset.empty = "true";
		titleEl.textContent = "";
		imgEl.hidden = true;
		imgEl.removeAttribute("src");

		const item = this.#infoItemId ? this.actor.items.get(this.#infoItemId) : null;
		if (!item) {
			bodyEl.innerHTML = "Select an item to view details.";
			return;
		}

		bodyEl.innerHTML = "";
		panel.dataset.empty = "false";
		titleEl.textContent = item.name;
		imgEl.src = item.img;
		imgEl.hidden = false;
		const raw = item.system?.description ?? item.system?.effect ?? "";
		const html = await foundry.applications.ux.TextEditor.enrichHTML(raw, {
			secrets: item.isOwner,
		});
		// A newer selection may have happened during enrichment — don't clobber it.
		if (this.#infoItemId !== item.id) return;
		bodyEl.innerHTML = html || "<em>No description.</em>";
	}

	static async #onAttackWeapon(event, target) {
		event.stopPropagation();
		const item = this.#getItem(target);
		if (item) await rollWeaponAttack(this.actor, item);
	}

	static async #onDamageWeapon(event, target) {
		event.stopPropagation();
		const item = this.#getItem(target);
		if (item) await rollWeaponDamage(this.actor, item);
	}

	static async #onUseConsumable(event, target) {
		event.stopPropagation();
		const item = this.#getItem(target);
		if (!item || typeof this.actor.consumeItem !== "function") return;
		await this.actor.consumeItem(item);
		this.render();
	}

	static async #onRollItem(event, target) {
		event.stopPropagation();
		const item = this.#getItem(target);
		if (!item) return;
		// Weapons roll an attack; everything else posts to chat.
		if (item.type === "weapon") await rollWeaponAttack(this.actor, item);
		else if (typeof item.sendToChat === "function") await item.sendToChat();
		else item.sheet?.render(true);
	}

	static async #onToggleEquip(event, target) {
		event.stopPropagation();
		const item = this.#getItem(target);
		if (!item || typeof item.system?.equipped !== "boolean") return;
		await item.update({ "system.equipped": !item.system.equipped });
	}
}
