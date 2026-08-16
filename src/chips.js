/** Colour the shipped reference chips whose text starts with `@session-`.
 *
 * The shipped composer only decorates @-mentions that resolve against a
 * registered reference source, and the bubble decoration is shape-based and
 * faint. A MutationObserver repaints exactly these chips — never other
 * @-mentions such as subagent names — because pure CSS cannot select on
 * text content. Idempotent: a painted chip is tagged with a data attribute. */
const SESSION_CHIP = "@session-";

export function startChipPainting() {
	const paint = () => {
		for (const el of document.querySelectorAll("[data-ref-chip]")) {
			const text = (el.textContent || "").trim();
			if (!text.startsWith(SESSION_CHIP) || el.dataset.sessionLink !== undefined) continue;
			el.dataset.sessionLink = "1";
			el.style.background = "#2f6fce";
			el.style.color = "#ffffff";
			el.style.fontWeight = "600";
			el.style.borderRadius = "6px";
			el.style.padding = "0 8px";
		}
	};
	paint();
	const observer = new MutationObserver(paint);
	observer.observe(document.body, { childList: true, subtree: true });
	return () => observer.disconnect();
}
