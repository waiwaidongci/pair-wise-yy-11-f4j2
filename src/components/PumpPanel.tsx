import { useState } from "react";
import { useConsole } from "../state/ConsoleContext";
import {
  FILTER_INTERVAL_DAYS,
  MAX_COOLANT_TEMP,
  MIN_COOLANT_FLOW,
  daysBetween,
  judgePump,
  todayISO,
  type Pump,
} from "../domain/types";
import { Badge, Panel } from "./ui";

function PumpCard({ pump }: { pump: Pump }) {
  const { dispatch } = useConsole();
  const [temp, setTemp] = useState(String(pump.coolantTemp));
  const [flow, setFlow] = useState(String(pump.coolantFlow));
  const [operator, setOperator] = useState("");
  const verdict = judgePump(pump);
  const usedDays = daysBetween(pump.filterChangedAt, todayISO());
  const filterDaysLeft = pump.filterIntervalDays - usedDays;

  const commitReadings = () => {
    const t = Number(temp);
    const f = Number(flow);
    if (Number.isNaN(t) || Number.isNaN(f)) return;
    dispatch({
      type: "UPDATE_PUMP_READING",
      pumpId: pump.id,
      patch: { coolantTemp: t, coolantFlow: f },
    });
  };

  const blockedBy = verdict.failures.map((x) => x.code);

  return (
    <article className={`pump-card ${verdict.ok ? "" : "pump-bad"}`}>
      <header>
        <div>
          <h3>
            {pump.id} · {pump.name}
          </h3>
          <small>
            滤芯 {pump.filterChangedAt} 更换 · 已用 {usedDays} 天 / 周期{" "}
            {pump.filterIntervalDays} 天
          </small>
        </div>
        {verdict.ok ? (
          <Badge tone="ok">联动合格</Badge>
        ) : (
          <Badge tone="bad">设备待检</Badge>
        )}
      </header>

      <div className="pump-readings">
        <label className={blockedBy.includes("TEMP_HIGH") ? "reading-bad" : ""}>
          <span>冷却水温度 ℃（红线 &gt; {MAX_COOLANT_TEMP}）</span>
          <input
            value={temp}
            inputMode="decimal"
            onChange={(e) => setTemp(e.target.value)}
            onBlur={commitReadings}
          />
        </label>
        <label className={blockedBy.includes("FLOW_LOW") ? "reading-bad" : ""}>
          <span>流量 L/min（红线 &lt; {MIN_COOLANT_FLOW}）</span>
          <input
            value={flow}
            inputMode="decimal"
            onChange={(e) => setFlow(e.target.value)}
            onBlur={commitReadings}
          />
        </label>
      </div>

      <ul className="gate-list">
        <li className={pump.coolantTemp > MAX_COOLANT_TEMP ? "bad" : "ok"}>
          温度 {pump.coolantTemp}℃ {pump.coolantTemp > MAX_COOLANT_TEMP ? "高于 35℃，越线" : "正常"}
        </li>
        <li className={pump.coolantFlow < MIN_COOLANT_FLOW ? "bad" : "ok"}>
          流量 {pump.coolantFlow}L/min {pump.coolantFlow < MIN_COOLANT_FLOW ? "低于 6L/min，越线" : "正常"}
        </li>
        <li className={filterDaysLeft < 0 ? "bad" : filterDaysLeft <= 14 ? "warn" : "ok"}>
          滤芯 {filterDaysLeft < 0 ? `已超期 ${-filterDaysLeft} 天` : `剩余 ${filterDaysLeft} 天`}
        </li>
      </ul>

      <div className="filter-row">
        <input
          placeholder="换芯操作人"
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
        />
        <button
          disabled={!operator.trim()}
          onClick={() => {
            dispatch({
              type: "CHANGE_FILTER",
              pumpId: pump.id,
              operator: operator.trim(),
            });
            setOperator("");
          }}
        >
          登记滤芯更换
        </button>
      </div>
    </article>
  );
}

export function PumpPanel() {
  const { state } = useConsole();
  const blockedCount = state.pumps.filter((p) => !judgePump(p).ok).length;
  return (
    <Panel
      title="充填泵冷却水联动台"
      subtitle={`设备层 · 判定红线 温度>${MAX_COOLANT_TEMP}℃ / 流量<${MIN_COOLANT_FLOW}L/min / 滤芯${FILTER_INTERVAL_DAYS}天`}
      extra={
        <Badge tone={blockedCount ? "bad" : "ok"}>
          {blockedCount ? `${blockedCount} 台待检` : "全部泵可用"}
        </Badge>
      }
    >
      <div className="pump-grid">
        {state.pumps.map((p) => (
          <PumpCard key={p.id} pump={p} />
        ))}
      </div>
    </Panel>
  );
}
