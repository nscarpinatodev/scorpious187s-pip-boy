import { MODULE_ID } from "./constants.mjs";
import { PipBoyApp } from "./PipBoyApp.mjs";
import { PerkEffects } from "./perk-effects.mjs";

const TEMPLATE = `modules/${MODULE_ID}/templates/level-up.hbs`;

/** SPECIAL keys and their labels, for the attribute picker. */
const SPECIAL_KEYS = [
	["str", "Strength"], ["per", "Perception"], ["end", "Endurance"],
	["cha", "Charisma"], ["int", "Intelligence"], ["agi", "Agility"],
	["luc", "Luck"],
];

/**
 * Ordered wizard steps. The perk comes before skills because a perk can grant
 * extra skill ranks — Tag! — and those have to be in the pool before the
 * player spends it. The effect step is skipped when no perk was taken.
 */
const STEPS = ["welcome", "perk", "effect", "skills", "confirm"];

/**
 * The level-up wizard, drawn over the Pip-Boy's CRT rather than in a window of
 * its own — levelling up happens on the Pip-Boy screen in the games, and the
 * casing's lower readout is right there for perk descriptions.
 *
 * What a level grants (all configurable, see the `levelUp*` settings):
 *   - skill ranks, spent freely across skills up to a rank cap;
 *   - one perk, chosen from those whose requirements the character meets;
 *   - +1 maximum HP, which is NOT written — the system derives max HP as
 *     `END + LUC + (level - 1) - radiation + bonus`, so raising the level does
 *     it. The wizard only shows the consequence.
 */
export class PipBoyLevelUp {
	#app;

	/** The overlay element, while open. */
	#el = null;

	/** Eligible perks as `{item, rank}`, or null until the compendium loads. */
	#perks = null;

	/** Set when the perk compendium could not be read. */
	#perkError = false;

	#state = {
		step: "welcome",
		/** Extra skill points for this level only — a Tag!-style grant. */
		bonus: 0,
		/** skill item id -> ranks added this level */
		spent: {},
		/** compendium perk id, or null */
		perkId: null,
		/** The effect definition for the chosen perk, once resolved. */
		effect: null,
		/** SPECIAL key chosen for an attribute effect. */
		effectAttr: "str",
		/** Skill item id chosen for a tag. */
		effectSkillId: null,
		/** Show the hand-built effect form rather than the preset summary. */
		effectCustom: false,
		/** Remember the definition against this perk for next time. */
		effectRemember: true,
	};

	constructor(app) {
		this.#app = app;
	}

	get actor() {
		return this.#app.actor;
	}

	get rendered() {
		return !!this.#el;
	}

	/* -------------------------------------------- */
	/*  Rules                                        */
	/* -------------------------------------------- */

	/** Has this character banked enough XP for the next level? */
	static isReady(actor) {
		const level = actor?.system?.level;
		if (!level) return false;
		const next = Number(level.nextLevelXP) || 0;
		// A threshold of 0 means the GM has turned off the automatic XP target,
		// in which case levelling is their call and the button stays dark.
		return next > 0 && (Number(level.currentXP) || 0) >= next;
	}

	static get skillPoints() {
		return Math.max(0, Number(game.settings.get(MODULE_ID, "levelUpSkillPoints")) || 0);
	}

	static get skillCap() {
		return Math.max(1, Number(game.settings.get(MODULE_ID, "levelUpSkillCap")) || 6);
	}

	static get specialCap() {
		return Math.max(1, Number(game.settings.get(MODULE_ID, "levelUpSpecialCap")) || 10);
	}

	/**
	 * Re-check a perk's requirements against this character.
	 *
	 * The system's perk manager already filters the list, but it says nothing
	 * about *why* a perk qualifies, it never checks the species flags, and its
	 * level test reads `playerLevel < requirements.level ?? 1` — where `<` binds
	 * tighter than `??`, so the fallback is dead code. Checking here means the
	 * requirements can be shown on the row and a disagreement can be caught.
	 *
	 * @param {object} item   The compendium index entry for the perk.
	 * @param {number} rank   The rank that would be gained.
	 * @returns {{met: boolean, chips: object[], blocker: string}}
	 */
	#checkRequirements(item, rank) {
		const actor = this.actor;
		const req = item.system?.requirementsEx ?? {};
		const nextLevel = (Number(actor.system?.level?.value) || 1) + 1;
		const chips = [];
		let blocker = "";

		// Multi-rank perks raise their level requirement per rank.
		const step = Number(req.levelIncrease) || 0;
		const needLevel = (Number(req.level) || 1) + ((rank - 1) * step);
		const levelOk = nextLevel >= needLevel;
		chips.push({ label: `LVL ${needLevel}`, ok: levelOk });
		if (!levelOk) blocker = `needs level ${needLevel}`;

		for (const [key, value] of Object.entries(req.attributes ?? {})) {
			const need = Number(value?.value) || 0;
			if (!need) continue;
			const has = Number(actor.system?.attributes?.[key]?.value) || 0;
			const ok = has >= need;
			chips.push({ label: `${key.toUpperCase()} ${need}`, ok });
			if (!ok && !blocker) blocker = `needs ${key.toUpperCase()} ${need}`;
		}

		const magazines = req.magazineUuids ?? [];
		if (magazines.length) {
			const read = actor.system?.readMagazines ?? [];
			const ok = magazines.every((uuid) => read.includes(uuid));
			chips.push({ label: magazines.length > 1 ? "MAGAZINES" : "MAGAZINE", ok });
			if (!ok && !blocker) blocker = "a required magazine has not been read";
		}

		// The only species flag the system can actually answer for.
		if (req.notRobot && actor.isRobot) {
			chips.push({ label: "NOT ROBOTS", ok: false });
			if (!blocker) blocker = "not available to robots";
		}

		return { met: !blocker, chips, blocker };
	}

	get pointsTotal() {
		return PipBoyLevelUp.skillPoints + this.#state.bonus + this.#effectPoints;
	}

	/** Extra ranks the perk adds to the *free* pool. A perk that tags a skill
	 *  puts its ranks into that skill instead — Tag! reads "increase the skill's
	 *  rank by 2", not "gain 2 ranks to spend". */
	get #effectPoints() {
		if (this.#state.effect?.tagSkill) return 0;
		return Math.max(0, Number(this.#state.effect?.skillPoints) || 0);
	}

	/** Ranks going straight into the tagged skill, as `{skillId, ranks}`. */
	#tagGrant() {
		const definition = this.#state.effect;
		const id = this.#state.effectSkillId;
		if (!definition?.tagSkill || !id) return null;
		const ranks = Math.max(0, Number(definition.skillPoints) || 0);
		if (!ranks) return null;
		const skill = this.actor.items.get(id);
		if (!skill) return null;
		// "to a maximum of 6" — the same cap the free pool respects.
		const current = Number(skill.system?.value) || 0;
		const room = Math.max(0, PipBoyLevelUp.skillCap - current);
		return room ? { skillId: id, ranks: Math.min(ranks, room) } : null;
	}

	/** Steps actually shown: the effect step only exists with a perk chosen. */
	get #steps() {
		return this.#state.perkId ? STEPS : STEPS.filter((step) => step !== "effect");
	}

	get pointsSpent() {
		return Object.values(this.#state.spent).reduce((sum, n) => sum + n, 0);
	}

	get pointsLeft() {
		return this.pointsTotal - this.pointsSpent;
	}

	/* -------------------------------------------- */
	/*  Lifecycle                                    */
	/* -------------------------------------------- */

	async open() {
		if (this.#el) return;
		const screen = this.#app.element?.querySelector(".pipboy-screen");
		if (!screen) return;

		this.#el = document.createElement("div");
		this.#el.className = "pipboy-levelup";
		// Bound here, not in render(): the container outlives each render, so
		// re-binding would stack one handler per render.
		this.#el.addEventListener("click", (event) => this.#onClick(event));
		screen.appendChild(this.#el);

		await this.render();
		// The perk list means reading the whole perks compendium; do it behind
		// the first screen so the wizard opens instantly.
		this.#loadPerks();
	}

	close() {
		this.#el?.remove();
		this.#el = null;
	}

	/** Re-attach after the sheet re-renders and rebuilds the screen. */
	reattach() {
		if (!this.#el || this.#el.isConnected) return;
		this.#app.element?.querySelector(".pipboy-screen")?.appendChild(this.#el);
	}

	/**
	 * Build the perk list from the whole compendium rather than the system's
	 * `getAvailablePerks`, which *filters out* everything whose requirements
	 * aren't met — so a player could never see what they were working towards.
	 * Requirements are checked here instead and shown on every row.
	 *
	 * Perks already at their maximum rank are still dropped: there is nothing
	 * left to take.
	 */
	async #loadPerks() {
		try {
			const all = await globalThis.fallout?.compendiums?.perks?.();
			if (!all) throw new Error("the system exposes no perk compendium");

			const owned = new Map();
			for (const item of this.actor.items) {
				if (item.type !== "perk") continue;
				owned.set(item.name.slugify(), Number(item.system?.rank?.value) || 0);
			}

			const list = new foundry.utils.Collection();
			for (const item of all) {
				const max = Number(item.system?.rank?.max) || 1;
				const have = owned.get(item.name.slugify()) ?? 0;
				if (have >= max) continue;
				list.set(item._id, { item, rank: have + 1 });
			}
			this.#perks = list;
		}
		catch (err) {
			console.error(`${MODULE_ID} | could not read available perks`, err);
			this.#perkError = true;
			this.#perks = null;
		}
		if (this.#el) await this.render();
	}

	/* -------------------------------------------- */
	/*  Rendering                                    */
	/* -------------------------------------------- */

	async render() {
		if (!this.#el) return;
		// Rebuilding the body resets its scroll, which would throw the player
		// back to the top of the skill list on every point they spend.
		const scroll = this.#el.querySelector(".pip-lu-body")?.scrollTop ?? 0;
		const context = this.#prepareContext();
		this.#el.innerHTML = await foundry.applications.handlebars.renderTemplate(
			TEMPLATE, context,
		);
		const body = this.#el.querySelector(".pip-lu-body");
		if (body) body.scrollTop = scroll;
		this.#attachListeners();
	}

	#prepareContext() {
		const actor = this.actor;
		const sys = actor.system ?? {};
		const level = Number(sys.level?.value) || 1;
		const cap = PipBoyLevelUp.skillCap;
		const spent = this.#state.spent;

		const grant = this.#tagGrant();
		const skills = actor.items
			.filter((i) => i.type === "skill")
			.map((i) => {
				const rank = Number(i.system?.value) || 0;
				const fromPool = spent[i.id] ?? 0;
				// The perk's own ranks count towards the cap but can't be moved.
				const fromPerk = grant?.skillId === i.id ? grant.ranks : 0;
				const added = fromPool + fromPerk;
				return {
					id: i.id,
					name: i.name,
					attribute: (i.system?.defaultAttribute ?? "").toUpperCase(),
					tagged: i.system?.tag === true || grant?.skillId === i.id,
					rank,
					added,
					fromPerk,
					newRank: rank + added,
					canAdd: this.pointsLeft > 0 && (rank + added) < cap,
					canRemove: fromPool > 0,
					atCap: (rank + added) >= cap,
				};
			})
			.sort((a, b) => a.name.localeCompare(b.name));

		const perks = [...(this.#perks?.values() ?? [])]
			.map(({ item, rank }) => {
				const check = this.#checkRequirements(item, rank);
				return {
					id: item._id,
					name: item.name,
					img: item.img,
					rank,
					multiRank: (item.system?.rank?.max ?? 1) > 1,
					rankMax: item.system?.rank?.max ?? 1,
					selected: this.#state.perkId === item._id,
					caveat: PipBoyLevelUp.#caveat(item),
					chips: check.chips,
					met: check.met,
					blocker: check.blocker,
				};
			})
			.sort((a, b) => (b.met - a.met) || a.name.localeCompare(b.name));

		const chosenSkills = skills.filter((s) => s.added > 0);
		const chosenPerk = perks.find((p) => p.selected) ?? null;

		const visible = this.#steps;
		const stepIndex = visible.indexOf(this.#state.step);
		const effect = this.#state.effect;
		const target = PerkEffects.target(effect?.target);
		// The effect adds to the *current* value, and that value already includes
		// any earlier Intense Training, so the cap is checked against it.
		const specialCap = PipBoyLevelUp.specialCap;
		const attrs = SPECIAL_KEYS.map(([key, label]) => {
			const value = Number(actor.system?.attributes?.[key]?.value) || 0;
			return {
				key,
				label,
				value,
				atCap: value >= specialCap,
				selected: this.#state.effectAttr === key,
			};
		});
		const effectSkill = this.#state.effectSkillId
			? actor.items.get(this.#state.effectSkillId)
			: null;
		const choice = {
			attr: this.#state.effectAttr,
			label: SPECIAL_KEYS.find(([k]) => k === this.#state.effectAttr)?.[1],
			skillName: effectSkill?.name,
		};

		return {
			step: this.#state.step,
			isStep: Object.fromEntries(STEPS.map((s) => [s, this.#state.step === s])),
			steps: visible.map((s, i) => ({ done: i < stepIndex, here: i === stepIndex })),
			level,
			newLevel: level + 1,
			currentXP: Number(sys.level?.currentXP) || 0,
			nextLevelXP: Number(sys.level?.nextLevelXP) || 0,
			hpMax: Number(sys.health?.max) || 0,
			newHpMax: (Number(sys.health?.max) || 0) + 1,
			cap,
			bonus: this.#state.bonus,
			pointsTotal: this.pointsTotal,
			pointsSpent: this.pointsSpent,
			pointsLeft: this.pointsLeft,
			skills,
			perks,
			perksLoading: this.#perks === null && !this.#perkError,
			perkError: this.#perkError,
			noPerks: !!this.#perks && perks.length === 0,
			eligibleCount: perks.filter((p) => p.met).length,
			lockedCount: perks.filter((p) => !p.met).length,
			noEligible: !!this.#perks && perks.length > 0 && !perks.some((p) => p.met),
			chosenSkills,
			chosenPerk,
			unspent: this.pointsLeft,

			// Effect step
			effect,
			effectTargets: PerkEffects.targets.map((t) => ({
				...t, selected: t.key === effect?.target,
			})),
			effectAttrs: attrs,
			specialCap,
			specialAtCap: !!(target?.askAttribute
				&& attrs.find((a) => a.key === this.#state.effectAttr)?.atCap),
			allSpecialsCapped: !!target?.askAttribute && attrs.every((a) => a.atCap),
			effectAsksAttr: !!target?.askAttribute,
			effectAsksSkill: !!effect?.tagSkill,
			effectIsCustomKey: effect?.target === "custom",
			effectSkillId: this.#state.effectSkillId,
			effectSkills: skills.map((sk) => ({
				...sk, chosen: sk.id === this.#state.effectSkillId,
			})),
			effectCustom: this.#state.effectCustom,
			effectRemember: this.#state.effectRemember,
			canRemember: PerkEffects.canSave,
			effectKnown: !!effect,
			effectSaved: effect?.saved === true,
			effectSummary: PerkEffects.describe(effect, choice),
			effectPoints: this.#effectPoints,
		};
	}

	/** Requirements the system records but cannot check, shown as a caveat so a
	 *  player doesn't take a perk their character can't have. The system has no
	 *  species field — `origin` is free text — so these stay advisory. */
	static #caveat(item) {
		const req = item.system?.requirementsEx ?? {};
		const notes = [];
		if (req.notGhoul) notes.push("not ghouls");
		if (req.notHuman) notes.push("not humans");
		if (req.notRobot) notes.push("not robots");
		if (req.notSupermutant) notes.push("not super mutants");
		if (req.notRadiationImmune) notes.push("not radiation-immune");
		if (req.isCompanion) notes.push("companions only");
		return notes.length ? notes.join(", ") : "";
	}

	/* -------------------------------------------- */
	/*  Interaction                                  */
	/* -------------------------------------------- */

	#onClick(event) {
		const target = event.target.closest("[data-lu]");
		if (!target || target.disabled) return;
		event.preventDefault();
		event.stopPropagation();
		this.#onAction(target.dataset.lu, target);
	}

	/** Rows are rebuilt each render, so their hover listeners are too. Hovering
	 *  a perk writes its description into the casing's lower readout, the same
	 *  panel items and skills use. */
	#attachListeners() {
		for (const row of this.#el?.querySelectorAll(".pip-lu-perk") ?? []) {
			row.addEventListener("pointerenter", () => this.#showPerkInfo(row.dataset.perkId));
		}

		// Effect builder fields. Selects re-render (the form's shape depends on
		// them); free-text fields write through without one, so typing isn't
		// interrupted mid-word.
		for (const el of this.#el?.querySelectorAll("[data-lu-field]") ?? []) {
			const field = el.dataset.luField;
			const rerender = el.tagName === "SELECT";
			el.addEventListener(rerender ? "change" : "input", (event) => {
				const value = event.currentTarget.value;
				if (field === "effectAttr") this.#state.effectAttr = value;
				else if (field === "effectSkillId") this.#state.effectSkillId = value || null;
				else this.#setEffectField(field, value);
				if (rerender) this.render();
			});
		}
	}

	async #onAction(action, target) {
		switch (action) {
			case "next": {
				const steps = this.#steps;
				const at = steps.indexOf(this.#state.step);
				this.#state.step = steps[Math.min(at + 1, steps.length - 1)];
				PipBoyApp.playSound("tab");
				break;
			}
			case "back": {
				const steps = this.#steps;
				const at = steps.indexOf(this.#state.step);
				this.#state.step = steps[Math.max(at - 1, 0)];
				PipBoyApp.playSound("tab");
				break;
			}
			case "cancel":
				PipBoyApp.playSound("select");
				this.close();
				return;
			case "bonus": {
				const delta = Number(target.dataset.delta) || 0;
				this.#state.bonus = Math.max(0, this.#state.bonus + delta);
				// Taking points back can't un-spend them, so drop the overspend.
				while (this.pointsLeft < 0 && this.#refundOne());
				PipBoyApp.playSound("select");
				break;
			}
			case "spend": {
				const id = target.dataset.skillId;
				const skill = this.actor.items.get(id);
				if (!skill) return;
				const rank = Number(skill.system?.value) || 0;
				const added = this.#state.spent[id] ?? 0;
				if (this.pointsLeft <= 0 || (rank + added) >= PipBoyLevelUp.skillCap) return;
				this.#state.spent[id] = added + 1;
				PipBoyApp.playSound("select");
				break;
			}
			case "refund": {
				const id = target.dataset.skillId;
				if (!this.#state.spent[id]) return;
				this.#state.spent[id] -= 1;
				if (!this.#state.spent[id]) delete this.#state.spent[id];
				PipBoyApp.playSound("select");
				break;
			}
			case "perk": {
				const id = target.dataset.perkId;
				if (target.dataset.blocker) {
					ui.notifications?.warn(
						`${target.dataset.perkName ?? "That perk"} — ${target.dataset.blocker}.`,
					);
					return;
				}
				this.#state.perkId = this.#state.perkId === id ? null : id;
				this.#loadEffectDefinition();
				PipBoyApp.playSound("select");
				break;
			}
			case "effectTarget":
			case "effectMode":
			case "effectValue":
			case "effectKey":
			case "effectAttr":
			case "effectSkill":
			case "effectPoints":
				// Handled by the form listeners, not clicks.
				return;
			case "effectCustom":
				this.#state.effectCustom = !this.#state.effectCustom;
				this.#state.effect ??= { target: "none", mode: "add", value: "1" };
				PipBoyApp.playSound("select");
				break;
			case "effectClear":
				this.#state.effect = null;
				this.#state.effectCustom = false;
				PipBoyApp.playSound("select");
				break;
			case "effectRemember":
				this.#state.effectRemember = !this.#state.effectRemember;
				PipBoyApp.playSound("select");
				break;
			case "apply":
				await this.#apply();
				return;
			default:
				return;
		}
		await this.render();
	}

	/** Load the effect definition for the chosen perk — a saved one, a built-in,
	 *  or nothing — and reset the choices that go with it. */
	#loadEffectDefinition() {
		const entry = this.#state.perkId ? this.#perks?.get(this.#state.perkId) : null;
		if (!entry) {
			this.#state.effect = null;
			this.#state.effectCustom = false;
			return;
		}
		const preset = PerkEffects.preset(entry.item.name);
		this.#state.effect = preset ? { ...preset } : null;
		this.#state.effectCustom = false;
		this.#state.effectRemember = true;
		this.#state.effectAttr = preset?.attr ?? "str";
		this.#state.effectSkillId = null;
		// A perk that grants ranks can leave the pool overspent if the player
		// had already spent against a larger bonus.
		while (this.pointsLeft < 0 && this.#refundOne());
	}

	/** Update one field of the effect definition from the builder form. */
	#setEffectField(field, value) {
		this.#state.effect ??= { target: "none", mode: "add", value: "1" };
		this.#state.effect[field] = value;
		if (field === "skillPoints") {
			this.#state.effect.skillPoints = Math.max(0, Number(value) || 0);
			while (this.pointsLeft < 0 && this.#refundOne());
		}
	}

	/** Hand a point back from whichever skill has the most, so lowering the
	 *  bonus can never leave the pool overspent. */
	#refundOne() {
		const entries = Object.entries(this.#state.spent);
		if (!entries.length) return false;
		const [id] = entries.sort((a, b) => b[1] - a[1])[0];
		this.#state.spent[id] -= 1;
		if (!this.#state.spent[id]) delete this.#state.spent[id];
		return true;
	}

	async #showPerkInfo(perkId) {
		const entry = this.#perks?.get(perkId);
		if (!entry) return;
		const item = entry.item;
		const html = await foundry.applications.ux.TextEditor.enrichHTML(
			item.system?.description ?? "", { secrets: false },
		);
		this.#app.showReadout({
			title: entry.rank > 1 ? `${item.name} (Rank ${entry.rank})` : item.name,
			img: item.img,
			html: html || "<em>No description.</em>",
		});
	}

	/* -------------------------------------------- */
	/*  Applying                                     */
	/* -------------------------------------------- */

	async #apply() {
		const actor = this.actor;
		const level = Number(actor.system?.level?.value) || 1;

		// Work out what the perk will do BEFORE anything is written. Fetching
		// its document can fail, and a failure half-way through would leave the
		// character with new skill ranks but no level.
		const perkEntry = this.#state.perkId ? this.#perks?.get(this.#state.perkId) : null;
		let perkPlan = null;
		if (perkEntry) {
			// Requirements and the SPECIAL cap are shown on their own steps, but
			// they are enforced here too: nothing should be able to reach the
			// actor by navigating straight to CONFIRM.
			const check = this.#checkRequirements(perkEntry.item, perkEntry.rank);
			if (!check.met) {
				ui.notifications?.warn(
					`${perkEntry.item.name} — ${check.blocker}. Nothing has been applied.`,
				);
				return;
			}
			const capped = this.#cappedAttribute();
			if (capped) {
				ui.notifications?.warn(
					`${capped} is already at the cap of ${PipBoyLevelUp.specialCap}. `
					+ "Nothing has been applied.",
				);
				return;
			}
			perkPlan = await this.#resolvePerk(perkEntry);
			if (!perkPlan) {
				ui.notifications?.error(
					`Could not read "${perkEntry.item.name}" from its compendium. `
					+ "Nothing has been applied.",
				);
				return;
			}
		}

		// Skills first, so the level change is written last and the derived max
		// HP settles once.
		// The free pool and the perk's own ranks land in one update per skill.
		const pending = { ...this.#state.spent };
		const grant = this.#tagGrant();
		if (grant) pending[grant.skillId] = (pending[grant.skillId] ?? 0) + grant.ranks;

		const skillUpdates = Object.entries(pending)
			.map(([id, added]) => {
				const skill = actor.items.get(id);
				if (!skill || !added) return null;
				const value = Math.min(
					PipBoyLevelUp.skillCap,
					(Number(skill.system?.value) || 0) + added,
				);
				return { _id: id, "system.value": value };
			})
			.filter(Boolean);
		if (skillUpdates.length) await actor.updateEmbeddedDocuments("Item", skillUpdates);

		if (perkPlan?.owned) {
			await perkPlan.owned.update({
				"system.rank.value": (Number(perkPlan.owned.system?.rank?.value) || 0) + 1,
			});
			// Another rank of Intense Training is another +1, so the new rank
			// gets its own effect rather than editing the one already there.
			if (perkPlan.effect) {
				await perkPlan.owned.createEmbeddedDocuments("ActiveEffect", [perkPlan.effect]);
			}
		}
		else if (perkPlan?.data) {
			if (perkPlan.effect) perkPlan.data.effects = [perkPlan.effect];
			await actor.createEmbeddedDocuments("Item", [perkPlan.data]);
		}

		// Tag! and its like: the tag lives on the skill item, not on an effect.
		if (perkPlan?.tagSkillId) {
			const skill = actor.items.get(perkPlan.tagSkillId);
			if (skill) await skill.update({ "system.tag": true });
		}
		if (perkPlan?.remember) {
			await PerkEffects.savePreset(perkEntry.item.name, perkPlan.remember);
		}

		const update = { "system.level.value": level + 1 };
		// Max HP is derived from the level, so it is never written here. Current
		// HP is a table call: levelling shouldn't quietly heal a wounded
		// character unless the GM wants it to.
		const heal = game.settings.get(MODULE_ID, "levelUpHeal");
		const hp = Number(actor.system?.health?.value) || 0;
		const max = Number(actor.system?.health?.max) || 0;
		if (heal === "point") update["system.health.value"] = Math.min(hp + 1, max + 1);
		else if (heal === "full") update["system.health.value"] = max + 1;
		await actor.update(update);

		PipBoyApp.playSound("activate");
		await this.#postCard(level + 1, perkEntry);
		this.close();
		this.#app.render();
	}

	/**
	 * Decide how to grant the chosen perk without writing anything: either raise
	 * the rank of one the character already has, or create a copy.
	 * @returns {Promise<{owned?: Item, data?: object}|null>} null if the perk
	 *   could not be read, which aborts the whole apply.
	 */
	async #resolvePerk(entry) {
		const slug = entry.item.name.slugify();
		const plan = this.#effectPlan(entry);
		const owned = this.actor.items.find(
			(i) => i.type === "perk" && i.name.slugify() === slug,
		);
		if (owned) return { owned, ...plan };

		// The available-perks list is built from compendium *index* entries, not
		// documents — `fallout.compendiums.perks()` collects `pack.getIndex()`
		// results — so the real document has to be fetched before it can be
		// copied onto the actor.
		const doc = entry.item.uuid ? await fromUuid(entry.item.uuid) : null;
		if (!doc) return null;
		const data = doc.toObject();
		delete data._id;
		foundry.utils.setProperty(data, "system.rank.value", 1);
		return { data, ...plan };
	}

	/** The label of the chosen SPECIAL if it is already at the cap, else null.
	 *  Only meaningful for an effect that raises an attribute. */
	#cappedAttribute() {
		const definition = this.#state.effect;
		const target = PerkEffects.target(definition?.target);
		if (!target?.askAttribute) return null;
		if (definition.mode === "override") return null;
		const key = this.#state.effectAttr;
		const value = Number(this.actor.system?.attributes?.[key]?.value) || 0;
		if (value < PipBoyLevelUp.specialCap) return null;
		return SPECIAL_KEYS.find(([k]) => k === key)?.[1] ?? key.toUpperCase();
	}

	/** The effect, skill tag and remembered definition for the chosen perk. */
	#effectPlan(entry) {
		const definition = this.#state.effect;
		if (!definition) return {};
		const label = SPECIAL_KEYS.find(([k]) => k === this.#state.effectAttr)?.[1];
		const effect = PerkEffects.buildEffect(
			{ name: entry.item.name, img: entry.item.img },
			definition,
			{ attr: this.#state.effectAttr, label },
		);
		return {
			effect,
			tagSkillId: definition.tagSkill ? this.#state.effectSkillId : null,
			// The attribute chosen is per-character, so it isn't remembered; the
			// shape of the effect is.
			remember: (this.#state.effectRemember && PerkEffects.canSave)
				? {
					target: definition.target,
					customKey: definition.customKey ?? "",
					mode: definition.mode ?? "add",
					value: definition.value ?? "",
					ask: definition.ask ?? (PerkEffects.target(definition.target)?.askAttribute
						? "special" : definition.tagSkill ? "skill" : null),
					tagSkill: !!definition.tagSkill,
					skillPoints: Number(definition.skillPoints) || 0,
					hint: definition.hint ?? "",
				}
				: null,
		};
	}

	async #postCard(newLevel, perkEntry) {
		const esc = foundry.utils.escapeHTML;
		const pending = { ...this.#state.spent };
		const grant = this.#tagGrant();
		if (grant) pending[grant.skillId] = (pending[grant.skillId] ?? 0) + grant.ranks;
		const skillLines = [];
		for (const [id, added] of Object.entries(pending)) {
			const skill = this.actor.items.get(id);
			if (skill) skillLines.push(`${skill.name} +${added}`);
		}
		const perkLine = perkEntry
			? `${perkEntry.item.name}${perkEntry.rank > 1 ? ` (Rank ${perkEntry.rank})` : ""}`
			: "";

		const rows = [];
		if (perkLine) rows.push(`<p><strong>Perk:</strong> ${esc(perkLine)}</p>`);
		if (skillLines.length) {
			rows.push(`<p><strong>Skills:</strong> ${esc(skillLines.join(", "))}</p>`);
		}
		rows.push(`<p><strong>Max HP:</strong> ${Number(this.actor.system?.health?.max) || 0}</p>`);

		await ChatMessage.create({
			speaker: ChatMessage.getSpeaker({ actor: this.actor }),
			content: `<div class="pip-levelup-card"><h3>LEVEL ${newLevel}</h3>`
				+ `<p class="pip-lu-card-name">${esc(this.actor.name)}</p>`
				+ `${rows.join("")}</div>`,
			flags: { [MODULE_ID]: { levelUp: true } },
		});
	}
}
