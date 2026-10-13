import { CalendarClock, ChefHat, CheckCircle2, CircleSlash, PackageCheck, ShoppingBag, Truck } from "lucide-react";

import { cn } from "@/lib/utils";
import { isCancelled, statusFlow, statusLabel, type OrderStatus } from "@/lib/order-status";
import type { FulfillmentType } from "@/types/menu";

const ICONS: Record<OrderStatus, typeof CheckCircle2> = {
  scheduled: CalendarClock,
  placed: ShoppingBag,
  confirmed: CheckCircle2,
  preparing: ChefHat,
  ready: PackageCheck,
  out_for_delivery: Truck,
  completed: CheckCircle2,
  cancelled: CircleSlash,
};

/**
 * Mobile-first order lifecycle timeline driven purely by the order status
 * stored in the database. Cancelled orders stop the progression.
 */
export function OrderTimeline({
  status,
  fulfillment,
  compact = false,
  scheduled = false,
}: {
  scheduled?: boolean;
  status: string;
  fulfillment: FulfillmentType;
  compact?: boolean;
}) {
  const baseSteps = statusFlow(fulfillment);
  const steps: OrderStatus[] = status === "scheduled" || scheduled ? ["scheduled", ...baseSteps] : baseSteps;
  const cancelled = isCancelled(status);
  const currentIndex = cancelled ? -1 : steps.indexOf(status as OrderStatus);

  return (
    <div>
      {cancelled ? (
        <p className="mb-4 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2.5 text-sm text-destructive">
          <CircleSlash className="mt-0.5 h-4 w-4 shrink-0" aria-hidden="true" />
          <span>This order was cancelled. Please contact us if you need help.</span>
        </p>
      ) : null}

      <ol className={cn("space-y-4", compact && "space-y-3")} aria-label="Order status timeline">
        {steps.map((step, i) => {
          const done = currentIndex > i;
          const isCurrent = currentIndex === i;
          const Icon = ICONS[step];
          return (
            <li key={step} className="flex items-start gap-3">
              <span className="relative flex flex-col items-center">
                <span
                  className={cn(
                    "flex shrink-0 items-center justify-center rounded-full border transition-smooth",
                    compact ? "h-7 w-7" : "h-9 w-9",
                    cancelled
                      ? "border-border/60 text-muted-foreground/60"
                      : isCurrent
                        ? "border-primary bg-primary text-primary-foreground shadow-ember"
                        : done
                          ? "border-primary/50 bg-secondary text-primary"
                          : "border-border text-muted-foreground/70",
                  )}
                >
                  <Icon className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} aria-hidden="true" />
                </span>
                {i < steps.length - 1 ? (
                  <span
                    className={cn(
                      "mt-1 w-px flex-1",
                      compact ? "h-3" : "h-4",
                      !cancelled && done ? "bg-primary/50" : "bg-border",
                    )}
                  />
                ) : null}
              </span>
              <div className="min-w-0 pb-0.5">
                <p
                  className={cn(
                    "text-sm font-semibold",
                    cancelled
                      ? "text-muted-foreground/70"
                      : isCurrent
                        ? "text-foreground"
                        : done
                          ? "text-foreground"
                          : "text-muted-foreground",
                  )}
                >
                  {statusLabel(step, fulfillment)}
                </p>
                <p className="text-xs text-muted-foreground">
                  {cancelled
                    ? "Stopped"
                    : isCurrent
                      ? "In progress now"
                      : done
                        ? "Done"
                        : "Pending"}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
