"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createOrganisation } from "@/app/actions/organisations";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

const schema = z.object({
  name: z.string().min(2, "Enter your organisation name").max(120, "Use 120 characters or fewer"),
});

type FormValues = z.infer<typeof schema>;

export function OnboardingForm() {
  const router = useRouter();
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    setValue,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({ resolver: zodResolver(schema) });

  useEffect(() => {
    const raw = sessionStorage.getItem("collie:onboarding");
    if (!raw) return;

    try {
      const saved = JSON.parse(raw) as Partial<FormValues>;
      if (saved.name) setValue("name", saved.name);
    } catch {
      sessionStorage.removeItem("collie:onboarding");
    }
  }, [setValue]);

  async function onSubmit(values: FormValues) {
    setServerError(null);

    try {
      const organisation = await createOrganisation({ name: values.name });
      sessionStorage.removeItem("collie:onboarding");
      router.push(`/${organisation.slug}/dashboard`);
      router.refresh();
    } catch (error) {
      setServerError((error as Error).message);
    }
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="name">Organisation name</Label>
        <Input id="name" autoComplete="organization" {...register("name")} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>
      {serverError ? (
        <p className="text-sm text-destructive" aria-live="polite">
          {serverError}
        </p>
      ) : null}
      <Button type="submit" disabled={isSubmitting} className="w-full">
        {isSubmitting ? "Creating..." : "Create workspace"}
      </Button>
    </form>
  );
}
