import { useState } from "react";
import { ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Guest orders are protected by the order code plus the last 4 digits of the
 * phone number on the order. The digits are always checked on the server.
 */
export function OrderPhoneVerify({
  onSubmit,
  wrong,
}: {
  onSubmit: (digits: string) => void;
  wrong: boolean;
}) {
  const [value, setValue] = useState("");
  const digits = value.replace(/\D/g, "").slice(0, 4);

  return (
    <section className="mt-6 rounded-2xl border border-border/70 bg-card p-4 shadow-card sm:p-6">
      <div className="flex items-center gap-2">
        <ShieldCheck className="h-5 w-5 text-primary" aria-hidden="true" />
        <h2 className="font-display text-lg font-extrabold">Verify this order</h2>
      </div>
      <p className="mt-2 text-sm text-muted-foreground">
        For your privacy, enter the last 4 digits of the phone number used for this order.
      </p>
      <form
        className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end"
        onSubmit={(e) => {
          e.preventDefault();
          if (digits.length === 4) onSubmit(digits);
        }}
      >
        <div className="flex-1">
          <Label htmlFor="order-phone-last4">Last 4 digits</Label>
          <Input
            id="order-phone-last4"
            inputMode="numeric"
            autoComplete="off"
            maxLength={4}
            placeholder="0000"
            value={digits}
            onChange={(e) => setValue(e.target.value)}
            className="mt-1 tracking-[0.4em]"
          />
        </div>
        <Button type="submit" size="lg" disabled={digits.length !== 4} className="shadow-ember">
          Continue
        </Button>
      </form>
      {wrong ? (
        <p className="mt-3 text-sm font-semibold text-destructive">
          Those digits don't match this order. Please check and try again.
        </p>
      ) : null}
    </section>
  );
}
