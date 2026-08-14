# NUALANAN ERP 2.0

ระบบต้นแบบรุ่นใหม่สำหรับงานขาย คลังสินค้า Lot/วันหมดอายุ การผลิต QA และบัญชีของนวลอนันต์ โดยออกแบบให้พนักงานเห็นว่า “วันนี้ต้องทำอะไร” แทนการเปิดเมนูเอกสารจำนวนมากแล้วเดาเอง

## สิ่งที่ใช้งานได้ใน Beta นี้

- Dashboard เปลี่ยนตามบทบาท CEO, บัญชี, ฝ่ายขาย, คลัง, ผลิต และ QA
- สร้างใบสั่งขายแบบกรอกข้อมูลเท่าที่จำเป็น
- รับสินค้าเข้าคลังพร้อม Lot และวันหมดอายุ
- QA Hold/Release
- Stock Ledger ที่ไม่นับซ้ำจากเอกสารหลายชนิด
- Production Board: รอเริ่ม → กำลังผลิต → รอ QA → เสร็จแล้ว
- ตรวจใบกำกับภาษีก่อนลงบัญชีและบันทึกรับชำระ
- Audit Trail
- สำรองข้อมูล Demo เป็น JSON
- Responsive สำหรับคอมพิวเตอร์ แท็บเล็ต และมือถือ

> รุ่น Beta ใช้ Demo Store และข้อมูลสมมติทั้งหมดในเบราว์เซอร์เพื่อทดสอบ Workflow และ UX ก่อนเปิดใช้ข้อมูลจริง จึงยังไม่ควรใช้ปิดบัญชี ยื่นภาษี หรือเป็นฐานข้อมูลหลักของโรงงาน

## เริ่มใช้งาน

```bash
npm install
npm run dev
```

เปิด `http://localhost:3000`

## ตรวจคุณภาพ

```bash
npm run check
```

ระบบจะตรวจ ESLint, TypeScript, Domain Tests และ Production Build

Beta นี้ export เป็น static site ที่โฟลเดอร์ `out` เพื่อให้ Preview บน Vercel ใช้ได้กับ Demo Store โดยไม่ต้องมี Next.js server เมื่อเชื่อม Authentication และฐานข้อมูลจริงแล้วจึงประเมินการเปลี่ยน deployment mode อีกครั้ง

## ก่อนเปิดใช้กับฐานข้อมูลบริษัท

Beta นี้ยังใช้ `localStorage` และ **ยังไม่มี Firebase data adapter** การตั้ง Environment Variables อย่างเดียวจึงยังไม่เชื่อมข้อมูลจริง ไฟล์ `firestore.rules` และ `.env.example` เป็นฐานสำหรับงานระยะถัดไป ไม่ใช่สัญญาณว่าระบบพร้อม Production แล้ว

งานที่ต้องทำต่อก่อนเปิดข้อมูลจริง:

1. สร้าง Firebase data adapter และ Authentication โดยปิดการสมัครจากหน้า ERP
2. ใช้ Database Transaction สำหรับเลขเอกสาร การลงบัญชี และ Stock Posting
3. Deploy และทดสอบ `firestore.rules` ด้วย Rules Emulator
4. สร้าง Organization, ผู้ใช้เริ่มต้น และ Membership ตาม Role
5. ทำ Import/Backup/Restore และตรวจยอดกับทีมบัญชี
6. ทดสอบ Role, Audit และ Workflow ครบวงจรบน Staging ก่อน Production

ห้ามเปลี่ยน Firestore Rules เป็น `allow read, write: if true;`

## บทบาท

| Role | งานหลัก |
|---|---|
| CEO | ภาพรวม อนุมัติ และตรวจ Audit |
| Accounting | ลงบัญชี รับชำระ VAT/WHT และรายงาน |
| Sales | ลูกค้า ใบเสนอราคา และใบสั่งขาย |
| Warehouse | รับเข้า จ่ายออก Stock และ Lot |
| Production | แผนผลิต Batch ผลผลิต และของเสีย |
| QA | Hold/Release และ Traceability |

## รุ่นเดิม

ERP 1.0 ถูกเก็บไว้ที่ `legacy/index.html` เพื่อใช้อ้างอิงหน้าตาและข้อมูลเดิม ไม่ควรนำกลับไป Deploy เป็น Production

รายละเอียดโมเดลข้อมูลอยู่ที่ [`docs/architecture.md`](docs/architecture.md)
