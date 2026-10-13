import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { useEffect, useRef, useState } from "react";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { listOrderMessages, sendOrderMessage } from "@/lib/messages.functions";
import { cn } from "@/lib/utils";

function time(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/**
 * One message thread per order, shared by the customer order screen and the
 * owner/staff order list. The thread is filtered by `orderId` on the server, so
 * messages never cross between orders.
 */
export function OrderMessages({
  orderId,
  autoFocus = false,
  customerName,
  ownerView = false,
}: {
  orderId: string;
  autoFocus?: boolean;
  customerName?: string;
  ownerView?: boolean;
}) {
  const fetchThread = useServerFn(listOrderMessages);
  const send = useServerFn(sendOrderMessage);
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const thread = useQuery({
    queryKey: ["order-messages", orderId],
    queryFn: () => fetchThread({ data: { orderId } }),
    refetchInterval: 30_000,
  });

  useEffect(() => {
    if (autoFocus) inputRef.current?.focus();
  }, [autoFocus]);

  const mutation = useMutation({
    mutationFn: (text: string) => send({ data: { orderId, body: text } }),
    onSuccess: () => {
      setBody("");
      void queryClient.invalidateQueries({ queryKey: ["order-messages", orderId] });
      void queryClient.invalidateQueries({ queryKey: ["owner-orders"] });
      void queryClient.invalidateQueries({ queryKey: ["customer", "notifications"] });
    },
    onError: (error) =>
      toast.error(error instanceof Error ? error.message : "We couldn't send this message."),
  });

  const messages = thread.data?.messages ?? [];
  const viewerRole = thread.data?.viewerRole ?? "customer";

  return (
    <div className="space-y-3">
      {ownerView ? (
        <div className="border-b border-border/70 pb-3">
          <p className="text-xs font-bold uppercase text-destructive">Customer conversation</p>
          <p className="mt-0.5 break-words font-display text-lg font-black text-foreground">
            {customerName || "Customer"}
          </p>
        </div>
      ) : null}
      {thread.isPending ? (
        <p className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> Loading messages…
        </p>
      ) : thread.isError ? (
        <p role="alert" className="rounded-lg border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">
          {thread.error instanceof Error ? thread.error.message : "We couldn't load these messages."}
        </p>
      ) : messages.length === 0 ? (
        <p className="flex items-center gap-2 rounded-lg border border-border/70 bg-secondary/40 px-3 py-2.5 text-sm text-muted-foreground">
          <MessageCircle className="h-4 w-4 shrink-0" aria-hidden="true" />
          No messages for this order yet.
        </p>
      ) : (
        <ul className="max-h-72 space-y-2 overflow-y-auto overscroll-contain pr-1" aria-label="Order conversation">
          {messages.map((m) => {
            const own = m.senderRole === viewerRole;
            return (
              <li
                key={m.id}
                className={cn("flex", own ? "justify-end" : "justify-start")}
              >
                <div
                  className={cn(
                    "max-w-[85%] rounded-2xl px-3 py-2 text-sm",
                    ownerView
                      ? own
                        ? "bg-primary text-primary-foreground"
                        : "border border-destructive/70 bg-destructive text-destructive-foreground"
                      : own
                        ? "bg-primary text-primary-foreground"
                        : "border border-border/70 bg-secondary text-foreground",
                  )}
                >
                  <p className="whitespace-pre-wrap break-words">{m.body}</p>
                  {!(ownerView && m.senderRole === "customer") ? (
                    <p
                      className={cn(
                        "mt-1 text-[11px]",
                        own
                          ? "text-primary-foreground/70"
                          : ownerView
                            ? "text-destructive-foreground/80"
                            : "text-muted-foreground",
                      )}
                    >
                      {m.senderName ?? (m.senderRole === "staff" ? "Flamio" : "Customer")} ·{" "}
                      {time(m.createdAt)}
                    </p>
                  ) : null}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <form
        className="flex gap-2"
        onSubmit={(event) => {
          event.preventDefault();
          const text = body.trim();
          if (!text) return;
          void mutation.mutateAsync(text);
        }}
      >
        <Input
          ref={inputRef}
          value={body}
          onChange={(event) => setBody(event.target.value)}
          maxLength={1000}
          placeholder="Write a message about this order…"
          aria-label="Message about this order"
        />
        <Button type="submit" size="icon" disabled={mutation.isPending || body.trim().length === 0}>
          {mutation.isPending ? (
            <Loader2 className="animate-spin" aria-hidden="true" />
          ) : (
            <Send aria-hidden="true" />
          )}
          <span className="sr-only">Send message</span>
        </Button>
      </form>
    </div>
  );
}
