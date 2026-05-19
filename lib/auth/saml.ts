import { createHash, createHmac, createPublicKey, createVerify, randomBytes } from "node:crypto";
import { deflateRawSync } from "node:zlib";

import { and, eq } from "drizzle-orm";

import { db } from "@/lib/db/client";
import { accounts, sessions, users } from "@/lib/db/schema";
import type { SsoCacheEntry } from "@/lib/auth/sso";

const SAML_PROTOCOL = "urn:oasis:names:tc:SAML:2.0:protocol";
const SAML_ASSERTION = "urn:oasis:names:tc:SAML:2.0:assertion";
const HTTP_POST_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST";
const HTTP_REDIRECT_BINDING = "urn:oasis:names:tc:SAML:2.0:bindings:HTTP-Redirect";
const EMAIL_NAME_ID_FORMAT = "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress";
const SESSION_MAX_AGE_SECONDS = 60 * 60 * 24 * 7;

export class SamlError extends Error {
  constructor(
    message: string,
    public readonly code = "SAML_ERROR",
    public readonly status = 400,
  ) {
    super(message);
  }
}

export type IdpMetadata = {
  entityId: string | null;
  ssoRedirectUrl: string | null;
  ssoPostUrl: string | null;
  sloRedirectUrl: string | null;
  certificates: string[];
};

export type SamlAssertionProfile = {
  email: string;
  name: string;
  subject: string;
  attributes: Record<string, string[]>;
};

type RelayState = {
  id: string;
  next: string;
  exp: number;
};

function escapeXml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

function decodeXml(value: string): string {
  return value
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function normaliseCert(cert: string): string {
  return cert.replace(/-----BEGIN CERTIFICATE-----|-----END CERTIFICATE-----|\s+/g, "");
}

function safePath(value: string | null | undefined): string {
  return value?.startsWith("/") && !value.startsWith("//") ? value : "/dashboard";
}

function hmac(value: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? "dev-only-collie-secret-change-me";
  return createHmac("sha256", secret).update(value).digest("base64url");
}

function signCookieValue(value: string): string {
  const secret = process.env.BETTER_AUTH_SECRET ?? "dev-only-collie-secret-change-me";
  const signature = createHmac("sha256", secret).update(value).digest("base64");
  return encodeURIComponent(`${value}.${signature}`);
}

function verifySignedCookieValue(value: string): string | null {
  const decoded = decodeURIComponent(value);
  const index = decoded.lastIndexOf(".");
  if (index < 1) return null;
  const unsigned = decoded.slice(0, index);
  return signCookieValue(unsigned) === encodeURIComponent(decoded) ? unsigned : null;
}

function encodeState(payload: RelayState): string {
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${body}.${hmac(body)}`;
}

export function decodeRelayState(value: string | null): RelayState | null {
  if (!value) return null;
  const [body, signature] = value.split(".");
  if (!body || !signature || hmac(body) !== signature) return null;
  const parsed = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as Partial<RelayState>;
  if (typeof parsed.id !== "string" || typeof parsed.next !== "string" || typeof parsed.exp !== "number") {
    return null;
  }
  if (parsed.exp < Math.floor(Date.now() / 1000)) return null;
  return { id: parsed.id, next: safePath(parsed.next), exp: parsed.exp };
}

function elementPattern(localName: string): RegExp {
  return new RegExp(`<(?:[A-Za-z0-9_:-]*:)?${localName}\\b([^>]*)>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_:-]*:)?${localName}>`, "gi");
}

function selfClosingPattern(localName: string): RegExp {
  return new RegExp(`<([A-Za-z0-9_:-]*:)?${localName}\\b([^>]*)\\/?>`, "gi");
}

function attr(attrs: string, name: string): string | null {
  const match = attrs.match(new RegExp(`(?:^|\\s)${name}=["']([^"']+)["']`, "i"));
  return match ? decodeXml(match[1]!) : null;
}

function extractElements(xml: string, localName: string): Array<{ full: string; attrs: string; inner: string }> {
  return Array.from(xml.matchAll(elementPattern(localName))).map((match) => ({
    full: match[0],
    attrs: match[1] ?? "",
    inner: match[2] ?? "",
  }));
}

function firstElement(xml: string, localName: string): { full: string; attrs: string; inner: string } | null {
  return extractElements(xml, localName)[0] ?? null;
}

function textOf(xml: string, localName: string): string | null {
  const element = firstElement(xml, localName);
  return element ? decodeXml(element.inner.replace(/<[^>]+>/g, "").trim()) : null;
}

async function resolveMetadata(metadata: string): Promise<string> {
  const trimmed = metadata.trim();
  if (/^https?:\/\//i.test(trimmed)) {
    const response = await fetch(trimmed, { cache: "no-store" });
    if (!response.ok) {
      throw new SamlError(`Unable to fetch IdP metadata (${response.status}).`, "SAML_METADATA_FETCH_FAILED", 502);
    }
    return response.text();
  }
  return trimmed;
}

export async function parseIdpMetadata(metadata: string): Promise<IdpMetadata> {
  const xml = await resolveMetadata(metadata);
  const entity = firstElement(xml, "EntityDescriptor");
  const services = Array.from(xml.matchAll(selfClosingPattern("SingleSignOnService")));
  const sloServices = Array.from(xml.matchAll(selfClosingPattern("SingleLogoutService")));

  return {
    entityId: entity ? attr(entity.attrs, "entityID") : null,
    ssoRedirectUrl:
      services
        .map((match) => ({ binding: attr(match[2] ?? "", "Binding"), location: attr(match[2] ?? "", "Location") }))
        .find((service) => service.binding === HTTP_REDIRECT_BINDING)?.location ?? null,
    ssoPostUrl:
      services
        .map((match) => ({ binding: attr(match[2] ?? "", "Binding"), location: attr(match[2] ?? "", "Location") }))
        .find((service) => service.binding === HTTP_POST_BINDING)?.location ?? null,
    sloRedirectUrl:
      sloServices
        .map((match) => ({ binding: attr(match[2] ?? "", "Binding"), location: attr(match[2] ?? "", "Location") }))
        .find((service) => service.binding === HTTP_REDIRECT_BINDING)?.location ?? null,
    certificates: extractElements(xml, "X509Certificate").map((element) => normaliseCert(element.inner)),
  };
}

export async function buildSamlLoginRedirect(input: {
  entry: SsoCacheEntry;
  requestUrl: URL;
  nextPath?: string | null;
}): Promise<URL> {
  if (!input.entry.saml) throw new SamlError("SAML is not configured for this organisation.", "SAML_NOT_CONFIGURED", 404);

  const metadata = await parseIdpMetadata(input.entry.saml.idpMetadata);
  const destination = metadata.ssoRedirectUrl ?? metadata.ssoPostUrl;
  if (!destination) {
    throw new SamlError("The IdP metadata does not include a SAML SSO endpoint.", "SAML_SSO_ENDPOINT_MISSING", 400);
  }

  const id = `_${randomBytes(18).toString("base64url")}`;
  const issueInstant = new Date().toISOString();
  const authnRequest = [
    `<samlp:AuthnRequest xmlns:samlp="${SAML_PROTOCOL}" xmlns:saml="${SAML_ASSERTION}"`,
    ` ID="${id}" Version="2.0" IssueInstant="${issueInstant}" Destination="${escapeXml(destination)}"`,
    ` ProtocolBinding="${HTTP_POST_BINDING}" AssertionConsumerServiceURL="${escapeXml(input.entry.saml.acsUrl)}">`,
    `<saml:Issuer>${escapeXml(input.entry.saml.entityId)}</saml:Issuer>`,
    `<samlp:NameIDPolicy Format="${EMAIL_NAME_ID_FORMAT}" AllowCreate="true" />`,
    `</samlp:AuthnRequest>`,
  ].join("");

  const relayState = encodeState({
    id,
    next: safePath(input.nextPath),
    exp: Math.floor(Date.now() / 1000) + 10 * 60,
  });

  const redirect = new URL(destination);
  redirect.searchParams.set("SAMLRequest", deflateRawSync(Buffer.from(authnRequest, "utf8")).toString("base64"));
  redirect.searchParams.set("RelayState", relayState);
  return redirect;
}

export function buildSpMetadataXml(entry: SsoCacheEntry, sloUrl: string): string {
  if (!entry.saml) throw new SamlError("SAML is not configured for this organisation.", "SAML_NOT_CONFIGURED", 404);
  return `<?xml version="1.0" encoding="UTF-8"?>
<md:EntityDescriptor xmlns:md="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${escapeXml(entry.saml.entityId)}">
  <md:SPSSODescriptor AuthnRequestsSigned="false" WantAssertionsSigned="true" protocolSupportEnumeration="${SAML_PROTOCOL}">
    <md:NameIDFormat>${EMAIL_NAME_ID_FORMAT}</md:NameIDFormat>
    <md:SingleLogoutService Binding="${HTTP_REDIRECT_BINDING}" Location="${escapeXml(sloUrl)}" />
    <md:AssertionConsumerService Binding="${HTTP_POST_BINDING}" Location="${escapeXml(entry.saml.acsUrl)}" index="0" isDefault="true" />
  </md:SPSSODescriptor>
</md:EntityDescriptor>`;
}

function canonicalCandidates(xml: string): string[] {
  const normalised = xml.replace(/\r\n?/g, "\n").trim();
  return Array.from(
    new Set([
      normalised,
      normalised.replace(/>\s+</g, "><"),
      normalised.replace(/>\s+</g, "><").replace(/\s{2,}/g, " "),
    ]),
  );
}

function stripSignature(xml: string): string {
  return xml.replace(/<(?:[A-Za-z0-9_:-]*:)?Signature\b[\s\S]*?<\/(?:[A-Za-z0-9_:-]*:)?Signature>/i, "");
}

function digestForAlgorithm(algorithm: string | null): "sha1" | "sha256" | "sha384" | "sha512" {
  if (algorithm?.includes("sha512")) return "sha512";
  if (algorithm?.includes("sha384")) return "sha384";
  if (algorithm?.includes("sha1")) return "sha1";
  return "sha256";
}

function signatureAlgorithm(algorithm: string | null): string {
  if (algorithm?.includes("sha512")) return "RSA-SHA512";
  if (algorithm?.includes("sha384")) return "RSA-SHA384";
  if (algorithm?.includes("sha1")) return "RSA-SHA1";
  return "RSA-SHA256";
}

function insertInheritedNamespaces(signedInfo: string, signatureElement: string): string {
  const namespaceAttrs = Array.from(signatureElement.matchAll(/\s(xmlns(?::[A-Za-z0-9_-]+)?=["'][^"']+["'])/g)).map(
    (match) => match[1]!,
  );
  if (namespaceAttrs.length === 0) return signedInfo;
  return signedInfo.replace(/<([A-Za-z0-9_:-]*:)?SignedInfo\b([^>]*)>/i, (opening) => {
    const missing = namespaceAttrs.filter((namespaceAttr) => {
      const name = namespaceAttr.split("=")[0]!;
      return !opening.includes(`${name}=`);
    });
    return missing.length > 0 ? opening.replace(/>$/, ` ${missing.join(" ")}>`) : opening;
  });
}

function elementById(xml: string, id: string): string | null {
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = xml.match(new RegExp(`<([A-Za-z0-9_:-]+)\\b[^>]*(?:ID|Id|id)=["']${escaped}["'][^>]*>[\\s\\S]*?<\\/\\1>`, "i"));
  return match?.[0] ?? null;
}

function verifyReferenceDigest(xml: string, signedInfo: string): boolean {
  const reference = firstElement(signedInfo, "Reference");
  const uri = reference ? attr(reference.attrs, "URI") : null;
  if (!uri?.startsWith("#")) return false;

  const digestMethod = firstElement(reference?.inner ?? "", "DigestMethod");
  const digestValue = textOf(reference?.inner ?? "", "DigestValue");
  const target = elementById(xml, uri.slice(1));
  if (!target || !digestValue) return false;

  const algorithm = digestForAlgorithm(digestMethod ? attr(digestMethod.attrs, "Algorithm") : null);
  return canonicalCandidates(stripSignature(target)).some((candidate) => {
    const digest = createHash(algorithm).update(candidate, "utf8").digest("base64");
    return digest === digestValue;
  });
}

function verifyXmlSignature(xml: string, metadataCerts: string[]): void {
  const signature = firstElement(xml, "Signature");
  if (!signature) throw new SamlError("The SAML response is not signed.", "SAML_UNSIGNED_RESPONSE", 401);

  const signedInfo = firstElement(signature.full, "SignedInfo");
  const signatureValue = textOf(signature.full, "SignatureValue");
  if (!signedInfo || !signatureValue) {
    throw new SamlError("The SAML signature is missing SignedInfo or SignatureValue.", "SAML_SIGNATURE_MALFORMED", 401);
  }

  const keyInfoCert = textOf(signature.full, "X509Certificate");
  if (metadataCerts.length === 0) {
    throw new SamlError("The IdP metadata does not include a signing certificate.", "SAML_CERTIFICATE_MISSING", 401);
  }
  if (keyInfoCert && !metadataCerts.includes(normaliseCert(keyInfoCert))) {
    throw new SamlError("The SAML signing certificate does not match the IdP metadata.", "SAML_CERTIFICATE_MISMATCH", 401);
  }

  const signatureMethod = firstElement(signedInfo.inner, "SignatureMethod");
  const algorithm = signatureAlgorithm(signatureMethod ? attr(signatureMethod.attrs, "Algorithm") : null);
  const signatureBytes = Buffer.from(signatureValue.replace(/\s+/g, ""), "base64");
  const candidates = canonicalCandidates(insertInheritedNamespaces(signedInfo.full, signature.full));

  const verified = metadataCerts.some((cert) => {
    const publicKey = createPublicKey(`-----BEGIN CERTIFICATE-----\n${cert}\n-----END CERTIFICATE-----`);
    return candidates.some((candidate) => {
      const verifier = createVerify(algorithm);
      verifier.update(candidate, "utf8");
      verifier.end();
      return verifier.verify(publicKey, signatureBytes);
    });
  });

  if (!verified) {
    throw new SamlError(
      "Unable to verify the SAML XML signature with the supported canonicalization paths.",
      "SAML_SIGNATURE_UNVERIFIED",
      401,
    );
  }

  if (!verifyReferenceDigest(xml, signedInfo.full)) {
    throw new SamlError("The SAML signature reference digest does not match the assertion.", "SAML_DIGEST_MISMATCH", 401);
  }
}

function dateWithinBounds(value: string | null, skewSeconds: number): boolean {
  if (!value) return true;
  return Date.parse(value) <= Date.now() + skewSeconds * 1000;
}

function dateNotExpired(value: string | null, skewSeconds: number): boolean {
  if (!value) return true;
  return Date.parse(value) > Date.now() - skewSeconds * 1000;
}

function collectAttributes(assertionXml: string): Record<string, string[]> {
  const attributes: Record<string, string[]> = {};
  for (const attribute of extractElements(assertionXml, "Attribute")) {
    const name = attr(attribute.attrs, "Name") ?? attr(attribute.attrs, "FriendlyName");
    if (!name) continue;
    attributes[name] = extractElements(attribute.inner, "AttributeValue").map((value) =>
      decodeXml(value.inner.replace(/<[^>]+>/g, "").trim()),
    );
  }
  return attributes;
}

function firstAttribute(attributes: Record<string, string[]>, names: string[]): string | null {
  const lowerNames = new Set(names.map((name) => name.toLowerCase()));
  for (const [name, values] of Object.entries(attributes)) {
    if (lowerNames.has(name.toLowerCase()) && values[0]) return values[0];
  }
  return null;
}

export async function parseAndVerifySamlResponse(input: {
  samlResponse: string;
  entry: SsoCacheEntry;
  relayState: RelayState | null;
}): Promise<SamlAssertionProfile> {
  if (!input.entry.saml) throw new SamlError("SAML is not configured for this organisation.", "SAML_NOT_CONFIGURED", 404);

  const xml = Buffer.from(input.samlResponse, "base64").toString("utf8");
  const metadata = await parseIdpMetadata(input.entry.saml.idpMetadata);
  verifyXmlSignature(xml, metadata.certificates);

  const response = firstElement(xml, "Response");
  const assertion = firstElement(xml, "Assertion");
  if (!response || !assertion) throw new SamlError("The SAML response does not include an assertion.", "SAML_ASSERTION_MISSING", 401);

  const statusCode = firstElement(xml, "StatusCode");
  const statusValue = statusCode ? attr(statusCode.attrs, "Value") : null;
  if (!statusValue?.endsWith(":Success")) {
    throw new SamlError("The SAML response status is not Success.", "SAML_STATUS_FAILED", 401);
  }

  const destination = attr(response.attrs, "Destination");
  if (destination && destination !== input.entry.saml.acsUrl) {
    throw new SamlError("The SAML response destination does not match this ACS URL.", "SAML_DESTINATION_MISMATCH", 401);
  }

  const inResponseTo = attr(response.attrs, "InResponseTo") ?? attr(firstElement(assertion.inner, "SubjectConfirmationData")?.attrs ?? "", "InResponseTo");
  if (input.relayState?.id && inResponseTo && inResponseTo !== input.relayState.id) {
    throw new SamlError("The SAML response does not match the AuthnRequest.", "SAML_IN_RESPONSE_TO_MISMATCH", 401);
  }

  const issuer = textOf(response.inner, "Issuer") ?? textOf(assertion.inner, "Issuer");
  if (metadata.entityId && issuer && issuer !== metadata.entityId) {
    throw new SamlError("The SAML issuer does not match the IdP metadata.", "SAML_ISSUER_MISMATCH", 401);
  }

  const conditions = firstElement(assertion.inner, "Conditions");
  if (conditions && !dateWithinBounds(attr(conditions.attrs, "NotBefore"), 300)) {
    throw new SamlError("The SAML assertion is not valid yet.", "SAML_ASSERTION_TOO_EARLY", 401);
  }
  if (conditions && !dateNotExpired(attr(conditions.attrs, "NotOnOrAfter"), 300)) {
    throw new SamlError("The SAML assertion has expired.", "SAML_ASSERTION_EXPIRED", 401);
  }

  const audience = textOf(assertion.inner, "Audience");
  if (audience && audience !== input.entry.saml.entityId) {
    throw new SamlError("The SAML assertion audience does not match this service provider.", "SAML_AUDIENCE_MISMATCH", 401);
  }

  const subject = textOf(assertion.inner, "NameID");
  const attributes = collectAttributes(assertion.inner);
  const email =
    firstAttribute(attributes, [
      "email",
      "mail",
      "EmailAddress",
      "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress",
      "urn:oid:0.9.2342.19200300.100.1.3",
    ]) ??
    (subject?.includes("@") ? subject : null);

  if (!email) throw new SamlError("The SAML assertion does not include an email address.", "SAML_EMAIL_MISSING", 401);

  const displayName =
    firstAttribute(attributes, ["name", "displayName", "http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"]) ??
    [firstAttribute(attributes, ["givenName", "firstName"]), firstAttribute(attributes, ["sn", "surname", "lastName"])]
      .filter(Boolean)
      .join(" ")
      .trim();

  return {
    email: email.trim().toLowerCase(),
    name: displayName || email.split("@")[0]!,
    subject: subject ?? email,
    attributes,
  };
}

export async function provisionSamlUserAndSession(input: {
  request: Request;
  entry: SsoCacheEntry;
  profile: SamlAssertionProfile;
}): Promise<{ token: string }> {
  const now = new Date();
  const expiresAt = new Date(Date.now() + SESSION_MAX_AGE_SECONDS * 1000);
  const providerId = `saml-${input.entry.organisationId}`;
  const accountId = input.profile.subject || input.profile.email;

  return db.transaction(async (tx) => {
    const [existing] = await tx
      .select({
        id: users.id,
        organisationId: users.organisationId,
        active: users.active,
      })
      .from(users)
      .where(eq(users.email, input.profile.email))
      .limit(1);

    if (existing?.organisationId && existing.organisationId !== input.entry.organisationId) {
      throw new SamlError("This SAML user belongs to a different organisation.", "SAML_USER_ORG_MISMATCH", 403);
    }
    if (existing && !existing.active) {
      throw new SamlError("This user is inactive.", "SAML_USER_INACTIVE", 403);
    }

    let userId = existing?.id;
    if (!userId) {
      const [created] = await tx
        .insert(users)
        .values({
          email: input.profile.email,
          name: input.profile.name,
          organisationId: input.entry.organisationId,
          role: "viewer",
          active: true,
          emailVerified: true,
        })
        .returning({ id: users.id });
      userId = created?.id;
    } else if (!existing?.organisationId) {
      await tx
        .update(users)
        .set({
          organisationId: input.entry.organisationId,
          role: "viewer",
          emailVerified: true,
          updatedAt: now,
        })
        .where(eq(users.id, userId));
    }

    if (!userId) throw new SamlError("Unable to provision the SAML user.", "SAML_USER_PROVISION_FAILED", 500);

    const [linkedAccount] = await tx
      .select({ id: accounts.id })
      .from(accounts)
      .where(and(eq(accounts.providerId, providerId), eq(accounts.accountId, accountId), eq(accounts.userId, userId)))
      .limit(1);

    if (!linkedAccount) {
      await tx.insert(accounts).values({
        id: randomBytes(16).toString("base64url"),
        providerId,
        accountId,
        userId,
        createdAt: now,
        updatedAt: now,
      });
    }

    const token = randomBytes(32).toString("base64url");
    await tx.insert(sessions).values({
      id: randomBytes(16).toString("base64url"),
      token,
      userId,
      expiresAt,
      ipAddress: input.request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "",
      userAgent: input.request.headers.get("user-agent") ?? "",
      createdAt: now,
      updatedAt: now,
    });

    return { token };
  });
}

function authCookieName(requestUrl: URL): string {
  const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? requestUrl.origin;
  const secure = baseUrl.startsWith("https://") || process.env.NODE_ENV === "production";
  return `${secure ? "__Secure-" : ""}better-auth.session_token`;
}

export function attachSessionCookie(response: Response, token: string, requestUrl: URL): void {
  const baseUrl = process.env.BETTER_AUTH_URL ?? process.env.NEXT_PUBLIC_APP_URL ?? requestUrl.origin;
  const secure = baseUrl.startsWith("https://") || process.env.NODE_ENV === "production";
  response.headers.append(
    "Set-Cookie",
    `${authCookieName(requestUrl)}=${signCookieValue(token)}; Max-Age=${SESSION_MAX_AGE_SECONDS}; Path=/; HttpOnly; SameSite=Lax${
      secure ? "; Secure" : ""
    }`,
  );
}

export async function clearSamlSession(request: Request, response: Response, requestUrl: URL): Promise<void> {
  const cookieHeader = request.headers.get("cookie") ?? "";
  const cookieName = authCookieName(requestUrl);
  const tokenCookie = cookieHeader
    .split(";")
    .map((part) => part.trim())
    .find((part) => part.startsWith(`${cookieName}=`) || part.startsWith("better-auth.session_token="));
  const token = tokenCookie ? verifySignedCookieValue(tokenCookie.split("=").slice(1).join("=")) : null;
  if (token) {
    await db.delete(sessions).where(eq(sessions.token, token));
  }

  const secure = cookieName.startsWith("__Secure-");
  for (const name of [cookieName, "better-auth.session_token", "better-auth.session_data", "better-auth.dont_remember"]) {
    response.headers.append(
      "Set-Cookie",
      `${name}=; Max-Age=0; Path=/; HttpOnly; SameSite=Lax${secure ? "; Secure" : ""}`,
    );
  }
}
