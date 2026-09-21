import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { checkSignoff, describeViolations, evaluatePump, snapshotPump } from "../domain/rules";
import { loadState, newId, resetState, saveState } from "../domain/storage";
import type {
  ConsoleState,
  EquipmentEvent,
  FillTask,
  Pump,
  TaskDraft,
  Violation,
} from "../domain/types";

export interface ActionResult {
  ok: boolean;
  message: string;
}

export interface Toast extends ActionResult {
  id: number;
}

export function useConsole() {
  const [state, setState] = useState<ConsoleState>(() => loadState());
  const [toasts, setToasts] = useState<Toast[]>([]);
  const stateRef = useRef(state);
  stateRef.current = state;

  useEffect(() => {
    saveState(state);
  }, [state]);

  const notify = useCallback((result: ActionResult) => {
    const id = Date.now() + Math.random();
    setToasts((list) => [...list, { ...result, id }]);
    window.setTimeout(() => {
      setToasts((list) => list.filter((t) => t.id !== id));
    }, 3600);
  }, []);

  const addEvent = (
    draft: ConsoleState,
    pumpId: string,
    type: EquipmentEvent["type"],
    detail: string,
    operator: string,
    taskId?: string
  ) => {
    draft.events.unshift({ id: newId("evt"), at: Date.now(), pumpId, taskId, type, detail, operator });
  };

  const updateTask = (draft: ConsoleState, taskId: string, patch: Partial<FillTask>) => {
    const idx = draft.tasks.findIndex((t) => t.id === taskId);
    if (idx >= 0) draft.tasks[idx] = { ...draft.tasks[idx], ...patch, updatedAt: Date.now() };
  };

  /** 统一执行入口：深拷贝改完一次性落盘 */
  const run = useCallback(
    (fn: (draft: ConsoleState) => ActionResult): ActionResult => {
      const draft: ConsoleState = structuredClone(stateRef.current);
      const result = fn(draft);
      setState(draft);
      notify(result);
      return result;
    },
    [notify]
  );

  /** 新建任务：建档即按绑定泵当前数据预检，不合格只进设备待检，不能占充填位 */
  const createTask = useCallback(
    (data: TaskDraft): ActionResult =>
      run((draft) => {
        const pump = draft.pumps.find((p) => p.id === data.pumpId);
        if (!pump) return { ok: false, message: "未找到绑定的充填泵" };
        const evalResult = evaluatePump(pump);
        const now = Date.now();
        const task: FillTask = {
          ...data,
          id: newId("task"),
          precheck: {
            ...snapshotPump(pump),
            ok: evalResult.ok,
            violations: evalResult.violations,
            checkedAt: now,
          },
          status: evalResult.ok ? "ready" : "inspection",
          segments: [],
          reworkCount: 0,
          createdAt: now,
          updatedAt: now,
        };
        draft.tasks.unshift(task);
        addEvent(
          draft,
          pump.id,
          "created",
          `气瓶 ${task.code} 建档，绑定 ${pump.id} ${pump.name}，操作员 ${task.operator}`,
          task.operator,
          task.id
        );
        if (!evalResult.ok) {
          addEvent(
            draft,
            pump.id,
            "blocked",
            `预检不合格：${describeViolations(evalResult.violations)}，气瓶 ${task.code} 进入设备待检，不占充填位`,
            task.operator,
            task.id
          );
          return { ok: false, message: `${task.code} 预检未通过，已进设备待检：${describeViolations(evalResult.violations)}` };
        }
        return { ok: true, message: `${task.code} 预检合格，进入待充填队列` };
      }),
    [run]
  );

  /** 泵处理（换水/调流量/换滤芯）后对某待检任务重新判定 */
  const recheckTask = useCallback(
    (taskId: string, checker: string): ActionResult =>
      run((draft) => {
        const task = draft.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== "inspection") return { ok: false, message: "只有设备待检任务可以重新判定" };
        const pump = draft.pumps.find((p) => p.id === task.pumpId);
        if (!pump) return { ok: false, message: "绑定泵不存在" };
        const evalResult = evaluatePump(pump);
        const snap = snapshotPump(pump);
        updateTask(draft, taskId, {
          precheck: { ...snap, ok: evalResult.ok, violations: evalResult.violations, checkedAt: Date.now() },
          status: evalResult.ok ? "ready" : "inspection",
        });
        if (evalResult.ok) {
          addEvent(draft, pump.id, "recheck", `气瓶 ${task.code} 复检合格（${checker}），转入待充填队列`, checker, taskId);
          return { ok: true, message: `${task.code} 复检合格，可上充填位` };
        }
        addEvent(
          draft,
          pump.id,
          "recheck",
          `气瓶 ${task.code} 复检仍不合格：${describeViolations(evalResult.violations)}`,
          checker,
          taskId
        );
        return { ok: false, message: `复检仍未通过：${describeViolations(evalResult.violations)}` };
      }),
    [run]
  );

  /** 占用充填位，开始首段充填（仅预检合格的任务） */
  const occupy = useCallback(
    (taskId: string): ActionResult =>
      run((draft) => {
        const task = draft.tasks.find((t) => t.id === taskId);
        if (!task) return { ok: false, message: "任务不存在" };
        if (task.status !== "ready") return { ok: false, message: "只有预检合格的待充填任务能占用充填位" };
        // 占用前再按泵当前实时数据判定一次
        const pump = draft.pumps.find((p) => p.id === task.pumpId);
        if (!pump) return { ok: false, message: "绑定泵不存在" };
        const evalResult = evaluatePump(pump);
        if (!evalResult.ok) {
          updateTask(draft, taskId, { status: "inspection" });
          addEvent(
            draft,
            pump.id,
            "blocked",
            `上位前实时判定越线：${describeViolations(evalResult.violations)}，${task.code} 退回设备待检`,
            task.operator,
            taskId
          );
          return { ok: false, message: `泵 ${pump.id} 实时数据越线，任务退回设备待检` };
        }
        const occupied = draft.tasks.some((t) => t.pumpId === pump.id && (t.status === "filling" || t.status === "paused"));
        if (occupied) return { ok: false, message: `${pump.id} 充填位已被占用` };
        updateTask(draft, taskId, {
          status: "filling",
          segments: [
            ...task.segments,
            { startedAt: Date.now(), endedAt: null, operator: task.operator, startPressure: task.startPressure, minutes: null },
          ],
        });
        addEvent(
          draft,
          pump.id,
          "occupied",
          `${task.code} 上充填位开始充填，残压 ${task.startPressure}bar，目标 ${task.targetPressure}bar`,
          task.operator,
          taskId
        );
        return { ok: true, message: `${task.code} 已在 ${pump.id} 开始充填` };
      }),
    [run]
  );

  /** 充填中越线暂停：记录已用时长与当前压力，释放动作待复核后续充 */
  const pauseTask = useCallback(
    (taskId: string, currentPressure: number, reasons: Violation[]): ActionResult =>
      run((draft) => {
        const task = draft.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== "filling") return { ok: false, message: "任务不在充填中" };
        if (reasons.length === 0) return { ok: false, message: "请勾选触发暂停的越线项" };
        if (currentPressure < task.startPressure || currentPressure > task.targetPressure + 10)
          return { ok: false, message: `当前压力应在 ${task.startPressure} ~ ${task.targetPressure}bar 之间` };
        const now = Date.now();
        const segments = task.segments.map((seg) =>
          seg.endedAt == null
            ? { ...seg, endedAt: now, minutes: Math.max(0, Math.round((now - seg.startedAt) / 60000)), pausePressure: currentPressure, reason: reasons[0] }
            : seg
        );
        updateTask(draft, taskId, { status: "paused", segments });
        addEvent(
          draft,
          task.pumpId,
          "paused",
          `${task.code} 因${describeViolations(reasons)}暂停：已用 ${segments[segments.length - 1].minutes} 分钟，当前压力 ${currentPressure}bar，等待处理后他人复核续充`,
          task.operator,
          taskId
        );
        return { ok: true, message: `已暂停：本段 ${segments[segments.length - 1].minutes} 分钟，压力 ${currentPressure}bar 已记录` };
      }),
    [run]
  );

  /** 处理完由另一人复核后续充，续充时间单独累加（新起一段，复核人≠操作员） */
  const resumeTask = useCallback(
    (taskId: string, reviewer: string, currentPressure: number): ActionResult =>
      run((draft) => {
        const task = draft.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== "paused") return { ok: false, message: "任务不在暂停状态" };
        if (!reviewer.trim()) return { ok: false, message: "请填写复核人" };
        if (reviewer.trim() === task.operator) return { ok: false, message: "续充复核人必须不同于操作员（双人制度）" };
        const pump = draft.pumps.find((p) => p.id === task.pumpId);
        if (!pump) return { ok: false, message: "绑定泵不存在" };
        const evalResult = evaluatePump(pump);
        if (!evalResult.ok)
          return { ok: false, message: `泵仍越线，不能续充：${describeViolations(evalResult.violations)}` };
        updateTask(draft, taskId, {
          status: "filling",
          segments: [
            ...task.segments,
            { startedAt: Date.now(), endedAt: null, operator: task.operator, reviewer: reviewer.trim(), startPressure: currentPressure, minutes: null },
          ],
        });
        addEvent(
          draft,
          task.pumpId,
          "resumed",
          `${task.code} 由 ${reviewer.trim()} 复核后续充，起始压力 ${currentPressure}bar，续充时长单独累计（第 ${task.segments.length + 1} 段）`,
          reviewer.trim(),
          taskId
        );
        return { ok: true, message: `复核通过，续充计时已另起一段` };
      }),
    [run]
  );

  /** 达到目标压力，完成充填转待签收 */
  const finishFill = useCallback(
    (taskId: string): ActionResult =>
      run((draft) => {
        const task = draft.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== "filling") return { ok: false, message: "任务不在充填中" };
        const now = Date.now();
        const segments = task.segments.map((seg) =>
          seg.endedAt == null
            ? { ...seg, endedAt: now, minutes: Math.max(0, Math.round((now - seg.startedAt) / 60000)) }
            : seg
        );
        updateTask(draft, taskId, { status: "filled", segments });
        addEvent(draft, task.pumpId, "filled", `${task.code} 充填完成，累计 ${segments.reduce((s, x) => s + (x.minutes ?? 0), 0)} 分钟，等待签收核验`, task.operator, taskId);
        return { ok: true, message: `${task.code} 充填完成，等待签收核验` };
      }),
    [run]
  );

  /** 签收前核实测压力与氧浓度，任一越限转返工 */
  const signoff = useCallback(
    (taskId: string, measuredPressure: number, measuredO2: number, checker: string): ActionResult =>
      run((draft) => {
        const task = draft.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== "filled") return { ok: false, message: "只有待签收任务可以核验" };
        if (!checker.trim()) return { ok: false, message: "请填写签收人" };
        const result = checkSignoff(task.targetPressure, task.o2, measuredPressure, measuredO2);
        const check = { ...result, checker: checker.trim(), checkedAt: Date.now() };
        if (!result.pass) {
          updateTask(draft, taskId, { status: "rework", signoff: check, reworkCount: task.reworkCount + 1 });
          addEvent(
            draft,
            task.pumpId,
            "rework",
            `${task.code} 签收核验越限转返工：${result.failures.join("；")}（签收人 ${checker.trim()}）`,
            checker.trim(),
            taskId
          );
          return { ok: false, message: `核验越限，已转返工：${result.failures.join("；")}` };
        }
        updateTask(draft, taskId, { status: "signed", signoff: check });
        addEvent(
          draft,
          task.pumpId,
          "signed",
          `${task.code} 签收合格：实测 ${measuredPressure}bar / O₂ ${measuredO2}%，签收人 ${checker.trim()}`,
          checker.trim(),
          taskId
        );
        return { ok: true, message: `${task.code} 签收完成` };
      }),
    [run]
  );

  /** 返工任务重新派发：清空充填计时与签收记录，按泵当前状态重新预检 */
  const redispatch = useCallback(
    (taskId: string, operator: string): ActionResult =>
      run((draft) => {
        const task = draft.tasks.find((t) => t.id === taskId);
        if (!task || task.status !== "rework") return { ok: false, message: "只有返工任务可以重新派发" };
        const pump = draft.pumps.find((p) => p.id === task.pumpId);
        if (!pump) return { ok: false, message: "绑定泵不存在" };
        const evalResult = evaluatePump(pump);
        updateTask(draft, taskId, {
          operator: operator.trim() || task.operator,
          segments: [],
          signoff: undefined,
          precheck: { ...snapshotPump(pump), ok: evalResult.ok, violations: evalResult.violations, checkedAt: Date.now() },
          status: evalResult.ok ? "ready" : "inspection",
        });
        addEvent(draft, pump.id, "rework", `${task.code} 返工后重新派发（${operator.trim() || task.operator}），重新预检`, operator.trim() || task.operator, taskId);
        return { ok: true, message: evalResult.ok ? "返工任务已重新进入待充填队列" : "泵仍越线，返工任务进设备待检" };
      }),
    [run]
  );

  /** 修改泵冷却水参数 / 滤芯更换日，并写入设备履历 */
  const editPump = useCallback(
    (pumpId: string, patch: Partial<Pick<Pump, "waterTempC" | "flowLmin" | "filterChangedAt" | "filterServiceDays" | "statusNote" | "name">>, editor: string): ActionResult =>
      run((draft) => {
        const pump = draft.pumps.find((p) => p.id === pumpId);
        if (!pump) return { ok: false, message: "泵不存在" };
        const before = evaluatePump(pump);
        Object.assign(pump, patch);
        const after = evaluatePump(pump);
        const changes: string[] = [];
        if (patch.waterTempC != null && patch.waterTempC !== undefined) changes.push(`水温 ${pump.waterTempC}℃`);
        if (patch.flowLmin != null) changes.push(`流量 ${pump.flowLmin}L/min`);
        if (patch.filterChangedAt != null) changes.push(`滤芯更换日 ${pump.filterChangedAt}`);
        if (patch.filterServiceDays != null) changes.push(`滤芯周期 ${pump.filterServiceDays}天`);
        addEvent(draft, pumpId, "pumpEdited", `${pump.name} 参数更新（${editor}）：${changes.join(" / ") || "备注更新"}；判定：${after.ok ? "合格" : describeViolations(after.violations)}`, editor || pump.id);
        return {
          ok: after.ok,
          message: after.ok
            ? `${pump.id} 当前判定合格`
            : `${pump.id} 当前越线：${describeViolations(after.violations)}${before.ok ? "（新越线）" : ""}`,
        };
      }),
    [run]
  );

  const reset = useCallback(() => {
    setState(resetState());
    notify({ ok: true, message: "已恢复演示数据" });
  }, [notify]);

  const derived = useMemo(() => {
    const pumpById = new Map(state.pumps.map((p) => [p.id, p]));
    const byStatus = (s: FillTask["status"]) => state.tasks.filter((t) => t.status === s);
    const occupiedByPump = new Map<string, FillTask>();
    state.tasks.forEach((t) => {
      if (t.status === "filling" || t.status === "paused") occupiedByPump.set(t.pumpId, t);
    });
    return {
      pumpById,
      occupiedByPump,
      ready: byStatus("ready"),
      inspection: byStatus("inspection"),
      filling: [...byStatus("filling"), ...byStatus("paused")],
      filled: byStatus("filled"),
      rework: byStatus("rework"),
      signed: byStatus("signed"),
    };
  }, [state]);

  return {
    state,
    toasts,
    derived,
    createTask,
    recheckTask,
    occupy,
    pauseTask,
    resumeTask,
    finishFill,
    signoff,
    redispatch,
    editPump,
    reset,
  };
}

export type ConsoleApi = ReturnType<typeof useConsole>;
