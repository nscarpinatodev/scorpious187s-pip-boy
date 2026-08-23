import { MODULE_ID } from "./constants.mjs";
import { PipBoyVats } from "./vats.mjs";

/**
 * Weapon attack rolls for the Pip-Boy.
 *
 * We deliberately do NOT re-implement the 2d20 dice, chat card, hit-location or
 * AP handling — those belong to the `fallout` system. This helper only resolves
 * a weapon's skill + attribute (per the Fallout 2d20 rules) and hands off to the
 * system's own `fallout.Dialog2d20`, exactly like the character sheet does in
 * FalloutBaseActorSheet#_onWeaponRoll.
 *
 * @param {Actor} actor  The character making the attack.
 * @param {Item}  item   The weapon item.
 */
export async function rollWeaponAttack(actor, item, { aiming = false } = {}) {
	if (!actor || !item || item.type !== "weapon") return;

	if (item.isWeaponBroken) {
		return ui.notifications.warn(
			game.i18n.localize("FALLOUT.ERRORS.ThisWeaponIsBroken"),
		);
	}

	// --- resolve skill + attribute ---------------------------------------
	const weaponType = item.system.weaponType;
	const skillName = weaponType === "custom"
		? item.system.skill ?? ""
		: CONFIG.FALLOUT.WEAPON_SKILLS[weaponType];

	if (!skillName) {
		return ui.notifications.error(
			game.i18n.localize("FALLOUT.ERRORS.UnableToDetermineWeaponSkill"),
		);
	}

	const skillItem = actor.items.find((i) => i.type === "skill" && i.name === skillName);
	const skill = skillItem
		? skillItem.system
		: { value: 0, tag: false, defaultAttribute: "str" };

	const customAttribute = weaponType === "custom" ? (item.system.attribute ?? "") : false;
	const attributeOverride = CONFIG.FALLOUT.WEAPON_ATTRIBUTE_OVERRIDE[weaponType];

	let attribute;
	if (customAttribute) attribute = actor.system.attributes[customAttribute];
	else if (attributeOverride) attribute = actor.system.attributes[attributeOverride];
	else attribute = actor.system.attributes[skill.defaultAttribute];

	if (!attribute) {
		return ui.notifications.error(
			game.i18n.localize("FALLOUT.ERRORS.UnableToDetermineWeaponAttribute"),
		);
	}

	// --- ammo / consumable availability ----------------------------------
	const autoCalculateAmmo = game.settings.get("fallout", "automaticAmmunitionCalculation");
	const actorCanUseAmmo = ["character", "robot"].includes(actor.type);
	const ammoPopulated = item.system.ammo !== "";

	if (autoCalculateAmmo && actorCanUseAmmo && ammoPopulated) {
		const [ammo, shotsAvailable] = actor._getAvailableAmmoType(item.system.ammo);
		if (!ammo) {
			return ui.notifications.warn(`Ammo ${item.system.ammo} not found`);
		}
		if (shotsAvailable < item.system.ammoPerShot) {
			return ui.notifications.warn(`Not enough ${item.system.ammo} ammo`);
		}
	} else if (item.system.consumedOnUse && item.system.quantity < 1) {
		return ui.notifications.warn(`You don't have any ${item.name}'s left`);
	}

	// --- unreliable weapons raise the complication range -----------------
	let complication = parseInt(actor.system.complication);
	if (item.system.damage.weaponQuality.unreliable.value) complication -= 1;

	// --- optionally spend AP on bonus dice -------------------------------
	const diceNum = await PipBoyVats.promptBuyDice();
	if (diceNum === null) return; // cancelled at the AP prompt

	// --- hand off to the system roller -----------------------------------
	// The dialog's promise resolves with the roll result once the player has
	// actually rolled (null if they close the dialog without rolling).
	const result = await fallout.Dialog2d20.createDialog({
		rollName: item.name,
		diceNum,
		attribute: attribute.value,
		skill: skill.value,
		tag: skill.tag,
		complication,
		rollLocation: true,
		actor,
		item,
	});

	// V.A.T.S.: chain straight into the damage dialog (rate of fire, extra
	// dice, ammo) so the flow is attack → damage → apply without re-clicking.
	// Misses (per the initial verdict — target Defense or vs 1) don't chain;
	// damage can still be rolled manually if the GM overrules the difficulty.
	if (result && game.settings.get(MODULE_ID, "vatsAutoDamage")) {
		const shouldChain = !PipBoyVats.enabled
			|| PipBoyVats.quickVerdict(result.dicesRolled).hit;
		if (shouldChain) rollWeaponDamage(actor, item, { aiming });
	}
}

/**
 * Roll a weapon's damage (combat dice pool) via the system's `fallout.DialogD6`,
 * mirroring FalloutBaseActorSheet#_onWeaponDamageRoll. The system expects the
 * actor as a UUID (token UUID when the actor has a token).
 *
 * @param {Actor} actor  The character rolling damage.
 * @param {Item}  item   The weapon item.
 */
export async function rollWeaponDamage(actor, item, { aiming = false } = {}) {
	if (!actor || !item || item.type !== "weapon") return;

	if (item.isWeaponBroken) {
		return ui.notifications.warn(
			game.i18n.localize("FALLOUT.ERRORS.ThisWeaponIsBroken"),
		);
	}

	const actorUUID = actor.token ? actor.token.uuid : actor.uuid;

	// Optionally spend AP on bonus combat dice. They're primed into the
	// dialog's "Extra Dice" field, which the system excludes from its ammo
	// maths — AP-bought dice cost AP, not ammunition.
	//
	// Increasing damage dice, per the rules:
	//   Ranged  — spend extra ammunition, +1 DC per round, capped by Fire Rate.
	//             That's the system dialog's own Fire Rate selector, which
	//             charges the ammo; no AP purchase is offered.
	//   Melee, unarmed and thrown — spend up to 3 AP, +1 DC per AP (flat).
	// The one exception is an Accurate weapon fired after Aiming, which buys
	// damage at the same flat rate and locks out ammunition-bought dice.
	const base = item.currentWeaponDamage;
	const apWeapon = ["meleeWeapons", "unarmed", "throwing"]
		.includes(item.system?.weaponType);
	const accurateAimed = aiming
		&& item.system?.damage?.weaponQuality?.accurate?.value === true;
	const fireRate = Number(item.system?.fireRate) || 0;

	if (apWeapon || accurateAimed) {
		const note = accurateAimed && !apWeapon
			? "Accurate + Aim: 1 AP per +1 DC (max 3). Don't also spend ammunition for damage."
			: "1 AP per +1 DC, up to 3.";
		// Always flat: 1 AP per die, whether from the weapon class or Accurate.
		const total = await PipBoyVats.promptBuyDice({
			kind: "damage", base, flat: true, max: 3, note,
		});
		if (total === null) return; // cancelled at the AP prompt
		PipBoyVats.primeExtraDice(total - base);
	} else if (fireRate > 0) {
		ui.notifications?.info(
			`${item.name}: buy up to ${fireRate} extra DC with ammunition using Fire Rate.`);
	}

	fallout.DialogD6.createDialog({
		rollName: item.name,
		diceNum: base,
		actor: actorUUID,
		weapon: item,
	});
}

/**
 * Roll a skill via the system's `fallout.Dialog2d20`, mirroring
 * FalloutBaseActorSheet#_onRollSkill (left-click uses the skill's default
 * attribute).
 *
 * @param {Actor} actor      The character rolling.
 * @param {Item}  item       The skill item.
 * @param {string} [attrKey] Optional SPECIAL key to roll against; defaults to
 *                           the skill's `defaultAttribute`.
 */
export function rollSkill(actor, item, attrKey) {
	if (!actor || !item || item.type !== "skill") return;

	const key = attrKey ?? item.system.defaultAttribute;
	const attribute = actor.system.attributes?.[key]?.value ?? 0;

	fallout.Dialog2d20.createDialog({
		rollName: item.localizedName ?? item.name,
		diceNum: 2,
		attribute,
		skill: item.system.value ?? 0,
		tag: item.system.tag ?? false,
		complication: parseInt(actor.system.complication),
	});
}
