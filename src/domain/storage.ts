// 任务落盘层：泵、任务、设备履历统一持久化到 localStorage
import { evaluatePump, snapshotPump } from "./rules";
import type { ConsoleState, EquipmentEvent, FillTask, Pump } from "./types";

const STORAGE_KEY = "fill-console-state-v2";

export function pad(n: number): string {
  return String(n).padStart(2, "0");
}

export function localDateString(d = new Date()): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function shiftDateString(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  return localDateString(d);
}

export function newId(prefix: string): string {
  return `${prefix}-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

function event(at: number, pumpId: string, type: EquipmentEvent["type"], detail: string, operator: string, taskId?: string): EquipmentEvent {
  return { id: newId("evt"), at, pumpId, taskId, type, detail, operator };
}

function seedState(): ConsoleState {
  const now = Date.now();
  const pumps: Pump[] = [
    {
      id: "P-01",
      name: "1号充填泵",
      waterTempC: 28.5,
      flowLmin: 9.2,
      filterChangedAt: shiftDateString(-30),
      filterServiceDays: 60,
      statusNote: "",
    },
    {
      id: "P-02",
      name: "2号充填泵",
      waterTempC: 37.2, // 温度越线
      flowLmin: 8.5,
      filterChangedAt: shiftDateString(-80), // 滤芯也超期
      filterServiceDays: 60,
      statusNote: "",
    },
    {
      id: "P-03",
      name: "3号充填泵",
      waterTempC: 26.8,
      flowLmin: 4.6, // 流量不足
      filterChangedAt: shiftDateString(-10),
      filterServiceDays: 90,
      statusNote: "",
    },
  ];

  const makeTask = (partial: Partial<FillTask> & Pick<FillTask, "id" | "code" | "pumpId">): FillTask => {
    const pump = pumps.find((p) => p.id === partial.pumpId)!;
    const evalResult = evaluatePump(pump, now);
    const base: FillTask = {
      id: partial.id,
      code: partial.code,
      volumeL: partial.volumeL ?? 12,
      inspectionDue: partial.inspectionDue ?? shiftDateString(180),
      startPressure: partial.startPressure ?? 40,
      targetPressure: partial.targetPressure ?? 200,
      o2: partial.o2 ?? 21,
      he: partial.he ?? 0,
      mode: partial.mode ?? "air",
      operator: partial.operator ?? "张磊",
      note: partial.note,
      pumpId: pump.id,
      precheck: {
        ...snapshotPump(pump),
        ok: evalResult.ok,
        violations: evalResult.violations,
        checkedAt: now,
      },
      status: partial.status ?? (evalResult.ok ? "ready" : "inspection"),
      segments: partial.segments ?? [],
      signoff: partial.signoff,
      reworkCount: partial.reworkCount ?? 0,
      createdAt: now,
      updatedAt: now,
    };
    return base;
  };

  const t1 = makeTask({ id: "T-1001", code: "TANK-204", pumpId: "P-01", status: "ready", operator: "张磊", note: "12L 铝瓶" });
  const t2 = makeTask({ id: "T-1002", code: "TANK-219", pumpId: "P-02", mode: "nitrox", o2: 32, he: 0, operator: "李娜", volumeL: 11, note: "EAN32" });
  const t3 = makeTask({ id: "T-1003", code: "TANK-231", pumpId: "P-03", operator: "王强", note: "双瓶组" });

  // 一个充填中的任务，占着 P-01
  const fillingPump = pumps[0];
  const t4: FillTask = {
    ...makeTask({ id: "T-1004", code: "TANK-207", pumpId: "P-01", status: "filling", operator: "张磊", targetPressure: 232, startPressure: 55, note: "11.1L 钢瓶" }),
    segments: [
      {
        startedAt: now - 14 * 60000,
        endedAt: null,
        operator: "张磊",
        startPressure: 55,
        minutes: null,
      },
    ],
  };
  void fillingPump;

  const events: EquipmentEvent[] = [
    event(now - 3600_000, "P-01", "pumpEdited", "1号充填泵参数录入：水温28.5℃ / 流量9.2L/min / 滤芯剩余30天", "张磊"),
    event(now - 3000_000, "P-02", "blocked", "2号充填泵预检不合格：水温37.2℃、滤芯超期20天，任务转设备待检", "李娜", t2.id),
    event(now - 2400_000, "P-03", "blocked", "3号充填泵预检不合格：流量4.6L/min（<6L/min），任务转设备待检", "王强", t3.id),
    event(now - 900_000, "P-01", "occupied", `TANK-207 上充填位开始充填，残压55bar，目标232bar`, "张磊", t4.id),
  ];

  return { pumps, tasks: [t4, t1, t2, t3], events };
}

export function loadState(): ConsoleState {
  if (typeof localStorage === "undefined") return seedState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      const seeded = seedState();
      localStorage.setItem(STORAGE_KEY, JSON.stringify(seeded));
      return seeded;
    }
    const parsed = JSON.parse(raw) as ConsoleState;
    if (!parsed.pumps || !parsed.tasks || !parsed.events) throw new Error("bad state");
    return parsed;
  } catch {
    return seedState();
  }
}

export function saveState(state: ConsoleState): void {
  if (typeof localStorage === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function resetState(): ConsoleState {
  const seeded = seedState();
  saveState(seeded);
  return seeded;
}
