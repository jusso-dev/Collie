import { asc, eq } from "drizzle-orm";

import { createEmployee, setEmployeeActive } from "@/app/actions/employees";
import { EmployeeCsvImportForm } from "@/components/app/employee-csv-import-form";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { requireOrganisationForSlug } from "@/lib/auth/organisation";
import { db } from "@/lib/db/client";
import { employees } from "@/lib/db/schema";

export default async function EmployeesPage({
  params,
}: {
  params: Promise<{ orgSlug: string }>;
}) {
  const { orgSlug } = await params;
  const organisation = await requireOrganisationForSlug(orgSlug);
  const employeeList = await db
    .select()
    .from(employees)
    .where(eq(employees.organisationId, organisation.id))
    .orderBy(asc(employees.email));

  return (
    <div className="space-y-6">
      <div className="rounded-lg border border-border bg-[rgb(56_189_248_/_0.08)] p-5 md:flex md:items-end md:justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-normal">Employees</h1>
          <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
            Manage the people receiving simulations and training. Deactivation preserves history for reporting.
          </p>
        </div>
      </div>

      <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
        <Card>
          <CardHeader>
            <CardTitle>Add one employee</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={createEmployee} className="grid gap-3">
              <input type="hidden" name="orgSlug" value={orgSlug} />
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="firstName">First name</Label>
                  <Input id="firstName" name="firstName" required />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="lastName">Last name</Label>
                  <Input id="lastName" name="lastName" required />
                </div>
              </div>
              <div className="space-y-2">
                <Label htmlFor="email">Work email</Label>
                <Input id="email" name="email" type="email" required />
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div className="space-y-2">
                  <Label htmlFor="department">Department</Label>
                  <Input id="department" name="department" />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="managerEmail">Manager email</Label>
                  <Input id="managerEmail" name="managerEmail" type="email" />
                </div>
              </div>
              <Button type="submit">Add employee</Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Import CSV</CardTitle>
          </CardHeader>
          <CardContent>
            <EmployeeCsvImportForm orgSlug={orgSlug} />
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Employee list</CardTitle>
          <Badge variant="outline">{employeeList.length} total</Badge>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Name</TableHead>
                  <TableHead>Department</TableHead>
                  <TableHead>Risk score</TableHead>
                  <TableHead>Last trained</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead className="w-12" />
                </TableRow>
              </TableHeader>
              <TableBody>
                {employeeList.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={6} className="h-40 text-center text-sm text-muted-foreground">
                      No employees imported yet. Import a CSV or add an employee to begin testing campaigns.
                    </TableCell>
                  </TableRow>
                ) : (
                  employeeList.map((employee) => (
                    <TableRow key={employee.id}>
                      <TableCell>
                        <div className="font-medium">
                          {employee.firstName} {employee.lastName}
                        </div>
                        <div className="text-xs text-muted-foreground">{employee.email}</div>
                      </TableCell>
                      <TableCell>{employee.department || "None"}</TableCell>
                      <TableCell>{employee.riskScore}</TableCell>
                      <TableCell>
                        {employee.lastTrainedAt ? employee.lastTrainedAt.toLocaleDateString("en-AU") : "Not trained"}
                      </TableCell>
                      <TableCell>
                        <Badge variant={employee.active ? "secondary" : "outline"}>
                          {employee.active ? "Active" : "Inactive"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <form action={setEmployeeActive}>
                          <input type="hidden" name="orgSlug" value={orgSlug} />
                          <input type="hidden" name="employeeId" value={employee.id} />
                          <input type="hidden" name="active" value={employee.active ? "false" : "true"} />
                          <Button type="submit" variant="ghost" size="sm">
                            {employee.active ? "Deactivate" : "Reactivate"}
                          </Button>
                        </form>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
