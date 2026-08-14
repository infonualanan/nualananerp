import type { ReactNode } from "react";

export function StatusBadge({ tone, children }: { tone: "green" | "amber" | "red" | "blue" | "gray"; children: ReactNode }) {
  return <span className={`status status-${tone}`}>{children}</span>;
}

export function EmptyState({ title, detail }: { title: string; detail: string }) {
  return (
    <div className="empty-state">
      <div className="empty-mark">✓</div>
      <strong>{title}</strong>
      <span>{detail}</span>
    </div>
  );
}

export function Money({ value }: { value: number }) {
  return <>{value.toLocaleString("th-TH", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</>;
}

export function Modal({ title, description, children, onClose }: { title: string; description: string; children: ReactNode; onClose: () => void }) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="modal" role="dialog" aria-modal="true" aria-labelledby="modal-title" onMouseDown={(event) => event.stopPropagation()}>
        <header className="modal-header">
          <div>
            <p className="eyebrow">ทำรายการใหม่</p>
            <h2 id="modal-title">{title}</h2>
            <p>{description}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} aria-label="ปิดหน้าต่าง">×</button>
        </header>
        {children}
      </section>
    </div>
  );
}
