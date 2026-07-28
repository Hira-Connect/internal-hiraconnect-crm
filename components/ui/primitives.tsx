import type { ComponentPropsWithoutRef, ReactNode } from "react";
import Link from "next/link";
import { cn, hashHue, initials } from "@/lib/format";

/* -------------------------------------------------------------------- card */

export function Panel({
  title,
  subtitle,
  action,
  children,
  className,
  bodyClassName,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={cn("surface rounded-xl border shadow-sm", className)}>
      {(title || action) && (
        <header className="flex flex-wrap items-center gap-3 border-b border-app px-4 py-3">
          <div className="min-w-0">
            {title && <h3 className="truncate text-[15px] leading-tight">{title}</h3>}
            {subtitle && <p className="mt-0.5 text-xs text-muted">{subtitle}</p>}
          </div>
          {action && <div className="ml-auto flex items-center gap-2">{action}</div>}
        </header>
      )}
      <div className={cn("p-4", bodyClassName)}>{children}</div>
    </section>
  );
}

/* ------------------------------------------------------------------ button */

type ButtonVariant = "primary" | "secondary" | "ghost" | "gold" | "danger";
type ButtonSize = "sm" | "md";

const BUTTON_VARIANTS: Record<ButtonVariant, string> = {
  primary: "bg-brand-500 text-white hover:bg-brand-600 border-transparent",
  secondary: "surface border hover:surface-alt",
  ghost: "border-transparent hover:surface-alt",
  gold: "bg-gold-500 text-white hover:bg-gold-600 border-transparent",
  danger: "bg-red-600 text-white hover:bg-red-700 border-transparent",
};

const BUTTON_SIZES: Record<ButtonSize, string> = {
  sm: "px-2.5 py-1 text-xs rounded-md gap-1",
  md: "px-3.5 py-2 text-sm rounded-lg gap-1.5",
};

export function buttonClass(variant: ButtonVariant = "primary", size: ButtonSize = "md", extra?: string) {
  return cn(
    "inline-flex items-center justify-center border font-medium transition-colors disabled:cursor-not-allowed disabled:opacity-50",
    BUTTON_VARIANTS[variant],
    BUTTON_SIZES[size],
    extra,
  );
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  ...props
}: ComponentPropsWithoutRef<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button {...props} className={buttonClass(variant, size, className)} />;
}

export function LinkButton({
  href,
  variant = "secondary",
  size = "md",
  className,
  children,
}: {
  href: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link href={href} className={buttonClass(variant, size, className)}>
      {children}
    </Link>
  );
}

/* ------------------------------------------------------------------- badge */

export function Badge({
  children,
  tone = "neutral",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "brand" | "success" | "warning" | "danger" | "gold";
  className?: string;
}) {
  const tones = {
    neutral:
      "bg-navy-100 text-navy-700 ring-navy-500/15 dark:bg-navy-700/50 dark:text-navy-200 dark:ring-navy-300/20",
    brand: "bg-brand-100 text-brand-700 ring-brand-500/20 dark:bg-brand-500/15 dark:text-brand-100 dark:ring-brand-400/30",
    success:
      "bg-emerald-100 text-emerald-800 ring-emerald-600/20 dark:bg-emerald-500/15 dark:text-emerald-300 dark:ring-emerald-400/30",
    warning:
      "bg-amber-100 text-amber-800 ring-amber-600/20 dark:bg-amber-500/15 dark:text-amber-300 dark:ring-amber-400/30",
    danger: "bg-red-100 text-red-700 ring-red-600/20 dark:bg-red-500/15 dark:text-red-300 dark:ring-red-400/30",
    gold: "bg-gold-100 text-gold-600 ring-gold-500/25 dark:bg-gold-500/15 dark:text-gold-300 dark:ring-gold-300/30",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2 py-0.5 text-[11px] font-semibold whitespace-nowrap ring-1 ring-inset",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

/* --------------------------------------------------------------- stat card */

export function StatCard({
  label,
  value,
  hint,
  tone,
  href,
}: {
  label: string;
  value: ReactNode;
  hint?: ReactNode;
  tone?: "default" | "danger" | "warning" | "success";
  href?: string;
}) {
  const toneClass = {
    default: "",
    danger: "text-red-600 dark:text-red-400",
    warning: "text-gold-600 dark:text-gold-300",
    success: "text-emerald-600 dark:text-emerald-400",
  }[tone ?? "default"];

  const body = (
    <>
      <div className={cn("font-display text-2xl font-bold tabular-nums", toneClass)}>{value}</div>
      <div className="mt-0.5 text-xs text-muted">{label}</div>
      {hint && <div className="mt-1 text-[11px] text-muted">{hint}</div>}
    </>
  );

  if (href) {
    return (
      <Link href={href} className="surface rounded-xl border p-4 shadow-sm transition-colors hover:surface-alt">
        {body}
      </Link>
    );
  }
  return <div className="surface rounded-xl border p-4 shadow-sm">{body}</div>;
}

/* ------------------------------------------------------------------- meter */

export function Meter({
  value,
  max = 100,
  tone = "brand",
  className,
}: {
  value: number;
  max?: number;
  tone?: "brand" | "success" | "warning" | "danger" | "gold";
  className?: string;
}) {
  const pct = max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0;
  const tones = {
    brand: "bg-brand-500",
    success: "bg-emerald-500",
    warning: "bg-amber-500",
    danger: "bg-red-500",
    gold: "bg-gold-500",
  };
  return (
    <div
      className={cn("h-2 w-full overflow-hidden rounded-full bg-navy-100 dark:bg-navy-800", className)}
      role="progressbar"
      aria-valuenow={Math.round(pct)}
      aria-valuemin={0}
      aria-valuemax={100}
    >
      <div className={cn("h-full rounded-full transition-[width]", tones[tone])} style={{ width: `${pct}%` }} />
    </div>
  );
}

/* ------------------------------------------------------------------ avatar */

export function Avatar({ name, size = 28 }: { name: string | null | undefined; size?: number }) {
  const hue = hashHue(name ?? "?");
  return (
    <span
      className="inline-flex shrink-0 items-center justify-center rounded-full font-semibold text-white"
      style={{
        width: size,
        height: size,
        fontSize: size * 0.4,
        background: `hsl(${hue} 45% 45%)`,
      }}
      title={name ?? "Unassigned"}
    >
      {initials(name)}
    </span>
  );
}

/* -------------------------------------------------------------- empty state */

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-app px-6 py-10 text-center">
      <p className="font-medium">{title}</p>
      {hint && <p className="max-w-md text-xs text-muted">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

/* ------------------------------------------------------------------ fields */

const CONTROL =
  "w-full rounded-lg border border-app bg-[var(--panel)] px-3 py-2 text-sm shadow-sm transition-colors focus:border-brand-500";

export function Field({
  label,
  hint,
  children,
  className,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <label className={cn("block", className)}>
      <span className="mb-1 block text-[11px] font-semibold tracking-wide text-muted uppercase">{label}</span>
      {children}
      {hint && <span className="mt-1 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

export function Input({ className, ...props }: ComponentPropsWithoutRef<"input">) {
  return <input {...props} className={cn(CONTROL, className)} />;
}

export function Textarea({ className, ...props }: ComponentPropsWithoutRef<"textarea">) {
  return <textarea {...props} className={cn(CONTROL, "min-h-[72px] resize-y", className)} />;
}

export function Select({ className, children, ...props }: ComponentPropsWithoutRef<"select">) {
  return (
    <select {...props} className={cn(CONTROL, "appearance-none pr-8", className)}>
      {children}
    </select>
  );
}

/* --------------------------------------------------------------- key/value */

export function KeyValue({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex gap-3 py-1 text-sm">
      <span className="w-28 shrink-0 text-xs font-semibold text-muted uppercase">{label}</span>
      <span className="min-w-0 flex-1 break-words">{children}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ banner */

export function Banner({
  tone = "info",
  title,
  children,
}: {
  tone?: "info" | "warning" | "danger";
  title: string;
  children?: ReactNode;
}) {
  const tones = {
    info: "border-brand-500/30 bg-brand-50 text-brand-700 dark:bg-brand-500/10 dark:text-brand-100",
    warning: "border-amber-500/30 bg-amber-50 text-amber-800 dark:bg-amber-500/10 dark:text-amber-200",
    danger: "border-red-500/30 bg-red-50 text-red-700 dark:bg-red-500/10 dark:text-red-200",
  };
  return (
    <div className={cn("rounded-lg border px-4 py-3 text-sm", tones[tone])}>
      <p className="font-semibold">{title}</p>
      {children && <div className="mt-1 text-xs opacity-90">{children}</div>}
    </div>
  );
}
