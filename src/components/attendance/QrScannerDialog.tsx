import { useEffect, useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import {
  Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle,
} from "@/components/ui/dialog";

type BarcodeDetectorLike = {
  detect: (source: HTMLVideoElement) => Promise<Array<{ rawValue?: string }>>;
};

type BarcodeDetectorWindow = Window & {
  BarcodeDetector?: new (options?: { formats: string[] }) => BarcodeDetectorLike;
};

type QrScannerDialogProps = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onScan: (value: string) => void;
};

/** Android-browser QR scanning; manual token entry remains the fallback. */
export function QrScannerDialog({ open, onOpenChange, onScan }: QrScannerDialogProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [message, setMessage] = useState("Starting camera…");

  useEffect(() => {
    if (!open) return;
    let stopped = false;
    let stream: MediaStream | null = null;
    let frameId = 0;

    const stop = () => {
      stopped = true;
      if (frameId) window.cancelAnimationFrame(frameId);
      stream?.getTracks().forEach((track) => track.stop());
      stream = null;
    };

    const start = async () => {
      if (!navigator.mediaDevices?.getUserMedia) {
        setMessage("Camera access is unavailable. Close this dialog and paste the token manually.");
        return;
      }
      const Detector = (window as BarcodeDetectorWindow).BarcodeDetector;
      if (!Detector) {
        setMessage("Built-in QR scanning is unsupported in this browser. Close this dialog and paste the token manually.");
        return;
      }
      try {
        stream = await navigator.mediaDevices.getUserMedia({
          audio: false,
          video: { facingMode: { ideal: "environment" } },
        });
        if (stopped) {
          stream.getTracks().forEach((track) => track.stop());
          return;
        }
        const video = videoRef.current;
        if (!video) {
          setMessage("Camera preview could not start. Please paste the token manually.");
          return;
        }
        video.srcObject = stream;
        await video.play();
        const detector = new Detector({ formats: ["qr_code"] });
        setMessage("Point the camera at the current station QR code.");
        const scanFrame = async () => {
          if (stopped || !videoRef.current) return;
          if (video.readyState >= HTMLMediaElement.HAVE_CURRENT_DATA) {
            try {
              const codes = await detector.detect(video);
              const token = codes.find((code) => code.rawValue?.trim())?.rawValue?.trim();
              if (token) {
                stop();
                onScan(token);
                onOpenChange(false);
                return;
              }
            } catch {
              setMessage("Could not read this QR yet. Hold the camera steady or paste the token manually.");
            }
          }
          if (!stopped) frameId = window.requestAnimationFrame(() => void scanFrame());
        };
        frameId = window.requestAnimationFrame(() => void scanFrame());
      } catch {
        setMessage("Camera permission was denied or the camera is unavailable. Close this dialog and paste the token manually.");
      }
    };

    void start();
    return stop;
  }, [open, onOpenChange, onScan]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Scan station QR</DialogTitle>
          <DialogDescription>The station QR is single-use and expires quickly. Scan the current code issued by the Owner.</DialogDescription>
        </DialogHeader>
        <video ref={videoRef} autoPlay playsInline muted aria-label="Camera preview for station QR scanning" className="max-h-[55vh] w-full rounded-lg bg-black object-contain" />
        <p role="status" aria-live="polite" className="text-sm text-muted-foreground">{message}</p>
        <DialogFooter>
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Close scanner</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
