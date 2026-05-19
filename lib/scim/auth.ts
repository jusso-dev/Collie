import { eq } from "drizzle-orm";
import type { NextRequest } from "next/server";

import { db } from "@/lib/db/client";
import { organisations } from "@/lib/db/schema";
import { hashScimToken } from "@/lib/scim/token";

export interface ScimAuthOk {
  ok: true;
  organisation: {
    id: string;
    slug: string;
    name: string;
  };
}

export interface ScimAuthFail {
  ok: false;
  status: 401 | 403;
  detail: string;
}

/**
 * Resolves a SCIM bearer token to its owning organisation. The token is hashed
 * (SHA-256) and matched against the indexed `organisations.scim_token_hash`
 * column so we never need to decrypt sealed tokens to authenticate.
 *
 * Returns 401 when the Authorization header is missing or malformed and 401
 * when the token is unknown (deliberately indistinguishable to avoid token
 * enumeration).
 */
export async function authenticateScimRequest(request: NextRequest): Promise<ScimAuthOk | ScimAuthFail> {
  const header = request.headers.get("authorization") ?? request.headers.get("Authorization");
  if (!header) {
    return { ok: false, status: 401, detail: "Missing bearer token." };
  }
  const match = /^Bearer\s+(.+)$/i.exec(header.trim());
  if (!match) {
    return { ok: false, status: 401, detail: "Malformed Authorization header." };
  }

  const plaintext = match[1].trim();
  if (!plaintext) {
    return { ok: false, status: 401, detail: "Empty bearer token." };
  }

  const hash = hashScimToken(plaintext);
  const [organisation] = await db
    .select({
      id: organisations.id,
      slug: organisations.slug,
      name: organisations.name,
    })
    .from(organisations)
    .where(eq(organisations.scimTokenHash, hash))
    .limit(1);

  if (!organisation) {
    return { ok: false, status: 401, detail: "SCIM bearer token is not recognised." };
  }

  return { ok: true, organisation };
}
