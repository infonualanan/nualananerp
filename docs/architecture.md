# NUALANAN ERP 2.0 — Architecture

## เป้าหมาย

ERP 2.0 ออกแบบจาก “งานที่คนต้องทำ” ไม่ใช่รายชื่อแบบฟอร์ม ผู้ใช้เห็นเฉพาะงานตามบทบาทและสถานะที่ต้องตัดสินใจ

## Domain หลัก

1. `SalesDocument` เก็บวงจรเอกสารขาย แต่เอกสารแต่ละประเภทมีหน้าที่เดียว
2. `StockMovement` เป็นแหล่งความจริงของยอดสต็อก เอกสารขายไม่แก้ยอดสต็อกโดยตรง
3. `Lot` เก็บ Batch, วันรับ, วันหมดอายุ และสถานะ QA
4. `ProductionOrder` เชื่อมแผนผลิต Batch และขั้นตอน QA
5. `AuditEntry` เพิ่มอย่างเดียว ห้ามแก้ไขและลบ
6. `JournalEntry` จะเป็นแหล่งความจริงของบัญชีคู่ในระยะถัดไป

## กฎสำคัญ

- รับรู้รายได้จากใบกำกับภาษีที่ลงบัญชีแล้วเพียงครั้งเดียว
- ตัดสต็อกจาก Stock Movement ที่ Post แล้วเพียงครั้งเดียว
- Lot สถานะ `hold` หรือ `blocked` ห้ามนำไปขาย
- เอกสารที่ลงบัญชีแล้วห้ามแก้ทับ ต้อง Void หรือออกเอกสารปรับปรุง
- เลขเอกสารจริงต้องสร้างด้วย Database Transaction จาก `counters`
- การเปลี่ยนสถานะสำคัญต้องสร้าง Audit Entry ทุกครั้ง

## โครงสร้างข้อมูล Firestore

```text
users/{uid}
organizations/{orgId}
  members/{uid}
  partners/{id}
  products/{id}
  lots/{id}
  stockMovements/{id}
  salesDocuments/{id}
  productionOrders/{id}
  journalEntries/{id}
  payments/{id}
  counters/{type-year}
  auditEntries/{id}
```

ข้อมูลบริษัทไม่ผูกกับ UID คนใดคนหนึ่ง พนักงานจึงทำงานร่วมกันได้โดยใช้ Membership และ Role

## ขั้นพัฒนาต่อ

- Firebase data adapter, Authentication และ Organization onboarding (Beta ปัจจุบันยังใช้ Demo Store)
- Transaction สำหรับเลขเอกสารและ Stock Posting
- BOM/สูตรการผลิต, วัตถุดิบ, Yield และของเสีย
- ผังบัญชี, Posting Rules, GL, งบทดลอง และงบการเงิน
- VAT/WHT ที่ผ่านการรับรองโดยทีมบัญชี
- Backup, Restore, Import และการทดสอบ Firestore Rules
