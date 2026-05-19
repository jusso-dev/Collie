import { relations, sql } from "drizzle-orm";
import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export const userRole = pgEnum("user_role", ["owner", "admin", "viewer"]);
export const invitationStatus = pgEnum("invitation_status", ["pending", "accepted", "cancelled", "expired"]);
export const dataRegion = pgEnum("data_region", ["au", "us", "eu"]);
export const plan = pgEnum("plan", ["trial", "starter", "growth", "enterprise"]);
export const templateCategory = pgEnum("template_category", [
  "credential_harvest",
  "invoice_fraud",
  "ceo_impersonation",
  "qr_code",
  "callback",
  "package_delivery",
  "tax",
  "telecom",
  "document_share",
  "attachment_pdf",
  "attachment_html",
  "usb_drop",
  "oauth_consent",
  "mfa_push",
  "sms_lure",
  "vishing",
  "deepfake_exec",
]);
export const landingPageType = pgEnum("landing_page_type", [
  "credential_harvest",
  "attachment_warning",
  "training_redirect",
  "friendly_simulation",
  "mfa_push_simulator",
  "oauth_consent",
  "usb_drop",
  "voice_callback",
  "deepfake_disclosure",
]);
export const deliveryChannel = pgEnum("delivery_channel", [
  "email",
  "sms",
  "voice",
  "qr",
  "attachment",
  "usb",
]);
export const campaignStatus = pgEnum("campaign_status", [
  "draft",
  "scheduled",
  "running",
  "completed",
  "cancelled",
  "paused",
]);
export const sendStrategy = pgEnum("send_strategy", [
  "immediate",
  "drip",
  "randomised_over_window",
]);
export const eventType = pgEnum("event_type", [
  "sent",
  "opened",
  "clicked",
  "submitted",
  "reported",
  "trained",
  "bounced",
  "complained",
]);
export const trainingContentType = pgEnum("training_content_type", [
  "video",
  "interactive",
  "article",
]);
export const assignmentSource = pgEnum("assignment_source", [
  "just_in_time",
  "scheduled",
  "manual",
]);
export const sendingTransport = pgEnum("sending_transport", ["resend", "smtp"]);
export const deepfakeAssetStatus = pgEnum("deepfake_asset_status", [
  "draft",
  "pending_approval",
  "approved",
  "rejected",
  "expired",
]);
export const campaignApprovalDecision = pgEnum("campaign_approval_decision", [
  "approved",
  "rejected",
]);
export const ssoKind = pgEnum("sso_kind", ["oidc", "saml"]);
export const exclusionRuleKind = pgEnum("exclusion_rule_kind", [
  "group",
  "new_hire_days",
  "role",
  "tag",
]);

const timestamps = {
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
};

export const organisations = pgTable(
  "organisations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    name: text("name").notNull(),
    slug: text("slug").notNull(),
    industry: text("industry"),
    employeeCountBand: text("employee_count_band"),
    plan: plan("plan").default("trial").notNull(),
    dataRegion: dataRegion("data_region").default("au").notNull(),
    resendApiKeyEncrypted: text("resend_api_key_encrypted"),
    senderFromAddress: text("sender_from_address"),
    auditRetentionDays: integer("audit_retention_days").default(395).notNull(),
    sendingTransport: sendingTransport("sending_transport").default("resend").notNull(),
    smtpHost: text("smtp_host"),
    smtpPort: integer("smtp_port"),
    smtpUsernameEncrypted: text("smtp_username_encrypted"),
    smtpPasswordEncrypted: text("smtp_password_encrypted"),
    smtpSecure: boolean("smtp_secure").default(true).notNull(),
    smtpFromAddress: text("smtp_from_address"),
    twilioAccountSidEncrypted: text("twilio_account_sid_encrypted"),
    twilioAuthTokenEncrypted: text("twilio_auth_token_encrypted"),
    twilioMessagingServiceSidEncrypted: text("twilio_messaging_service_sid_encrypted"),
    twilioSenderPhonePool: text("twilio_sender_phone_pool").array().default(sql`ARRAY[]::text[]`).notNull(),
    twilioOptOutKeywords: text("twilio_opt_out_keywords").array().default(sql`ARRAY['STOP']::text[]`).notNull(),
    twilioVoiceFromNumberEncrypted: text("twilio_voice_from_number_encrypted"),
    voiceProvider: text("voice_provider").default("twilio").notNull(),
    ttsProvider: text("tts_provider").default("azure").notNull(),
    voiceConsentRegions: text("voice_consent_regions").array().default(sql`ARRAY[]::text[]`).notNull(),
    scimTokenEncrypted: text("scim_token_encrypted"),
    scimTokenHash: text("scim_token_hash"),
    scimTokenIssuedAt: timestamp("scim_token_issued_at", { withTimezone: true }),
    apiKeyEncrypted: text("api_key_encrypted"),
    apiKeyHash: text("api_key_hash"),
    apiKeyLast4: text("api_key_last4"),
    apiKeyCreatedAt: timestamp("api_key_created_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("organisations_slug_idx").on(table.slug),
    uniqueIndex("organisations_scim_token_hash_idx").on(table.scimTokenHash),
    uniqueIndex("organisations_api_key_hash_idx").on(table.apiKeyHash),
  ],
);

export const users = pgTable(
  "users",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id").references(() => organisations.id, {
      onDelete: "set null",
    }),
    name: text("name").notNull(),
    email: text("email").notNull(),
    emailVerified: boolean("email_verified").default(false).notNull(),
    image: text("image"),
    role: userRole("role").default("owner").notNull(),
    active: boolean("active").default(true).notNull(),
    mfaRequired: boolean("mfa_required").default(false).notNull(),
    mfaEnabled: boolean("mfa_enabled").default(false).notNull(),
    mfaResetAt: timestamp("mfa_reset_at", { withTimezone: true }),
    totpSecretEncrypted: text("totp_secret_encrypted"),
    // Mirror of BetterAuth twoFactor plugin's required user field. We keep our
    // own mfaEnabled flag (used by the org-level enforcement gate) and let the
    // plugin manage twoFactorEnabled, which is its trigger for the sign-in
    // challenge. The two are kept in lockstep by app/actions/mfa.ts.
    twoFactorEnabled: boolean("two_factor_enabled").default(false).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("users_email_idx").on(table.email),
    index("users_organisation_id_idx").on(table.organisationId),
  ],
);

export const organisationInvitations = pgTable(
  "organisation_invitations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    role: userRole("role").default("admin").notNull(),
    token: text("token").notNull(),
    status: invitationStatus("status").default("pending").notNull(),
    invitedBy: text("invited_by").references(() => users.id, { onDelete: "set null" }),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    acceptedAt: timestamp("accepted_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    uniqueIndex("organisation_invitations_token_idx").on(table.token),
    index("organisation_invitations_org_idx").on(table.organisationId),
    index("organisation_invitations_email_idx").on(table.email),
  ],
);

export const sessions = pgTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    token: text("token").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (table) => [uniqueIndex("sessions_token_idx").on(table.token), index("sessions_user_id_idx").on(table.userId)],
);

export const accounts = pgTable(
  "accounts",
  {
    id: text("id").primaryKey(),
    accountId: text("account_id").notNull(),
    providerId: text("provider_id").notNull(),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    accessToken: text("access_token"),
    refreshToken: text("refresh_token"),
    idToken: text("id_token"),
    accessTokenExpiresAt: timestamp("access_token_expires_at", { withTimezone: true }),
    refreshTokenExpiresAt: timestamp("refresh_token_expires_at", { withTimezone: true }),
    scope: text("scope"),
    password: text("password"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("accounts_user_id_idx").on(table.userId)],
);

export const verifications = pgTable(
  "verifications",
  {
    id: text("id").primaryKey(),
    identifier: text("identifier").notNull(),
    value: text("value").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("verifications_identifier_idx").on(table.identifier)],
);

// Storage for BetterAuth's twoFactor plugin. Field shape matches the plugin's
// declared model exactly (see node_modules/better-auth/dist/plugins/two-factor/schema.d.mts).
// The secret column holds the user's TOTP seed encrypted with the BetterAuth
// envelope (symmetricEncrypt + BETTER_AUTH_SECRET); backupCodes is a JSON
// blob of one-time codes encrypted the same way.
export const twoFactors = pgTable(
  "two_factors",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    userId: text("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    secret: text("secret").notNull(),
    backupCodes: text("backup_codes").notNull(),
    verified: boolean("verified").default(true).notNull(),
  },
  (table) => [
    index("two_factors_user_id_idx").on(table.userId),
    index("two_factors_secret_idx").on(table.secret),
  ],
);

export const employees = pgTable(
  "employees",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    email: text("email").notNull(),
    phoneNumber: text("phone_number"),
    firstName: text("first_name").notNull(),
    lastName: text("last_name").notNull(),
    department: text("department"),
    managerEmail: text("manager_email"),
    language: text("language").default("en-AU").notNull(),
    timezone: text("timezone").default("Australia/Sydney").notNull(),
    riskScore: integer("risk_score").default(50).notNull(),
    lastTrainedAt: timestamp("last_trained_at", { withTimezone: true }),
    active: boolean("active").default(true).notNull(),
    excluded: boolean("excluded").default(false).notNull(),
    exclusionReason: text("exclusion_reason"),
    excludedUntil: timestamp("excluded_until", { withTimezone: true }),
    scimExternalId: text("scim_external_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("employees_org_email_idx").on(table.organisationId, table.email),
    index("employees_org_idx").on(table.organisationId),
    uniqueIndex("employees_org_scim_external_id_idx").on(table.organisationId, table.scimExternalId),
  ],
);

export const groups = pgTable(
  "groups",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    scimExternalId: text("scim_external_id"),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("groups_org_name_idx").on(table.organisationId, table.name),
    uniqueIndex("groups_org_scim_external_id_idx").on(table.organisationId, table.scimExternalId),
  ],
);

export const employeeGroups = pgTable(
  "employee_groups",
  {
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    groupId: text("group_id")
      .notNull()
      .references(() => groups.id, { onDelete: "cascade" }),
  },
  (table) => [primaryKey({ columns: [table.employeeId, table.groupId] })],
);

export const trainingModules = pgTable(
  "training_modules",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id").references(() => organisations.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull(),
    durationSeconds: integer("duration_seconds").notNull(),
    contentType: trainingContentType("content_type").notNull(),
    contentUrl: text("content_url"),
    contentHtml: text("content_html"),
    topic: text("topic").notNull(),
    language: text("language").default("en-AU").notNull(),
    quiz: jsonb("quiz").$type<Array<{ question: string; options: string[]; answer: number }>>().default([]),
    ...timestamps,
  },
  (table) => [index("training_modules_org_idx").on(table.organisationId)],
);

export const emailTemplates = pgTable(
  "email_templates",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id").references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    category: templateCategory("category").notNull(),
    deliveryChannel: deliveryChannel("delivery_channel").default("email").notNull(),
    difficulty: integer("difficulty").notNull(),
    subject: text("subject").notNull(),
    fromName: text("from_name").notNull(),
    fromEmailPattern: text("from_email_pattern").notNull(),
    htmlBody: text("html_body").notNull(),
    textBody: text("text_body").notNull(),
    language: text("language").default("en-AU").notNull(),
    region: text("region").default("au").notNull(),
    linkedTrainingModuleId: text("linked_training_module_id").references(() => trainingModules.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [index("email_templates_org_idx").on(table.organisationId)],
);

export const landingPages = pgTable(
  "landing_pages",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id").references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    type: landingPageType("type").notNull(),
    html: text("html").notNull(),
    linkedTrainingModuleId: text("linked_training_module_id").references(() => trainingModules.id, {
      onDelete: "set null",
    }),
    ...timestamps,
  },
  (table) => [index("landing_pages_org_idx").on(table.organisationId)],
);

export const campaigns = pgTable(
  "campaigns",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    status: campaignStatus("status").default("draft").notNull(),
    emailTemplateId: text("email_template_id").references(() => emailTemplates.id, { onDelete: "set null" }),
    landingPageId: text("landing_page_id").references(() => landingPages.id, { onDelete: "set null" }),
    deliveryChannel: deliveryChannel("delivery_channel").default("email").notNull(),
    scenario: text("scenario"),
    targetGroupIds: text("target_group_ids").array().default(sql`ARRAY[]::text[]`).notNull(),
    sendStrategy: sendStrategy("send_strategy").default("immediate").notNull(),
    startAt: timestamp("start_at", { withTimezone: true }),
    endAt: timestamp("end_at", { withTimezone: true }),
    scheduleCron: text("schedule_cron"),
    workingHoursStart: integer("working_hours_start").default(540).notNull(),
    workingHoursEnd: integer("working_hours_end").default(1020).notNull(),
    workingDays: integer("working_days").array().default(sql`ARRAY[1,2,3,4,5]::integer[]`).notNull(),
    respectEmployeeTimezone: boolean("respect_employee_timezone").default(true).notNull(),
    cooldownDays: integer("cooldown_days").default(0).notNull(),
    appliedExclusionRuleIds: text("applied_exclusion_rule_ids")
      .array()
      .default(sql`ARRAY[]::text[]`)
      .notNull(),
    createdBy: text("created_by").references(() => users.id, { onDelete: "set null" }),
    ...timestamps,
  },
  (table) => [index("campaigns_org_idx").on(table.organisationId)],
);

export const campaignVariants = pgTable(
  "campaign_variants",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    templateId: text("template_id")
      .notNull()
      .references(() => emailTemplates.id, { onDelete: "cascade" }),
    weight: integer("weight").default(50).notNull(),
    ...timestamps,
  },
  (table) => [
    index("campaign_variants_campaign_idx").on(table.campaignId),
    uniqueIndex("campaign_variants_campaign_template_idx").on(table.campaignId, table.templateId),
  ],
);

export type ExclusionRuleParameters =
  | { groupId: string }
  | { days: number; sinceField: "createdAt" }
  | { values: string[] }
  | Record<string, unknown>;

export const exclusionRules = pgTable(
  "exclusion_rules",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
    kind: exclusionRuleKind("kind").notNull(),
    parameters: jsonb("parameters").$type<ExclusionRuleParameters>().default({}).notNull(),
    active: boolean("active").default(true).notNull(),
    ...timestamps,
  },
  (table) => [index("exclusion_rules_org_idx").on(table.organisationId)],
);

export const campaignTargets = pgTable(
  "campaign_targets",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    campaignVariantId: text("campaign_variant_id").references(() => campaignVariants.id, { onDelete: "set null" }),
    deliveryChannel: deliveryChannel("delivery_channel").default("email").notNull(),
    uniqueToken: text("unique_token").notNull(),
    scheduledAt: timestamp("scheduled_at", { withTimezone: true }),
    sentAt: timestamp("sent_at", { withTimezone: true }),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    clickedAt: timestamp("clicked_at", { withTimezone: true }),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    reportedAt: timestamp("reported_at", { withTimezone: true }),
    trainingCompletedAt: timestamp("training_completed_at", { withTimezone: true }),
    ...timestamps,
  },
  (table) => [
    uniqueIndex("campaign_targets_token_idx").on(table.uniqueToken),
    uniqueIndex("campaign_targets_campaign_employee_idx").on(table.campaignId, table.employeeId),
    index("campaign_targets_variant_idx").on(table.campaignVariantId),
  ],
);

export const campaignApprovals = pgTable(
  "campaign_approvals",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    approverUserId: text("approver_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    decision: campaignApprovalDecision("decision").notNull(),
    reason: text("reason"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("campaign_approvals_campaign_idx").on(table.campaignId),
    uniqueIndex("campaign_approvals_campaign_approver_idx").on(table.campaignId, table.approverUserId),
  ],
);

export const deepfakeAssets = pgTable(
  "deepfake_assets",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    campaignId: text("campaign_id")
      .notNull()
      .references(() => campaigns.id, { onDelete: "cascade" }),
    executiveName: text("executive_name").notNull(),
    assetUrl: text("asset_url").notNull(),
    watermark: text("watermark").notNull(),
    provenance: jsonb("provenance").$type<Record<string, unknown>>().default({}).notNull(),
    status: deepfakeAssetStatus("status").default("draft").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    ...timestamps,
  },
  (table) => [
    index("deepfake_assets_campaign_idx").on(table.campaignId),
    index("deepfake_assets_expires_idx").on(table.expiresAt),
  ],
);

export const voiceCallAttempts = pgTable(
  "voice_call_attempts",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    campaignTargetId: text("campaign_target_id")
      .notNull()
      .references(() => campaignTargets.id, { onDelete: "cascade" }),
    providerCallSid: text("provider_call_sid"),
    consentCaptured: boolean("consent_captured").default(false).notNull(),
    recordingUrl: text("recording_url"),
    redactedTranscript: text("redacted_transcript"),
    dtmfDigits: text("dtmf_digits"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("voice_call_attempts_target_idx").on(table.campaignTargetId),
    uniqueIndex("voice_call_attempts_provider_sid_idx")
      .on(table.providerCallSid)
      .where(sql`${table.providerCallSid} is not null`),
  ],
);

export const smsOptOuts = pgTable(
  "sms_opt_outs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    phoneNumber: text("phone_number").notNull(),
    keyword: text("keyword").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("sms_opt_outs_org_idx").on(table.organisationId),
    uniqueIndex("sms_opt_outs_org_phone_idx").on(table.organisationId, table.phoneNumber),
  ],
);

export const events = pgTable(
  "events",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    campaignTargetId: text("campaign_target_id")
      .notNull()
      .references(() => campaignTargets.id, { onDelete: "cascade" }),
    eventType: eventType("event_type").notNull(),
    messageId: text("message_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("events_target_idx").on(table.campaignTargetId),
    index("events_type_idx").on(table.eventType),
    uniqueIndex("events_message_id_uidx")
      .on(table.messageId)
      .where(sql`${table.messageId} is not null`),
  ],
);

export type RealMailReportAttachment = {
  name: string;
  size: number;
  sha256: string;
  contentType?: string;
};

export const realMailReports = pgTable(
  "real_mail_reports",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    reporterEmployeeId: text("reporter_employee_id").references(() => employees.id, {
      onDelete: "set null",
    }),
    reporterEmail: text("reporter_email").notNull(),
    subject: text("subject").notNull(),
    sender: text("sender").notNull(),
    headersRaw: text("headers_raw"),
    bodyHash: text("body_hash"),
    bodyPreview: text("body_preview"),
    urls: text("urls").array().default(sql`ARRAY[]::text[]`).notNull(),
    attachmentsMeta: jsonb("attachments_meta")
      .$type<RealMailReportAttachment[]>()
      .default([])
      .notNull(),
    severity: text("severity").default("unknown").notNull(),
    source: text("source").default("addin").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("real_mail_reports_org_idx").on(table.organisationId),
    index("real_mail_reports_reporter_idx").on(table.reporterEmployeeId),
    index("real_mail_reports_created_idx").on(table.createdAt),
  ],
);

export const trainingAssignments = pgTable(
  "training_assignments",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    trainingModuleId: text("training_module_id")
      .notNull()
      .references(() => trainingModules.id, { onDelete: "cascade" }),
    assignedVia: assignmentSource("assigned_via").notNull(),
    assignedAt: timestamp("assigned_at", { withTimezone: true }).defaultNow().notNull(),
    startedAt: timestamp("started_at", { withTimezone: true }),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    quizScore: integer("quiz_score"),
  },
  (table) => [index("training_assignments_employee_idx").on(table.employeeId)],
);

export const riskScoreHistory = pgTable(
  "risk_score_history",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    employeeId: text("employee_id")
      .notNull()
      .references(() => employees.id, { onDelete: "cascade" }),
    score: integer("score").notNull(),
    calculatedAt: timestamp("calculated_at", { withTimezone: true }).defaultNow().notNull(),
    factors: jsonb("factors").$type<Record<string, number | string>>().notNull(),
  },
  (table) => [index("risk_score_history_employee_idx").on(table.employeeId)],
);

export const auditLog = pgTable(
  "audit_log",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    actorUserId: text("actor_user_id").references(() => users.id, { onDelete: "set null" }),
    action: text("action").notNull(),
    resourceType: text("resource_type").notNull(),
    resourceId: text("resource_id"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>().default({}).notNull(),
    ipAddress: text("ip_address"),
    userAgent: text("user_agent"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [
    index("audit_log_org_created_idx").on(table.organisationId, table.createdAt.desc()),
    index("audit_log_resource_idx").on(table.resourceType, table.resourceId),
  ],
);

export const ssoConfigurations = pgTable(
  "sso_configurations",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    kind: ssoKind("kind").notNull(),
    oidcIssuerUrl: text("oidc_issuer_url"),
    oidcClientId: text("oidc_client_id"),
    oidcClientSecretEncrypted: text("oidc_client_secret_encrypted"),
    samlEntityId: text("saml_entity_id"),
    samlAcsUrl: text("saml_acs_url"),
    samlIdpMetadata: text("saml_idp_metadata"),
    enforceSso: boolean("enforce_sso").default(false).notNull(),
    ...timestamps,
  },
  (table) => [uniqueIndex("sso_configurations_org_idx").on(table.organisationId)],
);

export const employeeSyncMode = pgEnum("employee_sync_mode", [
  "single",
  "bulk_incremental",
  "bulk_full",
]);

export const employeeSyncRuns = pgTable(
  "employee_sync_runs",
  {
    id: text("id").primaryKey().default(sql`gen_random_uuid()::text`),
    organisationId: text("organisation_id")
      .notNull()
      .references(() => organisations.id, { onDelete: "cascade" }),
    mode: employeeSyncMode("mode").notNull(),
    source: text("source").default("api").notNull(),
    actorKeyLast4: text("actor_key_last4"),
    receivedCount: integer("received_count").default(0).notNull(),
    addedCount: integer("added_count").default(0).notNull(),
    updatedCount: integer("updated_count").default(0).notNull(),
    deactivatedCount: integer("deactivated_count").default(0).notNull(),
    skippedCount: integer("skipped_count").default(0).notNull(),
    errors: jsonb("errors").$type<Array<{ index?: number; email?: string; reason: string }>>().default([]),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (table) => [index("employee_sync_runs_org_idx").on(table.organisationId, table.createdAt)],
);

export const organisationsRelations = relations(organisations, ({ many }) => ({
  users: many(users),
  employees: many(employees),
  groups: many(groups),
  campaigns: many(campaigns),
  invitations: many(organisationInvitations),
  exclusionRules: many(exclusionRules),
  employeeSyncRuns: many(employeeSyncRuns),
  realMailReports: many(realMailReports),
  smsOptOuts: many(smsOptOuts),
}));

export const exclusionRulesRelations = relations(exclusionRules, ({ one }) => ({
  organisation: one(organisations, {
    fields: [exclusionRules.organisationId],
    references: [organisations.id],
  }),
}));

export const employeeSyncRunsRelations = relations(employeeSyncRuns, ({ one }) => ({
  organisation: one(organisations, {
    fields: [employeeSyncRuns.organisationId],
    references: [organisations.id],
  }),
}));

export const realMailReportsRelations = relations(realMailReports, ({ one }) => ({
  organisation: one(organisations, {
    fields: [realMailReports.organisationId],
    references: [organisations.id],
  }),
  reporter: one(employees, {
    fields: [realMailReports.reporterEmployeeId],
    references: [employees.id],
  }),
}));

export const usersRelations = relations(users, ({ one }) => ({
  organisation: one(organisations, {
    fields: [users.organisationId],
    references: [organisations.id],
  }),
}));

export const organisationInvitationsRelations = relations(organisationInvitations, ({ one }) => ({
  organisation: one(organisations, {
    fields: [organisationInvitations.organisationId],
    references: [organisations.id],
  }),
  inviter: one(users, {
    fields: [organisationInvitations.invitedBy],
    references: [users.id],
  }),
}));

export const employeesRelations = relations(employees, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [employees.organisationId],
    references: [organisations.id],
  }),
  memberships: many(employeeGroups),
  campaignTargets: many(campaignTargets),
  trainingAssignments: many(trainingAssignments),
  realMailReports: many(realMailReports),
}));

export const campaignsRelations = relations(campaigns, ({ one, many }) => ({
  organisation: one(organisations, {
    fields: [campaigns.organisationId],
    references: [organisations.id],
  }),
  template: one(emailTemplates, {
    fields: [campaigns.emailTemplateId],
    references: [emailTemplates.id],
  }),
  landingPage: one(landingPages, {
    fields: [campaigns.landingPageId],
    references: [landingPages.id],
  }),
  variants: many(campaignVariants),
  targets: many(campaignTargets),
  approvals: many(campaignApprovals),
  deepfakeAssets: many(deepfakeAssets),
}));

export const campaignVariantsRelations = relations(campaignVariants, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [campaignVariants.campaignId],
    references: [campaigns.id],
  }),
  template: one(emailTemplates, {
    fields: [campaignVariants.templateId],
    references: [emailTemplates.id],
  }),
  targets: many(campaignTargets),
}));

export const campaignTargetsRelations = relations(campaignTargets, ({ one, many }) => ({
  campaign: one(campaigns, {
    fields: [campaignTargets.campaignId],
    references: [campaigns.id],
  }),
  employee: one(employees, {
    fields: [campaignTargets.employeeId],
    references: [employees.id],
  }),
  variant: one(campaignVariants, {
    fields: [campaignTargets.campaignVariantId],
    references: [campaignVariants.id],
  }),
  events: many(events),
  voiceCallAttempts: many(voiceCallAttempts),
}));
