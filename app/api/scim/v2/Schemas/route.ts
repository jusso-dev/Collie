import type { NextRequest } from "next/server";

import { scimJson } from "@/lib/scim/errors";
import { SCHEMA_GROUP, SCHEMA_LIST_RESPONSE, SCHEMA_USER, getScimBaseUrl } from "@/lib/scim/resources";

export const dynamic = "force-dynamic";

/**
 * Returns the User and Group SCIM core schemas Collie supports. Only the
 * attributes we actually persist are advertised — enterprise extensions are
 * accepted on input (department / manager) but not declared here to keep the
 * surface area honest.
 */
export async function GET(request: NextRequest) {
  const baseUrl = getScimBaseUrl(request.url);
  const userSchema = {
    id: SCHEMA_USER,
    name: "User",
    description: "Collie employee identity.",
    attributes: [
      stringAttr("userName", { uniqueness: "server", required: true }),
      stringAttr("displayName"),
      complexAttr("name", [
        stringAttr("givenName"),
        stringAttr("familyName"),
        stringAttr("formatted"),
      ]),
      multiComplexAttr("emails", [
        stringAttr("value"),
        stringAttr("type"),
        booleanAttr("primary"),
      ]),
      booleanAttr("active"),
      stringAttr("externalId"),
    ],
    meta: { resourceType: "Schema", location: `${baseUrl}/api/scim/v2/Schemas/${SCHEMA_USER}` },
  };

  const groupSchema = {
    id: SCHEMA_GROUP,
    name: "Group",
    description: "Collie employee cohort.",
    attributes: [
      stringAttr("displayName", { required: true }),
      stringAttr("externalId"),
      multiComplexAttr("members", [stringAttr("value"), stringAttr("display"), stringAttr("$ref")]),
    ],
    meta: { resourceType: "Schema", location: `${baseUrl}/api/scim/v2/Schemas/${SCHEMA_GROUP}` },
  };

  return scimJson({
    schemas: [SCHEMA_LIST_RESPONSE],
    totalResults: 2,
    startIndex: 1,
    itemsPerPage: 2,
    Resources: [userSchema, groupSchema],
  });
}

function stringAttr(
  name: string,
  options: { required?: boolean; uniqueness?: "none" | "server" | "global" } = {},
) {
  return {
    name,
    type: "string",
    multiValued: false,
    required: options.required ?? false,
    caseExact: false,
    mutability: "readWrite",
    returned: "default",
    uniqueness: options.uniqueness ?? "none",
  };
}

function booleanAttr(name: string) {
  return {
    name,
    type: "boolean",
    multiValued: false,
    required: false,
    mutability: "readWrite",
    returned: "default",
  };
}

function complexAttr(name: string, subAttributes: Array<ReturnType<typeof stringAttr>>) {
  return {
    name,
    type: "complex",
    multiValued: false,
    required: false,
    mutability: "readWrite",
    returned: "default",
    subAttributes,
  };
}

function multiComplexAttr(name: string, subAttributes: Array<ReturnType<typeof stringAttr> | ReturnType<typeof booleanAttr>>) {
  return {
    name,
    type: "complex",
    multiValued: true,
    required: false,
    mutability: "readWrite",
    returned: "default",
    subAttributes,
  };
}
