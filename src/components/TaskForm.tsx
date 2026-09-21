import { useState } from "react";
import { useConsole } from "../state/ConsoleContext";
import {
  addDays,
  judgePump,
  todayISO,
  type FillMode,
} from "../domain/types";
import { Badge, Panel } from "./ui";
import type { NewTaskInput } from "../state/ConsoleContext";

const MODES: { mode: FillMode; o2: number; he: number; hint: string }[] = [
  { mode: "空气", o2: 21, he: 0, hint: "O₂ 21% · 无氦" },
  { mode: "高氧", o2: 32, he: 0, hint: "EAN32 常用，最高充填压力需按氧限折算" },
  { mode: "Trimix", o2: 18, he:  35, hint: "O₂ 18% / He 35%，留残压防混气错误" },
];

export function TaskForm() {
  const { state, dispatch } = useConsole();
  const [form, setForm] = useState({
    tankNo: "",
    volume: "12L铝瓶",
    fillMode: "空气" as FillMode,
    residualPressure: "50",
    targetPressure: "200",
    targetO2: "21",
    targetHe: "0",
    operator: "",
    pumpId: state.pumps[0]?.id ?? "",
    inspectionDue: addDays(todayISO(), 365),
  });
  const [error, setError] = useState("");

  const set = (key: keyof typeof form, value: string) => {
    setForm((f) => {
      const next = { ...f, [key]: value };
      if (key === "fillMode") {
        const preset = MODES.find((m) => m.mode === value);
        if (preset) {
          next.targetO2 = String(preset.o2);
          next.targetHe = String(preset.he);
        }
      }
      return next;
    });
  };

  const selectedPump = state.pumps.find((p) => p.id === form.pumpId);
  const verdict = selectedPump ? judgePump(selectedPump) : null;

  const submit = () => {
    if (!form.tankNo.trim()) return setError("请填写气瓶编号");
    if (!form.operator.trim()) return setError("请填写操作员");
    const nums = {
      residualPressure: Number(form.residualPressure),
      targetPressure: Number(form.targetPressure),
      targetO2: Number(form.targetO2),
      targetHe: Number(form.targetHe),
    };
    if (Object.values(nums).some((n) => Number.isNaN(n)))
      return setError("压力与气体比例必须是数字");
    if (nums.targetPressure <= nums.residualPressure)
      return setError("目标压力必须高于残压");
    if (!form.pumpId) return setError("请选择绑定泵编号");

    const input: NewTaskInput = {
      tankNo: form.tankNo.trim(),
      volume: form.volume,
      inspectionDue: form.inspectionDue,
      fillMode: form.fillMode,
      ...nums,
      operator: form.operator.trim(),
      pumpId: form.pumpId,
    };
    dispatch({ type: "CREATE_TASK", input });
    setError("");
    setForm((f) => ({
      ...f,
      tankNo: "",
      residualPressure: "50",
      targetPressure: "200",
    }));
  };

  return (
    <Panel title="新增待充任务" subtitle="任务层 · 先绑泵后判定，越线只进设备待检">
      <div className="field-grid">
        <label>
          <span>气瓶编号</span>
          <input
            value={form.tankNo}
            placeholder="如 TANK-240"
            onChange={(e) => set("tankNo", e.target.value)}
          />
        </label>
        <label>
          <span>容积 / 瓶型</span>
          <input value={form.volume} onChange={(e) => set("volume", e.target.value)} />
        </label>
        <label>
          <span>检验有效期</span>
          <input
            type="date"
            value={form.inspectionDue}
            onChange={(e) => set("inspectionDue", e.target.value)}
          />
        </label>
        <label>
          <span>充填方式</span>
          <select
            value={form.fillMode}
            onChange={(e) => set("fillMode", e.target.value)}
          >
            {MODES.map((m) => (
              <option key={m.mode} value={m.mode}>
                {m.mode}（{m.hint}）
              </option>
            ))}
          </select>
        </label>
        <label>
          <span>残压 bar</span>
          <input
            inputMode="numeric"
            value={form.residualPressure}
            onChange={(e) => set("residualPressure", e.target.value)}
          />
        </label>
        <label>
          <span>目标压力 bar</span>
          <input
            inputMode="numeric"
            value={form.targetPressure}
            onChange={(e) => set("targetPressure", e.target.value)}
          />
        </label>
        <label>
          <span>目标氧含量 %</span>
          <input
            inputMode="decimal"
            value={form.targetO2}
            onChange={(e) => set("targetO2", e.target.value)}
          />
        </label>
        <label>
          <span>氦含量 %（Trimix）</span>
          <input
            inputMode="decimal"
            value={form.targetHe}
            onChange={(e) => set("targetHe", e.target.value)}
          />
        </label>
        <label>
          <span>操作员</span>
          <input
            value={form.operator}
            placeholder="首充操作人"
            onChange={(e) => set("operator", e.target.value)}
          />
        </label>
        <label>
          <span>绑定泵编号</span>
          <select
            value={form.pumpId}
            onChange={(e) => set("pumpId", e.target.value)}
          >
            {state.pumps.map((p) => {
              const v = judgePump(p);
              return (
                <option key={p.id} value={p.id}>
                  {p.id} {v.ok ? "· 合格" : "· 待检（越线：" + v.failures.map((f) => f.detail).join("，") + "）"}
                </option>
              );
            })}
          </select>
        </label>
      </div>

      <div className="form-preview">
        {verdict?.ok ? (
          <Badge tone="ok">绑定泵合格：任务进入待充填队列，可占充填位</Badge>
        ) : (
          <Badge tone="bad">
            绑定泵越线：{verdict?.failures.map((f) => f.detail).join("；")}
            ，保存后只进设备待检
          </Badge>
        )}
        {error ? <span className="form-error">{error}</span> : null}
        <button className="primary" onClick={submit}>
          保存并按泵判定落位
        </button>
      </div>
    </Panel>
  );
}
