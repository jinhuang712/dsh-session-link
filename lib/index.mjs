import { defineTool } from "@deepseek-ai/dsh-tools";

/**
 * dsh-session-link host half.
 *
 * Registers the `session_read` tool: the receiving side of a session
 * reference — any session that is handed `@session-<uuid>` (or a
 * `dsh-session:` URI, or `@title`) reads the referenced session and projects
 * it to readable conversation text. Read-only; live sessions are read through
 * `sessionQuery.readSession`, so nothing touches the on-disk logs. The client
 * copy button needs no host call (pure clipboard), hence no webServer routes.
 */

export const name = "dsh-session-link";
export const inject = ["tools"];

const DEFAULT_MAX_CHARS = 64000;
const RAW_LIMIT = 200000;

function textOf(blocks) {
	if (!Array.isArray(blocks)) return "";
	const out = [];
	for (const b of blocks) if (b && b.type === "text" && typeof b.text === "string") out.push(b.text);
	return out.join("\n").trim();
}

/** JSONL event stream -> `user:`/`assistant:` rows, skipping chunk, tool and
 *  reasoning noise. Whitespace events and unparsable lines are dropped. */
function project(content, maxChars, truncate) {
	const blocks = [];
	const rows = [];
	let header = null;
	for (const line of String(content).split("\n")) {
		if (!line.trim()) continue;
		let r;
		try { r = JSON.parse(line); } catch (e) { continue; }
		const t = r.type;
		if (t === "session") { header = r; continue; }
		if (t === "user/message") {
			const src = r.data && r.data.source;
			if (!src || src.kind !== "user") continue;
			const txt = textOf(r.data.content);
			if (txt) rows.push({ seq: r.seq, role: "user", text: txt });
		} else if (t === "assistant/message") {
			const txt = textOf(r.data && r.data.message && r.data.message.content);
			if (txt) rows.push({ seq: r.seq, role: "assistant", text: txt });
		} else if (t === "agent/inbox/spliced") {
			const txt = (r.data && r.data.inserted || []).map((i) => textOf(i && i.content)).filter(Boolean).join(" / ");
			if (txt) rows.push({ seq: r.seq, role: "inbox", text: txt });
		} else if (t === "session/title" && r.data && typeof r.data.title === "string") {
			if (header === null) header = {};
			header.title = r.data.title;
		}
	}
	if (header) {
		if (header.id) blocks.push("session: " + header.id);
		if (header.title) blocks.push("title: " + header.title);
		if (header.cwd) blocks.push("cwd: " + header.cwd);
		blocks.push("");
	}
	let total = 0;
	for (const row of rows) total += row.text.length;
	let kept = rows;
	const truncated = total > maxChars;
	if (truncated) {
		const keepCount = Math.max(1, Math.floor((maxChars / total) * rows.length));
		kept = truncate === "head" ? rows.slice(0, keepCount) : rows.slice(-keepCount);
		blocks.push("〔已截断：保留 " + kept.length + "/" + rows.length + " 条（" + truncate + "），原文 " + total + " 字符〕");
	}
	for (const row of kept) {
		const role = row.role === "assistant" ? "assistant" : row.role === "inbox" ? "user（注入）" : "user";
		blocks.push(role + ": " + row.text);
	}
	return {
		text: blocks.join("\n"),
		seqs: kept.length ? [kept[0].seq, kept[kept.length - 1].seq] : null,
		truncated,
		title: header && header.title ? header.title : null,
		cwd: header && header.cwd ? header.cwd : null
	};
}

function sessionLogText(snap) {
	return snap.events.map((e) => JSON.stringify(e)).join("\n");
}

/** Accept the three reference forms the plugin produces or a user types:
 *  `@session-<uuid>` (recommended), a `dsh-session:<b64>` URI, or `@title`. */
function parseRef(link) {
	const s = String(link || "").trim();
	const uri = s.match(/dsh-session:([A-Za-z0-9_-]+)/);
	if (uri) {
		try { return { kind: "id", id: JSON.parse(atob(uri[1].replace(/-/g, "+").replace(/_/g, "/"))) }; } catch (e) { /* fallthrough */ }
	}
	const idm = s.match(/@?session-[0-9a-fA-F-]{10,}/);
	if (idm) return { kind: "id", id: idm[0].replace(/^@/, "") };
	const at = s.match(/^@(.+)$/);
	if (at) return { kind: "title", title: at[1].trim() };
	if (/^session-[0-9a-fA-F-]{10,}$/.test(s)) return { kind: "id", id: s };
	return null;
}

/** Resolve `@title` to a session id. Exact match wins; ambiguity and misses
 *  come back with candidate titles so the caller can retry by id. Returns
 *  { id } or { error }. */
async function resolveTitle(ctx, title, signal) {
	const q = ctx.get("sessionQuery");
	if (q === undefined || typeof q.listSessions !== "function" || typeof q.readTitleSnapshots !== "function") {
		return { error: "this host cannot resolve titles — pass @session-<uuid> instead" };
	}
	let records;
	try {
		records = await q.listSessions(signal);
	} catch (error) {
		return { error: "listing sessions failed: " + String(error && error.message || error) };
	}
	const ids = [];
	for (const r of Array.isArray(records) ? records : []) {
		const id = r && r.header && r.header.id;
		if (typeof id === "string" && id !== "") ids.push(id);
	}
	let titled = [];
	try {
		const snapshots = await q.readTitleSnapshots(ids, signal);
		for (const s of Array.isArray(snapshots) ? snapshots : []) {
			if (!s || s.status !== "fulfilled" || !s.value) continue;
			const v = s.value;
			const id = v.header && v.header.id || s.sessionId;
			const t = v.title || v.header && v.header.title;
			if (typeof id === "string" && typeof t === "string" && t !== "") titled.push({ id, title: t });
		}
	} catch (error) {
		return { error: "reading session titles failed: " + String(error && error.message || error) };
	}
	const hits = titled.filter((t) => t.title === title);
	if (hits.length === 1) return { id: hits[0].id };
	const sample = titled.slice(0, 8).map((t) => t.title).join("、");
	if (hits.length === 0) {
		return { error: 'no session titled "' + title + '"' + (sample === "" ? "" : " — known titles: " + sample) };
	}
	return { error: 'title "' + title + '" matches ' + hits.length + " sessions — pick one by id: " + hits.map((h) => h.id).join(", ") };
}

/** The on-disk log path, resolved (not read) for the result payload. */
function locateLog(ctx, sessionId, cwd) {
	const persistence = ctx.get("sessionPersistence");
	if (persistence === undefined || typeof persistence.locate !== "function" || !cwd) return null;
	try { return persistence.locate({ id: sessionId, cwd }).path; } catch (e) { return null; }
}

export function apply(ctx) {
	const disposers = [];

	const tool = defineTool({
		name: "session_read",
		description: "读取本机任意 DSH 会话并投影为可读对话文本。输入是「复制引用」按钮复制的 @session-<uuid>（或 dsh-session: 链接、@标题）。只读，不修改源日志；live 优先，沙箱会话也可用。",
		parameters: {
			link: { type: "string", required: true, description: "会话引用：@session-<uuid> / dsh-session:URI / @标题" },
			maxChars: { type: "number", description: "投影文本预算，默认 64000" },
			truncate: { type: "string", description: "超预算保留策略：tail（默认，保最近）| head" },
			raw: { type: "boolean", description: "true 时返回原始 JSONL 前 200000 字符，调试用" }
		},
		output: {
			schema: {
				type: "object",
				additionalProperties: false,
				properties: {
					sessionId: { type: "string" },
					logPath: { oneOf: [{ type: "string" }, { type: "null" }] },
					title: { oneOf: [{ type: "string" }, { type: "null" }] },
					cwd: { oneOf: [{ type: "string" }, { type: "null" }] },
					seqRange: { oneOf: [{ type: "array", items: { type: "integer" } }, { type: "null" }] },
					transcript: { type: "string" },
					truncated: { type: "boolean" },
					error: { type: "object", additionalProperties: false, properties: { code: { type: "string" }, message: { type: "string" } } }
				}
			},
			render: (args, value) => [{ type: "text", text: value.transcript || (value.error ? "读取失败: " + value.error.message : "") }]
		},
		isConcurrencySafe: () => true,
		async execute(args, exec) {
			const maxChars = args && typeof args.maxChars === "number" ? args.maxChars : DEFAULT_MAX_CHARS;
			const truncate = args && args.truncate === "head" ? "head" : "tail";
			const raw = !!(args && args.raw);
			const parsed = parseRef(args && args.link);
			if (parsed === null) return { error: { code: "UNPARSEABLE", message: "无法识别：请输入 @session-<uuid> / dsh-session:URI / @标题" } };
			try {
				let sessionId = null;
				if (parsed.kind === "title") {
					const resolved = await resolveTitle(ctx, parsed.title, exec.signal);
					if (resolved.error) return { error: { code: "TITLE_UNRESOLVED", message: resolved.error } };
					sessionId = resolved.id;
				} else {
					sessionId = parsed.id;
				}
				const q = ctx.get("sessionQuery");
				const snap = q !== undefined && typeof q.readSession === "function" ? await q.readSession(sessionId, exec.signal) : null;
				if (snap === null) return { error: { code: "READ_FAILED", message: "sessionQuery unavailable" } };
				const text = sessionLogText(snap);
				if (raw) return { sessionId: snap.session && snap.session.id, transcript: text.slice(0, RAW_LIMIT), truncated: text.length > RAW_LIMIT };
				const p = project(text, maxChars, truncate);
				const cwd = snap.session && snap.session.cwd || null;
				return {
					sessionId: snap.session && snap.session.id,
					title: p.title,
					cwd,
					logPath: locateLog(ctx, sessionId, cwd),
					seqRange: p.seqs,
					transcript: p.text,
					truncated: p.truncated
				};
			} catch (error) {
				return { error: { code: "READ_FAILED", message: String(error && error.message || error) } };
			}
		}
	});

	if (ctx.tools !== undefined && typeof ctx.tools.register === "function") {
		disposers.push(ctx.tools.register(tool));
	}

	return () => {
		for (const d of disposers) d();
	};
}
