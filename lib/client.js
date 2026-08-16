window.__ModuleLoader__.load({
  id: "dsh-mcp-bridge",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    const React = require("react");
    const { jsx, jsxs } = require("react/jsx-runtime");

    const CONTROL_URL = "http://127.0.0.1:6207/dsh-bridge/control";

    function BridgeToggle() {
      const [state, setState] = React.useState({ loading: true, saving: false, enabled: false, endpoint: "", error: null });
      const load = React.useCallback(async () => {
        try {
          const response = await fetch(CONTROL_URL);
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not read bridge state");
          setState((previous) => ({ ...previous, loading: false, saving: false, ...data, error: null }));
        } catch (error) {
          setState((previous) => ({ ...previous, loading: false, saving: false, error: error instanceof Error ? error.message : String(error) }));
        }
      }, []);
      React.useEffect(() => { load(); }, [load]);
      const toggle = async () => {
        setState((previous) => ({ ...previous, saving: true, error: null }));
        try {
          const response = await fetch(CONTROL_URL, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ enabled: !state.enabled }) });
          const data = await response.json();
          if (!response.ok) throw new Error(data.error || "Could not change bridge state");
          setState((previous) => ({ ...previous, saving: false, ...data, error: null }));
        } catch (error) {
          setState((previous) => ({ ...previous, saving: false, error: error instanceof Error ? error.message : String(error) }));
        }
      };
      return jsxs("div", { style: { display: "flex", alignItems: "center", justifyContent: "space-between", gap: "16px", padding: "14px 0", borderBottom: "1px solid var(--dsw-alias-border-secondary, #e5e7eb)" }, children: [
        jsxs("div", { children: [
          jsx("div", { style: { fontWeight: 500 }, children: "Codex Bridge" }),
          jsx("div", { style: { marginTop: "4px", color: "var(--dsw-alias-label-secondary, #6b7280)", fontSize: "12px" }, children: state.enabled ? `已连接：${state.endpoint}` : "已关闭；Codex 无法连接" }),
          state.error ? jsx("div", { role: "alert", style: { marginTop: "4px", color: "#dc2626", fontSize: "12px" }, children: state.error }) : null
        ] }),
        jsx("button", { type: "button", role: "switch", "aria-checked": state.enabled, disabled: state.loading || state.saving, onClick: toggle, style: { cursor: state.loading || state.saving ? "wait" : "pointer", minWidth: "58px", border: 0, borderRadius: "16px", padding: "7px 10px", color: "white", background: state.enabled ? "#16a34a" : "#6b7280" }, children: state.loading ? "加载中" : state.saving ? "切换中" : state.enabled ? "已开启" : "已关闭" })
      ] });
    }

    const inject = ["slots"];
    function apply(ctx) {
      ctx.slots.inject("settings.general.item", () => ctx.slots.register({ name: "settings.general.item", id: "dsh-mcp-bridge", order: 100 }, BridgeToggle));
    }
    exports.inject = inject;
    exports.apply = apply;
    return module.exports;
  }
});
