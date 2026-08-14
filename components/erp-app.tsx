"use client";

import { useMemo, useState } from "react";
import { useErpStore } from "@/hooks/use-erp-store";
import type { Role, ViewKey } from "@/lib/types";
import { Modal } from "./ui";
import {
  AccountingView,
  AuditView,
  DashboardView,
  InventoryView,
  MastersView,
  ProductionView,
  SalesView,
} from "./views";

const roles: { value: Role; label: string; short: string }[] = [
  { value: "ceo", label: "ผู้บริหาร (CEO)", short: "CEO" },
  { value: "accounting", label: "ทีมบัญชี", short: "AC" },
  { value: "sales", label: "ฝ่ายขาย", short: "SL" },
  { value: "warehouse", label: "คลังสินค้า", short: "WH" },
  { value: "production", label: "ฝ่ายผลิต", short: "PD" },
  { value: "qa", label: "ทีม QA", short: "QA" },
];

const nav: { value: ViewKey; label: string; hint: string; mark: string }[] = [
  { value: "dashboard", label: "งานวันนี้", hint: "ภาพรวมและสิ่งที่ต้องทำ", mark: "01" },
  { value: "sales", label: "ขายและลูกค้า", hint: "ใบสั่งขายและเอกสาร", mark: "02" },
  { value: "inventory", label: "คลังและ Lot", hint: "คงเหลือ วันหมดอายุ QA", mark: "03" },
  { value: "production", label: "การผลิต", hint: "แผนผลิตและ Batch", mark: "04" },
  { value: "accounting", label: "บัญชี", hint: "ตรวจเอกสารและรับชำระ", mark: "05" },
  { value: "masters", label: "ข้อมูลหลัก", hint: "สินค้า ลูกค้า คู่ค้า", mark: "06" },
  { value: "audit", label: "ประวัติระบบ", hint: "ใครทำอะไร เมื่อไร", mark: "07" },
];

const viewTitle: Record<ViewKey, string> = {
  dashboard: "งานวันนี้",
  sales: "ขายและลูกค้า",
  inventory: "คลังและ Lot",
  production: "การผลิต",
  accounting: "บัญชี",
  masters: "ข้อมูลหลัก",
  audit: "ประวัติระบบ",
};

type ActionModal = "sale" | "stock" | null;

export function ErpApp() {
  const [role, setRole] = useState<Role>("ceo");
  const [view, setView] = useState<ViewKey>("dashboard");
  const [mobileNav, setMobileNav] = useState(false);
  const [actionModal, setActionModal] = useState<ActionModal>(null);
  const [saleProduct, setSaleProduct] = useState("p1");
  const [toast, setToast] = useState<string | null>(null);
  const { state, hydrated, actions } = useErpStore(role);

  const activeRole = roles.find((item) => item.value === role) ?? roles[0];
  const selectedProduct = state.products.find((product) => product.id === saleProduct) ?? state.products[0];

  const viewProps = useMemo(
    () => ({
      state,
      role,
      setView,
      openAction: setActionModal,
      setLotStatus: actions.setLotStatus,
      setDocumentStatus: actions.setDocumentStatus,
      recordPayment: actions.recordPayment,
      advanceProduction: actions.advanceProduction,
    }),
    [actions, role, state],
  );

  const chooseView = (next: ViewKey) => {
    setView(next);
    setMobileNav(false);
  };

  const done = (message: string) => {
    setActionModal(null);
    setToast(message);
    window.setTimeout(() => setToast(null), 3200);
  };

  return (
    <div className="erp-shell">
      {mobileNav && <button className="nav-scrim" aria-label="ปิดเมนู" onClick={() => setMobileNav(false)} />}
      <aside className={`sidebar ${mobileNav ? "sidebar-open" : ""}`}>
        <div className="brand"><div className="brand-mark">N</div><div><strong>NUALANAN</strong><span>ERP 2.0 · Human Mode</span></div></div>
        <nav aria-label="เมนูหลัก">{nav.map((item) => <button key={item.value} className={`nav-item ${view === item.value ? "active" : ""}`} onClick={() => chooseView(item.value)}><span className="nav-number">{item.mark}</span><span><strong>{item.label}</strong><small>{item.hint}</small></span></button>)}</nav>
        <div className="sidebar-footer"><span className="online-dot" /> <span><strong>โหมดทดลองพร้อมใช้</strong><small>ข้อมูลเก็บในเบราว์เซอร์นี้</small></span></div>
      </aside>

      <div className="workspace">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu" onClick={() => setMobileNav(true)} aria-label="เปิดเมนู">☰</button><div><span>พื้นที่ทำงาน</span><strong>{viewTitle[view]}</strong></div></div>
          <div className="topbar-actions"><button className="search-button" onClick={() => setToast("ค้นหาแบบรวมกำลังอยู่ในแผนรุ่นถัดไป")}>⌕ <span>ค้นหาเอกสาร สินค้า หรือ Lot</span><kbd>⌘ K</kbd></button><label className="role-picker"><span>มุมมอง</span><select value={role} onChange={(event) => setRole(event.target.value as Role)}>{roles.map((item) => <option key={item.value} value={item.value}>{item.label}</option>)}</select></label><div className="avatar" title={activeRole.label}>{activeRole.short}</div></div>
        </header>

        <div className="demo-banner"><span><strong>ERP 2.0 Beta</strong> — ข้อมูลสมมติทั้งหมด สำหรับทดลอง Workflow ก่อนเชื่อมฐานข้อมูลบริษัท</span><div><button onClick={actions.exportBackup}>สำรองข้อมูล</button><button onClick={() => { actions.resetDemo(); setToast("คืนค่าข้อมูลตัวอย่างแล้ว"); }}>คืนค่าตัวอย่าง</button></div></div>

        <main className="content" aria-busy={!hydrated}>
          {view === "dashboard" && <DashboardView {...viewProps} />}
          {view === "sales" && <SalesView {...viewProps} />}
          {view === "inventory" && <InventoryView {...viewProps} />}
          {view === "production" && <ProductionView {...viewProps} />}
          {view === "accounting" && <AccountingView {...viewProps} />}
          {view === "masters" && <MastersView {...viewProps} />}
          {view === "audit" && <AuditView {...viewProps} />}
        </main>
      </div>

      {actionModal === "sale" && (
        <Modal title="สร้างใบสั่งขาย" description="กรอกเฉพาะข้อมูลที่ต้องใช้ ระบบคำนวณยอดและส่งอนุมัติให้" onClose={() => setActionModal(null)}>
          <form className="human-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); actions.createSale({ customerId: String(form.get("customerId")), productId: String(form.get("productId")), quantity: Number(form.get("quantity")), unitPrice: Number(form.get("unitPrice")), vatRate: Number(form.get("vatRate")) }); done("สร้างใบสั่งขายและส่งอนุมัติแล้ว"); }}>
            <label><span>1. ลูกค้า</span><select name="customerId" required>{state.partners.filter((partner) => partner.type !== "supplier").map((partner) => <option value={partner.id} key={partner.id}>{partner.name}</option>)}</select></label>
            <label><span>2. สินค้า</span><select name="productId" value={saleProduct} onChange={(event) => setSaleProduct(event.target.value)} required>{state.products.map((product) => <option value={product.id} key={product.id}>{product.sku} · {product.name}</option>)}</select></label>
            <div className="form-grid"><label><span>จำนวน</span><input name="quantity" type="number" min="1" defaultValue="1" required /></label><label><span>ราคาต่อ {selectedProduct.unit}</span><input name="unitPrice" type="number" min="0" step="0.01" key={selectedProduct.id} defaultValue={selectedProduct.price} required /></label></div>
            <label><span>ภาษีมูลค่าเพิ่ม</span><select name="vatRate" defaultValue={selectedProduct.vatRate}><option value="7">VAT 7%</option><option value="0">VAT 0%</option></select></label>
            <div className="form-note">เอกสารจะอยู่สถานะ “รออนุมัติ” และยังไม่ตัดสต็อก</div>
            <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setActionModal(null)}>ยกเลิก</button><button className="button button-primary" type="submit">บันทึกและส่งอนุมัติ</button></div>
          </form>
        </Modal>
      )}

      {actionModal === "stock" && (
        <Modal title="รับสินค้าเข้าคลัง" description="ทุกการรับเข้าต้องระบุ Lot และวันหมดอายุ เพื่อย้อนกลับได้" onClose={() => setActionModal(null)}>
          <form className="human-form" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); actions.receiveStock({ productId: String(form.get("productId")), lotNo: String(form.get("lotNo")).trim().toUpperCase(), quantity: Number(form.get("quantity")), expiresAt: String(form.get("expiresAt")) }); done("รับเข้าคลังแล้ว และพัก Lot รอ QA ปล่อย"); }}>
            <label><span>1. สินค้า</span><select name="productId" required>{state.products.map((product) => <option value={product.id} key={product.id}>{product.sku} · {product.name}</option>)}</select></label>
            <div className="form-grid"><label><span>2. เลข Lot</span><input name="lotNo" placeholder="เช่น GF260815" required /></label><label><span>3. จำนวนรับเข้า</span><input name="quantity" type="number" min="1" required /></label></div>
            <label><span>4. วันหมดอายุ</span><input name="expiresAt" type="date" min="2026-08-14" required /></label>
            <div className="form-note warning">รับเข้าแล้ว Lot จะเป็น “รอตรวจ QA” จึงยังนำไปขายไม่ได้</div>
            <div className="modal-actions"><button type="button" className="button button-ghost" onClick={() => setActionModal(null)}>ยกเลิก</button><button className="button button-primary" type="submit">ยืนยันรับเข้าคลัง</button></div>
          </form>
        </Modal>
      )}

      {toast && <div className="toast" role="status"><span>✓</span>{toast}</div>}
    </div>
  );
}
