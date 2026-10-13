import { Minus, Plus } from "lucide-react";

import { Button } from "@/components/ui/button";

interface QuantityStepperProps {
  value: number;
  onDecrease: () => void;
  onIncrease: () => void;
  label: string;
  min?: number;
}

export function QuantityStepper({
  value,
  onDecrease,
  onIncrease,
  label,
  min = 1,
}: QuantityStepperProps) {
  return (
    <div className="inline-flex items-center gap-1 rounded-full border border-border bg-secondary p-1">
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        onClick={onDecrease}
        disabled={value <= min && min > 0}
        aria-label={`Decrease quantity of ${label}`}
      >
        <Minus aria-hidden="true" />
      </Button>
      <span
        className="min-w-8 text-center font-display text-base font-bold tabular-nums"
        aria-live="polite"
      >
        {value}
      </span>
      <Button
        type="button"
        variant="ghost"
        size="icon"
        className="size-9 rounded-full"
        onClick={onIncrease}
        aria-label={`Increase quantity of ${label}`}
      >
        <Plus aria-hidden="true" />
      </Button>
    </div>
  );
}
