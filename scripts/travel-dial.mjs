import { PipBoyApp } from "./PipBoyApp.mjs";

/**
 * The travel counter — a Vault-Tec encounter check displayed as three
 * mechanical number dials that spin up and settle one at a time, like the
 * odometer reels on an old machine.
 *
 * It replaces dice for travel checks: each hex spins the reels to that hex's
 * d100 result, and the settling animation is what paces the journey.
 */

/** Height of one digit cell, in px. Must match --pip-dial-digit in the CSS. */
const DIGIT_HEIGHT = 46;
/** Full 0-9 revolutions before a reel lands, so it reads as a spin-up. */
const SPIN_CYCLES = 7;
/** Where each reel lands within the spin budget: left settles first, right
 *  last, so the counter winds down like an odometer. */
const REEL_STOPS = [0.55, 0.78, 1];
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
				<div class="pip-dial-reels">
					${[0, 1, 2].map(() => `
						<div class="pip-dial-reel">
							<div class="pip-dial-strip">${this.#stripDigits()}</div>
						</div>`).join("")}
				</div>
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

	/** Enough repeats of 0-9 that a reel can spin SPIN_CYCLES times and land. */
	static #stripDigits() {
		let html = "";
		for (let i = 0; i <= SPIN_CYCLES + 1; i++) {
			for (let d = 0; d <= 9; d++) html += `<span class="pip-dial-digit">${d}</span>`;
		}
		return html;
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

		const digits = String(Math.max(0, Math.min(999, value))).padStart(3, "0").split("");
		const strips = [...el.querySelectorAll(".pip-dial-strip")];

		// Snap every reel back to the top with no transition, force a reflow so
		// the browser accepts the jump, then run the spin.
		for (const strip of strips) {
			strip.style.transition = "none";
			strip.style.transform = "translateY(0)";
		}
		void el.offsetHeight;

		strips.forEach((strip, i) => {
			const spin = budget * REEL_STOPS[i];
			const target = ((SPIN_CYCLES * 10) + Number(digits[i])) * DIGIT_HEIGHT;
			strip.style.transition = `transform ${spin}ms cubic-bezier(0.15, 0.85, 0.2, 1)`;
			strip.style.transform = `translateY(-${target}px)`;
			// A mechanical clunk as each reel drops into place.
			setTimeout(() => PipBoyApp.playSound("rollover"), spin);
		});

		// Resolves when the reels have landed. Callers may ignore it: the spin
		// is meant to run alongside the token's movement, not block it.
		this.#settled = new Promise((resolve) => {
			setTimeout(() => {
				resultEl.textContent = hit ? "ENCOUNTER" : "CLEAR";
				resultEl.classList.add(hit ? "hit" : "clear");
				if (hit) PipBoyApp.playSound("select");
				resolve();
			}, budget);
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
