// ─────────────────────────────────────────────────────────────
// 领域模型：充填泵冷却水联动台
// 阈值集中在此处，判定函数全部为纯函数，不依赖 React / localStorage
// ─────────────────────────────────────────────────────────────

/** 冷却水红线：温度 > 35℃（高于，不含等于） */
export const MAX_COOLANT_TEMP = 35;
/** 冷却水红线：流量 < 6 L/min（低于，不含等于） */
export const MIN_COOLANT_FLOW = 6;
/** 滤芯更换周期：天 */
export const FILTER_INTERVAL_DAYS = 180;
/** 签收压力容差：±bar */
export const PRESSURE_TOLERANCE_BAR = 5;
/** 签收氧浓度容差：±% */
export const O2_TOLERANCE_PCT = 1;
/** 充填模拟速率：bar/秒（演示用） */
export const FILL_RATE_BAR_PER_SEC = 4;

export type PumpStatus = "normal" | "blocked";

export interface Pump {
  id: string;
  name: string;
  /** 冷却水温度 ℃ */
  coolantTemp: number;
  /** 冷却水流量 L/min */
  coolantFlow: number;
  /** 最近一次滤芯更换日 ISO yyyy-mm-dd */
  filterChangedAt: string;
  /** 滤芯更换周期（天），允许现场调整 */
  filterIntervalDays: number;
}

export type GateFailCode =
  | "TEMP_HIGH"
  | "FLOW_LOW"
  | "FILTER_OVERDUE";

export interface GateFailure {
  code: GateFailCode;
  /** 现场判定依据，如 “36.2℃ > 35℃” */
  detail: string;
}

export interface GateVerdict {
  ok: boolean;
  failures: GateFailure[];
}

export type FillMode = "空气" | "高氧" | "Trimix";

export type TaskStatus =
  | "queued" // 待充填，可占用充填位
  | "pending_check" // 设备待检：泵冷却水联动不合格，不能占充填位
  | "filling" // 充填中（占用泵对应工位）
  | "paused" // 越线暂停，等待另一人复核后续充
  | "awaiting_signoff" // 充填到位，等待签收核实
  | "signed" // 已签收
  | "rework"; // 签收越限，转返工

/** 一段连续充填时长：首段为首充，其余为他人复核后续充 */
export interface FillSegment {
  operator: string;
  /** 该段累计充填秒数 */
  seconds: number;
  kind: "首充" | "续充";
}

export interface PauseRecord {
  at: string;
  /** GATE_* 为越线暂停；MANUAL 为人工紧急暂停 */
  reasons: { code: GateFailCode | "MANUAL"; detail: string }[];
  /** 暂停瞬间已用总时长（秒） */
  elapsedSeconds: number;
  /** 暂停瞬间当前压力 bar */
  pressureBar: number;
  operator: string;
}

export interface RecheckRecord {
  at: string;
  /** 与暂停时操作员不同的复核人 */
  reviewer: string;
  note: string;
}

export interface GateRejection {
  /** 入台即被截到设备待检时，截下时的读数快照 */
  at: string;
  failures: GateFailure[];
  temp: number;
  flow: number;
  filterChangedAt: string;
}

export interface SignoffRecord {
  at: string;
  receiver: string;
  measuredPressure: number;
  measuredO2: number;
  passed: boolean;
  failures: SignoffFailure[];
}

export type SignoffFailureCode = "PRESSURE_OUT" | "O2_OUT";

export interface SignoffFailure {
  code: SignoffFailureCode;
  detail: string;
}

export interface FillTask {
  id: string;
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
  createdAt: string;

  status: TaskStatus;
  /** 当前压力 bar */
  currentPressure: number;
  /** 分段计时（首充 / 各次续充独立累加） */
  segments: FillSegment[];
  /** 当前正在累计的段（filling/paused 时保留） */
  activeSeconds: number;
  activeOperator: string | null;
  pauses: PauseRecord[];
  rechecks: RecheckRecord[];
  rejection: GateRejection | null;
  signoff: SignoffRecord | null;
}

export type HistoryKind =
  | "CREATED"
  | "GATE_BLOCKED"
  | "FILL_STARTED"
  | "GATE_PAUSE"
  | "MANUAL_PAUSE"
  | "RECHECKED"
  | "RESUMED"
  | "FILL_DONE"
  | "SIGNED"
  | "SIGNOFF_FAIL"
  | "REWORK_REQUEUE"
  | "FILTER_CHANGED"
  | "PUMP_READING";

export interface HistoryEvent {
  id: string;
  at: string;
  kind: HistoryKind;
  pumpId?: string;
  taskId?: string;
  tankNo?: string;
  message: string;
}

export interface ConsoleState {
  pumps: Pump[];
  tasks: FillTask[];
  history: HistoryEvent[];
  seq: number;
}

// ── 日期工具 ──────────────────────────────────────────────────

export function todayISO(d: Date = new Date()): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

export function addDays(iso: string, days: number): string {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + days);
  return todayISO(d);
}

export function daysBetween(fromISO: string, toISO: string): number {
  const a = new Date(fromISO + "T00:00:00").getTime();
  const b = new Date(toISO + "T00:00:00").getTime();
  return Math.round((b - a) / 86_400_000);
}

// ── 泵判定（纯函数）──────────────────────────────────────────

/** 滤芯是否超期：今天距上次更换日已超过更换周期 */
export function filterOverdue(p: Pump, today: string = todayISO()): boolean {
  const used = daysBetween(p.filterChangedAt, today);
  return used > p.filterIntervalDays;
}

/**
 * 冷却水联动判定：
 * 温度高于 35℃、流量低于 6L/min 或滤芯超期，任一成立即不合格。
 * 这是任务能否占用充填位、以及充填中是否必须暂停的唯一依据。
 */
export function judgePump(
  p: Pump,
  today: string = todayISO()
): GateVerdict {
  const failures: GateFailure[] = [];
  if (p.coolantTemp > MAX_COOLANT_TEMP) {
    failures.push({
      code: "TEMP_HIGH",
      detail: `冷却水 ${p.coolantTemp}℃ > ${MAX_COOLANT_TEMP}℃`,
    });
  }
  if (p.coolantFlow < MIN_COOLANT_FLOW) {
    failures.push({
      code: "FLOW_LOW",
      detail: `流量 ${p.coolantFlow}L/min < ${MIN_COOLANT_FLOW}L/min`,
    });
  }
  const used = daysBetween(p.filterChangedAt, today);
  if (used > p.filterIntervalDays) {
    failures.push({
      code: "FILTER_OVERDUE",
      detail: `滤芯已用 ${used} 天，超过周期 ${p.filterIntervalDays} 天`,
    });
  }
  return { ok: failures.length === 0, failures };
}

export function gateStatus(p: Pump): PumpStatus {
  return judgePump(p).ok ? "normal" : "blocked";
}

// ── 签收前核实（纯函数）──────────────────────────────────────

export function judgeSignoff(
  task: Pick<FillTask, "targetPressure" | "targetO2">,
  measuredPressure: number,
  measuredO2: number
): { passed: boolean; failures: SignoffFailure[] } {
  const failures: SignoffFailure[] = [];
  if (
    Math.abs(measuredPressure - task.targetPressure) >
    PRESSURE_TOLERANCE_BAR
  ) {
    failures.push({
      code: "PRESSURE_OUT",
      detail: `实测 ${measuredPressure}bar，目标 ${task.targetPressure}±${PRESSURE_TOLERANCE_BAR}bar`,
    });
  }
  if (Math.abs(measuredO2 - task.targetO2) > O2_TOLERANCE_PCT) {
    failures.push({
      code: "O2_OUT",
      detail: `实测氧 ${measuredO2}%，目标 ${task.targetO2}±${O2_TOLERANCE_PCT}%`,
    });
  }
  return { passed: failures.length === 0, failures };
}

// ── 显示工具 ──────────────────────────────────────────────────

export function totalElapsedSeconds(task: FillTask): number {
  return (
    task.segments.reduce((sum, s) => sum + s.seconds, 0) +
    task.activeSeconds
  );
}

export function formatDuration(totalSeconds: number): string {
  const s = Math.round(totalSeconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}小时`);
  if (m) parts.push(`${m}分`);
  parts.push(`${sec}秒`);
  return parts.join("");
}

export function formatClock(iso: string): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(
    d.getHours()
  )}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}
