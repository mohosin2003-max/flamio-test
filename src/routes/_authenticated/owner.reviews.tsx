import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useState } from "react";
import { toast } from "sonner";

import { StarRating } from "@/components/reviews/StarRating";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import {
  ownerDeleteReview,
  ownerListReviews,
  ownerSetReviewStatus,
  type OwnerReview,
} from "@/lib/reviews.functions";
import { cn } from "@/lib/utils";

export const Route = createFileRoute("/_authenticated/owner/reviews")({
  head: () => ({
    meta: [
      { title: "Customer Review Moderation — Flamio Owner" },
      {
        name: "description",
        content: "Review and moderate Flamio customer feedback before it appears publicly.",
      },
      { property: "og:title", content: "Customer Review Moderation — Flamio Owner" },
      {
        property: "og:description",
        content: "Owner tools for approving, hiding, and removing Flamio customer reviews.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerReviews,
});

type Tab = "pending" | "approved" | "hidden";

const TABS: { key: Tab; label: string }[] = [
  { key: "pending", label: "Waiting for approval" },
  { key: "approved", label: "Published" },
  { key: "hidden", label: "Hidden" },
];

function OwnerReviews() {
  const list = useServerFn(ownerListReviews);
  const setStatus = useServerFn(ownerSetReviewStatus);
  const remove = useServerFn(ownerDeleteReview);
  const queryClient = useQueryClient();
  const [tab, setTab] = useState<Tab>("pending");
  const [busyId, setBusyId] = useState<string | null>(null);

  const reviews = useQuery({
    queryKey: ["owner-reviews"],
    queryFn: () => list(),
    staleTime: 15 * 1000,
  });

  const rows: OwnerReview[] = reviews.data ?? [];
  const shown = rows.filter((review) => review.status === tab);

  async function run(id: string, action: () => Promise<unknown>, message: string) {
    setBusyId(id);
    try {
      await action();
      await queryClient.invalidateQueries({ queryKey: ["owner-reviews"] });
      toast.success(message);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "That didn't work. Please try again.");
    } finally {
      setBusyId(null);
    }
  }

  if (reviews.isLoading) return <Skeleton className="h-72 w-full" />;

  if (reviews.error) {
    return (
      <EmptyState
        title="Couldn't load reviews"
        description="Please try again."
        action={<Button onClick={() => void reviews.refetch()}>Retry</Button>}
      />
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="font-display text-2xl font-black">Customer reviews</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Only published reviews are visible to customers. Reviews can be collected or paused from
          Settings.
        </p>
      </div>

      <div className="flex flex-wrap gap-2">
        {TABS.map((entry) => {
          const count = rows.filter((review) => review.status === entry.key).length;
          return (
            <button
              key={entry.key}
              type="button"
              onClick={() => setTab(entry.key)}
              className={cn(
                "rounded-full border px-4 py-1.5 text-sm font-semibold transition-smooth",
                tab === entry.key
                  ? "border-primary bg-primary text-primary-foreground"
                  : "border-border bg-card text-muted-foreground hover:text-foreground",
              )}
            >
              {entry.label} ({count})
            </button>
          );
        })}
      </div>

      {shown.length === 0 ? (
        <EmptyState title="Nothing here yet" description="No reviews in this list." />
      ) : (
        <ul className="space-y-3">
          {shown.map((review) => (
            <li key={review.id}>
              <Card>
                <CardContent className="space-y-3 p-4">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div>
                      <p className="font-semibold">{review.customerName}</p>
                      <p className="text-xs text-muted-foreground">
                        {review.verifiedOrder ? `Order ${review.orderCode}` : "General review"}
                        {review.productName ? ` — ${review.productName}` : review.verifiedOrder ? " — whole order" : ""} ·{" "}
                        {new Date(review.createdAt).toLocaleString()}
                      </p>
                    </div>
                    <StarRating value={review.rating} />
                  </div>

                  {review.comment ? <p className="text-sm">{review.comment}</p> : null}

                  {review.photoUrl ? (
                    <div className="flex flex-wrap gap-3">
                      <img
                        src={review.photoUrl}
                        alt={`Photo shared by ${review.customerName}`}
                        className="size-32 rounded-2xl border border-border/70 object-cover"
                      />
                    </div>
                  ) : null}


                  <div className="flex flex-wrap gap-2">
                    {review.status !== "approved" && (
                      <Button
                        size="sm"
                        disabled={busyId === review.id}
                        onClick={() =>
                          void run(
                            review.id,
                            () => setStatus({ data: { id: review.id, status: "approved" } }),
                            "Review published",
                          )
                        }
                      >
                        Publish
                      </Button>
                    )}
                    {review.status !== "hidden" && (
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={busyId === review.id}
                        onClick={() =>
                          void run(
                            review.id,
                            () => setStatus({ data: { id: review.id, status: "hidden" } }),
                            "Review hidden",
                          )
                        }
                      >
                        Hide
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="ghost"
                      className="text-destructive"
                      disabled={busyId === review.id}
                      onClick={() => {
                        if (!window.confirm("Remove this review permanently?")) return;
                        void run(
                          review.id,
                          () => remove({ data: { id: review.id } }),
                          "Review removed",
                        );
                      }}
                    >
                      Remove
                    </Button>
                  </div>
                </CardContent>
              </Card>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
