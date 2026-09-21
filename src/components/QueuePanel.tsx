import { useState } from "react";
import { STATUS_LABELS, VIOLATION_LABELS, daysUntil, describeViolations, evaluatePump } from "../domain/rules";
import type { ConsoleApi } from "../state/useConsole";
import type { FillTask, Pump, Violation } from "../domain/types";

interface Props {
  api: ConsoleApi;
}

function TaskMeta({ task, pump }: { task: FillTask; pump?: Pump }) {
  const cylinderDays = daysUntil(task.inspectionDue);
  return (
    <div className="task-meta">
      <span>{task.volumeL}L · {task.targetPressure}bar · O₂ {task.o2}%{task.he > 0 ? ` · He ${task.he}%` : ""}</span>
      <span className={cylinderDays < 0 ? "bad" : cylinderDays <= 30 ? "warn" : ""}>
        气瓶检验{cylinderDays < 0 ? `已过期${-cylinderDays}天` : `剩${cylinderDays}天`}
      </span>
      <span>操作员 {task.operator}</span>
      {pump && <span className="muted">绑定 {pump.id}（建档快照：{describeViolations(task.precheck.violations) || "合格"}）</span>}
    </div>
  );
}

function InspectionList({ api }: { api: ConsoleApi }) {
  const [checker, setChecker] = useState<Record<string, string>>({});
  const list = api.derived.inspection;
  return (
    <div className="task-group">
      <h3>设备待检清单 <span className="count">{list.length}</span></h3>
      {list.length === 0 && <p className="muted">暂无待检任务。</p>}
      {list.map((task) => {
        const pump = api.state.pumps.find((p) => p.id === task.pumpId);
        const live = pump ? evaluatePump(pump) : null;
        return (
          <article key={task.id} className="task-card blocked">
            <div className="task-head">
              <strong>{task.code}</strong>
              <span className="badge badge-bad">{STATUS_LABELS[task.status]}</span>
            </div>
            <TaskMeta task={task} pump={pump} />
            <div className="violations">
              {task.precheck.violations.map((v: Violation) => (
                <span key={v} className="tag bad">{VIOLATION_LABELS[v]}</span>
              ))}
            </div>
            {pump && live && (
              <p className={live.ok ? "ok" : "bad"}>
                泵当前读数：水温 {pump.waterTempC}℃ / 流量 {pump.flowLmin}L/min / 滤芯
                {live.daysLeft < 0 ? `超期${-live.daysLeft}天` : `剩${live.daysLeft}天`}
                {live.ok ? " —— 已满足复检条件" : " —— 仍越线，继续处理"}
              </p>
            )}
            <div className="inline-action">
              <input
                placeholder="复检人姓名"
                value={checker[task.id] ?? ""}
                onChange={(e) => setChecker((m) => ({ ...m, [task.id]: e.target.value }))}
              />
              <button
                className="primary"
                disabled={!live?.ok}
                onClick={() => api.recheckTask(task.id, checker[task.id] ?? "")}
              >
                {live?.ok ? "处理完 · 复检上位" : "泵仍越线，不能复检"}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ReadyList({ api }: { api: ConsoleApi }) {
  const list = api.derived.ready;
  return (
    <div className="task-group">
      <h3>待充填队列（预检合格，等待占工位） <span className="count">{list.length}</span></h3>
      {list.length === 0 && <p className="muted">暂无等待上位的任务。</p>}
      {list.map((task) => {
        const pump = api.state.pumps.find((p) => p.id === task.pumpId);
        const occupied = pump && api.derived.occupiedByPump.has(pump.id);
        return (
          <article key={task.id} className="task-card">
            <div className="task-head">
              <strong>{task.code}</strong>
              <span className="badge badge-ok">{STATUS_LABELS[task.status]}</span>
            </div>
            <TaskMeta task={task} pump={pump} />
            <div className="inline-action">
              <button disabled={!!occupied} onClick={() => api.occupy(task.id)}>
                {occupied ? `${pump?.id} 充填位占用中` : `上 ${pump?.id} 充填位`}
              </button>
            </div>
          </article>
        );
      })}
    </div>
  );
}

function ReworkList({ api }: { api: ConsoleApi }) {
  const [operator, setOperator] = useState<Record<string, string>>({});
  const list = api.derived.rework;
  return (
    <div className="task-group">
      <h3>返工任务 <span className="count">{list.length}</span></h3>
      {list.length === 0 && <p className="muted">暂无返工任务。</p>}
      {list.map((task) => (
        <article key={task.id} className="task-card rework">
          <div className="task-head">
            <strong>{task.code}</strong>
            <span className="badge badge-bad">返工（第 {task.reworkCount} 次）</span>
          </div>
          <TaskMeta task={task} pump={api.state.pumps.find((p) => p.id === task.pumpId)} />
          {task.signoff && (
            <ul className="fail-list">
              {task.signoff.failures.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          )}
          <div className="inline-action">
            <input
              placeholder="返工操作员"
              value={operator[task.id] ?? ""}
              onChange={(e) => setOperator((m) => ({ ...m, [task.id]: e.target.value }))}
            />
            <button className="primary" onClick={() => api.redispatch(task.id, operator[task.id] ?? "")}>
              返工后重新派发
            </button>
          </div>
        </article>
      ))}
    </div>
  );
}

export function QueuePanel({ api }: Props) {
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>任务落盘视图</p>
          <h2>待检清单与待充填队列</h2>
        </div>
      </div>
      <div className="queue-grid">
        <InspectionList api={api} />
        <ReadyList api={api} />
        <ReworkList api={api} />
      </div>
    </section>
  );
}
