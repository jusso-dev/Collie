import { eq, inArray } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { employeeGroups, employees } from "@/lib/db/schema";

export interface GroupMember {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

/**
 * Loads members keyed by group id for the supplied set of groups.
 * Returns an empty map when `groupIds` is empty. Caller is responsible for
 * confirming the groups belong to the requesting organisation.
 */
export async function loadMembersForGroups(groupIds: string[]): Promise<Map<string, GroupMember[]>> {
  const result = new Map<string, GroupMember[]>();
  if (groupIds.length === 0) return result;

  const rows = await db
    .select({
      groupId: employeeGroups.groupId,
      id: employees.id,
      email: employees.email,
      firstName: employees.firstName,
      lastName: employees.lastName,
    })
    .from(employeeGroups)
    .innerJoin(employees, eq(employees.id, employeeGroups.employeeId))
    .where(inArray(employeeGroups.groupId, groupIds));

  for (const row of rows) {
    const list = result.get(row.groupId) ?? [];
    list.push({ id: row.id, email: row.email, firstName: row.firstName, lastName: row.lastName });
    result.set(row.groupId, list);
  }
  return result;
}
