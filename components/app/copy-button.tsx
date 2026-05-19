"use client";

import { Check, Copy } from "lucide-react";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

type CopyButtonProps = {
  value: string;
  label?: string;
  size?: "xs" | "sm" | "default";
  className?: string;
};

/**
 * Small clipboard helper for the deliverability allowlist guide.
 *
 * Server components render the value verbatim; this tiny client island
 * just handles the copy interaction so the rest of the page stays static.
 */
export function CopyButton({ value, label = "Copy", size = "sm", className }: CopyButtonProps) {
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!copied) return;
    const timer = setTimeout(() => setCopied(false), 2000);
    return () => clearTimeout(timer);
  }, [copied]);

  const handleClick = async () => {
    try {
      if (typeof navigator !== "undefined" && navigator.clipboard) {
        await navigator.clipboard.writeText(value);
        setCopied(true);
        return;
      }
    } catch {
      // Fall through to the textarea fallback.
    }

    // Fallback for browsers without async clipboard access (rare in admin
    // contexts, but harmless to keep so we never leave the admin stranded).
    if (typeof document !== "undefined") {
      const textarea = document.createElement("textarea");
      textarea.value = value;
      textarea.setAttribute("readonly", "");
      textarea.style.position = "absolute";
      textarea.style.left = "-9999px";
      document.body.appendChild(textarea);
      textarea.select();
      try {
        document.execCommand("copy");
        setCopied(true);
      } catch {
        // No-op: surface nothing rather than a confusing error toast.
      } finally {
        document.body.removeChild(textarea);
      }
    }
  };

  return (
    <Button
      type="button"
      variant="outline"
      size={size}
      onClick={handleClick}
      aria-label={copied ? "Copied" : label}
      className={cn("gap-1.5", className)}
    >
      {copied ? <Check className="size-3.5" aria-hidden="true" /> : <Copy className="size-3.5" aria-hidden="true" />}
      <span>{copied ? "Copied" : label}</span>
    </Button>
  );
}
