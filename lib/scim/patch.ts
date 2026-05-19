/**
 * Minimal SCIM 2.0 PATCH parser (RFC 7644 §3.5.2). We only model the subset
 * of paths Entra ID, Okta, and Google Workspace actually send for User and
 * Group resources.
 *
 * Returns a normalised diff that the route handlers apply against Drizzle.
 */

export type ScimPatchOp = "add" | "replace" | "remove";

export interface RawScimPatchOperation {
  op: string;
  path?: string;
  value?: unknown;
}

export interface ScimPatchEnvelope {
  schemas?: string[];
  Operations: RawScimPatchOperation[];
}

export interface UserPatchDiff {
  active?: boolean;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  externalId?: string | null;
  department?: string | null;
  managerEmail?: string | null;
}

export interface GroupPatchDiff {
  displayName?: string;
  externalId?: string | null;
  addMembers: string[];
  removeMembers: string[];
  replaceMembers?: string[];
}

function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
}

function trimmedString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function normaliseOp(op: string): ScimPatchOp | null {
  const lower = op.toLowerCase();
  if (lower === "add" || lower === "replace" || lower === "remove") return lower;
  return null;
}

function pickEmailFromArray(value: unknown): string | undefined {
  if (!Array.isArray(value)) return undefined;
  const primary = value.find((entry) => asObject(entry)?.primary === true);
  const candidate = primary ?? value[0];
  const email = asObject(candidate)?.value;
  return trimmedString(email)?.toLowerCase();
}

/**
 * Applies a SCIM PATCH envelope to a User resource. Falls back to whole-object
 * replace when an operation has no `path` (Entra ID does this for activation
 * toggles).
 */
export function applyUserPatch(envelope: ScimPatchEnvelope): UserPatchDiff {
  const diff: UserPatchDiff = {};

  for (const operation of envelope.Operations ?? []) {
    const op = normaliseOp(operation.op);
    if (!op) continue;

    // path-less add/replace: value is a fragment of the resource itself.
    if (!operation.path) {
      const fragment = asObject(operation.value);
      if (!fragment) continue;
      if ("active" in fragment) {
        diff.active = Boolean(fragment.active);
      }
      if ("userName" in fragment) {
        const email = trimmedString(fragment.userName);
        if (email && email.includes("@")) diff.email = email.toLowerCase();
      }
      if ("externalId" in fragment) {
        const ext = trimmedString(fragment.externalId);
        diff.externalId = ext ?? null;
      }
      const name = asObject(fragment.name);
      if (name) {
        const given = trimmedString(name.givenName);
        const family = trimmedString(name.familyName);
        if (given) diff.firstName = given;
        if (family) diff.lastName = family;
      }
      const emails = pickEmailFromArray(fragment.emails);
      if (emails) diff.email = emails;
      const displayName = trimmedString(fragment.displayName);
      if (displayName) diff.displayName = displayName;
      continue;
    }

    // Strip filter expressions like `emails[type eq "work"].value` down to the
    // attribute root because we only model a single primary work email per
    // employee.
    const path = operation.path.trim();
    const rootPath = path.replace(/\[.+?\]/g, "").toLowerCase();

    if (rootPath === "active") {
      diff.active = op === "remove" ? false : Boolean(operation.value);
      continue;
    }
    if (rootPath === "username") {
      const email = trimmedString(operation.value);
      if (email && email.includes("@")) diff.email = email.toLowerCase();
      continue;
    }
    if (rootPath === "externalid") {
      diff.externalId = op === "remove" ? null : trimmedString(operation.value) ?? null;
      continue;
    }
    if (rootPath === "name.givenname") {
      const given = trimmedString(operation.value);
      if (given) diff.firstName = given;
      continue;
    }
    if (rootPath === "name.familyname") {
      const family = trimmedString(operation.value);
      if (family) diff.lastName = family;
      continue;
    }
    if (rootPath === "displayname") {
      const displayName = trimmedString(operation.value);
      if (displayName) diff.displayName = displayName;
      continue;
    }
    if (rootPath === "emails" || rootPath === "emails.value") {
      const email = pickEmailFromArray(operation.value) ?? trimmedString(operation.value)?.toLowerCase();
      if (email) diff.email = email;
      continue;
    }
    // Enterprise extension fields commonly sent by Entra ID.
    if (rootPath.endsWith("department")) {
      diff.department = trimmedString(operation.value) ?? null;
      continue;
    }
    if (rootPath.endsWith("manager") || rootPath.endsWith("manager.value")) {
      diff.managerEmail = trimmedString(operation.value) ?? null;
      continue;
    }
  }

  return diff;
}

const MEMBER_VALUE_FILTER = /value\s+eq\s+"([^"]+)"/i;

/**
 * Applies a SCIM PATCH envelope to a Group resource. Returns the add/remove
 * member lists and any displayName change.
 */
export function applyGroupPatch(envelope: ScimPatchEnvelope): GroupPatchDiff {
  const diff: GroupPatchDiff = { addMembers: [], removeMembers: [] };

  for (const operation of envelope.Operations ?? []) {
    const op = normaliseOp(operation.op);
    if (!op) continue;

    const path = operation.path?.trim() ?? "";
    const rootPath = path.replace(/\[.+?\]/g, "").toLowerCase();
    const filter = path.match(/\[(.+)\]/)?.[1];

    if (!path) {
      const fragment = asObject(operation.value);
      if (!fragment) continue;
      const displayName = trimmedString(fragment.displayName);
      if (displayName) diff.displayName = displayName;
      if ("externalId" in fragment) {
        diff.externalId = trimmedString(fragment.externalId) ?? null;
      }
      if (Array.isArray(fragment.members) && op === "replace") {
        diff.replaceMembers = fragment.members
          .map((entry) => trimmedString(asObject(entry)?.value))
          .filter((value): value is string => Boolean(value));
      }
      continue;
    }

    if (rootPath === "displayname") {
      const displayName = trimmedString(operation.value);
      if (displayName) diff.displayName = displayName;
      continue;
    }
    if (rootPath === "externalid") {
      diff.externalId = op === "remove" ? null : trimmedString(operation.value) ?? null;
      continue;
    }
    if (rootPath === "members") {
      if (op === "remove") {
        const filterMatch = filter?.match(MEMBER_VALUE_FILTER);
        if (filterMatch) {
          diff.removeMembers.push(filterMatch[1]);
        } else if (Array.isArray(operation.value)) {
          for (const entry of operation.value) {
            const id = trimmedString(asObject(entry)?.value);
            if (id) diff.removeMembers.push(id);
          }
        }
        continue;
      }
      if (Array.isArray(operation.value)) {
        const ids = operation.value
          .map((entry) => trimmedString(asObject(entry)?.value))
          .filter((value): value is string => Boolean(value));
        if (op === "replace") {
          diff.replaceMembers = ids;
        } else {
          diff.addMembers.push(...ids);
        }
      } else {
        const single = trimmedString(asObject(operation.value)?.value);
        if (single) {
          if (op === "replace") diff.replaceMembers = [single];
          else diff.addMembers.push(single);
        }
      }
    }
  }

  return diff;
}

/**
 * Parses a SCIM filter clause like `userName eq "x@y.com"` and returns the
 * supported (attribute, value) pair. We only support equality on userName /
 * email / externalId / displayName because that's all Entra/Okta/Google use
 * for resource lookups.
 */
export function parseSimpleFilter(filter: string | null | undefined): {
  attribute: string;
  value: string;
} | null {
  if (!filter) return null;
  const match = /^([A-Za-z][A-Za-z0-9._-]*)\s+eq\s+"([^"]*)"$/.exec(filter.trim());
  if (!match) return null;
  return { attribute: match[1].toLowerCase(), value: match[2] };
}
