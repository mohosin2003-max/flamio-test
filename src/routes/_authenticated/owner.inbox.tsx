import { useQuery, useQueryClient } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle } from "lucide-react";
import { useState } from "react";

import { ContactThread } from "@/components/contact/ContactThread";
import { RecoveryRequestNotices } from "@/components/layout/RecoveryRequestNotices";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { ownerGetContactThread, ownerListContactThreads, ownerSendContactReply } from "@/lib/contact-messages.functions";

export const Route = createFileRoute("/_authenticated/owner/inbox")({
  head: () => ({ meta: [
    { title: "Customer Inbox — Flamio" },
    { name: "description", content: "Read and reply to Flamio customer conversations." },
    { property: "og:title", content: "Customer Inbox — Flamio" },
    { property: "og:description", content: "Read and reply to Flamio customer conversations." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: OwnerInbox,
});

function OwnerInbox() {
  const listThreads = useServerFn(ownerListContactThreads);
  const getThread = useServerFn(ownerGetContactThread);
  const reply = useServerFn(ownerSendContactReply);
  const queryClient = useQueryClient();
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const threads = useQuery({ queryKey: ["contact-inbox", "owner"], queryFn: () => listThreads(), refetchInterval: 20_000 });
  const selected = useQuery({
    queryKey: ["contact-inbox", "thread", selectedId],
    queryFn: () => getThread({ data: { conversationId: selectedId ?? "" } }),
    enabled: Boolean(selectedId),
    refetchInterval: 20_000,
  });
  if (threads.isPending) return <Skeleton className="h-72 w-full" />;
  if (threads.isError) return <EmptyState title="Couldn't load the inbox" description="Please try again." action={<Button onClick={() => void threads.refetch()}>Retry</Button>} />;
  return (
    <div className="grid gap-4 md:grid-cols-[18rem_1fr]">
      <div className="space-y-2">
        <div className="mb-3 flex items-center gap-2"><MessageCircle className="size-5 text-primary" /><h2 className="font-display text-xl font-bold">Customer inbox</h2></div>
        <div className="overflow-hidden rounded-xl border border-border/70 bg-card"><RecoveryRequestNotices /></div>
        {threads.data?.length ? threads.data.map((thread) => (
          <Button key={thread.id} variant={selectedId === thread.id ? "secondary" : "outline"} className={thread.unreadCount ? "h-auto w-full justify-between border-destructive/60 bg-destructive/10 px-3 py-3 text-left" : "h-auto w-full justify-between px-3 py-3 text-left"} onClick={() => { setSelectedId(thread.id); void queryClient.setQueryData(["contact-inbox", "owner"], (current: typeof threads.data) => current?.map((row) => row.id === thread.id ? { ...row, unreadCount: 0 } : row)); }}>
            <span className="min-w-0"><span className="block truncate font-semibold">{thread.customerName ?? "Customer"}</span><span className="block text-xs text-muted-foreground">{thread.customerPhone ?? "No phone"}</span></span>
            {thread.unreadCount ? <Badge variant="destructive">{thread.unreadCount}</Badge> : null}
          </Button>
        )) : <EmptyState title="No conversations" description="Customer messages will appear here." />}
      </div>
      <Card><CardContent className="p-4">
        {!selectedId ? <p className="py-12 text-center text-sm text-muted-foreground">Choose a conversation.</p> : selected.isPending ? <Skeleton className="h-52 w-full" /> : selected.isError ? <p className="text-sm text-destructive">We couldn't load this conversation.</p> : (
          <ContactThread messages={selected.data?.messages ?? []} viewerRole="staff" queryKeys={[["contact-inbox", "thread", selectedId], ["contact-inbox", "owner"]]} send={(body) => reply({ data: { conversationId: selectedId, body } })} />
        )}
      </CardContent></Card>
    </div>
  );
}
