import { Link, createFileRoute } from "@tanstack/react-router";
import { Trash2 } from "lucide-react";

import { QuantityStepper } from "@/components/menu/QuantityStepper";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { StaffCartNotice } from "@/components/account/StaffCartNotice";
import { useDashboardAccess } from "@/hooks/use-dashboard-access";
import { useCart } from "@/context/cart";
import { formatBDT } from "@/lib/format";
import type { CartLine } from "@/types/menu";

export const Route = createFileRoute("/cart")({
  head: () => ({
    meta: [
      { title: "Your cart — Flamio" },
      {
        name: "description",
        content: "Review your flame-grilled Flamio order before checkout in Kishoreganj Sadar.",
      },
      { property: "og:title", content: "Your cart — Flamio" },
      {
        property: "og:description",
        content: "Review your flame-grilled Flamio order before checkout.",
      },
    ],
  }),
  component: CartPage,
});

type CartGroup = {
  comboKey: string | null;
  comboName: string | null;
  lines: CartLine[];
};

/** Keeps the lines of one built combo together, in the order they were added. */
function groupLines(lines: CartLine[]): CartGroup[] {
  const groups: CartGroup[] = [];
  for (const line of lines) {
    const key = line.comboKey ?? null;
    const last = groups[groups.length - 1];
    if (key && last?.comboKey === key) {
      last.lines.push(line);
      continue;
    }
    if (!key && last && last.comboKey === null) {
      last.lines.push(line);
      continue;
    }
    groups.push({ comboKey: key, comboName: line.comboName ?? null, lines: [line] });
  }
  return groups;
}

function CartPage() {
  const {
    lines,
    subtotal,
    total,
    isHydrated,
    increment,
    decrement,
    removeItem,
    removeCombo,
    incrementCombo,
    decrementCombo,
    clear,
  } = useCart();
  const groups = groupLines(lines);
  const { isStaffOnly } = useDashboardAccess();

  if (isStaffOnly) return <StaffCartNotice />;

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 sm:py-12">
      <h1 className="font-display text-3xl font-black sm:text-4xl">Your cart</h1>

      {!isHydrated ? (
        <p className="mt-6 text-sm text-muted-foreground">Loading your cart…</p>
      ) : lines.length === 0 ? (
        <div className="mt-8">
          <EmptyState
            title="Your cart is empty"
            description="Add something flame-grilled from the menu and it will show up here."
            action={
              <Button asChild>
                <Link to="/menu" search={{}}>
                  Browse the menu
                </Link>
              </Button>
            }
          />
        </div>
      ) : (
        <div className="mt-8 grid gap-8 lg:grid-cols-[1fr_20rem]">
          <ul className="flex flex-col gap-4">
            {groups.map((group) =>
              group.comboKey ? (
                <li
                  key={group.comboKey}
                  className="rounded-2xl border border-primary/40 bg-card p-4 shadow-card"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="text-[11px] font-bold uppercase tracking-wide text-primary">
                        Combo
                      </p>
                      <h2 className="truncate text-base font-semibold">{group.comboName}</h2>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={`Remove ${group.comboName} from cart`}
                      onClick={() => removeCombo(group.comboKey as string)}
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                  <ul className="mt-3 space-y-1.5">
                    {group.lines.map((line) => (
                      <li key={line.lineId} className="flex justify-between gap-3 text-sm">
                        <span className="min-w-0 truncate">
                          {line.productName}
                          {line.variantName ? ` (${line.variantName})` : ""}
                        </span>
                        <span className="shrink-0 text-muted-foreground">
                          {formatBDT(line.unitPrice)}
                        </span>
                      </li>
                    ))}
                  </ul>
                  <div className="mt-3 flex items-center justify-between gap-3 border-t border-border/70 pt-3">
                    <QuantityStepper
                      value={group.lines[0]?.quantity ?? 1}
                      label={group.comboName ?? "combo"}
                      min={0}
                      onDecrease={() => decrementCombo(group.comboKey as string)}
                      onIncrease={() => incrementCombo(group.comboKey as string)}
                    />
                    <span className="text-right">
                      <span className="block text-xs text-muted-foreground">Combo total</span>
                      <span className="font-display text-lg font-bold">
                        {formatBDT(
                          group.lines.reduce((sum, l) => sum + l.unitPrice * l.quantity, 0),
                        )}
                      </span>
                    </span>
                  </div>
                </li>
              ) : (
                group.lines.map((line) => (
                  <li
                    key={line.lineId}
                    className="flex gap-4 rounded-2xl border border-border/70 bg-card p-4 shadow-card"
                  >
                    {line.imageUrl ? (
                      <img
                        src={line.imageUrl}
                        alt={line.productName}
                        loading="lazy"
                        width={96}
                        height={96}
                        className="size-20 shrink-0 rounded-xl object-cover sm:size-24"
                      />
                    ) : null}
                    <div className="flex min-w-0 flex-1 flex-col gap-2">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <h2 className="truncate text-base font-semibold">
                            <Link
                              to="/menu/$productSlug"
                              params={{ productSlug: line.productSlug }}
                              className="transition-smooth hover:text-primary"
                            >
                              {line.productName}
                            </Link>
                          </h2>
                          {line.variantName ? (
                            <p className="text-sm text-muted-foreground">{line.variantName}</p>
                          ) : null}
                          <p className="text-sm text-muted-foreground">
                            {formatBDT(line.unitPrice)}
                          </p>
                        </div>
                        <Button
                          variant="ghost"
                          size="icon"
                          aria-label={`Remove ${line.productName} from cart`}
                          onClick={() => removeItem(line.lineId)}
                        >
                          <Trash2 aria-hidden="true" />
                        </Button>
                      </div>
                      <div className="flex items-center justify-between gap-3">
                        <QuantityStepper
                          value={line.quantity}
                          label={line.productName}
                          min={0}
                          onDecrease={() => decrement(line.lineId)}
                          onIncrease={() => increment(line.lineId)}
                        />
                        <span className="font-display text-lg font-bold">
                          {formatBDT(line.unitPrice * line.quantity)}
                        </span>
                      </div>
                    </div>
                  </li>
                ))
              ),
            )}
          </ul>

          <aside className="h-fit rounded-2xl border border-border/70 bg-card p-5 shadow-card lg:sticky lg:top-24">
            <h2 className="font-display text-xl font-extrabold">Order summary</h2>
            <dl className="mt-4 space-y-2 text-sm">
              <div className="flex justify-between">
                <dt className="text-muted-foreground">Subtotal</dt>
                <dd className="font-medium">{formatBDT(subtotal)}</dd>
              </div>
              <div className="flex justify-between border-t border-border/70 pt-3 text-base">
                <dt className="font-semibold">Total</dt>
                <dd className="font-display text-xl font-extrabold text-gradient-ember">
                  {formatBDT(total)}
                </dd>
              </div>
            </dl>
            <Button asChild size="lg" className="mt-5 w-full shadow-ember">
              <Link to="/checkout">Proceed to checkout</Link>
            </Button>
            <Button variant="ghost" size="sm" className="mt-2 w-full" onClick={clear}>
              Clear cart
            </Button>
          </aside>
        </div>
      )}
    </div>
  );
}
