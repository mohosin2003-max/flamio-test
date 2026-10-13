import { Link, createFileRoute } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useServerFn } from "@tanstack/react-start";
import { ArrowLeft } from "lucide-react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/states";
import { Skeleton } from "@/components/ui/skeleton";
import { CustomerProfile } from "@/components/owner/CustomerProfile";
import { crmGetCustomer } from "@/lib/crm.functions";

/**
 * One customer. The route parameter is the customer's normalised phone number,
 * which is how the existing customer list already groups orders.
 */
export const Route = createFileRoute("/_authenticated/owner/customers/$customerId")({
  head: () => ({
    meta: [
      { title: "Customer Profile — Flamio CRM" },
      { name: "description", content: "View one Flamio customer profile and order history." },
      { property: "og:title", content: "Customer Profile — Flamio CRM" },
      { property: "og:description", content: "View one Flamio customer profile and order history." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary" },
      { name: "robots", content: "noindex" },
    ],
  }),
  component: OwnerCustomerProfile,
});

function OwnerCustomerProfile() {
  const { customerId } = Route.useParams();
  const fetchCustomer = useServerFn(crmGetCustomer);

  const detail = useQuery({
    queryKey: ["crm-customer", customerId],
    queryFn: () => fetchCustomer({ data: { phone: customerId } }),
    retry: false,
  });

  return (
    <div className="space-y-4">
      <Button asChild variant="ghost" size="sm" className="-ml-2">
        <Link to="/owner/customers">
          <ArrowLeft className="mr-1.5 h-4 w-4" /> All customers
        </Link>
      </Button>

      {detail.isLoading ? (
        <Skeleton className="h-96 w-full" />
      ) : detail.error || !detail.data ? (
        <EmptyState
          title="Couldn't load this customer"
          description={
            detail.error instanceof Error
              ? detail.error.message
              : "Something went wrong loading this customer."
          }
          action={<Button onClick={() => void detail.refetch()}>Try again</Button>}
        />
      ) : (
        <CustomerProfile detail={detail.data} phoneKey={customerId} />
      )}
    </div>
  );
}
