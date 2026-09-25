import { MODULE_ID } from "./constants.mjs";
import { TravelDial } from "./travel-dial.mjs";

/**
 * Hex travel — Fallout 1-style fast travel across the configured World Map.
 *
 * Dragging a token on the world-map scene is intercepted, cancelled, and
 * replayed one hex at a time: each hex advances world time and rolls for a
 * random encounter, and the journey halts where an encounter fires.
 *
 * The drag has to be cancelled and replayed rather than reshaped: Foundry
 * deep-freezes the movement operation apart from `autoRotate` / `showRuler`,
 * so a hook cannot rewrite a drag's path — only reject it.
 *
 * All world mutation (time, table draws, chat) happens on the GM's client;
 * players route through the module socket, as item drops and transfers do.
 */

const SECONDS_PER_HOUR = 3600;

export class PipBoyTravel {
	static get enabled() {
		return game.settings.get(MODULE_ID, "travelEnabled") === true;
	}

	/* ---------------------------------------------------------------------- */
	/*  Party actor                                                            */
	/* ---------------------------------------------------------------------- */

	/** The module-owned actor that represents the travelling group, if made. */
	static findPartyActor() {
		return game.actors.find((a) => a.getFlag(MODULE_ID, "partyActor") === true) ?? null;
	}

	/**
	 * Find or create the party actor. The fallout system has no party/group
	 * type, so the module owns one.
	 *
	 * It is an `npc`: the system only recomputes health for `character` and
	 * `robot` actors, so an NPC's HP stays exactly as set (a character would be
	 * recalculated to 0 and clutter the PC list). GM only — players cannot
	 * create actors.
	 */
	static async ensurePartyActor() {
		const existing = this.findPartyActor();
		if (existing) return existing;
		if (!game.user.isGM) return null;
		return Actor.create({
			name: "The Party",
			type: "npc",
			system: { health: { value: 1, max: 1 } },
			ownership: { default: CONST.DOCUMENT_OWNERSHIP_LEVELS.OWNER },
			flags: { [MODULE_ID]: { partyActor: true, members: [] } },
		});
	}

	/** Actors currently travelling: the party roster, else every player-owned
	 *  character so travel still works before a roster is set. */
	static partyMembers() {
		const party = this.findPartyActor();
		const uuids = party?.getFlag(MODULE_ID, "members") ?? [];
		const rostered = uuids
			.map((uuid) => fromUuidSync(uuid))
			.filter((a) => a instanceof Actor);
		if (rostered.length) return rostered;
		return game.actors.filter((a) => a.type === "character" && a.hasPlayerOwner);
	}

	/** Highest Survival rank in the party — the Outdoorsman analogue. */
	static bestSurvival() {
		let best = 0;
		for (const actor of this.partyMembers()) {
			for (const item of actor.items) {
				if (item.type !== "skill") continue;
				if ((item.name ?? "").toLowerCase() !== "survival") continue;
				best = Math.max(best, Number(item.system?.value) || 0);
			}
		}
		return best;
	}

	/** Encounter chance for one hex, reduced by the party's best Survival. */
	static encounterChance() {
		const base = Number(game.settings.get(MODULE_ID, "encounterChance")) || 0;
		const perRank = Number(game.settings.get(MODULE_ID, "encounterSurvivalReduction")) || 0;
		const floor = Number(game.settings.get(MODULE_ID, "encounterChanceFloor")) || 0;
		return Math.max(floor, base - (this.bestSurvival() * perRank));
	}

	/* ---------------------------------------------------------------------- */
	/*  Interception                                                           */
	/* ---------------------------------------------------------------------- */

	/** preMoveToken: returning false cancels the drag. Runs on the client that
	 *  performed the drag. */
	static onPreMoveToken(document, move, options) {
		if (!this.enabled) return true;
		// Our own stepper moves carry this flag. Without the guard, every step
		// would be intercepted as a new journey and recurse.
		if (options?.pipboyTravel) return true;

		const scene = document.parent;
		const sceneId = game.settings.get(MODULE_ID, "worldMapSceneId");
		if (!sceneId || scene?.id !== sceneId) return true;

		// Only the party token travels, unless the GM opened it up.
		if (!game.settings.get(MODULE_ID, "travelAnyToken")) {
			const partyActorId = game.settings.get(MODULE_ID, "worldMapActorId");
			if (!partyActorId || document.actorId !== partyActorId) return true;
		}

		// A world map used for travel must be hexagonal.
		if (!scene.grid?.isHexagonal) {
			ui.notifications?.warn(
				"The Pip-Boy World Map must use a hexagonal grid for travel. Movement was not tracked.");
			return true;
		}

		// Travel is untrackable without a GM: time would not advance and no
		// encounter would roll, so the party would skip the journey entirely.
		if (!game.users.activeGM) {
			ui.notifications?.warn("A GM must be online to travel on the world map.");
			return false;
		}

		if (document.getFlag(MODULE_ID, "travelling")) {
			ui.notifications?.warn("Travel already in progress.");
			return false;
		}

		const waypoints = move?.waypoints ?? [];
		const destination = waypoints[waypoints.length - 1] ?? move?.destination;
		if (!destination) return true;

		const payload = {
			tokenUuid: document.uuid,
			destination: { x: destination.x, y: destination.y },
			userId: game.user.id,
		};
		if (game.user.isGM) {
			this.travel(payload);
		} else {
			ui.notifications?.info("Travelling…");
			game.socket.emit(`module.${MODULE_ID}`, { action: "travel", ...payload });
		}
		return false; // the stepper replays this movement hex by hex
	}

	/* ---------------------------------------------------------------------- */
	/*  The journey (GM client)                                                */
	/* ---------------------------------------------------------------------- */

	static async travel({ tokenUuid, destination, userId }) {
		if (!game.user.isGM) return;
		const tokenDoc = await fromUuid(tokenUuid);
		if (!tokenDoc) return;
		const requester = game.users.get(userId);
		if (requester && !tokenDoc.testUserPermission(requester, "OWNER")) return;

		const scene = tokenDoc.parent;
		const grid = scene?.grid;
		if (!grid?.isHexagonal) return;

		const origin = { x: tokenDoc.x, y: tokenDoc.y, elevation: tokenDoc.elevation ?? 0 };

		// Token x/y (and a drag's waypoints) are the token's TOP-LEFT corner, not
		// its centre. Feeding those straight to the grid asks about whichever hex
		// contains that corner — a different hex than the token occupies — which
		// is why the path wandered and the journey finished one hex out. Offset
		// both endpoints by half the token before resolving them to hexes.
		const width = (tokenDoc.width ?? 1) * grid.sizeX;
		const height = (tokenDoc.height ?? 1) * grid.sizeY;
		const toCentre = (pos) => grid.getCenterPoint({
			x: pos.x + (width / 2),
			y: pos.y + (height / 2),
		});

		const path = grid.getDirectPath([toCentre(origin), toCentre(destination)]);
		if (path.length <= 1) return; // same hex

		const maxHexes = Number(game.settings.get(MODULE_ID, "travelMaxHexes")) || 50;
		const steps = path.slice(1, 1 + maxHexes);
		const hexHours = Number(game.settings.get(MODULE_ID, "travelHexHours")) || 1;
		const hexSeconds = Math.max(0.2, Number(game.settings.get(MODULE_ID, "travelHexSeconds")) || 3);
		const hexMs = hexSeconds * 1000;

		const journeyId = foundry.utils.randomID();
		await tokenDoc.update({
			[`flags.${MODULE_ID}.travelling`]: true,
			[`flags.${MODULE_ID}.journeyId`]: journeyId,
		});

		// One move per hex, issued back to back with nothing awaited in between,
		// so the token flows from hex to hex. A single multi-waypoint move looks
		// marginally smoother but cannot be interrupted reliably: core refuses
		// stopMovement() once a movement reports "completed", so an encounter
		// raced the animation and failed to halt the party. Driving the path a
		// hex at a time means stopping is simply not issuing the next move.
		const centres = steps.map((offset) => grid.getCenterPoint(offset));
		const waypointFor = (centre) => ({
			x: centre.x - (width / 2),
			y: centre.y - (height / 2),
			snapped: true,
		});

		let travelled = 0;
		let secondsAdvanced = 0;
		let encounter = null;
		const log = [];
		TravelDial.open();

		try {
			for (let i = 0; i < steps.length; i++) {
				if (tokenDoc.getFlag(MODULE_ID, "stopTravel")) break;

				// Roll for the hex being entered BEFORE the glide starts, so the
				// reels spin during the crossing and land as the party arrives.
				const check = await this.#checkEncounter(scene, centres[i], i + 1, hexMs);

				// move() resolves when the document update commits, NOT when the
				// animation finishes, so awaiting it alone runs the whole journey
				// in a few milliseconds and fires every roll at once. Pace the
				// loop on our own clock and wait for both.
				const [moved] = await Promise.all([
					tokenDoc.move([waypointFor(centres[i])], {
						pipboyTravel: true,
						// movementSpeed is hexes per second: the inverse of the
						// seconds-per-hex the GM configures, so the glide lasts
						// about as long as the wait below.
						animation: { movementSpeed: 1 / hexSeconds },
					}),
					new Promise((resolve) => { setTimeout(resolve, hexMs); }),
				]);
				if (moved === false) break; // walls, or the movement was stopped

				travelled++;
				log.push(check.entry);

				// The clock moves with the party: one advance as each hex is
				// crossed. Animating it *within* a hex — by hand, or through
				// Calendaria's smooth advancement — makes the scene lighting
				// recalculate on every step and strobe, so it stays at hex grain.
				const hexSecondsOfTime = Math.round(hexHours * SECONDS_PER_HOUR);
				await this.#advanceTime(hexSecondsOfTime);
				secondsAdvanced += hexSecondsOfTime;

				if (check.encounter) {
					encounter = check.encounter;
					await TravelDial.settle();
					// A scene-linked encounter is the GM's call before anything
					// changes underfoot.
					if (encounter.link?.sceneUuid) {
						encounter = await this.#promptGM(scene, centres[i], encounter, travelled);
						log[log.length - 1].text = encounter.text;
					}
					break; // the party stops here: no further move is issued
				}
			}
		} finally {
			// Always clear, so an error can't strand the token as un-draggable.
			await tokenDoc.update({
				[`flags.${MODULE_ID}.travelling`]: false,
				[`flags.${MODULE_ID}.-=stopTravel`]: null,
			});
			await TravelDial.finish(encounter ? "TRAVEL HALTED" : "ARRIVED");
		}

		await this.#postSummary({
			tokenDoc, journeyId, origin, travelled, secondsAdvanced, encounter, log,
		});
	}

	/**
	 * Advance world time.
	 *
	 * Calendaria exposes `CALENDARIA.api.advanceTime(delta)`, which drives its
	 * own clock rather than leaving it to react to a raw `core.time` setting
	 * write. Any other calendar module (or none) falls back to core
	 * `game.time.advance`, which they all follow.
	 *
	 * One clean jump per call. Calendaria's smooth advancement was tried here
	 * and withdrawn: it works by issuing `game.time.advance` once per step, and
	 * every one of those makes the scene lighting recalculate — so any setting
	 * fine enough to read as smooth also strobed.
	 *
	 * @param {number} seconds  How far to move the clock. May be negative.
	 */
	static async #advanceTime(seconds) {
		if (seconds === 0) return;
		const advance = globalThis.CALENDARIA?.api?.advanceTime;
		if (typeof advance === "function") {
			try {
				await globalThis.CALENDARIA.api.advanceTime(seconds);
				return;
			} catch (error) {
				console.warn(`${MODULE_ID} | Calendaria advanceTime failed; using core time`, error);
			}
		}
		await game.time.advance(seconds);
	}

	/**
	 * Check one hex for an encounter. Always rolls, so the journey's card can
	 * show every roll, not only the one that stopped the party.
	 * @returns {{entry: object, encounter: object|null}}
	 */
	static async #checkEncounter(scene, point, hexNumber, dialMs, { forceHit = false } = {}) {
		const chance = this.encounterChance();
		const roll = await new Roll("1d100").evaluate();
		const hit = forceHit || roll.total <= chance;
		// Start the reels but don't wait on them: they spin while the token
		// walks on to the next hex. Only a hit is waited out, by the caller.
		// A reroll skips the counter — it is answering the GM, not the hex.
		if (!forceHit) {
			TravelDial.roll(roll.total, { chance, hex: hexNumber, hit, duration: dialMs });
		}

		const entry = { hex: hexNumber, roll: roll.total, chance, hit, text: "" };
		if (!entry.hit) return { entry, encounter: null };

		const { table, regionName } = await this.#tableForPoint(scene, point);
		if (!table) {
			entry.text = "no encounter table configured";
			entry.hit = false;
			return { entry, encounter: null };
		}

		const draw = await table.draw({ displayChat: false });
		const results = draw?.results ?? [];
		if (!results.length) {
			entry.text = "table produced no result";
			entry.hit = false;
			return { entry, encounter: null };
		}

		const text = results
			.map((res) => res.name || res.text || res.description || "Encounter")
			.join(", ");
		entry.text = text;
		entry.regionName = regionName;

		// Scene links and their trimmings live in module flags on the result;
		// documentUuid is read too, for results linked by dragging a scene onto
		// core's own table sheet.
		const linked = results.map((res) => {
			const flags = res.flags?.[MODULE_ID] ?? {};
			return {
				sceneUuid: flags.sceneUuid || res.documentUuid || null,
				playlistUuid: flags.playlistUuid || null,
				journalUuid: flags.journalUuid || null,
				notes: flags.notes || "",
			};
		}).find((link) => link.sceneUuid) ?? null;

		// No-replacement tables mark results drawn; remember which, so undo can
		// put them back without resetting the whole table.
		const drawnResults = (table.replacement === false && !table.pack)
			? [{ tableUuid: table.uuid, resultIds: results.map((res) => res.id) }]
			: [];

		if (linked && game.settings.get(MODULE_ID, "encounterPreload")) {
			// Start fetching the art now, while the GM is still reading the
			// prompt, so activating is instant.
			this.#preload(linked.sceneUuid);
		}

		return {
			entry,
			encounter: {
				text, tableName: table.name, tableUuid: table.uuid, regionName,
				chance, roll: roll.total, drawnResults, link: linked,
			},
		};
	}

	/* ---------------------------------------------------------------------- */
	/*  Scene-linked encounters                                                */
	/* ---------------------------------------------------------------------- */

	static #preload(sceneUuid) {
		try {
			const scene = fromUuidSync(sceneUuid);
			if (scene?.id) game.scenes.preload(scene.id, { broadcast: true });
		} catch (_e) { /* preloading is an optimisation, never a requirement */ }
	}

	/**
	 * Ask the GM what to do with a scene-linked encounter. Resolves to the
	 * encounter to record: the original, a rerolled one, or the original with
	 * activation declined.
	 */
	static async #promptGM(scene, point, encounter, hexNumber) {
		let current = encounter;
		// A reroll re-prompts, so the GM can keep drawing until something fits.
		for (let attempt = 0; attempt < 10; attempt++) {
			const target = current.link?.sceneUuid ? fromUuidSync(current.link.sceneUuid) : null;
			const lines = [
				`<p><strong>${foundry.utils.escapeHTML(current.text)}</strong></p>`,
				target
					? `<p>Scene: <em>${foundry.utils.escapeHTML(target.name)}</em></p>`
					: "<p><em>The linked scene no longer exists.</em></p>",
			];
			if (current.link?.notes) {
				lines.push(`<p>${foundry.utils.escapeHTML(current.link.notes)}</p>`);
			}

			const choice = await foundry.applications.api.DialogV2.wait({
				window: { title: `Encounter — Hex ${hexNumber}` },
				content: lines.join(""),
				buttons: [
					{ action: "activate", label: "Activate", icon: "fas fa-play", default: true },
					{ action: "reroll", label: "Reroll", icon: "fas fa-dice" },
					{ action: "ignore", label: "Ignore", icon: "fas fa-xmark" },
				],
				rejectClose: false,
			}) ?? "ignore";

			if (choice === "activate") {
				await this.activateEncounter(current);
				return current;
			}
			if (choice !== "reroll") return current;

			const next = await this.#checkEncounter(scene, point, hexNumber, 0, { forceHit: true });
			if (!next.encounter) return current;
			// Keep every drawn result in the snapshot, or undo leaves the
			// rerolled ones consumed on a no-replacement table.
			next.encounter.drawnResults = [
				...(current.drawnResults ?? []),
				...(next.encounter.drawnResults ?? []),
			];
			current = next.encounter;
		}
		return current;
	}

	/** Preload, remember the way back, activate, and bring the trimmings. */
	static async activateEncounter(encounter) {
		if (!game.user.isGM) return false;
		const link = encounter?.link;
		const scene = link?.sceneUuid ? await fromUuid(link.sceneUuid) : null;
		if (!scene) {
			ui.notifications?.warn("That encounter's scene no longer exists.");
			return false;
		}

		// Remember where to come back to before we leave it.
		const current = game.scenes.active;
		if (current && current.id !== scene.id) {
			await game.settings.set(MODULE_ID, "travelReturnSceneId", current.id);
		}

		const pullUsers = game.settings.get(MODULE_ID, "encounterPullUsers") === true;
		if (pullUsers) {
			// Pulling players to a scene they can't see strands them looking at
			// nothing, so warn rather than silently stranding them.
			const blocked = game.users.players.filter(
				(user) => user.active && !scene.testUserPermission(user, "LIMITED"));
			if (blocked.length) {
				ui.notifications?.warn(
					`${blocked.map((u) => u.name).join(", ")} cannot view "${scene.name}".`);
			}
		}
		await scene.activate({ pullUsers });

		if (link.playlistUuid) {
			const playlist = await fromUuid(link.playlistUuid);
			if (playlist) {
				for (const other of game.playlists.playing) {
					if (other.id !== playlist.id) await other.stopAll();
				}
				await playlist.playAll();
			}
		}
		if (link.journalUuid) {
			const journal = await fromUuid(link.journalUuid);
			journal?.sheet?.render(true); // runs on the GM's client only
		}

		await ChatMessage.create({
			speaker: { alias: "Pip-Boy Travel" },
			whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
			content: `<div class="pip-travel-card">
				<div class="pip-travel-head">Encounter underway &middot;
					<strong>${foundry.utils.escapeHTML(scene.name)}</strong></div>
				<button type="button" class="pip-travel-return">RETURN TO MAP</button>
			</div>`,
			flags: { [MODULE_ID]: { travelReturn: true } },
		});
		this.refreshReturnBanner();
		return true;
	}

	/**
	 * Show or hide the standing RETURN control.
	 *
	 * The way back can't live only in a chat card: chat scrolls, and the GM
	 * needs this whenever the encounter happens to end. This is a fixed banner,
	 * visible to the GM for as long as a return scene is remembered.
	 */
	static refreshReturnBanner() {
		const id = "pip-travel-return-banner";
		document.getElementById(id)?.remove();
		if (!game.user?.isGM) return;

		const sceneId = game.settings.get(MODULE_ID, "travelReturnSceneId");
		const scene = sceneId ? game.scenes.get(sceneId) : null;
		if (!scene) return;
		// Already back on the map: nothing to return to.
		if (game.scenes.active?.id === scene.id) return;

		const el = document.createElement("div");
		el.id = id;
		el.className = "pip-return-banner";
		el.innerHTML = `<span class="pip-return-label" data-tooltip="Drag to reposition">
				<i class="fas fa-grip-vertical"></i> Encounter underway
			</span>
			<button type="button" class="pip-return-go">
				<i class="fas fa-map-location-dot"></i> RETURN TO ${foundry.utils.escapeHTML(scene.name)}
			</button>
			<button type="button" class="pip-return-dismiss" data-tooltip="Hide until the next encounter">
				<i class="fas fa-xmark"></i>
			</button>`;
		el.querySelector(".pip-return-go").addEventListener("click", () => this.returnToMap());
		el.querySelector(".pip-return-dismiss").addEventListener("click", () => el.remove());
		document.body.appendChild(el);

		this.#placeBanner(el, game.settings.get(MODULE_ID, "returnBannerAnchor"));
		this.#makeBannerDraggable(el);
	}

	/**
	 * Where the banner can sit. The screen edges are busy — Calendaria takes
	 * the top centre, scene navigation the top left, the sidebar the right, and
	 * the AP trackers sit above the hotbar — so bottom-centre is lifted clear of
	 * the Overseer/Party AP counters rather than landing on them.
	 */
	static #BANNER_ANCHORS = {
		"top-left": { top: "8px", left: "8px" },
		"top-center": { top: "8px", left: "50%", translate: "-50% 0" },
		"top-right": { top: "8px", right: "8px" },
		"bottom-left": { bottom: "12px", left: "8px" },
		"bottom-center": { bottom: "165px", left: "50%", translate: "-50% 0" },
		"bottom-right": { bottom: "12px", right: "8px" },
	};

	static #placeBanner(el, anchor) {
		const pos = this.#BANNER_ANCHORS[anchor] ?? this.#BANNER_ANCHORS["bottom-left"];
		// Clear every edge first: anchors set only the two they care about.
		Object.assign(el.style, {
			top: "", right: "", bottom: "", left: "", translate: "",
		});
		Object.assign(el.style, pos);
	}

	/** The viewport point each anchor represents, for nearest-snap. */
	static #anchorPoints() {
		const w = window.innerWidth;
		const h = window.innerHeight;
		return {
			"top-left": { x: 0, y: 0 },
			"top-center": { x: w / 2, y: 0 },
			"top-right": { x: w, y: 0 },
			"bottom-left": { x: 0, y: h },
			"bottom-center": { x: w / 2, y: h - 165 },
			"bottom-right": { x: w, y: h },
		};
	}

	/** Distance from the banner's centre at which an anchor reads as "locked on". */
	static #SNAP_RADIUS = 220;

	/**
	 * The anchor closest to an element's current centre, with its distance.
	 * Deliberately free of side effects — the caller decides what to do with
	 * the answer. Release always snaps to the nearest, however far away.
	 * @returns {{name: string, distance: number}}
	 */
	static #nearestAnchor(el) {
		const rect = el.getBoundingClientRect();
		const centre = { x: rect.left + (rect.width / 2), y: rect.top + (rect.height / 2) };
		let name = "bottom-left";
		let best = Infinity;
		for (const [candidate, point] of Object.entries(this.#anchorPoints())) {
			const distance = ((point.x - centre.x) ** 2) + ((point.y - centre.y) ** 2);
			if (distance < best) {
				best = distance;
				name = candidate;
			}
		}
		return { name, distance: Math.sqrt(best) };
	}

	/** Ghost outlines showing every position the banner can lock to, with the
	 *  one it would snap to highlighted. Only visible while dragging. */
	static #showSnapTargets(activeAnchor) {
		let layer = document.getElementById("pip-return-targets");
		if (!layer) {
			layer = document.createElement("div");
			layer.id = "pip-return-targets";
			for (const [name, pos] of Object.entries(this.#BANNER_ANCHORS)) {
				const marker = document.createElement("div");
				marker.className = "pip-return-target";
				marker.dataset.anchor = name;
				marker.textContent = name.replace("-", " ").toUpperCase();
				Object.assign(marker.style, pos);
				layer.appendChild(marker);
			}
			document.body.appendChild(layer);
			// Fade in on the next frame so the transition actually runs.
			requestAnimationFrame(() => {
				for (const marker of layer.children) marker.classList.add("visible");
			});
		}
		for (const marker of layer.children) {
			marker.classList.toggle("active", marker.dataset.anchor === activeAnchor);
		}
	}

	static #hideSnapTargets() {
		document.getElementById("pip-return-targets")?.remove();
	}

	/** Drag by the label; on release it snaps to the nearest anchor and the
	 *  choice is remembered per client. */
	static #makeBannerDraggable(el) {
		const handle = el.querySelector(".pip-return-label");
		if (!handle) return;
		let dragging = false;
		let offsetX = 0;
		let offsetY = 0;

		handle.addEventListener("pointerdown", (event) => {
			dragging = true;
			const rect = el.getBoundingClientRect();
			offsetX = event.clientX - rect.left;
			offsetY = event.clientY - rect.top;
			// Free positioning while dragging; the snap happens on release.
			Object.assign(el.style, {
				top: `${rect.top}px`, left: `${rect.left}px`,
				right: "", bottom: "", translate: "",
			});
			el.classList.add("dragging");
			this.#showSnapTargets(this.#nearestAnchor(el).name);
			handle.setPointerCapture(event.pointerId);
			event.preventDefault();
		});

		handle.addEventListener("pointermove", (event) => {
			if (!dragging) return;
			el.style.left = `${event.clientX - offsetX}px`;
			el.style.top = `${event.clientY - offsetY}px`;
			const near = this.#nearestAnchor(el);
			el.classList.toggle("near-snap", near.distance <= PipBoyTravel.#SNAP_RADIUS);
			this.#showSnapTargets(near.name);
		});

		handle.addEventListener("pointerup", async (event) => {
			if (!dragging) return;
			dragging = false;
			handle.releasePointerCapture?.(event.pointerId);

			const best = this.#nearestAnchor(el).name;
			this.#hideSnapTargets();
			this.#placeBanner(el, best);
			// Clear the drag styling last: the lookup above no longer touches
			// classes, but the order still matters if that ever changes.
			el.classList.remove("dragging", "near-snap");
			await game.settings.set(MODULE_ID, "returnBannerAnchor", best);
		});
	}

	/** Reactivate the world map the party left. */
	static async returnToMap() {
		if (!game.user.isGM) return;
		const sceneId = game.settings.get(MODULE_ID, "travelReturnSceneId");
		const scene = sceneId ? game.scenes.get(sceneId) : null;
		if (!scene) {
			ui.notifications?.warn("No world map to return to.");
			return;
		}
		await scene.activate({
			pullUsers: game.settings.get(MODULE_ID, "encounterPullUsers") === true,
		});
		await game.settings.set(MODULE_ID, "travelReturnSceneId", "");
		this.refreshReturnBanner();
	}

	/** The encounter table for a hex: a Region override if the hex sits inside
	 *  one, otherwise the world default. */
	static async #tableForPoint(scene, point) {
		for (const region of scene.regions ?? []) {
			const uuid = region.getFlag(MODULE_ID, "encounterTable");
			if (!uuid) continue;
			try {
				if (!region.testPoint(point)) continue;
			} catch (_e) {
				continue;
			}
			const table = await fromUuid(uuid);
			if (table) return { table, regionName: region.name };
		}
		const uuid = game.settings.get(MODULE_ID, "encounterTableUuid");
		const table = uuid ? await fromUuid(uuid) : null;
		return { table, regionName: null };
	}

	/* ---------------------------------------------------------------------- */
	/*  Chat cards and undo                                                    */
	/* ---------------------------------------------------------------------- */

	static #formatDuration(seconds) {
		const hours = seconds / SECONDS_PER_HOUR;
		if (hours < 1) return `${Math.round(seconds / 60)} min`;
		return `${Number.isInteger(hours) ? hours : hours.toFixed(1)} hr`;
	}

	static async #postSummary({
		tokenDoc, journeyId, origin, travelled, secondsAdvanced, encounter, log = [],
	}) {
		if (!travelled) return;
		const name = foundry.utils.escapeHTML(tokenDoc.name ?? "The party");
		const rollRows = log.map((e) => {
			const detail = e.text ? foundry.utils.escapeHTML(e.text) : "clear";
			const cls = e.hit ? " hit" : "";
			return "<div class=\"pip-travel-roll" + cls + "\">"
				+ "<span class=\"pip-travel-hex\">Hex " + e.hex + "</span>"
				+ "<span class=\"pip-travel-dice\">" + e.roll + " / " + e.chance + "%</span>"
				+ "<span class=\"pip-travel-detail\">" + detail + "</span>"
				+ "</div>";
		}).join("");
		const rollBlock = rollRows
			? "<div class=\"pip-travel-rolls\">" + rollRows + "</div>"
			: "";
		const encounterLine = encounter
			? `<div class="pip-travel-encounter"><strong>ENCOUNTER</strong>
				${foundry.utils.escapeHTML(encounter.text)}
				<span class="pip-travel-meta">${encounter.regionName
					? `${foundry.utils.escapeHTML(encounter.regionName)} &middot; ` : ""}rolled ${encounter.roll} vs ${encounter.chance}%</span></div>`
			: "";

		await ChatMessage.create({
			speaker: { alias: "Pip-Boy Travel" },
			content: `<div class="pip-travel-card">
				<div class="pip-travel-head"><strong>${name}</strong> travels
					${travelled} hex${travelled === 1 ? "" : "es"}
					&middot; ${this.#formatDuration(secondsAdvanced)}</div>
				${encounterLine}
				${rollBlock}
				<button type="button" class="pip-travel-undo">UNDO TRAVEL</button>
			</div>`,
			flags: {
				[MODULE_ID]: {
					travelUndo: {
						journeyId,
						tokenUuid: tokenDoc.uuid,
						origin,
						secondsAdvanced,
						drawnResults: encounter?.drawnResults ?? [],
					},
				},
			},
		});
	}

	/** Wire the UNDO button on a travel summary card. */
	static onRenderChatMessageHTML(message, html) {
		const undo = message.flags?.[MODULE_ID]?.travelUndo;
		const button = html?.querySelector?.(".pip-travel-undo");
		if (!undo || !button) return;
		if (!game.user.isGM || message.flags?.[MODULE_ID]?.travelUndone) {
			button.disabled = true;
			return;
		}
		button.addEventListener("click", async () => {
			button.disabled = true;
			await this.#undo(message, undo);
		});
	}

	static async #undo(message, undo) {
		const tokenDoc = await fromUuid(undo.tokenUuid);
		if (!tokenDoc) {
			ui.notifications?.warn("Pip-Boy Travel: that token no longer exists.");
			return;
		}
		// Only the most recent journey can be undone — rewinding an older one
		// would rewind time that later travel legitimately spent.
		if (tokenDoc.getFlag(MODULE_ID, "journeyId") !== undo.journeyId) {
			ui.notifications?.warn(
				"A later journey has happened since; this one can no longer be undone.");
			return;
		}

		// The guard matters here too: without it, moving the token home is
		// intercepted as a fresh drag and the party travels back again.
		await tokenDoc.move(
			[{ x: undo.origin.x, y: undo.origin.y, snapped: true, checkpoint: true }],
			{ pipboyTravel: true },
		);
		if (undo.secondsAdvanced) await this.#advanceTime(-undo.secondsAdvanced);

		for (const entry of undo.drawnResults ?? []) {
			const table = await fromUuid(entry.tableUuid);
			if (!table) continue;
			await table.updateEmbeddedDocuments("TableResult",
				entry.resultIds.map((id) => ({ _id: id, drawn: false })));
		}

		await message.update({ [`flags.${MODULE_ID}.travelUndone`]: true });
		ui.notifications?.info(`Travel undone — ${tokenDoc.name} is back where it started.`);
	}
}
