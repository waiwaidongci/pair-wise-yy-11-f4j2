// 充填泵冷却水联动台 —— 领域类型

export type FillMode = "air" | "nitrox" | "trimix" | "oxygen";

export type TaskStatus =
  | "ready" // 预检合格，等待占用充填位
  | "inspection" // 设备待检（泵冷却水越线）
  | "filling" // 充填中（占用充填位）
  | "paused" // 越线暂停，处理中
  | "filled" // 充填完成，待签收
  | "signed" // 已签收
  | "rework"; // 签收核验不合格，返工

export type Violation = "temp" | "flow" | "filter";

export interface Pump {
  id: string; // 泵编号，如 P-01
  name: string;
  waterTempC: number; // 冷却水温度 ℃
  flowLmin: number; // 冷却水流量 L/min
  filterChangedAt: string; // 滤芯更换日 yyyy-mm-dd
  filterServiceDays: number; // 滤芯额定使用天数
  statusNote?: string;
}

/** 任务建档时对泵数据的快照，保证履历不随后续改泵而变 */
export interface PumpSnapshot {
  pumpId: string;
  waterTempC: number;
  flowLmin: number;
  filterChangedAt: string;
  filterServiceDays: number;
}

/** 一段连续充填时长，暂停/复核续充各成一段，单独累加 */
export interface FillSegment {
  startedAt: number;
  endedAt: number | null; // null = 当前进行段
  operator: string;
  reviewer?: string; // 续充复核人（须不同于操作员）
  startPressure: number;
  pausePressure?: number; // 暂停时当前压力
  minutes: number | null; // 已结算时长（分钟），进行段为 null
  reason?: Violation; // 本段因何种越线结束
}

export interface SignoffCheck {
  measuredPressure: number; // 签收前实测压力 bar
  measuredO2: number; // 签收前实测氧浓度 %
  checker: string;
  checkedAt: number;
  pass: boolean;
  failures: string[];
}

export interface FillTask {
  id: string;
  code: string; // 气瓶编号
  volumeL: number; // 容积 L
  inspectionDue: string; // 气瓶检验有效期 yyyy-mm-dd
  startPressure: number; // 残压 bar
  targetPressure: number; // 目标压力 bar
  o2: number; // 氧含量 %
  he: number; // 氦含量 %
  mode: FillMode;
  operator: string;
  note?: string;
  pumpId: string; // 绑定泵编号
  precheck: PumpSnapshot & {
    ok: boolean;
    violations: Violation[];
    checkedAt: number;
  };
  status: TaskStatus;
  segments: FillSegment[];
  signoff?: SignoffCheck;
  reworkCount: number;
  createdAt: number;
  updatedAt: number;
}

export type EventType =
  | "created"
  | "blocked"
  | "recheck"
  | "occupied"
  | "paused"
  | "resumed"
  | "filled"
  | "signed"
  | "rework"
  | "pumpEdited";

export interface EquipmentEvent {
  id: string;
  at: number;
  pumpId: string;
  taskId?: string;
  type: EventType;
  detail: string;
  operator: string;
}

export interface ConsoleState {
  pumps: Pump[];
  tasks: FillTask[];
  events: EquipmentEvent[];
}

/** 新任务表单草稿 */
export type TaskDraft = Omit<
  FillTask,
  "id" | "precheck" | "status" | "segments" | "signoff" | "reworkCount" | "createdAt" | "updatedAt"
>;
