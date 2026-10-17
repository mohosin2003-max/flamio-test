import type { ErrorComponentProps } from "@tanstack/react-router";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  Outlet,
  Link,
  createRootRouteWithContext,
  useNavigate,
  useRouter,
  useRouterState,
  HeadContent,
  Scripts,
} from "@tanstack/react-router";
import { useEffect, useState, type ReactNode } from "react";

import appCss from "../styles.css?url";
import { reportLovableError } from "../lib/lovable-error-reporting";
import { BrandingRuntimeHead } from "@/components/branding/BrandingRuntimeHead";
import { SiteFooter } from "@/components/layout/SiteFooter";
import { SiteHeader } from "@/components/layout/SiteHeader";
import { FloatingCartBar, FloatingCartSpacer } from "@/components/cart/FloatingCartBar";
import { BottomNav, BottomNavSpacer } from "@/components/layout/BottomNav";
import { StaffBottomNav, StaffBottomNavSpacer } from "@/components/layout/StaffBottomNav";
import { Toaster } from "@/components/ui/sonner";
import { CartProvider } from "@/context/cart";
import { useAuth } from "@/hooks/use-auth";
import { readAccessHint, useDashboardAccess, writeAccessHint } from "@/hooks/use-dashboard-access";

function NotFoundComponent() {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-7xl font-bold text-foreground">404</h1>
        <h2 className="mt-4 text-xl font-semibold text-foreground">Page not found</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          The page you're looking for doesn't exist or has been moved.
        </p>
        <div className="mt-6">
          <Link
            to="/"
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Go home
          </Link>
        </div>
      </div>
    </div>
  );
}

function ErrorComponent({ error, reset }: ErrorComponentProps) {
  console.error(error);
  const router = useRouter();
  useEffect(() => {
    const message = String((error as Error | undefined)?.message ?? error ?? "");
    if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) {
      const KEY = "flamio-chunk-reload";
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last > 10_000) {
        sessionStorage.setItem(KEY, String(Date.now()));
        window.location.reload();
        return;
      }
    }
    reportLovableError(error, { boundary: "tanstack_root_error_component" });
  }, [error]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-semibold tracking-tight text-foreground">
          This page didn't load
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Something went wrong on our end. You can try refreshing or head back home.
        </p>
        <div className="mt-6 flex flex-wrap justify-center gap-2">
          <button
            onClick={() => {
              router.invalidate();
              reset();
            }}
            className="inline-flex items-center justify-center rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/90"
          >
            Try again
          </button>
          <a
            href="/"
            className="inline-flex items-center justify-center rounded-md border border-input bg-background px-4 py-2 text-sm font-medium text-foreground transition-colors hover:bg-accent"
          >
            Go home
          </a>
        </div>
      </div>
    </div>
  );
}

export const Route = createRootRouteWithContext<{ queryClient: QueryClient }>()({
  head: () => ({
    meta: [
      { charSet: "utf-8" },
      { name: "viewport", content: "width=device-width, initial-scale=1" },
      { title: "Flamio" },
      { name: "description", content: "Flame-grilled food from Flamio in Kishoreganj." },
      { name: "author", content: "Flamio" },
      { name: "theme-color", content: "#1a1410", media: "(prefers-color-scheme: dark)" },
      { name: "theme-color", content: "#fbfaf8", media: "(prefers-color-scheme: light)" },
      { name: "color-scheme", content: "light dark" },
      { name: "apple-mobile-web-app-capable", content: "yes" },
      { name: "apple-mobile-web-app-status-bar-style", content: "black-translucent" },
      { name: "apple-mobile-web-app-title", content: "Flamio" },
      { property: "og:title", content: "Flamio" },
      { property: "og:description", content: "Flame-grilled food from Flamio in Kishoreganj." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
    links: [
      {
        rel: "stylesheet",
        href: appCss,
      },
      { rel: "icon", href: "/favicon.png?v=20261009", type: "image/png" },
      { rel: "apple-touch-icon", href: "/apple-touch-icon.png?v=20261009" },
      { rel: "manifest", href: "/site.webmanifest" },
    ],
    scripts: [
      {
        // Chrome offers installation once per page load, often before the app
        // becomes interactive. Save it early; InstallAppBanner consumes it.
        children:
          "(function(){if(window.__flamioInstallListener)return;window.__flamioInstallListener=true;window.__flamioInstallPrompt=null;" +
          "window.addEventListener('beforeinstallprompt',function(e){e.preventDefault();window.__flamioInstallPrompt=e;window.dispatchEvent(new Event('flamio:installprompt'));});" +
          "window.addEventListener('appinstalled',function(){window.__flamioInstallPrompt=null;});})();",
      },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
  notFoundComponent: NotFoundComponent,
  errorComponent: ErrorComponent,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <head>
        <HeadContent />
      </head>
      <body>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

function RootComponent() {
  const { queryClient } = Route.useRouteContext();

  // After a new version is published, an already-open tab may request old page
  // files that no longer exist. Reload once to pick up the current version.
  useEffect(() => {
    const KEY = "flamio-chunk-reload";
    const reloadOnce = () => {
      const last = Number(sessionStorage.getItem(KEY) || 0);
      if (Date.now() - last < 10_000) return;
      sessionStorage.setItem(KEY, String(Date.now()));
      window.location.reload();
    };
    const onPreloadError = (event: Event) => {
      event.preventDefault();
      reloadOnce();
    };
    const onRejection = (event: PromiseRejectionEvent) => {
      const message = String((event.reason as Error | undefined)?.message ?? event.reason ?? "");
      if (/Failed to fetch dynamically imported module|Importing a module script failed|error loading dynamically imported module/i.test(message)) {
        reloadOnce();
      }
    };
    window.addEventListener("vite:preloadError", onPreloadError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("vite:preloadError", onPreloadError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);


  return (
    <QueryClientProvider client={queryClient}>
      <CartProvider>
        <BrandingRuntimeHead />
        <AppExperience />
        <Toaster position="top-center" />
      </CartProvider>
    </QueryClientProvider>
  );
}

const CUSTOMER_PATHS = ["/", "/menu", "/combos", "/offers", "/contact", "/account", "/cart", "/checkout", "/order", "/track"];

function AppExperience() {
  const pathname = useRouterState({ select: (state) => state.location.pathname });
  const navigate = useNavigate();
  const { isAuthenticated, loading, user } = useAuth();
  const access = useDashboardAccess(isAuthenticated && !loading);
  const workspace = pathname === "/owner" || pathname.startsWith("/owner/") || pathname === "/kitchen";
  const serverStaff = Boolean(access.data?.isManager || access.data?.isStaff);
  const [hint, setHint] = useState<boolean | null>(null);
  useEffect(() => setHint(readAccessHint(user?.id)), [user?.id]);
  // While the server check runs, the device hint picks the first screen only.
  const staffAccount = access.isLoading ? hint === true : serverStaff;
  const customerSurface = CUSTOMER_PATHS.some((path) => path === "/" ? pathname === "/" : pathname === path || pathname.startsWith(`${path}/`));

  useEffect(() => {
    if (user?.id && access.isSuccess) {
      writeAccessHint(user.id, serverStaff);
      setHint(serverStaff);
    }
  }, [access.isSuccess, serverStaff, user?.id]);

  useEffect(() => {
    if (!loading && isAuthenticated && staffAccount && customerSurface) {
      void navigate({ to: "/owner", replace: true });
    }
  }, [customerSurface, isAuthenticated, loading, navigate, staffAccount]);

  const awaitingUnknown = access.isLoading && hint === null;
  if (!workspace && isAuthenticated && customerSurface && (awaitingUnknown || staffAccount)) {
    return <div className="min-h-screen bg-background" />;
  }

  if (workspace) {
    return (
      <div className="flex min-h-screen flex-col">
        <main className="flex-1"><Outlet /></main>
        <StaffBottomNavSpacer />
        <Suspense fallback={null}><StaffBottomNav /></Suspense>
      </div>
    );
  }

  return (
    <>
      <div className="flex min-h-screen flex-col">
        <SiteHeader />
        <main className="flex-1"><Outlet /></main>
        <FloatingCartSpacer />
        <SiteFooter />
        <BottomNavSpacer />
      </div>
      <FloatingCartBar />
      <BottomNav />
    </>
  );
}
