import type { ErpState } from "./types";

export const seedState: ErpState = {
  products: [
    { id: "p1", sku: "GF-ORI-030", name: "ขิงหยอง รสต้นตำรับ 30 กรัม", unit: "ซอง", price: 59, reorderPoint: 120, vatRate: 7 },
    { id: "p2", sku: "GC-NORI-020", name: "ขิงแผ่นกรอบ รสโนริ 20 กรัม", unit: "ซอง", price: 49, reorderPoint: 150, vatRate: 7 },
    { id: "p3", sku: "BGT-070", name: "ชาขิงดำ 70 กรัม", unit: "กล่อง", price: 189, reorderPoint: 60, vatRate: 7 },
    { id: "p4", sku: "GHLM-050", name: "ขิงอบน้ำผึ้งมะนาว 50 กรัม", unit: "ซอง", price: 69, reorderPoint: 100, vatRate: 7 },
  ],
  partners: [
    { id: "c1", code: "DEMO-C-001", name: "ร้านค้าตัวอย่าง กรุงเทพ", type: "customer", taxId: "ข้อมูลสมมติ", country: "ไทย" },
    { id: "c2", code: "DEMO-C-002", name: "Demo Export Trading", type: "customer", taxId: "ข้อมูลสมมติ", country: "ญี่ปุ่น" },
    { id: "s1", code: "DEMO-S-001", name: "วิสาหกิจชุมชนตัวอย่าง", type: "supplier", taxId: "ข้อมูลสมมติ", country: "ไทย" },
  ],
  lots: [
    { id: "l1", productId: "p1", lotNo: "GF260801", receivedAt: "2026-08-01", expiresAt: "2027-08-01", status: "released" },
    { id: "l2", productId: "p2", lotNo: "GC260730", receivedAt: "2026-07-30", expiresAt: "2026-09-30", status: "released" },
    { id: "l3", productId: "p3", lotNo: "BGT260812", receivedAt: "2026-08-12", expiresAt: "2027-08-12", status: "hold" },
    { id: "l4", productId: "p4", lotNo: "GH260805", receivedAt: "2026-08-05", expiresAt: "2027-02-05", status: "released" },
  ],
  movements: [
    { id: "m1", productId: "p1", lotId: "l1", direction: "in", quantity: 420, reference: "FGR-2026-0031", postedAt: "2026-08-01T09:10:00+07:00", postedBy: "ฝ่ายผลิต" },
    { id: "m2", productId: "p1", lotId: "l1", direction: "out", quantity: 125, reference: "DO-2026-0084", postedAt: "2026-08-10T13:25:00+07:00", postedBy: "คลังสินค้า" },
    { id: "m3", productId: "p2", lotId: "l2", direction: "in", quantity: 260, reference: "FGR-2026-0030", postedAt: "2026-07-30T15:20:00+07:00", postedBy: "ฝ่ายผลิต" },
    { id: "m4", productId: "p2", lotId: "l2", direction: "out", quantity: 130, reference: "DO-2026-0083", postedAt: "2026-08-09T11:45:00+07:00", postedBy: "คลังสินค้า" },
    { id: "m5", productId: "p3", lotId: "l3", direction: "in", quantity: 84, reference: "FGR-2026-0032", postedAt: "2026-08-12T17:10:00+07:00", postedBy: "ฝ่ายผลิต" },
    { id: "m6", productId: "p4", lotId: "l4", direction: "in", quantity: 360, reference: "FGR-2026-0033", postedAt: "2026-08-05T10:00:00+07:00", postedBy: "ฝ่ายผลิต" },
  ],
  salesDocuments: [
    { id: "d1", documentNo: "QT-2026-0041", type: "quotation", customerId: "c1", status: "approved", lines: [{ productId: "p1", description: "ขิงหยอง รสต้นตำรับ", quantity: 100, unitPrice: 45, discountRate: 0, vatRate: 7 }], subtotal: 4500, vat: 315, total: 4815, paidAmount: 0, stockPosted: false, createdAt: "2026-08-10T09:00:00+07:00", createdBy: "ฝ่ายขาย" },
    { id: "d2", documentNo: "SO-2026-0035", type: "sales_order", customerId: "c2", status: "approved", lines: [{ productId: "p2", description: "Crispy Ginger Chips Nori", quantity: 120, unitPrice: 31, discountRate: 0, vatRate: 0 }], subtotal: 3720, vat: 0, total: 3720, paidAmount: 0, sourceDocumentId: "d1", stockPosted: false, createdAt: "2026-08-11T10:30:00+07:00", createdBy: "ฝ่ายขายส่งออก" },
    { id: "d3", documentNo: "TINV-2026-0028", type: "tax_invoice", customerId: "c1", status: "posted", lines: [{ productId: "p4", description: "ขิงอบน้ำผึ้งมะนาว", quantity: 80, unitPrice: 52, discountRate: 0, vatRate: 7 }], subtotal: 4160, vat: 291.2, total: 4451.2, paidAmount: 2000, stockPosted: true, createdAt: "2026-08-12T14:10:00+07:00", createdBy: "ฝ่ายบัญชี" },
    { id: "d4", documentNo: "TINV-2026-0029", type: "tax_invoice", customerId: "c1", status: "pending", lines: [{ productId: "p1", description: "ขิงหยอง รสต้นตำรับ", quantity: 60, unitPrice: 45, discountRate: 0, vatRate: 7 }], subtotal: 2700, vat: 189, total: 2889, paidAmount: 0, stockPosted: false, createdAt: "2026-08-14T08:30:00+07:00", createdBy: "ฝ่ายขาย" },
  ],
  productionOrders: [
    { id: "po1", orderNo: "PDO-2026-0018", productId: "p1", batchNo: "GF260815", plannedQuantity: 500, producedQuantity: 0, dueDate: "2026-08-15", status: "planned" },
    { id: "po2", orderNo: "PDO-2026-0017", productId: "p2", batchNo: "GC260814", plannedQuantity: 320, producedQuantity: 245, dueDate: "2026-08-14", status: "in_progress" },
    { id: "po3", orderNo: "PDO-2026-0016", productId: "p3", batchNo: "BGT260812", plannedQuantity: 100, producedQuantity: 84, dueDate: "2026-08-12", status: "qa_hold" },
  ],
  auditEntries: [
    { id: "a1", action: "POST", entity: "Tax Invoice", entityId: "TINV-2026-0028", detail: "บันทึกบัญชีและยอดลูกหนี้แล้ว", actor: "ทีมบัญชี", createdAt: "2026-08-12T14:15:00+07:00" },
    { id: "a2", action: "HOLD", entity: "Lot", entityId: "BGT260812", detail: "รอผลตรวจปล่อยผลิตภัณฑ์", actor: "ทีม QA", createdAt: "2026-08-12T17:20:00+07:00" },
    { id: "a3", action: "CREATE", entity: "Tax Invoice", entityId: "TINV-2026-0029", detail: "สร้างเอกสารและส่งอนุมัติ", actor: "ฝ่ายขาย", createdAt: "2026-08-14T08:30:00+07:00" },
  ],
};
