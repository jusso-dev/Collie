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
}
