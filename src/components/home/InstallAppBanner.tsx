import { Download, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";

type InstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const DISMISSED_KEY = "flamio-install-banner-dismissed";
const INSTALLED_KEY = "flamio-pwa-installed";

export function InstallAppBanner() {
  const [prompt, setPrompt] = useState<InstallPromptEvent | null>(null);
  const [visible, setVisible] = useState(false);
  const [instructions, setInstructions] = useState(false);
  const [isIOS, setIsIOS] = useState(false);
  const [busy, setBusy] = useState(false);
  const dismissed = useRef(false);

  useEffect(() => {
    const standalone = window.matchMedia("(display-mode: standalone)");
    const isStandalone = () => standalone.matches ||
      (navigator as Navigator & { standalone?: boolean }).standalone === true ||
      document.referrer.startsWith("android-app://");
    // Visual inspection only: no synthetic install event or production override.
    const previewDesign = import.meta.env.DEV &&
      new URLSearchParams(window.location.search).get("previewInstallBanner") === "1";
    let installed = false;
    try { installed = localStorage.getItem(INSTALLED_KEY) === "1"; } catch { /* Storage may be disabled. */ }
    try { dismissed.current = !previewDesign && sessionStorage.getItem(DISMISSED_KEY) === "1"; } catch { /* Storage may be disabled. */ }
    const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
    setIsIOS(ios);
    setVisible(!dismissed.current && !isStandalone() && (!installed || previewDesign));

    type InstallWindow = Window & { __flamioInstallPrompt?: InstallPromptEvent | null };
    const win = window as InstallWindow;
    const onPrompt = () => {
      const event = win.__flamioInstallPrompt;
      if (!event) return;
      // A genuine install offer supersedes a stale flag after an uninstall.
      installed = false;
      try { localStorage.removeItem(INSTALLED_KEY); } catch { /* Optional preference only. */ }
      if (dismissed.current || isStandalone()) return;
      setPrompt(event);
      setVisible(true);
    };
    const onInstalled = () => {
      installed = true;
      try { localStorage.setItem(INSTALLED_KEY, "1"); } catch { /* Current view still hides the banner. */ }
      setVisible(false);
      setPrompt(null);
    };
    const onDisplayMode = () => {
      if (isStandalone()) { setVisible(false); setPrompt(null); }
    };
    window.addEventListener("flamio:installprompt", onPrompt);
    // The offer may have arrived before this component mounted.
    onPrompt();
    window.addEventListener("appinstalled", onInstalled);
    standalone.addEventListener("change", onDisplayMode);
    return () => {
      window.removeEventListener("flamio:installprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
      standalone.removeEventListener("change", onDisplayMode);
    };
  }, []);

  const dismiss = () => {
    dismissed.current = true;
    try { sessionStorage.setItem(DISMISSED_KEY, "1"); } catch { /* Optional preference only. */ }
    setVisible(false);
    setPrompt(null);
  };

  const install = async () => {
    if (!prompt || busy) return;
    // Each offer can be shown only once; clear it so it is never reused.
    (window as Window & { __flamioInstallPrompt?: InstallPromptEvent | null }).__flamioInstallPrompt = null;
    setBusy(true);
    try {
      await prompt.prompt();
      await prompt.userChoice;
      dismiss();
    } catch {
      setPrompt(null);
      setInstructions(true);
    } finally {
      setBusy(false);
    }
  };

  if (!visible) return null;

  const help = isIOS ? "Open in Safari, tap Share, then “Add to Home Screen”." :
    "Open the browser menu (⋮) and choose “Install app” or “Add to Home screen”, if available.";

  return (
    <aside aria-label="Install Flamio App" className="mx-auto w-full max-w-6xl px-3 pt-2 sm:px-6">
      <div className="flex min-h-12 items-center gap-2 rounded-lg border border-primary/30 bg-card px-3 py-1.5">
        <Download className="size-4 shrink-0 text-primary" aria-hidden="true" />
        <h2 className="min-w-0 flex-1 truncate font-display text-sm font-bold">Install Flamio</h2>
        {prompt ? (
          <Button size="sm" onClick={() => void install()} disabled={busy} aria-label="Install Flamio app">Install</Button>
        ) : (
          <Popover open={instructions} onOpenChange={setInstructions}>
            <PopoverTrigger asChild>
              <Button size="sm" aria-label="How to install Flamio app">Install</Button>
            </PopoverTrigger>
            <PopoverContent align="end" className="w-64 text-sm">
              <p role="status">{help}</p>
            </PopoverContent>
          </Popover>
        )}
        <Button variant="ghost" size="icon" className="size-8 shrink-0" onClick={dismiss} aria-label="Dismiss install banner">
          <X aria-hidden="true" />
        </Button>
      </div>
    </aside>
  );
}
