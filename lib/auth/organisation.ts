import { and, eq } from "drizzle-orm";

import { getSession } from "@/lib/auth/session";
import { db } from "@/lib/db/client";
import { organisations, users } from "@/lib/db/schema";

export class OrganisationAccessError extends Error {
  constructor(message = "Organisation access is not available for this session.") {
    super(message);
    this.name = "OrganisationAccessError";
  }
}

export async function requireOrganisationForSlug(orgSlug: string) {
  const session = await getSession();

  if (!session?.user) {
    throw new OrganisationAccessError("Sign in before managing this organisation.");
  }

  const organisationId =
    "organisationId" in session.user ? (session.user.organisationId as string | null) : null;

  if (!organisationId) {
    throw new OrganisationAccessError("Create an organisation before using the product.");
  }

  const [organisation] = await db
    .select({
      id: organisations.id,
      name: organisations.name,
      slug: organisations.slug,
      auditRetentionDays: organisations.auditRetentionDays,
      eventPiiScrubDays: organisations.eventPiiScrubDays,
      senderFromAddress: organisations.senderFromAddress,
      resendApiKeyEncrypted: organisations.resendApiKeyEncrypted,
      sendingTransport: organisations.sendingTransport,
      smtpHost: organisations.smtpHost,
      smtpPort: organisations.smtpPort,
      smtpUsernameEncrypted: organisations.smtpUsernameEncrypted,
      smtpPasswordEncrypted: organisations.smtpPasswordEncrypted,
      smtpSecure: organisations.smtpSecure,
      smtpFromAddress: organisations.smtpFromAddress,
      twilioAccountSidEncrypted: organisations.twilioAccountSidEncrypted,
      twilioAuthTokenEncrypted: organisations.twilioAuthTokenEncrypted,
      twilioMessagingServiceSidEncrypted: organisations.twilioMessagingServiceSidEncrypted,
      twilioSenderPhonePool: organisations.twilioSenderPhonePool,
      twilioOptOutKeywords: organisations.twilioOptOutKeywords,
      userActive: users.active,
    })
    .from(organisations)
    .innerJoin(users, eq(users.id, session.user.id))
    .where(and(eq(organisations.id, organisationId), eq(organisations.slug, orgSlug), eq(users.organisationId, organisations.id)))
    .limit(1);

  if (!organisation) {
    throw new OrganisationAccessError("This organisation is not available to your account.");
  }

  if (!organisation.userActive) {
    throw new OrganisationAccessError("This account has been disabled for the organisation.");
  }

  return {
    id: organisation.id,
    name: organisation.name,
    slug: organisation.slug,
    auditRetentionDays: organisation.auditRetentionDays,
    eventPiiScrubDays: organisation.eventPiiScrubDays,
    senderFromAddress: organisation.senderFromAddress,
    resendApiKeyEncrypted: organisation.resendApiKeyEncrypted,
    sendingTransport: organisation.sendingTransport,
    smtpHost: organisation.smtpHost,
    smtpPort: organisation.smtpPort,
    smtpUsernameEncrypted: organisation.smtpUsernameEncrypted,
    smtpPasswordEncrypted: organisation.smtpPasswordEncrypted,
    smtpSecure: organisation.smtpSecure,
    smtpFromAddress: organisation.smtpFromAddress,
    twilioAccountSidEncrypted: organisation.twilioAccountSidEncrypted,
    twilioAuthTokenEncrypted: organisation.twilioAuthTokenEncrypted,
    twilioMessagingServiceSidEncrypted: organisation.twilioMessagingServiceSidEncrypted,
    twilioSenderPhonePool: organisation.twilioSenderPhonePool,
    twilioOptOutKeywords: organisation.twilioOptOutKeywords,
    userId: session.user.id,
  };
}
