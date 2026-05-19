import { eq, or, sql } from "drizzle-orm";

import { saveTrainingModule } from "@/app/actions/training";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { trainingModules } from "@/lib/db/schema";
import Link from "next/link";

export default async function TrainingPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const modules = await db
    .select()
    .from(trainingModules)
    .where(or(eq(trainingModules.organisationId, organisation.id), sql`${trainingModules.organisationId} is null`))
    .orderBy(trainingModules.title);

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5">
        <h1 className="text-2xl font-semibold tracking-normal">Training modules</h1>
        <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
          Inspect and adapt short lessons that explain what to notice next time, with a default pass threshold of 2 from 3.
        </p>
      </div>

      <div className="space-y-3">
        {modules.map((module) => (
          <details key={module.id} className="rounded-lg border border-border bg-card p-4">
            <summary className="cursor-pointer list-none">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <h2 className="font-medium">{module.title}</h2>
                  <p className="mt-1 text-sm text-muted-foreground">
                    {Math.round(module.durationSeconds / 60)} minutes · {module.contentType} · {module.language}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Link
                    className={buttonVariants({ variant: "outline", size: "sm" })}
                    href={`/${orgSlug}/training/${module.id}/scorm`}
                  >
                    SCORM 1.2
                  </Link>
                  <Badge variant="secondary">{module.topic}</Badge>
                  <Badge variant={module.organisationId ? "default" : "outline"}>
                    {module.organisationId ? "Custom" : "System"}
                  </Badge>
                </div>
              </div>
            </summary>

            <div className="mt-4 grid gap-4 xl:grid-cols-[1fr_420px]">
              <Card>
                <CardHeader>
                  <CardTitle>Lesson preview</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm leading-6 text-muted-foreground">{module.description}</p>
                  <div className="mt-4 rounded-lg border border-border bg-[var(--collie-cloud)] p-4 text-sm leading-6">
                    <div dangerouslySetInnerHTML={{ __html: module.contentHtml ?? "" }} />
                  </div>
                  <div className="mt-4">
                    <h3 className="text-sm font-medium">Quiz</h3>
                    {module.quiz && module.quiz.length > 0 ? (
                      <ol className="mt-2 list-decimal space-y-2 pl-5 text-sm text-muted-foreground">
                        {module.quiz.map((question) => (
                          <li key={question.question}>{question.question}</li>
                        ))}
                      </ol>
                    ) : (
                      <p className="mt-2 text-sm text-muted-foreground">No quiz questions configured.</p>
                    )}
                  </div>
                </CardContent>
              </Card>

              <Card>
                <CardHeader>
                  <CardTitle>{module.organisationId ? "Edit module" : "Customise copy"}</CardTitle>
                </CardHeader>
                <CardContent>
                  <form action={saveTrainingModule} className="space-y-3">
                    <input type="hidden" name="orgSlug" value={orgSlug} />
                    <input type="hidden" name="moduleId" value={module.id} />
                    <div className="space-y-2">
                      <Label htmlFor={`title-${module.id}`}>Title</Label>
                      <Input id={`title-${module.id}`} name="title" defaultValue={module.title} required />
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`description-${module.id}`}>Description</Label>
                      <Textarea id={`description-${module.id}`} name="description" defaultValue={module.description} rows={3} required />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <div className="space-y-2">
                        <Label htmlFor={`duration-${module.id}`}>Duration seconds</Label>
                        <Input id={`duration-${module.id}`} name="durationSeconds" type="number" min={30} defaultValue={module.durationSeconds} required />
                      </div>
                      <div className="space-y-2">
                        <Label htmlFor={`topic-${module.id}`}>Topic</Label>
                        <Input id={`topic-${module.id}`} name="topic" defaultValue={module.topic} required />
                      </div>
                    </div>
                    <div className="space-y-2">
                      <Label htmlFor={`content-${module.id}`}>Lesson HTML</Label>
                      <Textarea id={`content-${module.id}`} name="contentHtml" defaultValue={module.contentHtml ?? ""} rows={6} required />
                    </div>
                    <Button type="submit">{module.organisationId ? "Save changes" : "Create custom copy"}</Button>
                  </form>
                </CardContent>
              </Card>
            </div>
          </details>
        ))}
      </div>
    </div>
  );
}
