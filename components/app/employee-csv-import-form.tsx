"use client";

import { ChangeEvent, useRef } from "react";

import { importEmployeesCsv } from "@/app/actions/employees";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

export function EmployeeCsvImportForm({ orgSlug }: { orgSlug: string }) {
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  async function handleFileChange(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file || !textareaRef.current) return;

    textareaRef.current.value = await file.text();
  }

  return (
    <form action={importEmployeesCsv} className="space-y-3">
      <input type="hidden" name="orgSlug" value={orgSlug} />
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <input
          type="file"
          accept=".csv,text/csv"
          onChange={handleFileChange}
          className="text-sm text-muted-foreground file:mr-3 file:rounded-lg file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:font-medium file:text-foreground"
        />
      </div>
      <Textarea
        ref={textareaRef}
        name="csv"
        rows={7}
        aria-label="CSV employee import"
        defaultValue={"email,first_name,last_name,department,manager_email\n"}
      />
      <Button type="submit" variant="outline">
        Import CSV
      </Button>
    </form>
  );
}
