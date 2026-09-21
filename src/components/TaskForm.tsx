import { useMemo, useState } from "react";
import { MODE_LABELS, TEMP_LIMIT_C, FLOW_LIMIT_LMIN, describeViolations, evaluatePump, mixHint } from "../domain/rules";
import { localDateString, shiftDateString } from "../domain/storage";
import type { ConsoleApi } from "../state/useConsole";
import type { FillMode, TaskDraft } from "../domain/types";

const MODES: FillMode[] = ["air", "nitrox", "trimix", "oxygen"];

interface Props {
  api: ConsoleApi;
}

export function TaskForm({ api }: Props) {
  const { state, createTask } = api;
  const [form, setForm] = useState({
    code: "",
    volumeL: "12",
    inspectionDue: shiftDateString(180),
    startPressure: "30",
    targetPressure: "200",
    o2: "21",
    he: "0",
    mode: "air" as FillMode,
    operator: "",
    note: "",
    pumpId: state.pumps[0]?.id ?? "",
  });

  const set = (key: keyof typeof form, value: string) => setForm((f) => ({ ...f, [key]: value }));

  const selectedPump = state.pumps.find((p) => p.id === form.pumpId);
  const pumpEval = useMemo(() => (selectedPump ? evaluatePump(selectedPump) : null), [selectedPump]);

  const handleSave = () => {
    if (!form.code.trim()) return;
    if (!form.operator.trim()) return;
    if (!form.pumpId) return;
    const draft: TaskDraft = {
      code: form.code.trim(),
      volumeL: Number(form.volumeL) || 0,
      inspectionDue: form.inspectionDue || localDateString(),
      startPressure: Number(form.startPressure) || 0,
      targetPressure: Number(form.targetPressure) || 0,
      o2: Number(form.o2) || 0,
      he: Number(form.he) || 0,
      mode: form.mode,
      operator: form.operator.trim(),
      note: form.note.trim() || undefined,
      pumpId: form.pumpId,
    };
    const result = createTask(draft);
    if (result.ok) {
      setForm((f) => ({
        ...f,
        code: "",
        startPressure: "30",
        note: "",
      }));
    }
  };

  return (
    <section className="panel form-panel">
      <div className="heading">
        <div>
          <p>新建充填任务</p>
          <h2>气瓶建档并绑定充填泵</h2>
        </div>
        <div className="rule-chips">
          <span className="chip">水温 &gt; {TEMP_LIMIT_C}℃ 拦截</span>
          <span className="chip">流量 &lt; {FLOW_LIMIT_LMIN}L/min 拦截</span>
          <span className="chip">滤芯超期拦截</span>
        </div>
      </div>

      <div className="field-grid">
        <label>
          <span>气瓶编号 *</span>
          <input value={form.code} onChange={(e) => set("code", e.target.value)} placeholder="如 TANK-205" />
        </label>
        <label>
          <span>绑定充填泵 *</span>
          <select value={form.pumpId} onChange={(e) => set("pumpId", e.target.value)}>
            {state.pumps.map((p) => (
              <option key={p.id} value={p.id}>
                {p.id} {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>容积 (L)</span>
          <input type="number" value={form.volumeL} onChange={(e) => set("volumeL", e.target.value)} />
        </label>
        <label>
          <span>气瓶检验有效期</span>
          <input type="date" value={form.inspectionDue} onChange={(e) => set("inspectionDue", e.target.value)} />
        </label>
        <label>
          <span>残压 (bar)</span>
          <input type="number" value={form.startPressure} onChange={(e) => set("startPressure", e.target.value)} />
        </label>
        <label>
          <span>目标压力 (bar)</span>
          <input type="number" value={form.targetPressure} onChange={(e) => set("targetPressure", e.target.value)} />
        </label>
        <label>
          <span>氧含量 O₂ (%)</span>
          <input type="number" step="0.1" value={form.o2} onChange={(e) => set("o2", e.target.value)} />
        </label>
        <label>
          <span>氦含量 He (%)</span>
          <input type="number" step="0.1" value={form.he} onChange={(e) => set("he", e.target.value)} />
        </label>
        <label>
          <span>充填方式</span>
          <select value={form.mode} onChange={(e) => set("mode", e.target.value)}>
            {MODES.map((m) => (
              <option key={m} value={m}>
                {MODE_LABELS[m]}
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>操作员 *</span>
          <input value={form.operator} onChange={(e) => set("operator", e.target.value)} placeholder="建档操作员" />
        </label>
        <label className="wide">
          <span>备注</span>
          <input value={form.note} onChange={(e) => set("note", e.target.value)} placeholder="瓶型、客户要求等" />
        </label>
      </div>

      <div className="form-footer">
        <div className={`mix-hint ${pumpEval && !pumpEval.ok ? "is-blocked" : ""}`}>
          <strong>混气提示：</strong>
          {mixHint(form.mode, Number(form.o2) || 0, Number(form.he) || 0)}
          {selectedPump && pumpEval && (
            <em className={pumpEval.ok ? "ok" : "bad"}>
              绑定泵预检：{pumpEval.ok ? "合格，可进入待充填队列" : `越线（${describeViolations(pumpEval.violations)}），只进设备待检`}
            </em>
          )}
        </div>
        <button className="primary" onClick={handleSave} disabled={!form.code.trim() || !form.operator.trim() || !form.pumpId}>
          建档并预检
        </button>
      </div>
    </section>
  );
}
