import { NextResponse } from "next/server";

const SCIM_ERROR_SCHEMA = "urn:ietf:params:scim:api:messages:2.0:Error";
const SCIM_CONTENT_TYPE = "application/scim+json";

export type ScimErrorType =
  | "invalidFilter"
  | "tooMany"
  | "uniqueness"
  | "mutability"
  | "invalidSyntax"
  | "invalidPath"
  | "noTarget"
  | "invalidValue"
  | "invalidVers"
  | "sensitive";

export interface ScimErrorOptions {
  status: number;
  detail: string;
  scimType?: ScimErrorType;
}

/**
 * Builds an RFC 7644-compliant SCIM error response. Always uses the
 * `application/scim+json` content type expected by IdP connectors (Entra ID,
 * Okta, Google Workspace).
 */
export function scimError({ status, detail, scimType }: ScimErrorOptions): NextResponse {
  return scimJson(
    {
      schemas: [SCIM_ERROR_SCHEMA],
      status: String(status),
      detail,
      ...(scimType ? { scimType } : {}),
    },
    { status },
  );
}

/**
 * Wraps a JSON response with the SCIM media type. Always prefer this over
 * `NextResponse.json` inside `/api/scim/v2/**` so IdP connectors don't reject
 * the response.
 */
export function scimJson<T>(body: T, init?: ResponseInit): NextResponse {
  const headers = new Headers(init?.headers);
  headers.set("Content-Type", SCIM_CONTENT_TYPE);
  return new NextResponse(JSON.stringify(body), {
    ...init,
    headers,
  }) as NextResponse;
}
