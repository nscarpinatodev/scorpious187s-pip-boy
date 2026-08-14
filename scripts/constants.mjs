/**
 * Shared constants. Kept in a dependency-free leaf module so importing it can
 * never create an import cycle (module.mjs ⇄ PipBoyApp.mjs), which would put
 * these values in the temporal dead zone during load.
 */
export const MODULE_ID = "scorpious187s-pip-boy";

/** Available Pip-Boy frame colours (matching files in /frames). */
export const FRAME_COLORS = [
	"green", "blue", "bronze", "beige", "gray", "purple", "red", "yellow",
];

/** Phosphor screen colour per frame (mirrors the .pip-tint-* CSS variables).
 *  Used for the Pip-Boy token light when it matches the screen. */
export const TINT_COLORS = {
	green: "#35ff7b",
	blue: "#43d4ff",
	bronze: "#ffb454",
	beige: "#ffd9a0",
	gray: "#c9d6cd",
	purple: "#c58bff",
	red: "#ff5f57",
	yellow: "#ffe14d",
};

/** The classic Pip-Boy phosphor green — default colour for the light. */
export const FALLOUT_GREEN = "#35ff7b";
