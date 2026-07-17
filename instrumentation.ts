export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { startCronJobs } = await import("./lib/cron");
  startCronJobs();

  // Warm the SSO config cache so the first OIDC sign-in does not hit a cold
  // lookup. Failures are non-fatal — the cache lazily reloads on demand.
  const { ensureSsoCacheLoaded } = await import("./lib/auth/sso");
  await ensureSsoCacheLoaded().catch((error) => {
    console.error("Failed to warm SSO cache during instrumentation", error);
  });

  // Seal any plaintext Resend API keys carried over from before AES-GCM at-rest
  // encryption shipped. Idempotent — rows already sealed are skipped.
  const { backfillSealedResendKeys } = await import("./lib/auth/secret-backfill");
  await backfillSealedResendKeys().catch((error) => {
    console.error("Failed to backfill sealed resend keys during instrumentation", error);
  });
}
