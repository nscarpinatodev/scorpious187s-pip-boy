import { MODULE_ID, TINT_COLORS, FALLOUT_GREEN } from "./constants.mjs";
import { rollWeaponAttack, rollWeaponDamage, rollSkill } from "./attacks.mjs";
import { PipBoyRadio } from "./radio.mjs";

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
	{ id: "radio", label: "RADIO", icon: "fa-radio" },
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
			adjustPaHealth: PipBoyApp.#onAdjustPaHealth,
			togglePaPower: PipBoyApp.#onTogglePaPower,
			toggleAction: PipBoyApp.#onToggleAction,
			resetActions: PipBoyApp.#onResetActions,
			toggleAim: PipBoyApp.#onToggleAim,
			toggleFavorite: PipBoyApp.#onToggleFavorite,
			addFromCompendium: PipBoyApp.#onAddFromCompendium,
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
			toggleLight: PipBoyApp.#onToggleLight,
			tuneStation: PipBoyApp.#onTuneStation,
			nextTrack: PipBoyApp.#onNextTrack,
			stopRadio: PipBoyApp.#onStopRadio,
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

	/** Client UI scale (1 = 100%). The layout inside the casing is all
	 *  percentage-based, so scaling the window scales the artwork and controls;
	 *  the font sizes follow via the --pip-ui-scale custom property. */
	static get uiScale() {
		return Number(game.settings.get(MODULE_ID, "uiScale")) || 1;
	}

	/** Base window width at 100%. */
	static BASE_WIDTH = 600;

	/** Re-apply the current scale to this window (settings change). */
	applyUiScale() {
		this.setPosition({ width: Math.round(PipBoyApp.BASE_WIDTH * PipBoyApp.uiScale) });
		this.render();
	}

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
		const app = new PipBoyApp(actor, {
			id: `${MODULE_ID}-${actor.id}`,
			position: { width: Math.round(PipBoyApp.BASE_WIDTH * PipBoyApp.uiScale) },
		});
		PipBoyApp.#instances.set(actor.id, app);
		app.render({ force: true });
		return app;
	}

	/** Bundled fallback per sound slot (null = silent unless a custom file exists). */
	static #SOUND_DEFAULTS = {
		activate: "activate.wav",
		tab: "tab.wav",
		select: "tab.wav",
		rollover: "rollover.wav",
		zoom: "rollover.wav",
		radioOn: "tab.wav",
		radioOff: "tab.wav",
		lightOn: "tab.wav",
		lightOff: "tab.wav",
		close: null,
	};

	/** Expected filenames inside the custom-sound folder, per slot. */
	static #CUSTOM_SOUND_FILES = {
		activate: "activate.wav",
		tab: "tab.wav",
		select: "select.wav",
		rollover: "rollover.wav",
		zoom: "zoom.wav",
		radioOn: "radio-on.wav",
		radioOff: "radio-off.wav",
		lightOn: "light-on.wav",
		lightOff: "light-off.wav",
		close: "close.wav",
	};

	/** Custom sound URLs discovered in the configured folder. */
	static #customSounds = new Map();

	/** Probe the configured custom-sound folder for per-slot files. Probed by
	 *  URL (HEAD request), so players don't need file-browse permission. */
	static async probeCustomSounds() {
		PipBoyApp.#customSounds.clear();
		const dir = (game.settings.get(MODULE_ID, "customSoundDir") ?? "").trim().replace(/\/+$/, "");
		if (!dir) return;
		await Promise.all(Object.entries(PipBoyApp.#CUSTOM_SOUND_FILES).map(async ([slot, name]) => {
			const url = foundry.utils.getRoute(encodeURI(`${dir}/${name}`));
			try {
				const res = await fetch(url, { method: "HEAD" });
				if (res.ok) PipBoyApp.#customSounds.set(slot, url);
			} catch (_e) { /* missing file: keep the bundled default */ }
		}));
	}

	/** Play one of the module's UI sounds locally (never broadcast). */
	static playSound(slot) {
		if (!game.settings.get(MODULE_ID, "uiSounds")) return;
		let src = PipBoyApp.#customSounds.get(slot);
		if (!src) {
			const name = PipBoyApp.#SOUND_DEFAULTS[slot];
			if (!name) return;
			src = foundry.utils.getRoute(`modules/${MODULE_ID}/sounds/${name}`);
		}
		const volume = (game.settings.get(MODULE_ID, "uiVolume") ?? 0.8)
			* (game.settings.get("core", "globalInterfaceVolume") ?? 1);
		foundry.audio.AudioHelper.play({ src, volume, autoplay: true, loop: false }, false);
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
		// Silent by default; sounds if a custom close.wav is configured.
		PipBoyApp.playSound("close");
		this.#endBootSequence();
		this.#closeEditFlyout();
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
		context.uiScale = PipBoyApp.uiScale;
		// POWER lamp glows while this actor's token light is on.
		const myToken = canvas?.scene ? this.#findMyToken(canvas.scene) : null;
		context.lightOn = myToken?.getFlag(MODULE_ID, "lightOn") === true;
		// Resolve to a root-absolute URL so the inline-style url() isn't broken by
		// Foundry's route prefix / trailing slash (relative url() 404s otherwise).
		const framePath = `modules/${MODULE_ID}/frames/pipboy-frame-${context.frameColor}.png`;
		context.frameSrc = foundry.utils.getRoute(framePath);
		context.tabs = TABS.map((t) => ({ ...t, active: t.id === this.#activeTab }));
		context.activeTab = this.#activeTab;

		context.radio = this.#prepareRadio();
		context.status = this.#prepareStatus(actor, sys);
		context.inventory = this.#prepareInventory(actor);
		context.data = this.#prepareData(actor, sys);
		context.map = this.#prepareMap();

		return context;
	}

	#prepareRadio() {
		return {
			stations: PipBoyRadio.stations().map((p) => ({
				id: p.id,
				name: p.name,
				active: p.id === PipBoyRadio.station && PipBoyRadio.playing,
			})),
			nowPlaying: PipBoyRadio.nowPlaying,
			folderName: PipBoyRadio.folderName,
			volume: PipBoyRadio.volume,
			uiVolume: game.settings.get(MODULE_ID, "uiVolume") ?? 0.8,
		};
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

	/** Scene tiles the GM tagged "Show on Pip-Boy map", in % of the scene rect.
	 *  Drawn inside the map canvas, so they pan/zoom and take the phosphor
	 *  treatment along with the scene image. */
	#sceneTiles(scene) {
		const dim = scene.dimensions;
		return scene.tiles.contents
			.filter((t) => !t.hidden && t.texture?.src && t.getFlag(MODULE_ID, "showOnMap"))
			.sort((a, b) => (a.sort ?? 0) - (b.sort ?? 0) || (a.elevation ?? 0) - (b.elevation ?? 0))
			.map((t) => {
				// v14 anchors tiles at texture.anchorX/Y (default 0.5 = centre);
				// v13 tiles have no anchor, i.e. 0 = top-left. x/y is where the
				// anchor sits, so shift back to the top-left corner for CSS.
				const ax = t.texture?.anchorX ?? 0;
				const ay = t.texture?.anchorY ?? 0;
				return {
					src: this.#resolveSrc(t.texture.src),
					left: (100 * (t.x - ax * t.width - dim.sceneX)) / dim.sceneWidth,
					top: (100 * (t.y - ay * t.height - dim.sceneY)) / dim.sceneHeight,
					width: (100 * t.width) / dim.sceneWidth,
					height: (100 * t.height) / dim.sceneHeight,
					rotation: t.rotation ?? 0,
					originX: ax * 100,
					originY: ay * 100,
					alpha: t.alpha ?? 1,
				};
			});
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
			tiles: this.#sceneTiles(scene),
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
			tiles: this.#sceneTiles(scene),
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

		// Per-limb damage resistances (armour included — the system derives these
		// from equipped apparel in _calculateCharacterBodyResistance).
		const resistances = LIMBS.map((key) => {
			const r = sys.body_parts?.[key]?.resistance ?? {};
			return {
				key,
				label: game.i18n.localize(`FALLOUT.BODYLOCATION.character.${key}`),
				physical: r.physical ?? 0,
				energy: r.energy ?? 0,
				radiation: r.radiation ?? 0,
				poison: r.poison ?? 0,
			};
		});

		// Equipped + powered power-armor pieces by location. `outfittedLocations`
		// is system-derived: false, or a plain-object copy of the apparel item.
		const paPieces = LIMBS.map((key) => {
			const loc = sys.outfittedLocations?.[key];
			if (!loc || loc.system?.apparelType !== "powerArmor") return null;
			const paValue = loc.system.health?.value ?? 0;
			const paMax = loc.system.health?.max ?? 0;
			return {
				key,
				label: game.i18n.localize(`FALLOUT.BODYLOCATION.character.${key}`),
				itemId: loc._id,
				name: loc.name,
				value: paValue,
				max: paMax,
				pct: paMax > 0 ? Math.clamp(Math.round((paValue / paMax) * 100), 0, 100) : 0,
			};
		}).filter(Boolean);

		// Equipped power-armor frames: shown even when unpowered (unpowered
		// armor drops out of `outfittedLocations`, so the frame row is what
		// lets you power it back up from the Pip-Boy).
		const paFrames = actor.items
			.filter((i) => i.type === "apparel"
				&& i.system?.apparelType === "powerArmor"
				&& i.system?.powerArmor?.isFrame === true
				&& i.system?.equipped === true
				&& i.system?.stashed !== true)
			.map((i) => ({
				id: i.id,
				name: i.name,
				powered: i.system.powerArmor.powered === true,
			}));

		const powerArmor = {
			frames: paFrames,
			pieces: paPieces,
			available: paFrames.length > 0 || paPieces.length > 0,
		};

		// Favourites: the system's own per-item `favorite` flag (toggled from
		// the character sheet's inventory), split for quick access.
		const favorites = { weapons: [], consumables: [] };
		for (const item of actor.items) {
			if (!item.system?.favorite) continue;
			const isWeapon = item.type === "weapon";
			const isConsumable = item.type === "consumable";
			if (!isWeapon && !isConsumable) continue;
			const quantity = item.system.quantity;
			if (isConsumable && typeof quantity === "number" && quantity <= 0) continue;
			(isWeapon ? favorites.weapons : favorites.consumables).push({
				id: item.id,
				name: item.name,
				img: item.img,
				quantity: quantity ?? null,
				subtitle: this.#itemSubtitle(item),
				equipped: item.system.equipped === true,
			});
		}
		for (const list of Object.values(favorites)) {
			list.sort((a, b) => a.name.localeCompare(b.name));
		}
		favorites.any = favorites.weapons.length > 0 || favorites.consumables.length > 0;

		return {
			health: { value, max, pct },
			actions: this.#prepareActions(actor),
			favorites,
			resistances,
			powerArmor,
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

	/** AP cost of an extra action: a major action costs 2 AP, a minor 1 AP. */
	static ACTION_COST = { major: 2, minor: 1 };

	/** Remaining actions this round. A character gets one major and one minor
	 *  action per turn; the stored round stamp makes them reset themselves when
	 *  the combat round moves on (and outside combat they're always fresh). */
	#prepareActions(actor) {
		if (!game.settings.get(MODULE_ID, "actionTracking")) return null;
		const round = game.combat?.round ?? 0;
		const stored = actor.getFlag(MODULE_ID, "actions");
		const fresh = stored?.round !== round;
		const major = fresh ? 1 : (stored.major ?? 1);
		const minor = fresh ? 1 : (stored.minor ?? 1);
		return {
			round, major, minor,
			// Aim is a minor action that benefits the NEXT attack; it clears
			// when that attack is rolled or when the round moves on.
			aiming: fresh ? false : (stored.aiming === true),
			majorSpent: major <= 0,
			minorSpent: minor <= 0,
			// Only surface a count when extra actions have been bought.
			majorCount: major > 1 ? major : 0,
			minorCount: minor > 1 ? minor : 0,
		};
	}

	/** Persist remaining actions for this round. */
	async #setActions(next) {
		await this.actor.setFlag(MODULE_ID, "actions", {
			round: game.combat?.round ?? 0,
			major: Math.max(0, next.major),
			minor: Math.max(0, next.minor),
			aiming: next.aiming === true,
		});
	}

	/** Is this character currently aiming? (Drives the Accurate quality.) */
	get isAiming() {
		return this.#prepareActions(this.actor)?.aiming === true;
	}

	/** Spend one action of `kind`, offering to buy another with AP when none
	 *  remain. Resolves true if an action was available (or bought). */
	async spendAction(kind) {
		if (!game.settings.get(MODULE_ID, "actionTracking")) return true;
		const actions = this.#prepareActions(this.actor);
		if (!actions) return true;
		if (actions[kind] > 0) {
			await this.#setActions({ ...actions, [kind]: actions[kind] - 1 });
			return true;
		}
		return this.#buyAction(kind, { consume: true });
	}

	/** Buy an extra action with AP. With `consume`, the bought action is used
	 *  immediately rather than banked. */
	async #buyAction(kind, { consume = false } = {}) {
		const cost = PipBoyApp.ACTION_COST[kind];
		const pool = game.user.isGM ? "gmAP" : "partyAP";
		const available = Number(game.settings.get("fallout", pool) ?? 0);
		const label = kind === "major" ? "major" : "minor";
		if (available < cost) {
			ui.notifications?.warn(
				`No ${label} action left, and not enough AP to buy one (needs ${cost}, pool has ${available}).`);
			return false;
		}
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Buy Action" },
			content: `<p>No ${label} action remaining. Spend <strong>${cost} AP</strong> `
				+ `for an extra ${label} action? (Pool: ${available})</p>`,
			rejectClose: false,
		});
		if (!confirmed) return false;
		fallout.APTrackerV2?.adjustAP(pool, -cost);
		const actions = this.#prepareActions(this.actor);
		if (!consume) await this.#setActions({ ...actions, [kind]: actions[kind] + 1 });
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			content: `<p><strong>${this.actor.name}</strong> spends <strong>${cost} AP</strong> `
				+ `for an extra ${label} action.</p>`,
		});
		return true;
	}

	#prepareConditions(conditions) {
		const F = CONFIG.FALLOUT ?? {};
		const text = (map, value) => {
			const key = map?.[value ?? 0];
			return key ? game.i18n.localize(key) : String(value ?? 0);
		};
		// Hunger/thirst/sleep render as selectors; a missing config map falls
		// back to plain text.
		const select = (map, current) => {
			const entries = Object.entries(map ?? {});
			if (!entries.length) return null;
			return entries.map(([n, key]) => ({
				value: n,
				label: game.i18n.localize(key),
				selected: Number(n) === Number(current ?? 0),
			}));
		};
		return [
			{ key: "hunger", label: "Hunger", value: text(F.HUNGER_BY_NUMBER, conditions.hunger), options: select(F.HUNGER_BY_NUMBER, conditions.hunger) },
			{ key: "thirst", label: "Thirst", value: text(F.THIRST_BY_NUMBER, conditions.thirst), options: select(F.THIRST_BY_NUMBER, conditions.thirst) },
			{ key: "sleep", label: "Sleep", value: text(F.SLEEP_BY_NUMBER, conditions.sleep), options: select(F.SLEEP_BY_NUMBER, conditions.sleep) },
			{ key: "fatigue", label: "Fatigue", value: conditions.fatigue ?? 0, editPath: "system.conditions.fatigue", editLabel: "FATIGUE" },
			{ key: "intoxication", label: "Intoxication", value: conditions.intoxication ?? 0, editPath: "system.conditions.intoxication", editLabel: "INTOXICATION" },
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
				favorite: isys.favorite === true,
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

		// Active effects (own + transferred from items), grouped the same way as
		// the system sheet: temporary, then passive, then inactive (disabled).
		const effects = [];
		const effectSource = actor.allApplicableEffects?.() ?? actor.effects;
		for (const e of effectSource) {
			const state = e.disabled ? "inactive" : e.isTemporary ? "temporary" : "passive";
			effects.push({
				id: e.id,
				name: e.name,
				img: e.img,
				state,
				showState: state !== "temporary",
				duration: state === "temporary" ? (e.duration?.label ?? "") : "",
			});
		}
		const stateOrder = { temporary: 0, passive: 1, inactive: 2 };
		effects.sort((a, b) =>
			stateOrder[a.state] - stateOrder[b.state] || a.name.localeCompare(b.name));

		return {
			effects,
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

	_onFirstRender(context, options) {
		super._onFirstRender(context, options);
		// Pip-Boy activation sound when the window first opens.
		PipBoyApp.playSound("activate");

		// Generic "select" blip for clicked controls, bound once to the
		// persistent root element. Tabs and the POWER lamp are excluded —
		// they play their own dedicated sounds.
		const OWN_SOUND_ACTIONS = new Set([
			"switchTab", "toggleLight", "zoomMap", "tuneStation", "stopRadio",
		]);
		this.element.addEventListener("click", (event) => {
			const target = event.target.closest?.("[data-action]");
			if (!target || !this.element.contains(target)) return;
			if (OWN_SOUND_ACTIONS.has(target.dataset.action)) return;
			PipBoyApp.playSound("select");
		});

		// Dropping an Item onto the Pip-Boy adds it to this character. Bound
		// once to the persistent root element.
		const DragDropCls = foundry.applications.ux?.DragDrop ?? DragDrop;
		new DragDropCls({
			dropSelector: null,
			callbacks: { drop: this.#onDropItem.bind(this) },
		}).bind(this.element);

		// PIP-OS boot sequence over the CRT, timed to the activation sound.
		if (game.settings.get(MODULE_ID, "bootScreen")) this.#runBootSequence();
	}

	/** Dropping an Item (from the sidebar, a compendium, or another actor's
	 *  sheet) onto the Pip-Boy adds a copy to this character — the same result
	 *  as dropping it on the character sheet. */
	async #onDropItem(event) {
		const TextEditorCls = foundry.applications.ux?.TextEditor?.implementation ?? TextEditor;
		const data = TextEditorCls.getDragEventData(event);
		if (data?.type !== "Item") return;
		const item = await Item.implementation.fromDropData(data);
		if (!item) return;
		// Re-dropping the actor's own item would only duplicate it — ignore.
		if (item.parent?.uuid === this.actor.uuid) return;
		if (!this.actor.isOwner) {
			ui.notifications?.warn(`You do not have permission to modify ${this.actor.name}.`);
			return;
		}
		await this.actor.createEmbeddedDocuments("Item", [item.toObject()]);
		PipBoyApp.playSound("select");
		ui.notifications?.info(`${item.name} added to ${this.actor.name}.`);
	}

	/** Live boot-sequence overlay element while the boot animation runs. */
	#bootEl = null;

	/** The classic FO3 PIP-OS boot readout. */
	static #BOOT_OS_LINES = [
		"*************** PIP-OS(R) V7.1.0.8 ***************",
		"",
		"COPYRIGHT 2075 ROBCO(R)",
		"LOADER V1.1",
		"EXEC VERSION 41.10",
		"64k RAM SYSTEM",
		"38911 BYTES FREE",
		"NO HOLOTAPE FOUND",
		"LOAD ROM(1): DEITRIX 303",
	];

	static #BOOT_POOL = [
		"CHECK RAM BANK", "RIB CONTROLLER", "EM WAVEGUIDE", "VAULT-TEC HOOKUP",
		"BIOMETRIC SEAL", "GEIGER COUNTER", "HOLOTAPE DECK", "CATHODE ARRAY",
		"PHOSPHOR GRID", "AUDIO DRIVER", "SENSOR RELAY", "POWER CELL",
	];

	static #bootLine() {
		const hex = () => Math.floor(Math.random() * 0x10000)
			.toString(16).toUpperCase().padStart(4, "0");
		const item = PipBoyApp.#BOOT_POOL[
			Math.floor(Math.random() * PipBoyApp.#BOOT_POOL.length)];
		return `0x${hex()}:${hex()}  ${item} ... OK`;
	}

	/** FO3-style boot: ~2.5s of fast POST diagnostics, then the PIP-OS header
	 *  line by line, then a blinking "Initiating..." — ending together with the
	 *  ~5.15s Boot Sequence activation sound. Click the screen to skip. */
	async #runBootSequence() {
		const screen = this.element?.querySelector(".pipboy-screen");
		if (!screen || this.#bootEl) return;
		const el = document.createElement("div");
		el.className = "pipboy-boot";
		el.addEventListener("click", () => this.#endBootSequence());
		screen.appendChild(el);
		this.#bootEl = el;

		const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
		const t0 = performance.now();

		// Phase 1: POST diagnostics scrolling by.
		const scroll = document.createElement("div");
		scroll.className = "pip-boot-scroll";
		el.appendChild(scroll);
		while (performance.now() - t0 < 2500) {
			if (this.#bootEl !== el) return;
			const line = document.createElement("div");
			line.textContent = PipBoyApp.#bootLine();
			scroll.appendChild(line);
			scroll.scrollTop = scroll.scrollHeight;
			await wait(18 + Math.random() * 40);
		}
		if (this.#bootEl !== el) return;

		// Phase 2: the PIP-OS header, one line at a time.
		scroll.remove();
		const os = document.createElement("div");
		os.className = "pip-boot-os";
		el.appendChild(os);
		for (const text of PipBoyApp.#BOOT_OS_LINES) {
			if (this.#bootEl !== el) return;
			const line = document.createElement("div");
			line.textContent = text || " ";
			os.appendChild(line);
			await wait(130);
		}
		if (this.#bootEl !== el) return;

		// Phase 3: blinking cursor until the activation sound finishes.
		const init = document.createElement("div");
		init.className = "pip-boot-init";
		init.textContent = "Initiating...";
		os.appendChild(init);
		await wait(Math.max(300, 5150 - (performance.now() - t0)));
		if (this.#bootEl === el) this.#endBootSequence();
	}

	#endBootSequence() {
		this.#bootEl?.remove();
		this.#bootEl = null;
	}

	_onRender(context, options) {
		super._onRender(context, options);

		// A re-render mid-boot rebuilds the screen; keep the overlay attached
		// (the animation loop holds a reference and carries on unbroken).
		if (this.#bootEl && !this.#bootEl.isConnected) {
			this.element?.querySelector(".pipboy-screen")?.appendChild(this.#bootEl);
		}

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

		// Hovering a GM-tagged tile on the MAP tab plays the map-rollover blip.
		for (const tile of this.element.querySelectorAll(".pip-map-tile")) {
			tile.addEventListener("mouseenter", () => PipBoyApp.playSound("rollover"));
		}

		// Volume sliders: live-adjust while dragging, persist on release.
		for (const slider of this.element.querySelectorAll(".pip-volume-slider")) {
			slider.addEventListener("input", (event) => {
				if (event.currentTarget.dataset.volume === "radio") {
					PipBoyRadio.setVolume(Number(event.currentTarget.value));
				}
			});
			slider.addEventListener("change", (event) => {
				const key = event.currentTarget.dataset.volume === "radio" ? "radioVolume" : "uiVolume";
				game.settings.set(MODULE_ID, key, Number(event.currentTarget.value));
			});
		}

		// Right-click an inventory item: Drop / Transfer / Delete context menu.
		for (const row of this.element.querySelectorAll(".pip-item[data-item-id]")) {
			row.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.#openItemMenu(row, event);
			});
		}

		// Right-click editable stats (RADS / LUCK / CAPS / LEVEL / XP): open a
		// small fly-out with a number input that writes back to the actor.
		for (const el of this.element.querySelectorAll(".pip-editable")) {
			el.addEventListener("contextmenu", (event) => {
				event.preventDefault();
				event.stopPropagation();
				this.#openEditFlyout(el);
			});
		}

		// NEEDS selectors (hunger/thirst/sleep) write straight back to the actor;
		// the updateActor hook re-renders every open Pip-Boy.
		for (const sel of this.element.querySelectorAll(".pip-need-select")) {
			sel.addEventListener("change", (event) => {
				const key = event.currentTarget.dataset.key;
				if (!key) return;
				this.actor.update({
					[`system.conditions.${key}`]: Number(event.currentTarget.value) || 0,
				});
			});
		}

		if (this.#activeTab === "map") this.#layoutMap();
	}

	/** Removes the open pop-up — edit fly-out OR item context menu — and its
	 *  document listener, if any. Only one pop-up is ever open at a time. */
	#editFlyoutCleanup = null;

	#closeEditFlyout() {
		this.#editFlyoutCleanup?.();
		this.#editFlyoutCleanup = null;
	}

	/** Fly-out editor for a `.pip-editable` element: number input prefilled with
	 *  the actor's current value at `data-edit-path`; Enter/✓ commits, Escape or
	 *  clicking elsewhere cancels. */
	/** The host element whose edit fly-out is currently open, if any. */
	#editHost = null;

	#openEditFlyout(host) {
		// Right-clicking the host again while open just closes it.
		const wasOpenHere = this.#editHost === host;
		this.#closeEditFlyout();
		if (wasOpenHere) return;

		const path = host.dataset.editPath;
		if (!path) return;
		// Edit an embedded item when data-edit-item-id is set, else the actor.
		const doc = host.dataset.editItemId
			? this.actor.items.get(host.dataset.editItemId)
			: this.actor;
		if (!doc) return;
		const current = Number(foundry.utils.getProperty(doc, path) ?? 0);
		const min = host.dataset.editMin ?? "0";
		const max = host.dataset.editMax;

		const flyout = document.createElement("div");
		flyout.className = "pip-edit-flyout";
		flyout.innerHTML = `
			<span class="pip-edit-label">${host.dataset.editLabel ?? ""}</span>
			<input type="number" step="1" min="${min}"${max != null ? ` max="${max}"` : ""} value="${current}" />
			<button type="button" class="pip-edit-ok" aria-label="Apply"><i class="fas fa-check"></i></button>`;
		// The fly-out lives on the CRT content layer, NOT inside the scrollable
		// tab pane: in the pane it gets clipped at the pane box and its right
		// overhang widens the pane into a horizontal scrollbar. On the content
		// layer it can be clamped to the screen precisely.
		const content = this.element.querySelector(".pipboy-content");
		if (!content) return;
		content.appendChild(flyout);
		const cRect = content.getBoundingClientRect();
		const hRect = host.getBoundingClientRect();
		const fRect = flyout.getBoundingClientRect();
		// Clamp horizontally to the pane's visible text column (clientWidth
		// excludes its scrollbar), not the full screen glass.
		const pane = host.closest(".pip-pane") ?? content;
		const pRect = pane.getBoundingClientRect();
		const minLeft = (pRect.left - cRect.left) + 2;
		const maxRight = (pRect.left - cRect.left) + pane.clientWidth - 2;
		let left = (hRect.left - cRect.left) + hRect.width / 2 - fRect.width / 2;
		left = Math.max(minLeft, Math.min(left, maxRight - fRect.width));
		let top = (hRect.bottom - cRect.top) + 4;
		// Not enough room below the host: open upward instead.
		if (top + fRect.height > cRect.height - 6) {
			top = (hRect.top - cRect.top) - fRect.height - 4;
		}
		flyout.style.left = `${left}px`;
		flyout.style.top = `${top}px`;

		// Suppress the "Right-click to edit" tooltip while the fly-out is open —
		// hovering the fly-out re-anchors it on top of the input otherwise.
		const tooltipText = host.dataset.tooltip;
		if (tooltipText) {
			delete host.dataset.tooltip;
			game.tooltip?.deactivate?.();
		}

		const input = flyout.querySelector("input");
		const onDocDown = (event) => {
			if (!flyout.contains(event.target)) this.#closeEditFlyout();
		};
		document.addEventListener("pointerdown", onDocDown, true);
		this.#editHost = host;
		this.#editFlyoutCleanup = () => {
			document.removeEventListener("pointerdown", onDocDown, true);
			if (tooltipText && host.isConnected) host.dataset.tooltip = tooltipText;
			flyout.remove();
			this.#editHost = null;
		};

		const commit = async () => {
			let value = Math.max(Number(min), Number(input.value));
			if (max != null) value = Math.min(Number(max), value);
			this.#closeEditFlyout();
			if (!Number.isFinite(value) || value === current) return;
			PipBoyApp.playSound("select");
			await doc.update({ [path]: value });
		};
		flyout.querySelector(".pip-edit-ok").addEventListener("click", commit);
		// Keep clicks inside the fly-out from triggering the host's own actions.
		flyout.addEventListener("click", (event) => event.stopPropagation());
		flyout.addEventListener("contextmenu", (event) => {
			event.preventDefault();
			event.stopPropagation();
		});
		input.addEventListener("keydown", (event) => {
			if (event.key === "Enter") {
				event.preventDefault();
				commit();
			} else if (event.key === "Escape") {
				event.stopPropagation();
				this.#closeEditFlyout();
			}
		});
		input.focus();
		input.select();
	}

	/** Right-click context menu for an inventory item: Drop / Transfer / Delete. */
	#openItemMenu(row, event) {
		this.#closeEditFlyout();
		const item = this.actor.items.get(row.dataset.itemId);
		if (!item) return;

		// Favourites only make sense for the things the FAVORITES section shows.
		const favouritable = ["weapon", "consumable"].includes(item.type);
		const isFavourite = item.system?.favorite === true;
		const favouriteEntry = favouritable
			? `<button type="button" data-menu="favorite">
				<i class="fas fa-star"></i> ${isFavourite ? "Unfavorite" : "Favorite"}</button>`
			: "";

		const menu = document.createElement("div");
		menu.className = "pip-context-menu";
		menu.innerHTML = `
			<div class="pip-menu-title">${item.name}</div>
			${favouriteEntry}
			<button type="button" data-menu="drop"><i class="fas fa-hand-holding"></i> Drop</button>
			<button type="button" data-menu="transfer"><i class="fas fa-people-arrows"></i> Transfer&hellip;</button>
			<button type="button" data-menu="delete"><i class="fas fa-trash"></i> Delete&hellip;</button>`;

		const content = this.element.querySelector(".pipboy-content");
		if (!content) return;
		content.appendChild(menu);
		// Place at the cursor, clamped to the pane's text column (same rules as
		// the edit fly-out).
		const cRect = content.getBoundingClientRect();
		const mRect = menu.getBoundingClientRect();
		const pane = row.closest(".pip-pane") ?? content;
		const pRect = pane.getBoundingClientRect();
		const minLeft = (pRect.left - cRect.left) + 2;
		const maxRight = (pRect.left - cRect.left) + pane.clientWidth - 2;
		let left = event.clientX - cRect.left;
		left = Math.max(minLeft, Math.min(left, maxRight - mRect.width));
		let top = event.clientY - cRect.top + 2;
		if (top + mRect.height > cRect.height - 6) top = Math.max(6, top - mRect.height - 4);
		menu.style.left = `${left}px`;
		menu.style.top = `${top}px`;

		const onDocDown = (ev) => {
			if (!menu.contains(ev.target)) this.#closeEditFlyout();
		};
		document.addEventListener("pointerdown", onDocDown, true);
		this.#editFlyoutCleanup = () => {
			document.removeEventListener("pointerdown", onDocDown, true);
			menu.remove();
		};

		menu.addEventListener("contextmenu", (ev) => ev.preventDefault());
		menu.addEventListener("click", async (ev) => {
			ev.stopPropagation();
			const action = ev.target.closest("[data-menu]")?.dataset.menu;
			if (!action) return;
			this.#closeEditFlyout();
			PipBoyApp.playSound("select");
			if (action === "favorite") {
				await item.update({ "system.favorite": !item.system.favorite });
				this.render();
			} else if (action === "drop") await this.#dropItem(item);
			else if (action === "transfer") await this.#transferItem(item);
			else if (action === "delete") await this.#deleteItem(item);
		});
	}

	/** Is dropping to the canvas possible right now? */
	static get canUseItemPiles() {
		return game.modules.get("item-piles")?.active === true
			&& typeof game.itempiles?.API?.createItemPile === "function";
	}

	/** The single reusable actor that backs every dropped-item pile.
	 *
	 *  Item Piles would otherwise fall back to its default pile actor, which
	 *  the fallout system's integration declares as a `character` — a PC-typed
	 *  actor sitting at 0 HP in the actor directory. Instead we own one `npc`
	 *  actor with real health, reused by every pile (piles are unlinked tokens
	 *  of it, so dropping never creates another actor). GM-only.
	 */
	static async #ensurePileActor() {
		const existing = game.actors.find((a) => a.getFlag(MODULE_ID, "pileActor") === true);
		if (existing) return existing;
		if (!game.user.isGM) return null;
		return Actor.create({
			name: "Dropped Items",
			type: "npc",
			// Never leave a 0 HP actor lying around — it reads as a corpse in
			// the directory and in any HP-driven automation.
			system: { health: { value: 1, max: 1 } },
			ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OBSERVER },
			flags: { [MODULE_ID]: { pileActor: true } },
		});
	}

	/** GM-side execution of a drop: create the pile, remove the item, announce
	 *  it. Players reach this through the module socket. */
	static async dropToGround({ actorUuid, itemId, sceneId, x, y }) {
		if (!game.user.isGM) return false;
		const doc = await fromUuid(actorUuid);
		const actor = doc?.actor ?? doc;
		const item = actor?.items.get(itemId);
		if (!actor || !item) return false;
		try {
			const pileActor = await PipBoyApp.#ensurePileActor();
			await game.itempiles.API.createItemPile({
				position: { x, y },
				sceneId,
				items: [item.toObject()],
				...(pileActor ? { actor: pileActor.uuid, createActor: false } : {}),
			});
			const qty = item.system?.quantity;
			const label = `<strong>${foundry.utils.escapeHTML(item.name)}</strong>`
				+ `${typeof qty === "number" && qty > 1 ? ` (×${qty})` : ""}`;
			await item.delete();
			await ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ actor }),
				content: `<p><strong>${actor.name}</strong> drops ${label} on the ground.</p>`,
			});
			return true;
		} catch (error) {
			console.error(`${MODULE_ID} | could not create an item pile`, error);
			ui.notifications?.error(`Could not drop ${item.name} on the ground — see the console.`);
			return false;
		}
	}

	/** Drop: put the item on the ground at the character's token as an item
	 *  pile, so it can be picked back up. Without a token on the scene (or
	 *  without Item Piles) the item stays in the inventory, merely unequipped —
	 *  dropping should never destroy something. */
	async #dropItem(item) {
		const scene = canvas?.scene;
		const token = scene ? this.#findMyToken(scene) : null;

		if (token && PipBoyApp.canUseItemPiles) {
			const pos = token.movement?.destination ?? token;
			const payload = {
				actorUuid: this.actor.uuid,
				itemId: item.id,
				sceneId: scene.id,
				x: pos.x ?? token.x,
				y: pos.y ?? token.y,
			};
			if (game.user.isGM) {
				if (await PipBoyApp.dropToGround(payload)) return;
			} else if (game.users.activeGM) {
				// Players can't create tokens or actors; the GM's client does it.
				game.socket.emit(`module.${MODULE_ID}`, {
					action: "dropItem", ...payload, userId: game.user.id,
				});
				ui.notifications?.info(`Dropping ${item.name}…`);
				return;
			} else {
				ui.notifications?.warn("A GM must be online to drop items on the ground.");
			}
		}

		// Fallback: keep the item, just take it off.
		const qty = item.system?.quantity;
		const label = `<strong>${foundry.utils.escapeHTML(item.name)}</strong>`
			+ `${typeof qty === "number" && qty > 1 ? ` (×${qty})` : ""}`;
		if (item.system?.equipped === true) {
			await item.update({ "system.equipped": false });
		}
		const why = !token
			? "no token on this scene"
			: (PipBoyApp.canUseItemPiles ? "the drop could not be completed" : "Item Piles isn't available");
		ui.notifications?.info(
			`${item.name} was unequipped rather than dropped on the ground (${why}).`);
		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			content: `<p><strong>${this.actor.name}</strong> sets aside ${label}.</p>`,
		});
	}

	/** Delete: silent removal, guarded by a confirmation dialog. */
	async #deleteItem(item) {
		const confirmed = await foundry.applications.api.DialogV2.confirm({
			window: { title: "Delete Item" },
			content: `<p>Delete <strong>${item.name}</strong> from ${this.actor.name}? This cannot be undone.</p>`,
			rejectClose: false,
		});
		if (confirmed) await item.delete();
	}

	/** Transfer: move the item to another player character. Falls back to a
	 *  GM-executed socket request when the user can't modify the target. */
	async #transferItem(item) {
		const targets = game.actors.filter((a) =>
			a.type === "character" && a.id !== this.actor.id && a.hasPlayerOwner);
		if (!targets.length) {
			ui.notifications?.warn("No other player characters to transfer to.");
			return;
		}
		const options = targets
			.map((a) => `<option value="${a.id}">${foundry.utils.escapeHTML(a.name)}</option>`)
			.join("");
		const targetId = await foundry.applications.api.DialogV2.prompt({
			window: { title: `Transfer ${item.name}` },
			content: `<div class="form-group"><label>Transfer to</label>
				<select name="target">${options}</select></div>`,
			ok: {
				label: "Transfer",
				callback: (ev, button) => button.form.elements.target.value,
			},
			rejectClose: false,
		});
		const target = targetId ? game.actors.get(targetId) : null;
		if (!target) return;

		if (target.isOwner) {
			await target.createEmbeddedDocuments("Item", [item.toObject()]);
			await ChatMessage.create({
				speaker: ChatMessage.getSpeaker({ actor: this.actor }),
				content: `<p><strong>${this.actor.name}</strong> gives <strong>${item.name}</strong> to <strong>${target.name}</strong>.</p>`,
			});
			await item.delete();
		} else {
			// Players can't create items on actors they don't own; ask the
			// active GM's client to perform the move.
			if (!game.users.activeGM) {
				ui.notifications?.warn("A GM must be online to transfer items to another player.");
				return;
			}
			game.socket.emit(`module.${MODULE_ID}`, {
				action: "transferItem",
				sourceActorId: this.actor.id,
				targetActorId: target.id,
				itemId: item.id,
				userId: game.user.id,
			});
			ui.notifications?.info(`Transfer of ${item.name} sent to the GM.`);
		}
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

	/** Position the map canvas (scene + tagged tiles): centre on the token,
	 *  then apply pan + zoom. */
	#layoutMap() {
		const vp = this.element?.querySelector(".pip-map-viewport");
		const cv = vp?.querySelector(".pip-map-canvas");
		const img = cv?.querySelector(".pip-map-scene");
		if (!vp || !cv || !img) return;

		const apply = () => {
			const vw = vp.clientWidth;
			const vh = vp.clientHeight;
			if (!vw || !vh || !img.naturalWidth) return;
			const zoom = this.#currentZoom(vp);
			const fx = parseFloat(vp.dataset.fx) || 0.5;
			const fy = parseFloat(vp.dataset.fy) || 0.5;
			const dispW = vw * zoom;
			const dispH = dispW * (img.naturalHeight / img.naturalWidth);
			cv.style.width = `${dispW}px`;
			cv.style.height = `${dispH}px`;
			cv.style.left = `${vw / 2 - fx * dispW + this.#mapView.panX}px`;
			cv.style.top = `${vh / 2 - fy * dispH + this.#mapView.panY}px`;

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

	/** POWER lamp on the casing: toggle a 10 bright / 20 dim Pip-Boy light on
	 *  this actor's token, restoring the token's previous light when switched
	 *  off. Colour follows the "Pip-Boy Light Colour" client setting. */
	static async #onToggleLight() {
		const scene = canvas?.scene;
		const token = scene ? this.#findMyToken(scene) : null;
		if (!token) {
			ui.notifications?.warn("Your token is not on the active scene, so the Pip-Boy light has nothing to shine from.");
			return;
		}
		if (token.getFlag(MODULE_ID, "lightOn") === true) {
			PipBoyApp.playSound("lightOff");
			// Restore whatever light the token had before we lit it.
			const prev = token.getFlag(MODULE_ID, "prevLight") ?? {};
			await token.update({
				light: prev,
				[`flags.${MODULE_ID}.-=lightOn`]: null,
				[`flags.${MODULE_ID}.-=prevLight`]: null,
			});
		} else {
			PipBoyApp.playSound("lightOn");
			const useScreen = game.settings.get(MODULE_ID, "lightColor") === "screen";
			const frame = game.settings.get(MODULE_ID, "frameColor");
			const color = useScreen ? (TINT_COLORS[frame] ?? FALLOUT_GREEN) : FALLOUT_GREEN;
			const bright = Number(game.settings.get(MODULE_ID, "lightBright")) || 10;
			const dim = Number(game.settings.get(MODULE_ID, "lightDim")) || 20;
			await token.update({
				[`flags.${MODULE_ID}.prevLight`]: token.light?.toObject() ?? {},
				[`flags.${MODULE_ID}.lightOn`]: true,
				light: { bright, dim, angle: 360, color, alpha: 0.35 },
			});
		}
	}

	static #onTuneStation(event, target) {
		const id = target.dataset.playlistId;
		const turningOff = PipBoyRadio.playing && PipBoyRadio.station === id;
		PipBoyApp.playSound(turningOff ? "radioOff" : "radioOn");
		PipBoyRadio.tune(id);
	}

	static #onNextTrack() {
		PipBoyRadio.next();
	}

	static #onStopRadio() {
		PipBoyApp.playSound("radioOff");
		PipBoyRadio.stop();
	}

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
		PipBoyApp.playSound("tab");
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
		PipBoyApp.playSound("zoom");
		const dir = Number(target.dataset.dir) || 0;
		this.#setZoom(this.#currentZoom(vp) * (dir > 0 ? 1.25 : 1 / 1.25));
	}

	static #onRecenterMap() {
		this.#mapView = { zoom: null, panX: 0, panY: 0 };
		this.#layoutMap();
	}

	/** POWER button on a power-armor frame: toggle `powered` on the frame and
	 *  every piece attached to it — mirroring the system sheet's behaviour, so
	 *  resistances and outfitted locations recalculate the same way. */
	static async #onTogglePaPower(event, target) {
		event.stopPropagation();
		const frame = this.actor.items.get(target.dataset.itemId);
		if (!frame || frame.system?.powerArmor?.isFrame !== true) return;
		const newValue = !frame.system.powerArmor.powered;
		const updateData = [{ _id: frame.id, "system.powerArmor.powered": newValue }];
		for (const attachment of this.actor.items.filter((i) => i.type === "apparel"
			&& i.system?.powerArmor?.frameId === frame.id)) {
			updateData.push({ _id: attachment.id, "system.powerArmor.powered": newValue });
		}
		await Item.updateDocuments(updateData, { parent: this.actor });
	}

	/** +/- on a power-armor piece: adjust the apparel item's own health. */
	static async #onAdjustPaHealth(event, target) {
		event.stopPropagation();
		const item = this.actor.items.get(target.dataset.itemId);
		if (!item || item.system?.apparelType !== "powerArmor") return;
		const delta = Number(target.dataset.delta) || 0;
		const max = item.system.health?.max ?? 0;
		const next = Math.clamp((item.system.health?.value ?? 0) + delta, 0, max);
		await item.update({ "system.health.value": next });
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
		if (!item) return;
		// Attacking is a major action. If none is left and the player declines
		// to buy one, warn but don't block — the GM has the final say.
		if (!await this.spendAction("major")) {
			ui.notifications?.warn(`${this.actor.name} has no major action left this round.`);
		}
		// Aim benefits this attack and its damage, then is spent.
		const aiming = this.isAiming;
		await rollWeaponAttack(this.actor, item, { aiming });
		if (aiming) {
			const actions = this.#prepareActions(this.actor);
			if (actions) await this.#setActions({ ...actions, aiming: false });
		}
		this.render();
	}

	/** Star button on a FAVORITES row: drop it from the favourites list. */
	static async #onToggleFavorite(event, target) {
		event.stopPropagation();
		const item = this.#getItem(target);
		if (!item) return;
		await item.update({ "system.favorite": !item.system.favorite });
		this.render();
	}

	/** Add an item from the system's compendiums, using the system's own type
	 *  menu and item selector — the same flow as the character sheet. */
	static #onAddFromCompendium(event) {
		event.stopPropagation();
		const menu = fallout?.apps?.ItemTypeMenu;
		if (!menu) {
			ui.notifications?.warn("The fallout system's compendium browser is unavailable.");
			return;
		}
		new menu(this.actor).render(true);
	}

	/** Click an action pip: spend it, or buy another when it's already spent. */
	static async #onToggleAction(event, target) {
		event.stopPropagation();
		const kind = target.dataset.kind;
		if (kind !== "major" && kind !== "minor") return;
		const actions = this.#prepareActions(this.actor);
		if (!actions) return;
		if (actions[kind] > 0) await this.#setActions({ ...actions, [kind]: actions[kind] - 1 });
		else await this.#buyAction(kind);
		this.render();
	}

	/** Restore both actions (new turn, or fixing a misclick). */
	static async #onResetActions(event) {
		event.stopPropagation();
		await this.#setActions({ major: 1, minor: 1, aiming: false });
		this.render();
	}

	/** AIM: a minor action that benefits the next attack. Clicking again
	 *  cancels it without refunding the action. */
	static async #onToggleAim(event) {
		event.stopPropagation();
		const actions = this.#prepareActions(this.actor);
		if (!actions) return;
		if (actions.aiming) {
			await this.#setActions({ ...actions, aiming: false });
		} else {
			// Aiming costs the minor action (bought with AP if none is left).
			if (!await this.spendAction("minor")) return;
			const after = this.#prepareActions(this.actor);
			await this.#setActions({ ...after, aiming: true });
		}
		this.render();
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
