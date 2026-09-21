import { useState } from "react";
import { useConsole } from "../state/ConsoleContext";
import {
  O2_TOLERANCE_PCT,
  PRESSURE_TOLERANCE_BAR,
  formatClock,
  formatDuration,
  judgeSignoff,
  totalElapsedSeconds,
  type FillTask,
} from "../domain/types";
import { Badge, Empty, Panel } from "./ui";

function TimeSummary({ task }: { task: FillTask }) {
  const first = task.segments.filter((s) => s.kind === "首充");
  const cont = task.segments.filter((s) => s.kind === "续充");
  return (
    <p className="time-summary">
      首充 {first.map((s) => `${s.operator} ${formatDuration(s.seconds)}`).join("、") || "—"}
      {" ｜ "}续充{" "}
      {cont.length
        ? cont.map((s) => `${s.operator} ${formatDuration(s.seconds)}`).join("、")
        : "无"}
      {" ｜ "}总 {formatDuration(totalElapsedSeconds(task))}
    </p>
  );
}

function AwaitingRow({ task }: { task: FillTask }) {
  const { dispatch } = useConsole();
  const [pressure, setPressure] = useState(String(task.targetPressure));
  const [o2, setO2] = useState(String(task.targetO2));
  const [receiver, setReceiver] = useState("");
  const p = Number(pressure);
  const o = Number(o2);
  const preview =
    Number.isFinite(p) && Number.isFinite(o)
      ? judgeSignoff(task, p, o)
      : null;

  return (
    <article className="list-row signoff-row">
      <div className="row-main">
        <div className="tank-line">
          <strong>{task.tankNo}</strong>
          <Badge tone="warn">待签收核实</Badge>
          <Badge tone="mute">{task.pumpId}</Badge>
        </div>
        <p>
          {task.fillMode} · 目标 {task.targetPressure}bar / O₂ {task.targetO2}%
          {" "}· 允差 ±{PRESSURE_TOLERANCE_BAR}bar、±{O2_TOLERANCE_PCT}%
        </p>
        <TimeSummary task={task} />
      </div>
      <div className="signoff-form">
        <label>
          <span>实测压力 bar</span>
          <input
            inputMode="numeric"
            value={pressure}
            onChange={(e) => setPressure(e.target.value)}
          />
        </label>
        <label>
          <span>实测氧浓度 %</span>
          <input
            inputMode="decimal"
            value={o2}
            onChange={(e) => setO2(e.target.value)}
          />
        </label>
        <label>
          <span>签收人</span>
          <input value={receiver} onChange={(e) => setReceiver(e.target.value)} />
        </label>
        {preview && (
          <div className="verdict-preview">
            {preview.passed ? (
              <Badge tone="ok">核实通过，可签收</Badge>
            ) : (
              <Badge tone="bad">
                越限：{preview.failures.map((f) => f.detail).join("；")}，签收即转返工
              </Badge>
            )}
          </div>
        )}
        <button
          className="primary"
          disabled={!receiver.trim() || !preview}
          onClick={() =>
            dispatch({
              type: "SIGNOFF",
              taskId: task.id,
              receiver: receiver.trim(),
              measuredPressure: p,
              measuredO2: o,
            })
          }
        >
          提交签收核实
        </button>
      </div>
    </article>
  );
}

function ReworkRow({ task }: { task: FillTask }) {
  const { dispatch } = useConsole();
  const [operator, setOperator] = useState("");
  return (
    <article className="list-row rework-row">
      <div className="row-main">
        <div className="tank-line">
          <strong>{task.tankNo}</strong>
          <Badge tone="bad">返工</Badge>
        </div>
        {task.signoff && (
          <ul className="reject-facts">
            {task.signoff.failures.map((f, i) => (
              <li key={i} className="bad">
                {f.detail}
              </li>
            ))}
            <li className="muted">
              核实时 {formatClock(task.signoff.at)} · 实测 {task.signoff.measuredPressure}bar
              / O₂ {task.signoff.measuredO2}% · 签收人 {task.signoff.receiver}
            </li>
          </ul>
        )}
      </div>
      <div className="row-actions">
        <input
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          placeholder="返工处理人"
        />
        <button
          disabled={!operator.trim()}
          onClick={() =>
            dispatch({ type: "REQUEUE_REWORK", taskId: task.id, operator: operator.trim() })
          }
        >
          返工完成，重新入待充填
        </button>
      </div>
    </article>
  );
}

export function SignoffPanel() {
  const { state } = useConsole();
  const awaiting = state.tasks.filter((t) => t.status === "awaiting_signoff");
  const rework = state.tasks.filter((t) => t.status === "rework");
  const signed = state.tasks.filter((t) => t.status === "signed").slice(0, 5);

  return (
    <Panel
      title="签收核实与返工"
      subtitle={`签收前实测压力（±${PRESSURE_TOLERANCE_BAR}bar）与氧浓度（±${O2_TOLERANCE_PCT}%），任一越限转返工`}
    >
      <div className="stack">
        {awaiting.length === 0 && <Empty text="暂无待签收气瓶" />}
        {awaiting.map((t) => (
          <AwaitingRow key={t.id} task={t} />
        ))}
        {rework.map((t) => (
          <ReworkRow key={t.id} task={t} />
        ))}
      </div>

      {signed.length > 0 && (
        <div className="signed-list">
          <h3>最近签收</h3>
          {signed.map((t) => (
            <div key={t.id} className="signed-item">
              <Badge tone="ok">已签收</Badge>
              <span>
                {t.tankNo} · {t.signoff?.measuredPressure}bar / O₂{" "}
                {t.signoff?.measuredO2}% · {t.signoff?.receiver} ·{" "}
                {t.signoff ? formatClock(t.signoff.at) : ""}
              </span>
            </div>
          ))}
        </div>
      )}
    </Panel>
  );
}
