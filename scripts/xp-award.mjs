import { MODULE_ID } from "./constants.mjs";
import { PipBoyApp } from "./PipBoyApp.mjs";
import { Reels } from "./reels.mjs";

const { ApplicationV2, HandlebarsApplicationMixin } = foundry.applications.api;

/** Actor types that earn XP. */
const RECIPIENT_TYPES = new Set(["character", "robot"]);

/** Actor types that are worth XP. */
const FOE_TYPES = new Set(["npc", "creature"]);

/** Reels in the total display. 5 covers any plausible haul. */
const REEL_COUNT = 5;

/**
 * The XP award screen — a Vault-Tec tally shown to the GM when a combat ends.
 *
 * Every NPC and creature in the combat is listed with the XP the system already
 * derives for it (`system.level.rewardXP`, from its level and category), ticked
 * by default if it was marked defeated. The GM adjusts the tally and hands it
 * out; the running total spins up on the same mechanical reels the travel
 * counter uses.
 */
export class PipBoyXpAward extends HandlebarsApplicationMixin(ApplicationV2) {
	/** Combat id -> the roster captured before the combat was deleted. */
	static #snapshots = new Map();

	static DEFAULT_OPTIONS = {
		id: "pip-xp-award",
		classes: ["pip-xp-award"],
		tag: "div",
		window: {
			title: "Award XP",
			icon: "fas fa-arrow-up-right-dots",
			resizable: true,
		},
		position: { width: 460, height: "auto" },
		actions: {
			toggleFoe: PipBoyXpAward.#onToggleFoe,
			toggleRecipient: PipBoyXpAward.#onToggleRecipient,
			toggleSplit: PipBoyXpAward.#onToggleSplit,
			selectAll: PipBoyXpAward.#onSelectAll,
			selectDefeated: PipBoyXpAward.#onSelectDefeated,
			award: PipBoyXpAward.#onAward,
		},
	};

	static PARTS = {
		main: { template: `modules/${MODULE_ID}/templates/xp-award.hbs` },
	};

	#foes = [];
	#recipients = [];
	#split;
	/** Total at the last paint, so the reels only spin when it changes. */
	#lastTotal = null;

	constructor({ foes = [], recipients = [], ...options } = {}) {
		super(options);
		this.#foes = foes;
		this.#recipients = recipients;
		this.#split = game.settings.get(MODULE_ID, "xpSplit") === "split";
	}

	/* -------------------------------------------- */
	/*  Gathering                                    */
	/* -------------------------------------------- */

	/**
	 * Capture a combat's roster. Called before the combat is deleted, while its
	 * combatants are still readable.
	 */
	static snapshot(combat) {
		if (!game.user.isActiveGM) return;
		const foes = [];
		const recipients = [];

		for (const combatant of combat.combatants ?? []) {
			const actor = combatant.actor;
			if (!actor) continue;

			if (FOE_TYPES.has(actor.type)) {
				foes.push({
					uuid: actor.uuid,
					name: combatant.name ?? actor.name,
					img: combatant.img ?? actor.img,
					level: Number(actor.system?.level?.value) || 0,
					category: actor.system?.category ?? "normal",
					xp: Math.max(0, Number(actor.system?.level?.rewardXP) || 0),
					defeated: combatant.isDefeated,
					// Only what was actually put down counts by default; the GM
					// can tick anything that fled or was talked down.
					include: combatant.isDefeated,
				});
			}
			else if (RECIPIENT_TYPES.has(actor.type)) {
				recipients.push({
					uuid: actor.uuid,
					name: actor.name,
					img: actor.img,
					currentXP: Number(actor.system?.level?.currentXP) || 0,
					include: true,
				});
			}
		}

		if (foes.length || recipients.length) {
			PipBoyXpAward.#snapshots.set(combat.id, { foes, recipients });
		}
	}

	/** A combat ended: show the tally, if there is anything to tally. */
	static async onCombatEnd(combat) {
		if (!game.user.isActiveGM) return;
		const snapshot = PipBoyXpAward.#snapshots.get(combat.id);
		PipBoyXpAward.#snapshots.delete(combat.id);
		if (!game.settings.get(MODULE_ID, "xpOnCombatEnd")) return;
		if (!snapshot) return;

		const earned = snapshot.foes.reduce((sum, f) => sum + (f.include ? f.xp : 0), 0);
		// Nothing was defeated and nothing is worth anything: don't interrupt.
		if (!earned && !snapshot.foes.some((f) => f.xp > 0)) return;
		if (!snapshot.recipients.length) return;

		new PipBoyXpAward(snapshot).render({ force: true });
	}

	/** Open the screen by hand, from the current combat or an empty tally. */
	static open(combat = game.combat) {
		if (!game.user.isGM) {
			ui.notifications?.warn("Only the GM can award XP.");
			return null;
		}
		const foes = [];
		const recipients = [];
		for (const combatant of combat?.combatants ?? []) {
			const actor = combatant.actor;
			if (!actor) continue;
			if (FOE_TYPES.has(actor.type)) {
				foes.push({
					uuid: actor.uuid,
					name: combatant.name ?? actor.name,
					img: combatant.img ?? actor.img,
					level: Number(actor.system?.level?.value) || 0,
					category: actor.system?.category ?? "normal",
					xp: Math.max(0, Number(actor.system?.level?.rewardXP) || 0),
					defeated: combatant.isDefeated,
					include: combatant.isDefeated,
				});
			}
			else if (RECIPIENT_TYPES.has(actor.type)) {
				recipients.push({
					uuid: actor.uuid,
					name: actor.name,
					img: actor.img,
					currentXP: Number(actor.system?.level?.currentXP) || 0,
					include: true,
				});
			}
		}
		// No combat to read: offer every player-owned character instead.
		if (!recipients.length) {
			for (const actor of game.actors) {
				if (!RECIPIENT_TYPES.has(actor.type) || !actor.hasPlayerOwner) continue;
				recipients.push({
					uuid: actor.uuid,
					name: actor.name,
					img: actor.img,
					currentXP: Number(actor.system?.level?.currentXP) || 0,
					include: true,
				});
			}
		}
		const app = new PipBoyXpAward({ foes, recipients });
		app.render({ force: true });
		return app;
	}

	/* -------------------------------------------- */
	/*  Tally                                        */
	/* -------------------------------------------- */

	get total() {
		return this.#foes.reduce((sum, f) => sum + (f.include ? f.xp : 0), 0);
	}

	get takers() {
		return this.#recipients.filter((r) => r.include);
	}

	/** What one character walks away with. */
	get perHead() {
		const takers = this.takers.length;
		if (!takers) return 0;
		return this.#split ? Math.floor(this.total / takers) : this.total;
	}

	/* -------------------------------------------- */
	/*  Rendering                                    */
	/* -------------------------------------------- */

	async _prepareContext(options) {
		const context = await super._prepareContext(options);
		const categories = CONFIG.FALLOUT?.CREATURE_CATEGORIES ?? {};
		return {
			...context,
			foes: this.#foes.map((f) => ({
				...f,
				categoryLabel: categories[f.category]
					? game.i18n.localize(categories[f.category])
					: f.category,
			})),
			recipients: this.#recipients.map((r) => ({
				...r,
				gets: r.include ? this.perHead : 0,
			})),
			reels: Reels.markup(REEL_COUNT),
			total: this.total,
			perHead: this.perHead,
			split: this.#split,
			takerCount: this.takers.length,
			hasFoes: this.#foes.length > 0,
			hasRecipients: this.#recipients.length > 0,
			canAward: this.total > 0 && this.takers.length > 0,
		};
	}

	/** Scroll offsets of the two lists, captured before a re-render. */
	#scroll = [];

	_preRender(context, options) {
		this.#scroll = [...(this.element?.querySelectorAll(".pip-xp-list") ?? [])]
			.map((list) => list.scrollTop);
		return super._preRender(context, options);
	}

	_onRender(context, options) {
		super._onRender(context, options);
		// Ticking a row rebuilds the lists; put them back where they were, or a
		// long roster jumps to the top on every tick.
		this.element.querySelectorAll(".pip-xp-list").forEach((list, i) => {
			if (this.#scroll[i]) list.scrollTop = this.#scroll[i];
		});
		const bank = this.element.querySelector(".pip-dial-reels");
		if (!bank) return;
		// Only spin when the number actually moved; a re-render that changed
		// nothing shouldn't set the reels going again.
		if (this.#lastTotal === null) {
			Reels.spin(bank, this.total, {
				duration: 1400,
				onLand: () => PipBoyApp.playSound("rollover"),
			});
		}
		else if (this.#lastTotal !== this.total) {
			Reels.spin(bank, this.total, {
				duration: 700,
				onLand: () => PipBoyApp.playSound("rollover"),
			});
		}
		else Reels.set(bank, this.total);
		this.#lastTotal = this.total;
	}

	/* -------------------------------------------- */
	/*  Actions                                      */
	/* -------------------------------------------- */

	static #onToggleFoe(event, target) {
		const foe = this.#foes.find((f) => f.uuid === target.dataset.uuid);
		if (!foe) return;
		foe.include = !foe.include;
		PipBoyApp.playSound("select");
		this.render();
	}

	static #onToggleRecipient(event, target) {
		const recipient = this.#recipients.find((r) => r.uuid === target.dataset.uuid);
		if (!recipient) return;
		recipient.include = !recipient.include;
		PipBoyApp.playSound("select");
		this.render();
	}

	static #onToggleSplit() {
		this.#split = !this.#split;
		PipBoyApp.playSound("select");
		this.render();
	}

	static #onSelectAll() {
		const turningOn = this.#foes.some((f) => !f.include);
		for (const foe of this.#foes) foe.include = turningOn;
		PipBoyApp.playSound("select");
		this.render();
	}

	static #onSelectDefeated() {
		for (const foe of this.#foes) foe.include = foe.defeated;
		PipBoyApp.playSound("select");
		this.render();
	}

	static async #onAward() {
		const amount = this.perHead;
		const takers = this.takers;
		if (!amount || !takers.length) return;

		const awarded = [];
		for (const taker of takers) {
			const actor = await fromUuid(taker.uuid);
			if (!actor) continue;
			const current = Number(actor.system?.level?.currentXP) || 0;
			await actor.update({ "system.level.currentXP": current + amount });
			awarded.push({
				name: actor.name,
				total: current + amount,
				// The threshold is derived from the level, so it is current here.
				next: Number(actor.system?.level?.nextLevelXP) || 0,
			});
		}

		PipBoyApp.playSound("activate");
		await this.#postCard(amount, awarded);
		this.close();
	}

	async #postCard(amount, awarded) {
		const esc = foundry.utils.escapeHTML;
		const foes = this.#foes.filter((f) => f.include);
		const rows = awarded.map((a) => {
			const ready = a.next > 0 && a.total >= a.next;
			return `<li>${esc(a.name)} — ${a.total}${a.next ? ` / ${a.next}` : ""}`
				+ `${ready ? ' <strong class="pip-xp-ready">LEVEL UP</strong>' : ""}</li>`;
		});

		await ChatMessage.create({
			content: `<div class="pip-xp-card"><h3>+${amount} XP</h3>`
				+ (foes.length
					? `<p class="pip-xp-foes">${esc(foes.map((f) => f.name).join(", "))}</p>`
					: "")
				+ `<ul>${rows.join("")}</ul></div>`,
			flags: { [MODULE_ID]: { xpAward: true } },
		});
	}
}
