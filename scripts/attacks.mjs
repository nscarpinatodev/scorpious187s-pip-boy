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
export async function rollWeaponAttack(actor, item) {
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

	// --- hand off to the system roller -----------------------------------
	fallout.Dialog2d20.createDialog({
		rollName: item.name,
		diceNum: 2,
		attribute: attribute.value,
		skill: skill.value,
		tag: skill.tag,
		complication,
		rollLocation: true,
		actor,
		item,
	});
}

/**
 * Roll a weapon's damage (combat dice pool) via the system's `fallout.DialogD6`,
 * mirroring FalloutBaseActorSheet#_onWeaponDamageRoll. The system expects the
 * actor as a UUID (token UUID when the actor has a token).
 *
 * @param {Actor} actor  The character rolling damage.
 * @param {Item}  item   The weapon item.
 */
export async function rollWeaponDamage(actor, item) {
	if (!actor || !item || item.type !== "weapon") return;

	if (item.isWeaponBroken) {
		return ui.notifications.warn(
			game.i18n.localize("FALLOUT.ERRORS.ThisWeaponIsBroken"),
		);
	}

	const actorUUID = actor.token ? actor.token.uuid : actor.uuid;

	fallout.DialogD6.createDialog({
		rollName: item.name,
		diceNum: item.currentWeaponDamage,
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
