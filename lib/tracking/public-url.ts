export function publicAppUrl() {
  return (process.env.NEXT_PUBLIC_APP_URL || process.env.BETTER_AUTH_URL || "http://localhost:3000").replace(/\/$/, "");
}

export function trackingUrlWarning() {
  const url = publicAppUrl();

  if (/^https?:\/\/(localhost|127\.0\.0\.1|0\.0\.0\.0)(:\d+)?/i.test(url)) {
    return "Tracking URLs are using localhost. Webmail providers cannot fetch open pixels from your machine, so Gmail/Outlook opens will not record until NEXT_PUBLIC_APP_URL is a public HTTPS URL.";
  }

  if (!url.startsWith("https://")) {
    return "Tracking URLs are not using HTTPS. Some mail clients will block images or rewrite links unless NEXT_PUBLIC_APP_URL is public HTTPS.";
  }

  return null;
}
