import { useQuery } from "@tanstack/react-query";
import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft, Camera, Loader2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { StarPicker } from "@/components/reviews/StarRating";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { EmptyState } from "@/components/ui/states";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { getOrderReview, getReviewSettings, submitReview } from "@/lib/reviews.functions";

export const Route = createFileRoute("/_authenticated/account/review/$orderId")({
  head: () => ({
    meta: [
      { title: "Rate your order — Flamio" },
      {
        name: "description",
        content: "Share how your Flamio order was: rate it, write a few words and add a food photo.",
      },
      { property: "og:title", content: "Rate your order — Flamio" },
      { property: "og:description", content: "Rate your Flamio order and share your feedback." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: ReviewOrderPage,
});

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

function ReviewOrderPage() {
  const { orderId } = Route.useParams();
  const navigate = useNavigate();
  const fetchReview = useServerFn(getOrderReview);
  const fetchSettings = useServerFn(getReviewSettings);
  const save = useServerFn(submitReview);

  const photoRef = useRef<HTMLInputElement>(null);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [productId, setProductId] = useState<string | null>(null);
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);

  const settingsQuery = useQuery({
    queryKey: ["review-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 60 * 1000,
  });

  const reviewQuery = useQuery({
    queryKey: ["order-review", orderId],
    queryFn: () => fetchReview({ data: { orderId } }),
  });

  const order = reviewQuery.data?.order ?? null;
  const existing = reviewQuery.data?.review ?? null;

  useEffect(() => {
    if (!reviewQuery.data || hydrated) return;
    if (existing) {
      setRating(existing.rating);
      setComment(existing.comment ?? "");
      setProductId(existing.productId);
      setPhotoPath(existing.photoPath);
      setPhotoPreview(existing.photoUrl);
    } else if (order && order.items.length === 1) {
      const onlyItem = order.items[0];
      if (onlyItem) setProductId(onlyItem.productId);
    }
    setHydrated(true);
  }, [reviewQuery.data, existing, order, hydrated]);

  useEffect(() => {
    return () => {
      if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  if (reviewQuery.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (!order) {
    return (
      <EmptyState
        title="We couldn't find that order"
        description="It may belong to another account."
        action={
          <Button asChild>
            <Link to="/account/orders">Back to my orders</Link>
          </Button>
        }
      />
    );
  }

  if (settingsQuery.data && !settingsQuery.data.reviewsEnabled) {
    return (
      <EmptyState
        title="Reviews are turned off"
        description="Feedback isn't being collected right now. Thanks for wanting to share!"
        action={
          <Button asChild>
            <Link to="/account/orders">Back to my orders</Link>
          </Button>
        }
      />
    );
  }

  if (order.status !== "completed") {
    return (
      <EmptyState
        title="This order isn't finished yet"
        description="You can rate it as soon as the order is completed."
        action={
          <Button asChild>
            <Link to="/order/$orderId" params={{ orderId }}>
              Track this order
            </Link>
          </Button>
        }
      />
    );
  }

  const photosAllowed = settingsQuery.data?.photosEnabled !== false;

  async function handlePhoto(file: File | undefined) {
    if (!file || uploading) return;
    const extension = IMAGE_EXTENSIONS[file.type];
    if (!extension) {
      toast.error("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }

    setUploading(true);
    try {
      const { data: auth } = await supabase.auth.getUser();
      const uid = auth.user?.id;
      if (!uid) throw new Error("no session");
      const path = `${uid}/${crypto.randomUUID()}.${extension}`;
      const { error } = await supabase.storage
        .from("review-photos")
        .upload(path, file, { contentType: file.type, upsert: false });
      if (error) throw error;
      const preview = URL.createObjectURL(file);
      if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
      setPhotoPath(path);
      setPhotoPreview(preview);
      toast.success("Photo added");
    } catch {
      toast.error("We couldn't add that photo. Please try again.");
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (rating < 1) {
      toast.error("Please choose a star rating.");
      return;
    }
    setSaving(true);
    try {
      await save({
        data: {
          orderId,
          productId,
          rating,
          comment: comment.trim().length > 0 ? comment.trim() : null,
          photoPath: photosAllowed ? photoPath : null,
        },
      });
      toast.success("Thanks for your feedback! ❤️");
      await navigate({ to: "/account/orders" });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn't save your review.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      <Link
        to="/account/orders"
        className="inline-flex items-center gap-2 text-sm text-muted-foreground transition-smooth hover:text-foreground"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        Back to my orders
      </Link>

      <div>
        <h1 className="font-display text-2xl font-black sm:text-3xl">
          How was your Flamio order? ❤️
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Order {order.code} — rate your experience and share your feedback. Reviewing is optional.
        </p>
      </div>

      <Card>
        <CardContent className="p-4">
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label>Your rating</Label>
              <StarPicker value={rating} onChange={setRating} disabled={saving} />
            </div>

            {order.items.length > 1 && (
              <div className="space-y-2">
                <Label htmlFor="review-product">Which dish is this about? (optional)</Label>
                <select
                  id="review-product"
                  value={productId ?? ""}
                  onChange={(e) => setProductId(e.target.value || null)}
                  className="h-11 w-full rounded-lg border border-border bg-background px-3 text-sm"
                >
                  <option value="">The whole order</option>
                  {order.items.map((item) => (
                    <option key={item.productId} value={item.productId}>
                      {item.productName}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div className="space-y-2">
              <Label htmlFor="review-comment">Your review (optional)</Label>
              <Textarea
                id="review-comment"
                rows={4}
                maxLength={1000}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="Tell us what you loved, or what we can do better."
              />
            </div>

            {photosAllowed && (
              <div className="space-y-2">
                <Label>Food photo (optional)</Label>
                <div className="flex flex-wrap items-center gap-3">
                  {photoPreview ? (
                    <MediaPreview onRemove={() => { setPhotoPath(null); setPhotoPreview(null); }} label="Remove photo">
                      <img src={photoPreview} alt="Your review photo" className="size-full object-cover" />
                    </MediaPreview>
                  ) : null}
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(e) => void handlePhoto(e.target.files?.[0])}
                  />
                  <Button
                    type="button"
                    variant="outline"
                    disabled={uploading}
                    onClick={() => photoRef.current?.click()}
                  >
                    {uploading ? (
                      <Loader2 aria-hidden="true" className="size-4 animate-spin" />
                    ) : (
                      <Camera aria-hidden="true" className="size-4" />
                    )}
                    {photoPreview ? "Change photo" : "Add a photo"}
                  </Button>
                </div>
                <p className="text-xs text-muted-foreground">JPG, PNG or WebP, up to 5 MB.</p>
              </div>
            )}

            <Button type="submit" size="lg" className="w-full" disabled={saving || uploading}>
              {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
              {existing ? "Update my review" : "Send my review"}
            </Button>
            {existing ? (
              <p className="text-center text-xs text-muted-foreground">
                You already reviewed this order. Saving again replaces it and sends it for approval.
              </p>
            ) : null}
          </form>
        </CardContent>
      </Card>
    </div>
  );
}

function MediaPreview({ children, label, onRemove }: { children: React.ReactNode; label: string; onRemove: () => void }) {
  return (
    <span className="relative block size-20 overflow-hidden rounded-2xl border border-border/70 bg-secondary">
      {children}
      <Button
        type="button"
        size="icon"
        variant="secondary"
        aria-label={label}
        className="absolute right-1 top-1 size-7"
        onClick={onRemove}
      >
        <X aria-hidden="true" className="size-3" />
      </Button>
    </span>
  );
}
