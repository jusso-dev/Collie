"use client";

import { useEffect, useMemo, useState } from "react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";

type ToastKind = "success" | "info";
const flashParamKeys = ["toast", "deleted", "enqueued", "sent", "scheduled", "created"] as const;

const toastMessages: Record<string, { kind: ToastKind; message: string }> = {
  "campaign-created": { kind: "info", message: "Campaign draft created." },
  "campaign-deleted": { kind: "info", message: "Campaign deleted." },
  "campaign-status": { kind: "success", message: "Campaign status updated." },
  "target-event": { kind: "success", message: "Recipient event recorded." },
  "deepfake-asset": { kind: "success", message: "Deepfake asset registered." },
  "deepfake-approval": { kind: "success", message: "Deepfake approval recorded." },
  "employee-saved": { kind: "success", message: "Employee saved." },
  "employees-imported": { kind: "success", message: "Employees imported." },
  "employee-status": { kind: "success", message: "Employee status updated." },
  "employee-exclusion": { kind: "success", message: "Employee exclusion updated." },
  "group-saved": { kind: "success", message: "Group saved." },
  "group-deleted": { kind: "info", message: "Group deleted." },
  "exclusion-saved": { kind: "success", message: "Exclusion rule saved." },
  "exclusion-status": { kind: "success", message: "Exclusion rule status updated." },
  "exclusion-deleted": { kind: "info", message: "Exclusion rule deleted." },
  "template-saved": { kind: "success", message: "Template saved." },
  "template-deleted": { kind: "info", message: "Template deleted." },
  "landing-page-saved": { kind: "success", message: "Landing page saved." },
  "landing-page-deleted": { kind: "info", message: "Landing page deleted." },
  "training-saved": { kind: "success", message: "Training module saved." },
  "training-imported": { kind: "success", message: "SCORM package imported." },
  "training-deleted": { kind: "info", message: "Training module deleted." },
  "settings-sending": { kind: "success", message: "Sending settings saved." },
  "settings-lrs": { kind: "success", message: "Training integration saved." },
  "settings-retention": { kind: "success", message: "Retention settings saved." },
  "team-invited": { kind: "success", message: "Invitation created." },
  "team-invite-cancelled": { kind: "info", message: "Invitation cancelled." },
  "team-role": { kind: "success", message: "User role updated." },
  "team-removed": { kind: "info", message: "User removed." },
  "team-mfa": { kind: "success", message: "MFA setting updated." },
  "team-password-reset": { kind: "success", message: "Password reset link created." },
  "team-password-reset-revoked": { kind: "info", message: "Password reset link revoked." },
  "sso-saved": { kind: "success", message: "SSO configuration saved." },
  "sso-enforcement": { kind: "success", message: "SSO enforcement updated." },
  "sso-deleted": { kind: "info", message: "SSO configuration removed." },
  "scim-token-rotated": { kind: "success", message: "SCIM token ready. Copy it now." },
  "scim-token-revoked": { kind: "info", message: "SCIM token revoked." },
  "api-key-minted": { kind: "success", message: "API key minted. Copy it now." },
  "api-key-rotated": { kind: "success", message: "API key rotated. Copy it now." },
  "api-key-revealed": { kind: "info", message: "API key revealed. Copy it now." },
  "api-key-revoked": { kind: "info", message: "API key revoked." },
  "api-key-dismissed": { kind: "info", message: "API key hidden." },
  "sync-test": { kind: "success", message: "Test sync recorded." },
  "siem-saved": { kind: "success", message: "SIEM/SOAR endpoint saved." },
  "siem-deleted": { kind: "info", message: "SIEM/SOAR endpoint deleted." },
  "siem-key-rotated": { kind: "success", message: "SIEM/SOAR signing key updated." },
};

export function FlashToast() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initialToast = useMemo<{ kind: ToastKind; message: string } | null>(() => {
    const namedToast = searchParams.get("toast");
    if (namedToast && toastMessages[namedToast]) {
      return toastMessages[namedToast];
    }

    const enqueued = searchParams.get("enqueued");
    if (enqueued) {
      const count = Number(enqueued);
      return {
        kind: "success",
        message:
          Number.isFinite(count) && count > 0
            ? `Campaign launch queued. Inngest will deliver ${count} email${count === 1 ? "" : "s"} with retries and idempotency.`
            : "Campaign launch queued. Inngest will deliver the emails.",
      };
    }

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
        message: toastMessages["campaign-created"].message,
      };
    }

    if (searchParams.get("deleted")) {
      return toastMessages["campaign-deleted"];
    }

    return null;
  }, [searchParams]);
  const [eventToast, setEventToast] = useState<{ kind: ToastKind; message: string } | null>(null);
  const hasFlashParams = flashParamKeys.some((key) => searchParams.has(key));
  const toast = eventToast ?? initialToast;

  useEffect(() => {
    function handleToast(event: Event) {
      const detail = (event as CustomEvent<{ toast?: string; message?: string; kind?: ToastKind }>).detail;
      if (detail?.toast && toastMessages[detail.toast]) {
        setEventToast(toastMessages[detail.toast]);
        return;
      }
      if (detail?.message) {
        setEventToast({ kind: detail.kind ?? "success", message: detail.message });
      }
    }

    window.addEventListener("collie:toast", handleToast);
    return () => window.removeEventListener("collie:toast", handleToast);
  }, []);

  useEffect(() => {
    if (!toast) return;

    const timer = window.setTimeout(() => {
      setEventToast(null);
      if (!hasFlashParams) return;

      const nextParams = new URLSearchParams(searchParams.toString());
      for (const key of flashParamKeys) {
        nextParams.delete(key);
      }
      const nextQuery = nextParams.toString();
      router.replace(nextQuery ? `${pathname}?${nextQuery}` : pathname, { scroll: false });
    }, 4200);
    return () => window.clearTimeout(timer);
  }, [hasFlashParams, pathname, router, searchParams, toast]);

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
