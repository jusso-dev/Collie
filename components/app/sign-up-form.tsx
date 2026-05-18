"use client";

import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";

import { createOrganisation } from "@/app/actions/organisations";
import { acceptOrganisationInvitation } from "@/app/actions/team";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signUp } from "@/lib/auth/client";

const schema = z
  .object({
    name: z.string().min(2, "Enter your name"),
    email: z.string().email("Enter a valid email address"),
    organisationName: z.string().max(120, "Use 120 characters or fewer").optional(),
    password: z.string().min(10, "Use at least 10 characters"),
    confirm: z.string(),
  })
  .refine((data) => data.password === data.confirm, {
    path: ["confirm"],
    message: "Passwords do not match",
  });

type FormValues = z.infer<typeof schema>;
type Invite = {
  token: string;
  email: string;
  role: "owner" | "admin" | "viewer";
  organisationName: string;
};

export function SignUpForm({ invite }: { invite?: Invite | null }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get("next");
  const [serverError, setServerError] = useState<string | null>(null);
  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormValues>({
    resolver: zodResolver(schema),
    defaultValues: invite
      ? {
          email: invite.email,
          organisationName: invite.organisationName,
        }
      : undefined,
  });

  async function onSubmit(values: FormValues) {
    setServerError(null);
    const organisationName = values.organisationName?.trim() ?? "";

    if (!invite && organisationName.length < 2) {
      setServerError("Enter your organisation name");
      return;
    }

    const result = await signUp.email({
      name: values.name,
      email: values.email,
      password: values.password,
    });

    if (result.error) {
      setServerError(result.error.message ?? "Unable to create account");
      return;
    }

    try {
      const organisation = invite
        ? await acceptOrganisationInvitation({ token: invite.token })
        : await createOrganisation({ name: organisationName });
      sessionStorage.removeItem("collie:onboarding");
      router.push(next?.startsWith("/") ? next : `/${organisation.slug}/dashboard`);
    } catch (error) {
      sessionStorage.setItem("collie:onboarding", JSON.stringify({ name: organisationName }));
      setServerError((error as Error).message);
      return;
    }

    router.refresh();
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="name">Your name</Label>
        <Input id="name" autoComplete="name" {...register("name")} />
        {errors.name ? <p className="text-xs text-destructive">{errors.name.message}</p> : null}
      </div>
      {invite ? (
        <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3 text-sm">
          <div className="font-medium">{invite.organisationName}</div>
          <div className="mt-1 text-muted-foreground">Role: {invite.role}</div>
        </div>
      ) : (
        <div className="space-y-2">
          <Label htmlFor="organisationName">Organisation name</Label>
          <Input id="organisationName" autoComplete="organization" {...register("organisationName")} />
          {errors.organisationName ? (
            <p className="text-xs text-destructive">{errors.organisationName.message}</p>
          ) : null}
        </div>
      )}
      <div className="space-y-2">
        <Label htmlFor="email">Work email</Label>
        <Input id="email" type="email" autoComplete="email" readOnly={Boolean(invite)} {...register("email")} />
        {errors.email ? <p className="text-xs text-destructive">{errors.email.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">Password</Label>
        <Input id="password" type="password" autoComplete="new-password" {...register("password")} />
        {errors.password ? <p className="text-xs text-destructive">{errors.password.message}</p> : null}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirm">Confirm password</Label>
        <Input id="confirm" type="password" autoComplete="new-password" {...register("confirm")} />
        {errors.confirm ? <p className="text-xs text-destructive">{errors.confirm.message}</p> : null}
      </div>
      {serverError ? (
        <p className="text-sm text-destructive" aria-live="polite">
          {serverError}
        </p>
      ) : null}
      <Button className="w-full" type="submit" disabled={isSubmitting}>
        {isSubmitting ? "Creating account..." : "Create account"}
      </Button>
    </form>
  );
}
