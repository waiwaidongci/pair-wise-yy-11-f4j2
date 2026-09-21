import { useState } from "react";
import { useConsole } from "../state/ConsoleContext";
import {
  daysBetween,
  judgePump,
  todayISO,
  type FillTask,
} from "../domain/types";
import { Badge, Empty, Panel } from "./ui";

function inspectionBadge(task: FillTask) {
  const days = daysBetween(todayISO(), task.inspectionDue);
  if (days < 0) return <Badge tone="bad">气瓶检验已过期</Badge>;
  if (days <= 30) return <Badge tone="warn">检验剩余 {days} 天</Badge>;
  return null;
}

function QueuedRow({ task }: { task: FillTask }) {
  const { state, dispatch } = useConsole();
  const [operator, setOperator] = useState(task.operator);
  const pump = state.pumps.find((p) => p.id === task.pumpId);
  const occupied = state.tasks.some(
    (t) =>
      (t.status === "filling" || t.status === "paused") &&
      t.pumpId === task.pumpId &&
      t.id !== task.id
  );

  return (
    <article className="list-row">
      <div className="row-main">
        <div className="tank-line">
          <strong>{task.tankNo}</strong>
          <Badge tone="info">{task.fillMode}</Badge>
          <Badge tone="mute">
            绑 {task.pumpId}
          </Badge>
          {inspectionBadge(task)}
        </div>
        <p>
          {task.volume} · 残压 {task.residualPressure} → 目标 {task.targetPressure}bar
          {task.fillMode !== "空气" ? ` · O₂ ${task.targetO2}%` : ""}
          {task.targetHe > 0 ? ` · He ${task.targetHe}%` : ""} · 操作员 {task.operator}
        </p>
      </div>
      <div className="row-actions">
        <input
          value={operator}
          onChange={(e) => setOperator(e.target.value)}
          placeholder="上岗操作人"
        />
        <button
          className="primary"
          disabled={!operator.trim() || occupied}
          title={occupied ? `${task.pumpId} 工位正被占用` : "占泵前会再次核泵"}
          onClick={() =>
            dispatch({ type: "START_FILL", taskId: task.id, operator: operator.trim() })
          }
        >
          {occupied ? "工位占用中" : `上 ${task.pumpId} 充填`}
        </button>
      </div>
    </article>
  );
}

function PendingRow({ task }: { task: FillTask }) {
  const { state, dispatch } = useConsole();
  const [reviewer, setReviewer] = useState("");
  const [note, setNote] = useState("");
  const pump = state.pumps.find((p) => p.id === task.pumpId);
  const verdict = pump ? judgePump(pump) : null;

  return (
    <article className="list-row pending">
      <div className="row-main">
        <div className="tank-line">
          <strong>{task.tankNo}</strong>
          <Badge tone="bad">设备待检</Badge>
          <Badge tone="mute">绑 {task.pumpId}</Badge>
          {inspectionBadge(task)}
        </div>
        {task.rejection && (
          <ul className="reject-facts">
            {task.rejection.failures.map((f, i) => (
              <li key={i} className="bad">
                {f.detail}
              </li>
            ))}
            <li className="muted">
              截下读数：{task.rejection.temp}℃ / {task.rejection.flow}L/min ·
              滤芯更换日 {task.rejection.filterChangedAt}
            </li>
          </ul>
        )}
        <p>
          {task.volume} · 残压 {task.residualPressure} → {task.targetPressure}bar ·
          任务操作员 {task.operator}
        </p>
      </div>
      <div className="row-actions column">
        <input
          value={reviewer}
          onChange={(e) => setReviewer(e.target.value)}
          placeholder="检修复判人"
        />
        <input
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="检修措施（调水温/疏通流量/换滤芯）"
        />
        <button
          disabled={!reviewer.trim()}
          onClick={() =>
            dispatch({
              type: "REINSPECT",
              taskId: task.id,
              reviewer: reviewer.trim(),
              note: note.trim(),
            })
          }
        >
          {verdict?.ok ? "复判合格，放回待充填" : "复判（泵仍越线则留待检）"}
        </button>
      </div>
    </article>
  );
}

export function QueuePanel() {
  const { state } = useConsole();
  const queued = state.tasks.filter((t) => t.status === "queued");
  const pending = state.tasks.filter((t) => t.status === "pending_check");

  return (
    <div className="two-col">
      <Panel
        title="待充填队列"
        subtitle="泵判定合格的任务，可占用充填位"
        extra={<Badge tone="ok">{queued.length} 个</Badge>}
      >
        <div className="stack">
          {queued.length === 0 && <Empty text="暂无合格待充任务" />}
          {queued.map((t) => (
            <QueuedRow key={t.id} task={t} />
          ))}
        </div>
      </Panel>

      <Panel
        title="设备待检清单"
        subtitle="温度/流量/滤芯越线任务只进这里，不占充填位"
        extra={<Badge tone="bad">{pending.length} 个</Badge>}
        className="pending-panel"
      >
        <div className="stack">
          {pending.length === 0 && <Empty text="没有被联动台拦下的任务" />}
          {pending.map((t) => (
            <PendingRow key={t.id} task={t} />
          ))}
        </div>
      </Panel>
    </div>
  );
}
