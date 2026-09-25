import { PipBoyApp } from "./PipBoyApp.mjs";
import { Reels } from "./reels.mjs";

/**
 * The travel counter — a Vault-Tec encounter check displayed as three
 * mechanical number dials that spin up and settle one at a time, like the
 * odometer reels on an old machine.
 *
 * It replaces dice for travel checks: each hex spins the reels to that hex's
 * d100 result, and the settling animation is what paces the journey.
 */

/** Spin budget when a caller doesn't supply one (ms). */
const DEFAULT_SPIN = 2000;
/** Beat after the last reel lands, so the result can be read. */
const READ_PAUSE = 600;

export class TravelDial {
	static #el = null;

	/** Resolves when the reels of the current spin have landed. */
	static #settled = Promise.resolve();

	static get isOpen() {
		return !!this.#el?.isConnected;
	}

	/** Build and show the counter. Safe to call repeatedly. */
	static open() {
		if (this.isOpen) return;
		const el = document.createElement("div");
		el.id = "pip-travel-dial";
		el.className = "pip-dial";
		el.innerHTML = `
			<div class="pip-dial-frame">
				<div class="pip-dial-head">
					<span class="pip-dial-title">VAULT-TEC WAYFARER</span>
					<span class="pip-dial-hex"></span>
				</div>
				${Reels.markup(3)}
				<div class="pip-dial-readout">
					<span class="pip-dial-target"></span>
					<span class="pip-dial-result"></span>
				</div>
			</div>`;
		document.body.appendChild(el);
		this.#el = el;
		// Fade in on the next frame so the transition actually runs.
		requestAnimationFrame(() => el.classList.add("visible"));
	}

	static close() {
		const el = this.#el;
		this.#el = null;
		if (!el?.isConnected) return;
		el.classList.remove("visible");
		setTimeout(() => el.remove(), 400);
	}

	/**
	 * Spin the reels to a value and resolve once they have settled.
	 * @param {number} value    The rolled total (0-100).
	 * @param {object} [info]   Context for the readout.
	 * @returns {Promise<void>}
	 */
	static roll(value, { chance = null, hex = null, hit = false, duration } = {}) {
		this.open();
		const el = this.#el;
		if (!el) return Promise.resolve();

		// The spin is sized to the time the token spends crossing a hex, so the
		// reels land as it arrives and the journey never waits on the counter.
		const budget = Math.max(500, Number(duration) || DEFAULT_SPIN);

		el.querySelector(".pip-dial-hex").textContent = hex ? `HEX ${hex}` : "";
		el.querySelector(".pip-dial-target").textContent =
			chance === null ? "" : `TARGET ${chance}% OR LESS`;
		const resultEl = el.querySelector(".pip-dial-result");
		resultEl.textContent = "";
		resultEl.className = "pip-dial-result";

		// Resolves when the reels have landed. Callers may ignore it: the spin
		// is meant to run alongside the token's movement, not block it.
		this.#settled = Reels.spin(el.querySelector(".pip-dial-reels"), value, {
			duration: budget,
			// A mechanical clunk as each reel drops into place.
			onLand: () => PipBoyApp.playSound("rollover"),
		}).then(() => {
			resultEl.textContent = hit ? "ENCOUNTER" : "CLEAR";
			resultEl.classList.add(hit ? "hit" : "clear");
			if (hit) PipBoyApp.playSound("select");
		});
		return this.#settled;
	}

	/** Wait for the reels in flight to land, then hold long enough to read. */
	static async settle() {
		await (this.#settled ?? Promise.resolve());
		await new Promise((resolve) => { setTimeout(resolve, READ_PAUSE); });
	}

	/** Show a closing line before the counter is dismissed. */
	static async finish(text) {
		if (!this.isOpen) return;
		await this.#settled.catch(() => {});
		const resultEl = this.#el.querySelector(".pip-dial-result");
		resultEl.textContent = text;
		resultEl.className = "pip-dial-result";
		await new Promise((resolve) => { setTimeout(resolve, READ_PAUSE); });
		this.close();
	}
}
