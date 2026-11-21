import { useEffect, useRef, useState } from "react";
import { Camera, RefreshCw, SwitchCamera } from "lucide-react";
import { nextFacingMode, type FacingMode } from "@/lib/attendance-selfie";

import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";

/** Check-in Photo Evidence: captures a fresh JPEG from the live camera stream (front or rear). No gallery upload, no face recognition. */
export function SelfieCaptureDialog({ open, onOpenChange, onCapture }: { open: boolean; onOpenChange: (v: boolean) => void; onCapture: (base64: string, previewUrl: string, capturedAt: number) => void }) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [preview, setPreview] = useState<string | null>(null);
  const [capturedAt, setCapturedAt] = useState<number | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [facing, setFacing] = useState<FacingMode>("user");

  useEffect(() => {
    if (!open || preview) return;
    let cancelled = false;
    setError(null);
    (async () => {
      if (!window.isSecureContext || !navigator.mediaDevices?.getUserMedia) { setError("Camera is not available in this browser."); return; }
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: facing, width: { ideal: 720 } }, audio: false });
        if (cancelled) { stream.getTracks().forEach((t) => t.stop()); return; }
        streamRef.current = stream;
        if (videoRef.current) { videoRef.current.srcObject = stream; await videoRef.current.play().catch(() => undefined); }
      } catch (e) {
        const name = e instanceof DOMException ? e.name : "";
        setError(name === "NotAllowedError" ? "Camera permission was denied. Allow camera access in your browser settings, then retry." : "The camera could not start. Retry or ask the Owner for help.");
      }
    })();
    return () => { cancelled = true; streamRef.current?.getTracks().forEach((t) => t.stop()); streamRef.current = null; };
  }, [open, preview, attempt, facing]);

  useEffect(() => { if (!open) { setPreview(null); setCapturedAt(null); } }, [open]);

  const capture = () => {
    const v = videoRef.current; if (!v || !v.videoWidth) { setError("Camera is not ready yet."); return; }
    const scale = Math.min(1, 720 / Math.max(v.videoWidth, v.videoHeight));
    const c = document.createElement("canvas");
    c.width = Math.round(v.videoWidth * scale); c.height = Math.round(v.videoHeight * scale);
    c.getContext("2d")?.drawImage(v, 0, 0, c.width, c.height);
    setPreview(c.toDataURL("image/jpeg", 0.75));
    setCapturedAt(Date.now());
  };

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent>
      <DialogHeader>
        <DialogTitle>Check-in photo evidence</DialogTitle>
        <DialogDescription>Take a new live photo with the front or rear camera. It is stored privately for Owner review. Gallery uploads are not allowed. No face recognition is performed.</DialogDescription>
      </DialogHeader>
      {error ? <div className="space-y-2"><p className="text-sm text-destructive">{error}</p><Button variant="outline" onClick={() => setAttempt((a) => a + 1)}><RefreshCw className="mr-2 h-4 w-4" />Retry camera</Button></div> : null}
      {preview
        ? <img src={preview} alt="Captured check-in photo preview" className="max-h-[55vh] w-full rounded-lg object-contain" />
        : <video ref={videoRef} autoPlay playsInline muted aria-label={facing === "user" ? "Live front camera preview" : "Live rear camera preview"} className={"max-h-[55vh] w-full rounded-lg " + (facing === "user" ? "-scale-x-100 " : "") + " bg-muted object-contain"} />}
      <div className="flex flex-wrap gap-2">
        {preview
          ? <><Button variant="outline" onClick={() => { setPreview(null); setCapturedAt(null); }}>Retake</Button><Button onClick={() => { onCapture(preview.split(",")[1] ?? "", preview, capturedAt ?? Date.now()); onOpenChange(false); }}>Use this photo</Button></>
          : <><Button disabled={Boolean(error)} onClick={capture}><Camera className="mr-2 h-4 w-4" />Take photo</Button><Button type="button" variant="outline" onClick={() => setFacing((f) => nextFacingMode(f))}><SwitchCamera className="mr-2 h-4 w-4" />{facing === "user" ? "Use rear camera" : "Use front camera"}</Button></>}
      </div>
    </DialogContent>
  </Dialog>;
}
