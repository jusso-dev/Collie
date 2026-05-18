"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ToastKind = "success" | "info";

export function FlashToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialToast = useMemo<{ kind: ToastKind; message: string } | null>(() => {
    const sent = searchParams.get("sent");
    if (sent) {
      const count = Number(sent);
      return {
        kind: "success",
        message: Number.isFinite(count) && count > 0 ? `Campaign sent to ${count} recipient${count === 1 ? "" : "s"}.` : "Campaign sent.",
      };
    }

    if (searchParams.get("scheduled")) {
      return {
        kind: "success",
        message: "Campaign scheduled. Inngest will send it at the window start.",
      };
    }

    if (searchParams.get("created")) {
      return {
        kind: "info",
        message: "Campaign draft created.",
      };
    }

    return null;
  }, [searchParams]);
  const [toast, setToast] = useState(initialToast);

  useEffect(() => {
    if (!toast) return;

    const nextParams = new URLSearchParams(searchParams.toString());
    nextParams.delete("sent");
    nextParams.delete("scheduled");
    nextParams.delete("created");
    const nextQuery = nextParams.toString();
    router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });

    const timer = window.setTimeout(() => setToast(null), 4200);
    return () => window.clearTimeout(timer);
  }, [pathname, router, searchParams, toast]);

  if (!toast) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed right-4 bottom-4 z-50 max-w-sm rounded-lg border border-border bg-card px-4 py-3 text-sm text-foreground shadow-[0_18px_50px_rgb(13_27_42_/_0.16)]"
    >
      <div className="flex items-start gap-3">
        <span
          className={toast.kind === "success" ? "mt-1 size-2 rounded-full bg-[var(--collie-green)]" : "mt-1 size-2 rounded-full bg-primary"}
          aria-hidden="true"
        />
        <span>{toast.message}</span>
      </div>
    </div>
  );
}
