import type { ErpState, Lot, Product, SaleLine, StockMovement } from "./types";

export const roundMoney = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;

export function calculateSale(lines: SaleLine[]) {
  return lines.reduce(
    (result, line) => {
      const gross = line.quantity * line.unitPrice;
      const net = gross * (1 - line.discountRate / 100);
      const vat = net * (line.vatRate / 100);
      result.subtotal = roundMoney(result.subtotal + net);
      result.vat = roundMoney(result.vat + vat);
      result.total = roundMoney(result.subtotal + result.vat);
      return result;
    },
    { subtotal: 0, vat: 0, total: 0 },
  );
}

export function stockByProduct(products: Product[], movements: StockMovement[]) {
  return products.map((product) => {
    const quantity = movements
      .filter((movement) => movement.productId === product.id)
      .reduce(
        (sum, movement) => sum + (movement.direction === "in" ? movement.quantity : -movement.quantity),
        0,
      );
    return { ...product, quantity, isLow: quantity <= product.reorderPoint };
  });
}

export function lotQuantity(lotId: string, movements: StockMovement[]) {
  return movements
    .filter((movement) => movement.lotId === lotId)
    .reduce(
      (sum, movement) => sum + (movement.direction === "in" ? movement.quantity : -movement.quantity),
      0,
    );
}

export function daysUntil(date: string, today = new Date()) {
  const target = new Date(`${date}T00:00:00`);
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.ceil((target.getTime() - start.getTime()) / 86_400_000);
}

export function lotRisk(lot: Lot, today = new Date()) {
  if (lot.status !== "released") return lot.status;
  const days = daysUntil(lot.expiresAt, today);
  if (days < 0) return "expired";
  if (days <= 60) return "expiring";
  return "normal";
}

export function nextRunningNumber(prefix: string, existing: string[], year = new Date().getFullYear()) {
  const pattern = new RegExp(`^${prefix}-${year}-(\\d+)$`);
  const max = existing.reduce((current, value) => {
    const match = value.match(pattern);
    return match ? Math.max(current, Number(match[1])) : current;
  }, 0);
  return `${prefix}-${year}-${String(max + 1).padStart(4, "0")}`;
}

export function summarize(state: ErpState) {
  const postedSales = state.salesDocuments.filter(
    (document) => document.type === "tax_invoice" && document.status === "posted",
  );
  const revenue = postedSales.reduce((sum, document) => sum + document.subtotal, 0);
  const receivable = postedSales.reduce(
    (sum, document) => sum + Math.max(document.total - document.paidAmount, 0),
    0,
  );
  const lowStock = stockByProduct(state.products, state.movements).filter((product) => product.isLow).length;
  const qaHold = state.lots.filter((lot) => lot.status === "hold").length;
  return { revenue: roundMoney(revenue), receivable: roundMoney(receivable), lowStock, qaHold };
}
