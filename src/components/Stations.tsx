import { useState } from "react";
import { useConsole } from "../state/ConsoleContext";
import {
  daysBetween,
  formatDuration,
  judgePump,
  todayISO,
  totalElapsedSeconds,
  type FillTask,
  type Pump,
} from "../domain/types";
import { Badge, Empty, Panel } from "./ui";

function TankTag({ task }: { task: FillTask }) {
  const days = daysBetween(todayISO(), task.inspectionDue);
  return (
    <div className="tank-line">
      <strong>{task.tankNo}</strong>
      <Badge tone="info">{task.fillMode}</Badge>
      <Badge tone="mute">{task.volume}</Badge>
      {days < 0 ? (
        <Badge tone="bad">气瓶检验已过期</Badge>
      ) : days <= 30 ? (
        <Badge tone="warn">检验剩余 {days} 天</Badge>
      ) : null}
    </div>
  );
}

function TimeBreakdown({ task }: { task: FillTask }) {
  return (
    <div className="segments">
      {task.segments.map((s, i) => (
        <span key={i} className={`seg seg-${s.kind === "首充" ? "first" : "next"}`}>
          {s.kind} · {s.operator} · {formatDuration(s.seconds)}
        </span>
      ))}
      {task.activeOperator !== null && (
        <span className="seg seg-live">
          {task.segments.length === 0 ? "首充" : "续充"} · {task.activeOperator} ·{" "}
          {formatDuration(task.activeSeconds)}（计时中）
        </span>
      )}
      <span className="seg seg-total">
        总已用 {formatDuration(totalElapsedSeconds(task))}
      </span>
    </div>
  );
}

function FillingCard({ task, pump }: { task: FillTask; pump: Pump }) {
  const { dispatch } = useConsole();
  const [op, setOp] = useState(task.activeOperator ?? task.operator);
  const pct = Math.round(
    ((task.currentPressure - task.residualPressure) /
      (task.targetPressure - task.residualPressure)) *
      100
  );
  return (
    <article className="station-card filling">
      <header>
        <TankTag task={task} />
        <Badge tone="ok">充填中</Badge>
      </header>
      <p className="station-meta">
        占用 {pump.id}（{pump.name}）· {pump.coolantTemp}℃ / {pump.coolantFlow}L/min
      </p>
      <div className="pressure">
        <div className="pressure-bar">
          <i style={{ width: `${Math.max(0, Math.min(100, pct))}%` }} />
        </div>
        <b>
          {task.currentPressure} / {task.targetPressure} bar
        </b>
      </div>
      <TimeBreakdown task={task} />
      <div className="station-actions">
        <input
          value={op}
          onChange={(e) => setOp(e.target.value)}
          placeholder="暂停操作人"
        />
        <button
          disabled={!op.trim()}
          onClick={() =>
            dispatch({ type: "PAUSE_FILL", taskId: task.id, operator: op.trim() })
          }
        >
          紧急暂停（记入另一人复核）
        </button>
      </div>
    </article>
  );
}

function PausedCard({ task, pump }: { task: FillTask; pump: Pump }) {
  const { dispatch } = useConsole();
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState("");
  const verdict = judgePump(pump);
  const last = task.pauses[task.pauses.length - 1];
  const sameOperator = reviewer.trim() === (last?.operator ?? task.operator);

  const resume = () => {
    if (!reviewer.trim() || sameOperator || !verdict.ok) return;
    dispatch({
      type: "RESUME_FILL",
      taskId: task.id,
      reviewer: reviewer.trim(),
      note: note.trim(),
    });
    setReviewer("");
    setNote("");
  };

  return (
    <article className="station-card paused">
      <header>
        <TankTag task={task} />
        <Badge tone="bad">越线暂停</Badge>
      </header>
      {last && (
        <ul className="pause-facts">
          <li>
            暂停依据：{last.reasons.map((r) => r.detail).join("；")}
          </li>
          <li>
            已用时长 <b>{formatDuration(last.elapsedSeconds)}</b> · 当前压力{" "}
            <b>{last.pressureBar}bar</b> · 暂停操作人 {last.operator}
          </li>
        </ul>
      )}
      <TimeBreakdown task={task} />
      <div className="recheck-box">
        {!verdict.ok && (
          <p className="block-note">
            {pump.id} 仍越线（{verdict.failures.map((f) => f.detail).join("；")}
            ），先在泵台处理冷却水/滤芯
          </p>
        )}
        <input
          placeholder="复核人姓名（必须与暂停操作人不同）"
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
        />
        <input
          placeholder="复核处理说明（如降温后恢复、换滤芯）"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        {sameOperator && reviewer.trim() !== "" && (
          <p className="form-error">续充须由另一人复核，不能与暂停操作人相同</p>
        )}
        <button
          className="primary"
          disabled={!reviewer.trim() || sameOperator || !verdict.ok}
          onClick={resume}
        >
          复核后续充（续充时间单独累加）
        </button>
      </div>
    </article>
  );
}

export function Stations() {
  const { state } = useConsole();
  const active = state.tasks.filter(
    (t) => t.status === "filling" || t.status === "paused"
  );

  return (
    <Panel
      title="充填工位（泵 1:1 对应工位）"
      subtitle="呈现层 · 只有充填中/越线暂停任务挂在泵工位；设备待检任务不得占用充填位"
    >
      <div className="station-grid">
        {state.pumps.map((pump) => {
          const task = active.find((t) => t.pumpId === pump.id);
          if (!task) {
            const ok = judgePump(pump).ok;
            return (
              <article key={pump.id} className="station-card idle">
                <header>
                  <h3>
                    {pump.id} · {pump.name}
                  </h3>
                  {ok ? <Badge tone="mute">工位空闲</Badge> : <Badge tone="bad">泵待检</Badge>}
                </header>
                <p className="station-meta">
                  {pump.coolantTemp}℃ / {pump.coolantFlow}L/min
                </p>
                <Empty text={ok ? "可从待充填队列上泵" : "设备待检期间不可占用"} />
              </article>
            );
          }
          return task.status === "filling" ? (
            <FillingCard key={pump.id} task={task} pump={pump} />
          ) : (
            <PausedCard key={pump.id} task={task} pump={pump} />
          );
        })}
      </div>
    </Panel>
  );
}
