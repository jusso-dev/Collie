import { eq, or, sql } from "drizzle-orm";

import { deleteLandingPage, saveLandingPage } from "@/app/actions/landing-pages";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { landingPages, trainingModules } from "@/lib/db/schema";

const pageTypes = [
  "friendly_simulation",
  "training_redirect",
  "credential_harvest",
  "attachment_warning",
  "mfa_push_simulator",
  "oauth_consent",
  "usb_drop",
  "voice_callback",
  "deepfake_disclosure",
] as const;

export default async function LandingPagesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const pages = await db
    .select({
      id: landingPages.id,
      organisationId: landingPages.organisationId,
      name: landingPages.name,
      type: landingPages.type,
      html: landingPages.html,
      linkedTrainingModuleId: landingPages.linkedTrainingModuleId,
      trainingTitle: trainingModules.title,
    })
    .from(landingPages)
    .leftJoin(trainingModules, eq(trainingModules.id, landingPages.linkedTrainingModuleId))
    .where(or(eq(landingPages.organisationId, organisation.id), sql`${landingPages.organisationId} is null`))
    .orderBy(landingPages.name);
  const modules = await db
    .select({ id: trainingModules.id, title: trainingModules.title })
    .from(trainingModules)
    .where(or(eq(trainingModules.organisationId, organisation.id), sql`${trainingModules.organisationId} is null`))
    .orderBy(trainingModules.title);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5">
        <h1 className="text-2xl font-semibold tracking-normal">Landing pages</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Pair campaigns with teachable landing pages, credential-style forms, attachment warnings, or training redirects.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Create landing page</CardTitle>
        </CardHeader>
        <CardContent>
          <form action={saveLandingPage} className="grid gap-4 xl:grid-cols-[320px_1fr]">
            <input type="hidden" name="orgSlug" value={orgSlug} />
            <div className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="name">Name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-2">
                <Label htmlFor="type">Type</Label>
                <select id="type" name="type" className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm">
                  {pageTypes.map((type) => (
                    <option key={type} value={type}>
                      {type.replaceAll("_", " ")}
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="linkedTrainingModuleId">Linked training</Label>
                <select
                  id="linkedTrainingModuleId"
                  name="linkedTrainingModuleId"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                >
                  <option value="">No linked training</option>
                  {modules.map((module) => (
                    <option key={module.id} value={module.id}>
                      {module.title}
                    </option>
                  ))}
                </select>
              </div>
              <Button type="submit">Create page</Button>
            </div>
            <div className="space-y-2">
              <Label htmlFor="html">HTML</Label>
              <Textarea
                id="html"
                name="html"
                rows={12}
                defaultValue="<main><h1>Heads up, that email was a phishing simulation.</h1><p>{{trainingDescription}}</p><section>{{trainingHtml}}</section></main>"
                required
              />
            </div>
          </form>
        </CardContent>
      </Card>

      <div className="space-y-3">
        {pages.map((page) => {
          const previewHtml = page.html
            .replaceAll("{{firstName}}", "Ari")
            .replaceAll("{{recipientEmail}}", "ari@example.com")
            .replaceAll("{{token}}", "preview-token")
            .replaceAll("{{brandName}}", "Campaign brand")
            .replaceAll("{{brandColour}}", "#0d1b2a")
            .replaceAll("{{brandLogo}}", '<div class="brand-mark">CB</div>')
            .replaceAll("{{brandInitial}}", "CB")
            .replaceAll("{{brandLogoUrl}}", "")
            .replaceAll("{{trainingTitle}}", page.trainingTitle ?? "Spotting phishing pressure cues")
            .replaceAll("{{trainingDescription}}", "Pause, inspect links, and report what feels off.")
            .replaceAll("{{trainingHtml}}", "<p>Check the sender, inspect the link, and slow down urgency.</p>");

          return (
          <details key={page.id} className="rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-medium">{page.name}</h2>
                  <p className="text-sm text-muted-foreground">{page.trainingTitle ?? "No training linked"}</p>
                </div>
                <div className="flex gap-2">
                  <Badge variant="secondary">{page.type.replaceAll("_", " ")}</Badge>
                  <Badge variant={page.organisationId ? "default" : "outline"}>
                    {page.organisationId ? "Custom" : "System"}
                  </Badge>
                </div>
              </div>
            </summary>
            <div className="mt-4 grid gap-4 xl:grid-cols-[420px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>{page.organisationId ? "Edit page" : "Customise copy"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={saveLandingPage} className="space-y-3">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="pageId" value={page.id} />
                    <div className="space-y-2">
                      <Label htmlFor={`name-${page.id}`}>Name</Label>
                      <Input id={`name-${page.id}`} name="name" defaultValue={page.name} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`type-${page.id}`}>Type</Label>
                      <select
                        id={`type-${page.id}`}
                        name="type"
                        defaultValue={page.type}
                        className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                      >
                        {pageTypes.map((type) => (
                          <option key={type} value={type}>
                            {type.replaceAll("_", " ")}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`training-${page.id}`}>Linked training</Label>
                      <select
                        id={`training-${page.id}`}
                        name="linkedTrainingModuleId"
                        defaultValue={page.linkedTrainingModuleId ?? ""}
                        className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                      >
                        <option value="">No linked training</option>
                        {modules.map((module) => (
                          <option key={module.id} value={module.id}>
                            {module.title}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`html-${page.id}`}>HTML</Label>
                      <Textarea id={`html-${page.id}`} name="html" defaultValue={page.html} rows={8} required />
                    </div>
                    <Button type="submit">{page.organisationId ? "Save changes" : "Create custom copy"}</Button>
                  </form>
                  {page.organisationId ? (
                    <form action={deleteLandingPage} className="mt-3">
                      <input type="hidden" name="orgSlug" value={orgSlug} />
                      <input type="hidden" name="pageId" value={page.id} />
                      <Button type="submit" variant="outline">
                        Delete page
                      </Button>
                    </form>
                  ) : null}
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="overflow-hidden rounded-lg border border-border bg-[var(--collie-cloud)]">
                    <iframe
                      title={`${page.name} preview`}
                      srcDoc={previewHtml}
                      sandbox=""
                      className="h-[560px] w-full bg-white"
                    />
                  </div>
                </CardContent>
              </Card>
            </div>
          </details>
          );
        })}
      </div>
    </div>
  );
}
