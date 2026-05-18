import { eq, or, sql } from "drizzle-orm";

import { saveEmailTemplate } from "@/app/actions/templates";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { emailTemplates, trainingModules } from "@/lib/db/schema";

const categories = [
  "credential_harvest",
  "invoice_fraud",
  "ceo_impersonation",
  "qr_code",
  "callback",
  "package_delivery",
  "tax",
  "telecom",
  "document_share",
] as const;

function previewHtml(html: string, replacements: Record<string, string>) {
  const replaced = Object.entries(replacements).reduce(
    (output, [token, value]) => output.replaceAll(token, value),
    html,
  );

  return replaced.replace(
    /<img[^>]*logo\.clearbit\.com[^>]*>/gi,
    '<span style="display:inline-flex;width:38px;height:38px;border-radius:8px;background:#0d1b2a;color:#ffffff;align-items:center;justify-content:center;font-size:14px;font-weight:700;">B</span>',
  );
}

export default async function TemplatesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const templates = await db
    .select({
      id: emailTemplates.id,
      name: emailTemplates.name,
      category: emailTemplates.category,
      difficulty: emailTemplates.difficulty,
      organisationId: emailTemplates.organisationId,
      subject: emailTemplates.subject,
      fromName: emailTemplates.fromName,
      fromEmailPattern: emailTemplates.fromEmailPattern,
      htmlBody: emailTemplates.htmlBody,
      textBody: emailTemplates.textBody,
      region: emailTemplates.region,
      language: emailTemplates.language,
      linkedTrainingModuleId: emailTemplates.linkedTrainingModuleId,
      trainingTitle: trainingModules.title,
    })
    .from(emailTemplates)
    .leftJoin(trainingModules, eq(trainingModules.id, emailTemplates.linkedTrainingModuleId))
    .where(or(eq(emailTemplates.organisationId, organisation.id), sql`${emailTemplates.organisationId} is null`))
    .orderBy(emailTemplates.name);
  const modules = await db
    .select({ id: trainingModules.id, title: trainingModules.title })
    .from(trainingModules)
    .where(or(eq(trainingModules.organisationId, organisation.id), sql`${trainingModules.organisationId} is null`))
    .orderBy(trainingModules.title);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5">
        <h1 className="text-2xl font-semibold tracking-normal">Template library</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Inspect subject lines, sender patterns, difficulty, and linked training before using a template in a campaign.
        </p>
      </div>

      <div className="space-y-3">
        {templates.map((template) => (
          <details key={template.id} className="rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-medium">{template.name}</h2>
                  <p className="text-sm text-muted-foreground">{template.subject}</p>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Badge className="bg-[var(--collie-orange)] text-[var(--collie-white)]">
                    Difficulty {template.difficulty}
                  </Badge>
                  <Badge variant="secondary">{template.category.replaceAll("_", " ")}</Badge>
                </div>
              </div>
            </summary>
            <div className="mt-4 grid gap-4 xl:grid-cols-[420px_1fr]">
              <Card>
                <CardHeader>
                  <CardTitle>{template.organisationId ? "Edit template" : "Customise copy"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={saveEmailTemplate} className="space-y-3">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="templateId" value={template.id} />
                    <div className="space-y-2">
                      <Label htmlFor={`name-${template.id}`}>Name</Label>
                      <Input id={`name-${template.id}`} name="name" defaultValue={template.name} required />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`category-${template.id}`}>Category</Label>
                        <select
                          id={`category-${template.id}`}
                          name="category"
                          defaultValue={template.category}
                          className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm"
                        >
                          {categories.map((category) => (
                            <option key={category} value={category}>
                              {category.replaceAll("_", " ")}
                            </option>
                          ))}
                        </select>
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`difficulty-${template.id}`}>Difficulty</Label>
                        <Input
                          id={`difficulty-${template.id}`}
                          name="difficulty"
                          type="number"
                          min={1}
                          max={5}
                          defaultValue={template.difficulty}
                          required
                        />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`subject-${template.id}`}>Subject</Label>
                      <Input id={`subject-${template.id}`} name="subject" defaultValue={template.subject} required />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`from-name-${template.id}`}>From name</Label>
                        <Input id={`from-name-${template.id}`} name="fromName" defaultValue={template.fromName} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`from-email-${template.id}`}>From pattern</Label>
                        <Input
                          id={`from-email-${template.id}`}
                          name="fromEmailPattern"
                          defaultValue={template.fromEmailPattern}
                          required
                        />
                      </div>
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`language-${template.id}`}>Language</Label>
                        <Input id={`language-${template.id}`} name="language" defaultValue={template.language} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`region-${template.id}`}>Region</Label>
                        <Input id={`region-${template.id}`} name="region" defaultValue={template.region} required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`training-${template.id}`}>Linked training</Label>
                      <select
                        id={`training-${template.id}`}
                        name="linkedTrainingModuleId"
                        defaultValue={template.linkedTrainingModuleId ?? ""}
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
                      <Label htmlFor={`html-${template.id}`}>HTML body</Label>
                      <Textarea id={`html-${template.id}`} name="htmlBody" defaultValue={template.htmlBody} rows={7} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`text-${template.id}`}>Plain text body</Label>
                      <Textarea id={`text-${template.id}`} name="textBody" defaultValue={template.textBody} rows={5} required />
                    </div>
                    <Button type="submit">{template.organisationId ? "Save changes" : "Create custom copy"}</Button>
                  </form>
                </CardContent>
              </Card>
              <Card>
                <CardHeader>
                  <CardTitle>Inbox preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <div className="rounded-lg border border-border bg-[var(--collie-cloud)] p-3">
                    <div className="rounded-t-lg border border-border bg-card p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <p className="font-medium">{template.fromName}</p>
                          <p className="text-xs text-muted-foreground">{template.fromEmailPattern}</p>
                        </div>
                        <Badge variant="outline">Inbox</Badge>
                      </div>
                      <p className="mt-3 font-medium">
                        {template.subject
                          .replaceAll("{{firstName}}", "Ari")
                          .replaceAll("{{department}}", "Finance")
                          .replaceAll("{{organisationName}}", organisation.name)}
                      </p>
                    </div>
                    <div className="rounded-b-lg border-x border-b border-border bg-card p-4 text-sm leading-6">
                      <div
                        dangerouslySetInnerHTML={{
                          __html: previewHtml(template.htmlBody, {
                            "{{firstName}}": "Ari",
                            "{{lastName}}": "Nguyen",
                            "{{fullName}}": "Ari Nguyen",
                            "{{recipientEmail}}": "ari@example.test",
                            "{{department}}": "Finance",
                            "{{organisationName}}": organisation.name,
                            "{{trackingUrl}}": "https://mail.example.test/c/token",
                            "{{trackingPixel}}": "",
                          }),
                        }}
                      />
                    </div>
                  </div>
                  <details className="mt-3 text-sm">
                    <summary className="cursor-pointer text-muted-foreground">Plain text body</summary>
                    <pre className="mt-2 whitespace-pre-wrap rounded-lg bg-[var(--collie-cloud)] p-3 font-mono text-xs">
                      {template.textBody}
                    </pre>
                  </details>
                </CardContent>
              </Card>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
