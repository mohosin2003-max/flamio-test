import { useQuery } from "@tanstack/react-query";
import { Facebook, Instagram, MapPin, Phone } from "lucide-react";

import { ContactRow } from "@/routes/contact";
import { restaurantQueryOptions } from "@/lib/menu-repository";

import type { Restaurant } from "@/types/menu";

export function LocationSection({ restaurant }: { restaurant: Restaurant }) {
  // Reuses the restaurant info the Home page already loaded (no second request).
  const infoQuery = useQuery(restaurantQueryOptions());
  const info = infoQuery.data?.info ?? null;
  const facebookUrl = info?.facebookUrl ?? restaurant.facebookUrl;
  const facebookPageName = info?.facebookPageName?.trim() || "Facebook";
  const instagramUrl = info?.instagramUrl ?? restaurant.instagramUrl;
  const googleMapsUrl = info?.googleMapsUrl ?? restaurant.googleMapsUrl;
  const addressLine = info?.addressLine ?? restaurant.addressLine;
  const facebookEnabled = info ? info.contactFacebookEnabled : Boolean(facebookUrl);

  return (

    <section
      aria-labelledby="location-heading"
      className="mx-auto w-full max-w-6xl px-4 py-16 sm:px-6"
    >
      <h2 id="location-heading" className="font-display text-3xl font-extrabold sm:text-4xl">
        Find <span className="text-gradient-ember">Flamio</span>
      </h2>
      <p className="mt-3 max-w-xl text-muted-foreground">{restaurant.about}</p>

      <div className="mt-8 flex flex-col">
        <ContactRow
          icon={<Phone aria-hidden="true" className="size-5 shrink-0 text-primary" />}
          title="Contact"
          subtitle=""
          to="/contact"
        />

        {facebookEnabled ? (
          <ContactRow
            icon={<Facebook aria-hidden="true" className="size-5 shrink-0 text-primary" />}
            title="Facebook"
            subtitle={facebookUrl ? facebookPageName : "Not configured yet"}
            href={facebookUrl ?? undefined}
            external
          />
        ) : null}

        {instagramUrl ? (
          <ContactRow
            icon={<Instagram aria-hidden="true" className="size-5 shrink-0 text-primary" />}
            title="Instagram"
            subtitle="Flamio on Instagram"
            href={instagramUrl}
            external
          />
        ) : null}

        <ContactRow
          icon={<MapPin aria-hidden="true" className="size-5 shrink-0 text-primary" />}
          title="Location"
          subtitle={addressLine ?? "Not configured yet"}
          href={googleMapsUrl ?? undefined}
          external
        />
      </div>
    </section>
  );
}
