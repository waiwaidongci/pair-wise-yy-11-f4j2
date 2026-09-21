import { useState } from "react";
import { O2_TOLERANCE_PP, PRESSURE_TOLERANCE, STATUS_LABELS, formatDateTime, totalFillMinutes } from "../domain/rules";
import type { ConsoleApi } from "../state/useConsole";

interface Props {
  api: ConsoleApi;
}

function SignoffCard({ api, taskId }: { api: ConsoleApi; taskId: string }) {
  const task = api.state.tasks.find((t) => t.id === taskId)!;
  const minP = Math.round(task.targetPressure * (1 - PRESSURE_TOLERANCE));
  const maxP = Math.round(task.targetPressure * (1 + PRESSURE_TOLERANCE));
  const [pressure, setPressure] = useState(task.targetPressure);
  const [o2, setO2] = useState(task.o2);
  const [checker, setChecker] = useState("");

  const pressureBad = pressure < minP || pressure > maxP;
  const o2Bad = Math.abs(o2 - task.o2) > O2_TOLERANCE_PP;

  return (
    <article className="task-card signoff">
      <div className="task-head">
        <strong>{task.code}</strong>
        <span className="badge badge-warn">{STATUS_LABELS[task.status]}</span>
      </div>
      <div className="task-meta">
        <span>目标 {task.targetPressure}bar / O₂ {task.o2}%</span>
        <span>累计充填 {totalFillMinutes(task.segments)} 分钟 · {task.segments.length} 段</span>
        <span>操作员 {task.operator}</span>
      </div>
      <div className="signoff-grid">
        <label>
          <span>实测压力 (bar) · 合格区间 {minP}~{maxP}</span>
          <input type="number" className={pressureBad ? "input-bad" : ""} value={pressure} onChange={(e) => setPressure(Number(e.target.value))} />
        </label>
        <label>
          <span>实测氧浓度 (%) · 目标 ±{O2_TOLERANCE_PP}pp</span>
          <input type="number" step="0.1" className={o2Bad ? "input-bad" : ""} value={o2} onChange={(e) => setO2(Number(e.target.value))} />
        </label>
        <label>
          <span>签收人 *</span>
          <input value={checker} onChange={(e) => setChecker(e.target.value)} placeholder="签收核验人" />
        </label>
      </div>
      {(pressureBad || o2Bad) && (
        <p className="bad">存在越限项，签收后将自动转入返工：{pressureBad ? "压力越限 " : ""}{o2Bad ? "氧浓度越限" : ""}</p>
      )}
      <div className="inline-action">
        <button className="primary" disabled={!checker.trim()} onClick={() => api.signoff(task.id, pressure, o2, checker)}>
          核实并签收
        </button>
      </div>
    </article>
  );
}

export function SignoffPanel({ api }: Props) {
  const pending = api.derived.filled;
  const recent = api.derived.signed.slice(0, 6);
  return (
    <section className="panel">
      <div className="heading">
        <div>
          <p>签收前复核</p>
          <h2>实测压力 + 氧浓度双项核实</h2>
        </div>
        <span className="muted">任一越限即转返工</span>
      </div>

      <h3>待签收 <span className="count">{pending.length}</span></h3>
      {pending.length === 0 && <p className="muted">暂无待签收气瓶。</p>}
      <div className="signoff-list">
        {pending.map((t) => (
          <SignoffCard key={t.id} api={api} taskId={t.id} />
        ))}
      </div>

      <h3>近期已签收</h3>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>气瓶</th>
              <th>泵</th>
              <th>目标/实测压力</th>
              <th>O₂ 目标/实测</th>
              <th>签收人</th>
              <th>时间</th>
            </tr>
          </thead>
          <tbody>
            {recent.map((t) => (
              <tr key={t.id}>
                <td>{t.code}</td>
                <td>{t.pumpId}</td>
                <td>{t.targetPressure} / {t.signoff?.measuredPressure}bar</td>
                <td>{t.o2} / {t.signoff?.measuredO2}%</td>
                <td>{t.signoff?.checker}</td>
                <td>{t.signoff ? formatDateTime(t.signoff.checkedAt) : ""}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
