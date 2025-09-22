"use client";

import * as React from "react";
import { useUser } from "@/context/UserContext";
import { cn } from "@/lib/utils";

export function SidebarQuota() {
  const { user } = useUser();

  const tier = (user.subscription.tier ?? "free").toUpperCase();
  const quota = Math.max(0, user.subscription.monthlyImageQuota ?? 0);
  const used = Math.max(0, user.subscription.usedThisMonth ?? 0);
  const total = Math.max(quota || used || 1, 1);
  const pct = Math.min(100, Math.round((used / total) * 100));
  const remaining = Math.max(0, total - used);

  const tone =
    pct < 70 ? "ok" :
    pct < 90 ? "warn" : "danger";

  return (
    <div className="w-full select-none">
      {/* Header row */}
      <div className="mb-2 flex items-center justify-between text-[11px]">
        <span className="uppercase tracking-wide text-muted-foreground">Monthly images</span>
        <span className="tabular-nums text-foreground/80">{used}/{total}</span>
      </div>

      {/* Capsule */}
      <div
        role="progressbar"
        aria-valuemin={0}
        aria-valuemax={total}
        aria-valuenow={used}
        aria-valuetext={`${used} of ${total}`}
        title={`${used}/${total} used • ${remaining} left • ${tier}`}
        className={cn(
          "relative h-8 w-full overflow-hidden rounded-full",
          // outer border + subtle glass (works in light & dark)
          "border bg-card/60 backdrop-blur",
          "border-border shadow-[inset_0_0_0_1px_rgba(255,255,255,0.06)]",
          // faint inner stroke for depth
          "before:pointer-events-none before:absolute before:inset-0 before:rounded-full",
          "before:shadow-[inset_0_0_0_1px_rgba(0,0,0,0.06)]",
        )}
      >
        {/* Track gradient (theme-aware) */}
        <div className="absolute inset-0 rounded-full bg-[linear-gradient(180deg,theme(colors.muted.DEFAULT)_0%,transparent_100%)]" />

        {/* Fill */}
        <div
          className={cn(
            "relative h-full rounded-full transition-[width] duration-300",
            tone === "ok" && "bg-primary/80",
            tone === "warn" && "bg-amber-500/80",
            tone === "danger" && "bg-destructive/80"
          )}
          style={{ width: `${pct}%` }}
        >
          {/* Animated sheen on fill */}
          <div
            className={cn(
              "pointer-events-none absolute inset-0 opacity-40",
              "[mask-image:linear-gradient(to_right,transparent,black_25%,black_75%,transparent)]"
            )}
            style={{
              background:
                "linear-gradient(90deg, transparent 0%, rgba(255,255,255,0.6) 50%, transparent 100%)",
              animation: "sq-sheen 2.6s linear infinite",
            }}
          />
        </div>

        {/* Content overlay: tier + remaining */}
        <div className="pointer-events-none absolute inset-0 flex items-center justify-between px-2">
          <span className="rounded-md border px-1.5 py-[2px] text-[10px] uppercase tracking-wide"
                style={{ borderColor: "hsl(var(--border))", background: "color-mix(in oklab, var(--background) 80%, white 10%)" }}>
            {tier}
          </span>
          <span className="rounded-md border px-1.5 py-[2px] text-[11px] tabular-nums"
                style={{ borderColor: "hsl(var(--border))", background: "color-mix(in oklab, var(--background) 80%, white 10%)" }}>
            {remaining} left
          </span>
        </div>
      </div>

      {/* Keyframes scoped to this component */}
      <style jsx>{`
        @keyframes sq-sheen {
          0%   { transform: translateX(-100%); }
          100% { transform: translateX(100%);  }
        }
      `}</style>
    </div>
  );
}
