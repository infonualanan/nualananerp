import { lotQuantity, lotRisk, stockByProduct, summarize } from "@/lib/domain";
import type { DocumentStatus, ErpState, LotStatus, Role, ViewKey } from "@/lib/types";
import { EmptyState, Money, StatusBadge } from "./ui";

type ViewProps = {
  state: ErpState;
  role: Role;
  setView: (view: ViewKey) => void;
  openAction: (action: "sale" | "stock") => void;
  setLotStatus: (id: string, status: LotStatus) => void;
  setDocumentStatus: (id: string, status: DocumentStatus) => void;
  recordPayment: (id: string, amount: number) => void;
  advanceProduction: (id: string) => void;
};

const roleName: Record<Role, string> = {
  ceo: "ผู้บริหาร",
  accounting: "บัญชี",
  sales: "ฝ่ายขาย",
  warehouse: "คลังสินค้า",
  production: "ฝ่ายผลิต",
  qa: "QA",
};

const documentType = {
  quotation: "ใบเสนอราคา",
  sales_order: "ใบสั่งขาย",
  delivery: "ใบส่งของ",
  tax_invoice: "ใบกำกับภาษี",
  receipt: "ใบเสร็จรับเงิน",
};

const documentStatus: Record<DocumentStatus, { label: string; tone: "green" | "amber" | "red" | "blue" | "gray" }> = {
  draft: { label: "ร่าง", tone: "gray" },
  pending: { label: "รออนุมัติ", tone: "amber" },
  approved: { label: "อนุมัติแล้ว", tone: "blue" },
  posted: { label: "ลงบัญชีแล้ว", tone: "green" },
  void: { label: "ยกเลิก", tone: "red" },
};

const productionStatus = {
  planned: { label: "รอเริ่ม", tone: "gray" as const, action: "เริ่มผลิต" },
  in_progress: { label: "กำลังผลิต", tone: "blue" as const, action: "ส่งตรวจ QA" },
  qa_hold: { label: "รอ QA ปล่อย", tone: "amber" as const, action: "รับเข้าคลัง" },
  completed: { label: "เสร็จแล้ว", tone: "green" as const, action: "เสร็จสิ้น" },
};

const partnerName = (state: ErpState, id: string) => state.partners.find((partner) => partner.id === id)?.name ?? "ไม่พบคู่ค้า";
const productName = (state: ErpState, id: string) => state.products.find((product) => product.id === id)?.name ?? "ไม่พบสินค้า";

export function DashboardView(props: ViewProps) {
  const { state, role, setView, openAction } = props;
  const metrics = summarize(state);
  const stock = stockByProduct(state.products, state.movements);
  const pendingDocs = state.salesDocuments.filter((document) => document.status === "pending");
  const expiringLots = state.lots.filter((lot) => ["expiring", "expired"].includes(lotRisk(lot, new Date("2026-08-14"))));

  return (
    <>
      <section className="welcome-card">
        <div>
          <p className="eyebrow">หน้าทำงานของ{roleName[role]}</p>
          <h1>วันนี้ควรจัดการอะไรบ้าง</h1>
          <p>ระบบเรียงงานเร่งด่วนไว้ให้แล้ว เลือกทำทีละเรื่องได้เลย</p>
        </div>
        <div className="welcome-actions">
          {(role === "ceo" || role === "sales") && <button className="button button-primary" onClick={() => openAction("sale")}>+ สร้างใบสั่งขาย</button>}
          {(role === "ceo" || role === "warehouse") && <button className="button button-secondary" onClick={() => openAction("stock")}>+ รับสินค้าเข้าคลัง</button>}
        </div>
      </section>

      <section className="metric-grid" aria-label="ตัวเลขสำคัญ">
        <article className="metric-card"><span>ยอดขายที่ลงบัญชี</span><strong><Money value={metrics.revenue} /></strong><small>บาท · นับจากใบกำกับภาษีครั้งเดียว</small></article>
        <article className="metric-card"><span>ลูกหนี้คงค้าง</span><strong><Money value={metrics.receivable} /></strong><small>บาท · หลังหักรับชำระ</small></article>
        <article className={`metric-card ${metrics.lowStock ? "metric-warning" : ""}`}><span>สินค้าต่ำกว่าจุดสั่งซื้อ</span><strong>{metrics.lowStock}</strong><small>รายการที่ต้องวางแผนผลิต</small></article>
        <article className={`metric-card ${metrics.qaHold ? "metric-warning" : ""}`}><span>Lot รอ QA ปล่อย</span><strong>{metrics.qaHold}</strong><small>Lot ที่ยังห้ามขาย</small></article>
      </section>

      <section className="dashboard-grid">
        <article className="panel task-panel">
          <div className="panel-heading"><div><p className="eyebrow">งานของวันนี้</p><h2>รอให้คุณตัดสินใจ</h2></div><span className="count-pill">{pendingDocs.length + metrics.qaHold}</span></div>
          <div className="task-list">
            {pendingDocs.slice(0, 3).map((document) => (
              <button key={document.id} className="task-row" onClick={() => setView("accounting")}>
                <span className="task-icon amber">฿</span><span><strong>{document.documentNo}</strong><small>รออนุมัติ · {partnerName(state, document.customerId)}</small></span><b>ดูงาน →</b>
              </button>
            ))}
            {state.lots.filter((lot) => lot.status === "hold").map((lot) => (
              <button key={lot.id} className="task-row" onClick={() => setView("inventory")}>
                <span className="task-icon blue">QA</span><span><strong>Lot {lot.lotNo}</strong><small>รอตรวจปล่อย · {productName(state, lot.productId)}</small></span><b>ดูงาน →</b>
              </button>
            ))}
            {!pendingDocs.length && !metrics.qaHold && <EmptyState title="งานอนุมัติเรียบร้อย" detail="ยังไม่มีรายการใหม่ที่ต้องตัดสินใจ" />}
          </div>
        </article>

        <article className="panel">
          <div className="panel-heading"><div><p className="eyebrow">คลังสินค้า</p><h2>สินค้าที่ต้องจับตา</h2></div><button className="text-button" onClick={() => setView("inventory")}>ดูทั้งหมด</button></div>
          <div className="compact-list">
            {stock.toSorted((a, b) => a.quantity - b.quantity).slice(0, 4).map((item) => (
              <div className="compact-row" key={item.id}><span><strong>{item.name}</strong><small>{item.sku}</small></span><span className={item.isLow ? "danger-text" : ""}><b>{item.quantity}</b> {item.unit}</span></div>
            ))}
          </div>
          {expiringLots.length > 0 && <div className="inline-alert">มี {expiringLots.length} Lot ใกล้หมดอายุภายใน 60 วัน</div>}
        </article>
      </section>
    </>
  );
}

export function SalesView({ state, openAction, setDocumentStatus }: ViewProps) {
  return (
    <section className="panel page-panel">
      <div className="page-heading"><div><p className="eyebrow">Sales workflow</p><h1>งานขายและเอกสารลูกค้า</h1><p>เอกสารแต่ละฉบับมีสถานะชัดเจน และไม่ถูกนับรายได้ซ้ำ</p></div><button className="button button-primary" onClick={() => openAction("sale")}>+ สร้างใบสั่งขาย</button></div>
      <div className="table-wrap"><table><thead><tr><th>เลขที่เอกสาร</th><th>ประเภท</th><th>ลูกค้า</th><th>ยอดรวม</th><th>สถานะ</th><th>จัดการ</th></tr></thead><tbody>
        {state.salesDocuments.map((document) => {
          const status = documentStatus[document.status];
          return <tr key={document.id}><td><strong>{document.documentNo}</strong><small>{new Date(document.createdAt).toLocaleDateString("th-TH")}</small></td><td>{documentType[document.type]}</td><td>{partnerName(state, document.customerId)}</td><td className="number"><Money value={document.total} /></td><td><StatusBadge tone={status.tone}>{status.label}</StatusBadge></td><td>{document.status === "pending" ? <button className="small-button" onClick={() => setDocumentStatus(document.id, "approved")}>อนุมัติ</button> : <button className="small-button muted" type="button">ดูรายละเอียด</button>}</td></tr>;
        })}
      </tbody></table></div>
    </section>
  );
}

export function InventoryView({ state, role, openAction, setLotStatus }: ViewProps) {
  const stock = stockByProduct(state.products, state.movements);
  return (
    <div className="stack">
      <section className="panel page-panel">
        <div className="page-heading"><div><p className="eyebrow">Stock ledger</p><h1>สต็อกที่เชื่อถือได้</h1><p>ยอดคงเหลือมาจากการเคลื่อนไหวสต็อกเท่านั้น ไม่หักซ้ำตามเอกสารขาย</p></div><button className="button button-primary" onClick={() => openAction("stock")}>+ รับสินค้าเข้าคลัง</button></div>
        <div className="stock-grid">{stock.map((item) => <article className={`stock-card ${item.isLow ? "stock-low" : ""}`} key={item.id}><span>{item.sku}</span><h3>{item.name}</h3><div><strong>{item.quantity}</strong> {item.unit}</div><small>จุดสั่งซื้อ {item.reorderPoint} {item.unit}</small>{item.isLow && <StatusBadge tone="red">ต้องเติมสต็อก</StatusBadge>}</article>)}</div>
      </section>
      <section className="panel page-panel">
        <div className="panel-heading"><div><p className="eyebrow">Lot & expiry</p><h2>Lot และสถานะ QA</h2></div></div>
        <div className="table-wrap"><table><thead><tr><th>Lot</th><th>สินค้า</th><th>คงเหลือ</th><th>หมดอายุ</th><th>สถานะ</th><th>QA</th></tr></thead><tbody>{state.lots.map((lot) => {
          const risk = lotRisk(lot, new Date("2026-08-14"));
          const tone = lot.status === "released" ? (risk === "expiring" ? "amber" : "green") : lot.status === "hold" ? "amber" : "red";
          const label = lot.status === "released" ? (risk === "expiring" ? "ใกล้หมดอายุ" : "ขายได้") : lot.status === "hold" ? "รอตรวจ" : "ห้ามใช้";
          return <tr key={lot.id}><td><strong>{lot.lotNo}</strong><small>รับ {new Date(lot.receivedAt).toLocaleDateString("th-TH")}</small></td><td>{productName(state, lot.productId)}</td><td>{lotQuantity(lot.id, state.movements).toLocaleString("th-TH")}</td><td>{new Date(lot.expiresAt).toLocaleDateString("th-TH")}</td><td><StatusBadge tone={tone}>{label}</StatusBadge></td><td>{lot.status === "hold" && (role === "qa" || role === "ceo") ? <button className="small-button" onClick={() => setLotStatus(lot.id, "released")}>ปล่อยสินค้า</button> : <span className="muted-text">—</span>}</td></tr>;
        })}</tbody></table></div>
      </section>
    </div>
  );
}

export function ProductionView({ state, advanceProduction }: ViewProps) {
  return (
    <section className="panel page-panel">
      <div className="page-heading"><div><p className="eyebrow">Production board</p><h1>แผนผลิตวันนี้</h1><p>พนักงานเห็นงานตามลำดับ: เริ่มผลิต → ส่ง QA → รับเข้าคลัง</p></div></div>
      <div className="kanban">{(["planned", "in_progress", "qa_hold", "completed"] as const).map((column) => <div className="kanban-column" key={column}><div className="kanban-title"><span>{productionStatus[column].label}</span><b>{state.productionOrders.filter((order) => order.status === column).length}</b></div>{state.productionOrders.filter((order) => order.status === column).map((order) => <article className="work-card" key={order.id}><span>{order.orderNo}</span><h3>{productName(state, order.productId)}</h3><dl><div><dt>Batch</dt><dd>{order.batchNo}</dd></div><div><dt>แผน</dt><dd>{order.plannedQuantity.toLocaleString("th-TH")}</dd></div><div><dt>กำหนด</dt><dd>{new Date(order.dueDate).toLocaleDateString("th-TH")}</dd></div></dl>{order.status !== "completed" && <button className="small-button full" onClick={() => advanceProduction(order.id)}>{productionStatus[order.status].action} →</button>}</article>)}</div>)}</div>
    </section>
  );
}

export function AccountingView({ state, setDocumentStatus, recordPayment }: ViewProps) {
  const invoices = state.salesDocuments.filter((document) => document.type === "tax_invoice");
  return (
    <div className="stack">
      <section className="panel page-panel">
        <div className="page-heading"><div><p className="eyebrow">Accounting workbench</p><h1>ตรวจเอกสารก่อนลงบัญชี</h1><p>ยอดขายเกิดเมื่อใบกำกับภาษีลงบัญชีแล้วเท่านั้น</p></div></div>
        <div className="table-wrap"><table><thead><tr><th>เอกสาร</th><th>ลูกค้า</th><th>ก่อน VAT</th><th>VAT</th><th>ยอดรวม</th><th>รับแล้ว</th><th>การดำเนินการ</th></tr></thead><tbody>{invoices.map((document) => <tr key={document.id}><td><strong>{document.documentNo}</strong><small><StatusBadge tone={documentStatus[document.status].tone}>{documentStatus[document.status].label}</StatusBadge></small></td><td>{partnerName(state, document.customerId)}</td><td className="number"><Money value={document.subtotal} /></td><td className="number"><Money value={document.vat} /></td><td className="number"><strong><Money value={document.total} /></strong></td><td className="number"><Money value={document.paidAmount} /></td><td className="action-cell">{document.status === "pending" && <button className="small-button" onClick={() => setDocumentStatus(document.id, "posted")}>ตรวจแล้ว · ลงบัญชี</button>}{document.status === "posted" && document.paidAmount < document.total && <button className="small-button" onClick={() => recordPayment(document.id, document.total - document.paidAmount)}>รับชำระเต็มจำนวน</button>}</td></tr>)}</tbody></table></div>
      </section>
      <section className="notice-card"><strong>ขอบเขต MVP 2.0</strong><p>หน้านี้แยก “สร้างเอกสาร” ออกจาก “ลงบัญชี” แล้ว ขั้นต่อไปคือเพิ่มผังบัญชีและรายการเดบิต–เครดิตที่คุณฟ้าอนุมัติ</p></section>
    </div>
  );
}

export function MastersView({ state }: ViewProps) {
  return <div className="master-grid"><section className="panel page-panel"><div className="panel-heading"><div><p className="eyebrow">Product master</p><h2>สินค้า</h2></div><span className="count-pill">{state.products.length}</span></div><div className="compact-list">{state.products.map((product) => <div className="compact-row" key={product.id}><span><strong>{product.name}</strong><small>{product.sku} · VAT {product.vatRate}%</small></span><span><b><Money value={product.price} /></b> บาท</span></div>)}</div></section><section className="panel page-panel"><div className="panel-heading"><div><p className="eyebrow">Partner master</p><h2>ลูกค้าและคู่ค้า</h2></div><span className="count-pill">{state.partners.length}</span></div><div className="compact-list">{state.partners.map((partner) => <div className="compact-row" key={partner.id}><span><strong>{partner.name}</strong><small>{partner.code} · {partner.country}</small></span><StatusBadge tone={partner.type === "customer" ? "blue" : "gray"}>{partner.type === "customer" ? "ลูกค้า" : "ผู้ขาย"}</StatusBadge></div>)}</div></section></div>;
}

export function AuditView({ state }: ViewProps) {
  return <section className="panel page-panel"><div className="page-heading"><div><p className="eyebrow">Audit trail</p><h1>ประวัติการทำรายการ</h1><p>ทุกการอนุมัติ รับเข้า และเปลี่ยนสถานะต้องตอบได้ว่าใครทำ เมื่อไร</p></div></div><div className="timeline">{state.auditEntries.map((entry) => <article key={entry.id}><span className="timeline-dot" /><div><p><strong>{entry.action}</strong> · {entry.entity} <b>{entry.entityId}</b></p><p>{entry.detail}</p><small>{entry.actor} · {new Date(entry.createdAt).toLocaleString("th-TH")}</small></div></article>)}</div></section>;
}
