"use client";

import {
  BarChart3,
  BookOpen,
  ChevronDown,
  FileText,
  Flag,
  LayoutDashboard,
  Mail,
  Menu,
  Settings,
  ShieldCheck,
  ShieldOff,
  Users,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { ReactNode } from "react";

import { CollieLogo } from "@/components/app/collie-logo";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { signOut } from "@/lib/auth/client";
import { cn } from "@/lib/utils";
import { FlashToast } from "@/components/app/flash-toast";

const navItems = [
  { label: "Dashboard", href: "dashboard", icon: LayoutDashboard },
  { label: "Employees", href: "employees", icon: Users },
  { label: "Groups", href: "groups", icon: Users },
  { label: "Campaigns", href: "campaigns", icon: Mail },
  { label: "Exclusions", href: "exclusions", icon: ShieldOff },
  { label: "Templates", href: "templates", icon: FileText },
  { label: "Landing pages", href: "landing-pages", icon: Flag },
  { label: "Training", href: "training", icon: BookOpen },
  { label: "Reports", href: "reports", icon: BarChart3 },
  { label: "Audit", href: "audit", icon: ShieldCheck },
  { label: "Settings", href: "settings", icon: Settings },
];

function SidebarNav({ orgSlug }: { orgSlug: string }) {
  const pathname = usePathname();

  return (
    <nav className="flex flex-1 flex-col gap-1 px-3 py-4">
      {navItems.map((item) => {
        const Icon = item.icon;
        const href = `/${orgSlug}/${item.href}`;
        const active = pathname === href || pathname.startsWith(`${href}/`);

        return (
          <Link
            key={item.href}
            href={href}
            className={cn(
              "flex h-9 items-center gap-3 rounded-lg px-3 text-sm font-medium text-sidebar-foreground/68 transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              active && "border border-sidebar-border bg-sidebar-accent text-sidebar-accent-foreground",
            )}
          >
            <Icon className="size-4" aria-hidden="true" />
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}

export function AppShell({
  orgSlug,
  children,
}: {
  orgSlug: string;
  children: ReactNode;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const organisationName = orgSlug
    .split("-")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  const activeItem =
    navItems.find((item) => {
      const href = `/${orgSlug}/${item.href}`;
      return pathname === href || pathname.startsWith(`${href}/`);
    }) ?? navItems[0];

  return (
    <div className="min-h-dvh bg-background lg:grid lg:grid-cols-[16rem_minmax(0,1fr)]">
      <FlashToast />
      <aside className="hidden border-r border-sidebar-border bg-sidebar lg:block">
        <div className="sticky top-0 flex h-dvh flex-col">
          <div className="flex h-16 items-center border-b border-sidebar-border px-5">
            <CollieLogo variant="dark" />
          </div>
          <div className="px-5 py-4">
            <div className="rounded-lg border border-sidebar-border bg-[rgb(252_253_255_/_0.07)] px-3 py-3 text-sidebar-foreground">
              <p className="truncate text-sm font-medium">{organisationName || "Organisation"}</p>
            </div>
          </div>
          <SidebarNav orgSlug={orgSlug} />
        </div>
      </aside>

      <div className="min-w-0">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b bg-[rgb(242_246_250_/_0.94)] px-4 backdrop-blur supports-[backdrop-filter]:bg-[rgb(242_246_250_/_0.84)] sm:px-6">
          <div className="flex items-center gap-3">
            <Sheet>
              <SheetTrigger
                render={
                  <Button variant="ghost" size="icon" className="lg:hidden" aria-label="Open navigation" />
                }
              >
                <Menu className="size-5" />
              </SheetTrigger>
              <SheetContent side="left" className="w-72 border-sidebar-border bg-sidebar p-0 text-sidebar-foreground">
                <div className="flex h-16 items-center border-b border-sidebar-border px-5">
                  <CollieLogo variant="dark" />
                </div>
                <div className="px-5 py-4">
                  <div className="rounded-lg border border-sidebar-border bg-[rgb(252_253_255_/_0.07)] px-3 py-3 text-sidebar-foreground">
                    <p className="truncate text-sm font-medium">{organisationName || "Organisation"}</p>
                  </div>
                </div>
                <SidebarNav orgSlug={orgSlug} />
              </SheetContent>
            </Sheet>
            <div>
              <p className="text-sm font-medium">{activeItem.label}</p>
              <p className="text-xs text-muted-foreground">{organisationName || "Organisation"}</p>
            </div>
          </div>

          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="ghost" className="gap-2 px-2" />}>
              <Avatar className="size-8">
                <AvatarFallback>JM</AvatarFallback>
              </Avatar>
              <span className="hidden text-sm font-medium sm:inline">Admin</span>
              <ChevronDown className="size-4 text-muted-foreground" />
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="w-56">
              <DropdownMenuItem
                onClick={async () => {
                  await signOut();
                  router.push("/signin");
                  router.refresh();
                }}
              >
                Sign out
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </header>

        <main className="px-4 py-7 sm:px-6 lg:px-8">{children}</main>
      </div>
    </div>
  );
}
