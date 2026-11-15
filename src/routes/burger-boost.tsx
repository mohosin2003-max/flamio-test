import { createFileRoute, redirect } from "@tanstack/react-router";

// Alias: /burger-boost → /boost (game). Owner page stays at /owner/burger-boost.
export const Route = createFileRoute("/burger-boost")({
  beforeLoad: () => {
    throw redirect({ to: "/boost", replace: true });
  },
});
