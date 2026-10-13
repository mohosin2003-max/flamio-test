import { Suspense, lazy, useEffect, useState } from "react";

import { Skeleton } from "@/components/ui/skeleton";
import type { LocationMapProps } from "@/components/map/LocationMap";

/**
 * Browser-only wrapper around the OpenStreetMap view. Leaflet touches `window`
 * at import time, so the map module is never pulled into server rendering.
 */
const LocationMap = lazy(() => import("@/components/map/LocationMap"));

export function MapPicker(props: LocationMapProps) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);

  const placeholder = (
    <Skeleton className="w-full rounded-xl" style={{ height: props.height ?? 320 }} />
  );

  if (!mounted) return placeholder;
  return (
    <Suspense fallback={placeholder}>
      <LocationMap {...props} />
    </Suspense>
  );
}
