/** React is supplied by the client module loader at load time, not resolved at
 * build time — the plugin must share the host's single React instance, so
 * bundling our own copy would break hooks.
 *
 * Live binding: read it at call time, never destructure it at module scope,
 * because module bodies evaluate before bindRuntime runs. */
export let React;

/**
 * Bind the loader-supplied React.
 * @param require - the module loader's resolver, passed into the factory.
 */
export function bindRuntime(require) {
	React = require("react");
}
