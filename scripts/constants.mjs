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
