/** The header action: one click copies the current session's reference
 * `@session-<uuid>` to the clipboard. Pure clipboard work — no host call.
 * The all-ASCII id renders as a chip both in the composer (registered
 * @-source) and in sent bubbles (shape decoration + repaint). */
import { React } from "./runtime.js";

const LABEL = "🔗 复制 Session ID";
const DONE = "✓ 已复制 Session ID";
const TITLE = "一键复制当前会话引用 @session-id（输入框/气泡均为彩色 chip）";
const ARIA = "复制当前会话引用";

export function registerCopyButton(ctx, slots) {
	return slots.inject("conversation.session.header.actions", () => slots.register(
		{ name: "conversation.session.header.actions", id: "copy-session-link", order: 30, label: () => "复制 Session ID" },
		(props) => {
			const sessionId = props && props.sessionId;
			const onClick = (e) => {
				if (typeof sessionId !== "string" || sessionId === "") return;
				navigator.clipboard.writeText("@" + sessionId);
				const btn = e && e.currentTarget;
				if (btn) {
					btn.textContent = DONE;
					ctx.timeout(() => {
						btn.textContent = LABEL;
					}, 1500);
				}
			};
			return React.createElement("button", {
				type: "button",
				onClick,
				title: TITLE,
				"aria-label": ARIA,
				style: {
					display: "inline-flex",
					alignItems: "center",
					justifyContent: "center",
					minWidth: 28,
					height: 28,
					padding: "0 8px",
					borderRadius: 6,
					border: "1px solid transparent",
					background: "transparent",
					cursor: "pointer",
					fontSize: 13,
					color: "var(--dsw-alias-label-secondary, #888)"
				}
			}, LABEL);
		}
	));
}
