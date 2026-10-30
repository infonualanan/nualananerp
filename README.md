# Nual Anan ERP

Static ERP frontend connected to the existing Firebase project `nualananerp-1`. Deployment stays at https://nualananerp.vercel.app.

## รูปแบบราคา รวม VAT / ยังไม่รวม VAT

- ในฐานสินค้า เลือก **ราคาที่กรอกนี้ → รวม VAT แล้ว / ยังไม่รวม VAT** พร้อมดูราคาต่อหน่วยรวม VAT 7% ก่อนบันทึก ใช้รหัสสินค้าเดิมและยืนยันหน่วยตามขั้นตอนเดิม
- เมื่อเลือกสินค้าในใบเอกสาร ระบบคัดลอกราคาและรูปแบบราคาเป็นค่าเริ่มต้น ปรับเฉพาะรายการในเอกสารได้โดยไม่แก้ฐานสินค้า การเปลี่ยนตัวเลือกเป็นการเปลี่ยนความหมายของตัวเลขที่กรอกและคำนวณยอดใหม่ ไม่ใช่คำสั่งแปลงรูปแบบแสดงโดยคงยอดเดิม
- ตัวอย่าง **25 บาท ยังไม่รวม VAT × 265 แผ่น = 6,625 + VAT 463.75 = 7,088.75 บาท** ส่วน 25 บาทแบบรวม VAT แล้วจะคงยอดชำระ 6,625 บาท
- คิดส่วนลด/GP ก่อนคำนวณ VAT ใช้หน่วยสตางค์และปัดภาษีสะสมตามกลุ่มรูปแบบราคา เพื่อให้ยอดแต่ละรายการรวมตรงกับยอดเอกสาร ใช้เส้นทางคำนวณเดียวกันทั้งหน้าจอและการบันทึก
- เอกสารซื้อในประเทศ PR/PO/GRN ใหม่แสดงมูลค่าก่อน VAT, VAT และยอดสุทธิ เอกสารส่งออก คลัง และเงินเดือนคงนโยบายไม่บวก VAT ในประเทศ รหัส G ยังคงไม่คิด VAT ตามพฤติกรรมเดิม และแยกจาก “ยังไม่รวม VAT”
- สินค้าเดิมที่ไม่มีรูปแบบราคายังคงถือเป็นราคารวม VAT ตามการคำนวณเดิม ไม่มีการปรับราคาหรือย้ายข้อมูลในฐานโดยอัตโนมัติ เอกสารเก่าแสดงยอดเดิม การโหลด PO เก่าที่ไม่มี VAT เป็นฉบับร่างยังคงเงื่อนไขเดิมจนกว่าจะเปลี่ยนรายการ/รูปแบบราคาอย่างชัดเจน
- บันทึก `priceBasis`, `taxRate`, `displayTotal`, `pricingVersion` ในรายการ และ `vatEnabled`/`pricingVersion` ในเอกสาร เพื่อเก็บความหมายและยอด ณ วันที่ออกเอกสาร ไม่อ่านราคาปัจจุบันมาแทนประวัติ
- รูปแบบ A4/PDF เดิมเพิ่มคำกำกับ VAT ที่หัวคอลัมน์ หากรายการมีหลายรูปแบบราคา จะกำกับราคาต่อหน่วยแต่ละรายการและแสดงคอลัมน์จำนวนเงินก่อน VAT เพื่อให้รวมตรงกับมูลค่าก่อน VAT รวมถึงใบกำกับที่หักมัดจำ
- `items.total` ยังคงเป็นยอดรวม VAT ของแต่ละรายการสำหรับยอดรับเงิน/รายงานเดิม ส่วน `displayTotal` เป็นยอดหลังส่วนลดตามรูปแบบราคาที่ป้อน จึงเชื่อมระบบรับชำระหลายงวดได้โดยไม่บวก VAT ซ้ำ

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
