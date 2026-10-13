import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import {
  ChevronRight,
  Facebook,
  Flame,
  Instagram,
  MessageCircle,
  MessagesSquare,
  Phone,
  UserRound,
} from "lucide-react";

import { restaurant } from "@/data/restaurant";
import { getPublicRestaurantInfo } from "@/lib/restaurant.functions";

export const Route = createFileRoute("/contact")({
  head: () => ({
    meta: [
      { title: "Contact Flamio — Kishoreganj Sadar" },
      {
        name: "description",
        content: "Call, message, or connect with Flamio in Kishoreganj Sadar.",
      },
      { property: "og:title", content: "Contact Flamio — Kishoreganj Sadar" },
      {
        property: "og:description",
        content: "Call, message, or connect with Flamio.",
      },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { property: "og:url", content: "https://flamio.bd/contact" },
      { property: "og:image", content: "https://flamio.bd/og-image.png" },
      { name: "twitter:image", content: "https://flamio.bd/og-image.png" },
    ],
    links: [{ rel: "canonical", href: "https://flamio.bd/contact" }],
  }),
  component: ContactPage,
});

function ContactPage() {
  const getInfo = useServerFn(getPublicRestaurantInfo);
  const infoQuery = useQuery({
    queryKey: ["public-restaurant-info"],
    queryFn: () => getInfo(),
    staleTime: 60_000,
  });
  const info = infoQuery.data ?? null;

  const name = info?.name ?? restaurant.name;
  const tagline = info?.tagline ?? restaurant.tagline;
  const facebookPageName = info?.facebookPageName?.trim() || "Facebook";
  const facebookUrl = info?.facebookUrl ?? restaurant.facebookUrl;
  const instagramUrl = info?.instagramUrl ?? restaurant.instagramUrl;
  const phoneDigits = info?.phone?.replace(/\D/g, "") ?? "";
  const ownerPhoneDigits = info?.ownerPhone?.replace(/\D/g, "") ?? "";
  const whatsappDigits = info?.whatsappNumber?.replace(/\D/g, "") ?? "";
  const primaryWhatsappDigits = whatsappDigits || phoneDigits;
  const callRestaurantEnabled = info ? info.contactCallRestaurantEnabled : Boolean(restaurant.phone);
  const callOwnerEnabled = info?.contactCallOwnerEnabled === true;

  return (
    <div className="mx-auto flex min-h-[60vh] w-full max-w-md flex-col px-4 py-6 pb-28 text-foreground sm:px-6 sm:py-8">
      <div className="flex flex-col items-center gap-1 py-4">
        <div className="flex items-center gap-2 font-display text-4xl font-bold tracking-tight text-primary">
          <Flame aria-hidden="true" className="size-8 fill-current" />
          <span>{name}</span>
        </div>
        {tagline ? (
          <p className="text-sm font-medium text-muted-foreground">{tagline}</p>
        ) : null}
      </div>

      <div className="my-2 border-t border-border/40" />

      <div className="flex flex-col">
        {callRestaurantEnabled ? <ContactRow icon={<Phone aria-hidden="true" className="size-5 text-primary" />} title="Call Restaurant" subtitle={info?.phone ?? "Not configured yet"} href={info?.phone ? `tel:${info.phone}` : undefined} /> : null}
        {primaryWhatsappDigits ? <ContactRow icon={<WhatsAppIcon className="size-5 text-primary" />} title="WhatsApp" subtitle="" href={`https://wa.me/${primaryWhatsappDigits}`} external /> : null}
        {callOwnerEnabled ? <ContactRow icon={<UserRound aria-hidden="true" className="size-5 text-primary" />} title="Call Owner" subtitle={info?.ownerPhone ?? "Not configured yet"} href={ownerPhoneDigits ? `tel:${info?.ownerPhone}` : undefined} /> : null}
        {info?.contactInboxEnabled ? <ContactRow icon={<MessagesSquare aria-hidden="true" className="size-5 text-primary" />} title="Customer Message / Inbox" subtitle="Message the Flamio team" to="/account/inbox" /> : null}
        {info?.contactFacebookEnabled ? (
          <ContactRow
            icon={<Facebook aria-hidden="true" className="size-5 shrink-0 text-primary" />}
            title="Facebook Page"
            subtitle={facebookUrl ? facebookPageName : "Not configured yet"}
            href={facebookUrl ?? undefined}
            external
          />
        ) : null}
        {instagramUrl ? <ContactRow icon={<Instagram aria-hidden="true" className="size-5 text-primary" />} title="Instagram" subtitle="Flamio on Instagram" href={instagramUrl} external /> : null}
        {info?.contactMessengerEnabled ? <ContactRow icon={<MessageCircle aria-hidden="true" className="size-5 text-primary" />} title="Message on Facebook / Messenger" subtitle={info.messengerUrl ? facebookPageName : "Not configured yet"} href={info.messengerUrl ?? undefined} external /> : null}
      </div>
    </div>
  );
}

export function ContactRow({
  icon,
  title,
  subtitle,
  href,
  external,
  to,
}: {
  icon: React.ReactNode;
  title: string;
  subtitle: string;
  href?: string | undefined;
  external?: boolean;
  to?: "/account/inbox" | "/contact";
}) {
  const content = (
    <div className="flex w-full min-w-0 items-center gap-3 py-4">
      {icon}
      <div className="min-w-0 flex-1">
        <p className="text-sm font-semibold text-foreground">{title}</p>
        {subtitle ? (
          <p className="truncate text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <ChevronRight aria-hidden="true" className="size-4 shrink-0 text-muted-foreground" />
    </div>
  );

  const hasAction = Boolean(href || to);
  const classes = `group flex w-full min-w-0 border-b border-border/40 transition-smooth ${hasAction ? "cursor-pointer hover:bg-muted/30" : "cursor-default"}`;

  if (href) {
    return (
      <a
        href={href}
        target={external ? "_blank" : undefined}
        rel={external ? "noreferrer" : undefined}
        aria-label={`Open ${title}${external ? " in a new tab" : ""}`}
        className={classes}
      >
        {content}
      </a>
    );
  }

  if (to) return <Link to={to} className={classes}>{content}</Link>;

  return <div className={classes}>{content}</div>;
}

function WhatsAppIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true" className={className}>
      <path d="M12.036 2C6.462 2 1.93 6.532 1.93 12.107c0 1.876.537 3.66 1.502 5.17L2 22l5.018-1.35a9.948 9.948 0 005.018 1.35c5.575 0 10.107-4.532 10.107-10.107S17.611 2 12.036 2Zm5.88 14.46c-.24.675-1.35 1.238-1.863 1.318-.51.08-1.01-.188-1.514-.388-.337-.13-2.078-1.02-2.428-1.188-.35-.17-.607-.262-.862.27-.255.532-.982 1.71-1.213 2.06-.23.352-.458.397-.862.27-.405-.127-1.748-.645-3.34-2.063-1.23-1.095-2.063-2.448-2.303-2.858-.24-.412-.022-.638.18-.855.195-.195.42-.502.63-.75.21-.247.285-.42.42-.698.135-.277.06-.525-.045-.735-.105-.21-.945-2.295-1.298-3.15-.345-.832-.698-.72-.952-.735-.24-.007-.517-.01-.795-.01-.278 0-.735.098-1.125.51-.39.412-1.49 1.447-1.49 3.548 0 2.1 1.53 4.125 1.74 4.403.21.277 3.008 4.59 7.298 6.443 1.02.44 1.815.697 2.438.9 1.027.33 1.958.285 2.685.177.817-.12 2.52-1.028 2.872-2.04.352-1.013.352-1.883.247-2.047-.105-.165-.39-.255-.82-.45Z" />
    </svg>
  );
}
