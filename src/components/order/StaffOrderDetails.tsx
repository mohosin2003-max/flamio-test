import { ImageIcon, StickyNote } from "lucide-react";
import { useId, useState } from "react";

import { formatTaka } from "@/lib/format";

export interface StaffOrderItem {
  name: string;
  variantName: string | null;
  quantity: number;
  unitPrice?: number | null;
  imageUrl?: string | null;
  comboName?: string | null;
}

function OrderItemImage({ src, name }: { src: string | null | undefined; name: string }) {
  const [failed, setFailed] = useState(false);
  const visible = Boolean(src) && !failed;

  return (
    <div className="grid aspect-[4/3] w-20 shrink-0 place-items-center overflow-hidden rounded-md bg-secondary sm:w-24">
      {visible ? (
        <img
          src={src ?? undefined}
          alt={name}
          className="size-full object-cover"
          loading="lazy"
          onError={() => setFailed(true)}
        />
      ) : (
        <ImageIcon className="size-6 text-muted-foreground" aria-hidden="true" />
      )}
    </div>
  );
}

export function CustomerNote({ note }: { note: string | null | undefined }) {
  if (!note?.trim()) return null;

  return (
    <section className="rounded-lg border border-primary/35 bg-primary/10 p-3" aria-label="Customer note">
      <p className="flex items-center gap-2 text-xs font-bold uppercase text-primary">
        <StickyNote className="size-4" aria-hidden="true" /> Customer note
      </p>
      <p className="mt-1.5 whitespace-pre-wrap break-words text-sm font-medium text-foreground">
        {note}
      </p>
    </section>
  );
}

export function StaffOrderItemList({
  items,
  showPrices = false,
}: {
  items: StaffOrderItem[];
  showPrices?: boolean;
}) {
  const headingId = useId();

  return (
    <section aria-labelledby={headingId}>
      <h3 id={headingId} className="text-xs font-bold uppercase text-muted-foreground">
        Order items
      </h3>
      <ul className="mt-2 divide-y divide-border/70 rounded-lg border border-border/70 bg-background/40">
        {items.map((item, index) => (
          <li
            key={`${item.name}-${item.variantName ?? "standard"}-${index}`}
            className="grid grid-cols-[5rem_minmax(0,1fr)] items-center gap-3 p-3 sm:grid-cols-[6rem_minmax(0,1fr)_auto]"
          >
            <OrderItemImage src={item.imageUrl} name={item.name} />
            <div className="min-w-0">
              <p className="break-words text-sm font-bold text-foreground">{item.name}</p>
              {item.variantName || item.comboName ? (
                <p className="mt-0.5 break-words text-xs text-muted-foreground">
                  {[item.variantName, item.comboName].filter(Boolean).join(" · ")}
                </p>
              ) : null}
              {showPrices && item.unitPrice != null ? (
                <p className="mt-0.5 text-xs text-muted-foreground">
                  {formatTaka(item.unitPrice)} each
                </p>
              ) : null}
            </div>
            <div className="col-start-2 shrink-0 text-left sm:col-start-auto sm:text-right">
              <span className="inline-flex min-w-10 justify-center rounded-md bg-secondary px-2 py-1 text-base font-black text-primary">
                {item.quantity}×
              </span>
              {showPrices && item.unitPrice != null ? (
                <p className="mt-1 text-xs font-bold">{formatTaka(item.unitPrice * item.quantity)}</p>
              ) : null}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function orderDateParts(iso: string) {
  const value = new Date(iso);
  if (Number.isNaN(value.getTime())) return { date: "", time: "" };
  return {
    date: value.toLocaleDateString("en-GB", {
      timeZone: "Asia/Dhaka",
      day: "2-digit",
      month: "short",
      year: "numeric",
    }),
    time: value.toLocaleTimeString("en-GB", {
      timeZone: "Asia/Dhaka",
      hour: "2-digit",
      minute: "2-digit",
    }),
  };
}