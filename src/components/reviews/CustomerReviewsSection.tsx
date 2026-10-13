import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Camera, CheckCircle2, Loader2, LogIn, UserRound, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { StarPicker, StarRating } from "@/components/reviews/StarRating";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Label } from "@/components/ui/label";
import { Progress } from "@/components/ui/progress";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/use-auth";
import { getReviewSettings, listPublicReviews, submitGeneralReview } from "@/lib/reviews.functions";

const IMAGE_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
};

const MAX_PHOTO_SIZE = 5 * 1024 * 1024;

function formatDate(iso: string): string {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleDateString();
}

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("") || "F";
}

export function CustomerReviewsSection() {
  const queryClient = useQueryClient();
  const fetchReviews = useServerFn(listPublicReviews);
  const fetchSettings = useServerFn(getReviewSettings);
  const saveReview = useServerFn(submitGeneralReview);
  const { profile, isAuthenticated, loading } = useAuth();

  const photoRef = useRef<HTMLInputElement>(null);

  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState("");
  const [photoPath, setPhotoPath] = useState<string | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [saving, setSaving] = useState(false);

  const settings = useQuery({
    queryKey: ["review-settings"],
    queryFn: () => fetchSettings(),
    staleTime: 60 * 1000,
  });

  const reviews = useQuery({
    queryKey: ["public-reviews"],
    queryFn: () => fetchReviews(),
    staleTime: 60 * 1000,
  });

  useEffect(() => {
    return () => {
      if (photoPreview?.startsWith("blob:")) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  const profileName = profile?.fullName?.trim() || null;
  const displayName = profileName ?? "Flamio customer";
  const reviewsEnabled = settings.data?.reviewsEnabled !== false;
  const photosAllowed = settings.data?.photosEnabled !== false;
  const mediaAllowed = isAuthenticated && photosAllowed;

  async function uploadPhoto(file: File | undefined) {
    if (!file || uploading) return;
    const extension = IMAGE_EXTENSIONS[file.type];
    if (!extension) {
      toast.error("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > MAX_PHOTO_SIZE) {
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
      toast.error("We couldn't add that photo.");
    } finally {
      setUploading(false);
      if (photoRef.current) photoRef.current.value = "";
    }
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (saving) return;
    if (!isAuthenticated) return;
    if (rating < 1) {
      toast.error("Please choose a star rating.");
      return;
    }
    if (comment.trim().length < 2) {
      toast.error("Please write a short review.");
      return;
    }

    setSaving(true);
    try {
      await saveReview({
        data: {
          rating,
          comment: comment.trim(),
          photoPath: mediaAllowed ? photoPath : null,
        },
      });
      toast.success("Thanks! Your review is waiting for approval.");
      setRating(0);
      setComment("");
      setPhotoPath(null);
      setPhotoPreview(null);
      await queryClient.invalidateQueries({ queryKey: ["public-reviews"] });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "We couldn't save your review.");
    } finally {
      setSaving(false);
    }
  }

  if (!reviewsEnabled) return null;

  const summary = reviews.data;
  const shown = summary?.reviews ?? [];

  return (
    <section aria-labelledby="customer-reviews-heading" className="mx-auto w-full max-w-6xl px-4 pb-16 sm:px-6">
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 id="customer-reviews-heading" className="font-display text-3xl font-extrabold sm:text-4xl">
            Customer Reviews
          </h2>
          {summary && summary.count > 0 ? (
            <div className="mt-2 flex flex-wrap items-center gap-2 text-sm text-muted-foreground">
              <StarRating value={summary.average} />
              <span className="font-semibold text-foreground">{summary.average.toFixed(1)}</span>
              <span>
                {summary.count} review{summary.count > 1 ? "s" : ""}
              </span>
            </div>
          ) : null}
        </div>
        <Button asChild variant="outline" size="sm">
          <a href="#write-review">Write a Review</a>
        </Button>
      </div>

      <div className="grid gap-5 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)]">
        <Card id="write-review" className="scroll-mt-24 rounded-2xl shadow-card">
          <CardContent className="p-4 sm:p-5">
            {loading ? (
              <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
                <Loader2 aria-hidden="true" className="size-4 animate-spin" /> Loading…
              </div>
            ) : !isAuthenticated ? (
              <div className="space-y-4 py-2 text-center">
                <div className="mx-auto flex size-12 items-center justify-center rounded-full bg-secondary">
                  <LogIn aria-hidden="true" className="size-5 text-muted-foreground" />
                </div>
                <div className="space-y-1">
                  <p className="font-semibold">Sign in to write a review</p>
                  <p className="text-sm text-muted-foreground">
                    Reviews come from verified Flamio customers. Sign in with your phone number and you will come straight
                    back to this review section.
                  </p>
                </div>
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <a href="/auth?redirect=%2F%23write-review">Sign in to continue</a>
                </Button>
              </div>
            ) : (
            <form onSubmit={handleSubmit} className="space-y-5">
              <div className="flex items-center gap-3">
                <Avatar className="size-12 border border-border/70">
                  {profile?.avatarUrl ? <AvatarImage src={profile.avatarUrl} alt={displayName} /> : null}
                  <AvatarFallback>
                    {displayName ? initials(displayName) : <UserRound aria-hidden="true" className="size-5" />}
                  </AvatarFallback>
                </Avatar>
                <div className="min-w-0">
                  <p className="text-sm font-semibold">{displayName}</p>
                  <p className="text-xs text-muted-foreground">Reviews appear after approval.</p>
                </div>
              </div>


              <div className="space-y-2">
                <Label>Your rating</Label>
                <StarPicker value={rating} onChange={setRating} disabled={saving} />
              </div>

              <div className="space-y-2">
                <Label htmlFor="general-review">Written review</Label>
                <Textarea
                  id="general-review"
                  rows={4}
                  maxLength={1000}
                  value={comment}
                  onChange={(event) => setComment(event.target.value)}
                  placeholder="Tell us what you loved, or what we can do better."
                  disabled={saving}
                />
              </div>

              {mediaAllowed ? (
                <div className="space-y-3">
                  <MediaButton
                    icon={<Camera aria-hidden="true" className="size-4" />}
                    label={photoPreview ? "Change photo" : "Add photo"}
                    busy={uploading}
                    onClick={() => photoRef.current?.click()}
                  />
                  <input
                    ref={photoRef}
                    type="file"
                    accept="image/jpeg,image/png,image/webp"
                    className="hidden"
                    onChange={(event) => void uploadPhoto(event.target.files?.[0])}
                  />
                  {uploading ? <Progress value={70} aria-label="Uploading review photo" /> : null}
                  {photoPreview ? (
                    <div className="flex flex-wrap gap-3">
                      <PreviewShell onRemove={() => { setPhotoPath(null); setPhotoPreview(null); }} label="Remove photo">
                        <img src={photoPreview} alt="Review photo preview" className="size-full object-cover" />
                      </PreviewShell>
                    </div>
                  ) : null}
                  <p className="text-xs text-muted-foreground">A photo is optional. JPG, PNG or WebP, up to 5 MB.</p>
                </div>
              ) : null}

              <Button type="submit" size="lg" className="w-full" disabled={saving || uploading}>
                {saving ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : null}
                Submit Review
              </Button>
            </form>
            )}
          </CardContent>
        </Card>

        <div className="min-w-0">
          {reviews.isLoading ? (
            <div className="rounded-2xl border border-border/70 bg-card p-5 text-sm text-muted-foreground">Loading reviews…</div>
          ) : shown.length === 0 ? (
            <EmptyState
              title="Be the first to share your Flamio experience."
              description="Your review will appear here after it is approved."
              action={
                <Button asChild>
                  <a href="#write-review">Write a Review</a>
                </Button>
              }
            />
          ) : (
            <ul className="grid gap-3">
              {shown.map((review) => (
                <li key={review.id} className="rounded-2xl border border-border/70 bg-card p-4 shadow-card">
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar className="size-10 border border-border/70">
                        {review.reviewerAvatarUrl ? <AvatarImage src={review.reviewerAvatarUrl} alt={review.reviewerName} /> : null}
                        <AvatarFallback>{initials(review.reviewerName)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold">{review.reviewerName}</p>
                          {review.verifiedOrder ? (
                            <Badge variant="secondary" className="gap-1">
                              <CheckCircle2 aria-hidden="true" className="size-3" />
                              Verified order
                            </Badge>
                          ) : null}
                        </div>
                        <p className="text-xs text-muted-foreground">{formatDate(review.createdAt)}</p>
                      </div>
                    </div>
                    <StarRating value={review.rating} />
                  </div>
                  {review.comment ? <p className="mt-3 text-sm text-muted-foreground">{review.comment}</p> : null}
                  {review.photoUrl ? (
                    <div className="mt-3">
                      <img
                        src={review.photoUrl}
                        alt={`Photo shared by ${review.reviewerName}`}
                        loading="lazy"
                        className="h-32 w-32 rounded-2xl border border-border/70 object-cover"
                      />
                    </div>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>
    </section>
  );
}

function MediaButton({ icon, label, busy, onClick }: { icon: React.ReactNode; label: string; busy: boolean; onClick: () => void }) {
  return (
    <Button type="button" variant="outline" disabled={busy} onClick={onClick} className="w-full">
      {busy ? <Loader2 aria-hidden="true" className="size-4 animate-spin" /> : icon}
      {label}
    </Button>
  );
}

function PreviewShell({ children, label, onRemove }: { children: React.ReactNode; label: string; onRemove: () => void }) {
  return (
    <div className="relative size-24 overflow-hidden rounded-2xl border border-border/70 bg-secondary">
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
    </div>
  );
}