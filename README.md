# Nual Anan ERP

Static ERP frontend connected to the existing Firebase project `nualananerp-1`. Deployment stays at https://nualananerp.vercel.app.

## รูปแบบราคา รวม VAT / ยังไม่รวม VAT

- ในฐานสินค้า เลือก **ราคาที่กรอกนี้ → รวม VAT แล้ว / ยังไม่รวม VAT** พร้อมดูราคาต่อหน่วยรวม VAT 7% ก่อนบันทึก ใช้รหัสสินค้าเดิมและยืนยันหน่วยตามขั้นตอนเดิม
- หน้าออกเอกสารมีตัวเลือก **ราคา/หน่วย → (รวม VAT) / (ไม่รวม VAT)** ที่หัวคอลัมน์ เลือกครั้งเดียวใช้กับทั้งใบ ไม่มีช่องเลือก VAT ใต้ราคาแต่ละรายการ เมื่อยังไม่ได้เลือกเอง ระบบใช้รูปแบบจากสินค้า VAT รายการแรกเป็นค่าเริ่มต้น หลังจากนั้นรายการที่เพิ่มใช้รูปแบบของเอกสาร ตัวเลขราคาที่กรอกคงเดิมเมื่อเปลี่ยนรูปแบบ และคำนวณยอดใหม่ตามเงื่อนไขทั้งใบ โดยไม่แก้ฐานสินค้า
- ตัวอย่าง **25 บาท ยังไม่รวม VAT × 265 แผ่น = 6,625 + VAT 463.75 = 7,088.75 บาท** ส่วน 25 บาทแบบรวม VAT แล้วจะคงยอดชำระ 6,625 บาท
- คิดส่วนลด/GP ก่อนคำนวณ VAT ใช้หน่วยสตางค์และปัดภาษีสะสมตามกลุ่มรูปแบบราคา เพื่อให้ยอดแต่ละรายการรวมตรงกับยอดเอกสาร ใช้เส้นทางคำนวณเดียวกันทั้งหน้าจอและการบันทึก
- เอกสารซื้อในประเทศ PR/PO/GRN ใหม่แสดงมูลค่าก่อน VAT, VAT และยอดสุทธิ เอกสารส่งออก คลัง และเงินเดือนคงนโยบายไม่บวก VAT ในประเทศ รหัส G ยังคงไม่คิด VAT ตามพฤติกรรมเดิม และแยกจาก “ยังไม่รวม VAT”
- สินค้าเดิมที่ไม่มีรูปแบบราคายังคงถือเป็นราคารวม VAT ตามการคำนวณเดิม ไม่มีการปรับราคาหรือย้ายข้อมูลในฐานโดยอัตโนมัติ เอกสารเก่าแสดงยอดเดิม การโหลด PO เก่าที่ไม่มี VAT หรือมีรูปแบบราคาผสมเป็นฉบับร่างจะแสดง “ตามเอกสารเดิม” จนกว่าจะเลือกรูปแบบที่หัวคอลัมน์ เมื่อเลือกแล้ว รายการปกติทั้งหมดรวมถึงรายการเดิมที่ยังไม่คิด VAT จะเปลี่ยนตามทั้งใบ รหัส G คงนโยบายไม่คิด VAT เดิม
- บันทึก `priceBasis`, `taxRate`, `displayTotal`, `pricingVersion` ในรายการ และ `documentPriceBasis`/`vatEnabled`/`pricingVersion` ในเอกสาร เพื่อเก็บความหมายและยอด ณ วันที่ออกเอกสาร ไม่อ่านราคาปัจจุบันมาแทนประวัติ
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

## งานผลิต คลัง LOT และ QA

เมนูใหม่ใช้ Firebase และบัญชี ERP เดิม:

- **4) คลังสินค้า**: สต๊อก/จอง/ประวัติ LOT, รับเข้า/ยอดยกมา, ทะเบียนวัตถุดิบ/บรรจุภัณฑ์/สินค้า, ขนส่งตาม LOT
- **5) การผลิต**: สูตรและ Revision ที่อนุมัติ, ใบสั่งผลิตเชื่อมคลัง, เบิก/ชั่งจริง, บันทึกกระบวนการ PC09/10/11, รับผลผลิตหลาย LOT, ปิดยอดใช้/คืน/เสียหาย
- **QA / GHP–HACCP**: ตรวจรับ, ตรวจบรรจุ/ซีล/ปล่อย LOT, ฟอร์มบริษัทและรายงานรับ–จ่าย

เริ่มใช้งานจาก **ทะเบียนรายการคลัง → สูตรที่อนุมัติ → รับเข้า/ตั้งยอดยกมาที่ตรวจนับแล้ว → QA ตรวจรับ → ใบสั่งผลิต → เบิกจริง → บันทึกขั้นตอน → รับผลผลิตจริง → QA → จัดส่ง**. ไม่เพิ่มข้อมูลตัวอย่างหรือเคลื่อนย้ายสต๊อกอัตโนมัติเมื่อเปิดหน้า

1. ทะเบียนคลังดึงชื่อ/รหัส/หน่วยจากฐานสินค้าเดิมได้ แต่แต่ละรายการโรงงานใช้หน่วยคลังหลักเดียวและล็อกทศนิยมไว้ตั้งแต่สร้าง ยังไม่แปลงกระสอบ/กิโลกรัม/ลังโดยอัตโนมัติ สูตรเก็บเป็นฉบับใหม่ต่อ Revision และเก็บสำเนาในใบสั่งผลิต
2. ยืนยันแผนจอง LOT ที่ผ่าน QA และใช้ได้วันต้องการสินค้า เลือกของหมดอายุใกล้ก่อนเมื่อมี EXP; การจองยังไม่ลดของจริง การเบิกจริงลดของและยอดจองในธุรกรรมเดียว
3. รับเข้า รับคืนลูกค้า และคืนวัสดุหน้างานเข้ากัก QA ก่อนเสมอ ข้อมูล LOT ผู้ขายเก็บแยกจากรหัสติดตามภายใน ไม่สร้าง LOT ผู้ขายแทนผู้ขายที่ไม่ได้ระบุ
4. ผลผลิตจริงแยกจากเป้าหมาย รองรับหลาย LOT ต่องานและตรวจ MFG/EXP แยกจากวันที่รับจริง การปล่อย QA เปลี่ยนสถานะโดยไม่รับจำนวนซ้ำ งานปิดยอดวัสดุได้เมื่อใช้จริง+คืน+เสียหายเท่ากับที่เบิก
5. ผลตรวจ เวลา อุณหภูมิ ผลบรรจุ/ซีล และผลตรวจรถมาจากผู้ใช้ ไม่มีเกณฑ์อุณหภูมิหรือจำนวนสุ่มที่เดาแทน QA ต้องอ้างอิงแผนสุ่มที่อนุมัติก่อนปล่อย FG วัตถุดิบสดต้องยืนยัน AVL และหลักฐานผลวิเคราะห์ตามสเปก
6. LOT ที่ยังไม่ผ่าน QA หรือหมดอายุจัดส่งไม่ได้ ส่งบางส่วนได้ ตรวจรถและบันทึกการแก้ไขก่อนส่ง ใบส่งภายในที่ยืนยันแล้วไม่ซ้ำเลขเดิม การจัดส่งนี้เป็นรายการคลัง ไม่ออกใบกำกับ/ใบเสร็จหรือบันทึกรายได้เพิ่ม
   รองรับผลิตตามออเดอร์และผลิตเก็บสต๊อก โดยระบุลูกค้าที่รับสินค้าจริงตอนจัดส่ง สามารถกักกัน LOT ที่เคยปล่อยแล้วเพื่อหยุดใช้/ส่งได้ทันทีโดยไม่เปลี่ยนจำนวนคงเหลือหรือยอดจอง
7. แบบพิมพ์ PC03, PC04, PC02, RM03, PC09/10/11 และ TS01 ดึงรายการที่บันทึกแล้ว การพิมพ์/บันทึก PDF ใช้หน้าพิมพ์เบราว์เซอร์ PC02 แนบทะเบียน LOT/เอกสารอ้างอิง TS01 แยกตามรถและวัน ผลทวนสอบ/ลายเซ็นเว้นให้ผู้รับผิดชอบจริง
8. PC07/08 และแบบตรวจรับที่รหัสซ้ำในไฟล์ต้นฉบับใช้ทะเบียนผลตรวจ QA แนบก่อน ไม่กำหนด Revision ใหม่หรือแก้แผนสุ่ม 3/2 ตัวอย่างแทนบริษัท การจัดหน้าและแม่แบบควรให้ QA ทวนสอบก่อนใช้แทนฟอร์มควบคุมฉบับจริง

### ข้อมูลและการยืนยัน

- Collections factory_items, factory_recipes, factory_lots, factory_jobs, factory_processes, factory_inspections, factory_shipments, factory_returns, factory_events, factory_requests, factory_keys, factory_meta อยู่ใต้ artifacts/{appId}/users/{uid} เดิม ไม่แก้ Firebase project/rules และไม่ย้ายไปพื้นที่บริษัทส่วนกลางโดยปริยาย
- รุ่นแรกใช้สิทธิ์ของบัญชี ERP ปัจจุบัน บันทึก UID และชื่อบัญชีที่ทำรายการจริง มีการยืนยันผลตรวจโดยผู้ใช้ ยังไม่มีการเชิญหลายบัญชีเข้าบริษัทเดียวกันหรือกำหนดบทบาท QA/คลังแยกที่ฝั่งเซิร์ฟเวอร์ จึงไม่ควรใช้การแชร์รหัสผ่านเพื่อแทนระบบสิทธิ์
- บันทึกเอกสารแยกตามรายการ/LOT/งาน ไม่รวมทั้งโรงงานไว้ในเอกสาร Firestore เดียว ทุกการเปลี่ยนจำนวนใช้ Firestore transaction อ่านข้อมูลที่กระทบก่อนเขียน และมี metadata revision ป้องกันคำยืนยันจากหน้าที่ล้าสมัย
- Request UUID + SHA-256 ของคำสั่งทำให้ลองใหม่หลังเครือข่ายขัดข้องไม่สร้างรายการซ้ำ เลขใบรับ, LOT ภายในต่อรหัสสินค้า, Revision สูตร และใบส่งภายในมีรายการตรวจซ้ำในธุรกรรมเดียว
- ใช้จำนวนเต็มหน่วย 1/1000 แทนทศนิยมลอยตัว ตรวจยอดติดลบ/ยอดต่ำกว่าจอง และบันทึกประวัติที่อ้างอิงผู้ใช้/เวลา/ลำดับรายการ การแก้ยอดใช้รายการปรับแยก ไม่ลบประวัติ
- ยอดจากเอกสารเก่าคงอยู่ใน Stock Card เดิมและระบุแหล่งข้อมูลไว้ ไม่รวมกับยอดโรงงานใหม่เพื่อตัดของซ้ำ ต้องกระทบยอดและตั้งยอดยกมาจริงก่อนใช้ยอดใหม่เป็นยอดอ้างอิง
- การโหลดข้อมูลใช้ server reads และตรวจ revision ก่อน/หลังโหลด เฝ้าดู metadata เพื่อแจ้งว่ามีข้อมูลใหม่จากอีกเครื่อง เก็บข้อมูลที่กรอกไว้เมื่อบันทึกไม่สำเร็จ และล้างหน้าข้อมูล/ภาพพิมพ์เมื่อออกจากบัญชี
- Tests use isolated Firestore transaction fakes and the real DOM. They do not seed company stock, execute live QA approvals, change live financial records or deploy permissive database rules.
