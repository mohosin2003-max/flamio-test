/**
 * Thermal receipt printing for counter sales.
 *
 * This is presentation only: it reads an ALREADY SAVED order and renders it
 * into a hidden iframe that the browser prints. It never creates, changes or
 * re-submits an order, never touches payments, inventory or order status, and
 * a failed/cancelled print has no effect on any saved data.
 */

export type ReceiptItem = {
  productName: string;
  variantName?: string | null;
  quantity: number;
  unitPrice: number;
};

export type ReceiptData = {
  brandName: string;
  logoUrl: string | null;
  restaurantPhone?: string | null;
  restaurantEmail?: string | null;
  restaurantAddress?: string | null;
  orderCode: string;
  orderId?: string | null;
  createdAt: string;
  cashierName?: string | null;
  customerName?: string | null;
  customerPhone?: string | null;
  items: ReceiptItem[];
  subtotal: number;
  discount: number;
  deliveryCharge: number;
  total: number;
  paymentLabel: string;
  reprint?: boolean;
};

function money(value: number): string {
  return `Tk ${Math.round(value).toLocaleString("en-US")}`;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function stamp(iso: string): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  return date.toLocaleString("en-GB", {
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Compact 58/80mm thermal layout. Only the receipt prints — never the app UI. */
export function buildReceiptHtml(data: ReceiptData): string {
  const rows = data.items
    .map((item) => {
      const name = escapeHtml(
        item.variantName ? `${item.productName} (${item.variantName})` : item.productName,
      );
      return `<tr><td class="n">${name}<div class="s">${item.quantity} x ${money(
        item.unitPrice,
      )}</div></td><td class="a">${money(item.unitPrice * item.quantity)}</td></tr>`;
    })
    .join("");

  const contact = [data.restaurantAddress, data.restaurantPhone, data.restaurantEmail]
    .filter((line): line is string => Boolean(line && line.trim()))
    .map((line) => `<div>${escapeHtml(line.trim())}</div>`)
    .join("");

  const meta: string[] = [
    `<div><span>Order</span><b>${escapeHtml(data.orderCode)}</b></div>`,
    `<div><span>Date</span><b>${escapeHtml(stamp(data.createdAt))}</b></div>`,
  ];
  if (data.cashierName?.trim())
    meta.push(`<div><span>Cashier</span><b>${escapeHtml(data.cashierName.trim())}</b></div>`);
  if (data.customerName?.trim())
    meta.push(`<div><span>Customer</span><b>${escapeHtml(data.customerName.trim())}</b></div>`);
  if (data.customerPhone?.trim() && data.customerPhone.trim() !== "000000")
    meta.push(`<div><span>Phone</span><b>${escapeHtml(data.customerPhone.trim())}</b></div>`);

  return `<!doctype html><html><head><meta charset="utf-8"><title>${escapeHtml(
    data.orderCode,
  )}</title><style>
@page { size: 80mm auto; margin: 3mm; }
* { box-sizing: border-box; }
body { margin: 0; width: 72mm; font-family: "Courier New", ui-monospace, monospace; font-size: 11px; line-height: 1.35; color: #000; }
.c { text-align: center; }
img.logo { max-width: 34mm; max-height: 18mm; object-fit: contain; }
h1 { margin: 2px 0 1px; font-size: 15px; letter-spacing: .5px; }
.sm { font-size: 10px; }
hr { border: 0; border-top: 1px dashed #000; margin: 5px 0; }
.meta div { display: flex; justify-content: space-between; gap: 6px; }
.meta span { color: #000; }
table { width: 100%; border-collapse: collapse; }
td { vertical-align: top; padding: 1px 0; }
td.n { padding-right: 4px; }
td.a { text-align: right; white-space: nowrap; }
.s { font-size: 10px; }
.tot div { display: flex; justify-content: space-between; gap: 6px; }
.grand { font-size: 13px; font-weight: 700; border-top: 1px dashed #000; padding-top: 3px; margin-top: 3px; }
.tag { margin-top: 6px; font-size: 10px; }
</style></head><body>
<div class="c">
  ${data.logoUrl ? `<img class="logo" src="${escapeHtml(data.logoUrl)}" alt="">` : ""}
  <h1>${escapeHtml(data.brandName)}</h1>
  <div class="sm">${contact}</div>
  ${data.reprint ? `<div class="sm">** REPRINT **</div>` : ""}
</div>
<hr>
<div class="meta sm">${meta.join("")}</div>
<hr>
<table>${rows}</table>
<hr>
<div class="tot">
  <div><span>Subtotal</span><span>${money(data.subtotal)}</span></div>
  ${data.discount > 0 ? `<div><span>Discount</span><span>-${money(data.discount)}</span></div>` : ""}
  ${data.deliveryCharge > 0 ? `<div><span>Delivery</span><span>${money(data.deliveryCharge)}</span></div>` : ""}
  <div class="grand"><span>TOTAL</span><span>${money(data.total)}</span></div>
  <div class="sm"><span>Payment</span><span>${escapeHtml(data.paymentLabel)}</span></div>
</div>
<div class="c tag">Thank you for your order!<br>Please visit again.</div>
</body></html>`;
}

/**
 * Opens the system print dialog for a single receipt using a hidden iframe.
 * Resolves once the dialog has been dismissed (printed or cancelled) — the
 * caller must treat both the same way, since the order is already saved.
 */
export async function printReceipt(data: ReceiptData): Promise<void> {
  if (typeof document === "undefined") return;

  const iframe = document.createElement("iframe");
  iframe.setAttribute("aria-hidden", "true");
  iframe.style.position = "fixed";
  iframe.style.right = "0";
  iframe.style.bottom = "0";
  iframe.style.width = "0";
  iframe.style.height = "0";
  iframe.style.border = "0";
  iframe.style.visibility = "hidden";
  document.body.appendChild(iframe);

  const cleanup = () => {
    window.setTimeout(() => iframe.remove(), 1000);
  };

  try {
    const doc = iframe.contentDocument;
    const win = iframe.contentWindow;
    if (!doc || !win) throw new Error("print-unavailable");

    doc.open();
    doc.write(buildReceiptHtml(data));
    doc.close();

    // Give the logo a chance to load, but never block printing on it.
    const image = doc.querySelector("img.logo");
    if (image) {
      await new Promise<void>((resolve) => {
        const done = () => resolve();
        const timer = window.setTimeout(done, 1500);
        const finish = () => {
          window.clearTimeout(timer);
          done();
        };
        if ((image as HTMLImageElement).complete) finish();
        else {
          image.addEventListener("load", finish, { once: true });
          image.addEventListener("error", finish, { once: true });
        }
      });
    }

    win.focus();
    win.print();
  } finally {
    cleanup();
  }
}
