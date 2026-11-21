import { MODULE_ID } from "./constants.mjs";
import { PerkEffects } from "./perk-effects.mjs";

/**
 * Damage dice from perks and magazines, added to the system's damage dialog.
 *
 * The fallout system rolls a weapon's damage rating and nothing else: no perk
 * adds to it. The damage dialog (`fallout.DialogD6`) has an **Extra Dice**
 * field that the system leaves out of its ammunition maths, so that is where
 * these go. Every route to a weapon's damage opens that dialog (the system's
 * sheet, the Pip-Boy, the V.A.T.S. attack chain), so one hook covers them all.
 *
 * Three kinds of bonus:
 * - **automatic**: always on, decided by the weapon and the character
 *   (Laser Commander on an energy weapon, Nerd Rage! below a quarter HP).
 * - **with ammunition**: only while extra ammunition is being spent through
 *   the dialog's Fire Rate selector (Surrounded by the Dead!).
 * - **a choice**: depends on the attack or the target, or is used up
 *   (a sneak attack, "against a ghoul", a magazine read but not learned).
 *   These are checkboxes; ticking one adds its dice, unticking takes them off.
 *
 * Perks are found by name on the character, ranks included. Magazines come in
 * two states: *learned* (the perk item is on the character) or only *read*
 * (the system records it in `system.readMagazines`), and each series says what
 * each state is worth.
 */

/** Weapon types that make a ranged attack with a gun. Thrown weapons and
 *  explosives are left out: the gun perks don't apply to them. */
const RANGED = new Set(["smallGuns", "energyWeapons", "bigGuns", "bows"]);

const SNEAK = "Sneak attack (not in power armor)";

/**
 * The rules. `kind` says where the bonus comes from:
 * - `perk`: an ordinary perk; it counts only once learned.
 * - `tales`: Astoundingly Awesome Tales. Read, it lasts a single attack;
 *   learned, it applies to every attack.
 * - `once`: most magazines. Read, it can be used once; learned, once a scene.
 * - `party`: Live & Love's Nuke-the-Man!. Read, it lasts one scene; learned,
 *   it is permanent, for every party member.
 *
 * `dice` is a flat bonus, `perRank` one that grows with the perk's rank;
 * `minRank` is the rank the bonus starts at. `when` tests the weapon (and
 * the attacker); a rule without it applies to any weapon. `ask` turns the
 * bonus into a checkbox with that condition, `ammo` ties it to Fire Rate.
 */
const RULES = [
	// Perks
	{ name: "Laser Commander", kind: "perk", perRank: 1, when: (w) => w.energy && w.ranged },
	{ name: "Commando", kind: "perk", perRank: 1, when: (w) => w.ranged && !w.heavy && w.fireRate >= 3 },
	{ name: "Rifleman", kind: "perk", perRank: 1,
		when: (w) => w.ranged && !w.heavy && w.twoHanded && w.fireRate <= 2 },
	{ name: "Gunslinger", kind: "perk", perRank: 1,
		when: (w) => w.ranged && !w.heavy && !w.twoHanded && w.fireRate <= 2 },
	{ name: "Size Matters", kind: "perk", perRank: 1, when: (w) => w.heavy },
	{ name: "Iron Fist", kind: "perk", dice: 1, when: (w) => w.unarmed },
	{ name: "Pyromaniac", kind: "perk", perRank: 1, when: (w) => w.fire },
	{ name: "Nerd Rage!", kind: "perk", perRank: 1, when: (w, c) => c.badlyHurt },
	{ name: "Ninja", kind: "perk", dice: 2, when: (w) => w.melee || w.unarmed, ask: SNEAK },
	{ name: "Mister Sandman", kind: "perk", dice: 2, when: (w) => w.suppressed, ask: SNEAK },
	{ name: "Blitz", kind: "perk", dice: 1, minRank: 2, when: (w) => w.melee || w.unarmed,
		ask: "Moved into reach this turn" },

	// Astoundingly Awesome Tales
	{ name: "Deadly Lasers!", kind: "tales", dice: 1, when: (w) => w.energy },
	{ name: "The Starlet Sniper!", kind: "tales", dice: 1, when: (w) => w.accurate },
	// Ammunition buys damage through Fire Rate, so a weapon without one can't.
	{ name: "Surrounded by the Dead!", kind: "tales", dice: 1, when: (w) => w.ranged && w.fireRate > 0,
		ammo: true },
	{ name: "Attack of the Fishmen!", kind: "tales", dice: 1, ask: "Against a mirelurk" },
	{ name: "Curse of the Burned!", kind: "tales", dice: 1, ask: "Against a ghoul" },
	{ name: "Rise of the Mutants!", kind: "tales", dice: 1, ask: "Against a super mutant" },

	// Once when read, once a scene when learned
	{ name: "Future Weapons Today", kind: "once", dice: 2, when: (w) => w.energy,
		ask: "Overcharge (it can't attack next turn)" },
	{ name: "Rocket Science for Toddlers", kind: "once", dice: 2, when: (w) => w.blast },
	// Unarmed attacks are melee attacks too.
	{ name: "Blood on the Harp", kind: "once", dice: 2, when: (w) => w.melee || w.unarmed,
		ask: "A successful melee attack" },
	{ name: "Take Aim, Army Style", kind: "once", dice: 2, when: (w) => !w.accurate,
		ask: "An aimed attack" },
	{ name: "Down Home Cookin'", kind: "once", dice: 2, when: (w) => w.thrown },
	{ name: "FH 5-08 Bushes, Boxes, and Beehives: Camouflage Special", kind: "once", dice: 2,
		when: (w) => w.unarmed || w.knife },
	{ name: "Bear-Proofing your Campsite", kind: "once", dice: 3, ask: "Against a yao guai" },
	{ name: "Guide to Hunting Commies!", kind: "once", dice: 2, ask: "Against a lower-level enemy" },
	{ name: "Demon Slaves, Demon Sands", kind: "once", dice: 2, ask: "Against a ghoul" },
	{ name: "Geckos and Gamma Radiation", kind: "once", dice: 2, ask: "Against a Mutated creature" },
	{ name: "The Future of Hunting?", kind: "once", dice: 2, ask: "Against a robot" },
	{ name: "Carnivorous Rabbits of Appalachia", kind: "once", dice: 2,
		ask: "Against a Mammal or Lizard" },
	{ name: "FH 5-04 Not the Soldiers You’re Looking For", kind: "once", dice: 1,
		ask: "Against a Character NPC" },

	// Live & Love
	{ name: "Nuke-the-Man!", kind: "party", dice: 1 },
];

/** Perk and magazine names, matched loosely: case, punctuation and curly
 *  quotes don't matter. */
const slug = (name) => PerkEffects.slug(String(name ?? "").replace(/[‘’]/g, "'"));

for (const rule of RULES) rule.slug = slug(rule.name);

export class PerkDice {
	/** The fire-based weapons Pyromaniac counts: name fragments, lowercase. */
	static get fireWeapons() {
		return String(game.settings.get(MODULE_ID, "perkDiceFireWeapons") ?? "")
			.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
	}

	/** What the rules need to know about a weapon. */
	static weaponFacts(weapon) {
		const sys = weapon?.system ?? {};
		const type = sys.weaponType ?? "";
		// Stored as 1/0 on some items and true/false on others.
		const quality = (key) => Boolean(Number(sys.damage?.weaponQuality?.[key]?.value));
		const name = String(weapon?.name ?? "").toLowerCase();
		return {
			ranged: RANGED.has(type),
			heavy: type === "bigGuns",
			energy: type === "energyWeapons",
			melee: type === "meleeWeapons",
			unarmed: type === "unarmed",
			thrown: type === "throwing",
			fireRate: Number(sys.fireRate) || 0,
			twoHanded: quality("two_handed"),
			accurate: quality("accurate"),
			blast: quality("blast"),
			suppressed: quality("suppressed"),
			knife: /\bknife\b|\bknives\b/.test(name),
			fire: this.fireWeapons.some((fragment) => name.includes(fragment)),
		};
	}

	/** Perks an actor has learned, by slug, with their rank (at least 1: an
	 *  owned perk often still carries the compendium's rank 0). */
	static learned(actor) {
		const out = new Map();
		for (const item of actor?.items ?? []) {
			if (item.type !== "perk") continue;
			const max = Number(item.system?.rank?.max) || 0;
			let rank = Math.max(1, Number(item.system?.rank?.value) || 0);
			if (max > 0) rank = Math.min(rank, max);
			out.set(slug(item.name), rank);
		}
		return out;
	}

	/** Magazines an actor has read, by slug. */
	static read(actor) {
		const out = new Set();
		for (const uuid of actor?.system?.readMagazines ?? []) {
			let name = null;
			try {
				name = foundry.utils.fromUuidSync(uuid)?.name ?? null;
			} catch (_e) { /* a magazine from a compendium that's gone */ }
			if (name) out.add(slug(name));
		}
		return out;
	}

	/** The party, for Nuke-the-Man!: player characters. */
	static party() {
		return game.actors.contents.filter((a) => a.type === "character" && a.hasPlayerOwner);
	}

	/**
	 * The perk dice for one actor attacking with one weapon.
	 * @returns {{auto: object[], ammo: object[], choices: object[]}}
	 *   Each entry has `name`, `dice` and, for choices, `label` and `note`.
	 */
	static bonuses(actor, weapon) {
		const facts = this.weaponFacts(weapon);
		const health = actor?.system?.health ?? {};
		const context = {
			badlyHurt: Number(health.max) > 0 && Number(health.value) < Number(health.max) / 4,
		};
		const learned = this.learned(actor);
		const read = this.read(actor);
		const auto = [];
		const ammo = [];
		const choices = [];

		for (const rule of RULES) {
			if (rule.when && !rule.when(facts, context)) continue;

			if (rule.kind === "party") {
				const party = this.party();
				// An unlinked token's actor is a copy; the party lists the original.
				const baseId = actor.isToken ? (actor.token?.actorId ?? actor.id) : actor.id;
				if (!party.some((a) => a.id === baseId)) continue;
				if (party.some((a) => this.learned(a).has(rule.slug))) {
					auto.push({ name: rule.name, dice: rule.dice });
				}
				else if (party.some((a) => this.read(a).has(rule.slug))) {
					choices.push({ name: rule.name, dice: rule.dice, label: "Party bonus", note: "this scene" });
				}
				continue;
			}

			const rank = learned.get(rule.slug);
			if (rank !== undefined) {
				if (rule.minRank && rank < rule.minRank) continue;
				const dice = rule.perRank ? rule.perRank * rank : rule.dice;
				if (rule.kind === "once") {
					choices.push({ name: rule.name, dice, label: rule.ask ?? "", note: "once a scene" });
				}
				else if (rule.ask) choices.push({ name: rule.name, dice, label: rule.ask, note: "" });
				else if (rule.ammo) ammo.push({ name: rule.name, dice });
				else auto.push({ name: rule.name, dice });
				continue;
			}

			// Read but not learned: good for one attack (or, Nuke-the-Man!, a scene).
			if (rule.kind !== "perk" && read.has(rule.slug)) {
				const label = rule.ask ?? (rule.ammo ? "Spending ammunition for damage" : "");
				choices.push({ name: rule.name, dice: rule.dice, label, note: "once" });
			}
		}
		return { auto, ammo, choices };
	}

	/* -------------------------------------------- */
	/*  The damage dialog                            */
	/* -------------------------------------------- */

	/** renderDialog: add the perk dice to a weapon's damage dialog. */
	static onRenderDialog(app, html) {
		if (game.system.id !== "fallout") return;
		if (!game.settings.get(MODULE_ID, "perkDice")) return;
		const DialogD6 = globalThis.fallout?.DialogD6;
		if (!DialogD6 || !(app instanceof DialogD6) || app.falloutRoll) return;

		const root = html instanceof HTMLElement ? html : html?.[0];
		const extra = root?.querySelector(".extra-dice");
		if (!extra || root.querySelector(".pip-perk-dice")) return;

		const weapon = this.#resolve(app.weapon);
		if (weapon?.type !== "weapon") return;
		const source = typeof app.actor === "string" ? this.#resolve(app.actor) : app.actor;
		const actor = source?.actor ?? source ?? weapon.actor;
		if (!actor) return;

		const { auto, ammo, choices } = this.bonuses(actor, weapon);
		if (!auto.length && !ammo.length && !choices.length) return;

		const panel = this.#panel(auto, ammo, choices);
		(extra.closest(".fallout-dialog") ?? extra.parentElement).after(panel);

		// Keep the field in step: take off what was added before, add what
		// applies now, and leave any dice the player typed in themselves.
		const fireRate = root.querySelector(".fire-rate");
		const autoDice = auto.reduce((sum, b) => sum + b.dice, 0);
		const ammoDice = ammo.reduce((sum, b) => sum + b.dice, 0);
		let applied = 0;
		const update = () => {
			const spending = (Number(fireRate?.value) || 0) > 0;
			let total = autoDice + (spending ? ammoDice : 0);
			for (const box of panel.querySelectorAll("input[type=checkbox]")) {
				if (box.checked) total += Number(box.dataset.dice) || 0;
			}
			for (const row of panel.querySelectorAll("[data-ammo]")) {
				row.classList.toggle("pip-perk-dice-off", !spending);
			}
			extra.value = String(Math.max(0, (Number(extra.value) || 0) - applied + total));
			applied = total;
		};
		panel.addEventListener("change", update);
		fireRate?.addEventListener("change", update);
		update();

		app.setPosition?.({ height: "auto" });
	}

	/** A document, or a plain object or UUID standing in for one. */
	static #resolve(ref) {
		if (!ref) return null;
		if (ref instanceof foundry.abstract.Document) return ref;
		const uuid = typeof ref === "string" ? ref : ref.uuid;
		try {
			return uuid ? foundry.utils.fromUuidSync(uuid) : null;
		} catch (_e) {
			return null;
		}
	}

	/** The list under Extra Dice: what's in it and what can be added. */
	static #panel(auto, ammo, choices) {
		const el = (tag, cls, text) => {
			const node = document.createElement(tag);
			if (cls) node.className = cls;
			if (text != null) node.textContent = text;
			return node;
		};
		const dice = (n) => el("span", "pip-perk-dice-n", `+${n} CD`);

		const panel = el("div", "pip-perk-dice");
		panel.append(el("div", "pip-perk-dice-head", "Perk damage (in Extra Dice)"));

		for (const b of auto) {
			const row = el("div", "pip-perk-dice-row");
			row.append(el("span", "pip-perk-dice-name", b.name), dice(b.dice));
			panel.append(row);
		}
		for (const b of ammo) {
			const row = el("div", "pip-perk-dice-row");
			row.dataset.ammo = "";
			row.append(el("span", "pip-perk-dice-name", b.name), dice(b.dice),
				el("span", "pip-perk-dice-note", "with Fire Rate"));
			panel.append(row);
		}
		for (const b of choices) {
			const row = el("label", "pip-perk-dice-row");
			const box = el("input");
			box.type = "checkbox";
			box.dataset.dice = String(b.dice);
			const note = [b.label, b.note].filter(Boolean).join(" · ");
			row.append(box, el("span", "pip-perk-dice-name", b.name), dice(b.dice));
			if (note) row.append(el("span", "pip-perk-dice-note", note));
			panel.append(row);
		}
		return panel;
	}
}
