import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";

/**
 * Shown to staff accounts on the customer cart / checkout pages. The real block
 * lives in the order server function — this only explains it.
 */
export function StaffCartNotice() {
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-16 sm:px-6">
      <EmptyState
        title="Team accounts can't order here"
        description="Use Counter Sale in the workspace to record a sale for a customer."
        action={
          <Button asChild>
            <Link to="/owner">Go to workspace</Link>
          </Button>
        }
      />
    </div>
  );
}
