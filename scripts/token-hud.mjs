import { MODULE_ID } from "./constants.mjs";
import { PipBoyApp } from "./PipBoyApp.mjs";

/**
 * Add a Pip-Boy button to the Token HUD. In Foundry v13+ the `renderTokenHUD`
 * hook hands us the HUD application and the native HUD element.
 *
 * @param {foundry.applications.hud.TokenHUD} tokenHud
 * @param {HTMLElement} element
 */
export function registerTokenHudButton(tokenHud, element) {
	// `element` may be a jQuery object on older cores; normalise to a DOM node.
	const root = element instanceof HTMLElement ? element : element?.[0];
	if (!root) return;

	const actor = tokenHud?.actor ?? tokenHud?.object?.actor;
	if (!actor || actor.type !== "character") return;

	// Avoid duplicate buttons if the HUD re-renders.
	root.querySelector(`.${MODULE_ID}-hud-button`)?.remove();

	const doc = root.ownerDocument;
	const button = doc.createElement("button");
	button.type = "button";
	button.className = `control-icon ${MODULE_ID}-hud-button`;
	button.dataset.tooltip = "Pip-Boy";
	button.setAttribute("aria-label", "Open Pip-Boy");

	const icon = doc.createElement("i");
	icon.className = "fas fa-mobile-screen-button";
	icon.inert = true;
	button.append(icon);

	button.addEventListener("click", (event) => {
		event.preventDefault();
		event.stopPropagation();
		PipBoyApp.open(actor);
	});

	const column = root.querySelector(".col.left") ?? root;
	column.append(button);
}
