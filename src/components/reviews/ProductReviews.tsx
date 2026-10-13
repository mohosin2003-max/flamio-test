import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";

import { StarRating } from "@/components/reviews/StarRating";
import { listProductReviews } from "@/lib/reviews.functions";

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

/**
 * Approved customer reviews for one dish. Renders nothing at all when there
 * are no real reviews — no placeholder ratings or invented counts.
 */
export function ProductReviews({ productId }: { productId: string }) {
  const fetchReviews = useServerFn(listProductReviews);

  const query = useQuery({
    queryKey: ["product-reviews", productId],
    queryFn: () => fetchReviews({ data: { productId } }),
    staleTime: 60 * 1000,
  });

  const summary = query.data;
  if (!summary || summary.count === 0) return null;

  const photos = summary.reviews.filter((review) => review.photoUrl);

  return (
    <section className="mt-10" aria-labelledby="product-reviews-heading">
      <div className="flex flex-wrap items-center gap-3">
        <h2 id="product-reviews-heading" className="font-display text-2xl font-black">
          Customer reviews
        </h2>
        <span className="inline-flex items-center gap-2 rounded-full border border-border/70 bg-card px-3 py-1 text-sm">
          <StarRating value={summary.average} />
          <span className="font-semibold">{summary.average.toFixed(1)}</span>
          <span className="text-muted-foreground">
            ({summary.count} review{summary.count > 1 ? "s" : ""})
          </span>
        </span>
      </div>

      {photos.length > 0 && (
        <ul className="mt-4 flex gap-3 overflow-x-auto pb-2">
          {photos.map((review) => (
            <li key={`photo-${review.id}`} className="shrink-0">
              <img
                src={review.photoUrl ?? undefined}
                alt={`Food photo shared by ${review.reviewerName}`}
                loading="lazy"
                className="size-28 rounded-2xl border border-border/70 object-cover sm:size-32"
              />
            </li>
          ))}
        </ul>
      )}

      <ul className="mt-4 space-y-3">
        {summary.reviews.map((review) => (
          <li
            key={review.id}
            className="rounded-2xl border border-border/70 bg-card p-4 shadow-card"
          >
            <div className="flex items-center justify-between gap-3">
              <p className="font-semibold">{review.reviewerName}</p>
              <span className="text-xs text-muted-foreground">{formatDate(review.createdAt)}</span>
            </div>
            <StarRating value={review.rating} className="mt-1" />
            {review.comment ? (
              <p className="mt-2 text-sm text-muted-foreground">{review.comment}</p>
            ) : null}
          </li>
        ))}
      </ul>
    </section>
  );
}
