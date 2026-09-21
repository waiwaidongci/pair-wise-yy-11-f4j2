import { useEffect, useState } from "react";
import "./styles.css";
import { useConsole } from "./state/useConsole";
import { TaskForm } from "./components/TaskForm";
import { PumpPanel } from "./components/PumpPanel";
import { SlotsPanel } from "./components/SlotsPanel";
import { QueuePanel } from "./components/QueuePanel";
import { SignoffPanel } from "./components/SignoffPanel";
import { HistoryPanel } from "./components/HistoryPanel";
import { FLOW_LIMIT_LMIN, TEMP_LIMIT_C } from "./domain/rules";

type Tab = "console" | "queue" | "signoff" | "history";

const TABS: { key: Tab; label: string }[] = [
  { key: "console", label: "联动工位" },
  { key: "queue", label: "待检 / 队列" },
  { key: "signoff", label: "签收复核" },
  { key: "history", label: "履历查询" },
];

function App() {
  const api = useConsole();
  const [tab, setTab] = useState<Tab>("console");
  const [tick, setTick] = useState(0);

  // 每 15 秒刷新一次，让进行段计时与泵实时判定保持新鲜
  useEffect(() => {
    const timer = window.setInterval(() => setTick((n) => n + 1), 15000);
    return () => window.clearInterval(timer);
  }, []);

  const counts: Record<Tab, number> = {
    console: api.derived.filling.length,
    queue: api.derived.inspection.length + api.derived.ready.length + api.derived.rework.length,
    signoff: api.derived.filled.length,
    history: 0,
  };

  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62010 · 充填泵冷却水联动台</p>
        <h1>潜水气瓶充填 · 冷却水联动控制台</h1>
        <span>
          每个任务绑定泵编号、冷却水温/流量与滤芯更换日；水温 &gt; {TEMP_LIMIT_C}℃、流量 &lt; {FLOW_LIMIT_LMIN}L/min 或滤芯超期时只进设备待检，
          不占充填位。充填中越线暂停并记录已用时长与当前压力，他人复核后续充、续充时间单独累加；签收前双项实测，越限即返工。
        </span>
      </section>

      <nav className="tabs">
        {TABS.map((t) => (
          <button key={t.key} className={tab === t.key ? "tab active" : "tab"} onClick={() => setTab(t.key)}>
            {t.label}
            {counts[t.key] > 0 && <span className="tab-count">{counts[t.key]}</span>}
          </button>
        ))}
        <button className="reset" onClick={api.reset}>恢复演示数据</button>
      </nav>

      {tab === "console" && (
        <>
          <TaskForm api={api} />
          <SlotsPanel api={api} tick={tick} />
          <PumpPanel api={api} />
        </>
      )}
      {tab === "queue" && <QueuePanel api={api} />}
      {tab === "signoff" && <SignoffPanel api={api} />}
      {tab === "history" && <HistoryPanel api={api} />}

      <div className="toasts">
        {api.toasts.map((t) => (
          <div key={t.id} className={`toast ${t.ok ? "ok" : "bad"}`}>
            {t.ok ? "✓ " : "⚠ "}
            {t.message}
          </div>
        ))}
      </div>
    </main>
  );
}

export default App;
