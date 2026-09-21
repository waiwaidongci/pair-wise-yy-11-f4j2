import "./styles.css";
import { ConsoleProvider, useConsole } from "./state/ConsoleContext";
import { Metrics } from "./components/Metrics";
import { PumpPanel } from "./components/PumpPanel";
import { TaskForm } from "./components/TaskForm";
import { Stations } from "./components/Stations";
import { QueuePanel } from "./components/QueuePanel";
import { SignoffPanel } from "./components/SignoffPanel";
import { HistoryPanel } from "./components/HistoryPanel";

function ResetButton() {
  const { dispatch } = useConsole();
  return (
    <button
      className="ghost"
      onClick={() => {
        if (window.confirm("恢复演示数据？当前任务与履历将被清除。")) {
          dispatch({ type: "RESET_DEMO" });
        }
      }}
    >
      恢复演示数据
    </button>
  );
}

function Console() {
  return (
    <main className="app">
      <section className="hero">
        <p>hxyfront-62010 · 潜水气瓶充填 · Port 62010</p>
        <h1>充填泵冷却水联动台</h1>
        <span>
          待充任务绑定泵编号与冷却水状态：温度高于 35℃、流量低于 6L/min
          或滤芯超期，任务只进设备待检、不得占用充填位；充填中越线自动暂停并记录已用时长与当前压力，由另一人复核后续充（续充时间单独累加）；签收前复核实测压力与氧浓度，任一越限转返工。
        </span>
      </section>

      <Metrics />

      <PumpPanel />

      <div className="work-section">
        <TaskForm />
      </div>

      <Stations />

      <QueuePanel />

      <SignoffPanel />

      <HistoryPanel />

      <footer className="foot">
        <span>泵判定（domain 纯函数） · 任务落盘（state + localStorage） · 页面呈现（components）三层分离</span>
        <ResetButton />
      </footer>
    </main>
  );
}

export default function App() {
  return (
    <ConsoleProvider>
      <Console />
    </ConsoleProvider>
  );
}
