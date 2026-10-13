import { createFileRoute } from "@tanstack/react-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, Pencil, Trash2, Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";
import { supabase } from "@/integrations/supabase/client";
import {
  ownerDeletePromoBanner,
  ownerListPromoBanners,
  ownerSavePromoBanner,
} from "@/lib/banners.functions";
import { menuQueryOptions } from "@/lib/menu-repository";
import { cn } from "@/lib/utils";
import type { PromoBanner } from "@/types/menu";

export const Route = createFileRoute("/_authenticated/owner/banners")({
  head: () => ({
    meta: [
      { title: "Banner Management — Flamio" },
      { name: "description", content: "Manage Flamio promotional banners." },
      { property: "og:title", content: "Banner Management — Flamio" },
      { property: "og:description", content: "Manage Flamio promotional banners." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerBanners,
});

type Destination = "none" | "menu" | "offers" | "category" | "product" | "custom";
type BannerKind = "desktop" | "mobile";
type CropPosition = "center" | "left" | "right" | "top" | "bottom";

type FormState = {
  id: string | null;
  desktopPath: string | null;
  mobilePath: string | null;
  desktopUrl: string | null;
  mobileUrl: string | null;
  destination: Destination;
  target: string;
  sortOrder: string;
  isActive: boolean;
};

type BannerDraft = {
  sourceFile: File;
  uploadFile: File;
  previewUrl: string;
  width: number;
  height: number;
  sourceRatioLabel: string;
};

const emptyForm = (): FormState => ({
  id: null,
  desktopPath: null,
  mobilePath: null,
  desktopUrl: null,
  mobileUrl: null,
  destination: "none",
  target: "",
  sortOrder: "0",
  isActive: true,
});

function parseDestination(href: string | null): Pick<FormState, "destination" | "target"> {
  if (!href) return { destination: "none", target: "" };
  if (href === "/menu") return { destination: "menu", target: "" };
  if (href === "/offers") return { destination: "offers", target: "" };
  if (href.startsWith("/menu?category=")) {
    return { destination: "category", target: decodeURIComponent(href.slice(15)) };
  }
  if (href.startsWith("/menu/") && !href.includes("?")) {
    return { destination: "product", target: decodeURIComponent(href.slice(6)) };
  }
  return { destination: "custom", target: href };
}

function toForm(banner: PromoBanner): FormState {
  return {
    id: banner.id,
    desktopPath: banner.desktopImagePath,
    mobilePath: banner.mobileImagePath,
    desktopUrl: banner.desktopImageUrl,
    mobileUrl: banner.mobileImageUrl,
    ...parseDestination(banner.ctaHref),
    sortOrder: String(banner.sortOrder),
    isActive: banner.isActive,
  };
}

function clickHref(form: FormState): string | null {
  if (form.destination === "menu") return "/menu";
  if (form.destination === "offers") return "/offers";
  if (form.destination === "category" && form.target) {
    return `/menu?category=${encodeURIComponent(form.target)}`;
  }
  if (form.destination === "product" && form.target) {
    return `/menu/${encodeURIComponent(form.target)}`;
  }
  if (form.destination === "custom" && form.target.trim()) return form.target.trim();
  return null;
}

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const POSITION_OPTIONS: Array<{ value: CropPosition; label: string }> = [
  { value: "center", label: "Center" },
  { value: "left", label: "Left" },
  { value: "right", label: "Right" },
  { value: "top", label: "Top" },
  { value: "bottom", label: "Bottom" },
];
const BANNER_TARGETS = {
  desktop: { width: 1600, height: 600, ratioLabel: "16:6" },
  mobile: { width: 1200, height: 900, ratioLabel: "4:3" },
} satisfies Record<BannerKind, { width: number; height: number; ratioLabel: string }>;

function positionClass(position: CropPosition) {
  if (position === "left") return "object-left";
  if (position === "right") return "object-right";
  if (position === "top") return "object-top";
  if (position === "bottom") return "object-bottom";
  return "object-center";
}

function validateBannerFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > 8 * 1024 * 1024) throw new Error("Banner images must be 8 MB or smaller.");
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

function ratioLabel(width: number, height: number) {
  const divisor = gcd(width, height);
  return `${Math.round(width / divisor)}:${Math.round(height / divisor)}`;
}

function loadImage(file: File): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      URL.revokeObjectURL(url);
      resolve(image);
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("The image couldn't be read. Please choose another image."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The image couldn't be optimized. Please try another image."));
      },
      "image/webp",
      0.92,
    );
  });
}

async function prepareBannerDraft(
  sourceFile: File,
  kind: BannerKind,
  position: CropPosition,
): Promise<BannerDraft> {
  validateBannerFile(sourceFile);
  const target = BANNER_TARGETS[kind];
  const image = await loadImage(sourceFile);
  const targetRatio = target.width / target.height;
  const sourceRatio = image.naturalWidth / image.naturalHeight;
  let sx = 0;
  let sy = 0;
  let sw = image.naturalWidth;
  let sh = image.naturalHeight;

  if (sourceRatio > targetRatio) {
    sw = image.naturalHeight * targetRatio;
    if (position === "left") sx = 0;
    else if (position === "right") sx = image.naturalWidth - sw;
    else sx = (image.naturalWidth - sw) / 2;
  } else {
    sh = image.naturalWidth / targetRatio;
    if (position === "top") sy = 0;
    else if (position === "bottom") sy = image.naturalHeight - sh;
    else sy = (image.naturalHeight - sh) / 2;
  }

  const canvas = document.createElement("canvas");
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The image couldn't be optimized. Please try another image.");
  context.drawImage(image, sx, sy, sw, sh, 0, 0, target.width, target.height);
  const blob = await canvasToBlob(canvas);
  const uploadFile = new File([blob], `${kind}-banner.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
  validateBannerFile(uploadFile);

  return {
    sourceFile,
    uploadFile,
    previewUrl: URL.createObjectURL(uploadFile),
    width: image.naturalWidth,
    height: image.naturalHeight,
    sourceRatioLabel: ratioLabel(image.naturalWidth, image.naturalHeight),
  };
}

async function uploadBanner(file: File, kind: BannerKind) {
  validateBannerFile(file);
  const extension = file.name.split(".").pop()?.toLowerCase() ?? "jpg";
  const path = `${crypto.randomUUID()}/${kind}.${extension}`;
  const { error } = await supabase.storage.from("banner-images").upload(path, file, {
    contentType: file.type,
    upsert: false,
  });
  if (error) throw new Error("The image couldn't be uploaded. Please try again.");
  return path;
}

function OwnerBanners() {
  const list = useServerFn(ownerListPromoBanners);
  const save = useServerFn(ownerSavePromoBanner);
  const remove = useServerFn(ownerDeletePromoBanner);
  const queryClient = useQueryClient();
  const [form, setForm] = useState<FormState>(emptyForm);
  const [desktopDraft, setDesktopDraft] = useState<BannerDraft | null>(null);
  const [mobileDraft, setMobileDraft] = useState<BannerDraft | null>(null);
  const [desktopPosition, setDesktopPosition] = useState<CropPosition>("center");
  const [mobilePosition, setMobilePosition] = useState<CropPosition>("center");
  const [processingKind, setProcessingKind] = useState<BannerKind | null>(null);
  const [saving, setSaving] = useState(false);

  const banners = useQuery({ queryKey: ["owner-banners"], queryFn: () => list() });
  const menu = useQuery(menuQueryOptions());
  const desktopPreview = desktopDraft?.previewUrl ?? form.desktopUrl;
  const mobilePreview = mobileDraft?.previewUrl ?? form.mobileUrl;

  useEffect(() => {
    return () => {
      if (desktopDraft?.previewUrl) URL.revokeObjectURL(desktopDraft.previewUrl);
    };
  }, [desktopDraft?.previewUrl]);
  useEffect(() => {
    return () => {
      if (mobileDraft?.previewUrl) URL.revokeObjectURL(mobileDraft.previewUrl);
    };
  }, [mobileDraft?.previewUrl]);

  if (banners.isLoading) return <Skeleton className="h-96 w-full" />;
  if (banners.error) {
    return (
      <EmptyState
        title="Couldn't load banners"
        description="Something went wrong loading your banners."
        action={<Button onClick={() => void banners.refetch()}>Try again</Button>}
      />
    );
  }

  const rows = banners.data ?? [];
  const reset = () => {
    setForm(emptyForm());
    setDesktopDraft(null);
    setMobileDraft(null);
    setDesktopPosition("center");
    setMobilePosition("center");
  };
  const refresh = async () => {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ["owner-banners"] }),
      queryClient.invalidateQueries({ queryKey: ["restaurant"] }),
    ]);
  };
  const updateDraft = async (kind: BannerKind, file: File, position: CropPosition) => {
    setProcessingKind(kind);
    try {
      const draft = await prepareBannerDraft(file, kind, position);
      if (kind === "desktop") setDesktopDraft(draft);
      else setMobileDraft(draft);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The image couldn't be prepared");
    } finally {
      setProcessingKind(null);
    }
  };
  const chooseFile =
    (kind: BannerKind) => (event: ChangeEvent<HTMLInputElement>) => {
      const file = event.target.files?.[0] ?? null;
      if (!file) return;
      try {
        validateBannerFile(file);
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Choose a valid banner image");
        event.target.value = "";
        return;
      }
      void updateDraft(kind, file, kind === "desktop" ? desktopPosition : mobilePosition);
    };
  const changePosition = (kind: BannerKind, position: CropPosition) => {
    if (kind === "desktop") {
      setDesktopPosition(position);
      if (desktopDraft) void updateDraft("desktop", desktopDraft.sourceFile, position);
    } else {
      setMobilePosition(position);
      if (mobileDraft) void updateDraft("mobile", mobileDraft.sourceFile, position);
    }
  };

  const submit = async () => {
    if (!desktopDraft && !form.desktopPath) {
      toast.error("Upload a desktop banner image");
      return;
    }
    if (["category", "product", "custom"].includes(form.destination) && !form.target.trim()) {
      toast.error("Choose where this banner should open");
      return;
    }

    setSaving(true);
    const newlyUploaded: string[] = [];
    try {
      const desktopPath = desktopDraft
        ? await uploadBanner(desktopDraft.uploadFile, "desktop").then((path) => {
            newlyUploaded.push(path);
            return path;
          })
        : form.desktopPath;
      const mobilePath = mobileDraft
        ? await uploadBanner(mobileDraft.uploadFile, "mobile").then((path) => {
            newlyUploaded.push(path);
            return path;
          })
        : form.mobilePath;
      if (!desktopPath) return;

      await save({
        data: {
          id: form.id,
          desktopImagePath: desktopPath,
          mobileImagePath: mobilePath,
          clickHref: clickHref(form),
          isActive: form.isActive,
          sortOrder: Number(form.sortOrder) || 0,
        },
      });
      await refresh();
      reset();
      toast.success("Banner saved");
    } catch (error) {
      if (newlyUploaded.length > 0) {
        await supabase.storage.from("banner-images").remove(newlyUploaded);
      }
      toast.error(error instanceof Error ? error.message : "Couldn't save this banner");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardContent className="space-y-5 p-4">
          <div>
            <h2 className="font-display text-base font-bold">
              {form.id ? "Edit banner" : "New banner"}
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Upload the finished artwork. No text will be added over it.
            </p>
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <ImagePicker
              id="banner-desktop"
              label="Desktop banner image"
              previewLabel="Live Desktop Preview"
              ratioLabel="16:6"
              position={desktopPosition}
              sourceInfo={desktopDraft ? `${desktopDraft.width}×${desktopDraft.height} (${desktopDraft.sourceRatioLabel})` : null}
              processing={processingKind === "desktop"}
              required
              preview={desktopPreview}
              frame="desktop"
              onPositionChange={(position) => changePosition("desktop", position)}
              onChange={chooseFile("desktop")}
            />
            <ImagePicker
              id="banner-mobile"
              label="Mobile banner image (optional)"
              previewLabel="Live Mobile Preview"
              ratioLabel="4:3"
              position={mobilePosition}
              sourceInfo={mobileDraft ? `${mobileDraft.width}×${mobileDraft.height} (${mobileDraft.sourceRatioLabel})` : null}
              processing={processingKind === "mobile"}
              preview={mobilePreview ?? desktopPreview}
              frame="mobile"
              fallback={!mobilePreview && Boolean(desktopPreview)}
              onPositionChange={(position) => changePosition("mobile", position)}
              onChange={chooseFile("mobile")}
            />
          </div>

          <div className="grid gap-4 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label>When clicked</Label>
              <Select
                value={form.destination}
                onValueChange={(value: Destination) =>
                  setForm({ ...form, destination: value, target: "" })
                }
              >
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="none">No action</SelectItem>
                  <SelectItem value="menu">Menu</SelectItem>
                  <SelectItem value="offers">Offers</SelectItem>
                  <SelectItem value="category">Category</SelectItem>
                  <SelectItem value="product">Specific menu item</SelectItem>
                  <SelectItem value="custom">Custom URL</SelectItem>
                </SelectContent>
              </Select>
            </div>

            {form.destination === "category" ? (
              <div className="space-y-1.5">
                <Label>Category</Label>
                <Select value={form.target} onValueChange={(target) => setForm({ ...form, target })}>
                  <SelectTrigger><SelectValue placeholder="Choose category" /></SelectTrigger>
                  <SelectContent>
                    {(menu.data?.categories ?? []).map((category) => (
                      <SelectItem key={category.id} value={category.slug}>{category.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {form.destination === "product" ? (
              <div className="space-y-1.5">
                <Label>Menu item</Label>
                <Select value={form.target} onValueChange={(target) => setForm({ ...form, target })}>
                  <SelectTrigger><SelectValue placeholder="Choose menu item" /></SelectTrigger>
                  <SelectContent>
                    {(menu.data?.products ?? []).map((product) => (
                      <SelectItem key={product.id} value={product.slug}>{product.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}

            {form.destination === "custom" ? (
              <div className="space-y-1.5">
                <Label htmlFor="banner-url">Custom URL</Label>
                <Input
                  id="banner-url"
                  value={form.target}
                  placeholder="https://example.com"
                  onChange={(event) => setForm({ ...form, target: event.target.value })}
                />
              </div>
            ) : null}

            <div className="space-y-1.5">
              <Label htmlFor="banner-order">Display order</Label>
              <Input
                id="banner-order"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={form.sortOrder}
                onChange={(event) => setForm({ ...form, sortOrder: event.target.value })}
              />
            </div>

            <div className="flex min-h-10 items-center justify-between gap-3 rounded-md border border-border px-3 py-2">
              <Label htmlFor="banner-active">Active</Label>
              <Switch
                id="banner-active"
                checked={form.isActive}
                onCheckedChange={(isActive) => setForm({ ...form, isActive })}
              />
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            <Button disabled={saving} onClick={() => void submit()}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
              Save banner
            </Button>
            {form.id ? <Button variant="outline" onClick={reset}>Cancel</Button> : null}
          </div>
        </CardContent>
      </Card>

      <div className="space-y-3">
        <h2 className="font-display text-base font-bold">Banners</h2>
        {rows.length === 0 ? (
          <EmptyState
            title="No banners yet"
            description="The home carousel will keep showing featured menu items."
          />
        ) : (
          rows.map((banner) => (
            <Card key={banner.id}>
              <CardContent className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
                <div className="aspect-[16/7] w-full shrink-0 overflow-hidden rounded-md bg-muted sm:w-44">
                  {banner.desktopImageUrl ? (
                    <img src={banner.desktopImageUrl} alt="Promotional banner" className="size-full object-cover" />
                  ) : (
                    <div className="flex size-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
                      Existing text banner — add an image to update it
                    </div>
                  )}
                </div>
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={banner.isActive ? "default" : "secondary"}>
                      {banner.isActive ? "Active" : "Inactive"}
                    </Badge>
                    <span className="text-xs text-muted-foreground">Order {banner.sortOrder}</span>
                  </div>
                  <p className="mt-2 truncate text-sm">
                    {banner.ctaHref ? `Opens ${banner.ctaHref}` : "No click action"}
                  </p>
                </div>
                <div className="flex gap-2 self-end sm:self-auto">
                  <Button
                    size="icon"
                    variant="outline"
                    aria-label="Edit banner"
                    onClick={() => {
                      setDesktopDraft(null);
                      setMobileDraft(null);
                      setDesktopPosition("center");
                      setMobilePosition("center");
                      setForm(toForm(banner));
                      window.scrollTo({ top: 0, behavior: "smooth" });
                    }}
                  >
                    <Pencil className="size-4" />
                  </Button>
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Delete banner"
                    onClick={async () => {
                      try {
                        await remove({ data: { id: banner.id } });
                        await refresh();
                        if (form.id === banner.id) reset();
                        toast.success("Banner deleted");
                      } catch (error) {
                        toast.error(error instanceof Error ? error.message : "Couldn't delete this banner");
                      }
                    }}
                  >
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))
        )}
      </div>
    </div>
  );
}

function ImagePicker({
  id,
  label,
  previewLabel,
  ratioLabel,
  position,
  sourceInfo,
  processing,
  preview,
  frame,
  required = false,
  fallback = false,
  onPositionChange,
  onChange,
}: {
  id: string;
  label: string;
  previewLabel: string;
  ratioLabel: string;
  position: CropPosition;
  sourceInfo: string | null;
  processing: boolean;
  preview: string | null;
  frame: BannerKind;
  required?: boolean;
  fallback?: boolean;
  onPositionChange: (position: CropPosition) => void;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <Label htmlFor={id}>{label}{required ? " *" : ""}</Label>
      <label
        htmlFor={id}
        className="relative flex min-h-28 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted"
      >
        {preview ? (
          <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <ImagePlus className="size-6" />
            {fallback ? "Using desktop image" : "Change image"}
          </span>
        ) : (
          <span className="flex flex-col items-center gap-2 text-sm text-muted-foreground">
            <ImagePlus className="size-6" />
            Choose image
          </span>
        )}
      </label>
      <Input id={id} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onChange} />
      <div className="space-y-2">
        <p className="text-xs text-muted-foreground">
          JPG, PNG or WebP · up to 8 MB · optimized to {ratioLabel}
          {sourceInfo ? ` · detected ${sourceInfo}` : ""}
        </p>
        <div className="space-y-1.5">
          <Label className="text-xs">Smart crop position</Label>
          <ToggleGroup
            type="single"
            value={position}
            onValueChange={(value) => {
              if (value) onPositionChange(value as CropPosition);
            }}
            variant="outline"
            size="sm"
            className="flex-wrap justify-start"
          >
            {POSITION_OPTIONS.map((option) => (
              <ToggleGroupItem key={option.value} value={option.value} aria-label={`${label} ${option.label}`}>
                {option.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
      </div>
      <div className="space-y-1.5">
        <div className="flex items-center justify-between gap-2">
          <Label className="text-xs">{previewLabel}</Label>
          {processing ? <span className="text-xs text-muted-foreground">Optimizing…</span> : null}
        </div>
        <div
          className={cn(
            "overflow-hidden rounded-md border border-border bg-muted",
            frame === "desktop" ? "aspect-[16/6]" : "aspect-[4/3] max-w-56",
          )}
        >
          {preview ? (
            <img
              src={preview}
              alt={previewLabel}
              className={cn("size-full object-cover", positionClass(position))}
            />
          ) : (
            <div className="flex size-full items-center justify-center px-3 text-center text-xs text-muted-foreground">
              Preview appears after upload
            </div>
          )}
        </div>
      </div>
    </div>
  );
}