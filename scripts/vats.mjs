import { MODULE_ID } from "./constants.mjs";

/**
 * V.A.T.S. — Vault-Tec Assisted Targeting System. Phase 1: target-aware
 * damage application for fallout 2d20 rolls.
 *
 * The fallout system automates rolling but applies nothing. V.A.T.S. builds on
 * the system's own chat cards (via their `flags.falloutroll` / `flags.weapon`
 * data — no system patches):
 *
 *  - At roll time, the roller's current targets are stamped onto the card.
 *  - Damage cards gain an APPLY block: one row per target showing the DR math
 *    (per hit location, per damage type, Piercing X honoured) with GM-only
 *    apply buttons.
 *  - Application posts an outcome card carrying an UNDO snapshot.
 *
 * All actor mutation happens on a GM client (buttons only render for GMs), so
 * player permissions never block application.
 */

/** Hit-location die result (1-20) to the shared body_parts key. All combat
 *  actor types (character, npc, creature, robot) use the same six keys. */
function locationKeyForResult(n) {
	if (n <= 2) return "head";
	if (n <= 8) return "torso";
	if (n <= 11) return "armL";
	if (n <= 14) return "armR";
	if (n <= 17) return "legL";
	return "legR";
}

const LOCATION_LABELS = {
	head: "Head",
	torso: "Torso",
	armL: "L. Arm",
	armR: "R. Arm",
	legL: "L. Leg",
	legR: "R. Leg",
};

const TYPE_LABELS = {
	physical: "Physical",
	energy: "Energy",
	radiation: "Radiation",
	poison: "Poison",
};

export class PipBoyVats {
	static get enabled() {
		return game.settings.get(MODULE_ID, "vatsMode") !== "off";
	}

	/* ---------------------------------------------------------------------- */
	/*  Spending AP to buy bonus d20s                                          */
	/* ---------------------------------------------------------------------- */

	/** Which AP pool this user draws from / banks to. */
	static get apPool() {
		return game.user.isGM ? "gmAP" : "partyAP";
	}

	static apAvailable() {
		return Number(game.settings.get("fallout", this.apPool) ?? 0);
	}

	/** Total AP cost of buying `extra` bonus dice. Escalating (the 2d20 house
	 *  pattern: 1, then 2, then 3 — 1/3/6 cumulative) or flat 1 per die. */
	static diceCost(extra, flat = false) {
		if (extra <= 0) return 0;
		if (flat || game.settings.get(MODULE_ID, "vatsDiceCost") === "flat") return extra;
		return [0, 1, 3, 6][extra] ?? 0;
	}

	/** Ask whether to spend AP on bonus dice — d20s for an attack, combat dice
	 *  for damage. Deducts the AP and resolves to the TOTAL dice to roll, or
	 *  null if the prompt was cancelled. */
	static async promptBuyDice({ kind = "attack", base = 2, max = 3, flat = false, note = "" } = {}) {
		if (!this.enabled || !game.settings.get(MODULE_ID, "vatsBuyDice")) return base;
		const available = this.apAvailable();
		const unit = kind === "damage" ? "DC" : "d20";

		const affordable = [];
		for (let extra = 0; extra <= max; extra++) {
			const cost = this.diceCost(extra, flat);
			if (extra > 0 && cost > available) break;
			affordable.push({ extra, cost });
		}
		if (affordable.length <= 1) return base; // nothing affordable to offer

		const poolLabel = this.apPool === "gmAP" ? "GM AP" : "Party AP";
		const options = affordable.map(({ extra, cost }) =>
			`<option value="${extra}">${base + extra} ${unit} &mdash; ${cost ? `${cost} AP` : "free"}</option>`).join("");
		const choice = await foundry.applications.api.DialogV2.prompt({
			window: { title: `V.A.T.S. — Bonus ${kind === "damage" ? "Damage" : "Attack"} Dice` },
			content: `<p>${poolLabel} available: <strong>${available}</strong></p>
				${note ? `<p style="opacity:.8">${note}</p>` : ""}
				<div class="form-group"><label>Roll</label>
				<select name="extra">${options}</select></div>`,
			ok: {
				label: "Roll",
				callback: (event, button) => button.form.elements.extra.value,
			},
			rejectClose: false,
		});
		if (choice == null) return null; // cancelled: don't roll at all

		const extra = Number(choice) || 0;
		const cost = this.diceCost(extra, flat);
		if (cost > 0) {
			// adjustAP routes players through the system's own socket.
			fallout.APTrackerV2?.adjustAP(this.apPool, -cost);
			await ChatMessage.create({
				speaker: { alias: "V.A.T.S." },
				content: `<div class="vats-outcome">Spent <strong>${cost}</strong> AP from the
					${poolLabel.toLowerCase()} pool for <strong>${extra}</strong> bonus
					${unit}${extra === 1 ? "" : "s"}.</div>`,
			});
		}
		return base + extra;
	}

	/** Pre-fill the next damage dialog's "Extra Dice" field with AP-bought
	 *  dice. That field is deliberately the target: the system excludes it from
	 *  the ammunition calculation, so AP-bought dice don't also cost ammo the
	 *  way fire-rate dice do. */
	static primeExtraDice(count) {
		if (!(count > 0)) return;
		const hookId = Hooks.on("renderDialog", (app, html) => {
			const element = html instanceof HTMLElement ? html : html?.[0];
			const input = element?.querySelector(".extra-dice");
			if (!input) return;
			input.value = count;
			Hooks.off("renderDialog", hookId);
		});
		// Never leave the hook armed if the dialog doesn't appear.
		setTimeout(() => Hooks.off("renderDialog", hookId), 10000);
	}

	/** Verdict for a just-completed attack roll against the user's current
	 *  targets — used by the auto-damage chain, which runs before the card
	 *  exists to hang a GM override on. */
	static quickVerdict(dicesRolled) {
		const successes = (dicesRolled ?? [])
			.reduce((total, die) => total + (die.success ?? 0), 0);
		const defenses = [...game.user.targets]
			.map((t) => Number(t.actor?.system?.defense?.value))
			.filter(Number.isFinite);
		const difficulty = defenses.length ? Math.max(...defenses) : 1;
		return { successes, difficulty, hit: successes >= difficulty };
	}

	/** preCreateChatMessage (runs on the rolling client only): stamp the
	 *  roller's current targets onto fallout roll cards. */
	static onPreCreateChatMessage(message) {
		if (!this.enabled) return;
		if (!message.flags?.falloutroll) return;
		const targets = [...game.user.targets]
			.map((t) => t.document?.uuid)
			.filter(Boolean);
		if (targets.length) {
			message.updateSource({ [`flags.${MODULE_ID}.targets`]: targets });
		}
	}

	static onRenderChatMessageHTML(message, html) {
		if (!this.enabled || !html) return;
		this.#renderAttackBlock(message, html);
		this.#renderApplyBlock(message, html);
		this.#wireUndo(message, html);
		this.#wirePersist(message, html);
	}

	/* ---------------------------------------------------------------------- */
	/*  HIT / MISS verdict on attack cards                                     */
	/* ---------------------------------------------------------------------- */

	/** Successes are not stored on the card; recompute them the way the system
	 *  does (crits already count double in each die's `success`). */
	static #successes(falloutRoll) {
		return (falloutRoll.dicesRolled ?? [])
			.reduce((total, die) => total + (die.success ?? 0), 0);
	}

	/** Re-roll cards are named "<original> re-roll" (chains keep appending). */
	static #rollnameBase(name) {
		return typeof name === "string" ? name.replace(/(\s*re-roll)+$/, "") : "";
	}

	/** Resolve a d20 card to its attack context: its own hit location, or —
	 *  for re-roll cards, which carry no location of their own — the original
	 *  attack card's location, targets, and difficulty. Null for skill checks. */
	static #attackDataFor(message) {
		const falloutRoll = message.flags?.falloutroll;
		if (falloutRoll?.diceFace !== "d20") return null;
		if (falloutRoll.hitLocationResult != null) {
			return {
				falloutRoll,
				hitLocationResult: Number(falloutRoll.hitLocationResult),
				targets: message.flags?.[MODULE_ID]?.targets ?? null,
				original: message,
				isReroll: false,
			};
		}
		const base = this.#rollnameBase(falloutRoll.rollname);
		if (!base || base === falloutRoll.rollname) return null;
		const authorId = message.author?.id ?? message.user?.id;
		const messages = game.messages.contents;
		let idx = messages.indexOf(message);
		if (idx === -1) idx = messages.length;
		for (let i = idx - 1, seen = 0; i >= 0 && seen < 50; i--, seen++) {
			const m = messages[i];
			const fr = m.flags?.falloutroll;
			if (fr?.diceFace !== "d20" || fr.hitLocationResult == null) continue;
			if ((m.author?.id ?? m.user?.id) !== authorId) continue;
			if (this.#rollnameBase(fr.rollname) !== base) continue;
			return {
				falloutRoll,
				hitLocationResult: Number(fr.hitLocationResult),
				targets: m.flags?.[MODULE_ID]?.targets
					?? message.flags?.[MODULE_ID]?.targets ?? null,
				original: m,
				isReroll: true,
			};
		}
		return null;
	}

	static #attackVerdict(message, attackData = this.#attackDataFor(message)) {
		if (!attackData) return null;
		const successes = this.#successes(attackData.falloutRoll);
		const own = message.flags?.[MODULE_ID]?.difficulty;
		const inherited = attackData.original !== message
			? attackData.original?.flags?.[MODULE_ID]?.difficulty
			: null;
		let difficulty;
		let source = "set";
		if (own != null) {
			difficulty = Number(own);
		} else if (inherited != null) {
			difficulty = Number(inherited);
		} else {
			// Default difficulty: the targeted actor's Defense rating (the
			// highest, when several targets are marked).
			const defenses = (attackData.targets ?? [])
				.map((uuid) => {
					const target = fromUuidSync(uuid);
					const actor = target?.actor ?? target;
					return Number(actor?.system?.defense?.value);
				})
				.filter(Number.isFinite);
			if (defenses.length) {
				difficulty = Math.max(...defenses);
				source = "defense";
			} else {
				difficulty = 1;
				source = "default";
			}
		}
		return {
			successes,
			difficulty,
			source,
			hit: successes >= difficulty,
			ap: Math.max(0, successes - difficulty),
		};
	}

	/** Retargeting is the GM's call alone: re-judging a roll against a different
	 *  token decides whether it lands, so it is not a player's to make. */
	static #canRetarget() {
		return game.user.isGM;
	}

	/** The retarget control. Foundry's own ping icon, as the PF2e tools use it
	 *  for exactly this. */
	static #retargetButton(message) {
		if (!this.#canRetarget()) return "";
		return '<button type="button" class="vats-retarget" data-tooltip="Target a token, then click to re-aim this roll">'
			+ '<i class="fa-solid fa-bullseye"></i></button>';
	}

	/**
	 * Point an existing roll at whatever is targeted now, and re-evaluate it.
	 *
	 * The card keeps its dice: a retarget re-judges the roll that was made
	 * rather than rolling again. On an attack that means the successes are
	 * measured against the new target's Defense; on damage it means the maths
	 * are redone against the new target's resistances.
	 */
	static async #retarget(message) {
		if (!this.#canRetarget()) return;
		const targets = [...game.user.targets]
			.map((t) => t.document?.uuid)
			.filter(Boolean);
		if (!targets.length) {
			ui.notifications?.warn("Target a token first, then click retarget.");
			return;
		}

		const update = { [`flags.${MODULE_ID}.targets`]: targets };
		// A difficulty the GM set by hand belonged to the old target, so drop it
		// and let the new target's Defense stand — that is the point of
		// retargeting. Setting it again afterwards still overrides.
		if (message.flags?.falloutroll?.diceFace === "d20") {
			update[`flags.${MODULE_ID}.-=difficulty`] = null;
		}
		await message.update(update);

		const names = targets
			.map((uuid) => fromUuidSync(uuid)?.name)
			.filter(Boolean)
			.join(", ");
		ui.notifications?.info(`Re-aimed at ${names || "the new target"}.`);
	}

	/** Wire the retarget control wherever it was rendered. */
	static #wireRetarget(message, root) {
		root?.querySelector?.(".vats-retarget")?.addEventListener("click", (event) => {
			event.currentTarget.disabled = true;
			this.#retarget(message);
		});
	}

	/** Attack cards — and their re-roll cards — get a verdict strip:
	 *  successes vs difficulty → HIT/MISS, excess successes shown as AP. The
	 *  GM can change the difficulty; the verdict re-renders for everyone. */
	static #renderAttackBlock(message, html) {
		const attackData = this.#attackDataFor(message);
		if (!attackData) return;

		const verdict = this.#attackVerdict(message, attackData);
		const isGM = game.user.isGM;

		const strip = document.createElement("div");
		strip.className = "vats-block vats-attack";
		const defenseTag = verdict.source === "defense"
			? '<span class="vats-src" data-tooltip="From the target\'s Defense rating">DEF</span>' : "";
		const difficultyControl = isGM
			? `<select class="vats-difficulty">${[0, 1, 2, 3, 4, 5].map((d) =>
				`<option value="${d}"${d === verdict.difficulty ? " selected" : ""}>${d}</option>`).join("")}</select>${defenseTag}`
			: `<span class="vats-stat">${verdict.difficulty}</span>${defenseTag}`;
		// Excess successes can be banked as AP: the roller (or GM) clicks once;
		// NPC attacks rolled by the GM bank to the GM pool instead.
		const banked = message.flags?.[MODULE_ID]?.apBanked === true;
		const canBank = game.user.isGM || message.author?.id === game.user.id;
		const pool = message.author?.isGM ? "gmAP" : "partyAP";
		const bankButton = verdict.hit && verdict.ap > 0 && canBank
			? `<button type="button" class="vats-bank"${banked ? " disabled" : ""}>
				${banked ? "AP BANKED" : `BANK +${verdict.ap} AP`}</button>`
			: (verdict.hit && verdict.ap ? `<span class="vats-ap">+${verdict.ap} AP</span>` : "");

		// Two rows: identity + verdict on top, the maths and controls beneath —
		// the strip has to survive a narrow chat sidebar.
		strip.innerHTML = `
			<div class="vats-hdr">
				<span class="vats-title">V.A.T.S.${attackData.isReroll ? " · RE-ROLL" : ""}</span>
				<span class="vats-verdict ${verdict.hit ? "hit" : "miss"}">${verdict.hit ? "HIT" : "MISS"}</span>
				${this.#retargetButton(message)}
			</div>
			<div class="vats-detail">
				<span class="vats-stat">${verdict.successes} success${verdict.successes === 1 ? "" : "es"}</span>
				<span class="vats-vs">vs</span>
				${difficultyControl}
				${bankButton}
			</div>`;
		html.querySelector(".message-content")?.appendChild(strip);

		this.#wireRetarget(message, strip);
		strip.querySelector(".vats-difficulty")?.addEventListener("change", (event) => {
			// Stored on the message so every client re-renders the verdict.
			message.update({ [`flags.${MODULE_ID}.difficulty`]: Number(event.currentTarget.value) });
		});
		strip.querySelector(".vats-bank:not([disabled])")?.addEventListener("click", async (event) => {
			event.currentTarget.disabled = true;
			// adjustAP self-routes non-GM users through the system socket.
			fallout.APTrackerV2?.adjustAP(pool, verdict.ap);
			await message.update({ [`flags.${MODULE_ID}.apBanked`]: true });
		});
	}

	/* ---------------------------------------------------------------------- */
	/*  APPLY block on damage cards                                            */
	/* ---------------------------------------------------------------------- */

	static #renderApplyBlock(message, html) {
		const falloutRoll = message.flags?.falloutroll;
		const weapon = message.flags?.weapon;
		if (falloutRoll?.diceFace !== "d6" || !weapon) return;

		const context = this.#resolveContext(message);
		if (!context.targets.length) {
			// Nothing to apply to, but the roll can still be re-aimed — which is
			// the recovery path for a damage roll made without a target.
			if (!this.#canRetarget()) return;
			const empty = document.createElement("div");
			empty.className = "vats-block";
			empty.innerHTML = `
				<div class="vats-hdr">
					<span class="vats-title">V.A.T.S.</span>
					<span class="vats-loc">no target</span>
					${this.#retargetButton(message)}
				</div>`;
			html.querySelector(".message-content")?.appendChild(empty);
			this.#wireRetarget(message, empty);
			return;
		}

		const types = Object.keys(weapon.system?.damage?.damageType ?? {})
			.filter((t) => weapon.system.damage.damageType[t]);
		if (!types.length) types.push("physical");

		const block = document.createElement("div");
		block.className = "vats-block";
		html.querySelector(".message-content")?.appendChild(block);
		this.#buildBlock(message, block, context, types, types[0]);
	}

	/** Location + target list for a damage card: the card's own stamped
	 *  targets, else the matching attack card's, else the user's live targets.
	 *  Location comes from the most recent attack card by the same user (the
	 *  system creates damage cards from an actor UUID string, so their
	 *  speaker.actor is unreliable — the rolling user is the stable link). */
	static #resolveContext(message) {
		let locationKey = "torso";
		let locationSource = "assumed";
		let attackTargets = null;
		let attackVerdict = null;

		const authorId = message.author?.id ?? message.user?.id;
		const speakerActor = message.speaker?.actor;
		const messages = game.messages.contents;
		let idx = messages.indexOf(message);
		if (idx === -1) idx = messages.length;
		for (let i = idx - 1, seen = 0; i >= 0 && seen < 30; i--, seen++) {
			const m = messages[i];
			if (m.flags?.falloutroll?.diceFace !== "d20") continue;
			const mAuthor = m.author?.id ?? m.user?.id;
			const sameAuthor = authorId && mAuthor === authorId;
			const sameSpeaker = speakerActor && m.speaker?.actor === speakerActor;
			if (!sameAuthor && !sameSpeaker) continue;
			// Resolve through re-roll cards so the LATEST roll of the attack
			// decides the verdict; skip unrelated skill checks.
			const attackData = this.#attackDataFor(m);
			if (!attackData) continue;
			locationKey = locationKeyForResult(attackData.hitLocationResult);
			locationSource = "rolled";
			attackTargets = attackData.targets;
			attackVerdict = this.#attackVerdict(m, attackData);
			break;
		}

		const uuids = message.flags?.[MODULE_ID]?.targets
			?? attackTargets
			?? [...game.user.targets].map((t) => t.document?.uuid).filter(Boolean);

		const targets = uuids
			.map((uuid) => {
				const doc = fromUuidSync(uuid);
				const actor = doc?.actor ?? doc;
				return actor ? { uuid, actor } : null;
			})
			.filter(Boolean);

		return { locationKey, locationSource, targets, attackVerdict };
	}

	static #buildBlock(message, block, context, types, chosenType) {
		const falloutRoll = message.flags.falloutroll;
		const weapon = message.flags.weapon;
		const damage = Number(falloutRoll.damage) || 0;
		const effects = Number(falloutRoll.effects) || 0;
		const isGM = game.user.isGM;

		const damageEffects = weapon.system?.damage?.damageEffect ?? {};
		const piercing = damageEffects.piercing_x?.value
			? (Number(damageEffects.piercing_x.rank) || 1) * effects
			: 0;
		const radioactive = damageEffects.radioactive?.value ? effects : 0;
		const stun = !!(damageEffects.stun?.value && effects > 0);
		// Persistent: the target suffers THE WEAPON'S DAMAGE again at the end
		// of each of its next N turns, where N is the number of Effects rolled
		// (Effects are the duration, not the damage). Damage resistance is not
		// waived by the effect, so each tick goes through DR like any other.
		const persistRounds = damageEffects.persistent?.value && effects > 0 ? effects : 0;
		// Effects V.A.T.S. can't adjudicate get reminder chips for the GM.
		const manualEffects = ["burst", "spread", "breaking", "freeze", "arc", "tranquilize_x"]
			.filter((key) => damageEffects[key]?.value && effects > 0)
			.map((key) => key.replace(/_x$/, "").toUpperCase());
		const ablation = game.settings.get(MODULE_ID, "vatsPaAblation");

		const typePicker = types.length > 1
			? `<select class="vats-type">${types.map((t) =>
				`<option value="${t}"${t === chosenType ? " selected" : ""}>${TYPE_LABELS[t] ?? t}</option>`).join("")}</select>`
			: `<span class="vats-type-fixed">${TYPE_LABELS[chosenType] ?? chosenType}</span>`;

		const rows = context.targets.map(({ uuid, actor }) => {
			const drPath = `system.body_parts.${context.locationKey}.resistance`;
			const dr = Number(foundry.utils.getProperty(actor, `${drPath}.${chosenType}`) ?? 0);
			const effDr = Math.max(0, dr - piercing);
			const final = Math.max(0, damage - effDr);
			// Radioactive's rads are applied separately, and radiation
			// resistance reduces them.
			const radDr = radioactive
				? Number(foundry.utils.getProperty(actor, `${drPath}.radiation`) ?? 0)
				: 0;
			const finalRads = Math.max(0, radioactive - radDr);

			// Power armor ablates: a powered piece covering the location soaks
			// damage into its own health first, and only the overflow reaches
			// the wearer.
			const paPiece = ablation
				&& actor.system?.outfittedLocations?.[context.locationKey]?.system
					?.apparelType === "powerArmor"
				? actor.system.outfittedLocations[context.locationKey]
				: null;
			const paHp = paPiece ? Number(paPiece.system.health?.value ?? 0) : 0;
			const paAbsorb = paPiece ? Math.min(final, paHp) : 0;
			const toWearer = final - paAbsorb;

			return `
				<div class="vats-row" data-uuid="${uuid}" data-hp="${toWearer}" data-rads="${finalRads}"
					data-loc="${context.locationKey}" data-stun="${stun ? 1 : 0}"
					data-persist-rounds="${persistRounds}" data-persist-dmg="${damage}"
					data-type="${chosenType}"
					data-pa-id="${paPiece?._id ?? ""}" data-pa-absorb="${paAbsorb}">
					<div class="vats-row-head">
						<span class="vats-name">${foundry.utils.escapeHTML(actor.name)}</span>
						${isGM ? '<button type="button" class="vats-apply">APPLY</button>' : ""}
					</div>
					<div class="vats-math">${damage} &minus; ${effDr} DR${piercing ? ` (pierced ${piercing})` : ""}
						&rarr; <strong>${final}</strong>${paPiece
							? ` <span class="vats-pa">&middot; armor soaks ${paAbsorb} (${paHp}&rarr;${paHp - paAbsorb})</span> &rarr; wearer <strong>${toWearer}</strong>`
							: ""}${radioactive
							? ` <em>+${finalRads} rads${radDr ? ` (${radioactive} &minus; ${radDr} RAD DR)` : ""}</em>`
							: ""}</div>
				</div>`;
		}).join("");

		const missed = context.attackVerdict && !context.attackVerdict.hit;
		block.innerHTML = `
			<div class="vats-hdr">
				<span class="vats-title">V.A.T.S.</span>
				<span class="vats-loc">${LOCATION_LABELS[context.locationKey]}${context.locationSource === "assumed" ? " (assumed)" : ""}</span>
				${missed ? '<span class="vats-verdict miss">MISSED</span>' : ""}
				${this.#retargetButton(message)}
				${typePicker}
			</div>
			${manualEffects.length
				? `<div class="vats-chips">${manualEffects.map((e) => `<span class="vats-chip">${e}</span>`).join("")}</div>`
				: ""}
			${rows}
			${isGM && context.targets.length > 1
				? '<button type="button" class="vats-apply-all">APPLY TO ALL</button>' : ""}`;

		this.#wireRetarget(message, block);
		block.querySelector(".vats-type")?.addEventListener("change", (event) => {
			this.#buildBlock(message, block, context, types, event.currentTarget.value);
		});
		const rowArgs = (row) => ({
			targetUuid: row.dataset.uuid,
			hp: Number(row.dataset.hp),
			rads: Number(row.dataset.rads),
			locationKey: row.dataset.loc,
			stun: row.dataset.stun === "1",
			persistRounds: Number(row.dataset.persistRounds) || 0,
			persistDamage: Number(row.dataset.persistDmg) || 0,
			damageType: row.dataset.type,
			paItemId: row.dataset.paId || null,
			paAbsorb: Number(row.dataset.paAbsorb) || 0,
			sourceName: falloutRoll.rollname,
		});
		for (const button of block.querySelectorAll(".vats-apply")) {
			button.addEventListener("click", (event) => {
				const row = event.currentTarget.closest(".vats-row");
				event.currentTarget.disabled = true;
				this.#applyToTarget(rowArgs(row));
			});
		}
		block.querySelector(".vats-apply-all")?.addEventListener("click", async (event) => {
			event.currentTarget.disabled = true;
			for (const row of block.querySelectorAll(".vats-row")) {
				row.querySelector(".vats-apply")?.setAttribute("disabled", "");
				await this.#applyToTarget(rowArgs(row));
			}
		});
	}

	/* ---------------------------------------------------------------------- */
	/*  Application + undo (GM client only)                                    */
	/* ---------------------------------------------------------------------- */

	static async #applyToTarget({
		targetUuid, hp, rads, locationKey, sourceName,
		stun = false, persistDamage = 0, persistRounds = 0, damageType = "physical",
		paItemId = null, paAbsorb = 0,
	}) {
		if (!game.user.isGM) return;
		const doc = await fromUuid(targetUuid);
		const actor = doc?.actor ?? doc;
		if (!actor) {
			ui.notifications?.warn("V.A.T.S.: target no longer exists.");
			return;
		}
		const prev = {
			hp: actor.system.health?.value ?? 0,
			rads: actor.system.radiation ?? 0,
		};
		const newHp = Math.max(0, prev.hp - hp);
		const update = { "system.health.value": newHp };
		if (rads) update["system.radiation"] = prev.rads + rads;

		// Power armor ablates first: the covering piece loses health before the
		// wearer does (the wearer's `hp` is already the overflow).
		let armorNote = "";
		const paItem = paItemId && paAbsorb > 0 ? actor.items.get(paItemId) : null;
		if (paItem) {
			const paPrev = Number(paItem.system.health?.value ?? 0);
			const paNew = Math.max(0, paPrev - paAbsorb);
			prev.pa = { itemId: paItemId, value: paPrev };
			await paItem.update({ "system.health.value": paNew });
			armorNote = ` <strong>${foundry.utils.escapeHTML(paItem.name)}</strong> ${paPrev} &rarr; ${paNew}.`;
			if (paNew === 0 && paPrev > 0) armorNote += " <strong>Armor breached.</strong>";
		}

		// Injury rule: 5+ damage past resistances to one location, or reaching
		// 0 HP. Prompt rather than auto-mark — the injury table is a GM call.
		let injuryNote = "";
		if (game.settings.get(MODULE_ID, "vatsInjuries")
			&& (hp >= 5 || newHp === 0)
			&& actor.system.body_parts?.[locationKey]) {
			const label = LOCATION_LABELS[locationKey] ?? locationKey;
			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: "V.A.T.S. — Injury" },
				content: `<p><strong>${foundry.utils.escapeHTML(actor.name)}</strong> took `
					+ `${hp >= 5 ? `${hp} damage to the ${label}` : "damage reducing them to 0 HP"}. `
					+ `Mark an open injury on the ${label}?</p>`,
				rejectClose: false,
			});
			if (confirmed) {
				// PC and robot sheets track injuries as an array of slots;
				// NPC and creature sheets track open/treated COUNTS instead —
				// writing the array does nothing visible for them.
				if (["character", "robot"].includes(actor.type)) {
					const injuries = foundry.utils.duplicate(
						actor.system.body_parts[locationKey].injuries ?? []);
					const slot = injuries.indexOf(0);
					if (slot === -1) {
						ui.notifications?.warn(`${actor.name} has no free injury slots on the ${label}.`);
					} else {
						prev.injuries = { locationKey, values: foundry.utils.duplicate(
							actor.system.body_parts[locationKey].injuries) };
						injuries[slot] = 2; // open injury
						update[`system.body_parts.${locationKey}.injuries`] = injuries;
						injuryNote = ` <strong>Injury</strong> marked on the ${label}.`;
					}
				} else {
					const prevOpen = Number(
						actor.system.body_parts[locationKey].injuryOpenCount ?? 0);
					prev.injuryCount = { locationKey, value: prevOpen };
					update[`system.body_parts.${locationKey}.injuryOpenCount`] = prevOpen + 1;
					injuryNote = ` <strong>Injury</strong> marked on the ${label}.`;
				}
			}
		}

		await actor.update(update);

		let conditionNote = "";

		// Stun: toggle the system's Stunned status (an Active Effect).
		if (stun) {
			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: "V.A.T.S. — Stun" },
				content: `<p>The weapon has the <strong>Stun</strong> effect and rolled Effects. `
					+ `Apply the Stunned condition to ${foundry.utils.escapeHTML(actor.name)}?</p>`,
				rejectClose: false,
			});
			if (confirmed) {
				await actor.toggleStatusEffect?.("stunned", { active: true });
				prev.stunned = true;
				conditionNote += " <strong>Stunned.</strong>";
			}
		}

		// Persistent: the weapon's damage recurs at the end of each of the
		// target's next N turns (N = Effects rolled). Tracked on the target;
		// the GM is prompted as each turn ends.
		if (persistRounds > 0 && persistDamage > 0) {
			const confirmed = await foundry.applications.api.DialogV2.confirm({
				window: { title: "V.A.T.S. — Persistent" },
				content: `<p>The weapon has the <strong>Persistent</strong> effect. Track `
					+ `<strong>${persistDamage}</strong> ${TYPE_LABELS[damageType] ?? damageType} damage `
					+ `recurring at the end of ${foundry.utils.escapeHTML(actor.name)}'s next `
					+ `<strong>${persistRounds}</strong> turn${persistRounds === 1 ? "" : "s"} `
					+ `(damage resistance still applies)?</p>`,
				rejectClose: false,
			});
			if (confirmed) {
				const list = foundry.utils.duplicate(actor.getFlag(MODULE_ID, "persistent") ?? []);
				const id = foundry.utils.randomID();
				list.push({
					id, damage: persistDamage, rounds: persistRounds,
					type: damageType, locationKey, sourceName,
				});
				await actor.setFlag(MODULE_ID, "persistent", list);
				prev.persistentId = id;
				conditionNote += ` <strong>Persistent</strong> ${persistDamage} for ${persistRounds} round${persistRounds === 1 ? "" : "s"}.`;
			}
		}

		await ChatMessage.create({
			speaker: { alias: "V.A.T.S." },
			content: `<div class="vats-outcome">
				<strong>${foundry.utils.escapeHTML(actor.name)}</strong> takes
				<strong>${hp}</strong> damage${rads ? ` and <strong>${rads}</strong> rads` : ""}
				(${foundry.utils.escapeHTML(sourceName ?? "damage")}).${armorNote}
				HP ${prev.hp} &rarr; ${newHp}.${injuryNote}${conditionNote}
				<button type="button" class="vats-undo">UNDO</button>
			</div>`,
			flags: { [MODULE_ID]: { vatsUndo: { targetUuid, prev } } },
		});
	}

	/* ---------------------------------------------------------------------- */
	/*  Persistent damage — combat turn prompts                                */
	/* ---------------------------------------------------------------------- */

	/** Persistent damage lands at the END of the target's turn, so this fires
	 *  on the combatant whose turn just ended (the hook's `prior` position).
	 *  Whispers the GM one prompt card per tracked entry. GM client only. */
	static async onCombatTurnChange(combat, prior) {
		if (!this.enabled || !game.users.activeGM?.isSelf) return;
		const combatant = prior?.combatantId
			? combat?.combatants.get(prior.combatantId)
			: null;
		const actor = combatant?.actor;
		if (!actor) return;
		const entries = actor.getFlag(MODULE_ID, "persistent") ?? [];
		if (!entries.length) return;
		const targetUuid = combatant.token?.uuid ?? actor.uuid;
		const gmIds = game.users.filter((u) => u.isGM).map((u) => u.id);
		for (const entry of entries) {
			const remaining = Number(entry.rounds ?? 1);
			await ChatMessage.create({
				speaker: { alias: "V.A.T.S." },
				whisper: gmIds,
				content: `<div class="vats-outcome">
					<strong>${foundry.utils.escapeHTML(actor.name)}</strong> — persistent
					<strong>${entry.damage}</strong> ${TYPE_LABELS[entry.type] ?? entry.type} damage
					(${foundry.utils.escapeHTML(entry.sourceName ?? "unknown source")}),
					${remaining} round${remaining === 1 ? "" : "s"} left.
					<button type="button" class="vats-persist-apply">APPLY</button>
					<button type="button" class="vats-persist-end">END EFFECT</button>
				</div>`,
				flags: { [MODULE_ID]: { vatsPersist: { targetUuid, entry } } },
			});
		}
	}

	static #wirePersist(message, html) {
		const persist = message.flags?.[MODULE_ID]?.vatsPersist;
		if (!persist || !game.user.isGM) return;
		const applyButton = html.querySelector(".vats-persist-apply");
		const endButton = html.querySelector(".vats-persist-end");
		if (message.flags?.[MODULE_ID]?.vatsPersistDone) {
			applyButton?.setAttribute("disabled", "");
			endButton?.setAttribute("disabled", "");
			return;
		}
		applyButton?.addEventListener("click", async () => {
			applyButton.disabled = true;
			const { targetUuid, entry } = persist;
			const doc = await fromUuid(targetUuid);
			const actor = doc?.actor ?? doc;
			if (!actor) return;
			// Persistent damage goes through DR at the original location.
			const dr = Number(foundry.utils.getProperty(actor,
				`system.body_parts.${entry.locationKey}.resistance.${entry.type}`) ?? 0);
			await this.#applyToTarget({
				targetUuid,
				hp: Math.max(0, entry.damage - dr),
				rads: 0,
				locationKey: entry.locationKey,
				damageType: entry.type,
				sourceName: `${entry.sourceName ?? "Persistent"} (persistent)`,
			});
			// Burn a round; the effect ends when its duration runs out.
			const list = foundry.utils.duplicate(actor.getFlag(MODULE_ID, "persistent") ?? []);
			const tracked = list.find((e) => e.id === entry.id);
			if (tracked) {
				tracked.rounds = Number(tracked.rounds ?? 1) - 1;
				const remaining = list.filter((e) => Number(e.rounds ?? 0) > 0);
				await actor.setFlag(MODULE_ID, "persistent", remaining);
				if (tracked.rounds <= 0) {
					ui.notifications?.info(`V.A.T.S.: persistent damage on ${actor.name} has run its course.`);
				}
			}
			await message.update({ [`flags.${MODULE_ID}.vatsPersistDone`]: true });
		});
		endButton?.addEventListener("click", async () => {
			endButton.disabled = true;
			const { targetUuid, entry } = persist;
			const doc = await fromUuid(targetUuid);
			const actor = doc?.actor ?? doc;
			if (!actor) return;
			const list = (actor.getFlag(MODULE_ID, "persistent") ?? [])
				.filter((e) => e.id !== entry.id);
			await actor.setFlag(MODULE_ID, "persistent", list);
			await message.update({ [`flags.${MODULE_ID}.vatsPersistDone`]: true });
			ui.notifications?.info(`V.A.T.S.: persistent damage on ${actor.name} ended.`);
		});
	}

	static #wireUndo(message, html) {
		const undoData = message.flags?.[MODULE_ID]?.vatsUndo;
		const button = html.querySelector(".vats-undo");
		if (!undoData || !button) return;
		if (!game.user.isGM || message.flags?.[MODULE_ID]?.vatsUndone) {
			button.disabled = true;
			return;
		}
		button.addEventListener("click", async () => {
			button.disabled = true;
			const doc = await fromUuid(undoData.targetUuid);
			const actor = doc?.actor ?? doc;
			if (!actor) return;
			const restore = {
				"system.health.value": undoData.prev.hp,
				"system.radiation": undoData.prev.rads,
			};
			if (undoData.prev.injuries) {
				restore[`system.body_parts.${undoData.prev.injuries.locationKey}.injuries`] =
					undoData.prev.injuries.values;
			}
			if (undoData.prev.injuryCount) {
				restore[`system.body_parts.${undoData.prev.injuryCount.locationKey}.injuryOpenCount`] =
					undoData.prev.injuryCount.value;
			}
			await actor.update(restore);
			if (undoData.prev.pa) {
				await actor.items.get(undoData.prev.pa.itemId)
					?.update({ "system.health.value": undoData.prev.pa.value });
			}
			if (undoData.prev.stunned) {
				await actor.toggleStatusEffect?.("stunned", { active: false });
			}
			if (undoData.prev.persistentId) {
				const list = (actor.getFlag(MODULE_ID, "persistent") ?? [])
					.filter((e) => e.id !== undoData.prev.persistentId);
				await actor.setFlag(MODULE_ID, "persistent", list);
			}
			await message.update({ [`flags.${MODULE_ID}.vatsUndone`]: true });
			ui.notifications?.info(`V.A.T.S.: restored ${actor.name}.`);
		});
	}
}
