export function pathWithToast(path: string, toast: string) {
  if (!path.startsWith("/") || path.startsWith("//")) {
    throw new Error("Toast redirect path must be app-relative.");
  }

  const [pathname, query = ""] = path.split("?");
  const params = new URLSearchParams(query);
  params.set("toast", toast);
  const nextQuery = params.toString();

  return nextQuery ? `${pathname}?${nextQuery}` : pathname;
}
