// @lovable.dev/vite-tanstack-config already includes the following — do NOT add them manually
// or the app will break with duplicate plugins:
//   - TanStack devtools (dev-only, first), tanstackStart, viteReact, tailwindcss, tsConfigPaths,
//     nitro (build-only using cloudflare as a default target), VITE_* env injection, @ path alias,
//     React/TanStack dedupe, error logger plugins, and sandbox detection (port/host/strictPort).
// You can pass additional config via defineConfig({ vite: { ... }, etc... }) if needed.
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig } from "@lovable.dev/vite-tanstack-config";

/**
 * The project uses an external Supabase project. Values in .env must win over any
 * stale Supabase variables left in the hosting process environment, so the server
 * side and the browser side always talk to the same project.
 */
function envFileOverride() {
  return {
    name: "flamio-env-file-override",
    config() {
      try {
        const raw = readFileSync(resolve(process.cwd(), ".env"), "utf8");
        for (const line of raw.split("\n")) {
          const match = /^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/.exec(line);
          if (!match) continue;
          const key = match[1]!;
          const value = match[2]!.trim().replace(/^["']|["']$/g, "");
          if (key.startsWith("SUPABASE_") || key.startsWith("VITE_SUPABASE_")) {
            process.env[key] = value;
          }
        }
      } catch {
        // no .env file present; hosting environment values are used as-is
      }
    },
  };
}

export default defineConfig({
  tanstackStart: {
    // Redirect TanStack Start's bundled server entry to src/server.ts (our SSR error wrapper).
    // nitro/vite builds from this
    server: { entry: "server" },
  },
  vite: {
    plugins: [envFileOverride()],
  },
});
