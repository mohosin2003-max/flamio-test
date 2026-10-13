import { Outlet, createFileRoute } from "@tanstack/react-router";

export const Route = createFileRoute("/_authenticated/owner/orders")({
  head: () => ({
    meta: [
      { title: "Orders Workspace — Flamio" },
      { name: "description", content: "Manage Flamio order workflow and order details." },
      { property: "og:title", content: "Orders Workspace — Flamio" },
      { property: "og:description", content: "Manage Flamio order workflow and order details." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  validateSearch: (search: Record<string, unknown>): { order?: string; date?: string; activeOnline?: boolean } => {
    const parsed: { order?: string; date?: string; activeOnline?: boolean } = {};
    if (typeof search["order"] === "string") parsed.order = search["order"];
    if (typeof search["date"] === "string") parsed.date = search["date"];
    if (search["activeOnline"] === true || search["activeOnline"] === "true") parsed.activeOnline = true;
    return parsed;
  },
  component: () => <Outlet />,
});
