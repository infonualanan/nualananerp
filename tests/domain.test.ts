import assert from "node:assert/strict";
import test from "node:test";
import { calculateSale, lotRisk, nextRunningNumber, stockByProduct, summarize } from "../lib/domain.ts";
import { seedState } from "../lib/seed.ts";

test("คำนวณยอดก่อน VAT และ VAT แยกตามรายการ", () => {
  const result = calculateSale([
    { productId: "p1", description: "สินค้า A", quantity: 2, unitPrice: 100, discountRate: 10, vatRate: 7 },
    { productId: "p2", description: "สินค้าส่งออก", quantity: 1, unitPrice: 50, discountRate: 0, vatRate: 0 },
  ]);
  assert.deepEqual(result, { subtotal: 230, vat: 12.6, total: 242.6 });
});

test("สต็อกคำนวณจาก Stock Movement เท่านั้น", () => {
  const stock = stockByProduct(seedState.products, seedState.movements);
  assert.equal(stock.find((product) => product.id === "p1")?.quantity, 295);
  assert.equal(stock.find((product) => product.id === "p2")?.quantity, 130);
});

test("Dashboard นับรายได้เฉพาะใบกำกับภาษีที่ลงบัญชีแล้ว", () => {
  const result = summarize(seedState);
  assert.equal(result.revenue, 4160);
  assert.equal(result.receivable, 2451.2);
});

test("เลขเอกสารรันต่อภายในปีและประเภทเดียวกัน", () => {
  assert.equal(nextRunningNumber("SO", ["SO-2026-0002", "SO-2026-0011", "QT-2026-0099"], 2026), "SO-2026-0012");
});

test("Lot ที่เหลือไม่เกิน 60 วันถูกเตือน", () => {
  assert.equal(
    lotRisk(
      { id: "l", productId: "p", lotNo: "L1", receivedAt: "2026-01-01", expiresAt: "2026-09-30", status: "released" },
      new Date("2026-08-14"),
    ),
    "expiring",
  );
});
