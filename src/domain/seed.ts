import type { ConsoleState, FillTask, Pump } from "./types";
import { addDays, todayISO } from "./types";

const now = new Date("2026-09-21T09:12:00");

function isoAt(h: number, m: number): string {
  const d = new Date(now);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
}

const pumps: Pump[] = [
  {
    id: "P-01",
    name: "1号充填泵",
    coolantTemp: 28.4,
    coolantFlow: 9.2,
    filterChangedAt: addDays(todayISO(now), -64),
    filterIntervalDays: 180,
  },
  {
    id: "P-02",
    name: "2号充填泵",
    coolantTemp: 36.8, // 温度高于 35℃ → 设备待检
    coolantFlow: 8.5,
    filterChangedAt: addDays(todayISO(now), -95),
    filterIntervalDays: 180,
  },
  {
    id: "P-03",
    name: "3号充填泵",
    coolantTemp: 27.6,
    coolantFlow: 4.8, // 流量低于 6L/min
    filterChangedAt: addDays(todayISO(now), -205), // 滤芯超期
    filterIntervalDays: 180,
  },
];

function baseTask(partial: Partial<FillTask> & Pick<FillTask, "id" | "tankNo" | "pumpId">): FillTask {
  return {
    volume: "12L铝瓶",
    inspectionDue: addDays(todayISO(now), 200),
    fillMode: "空气",
    residualPressure: 50,
    targetPressure: 200,
    targetO2: 21,
    targetHe: 0,
    operator: "李潜",
    createdAt: isoAt(8, 40),
    status: "queued",
    currentPressure: partial.residualPressure ?? 50,
    segments: [],
    activeSeconds: 0,
    activeOperator: null,
    pauses: [],
    rechecks: [],
    rejection: null,
    signoff: null,
    ...partial,
  };
}

const tasks: FillTask[] = [
  // 泵正常：待充填，可占工位
  baseTask({
    id: "T-1001",
    tankNo: "TANK-204",
    pumpId: "P-01",
    volume: "12L铝瓶",
    residualPressure: 55,
    currentPressure: 55,
    targetPressure: 200,
    targetO2: 21,
    fillMode: "空气",
    operator: "李潜",
  }),
  // 泵温越线：入台即进设备待检
  baseTask({
    id: "T-1002",
    tankNo: "TANK-231",
    pumpId: "P-02",
    volume: "双瓶组",
    inspectionDue: addDays(todayISO(now), 12),
    residualPressure: 40,
    currentPressure: 40,
    targetPressure: 230,
    targetO2: 32,
    fillMode: "高氧",
    operator: "王潮",
    rejection: {
      at: isoAt(8, 52),
      failures: [{ code: "TEMP_HIGH", detail: "冷却水 36.8℃ > 35℃" }],
      temp: 36.8,
      flow: 8.5,
      filterChangedAt: addDays(todayISO(now), -95),
    },
    status: "pending_check",
  }),
  // 流量低 + 滤芯超期：设备待检
  baseTask({
    id: "T-1003",
    tankNo: "TANK-227",
    pumpId: "P-03",
    volume: "11L钢瓶",
    residualPressure: 60,
    currentPressure: 60,
    targetPressure: 200,
    targetO2: 21,
    fillMode: "空气",
    operator: "赵宁",
    createdAt: isoAt(8, 55),
    rejection: {
      at: isoAt(8, 55),
      failures: [
        { code: "FLOW_LOW", detail: "流量 4.8L/min < 6L/min" },
        { code: "FILTER_OVERDUE", detail: "滤芯已用 205 天，超过周期 180 天" },
      ],
      temp: 27.6,
      flow: 4.8,
      filterChangedAt: addDays(todayISO(now), -205),
    },
    status: "pending_check",
  }),
  // 越线暂停：已记首充时长与压力，等另一人复核后续充
  baseTask({
    id: "T-1004",
    tankNo: "TANK-219",
    pumpId: "P-02",
    volume: "11L钢瓶",
    residualPressure: 50,
    currentPressure: 138,
    targetPressure: 200,
    targetO2: 32,
    fillMode: "高氧",
    operator: "李潜",
    createdAt: isoAt(8, 20),
    status: "paused",
    segments: [{ operator: "李潜", seconds: 22, kind: "首充" }],
    activeSeconds: 0,
    activeOperator: null,
    pauses: [
      {
        at: isoAt(9, 4),
        reasons: [{ code: "TEMP_HIGH", detail: "冷却水 36.8℃ > 35℃" }],
        elapsedSeconds: 22,
        pressureBar: 138,
        operator: "李潜",
      },
    ],
  }),
  // 充填到位待签收
  baseTask({
    id: "T-1005",
    tankNo: "TANK-210",
    pumpId: "P-01",
    volume: "12L铝瓶",
    residualPressure: 48,
    currentPressure: 200,
    targetPressure: 200,
    targetO2: 21,
    fillMode: "空气",
    operator: "王潮",
    createdAt: isoAt(7, 58),
    status: "awaiting_signoff",
    segments: [{ operator: "王潮", seconds: 38, kind: "首充" }],
  }),
  // 上次签收氧浓度越限转返工
  baseTask({
    id: "T-1006",
    tankNo: "TANK-188",
    pumpId: "P-01",
    volume: "15L钢瓶",
    residualPressure: 30,
    currentPressure: 200,
    targetPressure: 200,
    targetO2: 32,
    fillMode: "高氧",
    operator: "赵宁",
    createdAt: isoAt(7, 30),
    status: "rework",
    segments: [{ operator: "赵宁", seconds: 42, kind: "首充" }],
    signoff: {
      at: isoAt(8, 26),
      receiver: "周检",
      measuredPressure: 199,
      measuredO2: 35.4,
      passed: false,
      failures: [
        { code: "O2_OUT", detail: "实测氧 35.4%，目标 32±1%" },
      ],
    },
  }),
];

export const seedState: ConsoleState = {
  pumps,
  tasks,
  seq: 1006,
  history: [
    {
      id: "H-9001",
      at: isoAt(7, 30),
      kind: "CREATED",
      pumpId: "P-01",
      taskId: "T-1006",
      tankNo: "TANK-188",
      message: "TANK-188 高氧任务创建，绑定 P-01",
    },
    {
      id: "H-9002",
      at: isoAt(8, 26),
      kind: "SIGNOFF_FAIL",
      pumpId: "P-01",
      taskId: "T-1006",
      tankNo: "TANK-188",
      message: "签收核实氧浓度 35.4% 越限，转返工",
    },
    {
      id: "H-9003",
      at: isoAt(8, 52),
      kind: "GATE_BLOCKED",
      pumpId: "P-02",
      taskId: "T-1002",
      tankNo: "TANK-231",
      message: "P-02 冷却水 36.8℃ 越线，TANK-231 进设备待检",
    },
    {
      id: "H-9004",
      at: isoAt(8, 55),
      kind: "GATE_BLOCKED",
      pumpId: "P-03",
      taskId: "T-1003",
      tankNo: "TANK-227",
      message: "P-03 流量 4.8L/min 且滤芯超期，TANK-227 进设备待检",
    },
    {
      id: "H-9005",
      at: isoAt(9, 4),
      kind: "GATE_PAUSE",
      pumpId: "P-02",
      taskId: "T-1004",
      tankNo: "TANK-219",
      message:
        "TANK-219 充填中温度越线暂停：已用 22秒，当前 138bar，待他人复核",
    },
  ],
};
