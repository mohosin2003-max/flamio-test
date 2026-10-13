import { createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { Copy, TicketPercent } from "lucide-react";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { formatBDT } from "@/lib/format";
import { listMyVouchers } from "@/lib/rewards.functions";

export const Route = createFileRoute("/_authenticated/account/vouchers")({
  head: () => ({ meta: [
    { title: "My Vouchers — Flamio" },
    { name: "description", content: "View active Flamio voucher codes." },
    { property: "og:title", content: "My Vouchers — Flamio" },
    { property: "og:description", content: "View active Flamio voucher codes." },
    { property: "og:type", content: "website" },
    { name: "twitter:card", content: "summary" },
    { name: "robots", content: "noindex" },
  ] }),
  component: VouchersPage,
});

function VouchersPage() {
  const list = useServerFn(listMyVouchers);
  const vouchers = useQuery({ queryKey: ["my-vouchers"], queryFn: () => list() });
  return <div className="mx-auto w-full max-w-2xl px-4 py-8 pb-28 sm:px-6 sm:py-12">
    <h1 className="font-display text-3xl font-black">My Vouchers</h1>
    <p className="mt-2 text-sm text-muted-foreground">Use an active code at checkout.</p>
    {vouchers.isLoading ? <Skeleton className="mt-6 h-48 w-full" /> : vouchers.data?.length ? <div className="mt-6 space-y-3">{vouchers.data.map((voucher) => <div key={voucher.id} className="flex items-center gap-4 rounded-xl border border-dashed border-primary/40 bg-card p-4"><span className="grid size-11 shrink-0 place-items-center rounded-full bg-primary/10 text-primary"><TicketPercent className="size-5" /></span><div className="min-w-0 flex-1"><p className="font-bold">{voucher.code}</p><p className="text-sm text-muted-foreground">{voucher.description ?? (voucher.discount_type === "percent" ? `${voucher.discount_value}% off` : `${formatBDT(voucher.discount_value)} off`)}</p>{voucher.expires_on ? <p className="mt-1 text-xs text-muted-foreground">Valid until {voucher.expires_on}</p> : null}</div><Button size="icon" variant="ghost" aria-label={`Copy ${voucher.code}`} onClick={() => { void navigator.clipboard.writeText(voucher.code); toast.success("Voucher code copied"); }}><Copy className="size-4" /></Button></div>)}</div> : <div className="mt-6"><EmptyState title="No vouchers available" description="Active Flamio vouchers will appear here." /></div>}
  </div>;
}