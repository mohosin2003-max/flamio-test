import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader2, MessageCircle, Send } from "lucide-react";
import { useRef, useState } from "react";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { ContactMessage } from "@/lib/contact-messages.functions";
import { cn } from "@/lib/utils";

function messageTime(iso: string) {
  return new Date(iso).toLocaleString(undefined, { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ContactThread({ messages, viewerRole, queryKeys, send }: {
  messages: ContactMessage[];
  viewerRole: "customer" | "staff";
  queryKeys: readonly unknown[][];
  send: (body: string) => Promise<unknown>;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const mutation = useMutation({
    mutationFn: send,
    onSuccess: async () => {
      setBody("");
      await Promise.all(queryKeys.map((key) => queryClient.invalidateQueries({ queryKey: key })));
      inputRef.current?.focus();
    },
  });
  return <div className="space-y-3">
    {messages.length === 0 ? <p className="flex items-center gap-2 rounded-lg border border-border/70 bg-secondary/40 px-3 py-3 text-sm text-muted-foreground"><MessageCircle className="size-4" aria-hidden="true" /> No messages yet.</p> : <ul className="max-h-[52vh] space-y-2 overflow-y-auto pr-1">{messages.map((message) => {
      const own = message.senderRole === viewerRole;
      return <li key={message.id} className={cn("flex", own ? "justify-end" : "justify-start")}><div className={cn("max-w-[86%] rounded-lg px-3 py-2 text-sm", own ? "bg-primary text-primary-foreground" : "border border-border bg-secondary")}><p className="whitespace-pre-wrap break-words">{message.body}</p><p className={cn("mt-1 text-[11px]", own ? "text-primary-foreground/70" : "text-muted-foreground")}>{message.senderName ?? (message.senderRole === "staff" ? "Flamio" : "Customer")} · {messageTime(message.createdAt)}</p></div></li>;
    })}</ul>}
    {mutation.error ? <p className="text-sm text-destructive">{mutation.error instanceof Error ? mutation.error.message : "Message failed."}</p> : null}
    <form className="flex gap-2" onSubmit={(event) => { event.preventDefault(); const text = body.trim(); if (text) void mutation.mutateAsync(text); }}>
      <Input ref={inputRef} value={body} onChange={(event) => setBody(event.target.value)} maxLength={1000} placeholder="Write a message…" aria-label="Message" />
      <Button type="submit" size="icon" disabled={mutation.isPending || !body.trim()} aria-label="Send message">{mutation.isPending ? <Loader2 className="animate-spin" aria-hidden="true" /> : <Send aria-hidden="true" />}</Button>
    </form>
  </div>;
}
