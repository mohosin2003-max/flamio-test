import { Link } from "@tanstack/react-router";
import { Bell } from "lucide-react";
import { useState } from "react";

import { MarkAllReadButton, NotificationList } from "@/components/layout/NotificationList";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { useNotifications } from "@/hooks/use-notifications";

/** In-app order notifications for the signed-in customer. */
export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const { notifications, unreadCount, isLoading, error, markRead, markAllRead, isPending } =
    useNotifications();

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          className="relative"
          aria-label={
            unreadCount > 0 ? `Notifications, ${unreadCount} unread` : "Notifications"
          }
        >
          <Bell aria-hidden="true" />
          {unreadCount > 0 && (
            <span className="absolute -right-0.5 -top-0.5 grid min-w-4 place-items-center rounded-full bg-gradient-ember px-1 text-[10px] font-bold leading-4 text-primary-foreground">
              {unreadCount > 9 ? "9+" : unreadCount}
            </span>
          )}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        align="end"
        sideOffset={8}
        className="w-[min(22rem,calc(100vw-1.5rem))] overflow-hidden p-0"
      >
        <div className="flex items-center justify-between gap-3 border-b border-border/70 px-4 py-3">
          <h2 className="font-display text-sm font-extrabold">Notifications</h2>
          <MarkAllReadButton
            onClick={() => void markAllRead()}
            disabled={isPending || unreadCount === 0}
            pending={isPending}
          />
        </div>

        <div className="max-h-[65vh] overflow-y-auto overscroll-contain">
          <NotificationList
            notifications={notifications.slice(0, 12)}
            isLoading={isLoading}
            error={error}
            onOpen={(n) => {
              if (!n.isRead) void markRead([n.id]);
            }}
            onAfterNavigate={() => setOpen(false)}
          />
        </div>

        <div className="border-t border-border/70 px-4 py-2.5">
          <Link
            to="/account/notifications"
            onClick={() => setOpen(false)}
            className="text-xs font-semibold text-primary underline-offset-4 hover:underline"
          >
            View all notifications
          </Link>
        </div>
      </PopoverContent>
    </Popover>
  );
}
