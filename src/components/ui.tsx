import type { ReactNode } from "react";

const toneClass: Record<string, string> = {
  ok: "badge-ok",
  warn: "badge-warn",
  bad: "badge-bad",
  info: "badge-info",
  mute: "badge-mute",
};

export function Badge({
  tone = "info",
  children,
}: {
  tone?: keyof typeof toneClass;
  children: ReactNode;
}) {
  return <span className={`badge ${toneClass[tone]}`}>{children}</span>;
}

export function Panel({
  title,
  subtitle,
  extra,
  children,
  className = "",
}: {
  title: string;
  subtitle?: string;
  extra?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`panel ${className}`}>
      <div className="heading">
        <div>
          {subtitle ? <p>{subtitle}</p> : null}
          <h2>{title}</h2>
        </div>
        {extra}
      </div>
      {children}
    </section>
  );
}

export function Empty({ text }: { text: string }) {
  return <p className="empty">{text}</p>;
}
