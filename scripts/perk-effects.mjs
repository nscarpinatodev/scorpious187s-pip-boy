import { MODULE_ID } from "./constants.mjs";

/**
 * Active Effects for perks, built as the perk is added to a character.
 *
 * The system's perks ship with no effects, and several of them — Intense
 * Training, Life Giver, Tag! — need a *choice* before an effect can even be
 * written, so there is nothing sensible to ship in a compendium. This builds
 * the effect at the moment the perk is taken, and remembers what was built so
 * the next character to take that perk gets it automatically.
 *
 * ### Why these keys work
 *
 * Foundry applies effects between `prepareBaseData` and `prepareDerivedData`,
 * and the fallout system computes defense, initiative, max HP and melee damage
 * in `prepareDerivedData`. So an effect on a *base* field (`attributes.int.value`)
 * or on a field the derived maths reads as an input (`health.bonus`) is picked
 * up by everything downstream. An effect written straight onto a derived value
 * such as `system.health.max` would simply be overwritten.
 */

/** Targets offered by the builder. All are base fields or bonus inputs, so
 *  they survive the system's derived recalculation. */
const TARGETS = [
	{
		key: "special",
		label: "SPECIAL attribute",
		path: "system.attributes.{attr}.value",
		askAttribute: true,
	},
	{ key: "health", label: "Maximum HP", path: "system.health.bonus" },
	{ key: "defense", label: "Defense", path: "system.defense.bonus" },
	{ key: "initiative", label: "Initiative", path: "system.initiative.bonus" },
	{ key: "melee", label: "Melee damage", path: "system.meleeDamage.bonus" },
	{ key: "physical", label: "Physical resistance", path: "system.resistance.physical" },
	{ key: "energy", label: "Energy resistance", path: "system.resistance.energy" },
	{ key: "radiation", label: "Radiation resistance", path: "system.resistance.radiation" },
	{ key: "poison", label: "Poison resistance", path: "system.resistance.poison" },
	{ key: "luck", label: "Luck points", path: "system.luckPoints" },
	{ key: "carry", label: "Carry weight", path: "system.carryWeight.mod" },
	{ key: "custom", label: "Custom data path…", path: null },
	{ key: "none", label: "No effect", path: null },
];

/**
 * Effects for the perks that most obviously need one. Everything else is built
 * by hand in the wizard and saved from there.
 */
const BUILT_IN = {
	"intense-training": {
		target: "special",
		mode: "add",
		value: "1",
		ask: "special",
		hint: "Raises one SPECIAL attribute by 1, to a maximum of 10. Everything "
			+ "derived from that attribute — defense, initiative, max HP, melee "
			+ "damage — follows.",
	},
	"life-giver": {
		target: "health",
		mode: "add",
		value: "@attributes.end.value",
		hint: "Adds the character's Endurance to maximum HP. The value is a live "
			+ "reference, so it tracks Endurance rather than freezing today's number.",
	},
	"tag": {
		target: "none",
		tagSkill: true,
		skillPoints: 2,
		ask: "skill",
		hint: "Tags one more skill and raises it by 2 ranks, to the usual maximum "
			+ "of 6. Spend the two ranks on the next step.",
	},
	"skilled": {
		target: "none",
		skillPoints: 2,
		hint: "Two extra skill ranks: +1 to two skills, or +2 to one. Spend them on "
			+ "the next step — the rank cap still applies.",
	},
	"toughness": {
		target: "physical",
		mode: "add",
		value: "1",
		hint: "Physical damage resistance +1 to all hit locations, per rank.",
	},
	"rad-resistance": {
		target: "radiation",
		mode: "add",
		value: "1",
		hint: "Radiation damage resistance +1 to all hit locations, per rank.",
	},
	"refractor": {
		target: "energy",
		mode: "add",
		value: "1",
		hint: "Energy damage resistance +1 to all hit locations, per rank.",
	},
	"snakeater": {
		target: "poison",
		mode: "add",
		value: "2",
		hint: "Poison damage resistance +2.",
	},
	"strong-back": {
		target: "carry",
		mode: "add",
		value: "25",
		hint: "Maximum carry weight +25 lbs per rank. If your world is set to "
			+ "kilograms, change the value to 11.",
	},
};

export class PerkEffects {
	static get targets() {
		return TARGETS.map((t) => ({ ...t }));
	}

	static target(key) {
		return TARGETS.find((t) => t.key === key) ?? null;
	}

	/** The perk-name slug used as the preset key.
	 *
	 *  `slugify()` defaults to non-strict, which *keeps* punctuation — "Tag!"
	 *  slugifies to "tag!" — so strict is used here to key presets on letters,
	 *  digits and dashes alone. */
	static slug(name) {
		return String(name ?? "").slugify({ strict: true });
	}

	/** Saved presets, world-wide. */
	static get saved() {
		return foundry.utils.duplicate(game.settings.get(MODULE_ID, "perkEffects") ?? {});
	}

	/** The definition for a perk, or null if nothing is known about it. */
	static preset(name) {
		const slug = PerkEffects.slug(name);
		const saved = PerkEffects.saved[slug];
		if (saved) return { ...saved, slug, saved: true };
		const builtIn = BUILT_IN[slug];
		return builtIn ? { ...builtIn, slug, saved: false } : null;
	}

	/** Can this user write the shared preset table? World settings are GM-only,
	 *  so a player's level-up still applies its effect — it just isn't saved. */
	static get canSave() {
		return game.user.isGM;
	}

	/** Remember a definition so the next character to take this perk gets it. */
	static async savePreset(name, definition) {
		if (!PerkEffects.canSave) return;
		const slug = PerkEffects.slug(name);
		const all = PerkEffects.saved;
		all[slug] = { ...definition };
		delete all[slug].slug;
		delete all[slug].saved;
		await game.settings.set(MODULE_ID, "perkEffects", all);
	}

	/** Forget a saved definition, falling back to the built-in if there is one. */
	static async forgetPreset(name) {
		const slug = PerkEffects.slug(name);
		const all = PerkEffects.saved;
		delete all[slug];
		await game.settings.set(MODULE_ID, "perkEffects", all);
	}

	/**
	 * Build the ActiveEffect data for a perk, or null when the definition
	 * carries no effect (Tag!, for instance, only tags a skill).
	 *
	 * The legacy `changes` shape is used deliberately: v13 stores changes there,
	 * and v14 migrates them to `system.changes` on the way in. Writing the v14
	 * shape would break the module's stated v13 support.
	 *
	 * @param {object} perk         `{name, img}` of the perk the effect belongs to.
	 * @param {object} definition   The preset or hand-built definition.
	 * @param {object} [choice]     `{attr, label}` from the wizard's question.
	 */
	static buildEffect(perk, definition, choice = {}) {
		const target = PerkEffects.target(definition?.target);
		if (!target || target.key === "none") return null;

		const key = target.key === "custom"
			? String(definition.customKey ?? "").trim()
			: target.path.replace("{attr}", choice.attr ?? definition.attr ?? "str");
		if (!key) return null;

		const modes = CONST.ACTIVE_EFFECT_MODES;
		const mode = definition.mode === "override" ? modes.OVERRIDE : modes.ADD;

		return {
			name: choice.label ? `${perk.name} (${choice.label})` : perk.name,
			img: perk.img ?? "icons/svg/aura.svg",
			transfer: true,
			changes: [{
				key,
				mode,
				value: String(definition.value ?? ""),
				priority: 20,
			}],
		};
	}

	/** A one-line description of what a definition will do, for the summary. */
	static describe(definition, choice = {}) {
		if (!definition) return "";
		const parts = [];
		const target = PerkEffects.target(definition.target);
		if (target && target.key !== "none") {
			const label = target.key === "custom"
				? (definition.customKey || "custom path")
				: target.askAttribute
					? `${choice.label ?? definition.attr ?? "SPECIAL"}`
					: target.label;
			const verb = definition.mode === "override" ? "set to" : "+";
			const value = String(definition.value ?? "").trim();
			parts.push(`${label} ${verb}${verb === "+" ? "" : " "}${value}`);
		}
		if (definition.tagSkill && choice.skillName) parts.push(`tags ${choice.skillName}`);
		else if (definition.tagSkill) parts.push("tags a skill");
		const points = Number(definition.skillPoints) || 0;
		if (points) parts.push(`+${points} skill ${points === 1 ? "rank" : "ranks"}`);
		return parts.join(", ");
	}
}
