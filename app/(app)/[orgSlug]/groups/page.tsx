import { eq } from "drizzle-orm";

import { deleteGroup, saveGroup } from "@/app/actions/groups";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { employeeGroups, employees, groups } from "@/lib/db/schema";

export default async function GroupsPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const employeeList = await db
    .select({
      id: employees.id,
      firstName: employees.firstName,
      lastName: employees.lastName,
      email: employees.email,
      department: employees.department,
      active: employees.active,
    })
    .from(employees)
    .where(eq(employees.organisationId, organisation.id))
    .orderBy(employees.email);
  const groupList = await db
    .select({
      id: groups.id,
      name: groups.name,
      memberEmployeeId: employeeGroups.employeeId,
    })
    .from(groups)
    .leftJoin(employeeGroups, eq(employeeGroups.groupId, groups.id))
    .where(eq(groups.organisationId, organisation.id))
    .orderBy(groups.name);
  const grouped = Array.from(
    groupList
      .reduce<Map<string, { id: string; name: string; memberIds: Set<string> }>>((map, row) => {
        const existing = map.get(row.id) ?? { id: row.id, name: row.name, memberIds: new Set<string>() };
        if (row.memberEmployeeId) existing.memberIds.add(row.memberEmployeeId);
        map.set(row.id, existing);
        return map;
      }, new Map())
      .values(),
  );

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5">
        <h1 className="text-2xl font-semibold tracking-normal">Groups</h1>
        <p className="mt-2 max-w-2xl text-sm leading-6 text-muted-foreground">
          Build saved campaign targets from departments, roles, or risk cohorts.
        </p>
      </div>

      <div className="rounded-lg border border-border bg-card p-4 text-sm leading-6 text-muted-foreground">
        <p>
          Groups are reusable employee cohorts for campaign targeting and exclusions. Create one when you need to send
          to a specific department, pilot team, risk cohort, or managed subset instead of all active employees.
        </p>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Create group</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={saveGroup} className="space-y-4">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <div className="space-y-2">
                <Label htmlFor="name">Group name</Label>
                <Input id="name" name="name" required />
              </div>
              <div className="space-y-3">
                <p className="text-sm font-medium">Employees</p>
                {employeeList.length === 0 ? (
                  <p className="text-sm text-muted-foreground">Add employees before creating a group.</p>
                ) : (
                  <div className="max-h-80 space-y-2 overflow-auto rounded-lg border border-border p-3">
                    {employeeList.map((employee) => (
                      <label key={employee.id} className="flex items-start gap-2 text-sm">
                        <Checkbox name="employeeIds" value={employee.id} disabled={!employee.active} />
                        <span>
                          <span className="block font-medium">
                            {employee.firstName} {employee.lastName}
                          </span>
                          <span className="block text-muted-foreground">
                            {employee.email}
                            {employee.department ? ` · ${employee.department}` : ""}
                          </span>
                        </span>
                      </label>
                    ))}
                  </div>
                )}
              </div>
              <Button type="submit" disabled={employeeList.length === 0}>
                Save group
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Saved groups</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {grouped.length === 0 ? (
              <div className="rounded-lg border border-dashed border-border p-8 text-center text-sm text-muted-foreground">
                No groups yet. Create one to target a specific cohort in a campaign.
              </div>
            ) : (
              grouped.map((group) => (
                <details key={group.id} className="rounded-lg border border-border p-4">
                  <summary className="cursor-pointer list-none">
                    <div className="flex items-center justify-between gap-3">
                      <div>
                        <h2 className="font-medium">{group.name}</h2>
                        <p className="text-sm text-muted-foreground">{group.memberIds.size} members</p>
                      </div>
                      <Badge variant="secondary">Targetable</Badge>
                    </div>
                  </summary>
                  <div className="mt-4 space-y-4 border-t border-border pt-4">
                    <form action={saveGroup} className="space-y-4">
                      <input type="hidden" name="orgSlug" value={orgSlug} />
                      <input type="hidden" name="groupId" value={group.id} />
                      <div className="space-y-2">
                        <Label htmlFor={`name-${group.id}`}>Group name</Label>
                        <Input id={`name-${group.id}`} name="name" defaultValue={group.name} required />
                      </div>
                      <div className="grid gap-2 sm:grid-cols-2">
                        {employeeList.map((employee) => (
                          <label key={employee.id} className="flex items-start gap-2 text-sm">
                            <Checkbox
                              name="employeeIds"
                              value={employee.id}
                              defaultChecked={group.memberIds.has(employee.id)}
                              disabled={!employee.active}
                            />
                            <span>
                              {employee.firstName} {employee.lastName}
                            </span>
                          </label>
                        ))}
                      </div>
                      <Button type="submit">Save changes</Button>
                    </form>
                    <form action={deleteGroup}>
                      <input type="hidden" name="orgSlug" value={orgSlug} />
                      <input type="hidden" name="groupId" value={group.id} />
                      <Button type="submit" variant="outline">
                        Delete
                      </Button>
                    </form>
                  </div>
                </details>
              ))
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
