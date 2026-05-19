import { desc, eq } from "drizzle-orm";

import {
  createExclusionRule,
  deleteExclusionRule,
  setExclusionRuleActive,
} from "@/app/actions/exclusion-rules";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { describeExclusionRule } from "@/lib/campaigns/exclusion-rules";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { exclusionRules, groups } from "@/lib/db/schema";

export default async function ExclusionsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);

  const ruleList = await db
    .select({
      id: exclusionRules.id,
      name: exclusionRules.name,
      kind: exclusionRules.kind,
      parameters: exclusionRules.parameters,
      active: exclusionRules.active,
      createdAt: exclusionRules.createdAt,
    })
    .from(exclusionRules)
    .where(eq(exclusionRules.organisationId, organisation.id))
    .orderBy(desc(exclusionRules.createdAt));

  const groupOptions = await db
    .select({ id: groups.id, name: groups.name })
    .from(groups)
    .where(eq(groups.organisationId, organisation.id))
    .orderBy(groups.name);

  const groupNameById = new Map(groupOptions.map((group) => [group.id, group.name]));

  function describeParameters(rule: { kind: string; parameters: unknown }) {
    const params = (rule.parameters ?? {}) as Record<string, unknown>;
    if (rule.kind === "group") {
      const groupId = typeof params.groupId === "string" ? params.groupId : null;
      return groupId ? `Group: ${groupNameById.get(groupId) ?? groupId}` : "Group: unconfigured";
    }
    if (rule.kind === "new_hire_days") {
      const days = Number(params.days);
      return Number.isFinite(days) && days > 0
        ? `Joined < ${days} day${days === 1 ? "" : "s"} ago`
        : "Days: unconfigured";
    }
    return describeExclusionRule({ kind: rule.kind as never, parameters: params });
  }

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(34_211_238_/_0.08)] p-5">
        <h1 className="text-2xl font-semibold tracking-normal">Exclusion rules</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Define cohort-level rules - VIP groups, new-hire windows - that are applied at campaign target-build time.
          Per-employee exclusions on the Employees page still apply on top of these rules.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Create rule</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createExclusionRule} className="space-y-4">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <div className="space-y-2">
                <Label htmlFor="name">Rule name</Label>
                <Input id="name" name="name" required placeholder="VIPs, On leave, New hires" />
              </div>
              <div className="space-y-2">
                <Label htmlFor="kind">Rule kind</Label>
                <select
                  id="kind"
                  name="kind"
                  defaultValue="group"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                >
                  <option value="group">Group membership</option>
                  <option value="new_hire_days">New hires (joined within N days)</option>
                  <option value="role" disabled>
                    Role (placeholder - not yet supported)
                  </option>
                  <option value="tag" disabled>
                    Tag (placeholder - not yet supported)
                  </option>
                </select>
              </div>
              <div className="space-y-2">
                <Label htmlFor="groupId">Group (for group rules)</Label>
                <select
                  id="groupId"
                  name="groupId"
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-2.5 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  defaultValue=""
                >
                  <option value="">No group selected</option>
                  {groupOptions.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.name}
                    </option>
                  ))}
                </select>
                {groupOptions.length === 0 ? (
                  <p className="text-xs text-muted-foreground">
                    Create a group first on the Groups page if you want a group-based rule.
                  </p>
                ) : null}
              </div>
              <div className="space-y-2">
                <Label htmlFor="days">Days (for new-hire rules)</Label>
                <Input
                  id="days"
                  name="days"
                  type="number"
                  min={1}
                  max={365}
                  step={1}
                  placeholder="14"
                />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input type="checkbox" name="active" value="true" defaultChecked className="h-4 w-4 rounded border-input" />
                Active immediately
              </label>
              <Button type="submit">Create rule</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Rules</CardTitle>
          </CardHeader>
          <CardContent>
            {ruleList.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No rules yet. Add one to exclude a cohort from future campaigns.
              </div>
            ) : (
              <div className="space-y-3">
                {ruleList.map((rule) => (
                  <div key={rule.id} className="rounded-lg border border-border p-4">
                    <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                      <div>
                        <h2 className="font-medium">{rule.name}</h2>
                        <p className="text-sm text-muted-foreground">
                          {describeParameters({ kind: rule.kind, parameters: rule.parameters })}
                        </p>
                        <p className="mt-1 text-xs text-muted-foreground">
                          Added {rule.createdAt.toLocaleString("en-AU")}
                        </p>
                      </div>
                      <Badge variant={rule.active ? "default" : "secondary"}>
                        {rule.active ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <div className="mt-3 flex flex-wrap gap-2">
                      <form action={setExclusionRuleActive}>
                        <input type="hidden" name="orgSlug" value={orgSlug} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <input type="hidden" name="active" value={rule.active ? "false" : "true"} />
                        <Button type="submit" variant="outline">
                          {rule.active ? "Deactivate" : "Activate"}
                        </Button>
                      </form>
                      <form action={deleteExclusionRule}>
                        <input type="hidden" name="orgSlug" value={orgSlug} />
                        <input type="hidden" name="ruleId" value={rule.id} />
                        <Button type="submit" variant="outline">
                          Delete
                        </Button>
                      </form>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
