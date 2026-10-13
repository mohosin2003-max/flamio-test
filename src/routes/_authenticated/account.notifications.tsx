import { Link, createFileRoute } from "@tanstack/react-router";

import { MarkAllReadButton, NotificationList } from "@/components/layout/NotificationList";
import { PushToggle } from "@/components/notifications/PushToggle";
import { Button } from "@/components/ui/button";
import { useNotifications } from "@/hooks/use-notifications";

export const Route = createFileRoute("/_authenticated/account/notifications")({
  head: () => ({
    meta: [
      { title: "Notifications — Flamio" },
      { name: "description", content: "Your Flamio order updates in one place." },
      { property: "og:title", content: "Notifications — Flamio" },
      { property: "og:description", content: "Your Flamio order updates in one place." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: NotificationsPage,
});

function NotificationsPage() {
  const { notifications, unreadCount, isLoading, error, markRead, markAllRead, isPending } =
    useNotifications();

  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-8 pb-28 sm:px-6 sm:py-12">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-3xl font-black sm:text-4xl">Notifications</h1>
        <MarkAllReadButton
          onClick={() => void markAllRead()}
          disabled={isPending || unreadCount === 0}
          pending={isPending}
        />
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        Follow each order live on its order page. Here you&apos;ll find your review reminders and
        messages from Flamio.
      </p>

      <PushToggle className="mt-4" />

      <div className="mt-6 overflow-hidden rounded-2xl border border-border/70 bg-card shadow-card">
        <NotificationList
          notifications={notifications}
          isLoading={isLoading}
          error={error}
          onOpen={(n) => {
            if (!n.isRead) void markRead([n.id]);
          }}
        />
      </div>

      <Button asChild variant="secondary" className="mt-6">
        <Link to="/account/orders">Go to my orders</Link>
      </Button>
    </div>
  );
}
