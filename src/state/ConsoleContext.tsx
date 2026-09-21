import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useReducer,
  type ReactNode,
} from "react";
import { seedState } from "../domain/seed";
import {
  FILL_RATE_BAR_PER_SEC,
  judgePump,
  judgeSignoff,
  todayISO,
  type ConsoleState,
  type FillMode,
  type FillTask,
  type GateFailure,
  type HistoryEvent,
  type HistoryKind,
  type Pump,
} from "../domain/types";

// ── 落盘：工位/任务、设备履历分键存储，带版本号便于以后迁移 ──

const VERSION = 1;
const TASKS_KEY = `cfc:${VERSION}:tasks`;
const PUMPS_KEY = `cfc:${VERSION}:pumps`;
const HISTORY_KEY = `cfc:${VERSION}:history`;
const SEQ_KEY = `cfc:${VERSION}:seq`;

export function loadState(): ConsoleState {
  try {
    const tasksRaw = localStorage.getItem(TASKS_KEY);
    const pumpsRaw = localStorage.getItem(PUMPS_KEY);
    const historyRaw = localStorage.getItem(HISTORY_KEY);
    const seqRaw = localStorage.getItem(SEQ_KEY);
    if (tasksRaw && pumpsRaw && historyRaw) {
      return {
        tasks: JSON.parse(tasksRaw) as FillTask[],
        pumps: JSON.parse(pumpsRaw) as Pump[],
        history: JSON.parse(historyRaw) as HistoryEvent[],
        seq: seqRaw ? Number(seqRaw) : seedState.seq,
      };
    }
  } catch {
    // 落盘损坏时回退种子，保证工位仍可一致呈现
  }
  return seedState;
}

function persist(state: ConsoleState) {
  localStorage.setItem(TASKS_KEY, JSON.stringify(state.tasks));
  localStorage.setItem(PUMPS_KEY, JSON.stringify(state.pumps));
  localStorage.setItem(HISTORY_KEY, JSON.stringify(state.history));
  localStorage.setItem(SEQ_KEY, String(state.seq));
}

// ── Actions ───────────────────────────────────────────────────

export interface NewTaskInput {
  tankNo: string;
  volume: string;
  inspectionDue: string;
  fillMode: FillMode;
  residualPressure: number;
  targetPressure: number;
  targetO2: number;
  targetHe: number;
  operator: string;
  pumpId: string;
}

export type Action =
  | { type: "CREATE_TASK"; input: NewTaskInput }
  | {
      type: "UPDATE_PUMP_READING";
      pumpId: string;
      patch: Partial<Pick<Pump, "coolantTemp" | "coolantFlow">>;
    }
  | { type: "CHANGE_FILTER"; pumpId: string; operator: string }
  | { type: "REINSPECT"; taskId: string; reviewer: string; note: string }
  | { type: "START_FILL"; taskId: string; operator: string }
  | { type: "PAUSE_FILL"; taskId: string; operator: string }
  | {
      type: "RESUME_FILL";
      taskId: string;
      reviewer: string;
      note: string;
    }
  | { type: "TICK" }
  | {
      type: "SIGNOFF";
      taskId: string;
      receiver: string;
      measuredPressure: number;
      measuredO2: number;
    }
  | { type: "REQUEUE_REWORK"; taskId: string; operator: string }
  | { type: "RESET_DEMO" };

// ── Reducer 工具 ──────────────────────────────────────────────

let counter = 0;
function localId(prefix: string, seq: number): string {
  counter += 1;
  return `${prefix}-${seq}-${counter.toString(36)}${Date.now()
    .toString(36)
    .slice(-3)}`.toUpperCase();
}

function pushHistory(
  state: ConsoleState,
  event: Omit<HistoryEvent, "id" | "at"> & { at?: string }
): void {
  state.seq += 1;
  state.history.unshift({
    id: localId("H", state.seq),
    at: event.at ?? new Date().toISOString(),
    kind: event.kind,
    pumpId: event.pumpId,
    taskId: event.taskId,
    tankNo: event.tankNo,
    message: event.message,
  });
  if (state.history.length > 400) state.history.length = 400;
}

function failureText(failures: GateFailure[]): string {
  return failures.map((f) => f.detail).join("；");
}

/** 冻结当前活动段（首充/续充独立累加） */
function freezeActiveSegment(task: FillTask) {
  if (task.activeOperator !== null && task.activeSeconds > 0) {
    task.segments.push({
      operator: task.activeOperator,
      seconds: Math.round(task.activeSeconds),
      kind: task.segments.length === 0 ? "首充" : "续充",
    });
  }
  task.activeOperator = null;
  task.activeSeconds = 0;
}

function clone(state: ConsoleState): ConsoleState {
  return structuredClone(state);
}

function pumpOf(state: ConsoleState, pumpId: string): Pump {
  const p = state.pumps.find((x) => x.id === pumpId);
  if (!p) throw new Error(`未知泵编号 ${pumpId}`);
  return p;
}

// ── Reducer：任务状态机 + 设备履历，全部同步落盘前数据 ────────

function reducer(prev: ConsoleState, action: Action): ConsoleState {
  const state = clone(prev);

  switch (action.type) {
    case "CREATE_TASK": {
      const pump = pumpOf(state, action.input.pumpId);
      state.seq += 1;
      const id = `T-${state.seq}`;
      const verdict = judgePump(pump);
      const task: FillTask = {
        ...action.input,
        id,
        createdAt: new Date().toISOString(),
        status: verdict.ok ? "queued" : "pending_check",
        currentPressure: action.input.residualPressure,
        segments: [],
        activeSeconds: 0,
        activeOperator: null,
        pauses: [],
        rechecks: [],
        rejection: verdict.ok
          ? null
          : {
              at: new Date().toISOString(),
              failures: verdict.failures,
              temp: pump.coolantTemp,
              flow: pump.coolantFlow,
              filterChangedAt: pump.filterChangedAt,
            },
        signoff: null,
      };
      state.tasks.unshift(task);
      pushHistory(state, {
        kind: "CREATED",
        pumpId: pump.id,
        taskId: id,
        tankNo: task.tankNo,
        message: `${task.tankNo} ${task.fillMode}任务创建，绑定 ${pump.id}（${pump.name}）`,
      });
      if (!verdict.ok) {
        pushHistory(state, {
          kind: "GATE_BLOCKED",
          pumpId: pump.id,
          taskId: id,
          tankNo: task.tankNo,
          message: `${pump.id} ${failureText(
            verdict.failures
          )}，${task.tankNo} 只进设备待检，不占充填位`,
        });
      }
      return state;
    }

    case "UPDATE_PUMP_READING": {
      const pump = pumpOf(state, action.pumpId);
      const nextTemp = action.patch.coolantTemp ?? pump.coolantTemp;
      const nextFlow = action.patch.coolantFlow ?? pump.coolantFlow;
      if (nextTemp === pump.coolantTemp && nextFlow === pump.coolantFlow) {
        return prev; // 读数未变，不写履历
      }
      pump.coolantTemp = nextTemp;
      pump.coolantFlow = nextFlow;
      const verdict = judgePump(pump);
      pushHistory(state, {
        kind: "PUMP_READING",
        pumpId: pump.id,
        message: `${pump.id} 读数更新：${pump.coolantTemp}℃ / ${pump.coolantFlow}L/min${
          verdict.ok ? "" : `（越线：${failureText(verdict.failures)}）`
        }`,
      });
      // 充填中越线：立即暂停并记下已用时长与当前压力
      if (!verdict.ok) {
        for (const task of state.tasks) {
          if (task.pumpId === pump.id && task.status === "filling") {
            pauseForGate(state, task, verdict.failures);
          }
        }
      }
      return state;
    }

    case "CHANGE_FILTER": {
      const pump = pumpOf(state, action.pumpId);
      pump.filterChangedAt = todayISO();
      pushHistory(state, {
        kind: "FILTER_CHANGED",
        pumpId: pump.id,
        message: `${pump.id} 滤芯已更换（操作人 ${action.operator}），周期重置 ${pump.filterIntervalDays} 天`,
      });
      return state;
    }

    case "REINSPECT": {
      // 设备待检 → 检修后复判；泵恢复合格才放回待充填
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.status !== "pending_check") return prev;
      const pump = pumpOf(state, task.pumpId);
      const verdict = judgePump(pump);
      task.rechecks.push({
        at: new Date().toISOString(),
        reviewer: action.reviewer,
        note: action.note,
      });
      if (verdict.ok) {
        task.status = "queued";
        task.rejection = null;
        pushHistory(state, {
          kind: "RECHECKED",
          pumpId: pump.id,
          taskId: task.id,
          tankNo: task.tankNo,
          message: `${action.reviewer} 复判 ${pump.id} 已恢复（${action.note || "无备注"}），${task.tankNo} 放回待充填`,
        });
      } else {
        pushHistory(state, {
          kind: "RECHECKED",
          pumpId: pump.id,
          taskId: task.id,
          tankNo: task.tankNo,
          message: `${action.reviewer} 复判 ${pump.id} 仍不合格：${failureText(
            verdict.failures
          )}，${task.tankNo} 留设备待检`,
        });
      }
      return state;
    }

    case "START_FILL": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.status !== "queued") return prev;
      const pump = pumpOf(state, task.pumpId);
      // 一个泵工位同一时刻只允许一个任务
      const occupied = state.tasks.some(
        (t) =>
          t.id !== task.id &&
          (t.status === "filling" || t.status === "paused") &&
          t.pumpId === pump.id
      );
      if (occupied) return prev;
      const verdict = judgePump(pump);
      if (!verdict.ok) {
        // 占泵瞬间再次核泵：不合格直接拦回设备待检
        task.status = "pending_check";
        task.rejection = {
          at: new Date().toISOString(),
          failures: verdict.failures,
          temp: pump.coolantTemp,
          flow: pump.coolantFlow,
          filterChangedAt: pump.filterChangedAt,
        };
        pushHistory(state, {
          kind: "GATE_BLOCKED",
          pumpId: pump.id,
          taskId: task.id,
          tankNo: task.tankNo,
          message: `占泵复判 ${pump.id} ${failureText(
            verdict.failures
          )}，${task.tankNo} 拦回设备待检`,
        });
        return state;
      }
      task.status = "filling";
      task.activeOperator = action.operator;
      task.activeSeconds = 0;
      pushHistory(state, {
        kind: "FILL_STARTED",
        pumpId: pump.id,
        taskId: task.id,
        tankNo: task.tankNo,
        message: `${task.tankNo} 在 ${pump.id} 工位开始首充，操作人 ${action.operator}`,
      });
      return state;
    }

    case "PAUSE_FILL": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.status !== "filling") return prev;
      const elapsed = totalElapsed(task);
      const pressure = task.currentPressure;
      task.pauses.push({
        at: new Date().toISOString(),
        reasons: [{ code: "MANUAL", detail: "人工紧急暂停（转另一人复核流程）" }],
        elapsedSeconds: Math.round(elapsed),
        pressureBar: pressure,
        operator: action.operator,
      });
      freezeActiveSegment(task);
      task.status = "paused";
      pushHistory(state, {
        kind: "MANUAL_PAUSE",
        pumpId: task.pumpId,
        taskId: task.id,
        tankNo: task.tankNo,
        message: `${task.tankNo} 人工暂停：已用 ${Math.round(
          elapsed
        )}秒，当前 ${pressure}bar，待另一人复核后续充`,
      });
      return state;
    }

    case "RESUME_FILL": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.status !== "paused") return prev;
      const pump = pumpOf(state, task.pumpId);
      const verdict = judgePump(pump);
      if (!verdict.ok) return prev; // 泵未恢复不能续充
      if (action.reviewer.trim() === task.operator) return prev; // 必须另一人
      // 先冻结首充段（若 TICK 时尚未冻结）
      freezeActiveSegment(task);
      task.rechecks.push({
        at: new Date().toISOString(),
        reviewer: action.reviewer,
        note: action.note,
      });
      task.status = "filling";
      // 续充时间单独累加：新起一段，操作员记复核人
      task.activeOperator = action.reviewer;
      task.activeSeconds = 0;
      pushHistory(state, {
        kind: "RESUMED",
        pumpId: pump.id,
        taskId: task.id,
        tankNo: task.tankNo,
        message: `${action.reviewer} 复核（${action.note || "无备注"}）后续充 ${
          task.tankNo
        }，续充时间从 ${Math.round(totalElapsed(task))}秒 起单独累加`,
      });
      return state;
    }

    case "TICK": {
      let changed = false;
      for (const task of state.tasks) {
        if (task.status !== "filling") continue;
        const pump = pumpOf(state, task.pumpId);
        const verdict = judgePump(pump);
        if (!verdict.ok) {
          // 充填中任一参数越线：暂停并留痕
          pauseForGate(state, task, verdict.failures);
          changed = true;
          continue;
        }
        task.activeSeconds += 1;
        const next = Math.min(
          task.targetPressure,
          task.currentPressure + FILL_RATE_BAR_PER_SEC
        );
        task.currentPressure = next;
        changed = true;
        if (next >= task.targetPressure) {
          // 到压：冻结时长、释放工位，进签收
          freezeActiveSegment(task);
          task.status = "awaiting_signoff";
          pushHistory(state, {
            kind: "FILL_DONE",
            pumpId: pump.id,
            taskId: task.id,
            tankNo: task.tankNo,
            message: `${task.tankNo} 充填到位 ${next}bar，总用时 ${Math.round(
              totalElapsed(task)
            )}秒，释放 ${pump.id} 工位待签收`,
          });
        }
      }
      return changed ? state : prev;
    }

    case "SIGNOFF": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.status !== "awaiting_signoff") return prev;
      const result = judgeSignoff(
        task,
        action.measuredPressure,
        action.measuredO2
      );
      task.signoff = {
        at: new Date().toISOString(),
        receiver: action.receiver,
        measuredPressure: action.measuredPressure,
        measuredO2: action.measuredO2,
        passed: result.passed,
        failures: result.failures,
      };
      if (result.passed) {
        task.status = "signed";
        pushHistory(state, {
          kind: "SIGNED",
          pumpId: task.pumpId,
          taskId: task.id,
          tankNo: task.tankNo,
          message: `${task.tankNo} 签收通过：实测 ${action.measuredPressure}bar / O₂ ${action.measuredO2}%，签收人 ${action.receiver}`,
        });
      } else {
        task.status = "rework";
        pushHistory(state, {
          kind: "SIGNOFF_FAIL",
          pumpId: task.pumpId,
          taskId: task.id,
          tankNo: task.tankNo,
          message: `${task.tankNo} 签收核实越限（${result.failures
            .map((f) => f.detail)
            .join("；")}），转返工`,
        });
      }
      return state;
    }

    case "REQUEUE_REWORK": {
      const task = state.tasks.find((t) => t.id === action.taskId);
      if (!task || task.status !== "rework") return prev;
      task.status = "queued";
      task.operator = action.operator;
      task.currentPressure = task.residualPressure;
      task.segments = [];
      task.activeSeconds = 0;
      task.activeOperator = null;
      task.pauses = [];
      task.rechecks = [];
      task.signoff = null;
      task.rejection = null;
      pushHistory(state, {
        kind: "REWORK_REQUEUE",
        pumpId: task.pumpId,
        taskId: task.id,
        tankNo: task.tankNo,
        message: `${task.tankNo} 返工处理完成（${action.operator}），重新进入待充填`,
      });
      return state;
    }

    case "RESET_DEMO":
      return seedState;

    default:
      return prev;
  }
}

function totalElapsed(task: FillTask): number {
  return (
    task.segments.reduce((s, x) => s + x.seconds, 0) + task.activeSeconds
  );
}

/** 充填中越线暂停的统一入口：冻结当前段、记已用时长与当前压力 */
function pauseForGate(
  state: ConsoleState,
  task: FillTask,
  failures: GateFailure[]
) {
  const elapsed = totalElapsed(task);
  const pressure = task.currentPressure;
  task.pauses.push({
    at: new Date().toISOString(),
    reasons: failures,
    elapsedSeconds: Math.round(elapsed),
    pressureBar: pressure,
    operator: task.activeOperator ?? task.operator,
  });
  freezeActiveSegment(task);
  task.status = "paused";
  pushHistory(state, {
    kind: "GATE_PAUSE",
    pumpId: task.pumpId,
    taskId: task.id,
    tankNo: task.tankNo,
    message: `${task.tankNo} 充填中越线暂停（${failureText(
      failures
    )}）：已用 ${Math.round(elapsed)}秒，当前 ${pressure}bar，待另一人复核后续充`,
  });
}

// ── Context ───────────────────────────────────────────────────

interface ConsoleContextValue {
  state: ConsoleState;
  dispatch: React.Dispatch<Action>;
}

const ConsoleContext = createContext<ConsoleContextValue | null>(null);

export function ConsoleProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(reducer, undefined, loadState);

  // 每次状态变更即落盘：刷新后工位、待检清单、履历一致
  useEffect(() => {
    persist(state);
  }, [state]);

  // 充填中每秒推进；无充填任务时不产生状态变更
  const hasFilling = state.tasks.some((t) => t.status === "filling");
  useEffect(() => {
    if (!hasFilling) return;
    const timer = window.setInterval(() => dispatch({ type: "TICK" }), 1000);
    return () => window.clearInterval(timer);
  }, [hasFilling]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return (
    <ConsoleContext.Provider value={value}>{children}</ConsoleContext.Provider>
  );
}

export function useConsole(): ConsoleContextValue {
  const ctx = useContext(ConsoleContext);
  if (!ctx) throw new Error("useConsole 必须在 ConsoleProvider 内使用");
  return ctx;
}
