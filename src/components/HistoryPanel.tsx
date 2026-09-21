import { useMemo, useState } from "react";
import {
  EVENT_TYPE_LABELS,
  STATUS_LABELS,
  formatDateTime,
  segmentMinutes,
} from "../domain/rules";
import type { ConsoleApi } from "../state/useConsole";

interface Props {
  api: ConsoleApi;
}

export function HistoryPanel({ api }: Props) {
  const { events, tasks, pumps } = api.state;
  const [pumpFilter, setPumpFilter] = useState("all");
  const [codeQuery, setCodeQuery] = useState("");

  const filteredEvents = useMemo(
    () => (pumpFilter === "all" ? events : events.filter((e) => e.pumpId === pumpFilter)),
    [events, pumpFilter]
  );

  const matchedTasks = useMemo(() => {
    const q = codeQuery.trim().toUpperCase();
    if (!q) return [] as typeof tasks;
    return tasks.filter((t) => t.code.toUpperCase().includes(q));
  }, [tasks, codeQuery]);

  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>设备履历 + 单瓶历史</p>
          <h2>可追溯记录</h2>
        </div>
      </div>

      <div className="history-cols">
        <div>
          <div className="sub-head">
            <h3>设备履历</h3>
            <select value={pumpFilter} onChange={(e) => setPumpFilter(e.target.value)}>
              <option value="all">全部泵</option>
              {pumps.map((p) => (
                <option key={p.id} value={p.id}>{p.id} {p.name}</option>
              ))}
            </select>
          </div>
          <ul className="event-log">
            {filteredEvents.map((e) => (
              <li key={e.id} className={`evt evt-${e.type}`}>
                <div className="evt-head">
                  <span className="evt-type">{EVENT_TYPE_LABELS[e.type]}</span>
                  <span className="evt-pump">{e.pumpId}</span>
                  <time>{formatDateTime(e.at)}</time>
                </div>
                <p>{e.detail}</p>
                <small>记录人：{e.operator}{e.taskId ? ` · 任务 ${e.taskId}` : ""}</small>
              </li>
            ))}
            {filteredEvents.length === 0 && <p className="muted">暂无履历。</p>}
          </ul>
        </div>

        <div>
          <div className="sub-head">
            <h3>单个气瓶历史</h3>
            <input placeholder="按气瓶编号查询，如 TANK-207" value={codeQuery} onChange={(e) => setCodeQuery(e.target.value)} />
          </div>
          {codeQuery.trim() === "" && <p className="muted">输入编号查看该瓶全部任务、分段计时与签收记录。</p>}
          {matchedTasks.map((t) => (
            <article key={t.id} className="cylinder-history">
              <div className="task-head">
                <strong>{t.code}</strong>
                <span className="badge">{STATUS_LABELS[t.status]}</span>
              </div>
              <p className="muted">
                {t.volumeL}L · 目标 {t.targetPressure}bar · O₂ {t.o2}%{t.he > 0 ? ` · He ${t.he}%` : ""} · 泵 {t.pumpId} · 操作员 {t.operator}
              </p>
              <div className="segments">
                {t.segments.map((seg, i) => (
                  <div key={i} className="seg">
                    <span>第 {i + 1} 段{seg.reviewer ? `（${seg.reviewer} 复核续充）` : ""}</span>
                    <span>{formatDateTime(seg.startedAt)}</span>
                    <b>{segmentMinutes(seg)} 分钟</b>
                  </div>
                ))}
                {t.segments.length === 0 && <p className="muted">尚未开始充填计时</p>}
              </div>
              {t.signoff && (
                <div className={`signoff-record ${t.signoff.pass ? "ok" : "bad"}`}>
                  {t.signoff.pass ? "签收合格" : "签收越限转返工"}：实测 {t.signoff.measuredPressure}bar / O₂ {t.signoff.measuredO2}% ·{" "}
                  {t.signoff.checker} · {formatDateTime(t.signoff.checkedAt)}
                  {!t.signoff.pass && (
                    <ul>{t.signoff.failures.map((f, i) => <li key={i}>{f}</li>)}</ul>
                  )}
                </div>
              )}
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
