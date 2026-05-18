import Link from "next/link";

import { resetPasswordWithToken } from "@/app/actions/team";
import { CollieLogo } from "@/components/app/collie-logo";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default async function ResetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string }>;
}) {
  const { token = "" } = await searchParams;

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md space-y-6">
        <CollieLogo href="/" />
        <Card>
          <CardHeader>
            <CardTitle>Reset password</CardTitle>
            <CardDescription>Choose a new password for your Collie account.</CardDescription>
          </CardHeader>
          <CardContent>
            {token ? (
              <form action={resetPasswordWithToken} className="space-y-4">
                <input type="hidden" name="token" value={token} />
                <div className="space-y-2">
                  <Label htmlFor="password">New password</Label>
                  <Input id="password" name="password" type="password" autoComplete="new-password" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="confirm">Confirm password</Label>
                  <Input id="confirm" name="confirm" type="password" autoComplete="new-password" required />
                </div>
                <Button className="w-full" type="submit">Save password</Button>
              </form>
            ) : (
              <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-4 text-sm text-muted-foreground">
                This reset link is missing a token. Ask an organisation owner or admin to issue a new password reset.
              </div>
            )}
            <p className="mt-4 text-center text-sm text-muted-foreground">
              Remember your password?{" "}
              <Link className="font-medium text-primary underline-offset-4 hover:underline" href="/signin">
                Sign in
              </Link>
            </p>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
