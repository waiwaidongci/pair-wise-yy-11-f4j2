import { useMemo, useState } from "react";
import { useConsole } from "../state/ConsoleContext";
import { formatClock, type HistoryKind } from "../domain/types";
import { Panel } from "./ui";

const KIND_LABEL: Record<HistoryKind, string> = {
  CREATED: "建单",
  GATE_BLOCKED: "入台拦截",
  FILL_STARTED: "开始充填",
  GATE_PAUSE: "越线暂停",
  MANUAL_PAUSE: "人工暂停",
  RECHECKED: "复判",
  RESUMED: "复核续充",
  FILL_DONE: "充填到位",
  SIGNED: "签收",
  SIGNOFF_FAIL: "签收越限",
  REWORK_REQUEUE: "返工回流",
  FILTER_CHANGED: "换滤芯",
  PUMP_READING: "泵读数",
};

const KIND_TONE: Record<HistoryKind, string> = {
  CREATED: "info",
  GATE_BLOCKED: "bad",
  FILL_STARTED: "ok",
  GATE_PAUSE: "bad",
  MANUAL_PAUSE: "warn",
  RECHECKED: "info",
  RESUMED: "ok",
  FILL_DONE: "ok",
  SIGNED: "ok",
  SIGNOFF_FAIL: "bad",
  REWORK_REQUEUE: "warn",
  FILTER_CHANGED: "info",
  PUMP_READING: "mute",
};

export function HistoryPanel() {
  const { state } = useConsole();
  const [pumpFilter, setPumpFilter] = useState("ALL");

  const events = useMemo(
    () =>
      pumpFilter === "ALL"
        ? state.history
        : state.history.filter((h) => h.pumpId === pumpFilter || !h.pumpId),
    [state.history, pumpFilter]
  );

  return (
    <Panel
      title="设备履历"
      subtitle="只追加不改写：判定、暂停、复核、续充、签收全留痕，刷新后仍一致"
      extra={
        <select
          value={pumpFilter}
          onChange={(e) => setPumpFilter(e.target.value)}
        >
          <option value="ALL">全部泵</option>
          {state.pumps.map((p) => (
            <option key={p.id} value={p.id}>
              {p.id}
            </option>
          ))}
        </select>
      }
    >
      <ol className="history">
        {events.slice(0, 60).map((h) => (
          <li key={h.id}>
            <time>{formatClock(h.at)}</time>
            <span className={`badge badge-${KIND_TONE[h.kind]}`}>
              {KIND_LABEL[h.kind]}
            </span>
            {h.pumpId && <span className="hist-pump">{h.pumpId}</span>}
            <span className="hist-msg">{h.message}</span>
          </li>
        ))}
      </ol>
    </Panel>
  );
}
