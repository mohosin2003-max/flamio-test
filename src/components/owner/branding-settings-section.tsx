import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ImagePlus, Loader2, ShieldCheck, Upload } from "lucide-react";
import { type ChangeEvent, useEffect, useState } from "react";
import { toast } from "sonner";

import { BrandLogo, FALLBACK_BRAND_LOGO_URL } from "@/components/branding/BrandLogo";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { supabase } from "@/integrations/supabase/client";
import {
  ownerCreateBrandUploadTarget,
  ownerGetBranding,
  ownerSaveBranding,
  type OwnerBranding,
} from "@/lib/branding.functions";
import { cn } from "@/lib/utils";

const ALLOWED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"]);
const MAX_LOGO_BYTES = 5 * 1024 * 1024;
const TARGETS = {
  primary: { size: 768, label: "Primary logo" },
  icon: { size: 512, label: "App icon" },
} as const;

type BrandKind = keyof typeof TARGETS;

type BrandDraft = {
  sourceFile: File;
  uploadFile: File;
  previewUrl: string;
  width: number;
  height: number;
};

function validateLogoFile(file: File) {
  if (!ALLOWED_IMAGE_TYPES.has(file.type)) throw new Error("Choose a JPG, PNG or WebP image.");
  if (file.size > MAX_LOGO_BYTES) throw new Error("Logo images must be 5 MB or smaller.");
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
      reject(new Error("The logo image couldn't be read. Please choose another image."));
    };
    image.src = url;
  });
}

function canvasToBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(
      (blob) => {
        if (blob) resolve(blob);
        else reject(new Error("The logo couldn't be optimized. Please try another image."));
      },
      "image/webp",
      0.92,
    );
  });
}

async function prepareLogoDraft(sourceFile: File, kind: BrandKind): Promise<BrandDraft> {
  validateLogoFile(sourceFile);
  const image = await loadImage(sourceFile);
  if (image.naturalWidth < 128 || image.naturalHeight < 128) {
    throw new Error("Use a logo at least 128×128 pixels.");
  }

  const target = TARGETS[kind].size;
  const canvas = document.createElement("canvas");
  canvas.width = target;
  canvas.height = target;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("The logo couldn't be optimized. Please try another image.");
  context.clearRect(0, 0, target, target);

  const scale = Math.min(target / image.naturalWidth, target / image.naturalHeight);
  const width = Math.round(image.naturalWidth * scale);
  const height = Math.round(image.naturalHeight * scale);
  context.drawImage(image, (target - width) / 2, (target - height) / 2, width, height);

  const blob = await canvasToBlob(canvas);
  const uploadFile = new File([blob], `${kind}-logo.webp`, {
    type: "image/webp",
    lastModified: Date.now(),
  });
  validateLogoFile(uploadFile);
  return {
    sourceFile,
    uploadFile,
    previewUrl: URL.createObjectURL(uploadFile),
    width: image.naturalWidth,
    height: image.naturalHeight,
  };
}

function imageInfo(draft: BrandDraft | null) {
  return draft ? `Selected ${draft.width}×${draft.height}` : "JPG, PNG or WebP · up to 5 MB";
}

type CreateTargetFn = (args: {
  data: { kind: BrandKind; contentType: "image/webp" };
}) => Promise<{ path: string; token: string }>;

async function uploadLogo(kind: BrandKind, draft: BrandDraft, createTarget: CreateTargetFn) {
  const target = await createTarget({ data: { kind, contentType: draft.uploadFile.type as "image/webp" } });
  const { error } = await supabase.storage
    .from("banner-images")
    .uploadToSignedUrl(target.path, target.token, draft.uploadFile, {
      contentType: draft.uploadFile.type,
    });
  if (error) throw new Error("The logo couldn't be uploaded. Please try again.");
  return target.path;
}

export function BrandingSettingsSection() {
  const getBranding = useServerFn(ownerGetBranding);
  const createTarget = useServerFn(ownerCreateBrandUploadTarget);
  const saveBranding = useServerFn(ownerSaveBranding);
  const queryClient = useQueryClient();

  const access = useDashboardAccess();
  const isOwner = Boolean(access.data?.roles?.includes("owner"));
  const branding = useQuery({
    queryKey: ["owner-branding"],
    queryFn: () => getBranding(),
    enabled: isOwner,
  });

  const [primaryDraft, setPrimaryDraft] = useState<BrandDraft | null>(null);
  const [iconDraft, setIconDraft] = useState<BrandDraft | null>(null);
  const [processing, setProcessing] = useState<BrandKind | null>(null);
  const [saving, setSaving] = useState(false);
  const [confirmed, setConfirmed] = useState(false);

  useEffect(() => () => {
    if (primaryDraft?.previewUrl) URL.revokeObjectURL(primaryDraft.previewUrl);
  }, [primaryDraft?.previewUrl]);
  useEffect(() => () => {
    if (iconDraft?.previewUrl) URL.revokeObjectURL(iconDraft.previewUrl);
  }, [iconDraft?.previewUrl]);

  const chooseLogo = (kind: BrandKind) => async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0] ?? null;
    if (!file) return;
    setProcessing(kind);
    try {
      const draft = await prepareLogoDraft(file, kind);
      if (kind === "primary") setPrimaryDraft(draft);
      else setIconDraft(draft);
      setConfirmed(false);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Choose a valid logo image");
      event.target.value = "";
    } finally {
      setProcessing(null);
    }
  };

  const current = branding.data ?? null;
  const primaryPreview = primaryDraft?.previewUrl ?? current?.primaryLogoUrl ?? FALLBACK_BRAND_LOGO_URL;
  const iconPreview = iconDraft?.previewUrl ?? current?.iconLogoUrl ?? current?.primaryLogoUrl ?? FALLBACK_BRAND_LOGO_URL;
  const hasChange = Boolean(primaryDraft || iconDraft);

  const submit = async () => {
    if (!current?.id) {
      toast.error("Restaurant settings are not set up yet.");
      return;
    }
    if (current.setupRequired) {
      toast.error("Run docs/sql/branding_management.sql before saving brand logos.");
      return;
    }
    if (!hasChange) {
      toast.error("Choose a logo image first.");
      return;
    }
    if (!confirmed) {
      toast.error("Confirm that you want to activate these brand images.");
      return;
    }

    setSaving(true);
    try {
      const primaryLogoPath = primaryDraft
        ? await uploadLogo("primary", primaryDraft, createTarget)
        : current.primaryLogoPath;
      const iconLogoPath = iconDraft ? await uploadLogo("icon", iconDraft, createTarget) : current.iconLogoPath;
      await saveBranding({
        data: {
          id: current.id,
          primaryLogoPath,
          iconLogoPath,
          confirm: true,
        },
      });
      setPrimaryDraft(null);
      setIconDraft(null);
      setConfirmed(false);
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["owner-branding"] }),
        queryClient.invalidateQueries({ queryKey: ["public-branding"] }),
        queryClient.invalidateQueries({ queryKey: ["restaurant"] }),
      ]);
      toast.success("Brand logos saved");
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Couldn't save brand logos");
    } finally {
      setSaving(false);
    }
  };

  if (!isOwner) {
    return (
      <Card>
        <CardContent className="flex items-start gap-3 p-4">
          <ShieldCheck className="mt-0.5 size-5 shrink-0 text-muted-foreground" aria-hidden="true" />
          <div>
            <p className="font-semibold">Branding</p>
            <p className="text-sm text-muted-foreground">Only the owner account can change Flamio logos.</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardContent className="space-y-5 p-4">
        <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="font-display text-lg font-black">Branding</p>
            <p className="text-sm text-muted-foreground">Control the logo used across customer, owner and staff screens.</p>
          </div>
          <Badge variant={current?.configured ? "default" : "secondary"} className="w-fit">
            {current?.configured ? `Version ${current.version}` : "Using fallback logo"}
          </Badge>
        </div>

        {branding.isLoading ? <Skeleton className="h-72 w-full" /> : null}

        {branding.error ? (
          <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {branding.error instanceof Error ? branding.error.message : "Branding couldn't be loaded."}
          </p>
        ) : null}

        {current?.setupRequired ? (
          <p className="rounded-lg border border-border bg-muted/40 px-3 py-2 text-sm text-muted-foreground">
            Setup step missing: run <code>docs/sql/branding_management.sql</code> once in your database before saving uploaded logos.
          </p>
        ) : null}

        {current ? (
          <>
            <div className="grid gap-4 md:grid-cols-2">
              <LogoPicker
                id="brand-primary-logo"
                label="Primary logo"
                preview={primaryPreview}
                processing={processing === "primary"}
                helper={imageInfo(primaryDraft)}
                onChange={chooseLogo("primary")}
              />
              <LogoPicker
                id="brand-icon-logo"
                label="App icon"
                preview={iconPreview}
                processing={processing === "icon"}
                helper={imageInfo(iconDraft)}
                onChange={chooseLogo("icon")}
              />
            </div>

            <div className="space-y-3 rounded-lg border border-border p-3">
              <p className="text-sm font-semibold">Preview</p>
              <div className="flex flex-wrap items-center gap-3 rounded-lg bg-background p-3">
                <img src={primaryPreview} alt="Primary logo preview" className="h-11 w-auto max-w-40 rounded-md object-contain shadow-card" />
                <span className="text-sm font-semibold text-muted-foreground">Header / login / workspace</span>
              </div>
              <div className="flex items-center gap-3 rounded-lg bg-background p-3">
                <img src={iconPreview} alt="App icon preview" className="size-12 rounded-md object-contain shadow-card" />
                <span className="text-sm font-semibold text-muted-foreground">Favicon / mobile icon / notification icon</span>
              </div>
              <div className="rounded-lg bg-background p-3">
                <BrandLogo showName textClassName="text-xl" imageClassName="size-12" />
              </div>
            </div>

            <label className={cn("flex items-start gap-3 rounded-lg border border-border p-3", !hasChange && "opacity-60")}>
              <Checkbox checked={confirmed} disabled={!hasChange} onCheckedChange={(value) => setConfirmed(value === true)} />
              <span className="text-sm text-muted-foreground">
                Make the selected images the active Flamio brand. Existing logo files are kept safely in storage.
              </span>
            </label>

            <Button disabled={saving || processing !== null || current.setupRequired} onClick={() => void submit()}>
              {saving ? <Loader2 className="mr-2 size-4 animate-spin" /> : <Upload className="mr-2 size-4" />}
              Save brand logos
            </Button>
          </>
        ) : null}
      </CardContent>
    </Card>
  );
}

function LogoPicker({
  id,
  label,
  preview,
  processing,
  helper,
  onChange,
}: {
  id: string;
  label: string;
  preview: string;
  processing: boolean;
  helper: string;
  onChange: (event: ChangeEvent<HTMLInputElement>) => void;
}) {
  return (
    <div className="space-y-3">
      <Label htmlFor={id}>{label}</Label>
      <label
        htmlFor={id}
        className="relative flex min-h-44 cursor-pointer items-center justify-center overflow-hidden rounded-md border border-dashed border-border bg-muted p-4"
      >
        <img src={preview} alt={`${label} preview`} className="max-h-36 max-w-full rounded-md object-contain shadow-card" />
        <span className="absolute bottom-3 right-3 inline-flex items-center gap-1.5 rounded-md bg-background/90 px-2 py-1 text-xs font-semibold text-foreground shadow-card">
          <ImagePlus className="size-3.5" aria-hidden="true" /> Change
        </span>
      </label>
      <Input id={id} type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onChange} />
      <p className="text-xs text-muted-foreground">{processing ? "Optimizing…" : helper}</p>
    </div>
  );
}
