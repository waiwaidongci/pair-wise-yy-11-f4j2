import { useConsole } from "../state/ConsoleContext";
import { judgePump } from "../domain/types";

function Metric({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: number | string;
  sub: string;
  tone: "ok" | "warn" | "bad" | "info";
}) {
  return (
    <article className={`metric metric-${tone}`}>
      <small>{label}</small>
      <strong>{value}</strong>
      <em>{sub}</em>
    </article>
  );
}

export function Metrics() {
  const { state } = useConsole();
  const pending = state.tasks.filter((t) => t.status === "pending_check").length;
  const queued = state.tasks.filter((t) => t.status === "queued").length;
  const stations = state.tasks.filter(
    (t) => t.status === "filling" || t.status === "paused"
  ).length;
  const pumpsBlocked = state.pumps.filter((p) => !judgePump(p).ok).length;
  const signedToday = state.tasks.filter((t) => t.status === "signed").length;

  return (
    <section className="metrics">
      <Metric
        label="占用充填位"
        value={`${stations}/${state.pumps.length}`}
        sub="充填中 + 越线暂停"
        tone={stations > 0 ? "info" : "ok"}
      />
      <Metric
        label="待充填"
        value={queued}
        sub="泵合格，可上泵"
        tone="ok"
      />
      <Metric
        label="设备待检 / 泵待检"
        value={`${pending} / ${pumpsBlocked}`}
        sub="温度·流量·滤芯越线"
        tone={pending + pumpsBlocked > 0 ? "bad" : "ok"}
      />
      <Metric
        label="已签收"
        value={signedToday}
        sub="压力氧浓度复核通过"
        tone="ok"
      />
    </section>
  );
}
