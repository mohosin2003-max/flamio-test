/**
 * Owner → Customers → one customer → Communication.
 *
 * Shows which channels can genuinely reach this customer, what they may
 * receive, the full history, and — for staff allowed to send — one composer
 * that reuses the existing inbox, push, SMS, WhatsApp and email paths.
 */
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useServerFn } from "@tanstack/react-start";
import { useMemo, useState } from "react";
import { Ban, Check, MessageCircle, Send, X } from "lucide-react";
import { toast } from "sonner";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import {
  crmGetCommunication,
  crmSendCustomerMessage,
  crmSetMarketingConsent,
} from "@/lib/crm-communication.functions";
import type { ChannelState, CommunicationChannel } from "@/lib/crm-communication.functions";

const CHANNEL_LABELS: Record<CommunicationChannel, string> = {
  in_app: "In-app inbox",
  push: "Phone / browser push",
  sms: "SMS",
  whatsapp: "WhatsApp",
  email: "Email",
};

function StateBadge({ state }: { state: ChannelState }) {
  if (state === "available") {
    return (
      <Badge>
        <Check className="mr-1 h-3 w-3" /> Available
      </Badge>
    );
  }
  if (state === "unavailable") {
    return (
      <Badge variant="secondary">
        <X className="mr-1 h-3 w-3" /> Unavailable
      </Badge>
    );
  }
  return (
    <Badge variant="outline">
      <Ban className="mr-1 h-3 w-3" /> Not configured
    </Badge>
  );
}

const newRequestId = () =>
  typeof crypto !== "undefined" && "randomUUID" in crypto
    ? crypto.randomUUID()
    : `req-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export function CustomerCommunication({ phoneKey }: { phoneKey: string }) {
  const fetchCommunication = useServerFn(crmGetCommunication);
  const sendMessage = useServerFn(crmSendCustomerMessage);
  const setConsent = useServerFn(crmSetMarketingConsent);
  const queryClient = useQueryClient();

  const view = useQuery({
    queryKey: ["crm-communication", phoneKey],
    queryFn: () => fetchCommunication({ data: { phone: phoneKey } }),
    retry: false,
  });
  const refresh = () =>
    queryClient.invalidateQueries({ queryKey: ["crm-communication", phoneKey] });

  const [channel, setChannel] = useState<CommunicationChannel | null>(null);
  const [category, setCategory] = useState<"service" | "transactional" | "marketing">("service");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [requestId, setRequestId] = useState(newRequestId);
  const [sending, setSending] = useState(false);

  const data = view.data;
  const activeChannel = useMemo<CommunicationChannel | null>(
    () => channel ?? data?.sendableChannels[0] ?? null,
    [channel, data?.sendableChannels],
  );

  if (view.isLoading) return <Skeleton className="h-64 w-full" />;
  if (view.error || !data) {
    return (
      <Card>
        <CardContent className="p-4 text-sm text-muted-foreground">
          Communication details aren&apos;t available for this customer.
        </CardContent>
      </Card>
    );
  }

  const submit = async () => {
    if (!activeChannel || !body.trim()) return;
    setSending(true);
    try {
      const result = await sendMessage({
        data: {
          phone: phoneKey,
          channel: activeChannel,
          category,
          subject: activeChannel === "email" ? subject.trim() || null : null,
          body: body.trim(),
          requestId,
        },
      });
      if (result.ok) {
        toast.success(result.duplicate ? "This message was already sent." : result.message);
        setBody("");
        setSubject("");
        setRequestId(newRequestId());
        await refresh();
      } else {
        toast.error(result.message);
      }
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "The message couldn't be sent.");
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <h3 className="font-display text-base font-bold">Communication</h3>
        <Badge variant={data.accountLinked ? "default" : "secondary"}>
          {data.accountLinked ? "Account" : "Guest"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          Phone on file: {data.hasPhone ? "yes" : "no"} · Email on file:{" "}
          {data.hasEmail ? "yes" : "no"}
        </span>
      </div>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Channels
          </p>
          {data.channels.map((row) => (
            <div
              key={row.channel}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{row.label}</p>
                <p className="text-xs text-muted-foreground">{row.detail}</p>
              </div>
              <StateBadge state={row.state} />
            </div>
          ))}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-2 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            What this customer may receive
          </p>
          {data.preferences.map((preference) => (
            <div
              key={preference.category}
              className="flex flex-wrap items-center justify-between gap-2 border-b border-border/60 py-2 last:border-0"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold">{preference.label}</p>
                <p className="text-xs text-muted-foreground">{preference.detail}</p>
              </div>
              <Badge variant={preference.enabled ? "default" : "secondary"}>
                {preference.enabled ? "On" : "Off"}
              </Badge>
            </div>
          ))}

          {data.canSend ? (
            <div className="space-y-2 border-t border-border pt-3">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Promotional consent
              </p>
              {data.marketingOptIns.map((row) => (
                <div key={row.channel} className="flex items-center justify-between gap-2 py-1">
                  <span className="text-sm">{CHANNEL_LABELS[row.channel]}</span>
                  <Switch
                    checked={row.optedIn}
                    aria-label={`Marketing consent for ${CHANNEL_LABELS[row.channel]}`}
                    onCheckedChange={async (checked) => {
                      try {
                        await setConsent({
                          data: { phone: phoneKey, channel: row.channel, optedIn: checked },
                        });
                        await refresh();
                      } catch (error) {
                        toast.error(
                          error instanceof Error ? error.message : "Couldn't save the consent",
                        );
                      }
                    }}
                  />
                </div>
              ))}
              <p className="text-xs text-muted-foreground">
                Order updates and service replies are never blocked by this. Promotions are only
                sent on a channel the customer has agreed to.
              </p>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="space-y-3 p-4">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Message this customer
          </p>

          {!data.canSend ? (
            <p className="text-sm text-muted-foreground">
              You can see this customer&apos;s communication, but sending is not part of your
              access.
            </p>
          ) : data.sendableChannels.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No channel can reach this customer right now. The channel list above explains what is
              missing for each one.
            </p>
          ) : (
            <>
              <div className="space-y-1.5">
                <Label>Send by</Label>
                <div className="flex flex-wrap gap-2">
                  {data.sendableChannels.map((option) => (
                    <Button
                      key={option}
                      size="sm"
                      variant={activeChannel === option ? "default" : "outline"}
                      onClick={() => setChannel(option)}
                    >
                      {CHANNEL_LABELS[option]}
                    </Button>
                  ))}
                </div>
              </div>

              <div className="space-y-1.5">
                <Label>Message type</Label>
                <div className="flex flex-wrap gap-2">
                  {(["service", "transactional", "marketing"] as const).map((option) => (
                    <Button
                      key={option}
                      size="sm"
                      variant={category === option ? "default" : "outline"}
                      onClick={() => setCategory(option)}
                    >
                      {option === "service"
                        ? "Service reply"
                        : option === "transactional"
                          ? "Order update"
                          : "Promotion"}
                    </Button>
                  ))}
                </div>
              </div>

              {activeChannel === "email" ? (
                <div className="space-y-1.5">
                  <Label htmlFor="comm-subject">Subject</Label>
                  <Input
                    id="comm-subject"
                    value={subject}
                    placeholder="A message from Flamio"
                    onChange={(e) => setSubject(e.target.value)}
                  />
                </div>
              ) : null}

              <div className="space-y-1.5">
                <Label htmlFor="comm-body">Message</Label>
                <Textarea
                  id="comm-body"
                  rows={4}
                  maxLength={1200}
                  value={body}
                  placeholder="Write the message this customer will receive…"
                  onChange={(e) => setBody(e.target.value)}
                />
              </div>

              <Button size="sm" disabled={sending || !body.trim()} onClick={() => void submit()}>
                <Send className="mr-1.5 h-3.5 w-3.5" />
                {sending ? "Sending…" : "Send message"}
              </Button>

              {data.accountLinked ? (
                <Button asChild size="sm" variant="outline">
                  <Link to="/owner/inbox">
                    <MessageCircle className="mr-1.5 h-3.5 w-3.5" />
                    {data.conversationId ? "Open in inbox" : "Go to inbox"}
                  </Link>
                </Button>
              ) : null}
            </>
          )}
        </CardContent>
      </Card>

      {data.canSeeHistory ? (
        <Card>
          <CardContent className="space-y-2 p-4">
            <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Communication history
            </p>
            {data.history.length === 0 ? (
              <p className="text-sm text-muted-foreground">Nothing has been sent yet.</p>
            ) : (
              data.history.map((item) => (
                <div key={item.id} className="border-b border-border/60 py-2 text-sm last:border-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-semibold">{item.title}</span>
                    <Badge variant="outline">{item.category}</Badge>
                    <Badge
                      variant={
                        item.status === "failed" || item.status === "cancelled"
                          ? "destructive"
                          : "secondary"
                      }
                    >
                      {item.status}
                    </Badge>
                    <span className="text-xs text-muted-foreground">
                      {item.createdAt.slice(0, 16).replace("T", " ")}
                    </span>
                  </div>
                  {item.preview ? (
                    <p className="text-xs text-muted-foreground">{item.preview}</p>
                  ) : null}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      ) : null}
    </div>
  );
}
