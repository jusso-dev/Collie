import type { NextRequest } from "next/server";

import { scimJson } from "@/lib/scim/errors";
import { SCHEMA_GROUP, SCHEMA_LIST_RESPONSE, SCHEMA_USER, getScimBaseUrl } from "@/lib/scim/resources";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  const baseUrl = getScimBaseUrl(request.url);
  const resourceTypes = [
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "User",
      name: "User",
      endpoint: "/Users",
      description: "Employee identity provisioned via SCIM.",
      schema: SCHEMA_USER,
      meta: {
        resourceType: "ResourceType",
        location: `${baseUrl}/api/scim/v2/ResourceTypes/User`,
      },
    },
    {
      schemas: ["urn:ietf:params:scim:schemas:core:2.0:ResourceType"],
      id: "Group",
      name: "Group",
      endpoint: "/Groups",
      description: "Cohort of employees used for campaign targeting.",
      schema: SCHEMA_GROUP,
      meta: {
        resourceType: "ResourceType",
        location: `${baseUrl}/api/scim/v2/ResourceTypes/Group`,
      },
    },
  ];

  return scimJson({
    schemas: [SCHEMA_LIST_RESPONSE],
    totalResults: resourceTypes.length,
    startIndex: 1,
    itemsPerPage: resourceTypes.length,
    Resources: resourceTypes,
  });
}
