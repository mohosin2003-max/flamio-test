import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/hooks/use-auth";
import { listNotifications, markNotificationsRead } from "@/lib/customer.functions";

/**
 * In-app notifications generated from real order events by the database.
 * Nothing is fabricated client-side.
 */
export function useNotifications() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const fetchNotifications = useServerFn(listNotifications);
  const markRead = useServerFn(markNotificationsRead);

  const query = useQuery({
    queryKey: ["customer", "notifications"],
    queryFn: () => fetchNotifications(),
    enabled: isAuthenticated,
    refetchInterval: isAuthenticated ? 60_000 : false,
  });

  const mutation = useMutation({
    mutationFn: (ids: string[] | null) => markRead({ data: { ids } }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", "notifications"] });
    },
  });

  const notifications = query.data ?? [];

  return {
    notifications,
    unreadCount: notifications.filter((n) => !n.isRead).length,
    isLoading: isAuthenticated && query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    markRead: (ids: string[]) => mutation.mutateAsync(ids),
    markAllRead: () => mutation.mutateAsync(null),
    isPending: mutation.isPending,
  };
}
