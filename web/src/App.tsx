import { lazy, Suspense, useEffect } from "react";
import { useStore } from "./store";
import Home from "./components/Home";

/** 3D 世界（three.js）按需加载：首页不背 3D 首包。 */
const World = lazy(() => import("./components/World"));

export default function App() {
  const view = useStore((s) => s.view);
  const toast = useStore((s) => s.toast);
  const loadWorlds = useStore((s) => s.loadWorlds);

  useEffect(() => {
    loadWorlds().catch(() => null);

    const sync = async () => {
      const m = location.hash.match(/^#world\/([^/]+)(?:\/(node|building)\/([^/]+))?$/);
      if (!m) return;
      const [, worldId, kind, id] = m;
      try {
        await useStore.getState().openWorld(worldId);
        if (kind === "node" && id) await useStore.getState().openNode(id);
        if (kind === "building" && id) await useStore.getState().openBuilding(id);
      } catch {
        /* 世界不存在时回到列表 */
      }
    };
    sync();
    window.addEventListener("hashchange", sync);
    return () => window.removeEventListener("hashchange", sync);
  }, [loadWorlds]);

  return (
    <>
      <Suspense fallback={<div style={{ padding: 24 }}>加载世界…</div>}>
        {view === "home" ? <Home /> : <World />}
      </Suspense>
      {toast && <div className="toast">{toast}</div>}
    </>
  );
}
