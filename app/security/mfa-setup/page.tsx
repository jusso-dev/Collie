import { eq } from "drizzle-orm";
import { redirect } from "next/navigation";

import { beginMfaSetup, confirmMfaSetup } from "@/app/actions/mfa";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { users } from "@/lib/db/schema";

async function ensureEnrollment(): Promise<{ secret: string; otpauthUrl: string; mfaRequired: boolean }> {
  const session = await getSession();
  if (!session?.user) {
    redirect("/signin?next=/security/mfa-setup");
  }

  const [user] = await db
    .select({ id: users.id, mfaRequired: users.mfaRequired, mfaEnabled: users.mfaEnabled })
    .from(users)
    .where(eq(users.id, session.user.id))
    .limit(1);

  if (!user) {
    redirect("/signin?next=/security/mfa-setup");
  }

  if (user.mfaEnabled) {
    redirect("/?mfa=already-enabled");
  }

  const enrollment = await beginMfaSetup();
  return { ...enrollment, mfaRequired: user.mfaRequired };
}

export default async function MfaSetupPage() {
  const { secret, otpauthUrl, mfaRequired } = await ensureEnrollment();
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(otpauthUrl)}`;

  return (
    <div className="mx-auto flex min-h-screen max-w-xl items-center px-6 py-12">
      <Card className="w-full">
        <CardHeader className="space-y-2">
          <Badge variant={mfaRequired ? "default" : "outline"} className="w-fit">
            {mfaRequired ? "MFA required" : "MFA optional"}
          </Badge>
          <CardTitle>Set up multi-factor authentication</CardTitle>
          <p className="text-sm leading-6 text-muted-foreground">
            Add Collie to an authenticator app (1Password, Authy, Google Authenticator). Scan the QR or paste the secret, then
            enter the 6-digit code shown.
          </p>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4 sm:grid-cols-[200px_1fr] sm:items-start">
            <div className="rounded-lg border border-border bg-card p-2">
              {}
              <img src={qrUrl} alt="MFA enrolment QR code" width={200} height={200} />
            </div>
            <div className="space-y-3 text-sm">
              <div>
                <p className="font-medium">Manual entry secret</p>
                <p className="mt-1 break-all font-mono text-xs">{secret}</p>
              </div>
              <div>
                <p className="font-medium">otpauth URL</p>
                <p className="mt-1 break-all font-mono text-xs">{otpauthUrl}</p>
              </div>
            </div>
          </div>
          <form action={confirmMfaSetup} className="space-y-3">
            <div className="space-y-2">
              <Label htmlFor="code">6-digit code</Label>
              <Input id="code" name="code" inputMode="numeric" autoComplete="one-time-code" required pattern="[0-9 ]{6,7}" />
            </div>
            <Button type="submit">Verify and enable</Button>
            <p className="text-xs leading-5 text-muted-foreground">
              Codes refresh every 30 seconds. If verification fails, wait for the next code and try again.
            </p>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
