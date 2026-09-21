import { useState } from "react";
import {
  FLOW_LIMIT_LMIN,
  TEMP_LIMIT_C,
  VIOLATION_LABELS,
  describeViolations,
  evaluatePump,
} from "../domain/rules";
import { localDateString } from "../domain/storage";
import type { ConsoleApi } from "../state/useConsole";
import type { Pump, Violation } from "../domain/types";

interface Props {
  api: ConsoleApi;
}

function PumpRow({ pump, api }: { pump: Pump; api: ConsoleApi }) {
  const result = evaluatePump(pump);
  const [editor, setEditor] = useState("");
  const [temp, setTemp] = useState(String(pump.waterTempC));
  const [flow, setFlow] = useState(String(pump.flowLmin));
  const [filterDay, setFilterDay] = useState(pump.filterChangedAt);
  const [serviceDays, setServiceDays] = useState(String(pump.filterServiceDays));
  const [note, setNote] = useState(pump.statusNote ?? "");

  const save = () => {
    if (!editor.trim()) {
      alert("请先填写维护/记录人姓名");
      return;
    }
    api.editPump(
      pump.id,
      {
        waterTempC: Number(temp),
        flowLmin: Number(flow),
        filterChangedAt: filterDay || localDateString(),
        filterServiceDays: Number(serviceDays) || 1,
        statusNote: note.trim(),
      },
      editor.trim()
    );
  };

  return (
    <article className={`pump-row ${result.ok ? "ok" : "bad"}`}>
      <header>
        <div>
          <h3>{pump.id} {pump.name}</h3>
          <span className={`badge ${result.ok ? "badge-ok" : "badge-bad"}`}>
            {result.ok ? "判定合格" : `越线：${describeViolations(result.violations)}`}
          </span>
        </div>
        <div className="live-params">
          <span className={pump.waterTempC > TEMP_LIMIT_C ? "num bad" : "num"}>
            水温 <b>{pump.waterTempC}</b>℃
          </span>
          <span className={pump.flowLmin < FLOW_LIMIT_LMIN ? "num bad" : "num"}>
            流量 <b>{pump.flowLmin}</b>L/min
          </span>
          <span className={result.daysLeft < 0 ? "num bad" : result.daysLeft <= 7 ? "num warn" : "num"}>
            滤芯 <b>{result.daysLeft < 0 ? `超期${-result.daysLeft}天` : `剩${result.daysLeft}天`}</b>
          </span>
        </div>
      </header>

      <div className="pump-edit">
        <label>
          <span>冷却水温(℃)</span>
          <input type="number" step="0.1" value={temp} onChange={(e) => setTemp(e.target.value)} onBlur={save} />
        </label>
        <label>
          <span>流量(L/min)</span>
          <input type="number" step="0.1" value={flow} onChange={(e) => setFlow(e.target.value)} onBlur={save} />
        </label>
        <label>
          <span>滤芯更换日</span>
          <input type="date" value={filterDay} onChange={(e) => setFilterDay(e.target.value)} onBlur={save} />
        </label>
        <label>
          <span>滤芯周期(天)</span>
          <input type="number" value={serviceDays} onChange={(e) => setServiceDays(e.target.value)} onBlur={save} />
        </label>
        <label>
          <span>设备备注</span>
          <input value={note} onChange={(e) => setNote(e.target.value)} onBlur={save} placeholder="维修、换水记录" />
        </label>
        <label>
          <span>记录人</span>
          <input value={editor} onChange={(e) => setEditor(e.target.value)} placeholder="改动参数需署名" />
        </label>
      </div>

      {result.violations.length > 0 && (
        <ul className="violation-list">
          {result.violations.map((v: Violation) => (
            <li key={v}>⚠ {VIOLATION_LABELS[v]}——处理后在待检清单复检</li>
          ))}
        </ul>
      )}
    </article>
  );
}

export function PumpPanel({ api }: Props) {
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>泵判定（与任务落盘、页面呈现分离）</p>
          <h2>充填泵冷却水联动判定</h2>
        </div>
        <span className="muted">改参数失焦即存盘并写设备履历</span>
      </div>
      <div className="pump-grid">
        {api.state.pumps.map((pump) => (
          <PumpRow key={pump.id} pump={pump} api={api} />
        ))}
      </div>
    </section>
  );
}
