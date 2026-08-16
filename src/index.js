/** Client half of dsh-session-link: header copy button, `@session` mention
 * source, and the chip repaint for `@session-…` references.
 *
 * The bundle is wrapped by build.mjs into the client module loader's
 * `factory(require)` shape, so `require` here is the loader's resolver — the
 * one that hands back the host's own React. */
import { bindRuntime } from "./runtime.js";
import { startChipPainting } from "./chips.js";
import { registerSessionSource } from "./mention.js";
import { registerCopyButton } from "./copy-button.js";

bindRuntime(require);

export const name = "dsh-session-link";
export const inject = ["timer"];

export function apply(ctx) {
	const disposers = [];
	const slots = ctx.get("slots");
	if (slots !== undefined && typeof slots.inject === "function") {
		disposers.push(registerCopyButton(ctx, slots));
	}
	disposers.push(startChipPainting());
	disposers.push(registerSessionSource(ctx));
	return () => {
		for (const dispose of disposers) if (typeof dispose === "function") dispose();
	};
}
