window.__ModuleLoader__.load({
	id: "dsh-session-link",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
var __defProp = Object.defineProperty;
var __getOwnPropDesc = Object.getOwnPropertyDescriptor;
var __getOwnPropNames = Object.getOwnPropertyNames;
var __hasOwnProp = Object.prototype.hasOwnProperty;
var __export = (target, all) => {
  for (var name2 in all)
    __defProp(target, name2, { get: all[name2], enumerable: true });
};
var __copyProps = (to, from, except, desc) => {
  if (from && typeof from === "object" || typeof from === "function") {
    for (let key of __getOwnPropNames(from))
      if (!__hasOwnProp.call(to, key) && key !== except)
        __defProp(to, key, { get: () => from[key], enumerable: !(desc = __getOwnPropDesc(from, key)) || desc.enumerable });
  }
  return to;
};
var __toCommonJS = (mod) => __copyProps(__defProp({}, "__esModule", { value: true }), mod);

// src/index.js
var index_exports = {};
__export(index_exports, {
  apply: () => apply,
  inject: () => inject,
  name: () => name
});
module.exports = __toCommonJS(index_exports);

// src/runtime.js
var React;
function bindRuntime(require2) {
  React = require2("react");
}

// src/chips.js
var SESSION_CHIP = "@session-";
function startChipPainting() {
  const paint = () => {
    for (const el of document.querySelectorAll("[data-ref-chip]")) {
      const text = (el.textContent || "").trim();
      if (!text.startsWith(SESSION_CHIP) || el.dataset.sessionLink !== void 0) continue;
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

// src/mention.js
var MAX_CANDIDATES = 20;
function registerSessionSource(ctx) {
  const inputTriggers = ctx.get("inputTriggers");
  const sessions = ctx.get("sessions");
  if (inputTriggers === void 0 || sessions === void 0) return void 0;
  if (typeof inputTriggers.registerSource !== "function" || sessions.list === void 0) return void 0;
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
      const query = String(args && args.query || "").toLowerCase();
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

// src/copy-button.js
var LABEL = "\u{1F517} \u590D\u5236 Session ID";
var DONE = "\u2713 \u5DF2\u590D\u5236 Session ID";
var TITLE = "\u4E00\u952E\u590D\u5236\u5F53\u524D\u4F1A\u8BDD\u5F15\u7528 @session-id\uFF08\u8F93\u5165\u6846/\u6C14\u6CE1\u5747\u4E3A\u5F69\u8272 chip\uFF09";
var ARIA = "\u590D\u5236\u5F53\u524D\u4F1A\u8BDD\u5F15\u7528";
function registerCopyButton(ctx, slots) {
  return slots.inject("conversation.session.header.actions", () => slots.register(
    { name: "conversation.session.header.actions", id: "copy-session-link", order: 30, label: () => "\u590D\u5236 Session ID" },
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

// src/index.js
bindRuntime(require);
var name = "dsh-session-link";
var inject = ["timer"];
function apply(ctx) {
  const disposers = [];
  const slots = ctx.get("slots");
  if (slots !== void 0 && typeof slots.inject === "function") {
    disposers.push(registerCopyButton(ctx, slots));
  }
  disposers.push(startChipPainting());
  disposers.push(registerSessionSource(ctx));
  return () => {
    for (const dispose of disposers) if (typeof dispose === "function") dispose();
  };
}
		return module.exports;
	}
});
//# sourceMappingURL=client.js.map
