import type { ExclusionRuleParameters } from "@/lib/db/schema";

export type ExclusionRuleKind = "group" | "new_hire_days" | "role" | "tag";

export type ExclusionRule = {
  id: string;
  organisationId: string;
  name: string;
  kind: ExclusionRuleKind;
  parameters: ExclusionRuleParameters;
  active: boolean;
};

export type EmployeeForRules = {
  id: string;
  createdAt: Date;
};

export type EmployeeGroupMembership = {
  employeeId: string;
  groupId: string;
};

export type ApplyExclusionRulesInput = {
  employees: EmployeeForRules[];
  memberships: EmployeeGroupMembership[];
  rules: ExclusionRule[];
  now?: Date;
};

export type ExcludedEmployeeReason = {
  employeeId: string;
  ruleId: string;
  ruleName: string;
};

export type ApplyExclusionRulesOutput = {
  retainedEmployeeIds: string[];
  excluded: ExcludedEmployeeReason[];
};

/**
 * Apply a set of exclusion rules to an employee list and return who survives.
 *
 * Pure function - no I/O. Pass already-loaded employees + group memberships.
 * `role` and `tag` kinds are accepted as schema-level placeholders for future
 * use and currently exclude nobody (employees have no role/tag column yet).
 */
export function applyExclusionRules(input: ApplyExclusionRulesInput): ApplyExclusionRulesOutput {
  const now = input.now ?? new Date();
  const membershipByEmployee = new Map<string, Set<string>>();
  for (const membership of input.memberships) {
    const existing = membershipByEmployee.get(membership.employeeId) ?? new Set<string>();
    existing.add(membership.groupId);
    membershipByEmployee.set(membership.employeeId, existing);
  }

  const excluded: ExcludedEmployeeReason[] = [];
  const excludedSet = new Set<string>();

  const activeRules = input.rules.filter((rule) => rule.active);

  for (const rule of activeRules) {
    for (const employee of input.employees) {
      if (excludedSet.has(employee.id)) continue;
      if (matchesRule({ rule, employee, membershipByEmployee, now })) {
        excludedSet.add(employee.id);
        excluded.push({ employeeId: employee.id, ruleId: rule.id, ruleName: rule.name });
      }
    }
  }

  const retainedEmployeeIds = input.employees
    .map((employee) => employee.id)
    .filter((id) => !excludedSet.has(id));

  return { retainedEmployeeIds, excluded };
}

function matchesRule(input: {
  rule: ExclusionRule;
  employee: EmployeeForRules;
  membershipByEmployee: Map<string, Set<string>>;
  now: Date;
}): boolean {
  const { rule, employee, membershipByEmployee, now } = input;
  const parameters = rule.parameters as Record<string, unknown>;

  switch (rule.kind) {
    case "group": {
      const groupId = typeof parameters.groupId === "string" ? parameters.groupId : "";
      if (!groupId) return false;
      return membershipByEmployee.get(employee.id)?.has(groupId) ?? false;
    }
    case "new_hire_days": {
      const days = Number(parameters.days);
      if (!Number.isFinite(days) || days <= 0) return false;
      const cutoff = now.getTime() - days * 24 * 60 * 60 * 1000;
      return employee.createdAt.getTime() > cutoff;
    }
    case "role":
    case "tag":
      // Placeholder kinds - employees have no role/tag column yet.
      return false;
    default:
      return false;
  }
}

export function describeExclusionRule(rule: Pick<ExclusionRule, "kind" | "parameters">): string {
  const parameters = rule.parameters as Record<string, unknown>;
  switch (rule.kind) {
    case "group":
      return typeof parameters.groupId === "string" ? "Group membership" : "Group (unconfigured)";
    case "new_hire_days": {
      const days = Number(parameters.days);
      return Number.isFinite(days) && days > 0
        ? `New hires (joined < ${days} day${days === 1 ? "" : "s"} ago)`
        : "New hires (unconfigured)";
    }
    case "role":
      return "Role (placeholder)";
    case "tag":
      return "Tag (placeholder)";
    default:
      return rule.kind;
  }
}
