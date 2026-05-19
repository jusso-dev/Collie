/**
 * SCIM 2.0 resource shapes and converters between Collie domain rows and the
 * SCIM JSON representation. Schemas referenced here are the core RFC 7643
 * resource types — User and Group.
 */

export const SCHEMA_USER = "urn:ietf:params:scim:schemas:core:2.0:User";
export const SCHEMA_GROUP = "urn:ietf:params:scim:schemas:core:2.0:Group";
export const SCHEMA_LIST_RESPONSE = "urn:ietf:params:scim:api:messages:2.0:ListResponse";
export const SCHEMA_PATCH_OP = "urn:ietf:params:scim:api:messages:2.0:PatchOp";

export interface EmployeeRow {
  id: string;
  organisationId: string;
  email: string;
  firstName: string;
  lastName: string;
  department: string | null;
  managerEmail: string | null;
  language: string;
  timezone: string;
  active: boolean;
  scimExternalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface GroupRow {
  id: string;
  organisationId: string;
  name: string;
  scimExternalId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScimUserResource {
  schemas: string[];
  id: string;
  externalId?: string;
  userName: string;
  name: {
    givenName: string;
    familyName: string;
    formatted: string;
  };
  displayName: string;
  emails: Array<{ value: string; primary: boolean; type: string }>;
  active: boolean;
  meta: {
    resourceType: "User";
    created: string;
    lastModified: string;
    location: string;
    version?: string;
  };
}

export interface ScimGroupMember {
  value: string;
  display?: string;
  $ref?: string;
}

export interface ScimGroupResource {
  schemas: string[];
  id: string;
  externalId?: string;
  displayName: string;
  members: ScimGroupMember[];
  meta: {
    resourceType: "Group";
    created: string;
    lastModified: string;
    location: string;
    version?: string;
  };
}

export function scimUserFromEmployee(
  row: EmployeeRow,
  options: { baseUrl: string },
): ScimUserResource {
  const formatted = `${row.firstName} ${row.lastName}`.trim();
  return {
    schemas: [SCHEMA_USER],
    id: row.id,
    ...(row.scimExternalId ? { externalId: row.scimExternalId } : {}),
    userName: row.email,
    name: {
      givenName: row.firstName,
      familyName: row.lastName,
      formatted: formatted || row.email,
    },
    displayName: formatted || row.email,
    emails: [{ value: row.email, primary: true, type: "work" }],
    active: row.active,
    meta: {
      resourceType: "User",
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${options.baseUrl}/api/scim/v2/Users/${row.id}`,
    },
  };
}

export function scimGroupFromRow(
  row: GroupRow,
  members: Array<{ id: string; email: string; firstName: string; lastName: string }>,
  options: { baseUrl: string },
): ScimGroupResource {
  return {
    schemas: [SCHEMA_GROUP],
    id: row.id,
    ...(row.scimExternalId ? { externalId: row.scimExternalId } : {}),
    displayName: row.name,
    members: members.map((member) => ({
      value: member.id,
      display: `${member.firstName} ${member.lastName}`.trim() || member.email,
      $ref: `${options.baseUrl}/api/scim/v2/Users/${member.id}`,
    })),
    meta: {
      resourceType: "Group",
      created: row.createdAt.toISOString(),
      lastModified: row.updatedAt.toISOString(),
      location: `${options.baseUrl}/api/scim/v2/Groups/${row.id}`,
    },
  };
}

/**
 * Strict shape we accept on POST /Users from IdP connectors. Anything we
 * don't model here is silently ignored, but the required SCIM core fields
 * must be present.
 */
export interface ScimUserCreateInput {
  userName: string;
  externalId?: string;
  active?: boolean;
  name?: { givenName?: string; familyName?: string; formatted?: string };
  emails?: Array<{ value?: string; primary?: boolean; type?: string }>;
  displayName?: string;
  [extra: string]: unknown;
}

/**
 * Resolves the work email for a User payload. Entra ID and Okta typically set
 * `userName` to the UPN/email; Google Workspace puts it in `emails`. We try
 * primary email first, fall back to the first email, then `userName`.
 */
export function resolveUserEmail(input: ScimUserCreateInput): string | null {
  if (Array.isArray(input.emails)) {
    const primary = input.emails.find((entry) => entry?.primary && typeof entry.value === "string");
    if (primary?.value) return primary.value.trim().toLowerCase();
    const first = input.emails.find((entry) => typeof entry?.value === "string");
    if (first?.value) return first.value.trim().toLowerCase();
  }
  if (typeof input.userName === "string" && input.userName.includes("@")) {
    return input.userName.trim().toLowerCase();
  }
  return null;
}

export function resolveDisplayNameParts(input: ScimUserCreateInput, email: string): {
  firstName: string;
  lastName: string;
} {
  const given = input.name?.givenName?.trim();
  const family = input.name?.familyName?.trim();
  if (given || family) {
    return { firstName: given || "—", lastName: family || "—" };
  }
  const formatted = input.name?.formatted?.trim() ?? input.displayName?.trim();
  if (formatted) {
    const [first, ...rest] = formatted.split(/\s+/);
    return { firstName: first ?? "—", lastName: rest.join(" ") || "—" };
  }
  const local = email.split("@")[0] ?? "";
  const parts = local.split(/[._-]+/).filter(Boolean);
  return {
    firstName: parts[0] ? parts[0][0].toUpperCase() + parts[0].slice(1) : "SCIM",
    lastName: parts[1] ? parts[1][0].toUpperCase() + parts[1].slice(1) : "User",
  };
}

/**
 * Computes the app's public base URL — used as the `location` prefix in SCIM
 * `meta` blocks. Caller can override at runtime by passing in the request URL
 * if env vars are not set (useful in preview deploys).
 */
export function getScimBaseUrl(requestUrl?: string): string {
  const env =
    process.env.NEXT_PUBLIC_APP_URL ?? process.env.BETTER_AUTH_URL ?? null;
  if (env) return env.replace(/\/$/, "");
  if (requestUrl) {
    try {
      const url = new URL(requestUrl);
      return `${url.protocol}//${url.host}`;
    } catch {
      // fall through
    }
  }
  return "http://localhost:3000";
}
