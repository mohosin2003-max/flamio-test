import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { useAuth } from "@/hooks/use-auth";
import { listFavorites, toggleFavorite } from "@/lib/customer.functions";

/** Favorites for the signed-in customer; database-backed and RLS-protected. */
export function useFavorites() {
  const { isAuthenticated } = useAuth();
  const queryClient = useQueryClient();
  const fetchFavorites = useServerFn(listFavorites);
  const toggle = useServerFn(toggleFavorite);

  const query = useQuery({
    queryKey: ["customer", "favorites"],
    queryFn: () => fetchFavorites(),
    enabled: isAuthenticated,
  });

  const mutation = useMutation({
    mutationFn: (input: { productId: string; productSlug: string; favorite: boolean }) =>
      toggle({ data: input }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ["customer", "favorites"] });
    },
  });

  const ids = new Set((query.data ?? []).map((f) => f.productId));

  return {
    favorites: query.data ?? [],
    isLoading: isAuthenticated && query.isLoading,
    error: query.error instanceof Error ? query.error.message : null,
    isAuthenticated,
    isFavorite: (productId: string) => ids.has(productId),
    isPending: mutation.isPending,
    toggle: (productId: string, productSlug: string) =>
      mutation.mutateAsync({ productId, productSlug, favorite: !ids.has(productId) }),
  };
}
