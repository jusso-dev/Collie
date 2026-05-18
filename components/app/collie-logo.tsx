import Link from "next/link";

import { cn } from "@/lib/utils";

export function CollieLogo({
  href = "/signup",
  className,
  variant = "light",
}: {
  href?: string;
  className?: string;
  variant?: "light" | "dark";
}) {
  return (
    <Link href={href} className={cn("flex items-center gap-3", className)} aria-label="Collie home">
      <span
        className={cn(
          "grid size-10 place-items-center rounded-lg border shadow-sm",
          variant === "dark"
            ? "border-sidebar-border bg-[var(--collie-white)] text-[var(--collie-navy)]"
            : "border-[rgb(13_27_42_/_0.14)] bg-[var(--collie-white)] text-[var(--collie-navy)]",
        )}
      >
        <svg viewBox="0 0 40 40" className="size-7" aria-hidden="true">
          <path
            d="M29.6 27.8a10.8 10.8 0 1 1-.1-15.7"
            fill="none"
            stroke="currentColor"
            strokeLinecap="round"
            strokeWidth="6.2"
          />
          <path d="M18.1 6.7 25.8 2.8l.5 8.3a12.7 12.7 0 0 0-8.2 3.8V6.7Z" fill="var(--collie-orange)" />
          <path d="M24.3 12.1a8.8 8.8 0 0 1 4.4 2.1l-3.8 4.1-2.5-5.4c.6-.4 1.2-.6 1.9-.8Z" fill="var(--collie-water)" />
        </svg>
      </span>
      <span className="leading-tight">
        <span className={cn("block text-lg font-semibold tracking-normal", variant === "dark" && "text-sidebar-foreground")}>
          Collie
        </span>
        <span className={cn("block text-xs", variant === "dark" ? "text-sidebar-foreground/62" : "text-muted-foreground")}>
          Safer habits
        </span>
      </span>
    </Link>
  );
}
