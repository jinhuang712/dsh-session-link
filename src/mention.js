/** Register the `@` mention source named "session".
 *
 * The lexicon is every known session id, so the composer's `scanTextRefs`
 * decorates a pasted or typed `@session-<uuid>` into a chip. Candidates are
 * listed by session title (id as description) and stay in sync through the
 * session list subscription. Picking one inserts `@session-<uuid>`. */
const MAX_CANDIDATES = 20;

export function registerSessionSource(ctx) {
	const inputTriggers = ctx.get("inputTriggers");
	const sessions = ctx.get("sessions");
	if (inputTriggers === undefined || sessions === undefined) return undefined;
	if (typeof inputTriggers.registerSource !== "function" || sessions.list === undefined) return undefined;

	const source = {
		trigger: "@",
		name: "session",
		order: 30,
		lexicon: () => {
			const snap = sessions.list.getSnapshot();
			return snap && Array.isArray(snap.ids) ? snap.ids : [];
		},
		subscribeLexicon: (_session, listener) => sessions.list.subscribe(listener),
		candidates: (_session, args) => {
			const query = String((args && args.query) || "").toLowerCase();
			const snap = sessions.list.getSnapshot();
			const out = [];
			for (const id of source.lexicon()) {
				const summary = snap && snap.byId && snap.byId[id];
				const t = summary && summary.title;
				const title = typeof t === "string" && t !== "" ? t : id;
				if (query !== "" && !title.toLowerCase().includes(query) && !id.toLowerCase().includes(query)) continue;
				out.push({ name: title, id, description: id });
				if (out.length >= MAX_CANDIDATES) break;
			}
			return Promise.resolve(out);
		},
		onPick: ({ candidate }) => ({ text: "@" + (candidate && candidate.id ? candidate.id : candidate.name) + " " }),
		codec: {
			clipboardText: (ref) => "@" + ref,
			serialize: (ref) => Promise.resolve("@" + ref)
		}
	};
	return inputTriggers.registerSource(source);
}
