import { useState } from "react";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";

import { Button } from "@/components/ui/button";
import { useAuth } from "@/hooks/use-auth";
import { createBurgerBoostSession } from "@/lib/burger-boost.functions";

/**
 * Saved (real) game entry. Never falls back to a fake session: if the server
 * can't create one, the customer sees the honest reason. Even when a session is
 * created, play stays blocked until the server sends a sanitized gate layout.
 */
export function RealGamePanel() {
  const { isAuthenticated, loading } = useAuth();
  const create = useServerFn(createBurgerBoostSession);
  const [state, setState] = useState<{ kind: "idle" | "busy" | "msg"; text?: string }>({ kind: "idle" });

  const tryStart = async () => {
    setState({ kind: "busy" });
    try {
      const r = await create({ data: {} });
      setState({ kind: "msg", text: r.ok
        ? "Your saved game was created, but saved play isn't switched on yet. Try practice for now."
        : r.error });
    } catch {
      setState({ kind: "msg", text: "Saved games aren't available yet. Practice is open." });
    }
  };

  return (
    <div className="w-full space-y-2 rounded-lg border border-border p-3 text-left text-sm">
      <p className="font-semibold">Saved game <span className="text-xs text-muted-foreground">(coming soon)</span></p>
      {loading ? <p className="text-muted-foreground">Checking sign-in…</p>
        : !isAuthenticated ? (
          <p className="text-muted-foreground">Sign in to play saved games. <Link to="/auth" className="text-primary underline">Sign in</Link></p>
        ) : (
          <>
            <Button variant="outline" className="w-full" disabled={state.kind === "busy"} onClick={tryStart}>
              {state.kind === "busy" ? "Checking…" : "Start saved game"}
            </Button>
            {state.text && <p role="status" className="text-muted-foreground">{state.text}</p>}
            <p className="text-xs text-muted-foreground">Game history: not available yet.</p>
          </>
        )}
    </div>
  );
}
