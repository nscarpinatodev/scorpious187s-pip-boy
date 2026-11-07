import { MODULE_ID } from "./constants.mjs";

/**
 * The Pip-Boy Lonestar Edition: a landscape unit worn across the forearm, drawn
 * in SVG and CSS. The main screen sits on the left under the maker's plate, a
 * readout bay below it, and a column on the right holds the tab lever, the
 * radiation meter and the speaker. A TUNE wheel sits on the right edge.
 *
 * PipBoyApp renders the casing from `templates/lonestar.hbs` and owns
 * everything on the screen; this class runs the casing's own parts: the lever,
 * the meter, and the arm coming up and going away.
 *
 * Everything is drawn in the casing's own units: a 1200 x 900 drawing, of
 * which the window shows `VIEW`.
 */

/** The part of the drawing the window shows: the unit, and a little sleeve. */
const VIEW = { x: 100, y: 74, w: 1010, h: 772 };

/** The lever's stops, one per tab, top to bottom. */
const STOPS = [214, 256, 298, 340, 382];

/* ---- the radiation meter's face, in the meter's own units ---- */
const PIVOT = [587, 826];
const SWEEP = 50; // degrees either side of upright

const at = (frac, r) => {
	const a = ((-SWEEP + 2 * SWEEP * frac) * Math.PI) / 180;
	return [PIVOT[0] + r * Math.sin(a), PIVOT[1] - r * Math.cos(a)];
};
const arc = (from, to, r) => {
	const [x1, y1] = at(from, r);
	const [x2, y2] = at(to, r);
	return `M${x1.toFixed(1)} ${y1.toFixed(1)} A${r} ${r} 0 0 1 ${x2.toFixed(1)} ${y2.toFixed(1)}`;
};
const needleAngle = (frac) => (-SWEEP + 2 * SWEEP * Math.clamp(frac, -0.03, 1.03)).toFixed(2);

/** The drawing's fixed parts, worked out once. */
const ART = Object.freeze({
	stops: STOPS,
	vents: Array.from({ length: 25 }, (_, i) => 212 + 14 * i),
	detents: STOPS.map((y) => y - 1),
	grille: Array.from({ length: 6 }, (_, row) => Array.from({ length: 16 }, (__, i) => ({
		x: 840 + (row % 2 ? 6 : 0) + 12 * i,
		y: 704 + 12 * row,
	}))).flat(),
	zones: { safe: arc(0, 0.4, 86), warn: arc(0.4, 0.7, 86), hot: arc(0.7, 1, 86) },
	ticks: Array.from({ length: 21 }, (_, i) => {
		const major = i % 4 === 0;
		const [x1, y1] = at(i / 20, major ? 76 : 81);
		const [x2, y2] = at(i / 20, 91);
		const f = (n) => n.toFixed(1);
		return { x1: f(x1), y1: f(y1), x2: f(x2), y2: f(y2), width: major ? 2 : 1 };
	}),
	/** Where the six numbers on the face go; what they say is the character's. */
	numbers: [0, 0.2, 0.4, 0.6, 0.8, 1].map((frac) => {
		const [x, y] = at(frac, 64);
		return { frac, x: x.toFixed(1), y: (y + 3.5).toFixed(1) };
	}),
});

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const finished = (animation) => animation.finished.catch(() => {});
const calm = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;

export class LonestarCasing {
	static TEMPLATE = `modules/${MODULE_ID}/templates/lonestar.hbs`;
	static DEFS_TEMPLATE = `modules/${MODULE_ID}/templates/lonestar-defs.hbs`;

	/** Window width at 100%. The screen then comes out about as large as the
	 *  original casing's, so the tabs read the same in either. */
	static BASE_WIDTH = 1000;

	static VIEW = VIEW;

	/** Put the casing's shared paint and parts into the page, once. */
	static async ensureDefs() {
		if (document.getElementById("pbls-defs")) return;
		const html = await foundry.applications.handlebars.renderTemplate(LonestarCasing.DEFS_TEMPLATE, {});
		if (document.getElementById("pbls-defs")) return;
		document.body.insertAdjacentHTML("beforeend", html);
	}

	/** The Pip-Boy this casing belongs to. */
	#app;

	/** The casing's element, as of the last render. */
	#root = null;

	/** What is lit. Kept here, not in the DOM, so a re-render part way through
	 *  bringing the unit up doesn't switch a screen back on early. */
	#screenOn;
	#readoutOn;
	#contentOn;
	/** The meter reads only while the unit is on. */
	#powered;
	#closing = false;

	/** The meter: where the needle should read (0..1), and where it is. */
	#level = 0;
	#selfTestUntil = 0;
	#value = 0;
	#speed = 0;
	#counts = 0;
	#flashUntil = 0;
	#last = 0;
	#raf = null;
	#parts = {};

	/** The tab ids, top to bottom, as the lever's stops have them. */
	#tabs = [];

	#notch = 0;

	/**
	 * @param {PipBoyApp} app
	 * @param {object} [options]
	 * @param {boolean} [options.on]  Start switched on: the layout was changed
	 *                                while the Pip-Boy was already open.
	 */
	constructor(app, { on = false } = {}) {
		this.#app = app;
		this.#screenOn = this.#readoutOn = this.#contentOn = this.#powered = on;
	}

	/* -------------------------------------------- */
	/*  Rendering                                    */
	/* -------------------------------------------- */

	/**
	 * What the template needs for the casing.
	 * @param {object} data
	 * @param {object[]} data.tabs       The Pip-Boy's tabs, in order, each with `active`.
	 * @param {object} data.system       The actor's system data.
	 */
	context({ tabs, system }) {
		this.#tabs = tabs.map((t) => t.id);
		const active = Math.max(0, tabs.findIndex((t) => t.active));

		// The meter reads the character's radiation against the HP it would have
		// without any: the fallout system takes each rad off maximum HP, so full
		// scale is the point where radiation has eaten the whole pool.
		const rads = Math.max(0, Number(system?.radiation) || 0);
		const maxHp = Math.max(0, Number(system?.health?.max) || 0);
		const full = (maxHp + rads) || 10;
		this.#level = Math.clamp(rads / full, 0, 1);

		return {
			...ART,
			tabs: tabs.map((t, i) => ({ ...t, y: STOPS[i] + 5 })),
			leverY: STOPS[active],
			numbers: ART.numbers.map((n) => ({ ...n, text: Math.round(full * n.frac) })),
			rads,
			full,
			needle: needleAngle(this.#value),
			dose: String(this.#counts).padStart(6, "0"),
			screenOn: this.#screenOn,
			readoutOn: this.#readoutOn,
			contentOn: this.#contentOn,
		};
	}

	/** After every render: find the new parts and wire up the lever. */
	attach(element) {
		const root = element.querySelector(".pip-lonestar");
		this.#root = root;
		if (!root) return;
		this.#parts = {
			needle: root.querySelector(".pbls-needle"),
			countLamp: root.querySelector(".pbls-count-lamp"),
			dose: root.querySelector(".pbls-dose"),
		};
		this.#sync();
		this.#wireSelector(root);

		// The TUNE wheel turns a notch when it's clicked (it opens the settings).
		const knurl = root.querySelector(".pbls-knurl");
		root.querySelector(".pbls-knob-hot")?.addEventListener("click", (event) => {
			this.#notch += event.shiftKey ? -1 : 1;
			if (knurl) knurl.style.transform = `translateY(${(((this.#notch % 2) + 2) % 2) * 3}px)`;
		});

		this.#last = 0;
		this.#raf ??= requestAnimationFrame(this.#frame);
	}

	/** Move the lever to a tab's stop (the labels light through `[data-tab]`). */
	showTab(tabId) {
		const i = this.#tabs.indexOf(tabId);
		const lever = this.#root?.querySelector(".pbls-lever");
		if (lever && i >= 0) lever.style.transform = `translateY(${STOPS[i]}px)`;
	}

	/** Switch everything off for good: the window is closing. */
	destroy() {
		this.#closing = true;
		if (this.#raf) cancelAnimationFrame(this.#raf);
		this.#raf = null;
		this.#root = null;
	}

	/** Bring the classes in line with what is lit. */
	#sync() {
		const root = this.#root;
		if (!root?.isConnected) return;
		root.classList.toggle("pbls-dark", !this.#contentOn);
		root.querySelector(".pbls-screen > .pbls-power")?.classList.toggle("shown", !this.#screenOn);
		root.querySelector(".pbls-readout > .pbls-power")?.classList.toggle("shown", !this.#readoutOn);
		if (this.#parts.dose) this.#parts.dose.textContent = String(this.#counts).padStart(6, "0");
	}

	/* -------------------------------------------- */
	/*  The selector                                 */
	/* -------------------------------------------- */

	/** The tab names are actions on the template; the lever and its slot are
	 *  wired here. Drag the lever and it snaps to the nearest stop. */
	#wireSelector(root) {
		const svg = root.querySelector("svg.pbls-live");
		const lever = root.querySelector(".pbls-lever");
		const slot = root.querySelector(".pbls-slot-hit");
		if (!svg || !lever) return;

		const svgY = (event) => {
			const matrix = svg.getScreenCTM()?.inverse();
			if (!matrix) return STOPS[0];
			return new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix).y;
		};
		const nearest = (y) => STOPS.reduce((best, s, i) => (Math.abs(s - y) < Math.abs(STOPS[best] - y) ? i : best), 0);
		const choose = (i) => {
			const tab = this.#tabs[i];
			if (tab) this.#app.selectTab(tab);
			// Same tab, or none: still settle the lever back into its stop.
			this.showTab(this.#app.activeTab);
		};

		slot?.addEventListener("click", (event) => choose(nearest(svgY(event))));
		lever.addEventListener("pointerdown", (event) => {
			if (event.button !== 0) return;
			event.preventDefault();
			event.stopPropagation();
			lever.setPointerCapture(event.pointerId);
			lever.classList.add("dragging");
			const move = (ev) => {
				const y = Math.clamp(svgY(ev), STOPS[0], STOPS.at(-1));
				lever.style.transform = `translateY(${y}px)`;
			};
			const up = (ev) => {
				lever.removeEventListener("pointermove", move);
				lever.removeEventListener("pointerup", up);
				lever.removeEventListener("pointercancel", up);
				lever.classList.remove("dragging");
				choose(nearest(svgY(ev)));
			};
			lever.addEventListener("pointermove", move);
			lever.addEventListener("pointerup", up);
			lever.addEventListener("pointercancel", up);
		});
	}

	/* -------------------------------------------- */
	/*  The radiation meter                          */
	/* -------------------------------------------- */

	#frame = (now) => {
		this.#raf = requestAnimationFrame(this.#frame);
		const dt = this.#last ? Math.min(0.05, (now - this.#last) / 1000) : 0;
		this.#last = now;
		const still = calm();
		const level = !this.#powered ? 0 : (now < this.#selfTestUntil ? 1 : this.#level);

		// Counts arrive at random, more often the hotter it reads.
		if (this.#powered && dt > 0) {
			const rate = 0.5 + 70 * Math.pow(level, 1.6);
			if (Math.random() < 1 - Math.exp(-rate * dt)) {
				this.#counts = (this.#counts + 1) % 1000000;
				if (this.#parts.dose) this.#parts.dose.textContent = String(this.#counts).padStart(6, "0");
				this.#flashUntil = now + 45;
				if (!still) this.#speed += 0.25 + Math.random() * 0.35;
				this.#click();
			}
		}
		this.#parts.countLamp?.setAttribute("fill", now < this.#flashUntil ? "url(#pbls-countOn)" : "#3a1a12");

		// The needle: a damped spring toward the reading, wandering a little.
		const wander = still || !this.#powered ? 0 : 0.025 * Math.sin(now / 900) + 0.015 * Math.sin(now / 237);
		this.#speed += ((level + wander - this.#value) * 60 - this.#speed * 9) * dt;
		this.#value += this.#speed * dt;
		this.#parts.needle?.setAttribute("transform", `rotate(${needleAngle(this.#value)} ${PIVOT[0]} ${PIVOT[1]})`);
	};

	/** A Geiger click: a few milliseconds of noise through a high-pass filter.
	 *  Only with the module's sounds on and the clicks asked for. */
	#click() {
		if (!game.settings.get(MODULE_ID, "uiSounds") || !game.settings.get(MODULE_ID, "geigerClicks")) return;
		const ctx = game.audio?.interface;
		if (!ctx || ctx.state !== "running") return;
		const len = Math.floor(ctx.sampleRate * 0.004);
		const buffer = ctx.createBuffer(1, len, ctx.sampleRate);
		const data = buffer.getChannelData(0);
		for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
		const source = ctx.createBufferSource();
		source.buffer = buffer;
		const filter = ctx.createBiquadFilter();
		filter.type = "highpass";
		filter.frequency.value = 1800;
		const gain = ctx.createGain();
		gain.gain.value = 0.35 * (game.settings.get(MODULE_ID, "uiVolume") ?? 0.8);
		source.connect(filter).connect(gain).connect(ctx.gainNode ?? ctx.destination);
		source.start();
	}

	/* -------------------------------------------- */
	/*  Bringing it up and putting it away           */
	/* -------------------------------------------- */

	/** A screen's cover, as of now (a re-render replaces it). */
	#cover(which) {
		const sel = which === "screen" ? ".pbls-screen > .pbls-power" : ".pbls-readout > .pbls-power";
		return this.#root?.querySelector(sel) ?? null;
	}

	/** A CRT coming on: a point, a line, then the picture opening from it. */
	async #powerOn(which) {
		const cover = this.#cover(which);
		const line = cover?.querySelector("i");
		if (cover && line) {
			for (const a of [...cover.getAnimations(), ...line.getAnimations()]) a.cancel();
			if (calm()) {
				await finished(cover.animate([{ opacity: 1 }, { opacity: 0 }], { duration: 250, fill: "forwards" }));
			} else {
				await finished(line.animate(
					[{ transform: "scale(0, 1)", opacity: 1 }, { transform: "scale(1, 1)", opacity: 1 }],
					{ duration: 140, easing: "ease-out", fill: "forwards" },
				));
				line.animate(
					[{ transform: "scale(1, 1)", opacity: 1 }, { transform: "scale(1, 120)", opacity: 0 }],
					{ duration: 260, easing: "ease-in", fill: "forwards" },
				);
				await finished(cover.animate(
					[{ opacity: 1 }, { opacity: 1, offset: 0.3 }, { opacity: 0 }],
					{ duration: 320, fill: "forwards" },
				));
			}
		}
		if (which === "screen") this.#screenOn = true;
		else this.#readoutOn = true;
		this.#sync();
		for (const a of [...(cover?.getAnimations() ?? []), ...(line?.getAnimations() ?? [])]) a.cancel();
	}

	/** And going off: the picture squeezes to a line, the line to a point. */
	async #powerOff(which) {
		const cover = this.#cover(which);
		const line = cover?.querySelector("i");
		if (!cover || !line) return;
		for (const a of [...cover.getAnimations(), ...line.getAnimations()]) a.cancel();
		if (calm()) {
			await finished(cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 250, fill: "forwards" }));
			return;
		}
		cover.animate([{ opacity: 0 }, { opacity: 1 }], { duration: 160, fill: "forwards" });
		await finished(line.animate([
			{ transform: "scale(1, 140)", opacity: 0 },
			{ transform: "scale(1, 1)", opacity: 1, offset: 0.45 },
			{ transform: "scale(.012, 1.6)", opacity: 1, offset: 0.8 },
			{ transform: "scale(0, 0)", opacity: 0 },
		], { duration: 420, easing: "ease-in", fill: "forwards" }));
	}

	/** The arm, swinging in from below or dropping away. */
	#swing(element, up) {
		if (calm()) {
			return element.animate(up ? [{ opacity: 0 }, { opacity: 1 }] : [{ opacity: 1 }, { opacity: 0 }],
				{ duration: 250, fill: up ? "none" : "forwards" });
		}
		// `translate` and `rotate` rather than `transform`, which Foundry uses
		// for a window's scale.
		const origin = "30% 140%";
		const low = { translate: "0 105%", rotate: "-7deg", transformOrigin: origin };
		const rest = { translate: "0 0", rotate: "0deg", transformOrigin: origin };
		return up
			? element.animate([low, { translate: "0 -1.5%", rotate: ".8deg", transformOrigin: origin, offset: 0.78 }, rest],
				{ duration: 700, easing: "cubic-bezier(.2, .75, .3, 1)" })
			: element.animate([rest, { translate: "0 -2%", rotate: ".6deg", transformOrigin: origin, offset: 0.2 }, low],
				{ duration: 560, easing: "cubic-bezier(.5, 0, .75, .3)", fill: "forwards" });
	}

	/**
	 * The unit comes up: the arm swings into view, the main screen comes on, and
	 * then the module's own PIP-OS boot runs, with the activation sound timed to
	 * it as before. The readout comes on with the boot's PIP-OS header and the
	 * meter's needle sweeps full scale and back as a self-test.
	 *
	 * @param {object} options
	 * @param {Function|null} options.boot   Runs the boot; null when it is off.
	 *                                       Takes `{onHeader}` and resolves when the boot ends.
	 * @param {Function} options.activate    Plays the activation sound.
	 */
	async bringUp({ boot, activate }) {
		const element = this.#app.element;
		this.#screenOn = this.#readoutOn = this.#contentOn = this.#powered = false;
		this.#sync();
		if (!boot) activate();
		if (element) await finished(this.#swing(element, true));
		if (this.#closing) return;

		await this.#powerOn("screen");
		if (this.#closing) return;
		this.#powered = true;

		let readout = null;
		if (boot) {
			this.#selfTestUntil = performance.now() + 600;
			activate();
			await boot({ onHeader: () => { readout ??= this.#powerOn("readout"); } });
			if (this.#closing) return;
		}
		readout ??= this.#powerOn("readout");
		this.#contentOn = true;
		this.#sync();
		this.#root?.querySelector(".pipboy-content")?.animate(
			[{ opacity: 0, filter: "brightness(2.2)" }, { opacity: 1, filter: "none" }],
			{ duration: calm() ? 200 : 260 },
		);
		await readout;
	}

	/** And away: both screens collapse to a line and a point, then the arm drops. */
	async putAway() {
		this.#closing = true;
		const element = this.#app.element;
		await Promise.all([this.#powerOff("screen"), wait(90).then(() => this.#powerOff("readout"))]);
		this.#powered = false;
		if (element) await finished(this.#swing(element, false));
	}
}
