# Nual Anan ERP

Static ERP frontend connected to the existing Firebase project `nualananerp-1`. Deployment stays at https://nualananerp.vercel.app.

## รับชำระหลายงวดและเอกสาร

เข้า **6) การเงิน/บัญชี → รับชำระหลายงวด / ออกเอกสาร** หรือกด **รับชำระ** ในคลังเอกสาร

1. เลือกใบสั่งขาย (SO) หรือใบแจ้งหนี้ (INV) สกุล THB ที่ยังไม่มีประวัติรับเงิน/ใบกำกับ/ส่งมอบเดิม และเปิดรับชำระหลายงวด
2. เลือก **ใบเสร็จเท่านั้น** หรือ **ขายสินค้าในประเทศ จด VAT รวม VAT 7%** ตามธุรกรรมจริง โหมด VAT ต้องมีข้อมูลผู้ขายและผู้ซื้อในต้นทางครบ และยอดทั้งออเดอร์ต้องรวม VAT 7% เต็มจำนวน
3. กรอกเงินที่รับ วันที่ เลขอ้างอิง วันนัดชำระยอดที่เหลือ และแนบหลักฐาน PNG/JPG/PDF ไม่เกิน 500 KB หรือรายละเอียดหลักฐานที่ตรวจแล้ว
4. ตรวจเอกสารฉบับร่างก่อนกดยืนยัน ระบบจึงบันทึกงวดรับเงินและออกใบรับเงินพร้อมกัน
5. ในโหมด VAT การรับก่อนส่งมอบออกใบเสร็จ/ใบกำกับตามยอดรับล่วงหน้า เมื่อส่งมอบจะออกใบกำกับเฉพาะส่วนที่ยังไม่เคยออกภาษี การรับเงินหลังจากนั้นออกใบเสร็จอ้างอิงใบกำกับเดิม
6. ออกใบแจ้งหนี้เพื่อแสดงยอดออเดอร์ หักยอดรับสะสม และยอดคงเหลือได้ โดยไม่เพิ่มยอดรับเงิน
7. เปิด A4 / พิมพ์ / ดาวน์โหลด PDF ผ่านรูปแบบเอกสารเดิมของบริษัท

รายการเดิมที่มีใบรับเงิน ใบกำกับ หรือใบส่งของอ้างอิงอยู่ต้องกระทบยอดก่อน ไม่ย้ายยอดเดิมเป็นยอดรับเงินโดยอัตโนมัติ เอกสารที่ออกจากระบบรับเงินล็อกยอดและข้อมูลผู้ออก ณ วันออกเอกสาร การแก้ไขธุรกรรม/คืนเงิน/ใบลดหนี้ยังต้องให้ผู้รับผิดชอบบัญชีจัดการ ไม่รองรับการลบรายการรับเงินเพื่อแก้ยอดผ่านหน้านี้

## Data and integrity

- No change to the existing Firebase configuration or deployed rules. No example payments are seeded.
- Data stays under the authenticated path `artifacts/{appId}/users/{uid}`. Source orders carry `paymentLedger`; issued records stay in `documents`. Dedicated counters live in `settings/payment-sequence-{year}`.
- Each confirmation uses one Firestore transaction for the source ledger, issued document, and number counter. Request IDs make uncertain retries idempotent; revision checks reject stale confirmations from another device. All transaction reads precede writes.
- New document numbers use a separate `P` series, for example `RETAX-2026-P000001`, avoiding the legacy numeric series.
- Calculations use integer satang. Cumulative VAT allocation reconciles installment rounding to the order total. Only tax documents enter the new VAT flow; receipts never issue VAT again.
- Advances and receipts do not add duplicate revenue. A managed source order contributes its full amount once when marked delivered. This operational dashboard is not a statutory general ledger.
- File evidence is stored with its receipt, not repeated in the source ledger. Files are limited to 500 KB; document size is checked before writing. Only images render inline; PDF evidence downloads as a file.
- The existing authenticated account must have read/write permissions on its own `documents` and `settings`. Do not make Firestore publicly writable. Rules remain an independent authorization boundary; no rules are deployed by this frontend change.
- Current scope: THB, domestic goods with uniformly included 7% VAT, or receipt-only operation. Export VAT rules, mixed exempt/taxable orders, withholding, refunds, partial deliveries and legacy reconciliation are not implemented by this module.

## Validation

```bash
npm --prefix tests ci
npm --prefix tests test
```

The suite covers the original notes and responsive behavior, real ERP DOM integration, monetary and VAT reconciliation, atomic transaction behavior, concurrent devices, retry idempotence, account changes and document snapshots. Tests use isolated data and a Firestore-compatible optimistic transaction fake; they do not create financial transactions in the live account.

Relevant official references:
- https://firebase.google.com/docs/firestore/manage-data/transactions
- https://firebase.google.com/docs/firestore/quotas
- https://www.rd.go.th/3606.html
- https://www.rd.go.th/5208.html
- https://www.rd.go.th/49981.html
