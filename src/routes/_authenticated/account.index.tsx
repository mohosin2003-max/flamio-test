import { Link, createFileRoute, useNavigate } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import type { LucideIcon } from "lucide-react";
import {
  Camera,
  ChevronRight,
  Coins,
  Crown,
  Gamepad2,
  Gift,
  Heart,
  Loader2,
  LockKeyhole,
  LogOut,
  MapPin,
  Pencil,
  ReceiptText,
  ShieldAlert,
  ShieldCheck,
  Sparkles,
  MessageCircle,
} from "lucide-react";
import { toast } from "sonner";

import heroImage from "@/assets/hero-flamio.jpg";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { useAuth } from "@/hooks/use-auth";
import { supabase } from "@/integrations/supabase/client";
import {
  OTP_RESEND_COOLDOWN_SECONDS,
  sendPhoneChangeOtp,
  verifyPhoneChangeOtp,
} from "@/lib/otp";
import { commitPhoneChange } from "@/lib/phone-change.functions";
import { formatPhone, isValidPhone, normalizePhone } from "@/lib/phone";
import { getMyRewards } from "@/lib/rewards.functions";

export const Route = createFileRoute("/_authenticated/account/")({
  head: () => ({
    meta: [
      { title: "My Account — Flamio" },
      { name: "description", content: "Manage your Flamio profile, phone number and orders." },
      { property: "og:title", content: "My Account — Flamio" },
      { property: "og:description", content: "Manage your Flamio profile and orders." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: AccountPage,
});

function AccountPage() {
  const { profile, user, loading, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const commitPhone = useServerFn(commitPhoneChange);
  const fetchRewards = useServerFn(getMyRewards);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [fullName, setFullName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [addressLine, setAddressLine] = useState("");
  const [saving, setSaving] = useState(false);
  const [hydrated, setHydrated] = useState(false);
  const [editing, setEditing] = useState(false);
  const [photoBusy, setPhotoBusy] = useState(false);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);

  const rewards = useQuery({
    queryKey: ["my-rewards"],
    queryFn: () => fetchRewards(),
    enabled: Boolean(user),
    staleTime: 30_000,
  });

  // Phone-change verification state (real SMS OTP via the auth provider).
  const [pendingPhone, setPendingPhone] = useState<string | null>(null);
  const [otpCode, setOtpCode] = useState("");
  const [otpBusy, setOtpBusy] = useState(false);
  const [otpError, setOtpError] = useState<string | null>(null);
  const [configRequired, setConfigRequired] = useState(false);
  const [cooldown, setCooldown] = useState(0);

  useEffect(() => {
    if (!profile || hydrated) return;
    setFullName(profile.fullName ?? "");
    setPhone(profile.phone ?? "");
    setEmail(profile.email ?? "");
    setAddressLine(profile.addressLine ?? "");
    setHydrated(true);
  }, [profile, hydrated]);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = window.setTimeout(() => setCooldown((c) => c - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  async function handlePhotoChange(file: File | undefined) {
    if (!file || !profile || photoBusy) return;
    const extensions: Record<string, string> = {
      "image/jpeg": "jpg",
      "image/png": "png",
      "image/webp": "webp",
    };
    const extension = extensions[file.type];
    if (!extension) {
      toast.error("Choose a JPG, PNG, or WebP image.");
      return;
    }
    if (file.size > 5 * 1024 * 1024) {
      toast.error("Choose an image smaller than 5 MB.");
      return;
    }

    const preview = URL.createObjectURL(file);
    setPhotoPreview(preview);
    setPhotoBusy(true);
    const nextPath = `${profile.id}/${crypto.randomUUID()}.${extension}`;
    try {
      const { error: uploadError } = await supabase.storage
        .from("profile-photos")
        .upload(nextPath, file, { contentType: file.type, upsert: false });
      if (uploadError) throw uploadError;

      const { error: profileError } = await supabase
        .from("profiles")
        .update({ avatar_path: nextPath })
        .eq("id", profile.id);
      if (profileError) {
        await supabase.storage.from("profile-photos").remove([nextPath]);
        throw profileError;
      }
      if (profile.avatarPath && profile.avatarPath !== nextPath) {
        await supabase.storage.from("profile-photos").remove([profile.avatarPath]);
      }
      refreshProfile();
      toast.success("Profile photo updated");
    } catch {
      setPhotoPreview(null);
      toast.error("We couldn't update your photo. Please try again.");
    } finally {
      setPhotoBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  }

  async function handleSave(event: React.FormEvent) {
    event.preventDefault();
    if (saving || !profile) return;

    if (fullName.trim().length < 2) {
      toast.error("Please enter your full name.");
      return;
    }
    if (!isValidPhone(phone)) {
      toast.error("Please enter a valid phone number.");
      return;
    }
    if (email.trim() && !/^\S+@\S+\.\S+$/.test(email.trim())) {
      toast.error("That email address doesn't look right.");
      return;
    }

    const nextPhone = normalizePhone(phone);
    const phoneChanged = Boolean(profile.phone) && nextPhone !== profile.phone;

    setSaving(true);
    const { error } = await supabase.from("profiles").upsert({
      id: profile.id,
      full_name: fullName.trim(),
      phone: profile.phone ?? nextPhone,
      email: email.trim() || null,
      address_line: addressLine.trim() || null,
    });
    setSaving(false);

    if (error) {
      toast.error(
        error.code === "23505"
          ? "That phone number is already used by another account."
          : "We couldn't save your profile. Please try again.",
      );
      return;
    }
    refreshProfile();

    if (phoneChanged) {
      toast.success("Name and email saved. Verify your new phone number to finish.");
      await startPhoneVerification(nextPhone);
      return;
    }
    toast.success("Profile saved");
    setEditing(false);
  }

  async function startPhoneVerification(target: string, resend = false) {
    if (otpBusy) return;
    setOtpError(null);
    setConfigRequired(false);
    setPendingPhone(target);
    setOtpBusy(true);
    try {
      const sent = await sendPhoneChangeOtp(target);
      if (!sent.ok) {
        setConfigRequired(Boolean(sent.configurationRequired));
        setOtpError(sent.message ?? "We couldn't send the verification code.");
        toast.error(sent.message ?? "We couldn't send the verification code.");
        return;
      }
      setCooldown(OTP_RESEND_COOLDOWN_SECONDS);
      toast.success(resend ? "New code sent" : `Code sent to ${formatPhone(target)}`);
    } finally {
      setOtpBusy(false);
    }
  }

  async function handleVerifyPhone(event: React.FormEvent) {
    event.preventDefault();
    if (otpBusy || !pendingPhone) return;
    setOtpError(null);

    if (otpCode.trim().length < 4) {
      setOtpError("Enter the code from the SMS.");
      return;
    }

    setOtpBusy(true);
    try {
      const verified = await verifyPhoneChangeOtp(pendingPhone, otpCode);
      if (!verified.ok) {
        setConfigRequired(Boolean(verified.configurationRequired));
        setOtpError(verified.message ?? "We couldn't verify that code.");
        return;
      }
      const committed = await commitPhone({ data: { phone: pendingPhone } });
      if (!committed.ok) {
        setOtpError(committed.message ?? "We couldn't save your new phone number.");
        return;
      }
      setPendingPhone(null);
      setOtpCode("");
      refreshProfile();
      toast.success("Phone number verified and updated");
    } finally {
      setOtpBusy(false);
    }
  }

  function cancelPhoneChange() {
    setPendingPhone(null);
    setOtpCode("");
    setOtpError(null);
    setConfigRequired(false);
    setPhone(profile?.phone ?? "");
  }

  async function handleSignOut() {
    await queryClient.cancelQueries();
    queryClient.clear();
    await supabase.auth.signOut();
    void navigate({ to: "/auth", replace: true });
  }

  const displayName = profile?.fullName?.trim() || "Flamio customer";
  const initials = displayName
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase();
  const avatarUrl = photoPreview ?? profile?.avatarUrl ?? undefined;
  const services: { to: "/account/orders" | "/account/addresses" | "/account/favorites" | "/account/vouchers" | "/account/rewards" | "/account/challenges" | "/account/inbox"; title: string; description: string; icon: LucideIcon }[] = [
    { to: "/account/orders", title: "My Orders", description: "View and track orders", icon: ReceiptText },
    { to: "/account/addresses", title: "Addresses", description: "Manage delivery addresses", icon: MapPin },
    { to: "/account/favorites", title: "Favorites", description: "Your saved dishes", icon: Heart },
    { to: "/account/vouchers", title: "Vouchers", description: "Available coupons", icon: Gift },
    { to: "/account/rewards", title: "Rewards", description: "Earn and view points", icon: Crown },
    { to: "/account/challenges", title: "Challenges", description: "Play games, win rewards", icon: Gamepad2 },
    { to: "/account/inbox", title: "Inbox", description: "Message the Flamio team", icon: MessageCircle },
  ];

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-4 pb-28 sm:px-6 sm:py-8">
      <section className="overflow-hidden rounded-lg border border-border bg-card shadow-card">
        <div className="relative h-32 overflow-hidden sm:h-40">
          <img src={heroImage} alt="" className="h-full w-full object-cover" />
          <div className="absolute inset-0 bg-gradient-to-t from-card via-card/20 to-transparent" />
        </div>

        <div className="relative px-4 pb-5 sm:px-6">
          <div className="-mt-14 flex items-end gap-4">
            <div className="relative shrink-0">
              <Avatar className="size-24 border-4 border-card bg-secondary shadow-card sm:size-28">
                <AvatarImage src={avatarUrl} alt={`${displayName} profile photo`} className="object-cover" />
                <AvatarFallback className="bg-gradient-ember text-2xl font-black text-primary-foreground">{initials || "F"}</AvatarFallback>
              </Avatar>
              <Button
                type="button"
                size="icon"
                className="absolute bottom-0 right-0 size-9 rounded-full border-2 border-card shadow-card"
                aria-label="Change profile photo"
                title="Change profile photo"
                disabled={photoBusy}
                onClick={() => fileInputRef.current?.click()}
              >
                {photoBusy ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Camera aria-hidden="true" />}
              </Button>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png,image/webp"
                className="sr-only"
                onChange={(event) => void handlePhotoChange(event.target.files?.[0])}
              />
            </div>
            <div className="min-w-0 flex-1 pb-1">
              <h1 className="truncate font-display text-2xl font-black sm:text-3xl">{displayName}</h1>
              <p className="mt-1 truncate text-sm text-muted-foreground">
                {profile?.phone ? formatPhone(profile.phone) : "Phone not added"}
              </p>
              <p className="truncate text-sm text-muted-foreground">{profile?.email || "Email not added"}</p>
            </div>
          </div>

          <Button className="mt-4 w-full sm:w-auto" onClick={() => setEditing((open) => !open)} aria-expanded={editing}>
            <Pencil aria-hidden="true" /> {editing ? "Close profile settings" : "View & Edit Profile"}
          </Button>
        </div>
      </section>

      {editing ? <section className="mt-4 rounded-lg border border-border bg-card p-5 shadow-card sm:p-6">
        <form onSubmit={handleSave} className="space-y-4">
          <h2 className="font-display text-lg font-extrabold">Profile settings</h2>

        <div className="space-y-2">
          <Label htmlFor="fullName">Full name</Label>
          <Input
            id="fullName"
            value={fullName}
            onChange={(e) => setFullName(e.target.value)}
            autoComplete="name"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="phone">Phone number</Label>
          <Input
            id="phone"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
            inputMode="tel"
            autoComplete="tel"
            disabled={loading || Boolean(pendingPhone)}
          />
          <p className="text-xs text-muted-foreground">
            Changing your phone number requires SMS verification.
          </p>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email">Email (optional)</Label>
          <Input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="email"
            disabled={loading}
          />
        </div>

        <div className="space-y-2">
          <Label htmlFor="addressLine">Delivery location (optional)</Label>
          <Input
            id="addressLine"
            value={addressLine}
            onChange={(e) => setAddressLine(e.target.value)}
            autoComplete="street-address"
            placeholder="House / road / area"
            disabled={loading}
          />
          <p className="text-xs text-muted-foreground">
            Saved here and pre-filled at checkout. You can still edit it when ordering.
          </p>
        </div>

        <Button type="submit" className="w-full sm:w-auto" disabled={saving} aria-busy={saving}>
          {saving && <Loader2 className="animate-spin" aria-hidden="true" />}
          {saving ? "Saving..." : "Save changes"}
        </Button>

          <div className="border-t border-border pt-4">
            <Button asChild variant="ghost" className="px-0 text-muted-foreground hover:text-foreground">
              <Link to="/change-password"><LockKeyhole aria-hidden="true" /> Change password</Link>
            </Button>
          </div>
        </form>

        {pendingPhone && (
        <div className="mt-5 border-t border-border pt-5">
          <h2 className="flex items-center gap-2 font-display text-lg font-extrabold">
            <ShieldCheck className="size-5 text-primary" aria-hidden="true" /> Verify new number
          </h2>
          <p className="mt-1 break-words text-sm text-muted-foreground">
            We sent a code to {formatPhone(pendingPhone)}. Enter it to confirm the change.
          </p>

          {configRequired && (
            <div
              role="alert"
              className="mt-4 flex gap-3 rounded-xl border border-amber-500/40 bg-amber-500/10 p-3 text-sm"
            >
              <ShieldAlert className="mt-0.5 size-4 shrink-0 text-amber-600" aria-hidden="true" />
              <div className="min-w-0">
                <p className="font-semibold">SMS provider configuration required</p>
                <p className="mt-1 break-words text-muted-foreground">
                  No code was sent. Your phone number was not changed. SMS verification must be
                  enabled for this project first.
                </p>
              </div>
            </div>
          )}

          <form onSubmit={handleVerifyPhone} className="mt-4 space-y-3">
            <div className="space-y-2">
              <Label htmlFor="phone-otp">Verification code</Label>
              <Input
                id="phone-otp"
                value={otpCode}
                onChange={(e) => setOtpCode(e.target.value)}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="123456"
                disabled={configRequired}
              />
            </div>

            {otpError && !configRequired && (
              <p
                role="alert"
                className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive"
              >
                {otpError}
              </p>
            )}

            <div className="flex flex-wrap gap-2">
              <Button type="submit" disabled={otpBusy || configRequired} aria-busy={otpBusy}>
                {otpBusy && <Loader2 className="animate-spin" aria-hidden="true" />}
                {otpBusy ? "Verifying..." : "Verify & update"}
              </Button>
              <Button
                type="button"
                variant="outline"
                disabled={otpBusy || cooldown > 0}
                onClick={() => void startPhoneVerification(pendingPhone, true)}
              >
                {cooldown > 0 ? `Resend in ${cooldown}s` : "Resend code"}
              </Button>
              <Button type="button" variant="ghost" onClick={cancelPhoneChange} disabled={otpBusy}>
                Cancel
              </Button>
            </div>
          </form>
        </div>
        )}
      </section> : null}

      <p className="mx-auto my-6 flex max-w-sm items-center justify-center gap-2 text-center font-display text-lg font-bold text-foreground sm:text-xl">
        <Sparkles className="size-5 shrink-0 text-primary" aria-hidden="true" />
        The Good Food Brings People Together
      </p>

      <Link
        to="/account/rewards"
        className="group flex items-center gap-3 rounded-lg border border-primary/30 bg-gradient-ember p-4 text-primary-foreground shadow-ember transition-smooth hover:brightness-105"
      >
        <span className="grid size-11 shrink-0 place-items-center rounded-full bg-background/15"><Crown className="size-6" aria-hidden="true" /></span>
        <span className="min-w-0 flex-1">
          <span className="block font-display text-lg font-extrabold">Flamio Rewards</span>
          <span className="block text-xs opacity-80">Order more, earn more</span>
        </span>
        <span className="flex shrink-0 items-center gap-1.5 border-l border-primary-foreground/25 pl-3">
          <Coins className="size-4" aria-hidden="true" />
          <span className="font-display text-lg font-black">{rewards.data?.balance ?? 0}</span>
        </span>
        <ChevronRight className="size-5 shrink-0 transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
      </Link>

      <section className="mt-7">
        <h2 className="font-display text-2xl font-black">My Orders &amp; Services</h2>
        <p className="mt-1 text-sm text-muted-foreground">Everything you need, all in one place.</p>
        <div className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {services.map(({ to, title, description, icon: Icon }) => (
            <Link key={to} to={to} className="group flex min-h-36 flex-col rounded-lg border border-border bg-card p-4 shadow-card transition-smooth hover:border-primary/50 hover:bg-accent">
              <Icon className="size-7 text-primary" strokeWidth={1.7} aria-hidden="true" />
              <span className="mt-5 flex items-center justify-between gap-2 font-display font-bold">
                {title}<ChevronRight className="size-4 shrink-0 text-primary transition-transform group-hover:translate-x-0.5" aria-hidden="true" />
              </span>
              <span className="mt-1 text-xs text-muted-foreground">{description}</span>
            </Link>
          ))}
        </div>
      </section>

      <Button variant="outline" size="lg" className="mt-7 w-full justify-between" onClick={handleSignOut}>
        <span className="flex items-center gap-2"><LogOut aria-hidden="true" /> Log out</span>
        <ChevronRight aria-hidden="true" />
      </Button>
    </div>
  );
}
