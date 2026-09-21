// 泵判定规则 —— 与页面、存储解耦，纯函数
import type { FillMode, Pump, PumpSnapshot, SignoffCheck, Violation } from "./types";

// 联动台硬性阈值
export const TEMP_LIMIT_C = 35; // 冷却水温度高于 35℃ 越线
export const FLOW_LIMIT_LMIN = 6; // 冷却水流量低于 6L/min 越线

// 签收核验容差
export const PRESSURE_TOLERANCE = 0.05; // 实测压力低于目标 5% 视为越限
export const O2_TOLERANCE_PP = 1; // 氧浓度与目标相差超过 1 个百分点视为越限

export const FILTER_WARN_DAYS = 7;

export const MODE_LABELS: Record<FillMode, string> = {
  air: "空气",
  nitrox: "高氧 EANx",
  trimix: "Trimix 三混",
  oxygen: "纯氧",
};

export const VIOLATION_LABELS: Record<Violation, string> = {
  temp: `冷却水温 > ${TEMP_LIMIT_C}℃`,
  flow: `冷却水流量 < ${FLOW_LIMIT_LMIN}L/min`,
  filter: "滤芯超期",
};

export const STATUS_LABELS: Record<string, string> = {
  ready: "待上充填位",
  inspection: "设备待检",
  filling: "充填中",
  paused: "越线暂停",
  filled: "待签收",
  signed: "已签收",
  rework: "返工",
};

export const EVENT_TYPE_LABELS: Record<string, string> = {
  created: "建档",
  blocked: "预检拦截",
  recheck: "复检",
  occupied: "占工位",
  paused: "越线暂停",
  resumed: "复核续充",
  filled: "充填完成",
  signed: "签收",
  rework: "返工",
  pumpEdited: "泵参数更新",
};

/** 以本地零点解析 yyyy-mm-dd，避免 UTC 偏移造成到期日误判 */
export function parseDay(value: string): number {
  const [y, m, d] = value.split("-").map(Number);
  return new Date(y || 1970, (m || 1) - 1, d || 1).getTime();
}

export function todayDay(): number {
  const now = new Date();
  return new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
}

export function daysUntil(dateStr: string, now = Date.now()): number {
  const due = parseDay(dateStr);
  const cur = new Date(now);
  const today = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()).getTime();
  return Math.round((due - today) / 86400000);
}

export function isOverdue(dateStr: string, now = Date.now()): boolean {
  return daysUntil(dateStr, now) < 0;
}

export function formatDateTime(ts: number): string {
  const d = new Date(ts);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** 滤芯剩余可用天数：更换日 + 额定天数 - 今天 */
export function filterDaysLeft(p: Pick<Pump, "filterChangedAt" | "filterServiceDays">, now = Date.now()): number {
  const deadline = parseDay(p.filterChangedAt) + p.filterServiceDays * 86400000;
  const cur = new Date(now);
  const today = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()).getTime();
  return Math.round((deadline - today) / 86400000);
}

/** 核心泵判定：温度、流量、滤芯任一越限即不合格 */
export function evaluatePump(
  data: Pick<PumpSnapshot, "waterTempC" | "flowLmin" | "filterChangedAt" | "filterServiceDays">,
  now = Date.now()
): { ok: boolean; violations: Violation[]; daysLeft: number } {
  const violations: Violation[] = [];
  if (data.waterTempC > TEMP_LIMIT_C) violations.push("temp");
  if (data.flowLmin < FLOW_LIMIT_LMIN) violations.push("flow");
  const daysLeft = filterDaysLeft(data, now);
  if (daysLeft < 0) violations.push("filter");
  return { ok: violations.length === 0, violations, daysLeft };
}

export function snapshotPump(pump: Pump): PumpSnapshot {
  return {
    pumpId: pump.id,
    waterTempC: pump.waterTempC,
    flowLmin: pump.flowLmin,
    filterChangedAt: pump.filterChangedAt,
    filterServiceDays: pump.filterServiceDays,
  };
}

export function describeViolations(violations: Violation[]): string {
  return violations.map((v) => VIOLATION_LABELS[v]).join("、");
}

/** 单段时长（分钟）；进行段按当前时间实时计 */
export function segmentMinutes(seg: { startedAt: number; endedAt: number | null; minutes: number | null }, now = Date.now()): number {
  if (seg.minutes != null) return seg.minutes;
  return Math.max(0, Math.round(((seg.endedAt ?? now) - seg.startedAt) / 60000));
}

/** 任务累计充填时长（含进行段，不含暂停等待处理时间） */
export function totalFillMinutes(
  segments: { startedAt: number; endedAt: number | null; minutes: number | null }[],
  now = Date.now()
): number {
  return segments.reduce((sum, seg) => sum + segmentMinutes(seg, now), 0);
}

/** 续充段数 = 暂停后续充产生的段 */
export function resumeSegmentCount(segments: { reviewer?: string }[]): number {
  return segments.filter((s) => s.reviewer != null).length;
}

/** 签收前复核：实测压力与氧浓度任一越限即不合格，转返工 */
export function checkSignoff(
  targetPressure: number,
  targetO2: number,
  measuredPressure: number,
  measuredO2: number
): Omit<SignoffCheck, "checker" | "checkedAt"> {
  const failures: string[] = [];
  const minPressure = targetPressure * (1 - PRESSURE_TOLERANCE);
  if (measuredPressure < minPressure) {
    failures.push(`实测压力 ${measuredPressure}bar 低于下限 ${Math.round(minPressure)}bar（目标 ${targetPressure}bar 的 -5%）`);
  }
  if (measuredPressure > targetPressure * (1 + PRESSURE_TOLERANCE)) {
    failures.push(`实测压力 ${measuredPressure}bar 超过目标 ${targetPressure}bar 的 +5%`);
  }
  if (Math.abs(measuredO2 - targetO2) > O2_TOLERANCE_PP) {
    failures.push(`实测氧浓度 ${measuredO2}% 与目标 ${targetO2}% 相差超过 ${O2_TOLERANCE_PP} 个百分点`);
  }
  return { measuredPressure, measuredO2, pass: failures.length === 0, failures };
}

/** 混合气比例提示 */
export function mixHint(mode: FillMode, o2: number, he: number): string {
  const n2 = Math.max(0, 100 - o2 - he);
  switch (mode) {
    case "air":
      return "空气充填：O₂≈21%，目标压力前注意冷凝排水";
    case "nitrox":
      return `高氧：O₂ ${o2}% / N₂ ${n2.toFixed(1)}%，确认用氧兼容件并防过压升温`;
    case "trimix":
      return `Trimix：O₂ ${o2}% / He ${he}% / N₂ ${n2.toFixed(1)}%，按氦先后氧顺序充填`;
    case "oxygen":
      return "纯氧充填：严格脱脂，流速限温防燃";
  }
}
