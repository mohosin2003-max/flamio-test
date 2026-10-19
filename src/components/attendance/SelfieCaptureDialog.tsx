import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Captures a fresh front-camera JPEG. Evidence only — no face matching. */
export function SelfieCaptureDialog({ open, onOpenChange, onCapture }: { open: boolean; onOpenChange: (v: boolean) => void; onCapture: (base64: string, previewUrl: string) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    if (!open || preview) return;
    let cancelled = false;
    setError(null);
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError("Camera is not available in this browser."); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: "user", width: { ideal: 720 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setError(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser settings, then retry." : "The camera could not start. Retry or ask the Owner for help.");
      }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [open, preview, attempt]);

  useEffect(() => { if (!open) setPreview(null); }, [open]);

  const capture = () => {
    const v = videoRef.current; if (!v || !v.videoWidth) { setError("Camera is not ready yet."); return; }
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    setPreview(c.toDataURL("image/jpeg", 0.75));
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Clock-in selfie</DialogTitle>
        <DialogDescription>Your photo is stored privately for Owner review and deleted under the retention rules. It is not face recognition.</DialogDescription>
      </DialogHeader>
      {error ? <div className="space-y-2"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt((a) => a + 1)}><RefreshCw className="mr-2 h-4 w-4" />Retry camera</Button></div> : null}
      {preview
        ? <img src={preview} alt="Captured selfie preview" className="max-h-[55vh] w-full rounded-lg object-contain" />
        : <video ref={videoRef} autoPlay playsInline muted aria-label="Front camera preview" className="max-h-[55vh] w-full -scale-x-100 rounded-lg bg-muted object-contain" />}
      <div className="flex flex-wrap gap-2">
        {preview
          ? <><Button variant="outline" onClick={() => setPreview(null)}>Retake</Button><Button onClick={() => { onCapture(preview.split(",")[1] ?? "", preview); onOpenChange(false); }}>Use this photo</Button></>
          : <Button disabled={Boolean(error)} onClick={capture}><Camera className="mr-2 h-4 w-4" />Take photo</Button>}
      </div>
    </DialogContent>
  </Dialog>;
}
