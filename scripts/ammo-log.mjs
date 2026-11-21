import { MODULE_ID } from "./constants.mjs";

/**
 * Ammunition log: a whisper to the GMs for every round spent.
 *
 * Ammunition is spent by the fallout system on the client of whoever rolled:
 * the attack dialog (`fallout.Dialog2d20`) spends the weapon's Ammo per Shot,
 * the damage dialog (`fallout.DialogD6`) spends whatever Fire Rate bought.
 * That client is also the only one that knows which roll it was, so it is the
 * one that writes the log.
 *
 * Each roll is remembered as the player clicks ROLL, with what the system's
 * own rules say it should cost. The system spends ammunition through one
 * method, `Actor#reduceAmmo`, which is wrapped (at runtime, nothing is
 * patched on disk) so a change made inside it can be told from one made any
 * other way, such as editing a quantity by hand. Only the system's spending is
 * matched to the roll just made; when the total it takes for one roll goes
 * past what that roll should have cost, the entry says so.
 */

/** How long after ROLL a change in ammunition still belongs to that roll. */
const ROLL_WINDOW_MS = 8000;

/** How long after reduceAmmo returns its changes may still be arriving: it
 *  deletes a used-up item without waiting for the deletion. */
const SPEND_GRACE_MS = 1500;

export class AmmoLog {
	static get enabled() {
		return game.system.id === "fallout" && game.settings.get(MODULE_ID, "ammoLog") === true;
	}

	/** The roll just made on this client: what it was and what it should cost. */
	static #roll = null;

	/** reduceAmmo calls in progress, and until when their changes may arrive. */
	static #spending = 0;
	static #spendingUntil = 0;

	/** What the system last asked reduceAmmo for. */
	static #asked = null;

	/** Wrap the system's reduceAmmo so its changes can be recognized. */
	static install() {
		if (game.system.id !== "fallout") return;
		const proto = CONFIG.Actor.documentClass?.prototype;
		const original = proto?.reduceAmmo;
		if (typeof original !== "function" || original.pipAmmoLog) return;
		const log = this;
		const wrapped = async function (ammoName, roundsToUse, ...rest) {
			log.#spending++;
			log.#spendingUntil = Date.now() + SPEND_GRACE_MS;
			log.#asked = { ammo: ammoName, rounds: Number(roundsToUse) || 0, at: Date.now() };
			try {
				return await original.call(this, ammoName, roundsToUse, ...rest);
			} finally {
				log.#spending--;
				log.#spendingUntil = Date.now() + SPEND_GRACE_MS;
			}
		};
		wrapped.pipAmmoLog = true;
		proto.reduceAmmo = wrapped;
	}

	/** True while the system's own spending is under way. */
	static get #systemSpending() {
		return this.#spending > 0 || Date.now() < this.#spendingUntil;
	}

	/** Ammo counts before an update, by item UUID, to compare against after. */
	static #before = new Map();

	/** Shots left in an ammo item, counted the way the system counts them. */
	static shots(item) {
		const max = Math.max(1, Number(item.system?.shots?.max) || 0);
		const current = Number(item.system?.shots?.current) || 0;
		const quantity = Number(item.system?.quantity) || 0;
		return Math.max(0, (quantity - 1) * max + current);
	}

	/* -------------------------------------------- */
	/*  Remembering the roll                         */
	/* -------------------------------------------- */

	/** renderDialog: note the roll when the attack or damage dialog's ROLL is clicked. */
	static onRenderDialog(app, html) {
		if (!this.enabled) return;
		const Dialog2d20 = globalThis.fallout?.Dialog2d20;
		const DialogD6 = globalThis.fallout?.DialogD6;
		const attack = Dialog2d20 && app instanceof Dialog2d20;
		const damage = DialogD6 && app instanceof DialogD6;
		if (!attack && !damage) return;

		const root = html instanceof HTMLElement ? html : html?.[0];
		const button = root?.querySelector(".dialog-button.roll, [data-button='roll']");
		if (!button) return;
		button.addEventListener("click", () => {
			try {
				this.#roll = attack ? this.#attackRoll(app) : this.#damageRoll(app, root);
			} catch (err) {
				console.warn(`${MODULE_ID} | ammo log:`, err);
			}
		}, { capture: true });
	}

	/** The attack: one shot of the weapon's Ammo per Shot. */
	static #attackRoll(app) {
		const weapon = this.#resolve(app.item);
		if (weapon?.type !== "weapon" || !weapon.system?.ammo) return null;
		return {
			kind: "Attack",
			weapon: weapon.name,
			ammo: weapon.system.ammo,
			detail: "",
			expected: Number(weapon.system.ammoPerShot) || 0,
			taken: 0,
			at: Date.now(),
		};
	}

	/** The damage: what Fire Rate bought, by the system's own arithmetic
	 *  (DialogD6#checkAmmo). Extra Dice are free. */
	static #damageRoll(app, root) {
		const weapon = this.#resolve(app.weapon);
		if (weapon?.type !== "weapon" || !weapon.system?.ammo) return null;
		const fireRate = Number(root.querySelector(".fire-rate")?.value) || 0;
		const extra = Number(root.querySelector(".extra-dice")?.value) || 0;
		const gatling = weapon.hasWeaponQuality?.("gatling") ?? false;
		let dice = parseInt(root.querySelector(".damage-dice")?.value) || Number(app.diceNum) || 0;
		dice += fireRate * (gatling ? 2 : 1);
		const base = app.falloutRoll ? 0 : Number(weapon.system.damage?.rating) || 0;
		const actor = weapon.actor;
		const melee = ["meleeWeapons", "unarmed"].includes(weapon.system.weaponType)
			? Number(actor?.system?.meleeDamage?.value) || 0
			: 0;
		let expected = Math.max(0, dice - base - melee) * (Number(weapon.system.ammoPerShot) || 0);
		if (gatling) expected = Math.floor(expected * 0.5);

		const parts = [];
		if (app.falloutRoll) parts.push(`adding ${dice} ${dice === 1 ? "die" : "dice"} to a roll`);
		else parts.push(`Fire Rate ${fireRate}`, `Extra Dice ${extra}`);
		return {
			kind: "Damage",
			weapon: weapon.name,
			ammo: weapon.system.ammo,
			detail: parts.join(", "),
			expected,
			taken: 0,
			at: Date.now(),
		};
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

	/* -------------------------------------------- */
	/*  Watching the ammunition                      */
	/* -------------------------------------------- */

	/** The change is ours to log: an ammo item on an actor, changed on this client. */
	static #ours(item, userId) {
		return this.enabled && userId === game.user.id && item?.type === "ammo" && item.parent;
	}

	static onPreUpdateItem(item, changes, options, userId) {
		if (!this.#ours(item, userId)) return;
		this.#before.set(item.uuid, this.shots(item));
	}

	static onUpdateItem(item, changes, options, userId) {
		if (!this.#ours(item, userId)) return;
		const before = this.#before.get(item.uuid);
		this.#before.delete(item.uuid);
		if (before === undefined) return;
		const after = this.shots(item);
		if (after < before) this.#log(item, before, after);
	}

	/** The system deletes an ammo item outright when its last shot is spent. */
	static onPreDeleteItem(item, options, userId) {
		if (!this.#ours(item, userId)) return;
		const before = this.shots(item);
		if (before > 0) this.#log(item, before, 0);
	}

	/* -------------------------------------------- */
	/*  The log entry                                */
	/* -------------------------------------------- */

	static #log(item, before, after) {
		const spent = before - after;
		const bySystem = this.#systemSpending;
		const roll = bySystem && this.#roll && (Date.now() - this.#roll.at) < ROLL_WINDOW_MS
			&& this.#roll.ammo === item.name ? this.#roll : null;

		let cause = bySystem
			? "Spent by the system, with no attack or damage roll just before it."
			: "Not spent by a roll: changed some other way, such as by hand.";
		let warning = "";
		if (roll) {
			roll.taken += spent;
			cause = `${roll.kind} roll: ${roll.weapon}${roll.detail ? ` (${roll.detail})` : ""}.`;
			if (roll.taken > roll.expected) {
				warning = `Should have cost ${roll.expected}; ${roll.taken} taken for this roll.`;
			}
		}
		const asked = bySystem && this.#asked?.ammo === item.name ? this.#asked.rounds : null;

		const esc = foundry.utils.escapeHTML ?? ((s) => String(s).replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`));
		const unit = (Number(item.system?.shots?.max) > 1 ? "shot" : "round") + (after === 1 ? "" : "s");
		const content = `<div class="pip-ammo-log${warning ? " pip-ammo-log-warn" : ""}">
			<div class="pip-ammo-log-head"><strong>${esc(item.parent.name)}</strong>: ${esc(item.name)}</div>
			<div>${before} → ${after} ${unit} (−${spent})</div>
			<div class="pip-ammo-log-cause">${esc(cause)}</div>
			${asked !== null ? `<div class="pip-ammo-log-cause">The system asked for ${asked}.</div>` : ""}
			${warning ? `<div class="pip-ammo-log-alert">${esc(warning)}</div>` : ""}
			<div class="pip-ammo-log-by">${roll ? "Rolled" : "Changed"} by ${esc(game.user.name)}</div>
		</div>`;

		ChatMessage.create({
			speaker: { alias: "Ammunition Log" },
			content,
			whisper: game.users.filter((u) => u.isGM).map((u) => u.id),
		}).catch((err) => console.warn(`${MODULE_ID} | ammo log:`, err));
	}
}
