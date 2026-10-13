import { Star } from "lucide-react";

import { cn } from "@/lib/utils";

/** Read-only star row used by the food page and the owner review list. */
export function StarRating({ value, className }: { value: number; className?: string }) {
  return (
    <span className={cn("inline-flex items-center gap-0.5", className)} aria-label={`${value} out of 5`}>
      {[1, 2, 3, 4, 5].map((star) => (
        <Star
          key={star}
          aria-hidden="true"
          className={cn(
            "size-4",
            star <= Math.round(value) ? "fill-primary text-primary" : "text-muted-foreground/40",
          )}
        />
      ))}
    </span>
  );
}

/** Tappable star row for the review form. */
export function StarPicker({
  value,
  onChange,
  disabled,
}: {
  value: number;
  onChange: (value: number) => void;
  disabled?: boolean;
}) {
  return (
    <div className="flex items-center gap-1" role="radiogroup" aria-label="Your rating">
      {[1, 2, 3, 4, 5].map((star) => (
        <button
          key={star}
          type="button"
          role="radio"
          aria-checked={value === star}
          aria-label={`${star} star${star > 1 ? "s" : ""}`}
          disabled={disabled}
          onClick={() => onChange(star)}
          className="rounded-full p-1 transition-smooth active:scale-95 disabled:opacity-50"
        >
          <Star
            aria-hidden="true"
            className={cn(
              "size-8",
              star <= value ? "fill-primary text-primary" : "text-muted-foreground/40",
            )}
          />
        </button>
      ))}
    </div>
  );
}
