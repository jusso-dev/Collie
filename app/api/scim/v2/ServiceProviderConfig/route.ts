import type { NextRequest } from "next/server";

import { scimJson } from "@/lib/scim/errors";
import { getScimBaseUrl } from "@/lib/scim/resources";

export const dynamic = "force-dynamic";

/**
 * SCIM 2.0 service provider config advertises which optional features Collie
 * supports. Required by Entra ID for connector discovery.
 */
export async function GET(request: NextRequest) {
  const baseUrl = getScimBaseUrl(request.url);
  return scimJson({
    schemas: ["urn:ietf:params:scim:schemas:core:2.0:ServiceProviderConfig"],
    documentationUri: "https://datatracker.ietf.org/doc/html/rfc7644",
    patch: { supported: true },
    bulk: { supported: false, maxOperations: 0, maxPayloadSize: 0 },
    filter: { supported: true, maxResults: 200 },
    changePassword: { supported: false },
    sort: { supported: false },
    etag: { supported: false },
    authenticationSchemes: [
      {
        type: "oauthbearertoken",
        name: "OAuth Bearer Token",
        description: "Per-organisation bearer token issued from the Collie settings page.",
        specUri: "https://datatracker.ietf.org/doc/html/rfc6750",
        primary: true,
      },
    ],
    meta: {
      resourceType: "ServiceProviderConfig",
      location: `${baseUrl}/api/scim/v2/ServiceProviderConfig`,
    },
  });
}
