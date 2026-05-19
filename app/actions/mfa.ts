"use server";

import { symmetricEncrypt } from "better-auth/crypto";
import { and, eq } from "drizzle-orm";
import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";

import { auth } from "@/lib/auth/auth";
import { requireSession } from "@/lib/auth/session";
import { buildOtpauthUrl, generateTotpSecret, openTotpSecret, sealTotpSecret, verifyTotpCode } from "@/lib/auth/totp";
import { db } from "@/lib/db/client";
import { twoFactors, users } from "@/lib/db/schema";

const verifySchema = z.object({
  code: z.string().regex(/^\s*\d{3}\s*\d{3}\s*$|^\d{6}$/, "Enter the 6-digit code from your authenticator."),
});

export type MfaEnrollment = {
  secret: string;
  otpauthUrl: string;
};

export async function beginMfaSetup(): Promise<MfaEnrollment> {
  const session = await requireSession();
  const secret = generateTotpSecret();
  const sealed = sealTotpSecret(secret);

  await db
    .update(users)
    .set({ totpSecretEncrypted: sealed, mfaEnabled: false, updatedAt: new Date() })
    .where(eq(users.id, session.user.id));

  return {
    secret,
    otpauthUrl: buildOtpauthUrl({ secret, accountName: session.user.email, issuer: "Collie" }),
  };
}

export async function confirmMfaSetup(formData: FormData): Promise<void> {
  const session = await requireSession();
  const parsed = verifySchema.safeParse({ code: typeof formData.get("code") === "string" ? (formData.get("code") as string) : "" });
  if (!parsed.success) {
    throw new Error(parsed.error.issues[0]?.message ?? "Enter a 6-digit code.");
  }

  const [user] = await db
    .select({ id: users.id, sealed: users.totpSecretEncrypted, organisationId: users.organisationId })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user?.sealed) {
    throw new Error("Start MFA setup before submitting a code.");
  }

  const secret = openTotpSecret(user.sealed);
  if (!verifyTotpCode(secret, parsed.data.code)) {
    throw new Error("That code did not match. Try the next one your authenticator shows.");
  }

  // Re-encrypt the verified secret with BetterAuth's envelope so the
  // twoFactor plugin can verify codes on subsequent sign-ins. This is the
  // single place a new enrolment becomes plugin-native; legacy users who
  // enrolled before this change are migrated lazily by the after-sign-in
  // hook in `lib/auth/auth.ts`.
  const ctx = await auth.$context;
  const encryptedSecret = await symmetricEncrypt({
    key: ctx.secretConfig,
    data: secret,
  });

  await db.transaction(async (tx) => {
    await tx.delete(twoFactors).where(eq(twoFactors.userId, user.id));
    await tx.insert(twoFactors).values({
      userId: user.id,
      secret: encryptedSecret,
      backupCodes: "",
      verified: true,
    });
    await tx
      .update(users)
      .set({
        mfaEnabled: true,
        twoFactorEnabled: true,
        totpSecretEncrypted: null,
        mfaResetAt: null,
        updatedAt: new Date(),
      })
      .where(eq(users.id, user.id));
  });

  if (user.organisationId) {
    revalidatePath("/");
  }
  redirect("/?mfa=enabled");
}

export async function disableMfaForSelf(): Promise<void> {
  const session = await requireSession();
  await db.transaction(async (tx) => {
    await tx
      .update(users)
      .set({
        mfaEnabled: false,
        twoFactorEnabled: false,
        totpSecretEncrypted: null,
        mfaResetAt: new Date(),
        updatedAt: new Date(),
      })
      .where(and(eq(users.id, session.user.id), eq(users.mfaRequired, false)));
    await tx.delete(twoFactors).where(eq(twoFactors.userId, session.user.id));
  });
  redirect("/?mfa=disabled");
}
