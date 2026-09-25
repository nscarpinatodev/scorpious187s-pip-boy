/**
 * Mechanical number reels — the odometer display used by the travel counter
 * and the XP award screen. A bank of reels spins up and settles left to right,
 * so a number arrives with a wind-down rather than simply appearing.
 *
 * The reel height is read from the `--pip-dial-digit` custom property on the
 * bank, so a caller can shrink the reels by setting that property in CSS.
 */

/** Full 0-9 revolutions before a reel lands, so it reads as a spin-up. */
const SPIN_CYCLES = 7;

/** Fallback reel height if the custom property can't be read (px). */
const FALLBACK_HEIGHT = 46;

/** The first reel lands this far into the spin budget; the last lands at 1. */
const FIRST_STOP = 0.55;

export class Reels {
	/** Markup for a bank of `count` reels, ready to be spun. */
	static markup(count) {
		const strip = Reels.#stripDigits();
		return `<div class="pip-dial-reels">${
			Array.from({ length: count }, () => `<div class="pip-dial-reel">`
				+ `<div class="pip-dial-strip">${strip}</div></div>`).join("")
		}</div>`;
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
	 * Spin a reel bank to a value.
	 * @param {HTMLElement} bank        The `.pip-dial-reels` element.
	 * @param {number} value            The number to land on. Digits beyond the
	 *                                  bank's width are dropped from the left.
	 * @param {object} [options]
	 * @param {number} [options.duration]  Spin budget in ms.
	 * @param {Function} [options.onLand]  Called as each reel lands.
	 * @returns {Promise<void>}         Resolves when the last reel has landed.
	 */
	static spin(bank, value, { duration = 2000, onLand } = {}) {
		if (!bank) return Promise.resolve();
		const strips = [...bank.querySelectorAll(".pip-dial-strip")];
		if (!strips.length) return Promise.resolve();

		const budget = Math.max(300, Number(duration) || 2000);
		const height = Reels.#digitHeight(bank);
		const digits = String(Math.max(0, Math.round(Number(value) || 0)))
			.padStart(strips.length, "0")
			.slice(-strips.length)
			.split("");

		// Snap every reel back to the top with no transition, force a reflow so
		// the browser accepts the jump, then run the spin.
		for (const strip of strips) {
			strip.style.transition = "none";
			strip.style.transform = "translateY(0)";
		}
		void bank.offsetHeight;

		strips.forEach((strip, i) => {
			const stop = strips.length > 1
				? FIRST_STOP + ((1 - FIRST_STOP) * (i / (strips.length - 1)))
				: 1;
			const spin = budget * stop;
			const target = ((SPIN_CYCLES * 10) + Number(digits[i])) * height;
			strip.style.transition = `transform ${spin}ms cubic-bezier(0.15, 0.85, 0.2, 1)`;
			strip.style.transform = `translateY(-${target}px)`;
			if (onLand) setTimeout(() => onLand(i), spin);
		});

		return new Promise((resolve) => { setTimeout(resolve, budget); });
	}

	/** Land a bank on a value with no animation — for a first paint. */
	static set(bank, value) {
		if (!bank) return;
		const strips = [...bank.querySelectorAll(".pip-dial-strip")];
		const height = Reels.#digitHeight(bank);
		const digits = String(Math.max(0, Math.round(Number(value) || 0)))
			.padStart(strips.length, "0")
			.slice(-strips.length)
			.split("");
		strips.forEach((strip, i) => {
			strip.style.transition = "none";
			strip.style.transform =
				`translateY(-${((SPIN_CYCLES * 10) + Number(digits[i])) * height}px)`;
		});
	}

	/** Reel height, from the CSS custom property so reels can be resized. */
	static #digitHeight(bank) {
		const raw = getComputedStyle(bank).getPropertyValue("--pip-dial-digit");
		return parseFloat(raw) || FALLBACK_HEIGHT;
	}
}
