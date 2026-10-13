import { useQuery } from "@tanstack/react-query";
import { createFileRoute } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { MessageCircle } from "lucide-react";

import { ContactThread } from "@/components/contact/ContactThread";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { getMyContactThread, sendMyContactMessage } from "@/lib/contact-messages.functions";

export const Route = createFileRoute("/_authenticated/account/inbox")({
  head: () => ({ meta: [
    { title: "Inbox — Flamio" },
    { name: "description", content: "Message the Flamio team and view your conversation." },
    { property: "og:title", content: "Inbox — Flamio" },
    { property: "og:description", content: "Message the Flamio team and view your conversation." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: CustomerInbox,
});

function CustomerInbox() {
  const getThread = useServerFn(getMyContactThread);
  const sendMessage = useServerFn(sendMyContactMessage);
  const thread = useQuery({ queryKey: ["contact-inbox", "mine"], queryFn: () => getThread(), refetchInterval: 20_000, retry: false });
  return (
    <div className="mx-auto w-full max-w-2xl px-4 py-6 pb-28 sm:px-6">
      <div className="mb-4 flex items-center gap-3"><MessageCircle className="size-6 text-primary" /><div><h1 className="font-display text-2xl font-bold">Flamio Inbox</h1><p className="text-sm text-muted-foreground">Message our team directly.</p></div></div>
      <Card><CardContent className="p-4">
        {thread.isPending ? <Skeleton className="h-52 w-full" /> : thread.isError ? <p className="text-sm text-destructive">{thread.error instanceof Error && thread.error.message ? thread.error.message : "We couldn't load your inbox. Please try again."}</p> : (
          <ContactThread messages={thread.data?.messages ?? []} viewerRole="customer" queryKeys={[["contact-inbox", "mine"]]} send={(body) => sendMessage({ data: { body } })} />
        )}
      </CardContent></Card>
    </div>
  );
}
