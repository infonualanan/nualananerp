"use client";

import { useEffect, useMemo, useState } from "react";
import { calculateSale, nextRunningNumber } from "@/lib/domain";
import { seedState } from "@/lib/seed";
import type { AuditEntry, DocumentStatus, ErpState, LotStatus, Role } from "@/lib/types";

const STORAGE_KEY = "nualanan-erp-v2-demo";

const cloneSeed = () => structuredClone(seedState);
const nowIso = () => new Date().toISOString();
const id = () => `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

const actorByRole: Record<Role, string> = {
  ceo: "Cap · CEO",
  accounting: "คุณฟ้า · บัญชี",
  sales: "ฝ่ายขาย",
  warehouse: "คลังสินค้า",
  production: "ฝ่ายผลิต",
  qa: "คุณไม้ · QA",
};

export type NewSaleInput = {
  customerId: string;
  productId: string;
  quantity: number;
  unitPrice: number;
  vatRate: number;
};

export type ReceiveStockInput = {
  productId: string;
  lotNo: string;
  quantity: number;
  expiresAt: string;
};

function audit(
  action: string,
  entity: string,
  entityId: string,
  detail: string,
  role: Role,
): AuditEntry {
  return { id: id(), action, entity, entityId, detail, actor: actorByRole[role], createdAt: nowIso() };
}

export function useErpStore(role: Role) {
  const [state, setState] = useState<ErpState>(cloneSeed);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    let active = true;
    queueMicrotask(() => {
      if (!active) return;
      try {
        const saved = window.localStorage.getItem(STORAGE_KEY);
        if (saved) setState(JSON.parse(saved) as ErpState);
      } catch {
        window.localStorage.removeItem(STORAGE_KEY);
      } finally {
        setHydrated(true);
      }
    });
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch {
      // Demo mode remains usable even when browser storage is unavailable.
    }
  }, [hydrated, state]);

  const actions = useMemo(
    () => ({
      createSale(input: NewSaleInput) {
        setState((current) => {
          const product = current.products.find((item) => item.id === input.productId);
          if (!product) return current;
          const documentNo = nextRunningNumber(
            "SO",
            current.salesDocuments.map((document) => document.documentNo),
            2026,
          );
          const lines = [
            {
              productId: product.id,
              description: product.name,
              quantity: input.quantity,
              unitPrice: input.unitPrice,
              discountRate: 0,
              vatRate: input.vatRate,
            },
          ];
          const totals = calculateSale(lines);
          return {
            ...current,
            salesDocuments: [
              {
                id: id(),
                documentNo,
                type: "sales_order",
                customerId: input.customerId,
                status: "pending",
                lines,
                ...totals,
                paidAmount: 0,
                stockPosted: false,
                createdAt: nowIso(),
                createdBy: actorByRole[role],
              },
              ...current.salesDocuments,
            ],
            auditEntries: [
              audit("CREATE", "Sales Order", documentNo, "สร้างใบสั่งขายและส่งอนุมัติ", role),
              ...current.auditEntries,
            ],
          };
        });
      },
      receiveStock(input: ReceiveStockInput) {
        setState((current) => {
          const lotId = id();
          const reference = nextRunningNumber(
            "STI",
            current.movements.map((movement) => movement.reference),
            2026,
          );
          return {
            ...current,
            lots: [
              {
                id: lotId,
                productId: input.productId,
                lotNo: input.lotNo,
                receivedAt: nowIso().slice(0, 10),
                expiresAt: input.expiresAt,
                status: "hold",
              },
              ...current.lots,
            ],
            movements: [
              {
                id: id(),
                productId: input.productId,
                lotId,
                direction: "in",
                quantity: input.quantity,
                reference,
                postedAt: nowIso(),
                postedBy: actorByRole[role],
              },
              ...current.movements,
            ],
            auditEntries: [
              audit("RECEIVE", "Stock Lot", input.lotNo, `รับเข้า ${input.quantity} หน่วย และพักรอ QA`, role),
              ...current.auditEntries,
            ],
          };
        });
      },
      setLotStatus(lotId: string, status: LotStatus) {
        setState((current) => {
          const lot = current.lots.find((item) => item.id === lotId);
          if (!lot) return current;
          return {
            ...current,
            lots: current.lots.map((item) => (item.id === lotId ? { ...item, status } : item)),
            auditEntries: [
              audit(status === "released" ? "RELEASE" : "HOLD", "Lot", lot.lotNo, `เปลี่ยนสถานะเป็น ${status}`, role),
              ...current.auditEntries,
            ],
          };
        });
      },
      setDocumentStatus(documentId: string, status: DocumentStatus) {
        setState((current) => {
          const document = current.salesDocuments.find((item) => item.id === documentId);
          if (!document) return current;
          return {
            ...current,
            salesDocuments: current.salesDocuments.map((item) =>
              item.id === documentId ? { ...item, status } : item,
            ),
            auditEntries: [
              audit(status.toUpperCase(), "Document", document.documentNo, `เปลี่ยนสถานะเป็น ${status}`, role),
              ...current.auditEntries,
            ],
          };
        });
      },
      recordPayment(documentId: string, amount: number) {
        setState((current) => {
          const document = current.salesDocuments.find((item) => item.id === documentId);
          if (!document || amount <= 0) return current;
          const paidAmount = Math.min(document.total, document.paidAmount + amount);
          return {
            ...current,
            salesDocuments: current.salesDocuments.map((item) =>
              item.id === documentId ? { ...item, paidAmount } : item,
            ),
            auditEntries: [
              audit("PAYMENT", "Receivable", document.documentNo, `รับชำระ ${amount.toLocaleString("th-TH")} บาท`, role),
              ...current.auditEntries,
            ],
          };
        });
      },
      advanceProduction(orderId: string) {
        setState((current) => {
          const order = current.productionOrders.find((item) => item.id === orderId);
          if (!order) return current;
          const next =
            order.status === "planned"
              ? "in_progress"
              : order.status === "in_progress"
                ? "qa_hold"
                : order.status === "qa_hold"
                  ? "completed"
                  : "completed";
          return {
            ...current,
            productionOrders: current.productionOrders.map((item) =>
              item.id === orderId
                ? {
                    ...item,
                    status: next,
                    producedQuantity: next === "qa_hold" ? Math.max(item.producedQuantity, item.plannedQuantity) : item.producedQuantity,
                  }
                : item,
            ),
            auditEntries: [
              audit("STATUS", "Production Order", order.orderNo, `เปลี่ยนขั้นตอนเป็น ${next}`, role),
              ...current.auditEntries,
            ],
          };
        });
      },
      resetDemo() {
        setState(cloneSeed());
      },
      exportBackup() {
        const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
        const link = document.createElement("a");
        link.href = URL.createObjectURL(blob);
        link.download = `nualanan-erp-backup-${new Date().toISOString().slice(0, 10)}.json`;
        link.click();
        URL.revokeObjectURL(link.href);
      },
    }),
    [role, state],
  );

  return { state, hydrated, actions };
}
