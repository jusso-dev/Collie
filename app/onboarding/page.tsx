import { redirect } from "next/navigation";

import { CollieLogo } from "@/components/app/collie-logo";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getPostAuthRedirect } from "@/lib/auth/redirect";
import { getSession } from "@/lib/auth/session";
import { OnboardingForm } from "./OnboardingForm";

export const metadata = { title: "Create workspace · Collie" };

export default async function OnboardingPage() {
  const session = await getSession();
  if (!session) redirect("/signin");

  const organisationId =
    "organisationId" in session.user ? (session.user.organisationId as string | null) : null;

  if (organisationId) {
    redirect(await getPostAuthRedirect(organisationId));
  }

  return (
    <main className="grid min-h-screen place-items-center bg-background px-4 py-10 text-foreground">
      <div className="w-full max-w-md space-y-6">
        <CollieLogo href="/" />
        <Card>
          <CardHeader>
            <CardTitle>Create your workspace</CardTitle>
            <CardDescription>
              Add the organisation you will use for employees, campaigns, and training results.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <OnboardingForm />
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
