import { useEffect, useState } from "react";
import {
  FLOW_LIMIT_LMIN,
  TEMP_LIMIT_C,
  VIOLATION_LABELS,
  describeViolations,
  evaluatePump,
  segmentMinutes,
  totalFillMinutes,
} from "../domain/rules";
import type { ConsoleApi } from "../state/useConsole";
import type { FillTask, Pump, Violation } from "../domain/types";

interface Props {
  api: ConsoleApi;
  tick: number;
}

function ViolationsLive({ pump }: { pump: Pump }) {
  const result = evaluatePump(pump);
  if (result.ok) return <span className="badge badge-ok">实时判定合格</span>;
  return (
    <div className="live-alert">
      <strong>泵实时越线：</strong>
      {result.violations.map((v) => (
        <span key={v} className="badge badge-bad">{VIOLATION_LABELS[v]}</span>
      ))}
    </div>
  );
}

function FillingCard({ task, pump, api }: { task: FillTask; pump: Pump; api: ConsoleApi }) {
  const isPaused = task.status === "paused";
  const [pressure, setPressure] = useState<number>(task.startPressure);
  const [reasons, setReasons] = useState<Violation[]>([]);
  const [reviewer, setReviewer] = useState("");
  const [resumePressure, setResumePressure] = useState<number>(task.startPressure);

  const evalResult = evaluatePump(pump);
  const toggleReason = (v: Violation) =>
    setReasons((list) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v]));

  useEffect(() => {
    const last = task.segments[task.segments.length - 1];
    if (last?.pausePressure != null) setResumePressure(last.pausePressure);
  }, [task.id, task.segments]);

  return (
    <article className={`slot-card ${isPaused ? "paused" : "filling"}`}>
      <header>
        <div>
          <h3>{task.code} <small>· {pump.id} {pump.name}</small></h3>
          <span className={`badge ${isPaused ? "badge-warn" : "badge-fill"}`}>
            {isPaused ? "越线暂停 · 处理中" : "充填中"}
          </span>
        </div>
        <div className="target">
          目标 <b>{task.targetPressure}</b> bar · 残压 {task.startPressure} bar
        </div>
      </header>

      <ViolationsLive pump={pump} />

      <div className="segments">
        {task.segments.map((seg, i) => {
          const mins = segmentMinutes(seg);
          return (
            <div key={i} className={`seg ${seg.endedAt ? "" : "active"}`}>
              <span>
                第 {i + 1} 段{i > 0 || seg.reviewer ? `（复核续充：${seg.reviewer ?? "—"}）` : "（首充）"}
              </span>
              <span>{seg.startPressure}bar → {seg.pausePressure ?? "进行中"}bar</span>
              <b>{mins} 分钟</b>
              {seg.reason && <em className="bad">因{describeViolations([seg.reason])}暂停</em>}
            </div>
          );
        })}
        <div className="seg total">
          <span>累计充填时长</span>
          <b>{totalFillMinutes(task.segments)} 分钟</b>
        </div>
      </div>

      {!isPaused && (
        <div className="slot-actions">
          <div className="pause-box">
            <label>
              <span>当前压力 (bar)</span>
              <input type="number" value={pressure} onChange={(e) => setPressure(Number(e.target.value))} />
            </label>
            <div className="reason-pick">
              {(["temp", "flow", "filter"] as Violation[]).map((v) => (
                <button
                  key={v}
                  type="button"
                  className={reasons.includes(v) ? "pick on" : "pick"}
                  onClick={() => toggleReason(v)}
                >
                  {VIOLATION_LABELS[v]}
                </button>
              ))}
            </div>
            <button
              className="danger"
              disabled={reasons.length === 0}
              onClick={() => api.pauseTask(task.id, pressure, reasons)}
            >
              越线暂停（记下时长与压力）
            </button>
            {evalResult.ok ? null : <em className="bad">提示：当前泵数据已越线，应立即暂停</em>}
          </div>
          <button className="primary" onClick={() => api.finishFill(task.id)}>
            达到目标 · 完成充填
          </button>
        </div>
      )}

      {isPaused && (
        <div className="slot-actions">
          <div className="pause-box">
            <p className="muted">
              已处理冷却系统。须由<b>另一名人员</b>（非操作员 {task.operator}）复核后才能续充，续充时间另起一段单独累加。
            </p>
            <label>
              <span>复核人（须 ≠ {task.operator}）</span>
              <input value={reviewer} onChange={(e) => setReviewer(e.target.value)} placeholder="复核人姓名" />
            </label>
            <label>
              <span>续充起始压力 (bar)</span>
              <input type="number" value={resumePressure} onChange={(e) => setResumePressure(Number(e.target.value))} />
            </label>
            <button className="primary" onClick={() => api.resumeTask(task.id, reviewer, resumePressure)}>
              复核通过 · 续充
            </button>
          </div>
        </div>
      )}
    </article>
  );
}

function EmptySlot({ pump, readyTasks, api }: { pump: Pump; readyTasks: FillTask[]; api: ConsoleApi }) {
  const result = evaluatePump(pump);
  const candidates = readyTasks.filter((t) => t.pumpId === pump.id);
  return (
    <article className="slot-card empty">
      <header>
        <div>
          <h3>{pump.id} {pump.name}</h3>
          <span className="badge badge-idle">充填位空闲</span>
        </div>
        <div className="live-params">
          <span className={pump.waterTempC > TEMP_LIMIT_C ? "num bad" : "num"}>水温 <b>{pump.waterTempC}</b>℃</span>
          <span className={pump.flowLmin < FLOW_LIMIT_LMIN ? "num bad" : "num"}>流量 <b>{pump.flowLmin}</b>L/min</span>
          <span className={result.daysLeft < 0 ? "num bad" : result.daysLeft <= 7 ? "num warn" : "num"}>
            滤芯 <b>{result.daysLeft < 0 ? `超期${-result.daysLeft}天` : `剩${result.daysLeft}天`}</b>
          </span>
        </div>
      </header>
      {!result.ok && <p className="bad">泵越线：{describeViolations(result.violations)}——待检任务不能上此充填位</p>}
      {result.ok && candidates.length === 0 && <p className="muted">该泵暂无预检合格的待充填任务</p>}
      {result.ok && candidates.length > 0 && (
        <div className="candidates">
          {candidates.map((t) => (
            <div key={t.id} className="candidate">
              <span>{t.code} · {t.targetPressure}bar · 操作员 {t.operator}</span>
              <button onClick={() => api.occupy(t.id)}>占用充填位</button>
            </div>
          ))}
        </div>
      )}
    </article>
  );
}

export function SlotsPanel({ api }: Props) {
  const active = api.derived.filling;
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>充填工位（一泵一位）</p>
          <h2>冷却水联动充填位</h2>
        </div>
        <span className="muted">{active.length} 个任务在位</span>
      </div>
      <div className="slots-grid">
        {api.state.pumps.map((pump) => {
          const task = active.find((t) => t.pumpId === pump.id);
          if (task) return <FillingCard key={pump.id} task={task} pump={pump} api={api} />;
          return <EmptySlot key={pump.id} pump={pump} readyTasks={api.derived.ready} api={api} />;
        })}
      </div>
    </section>
  );
}
