export type Role = "ceo" | "accounting" | "sales" | "warehouse" | "production" | "qa";

export type ViewKey =
  | "dashboard"
  | "sales"
  | "inventory"
  | "production"
  | "accounting"
  | "masters"
  | "audit";

export type Product = {
  id: string;
  sku: string;
  name: string;
  unit: string;
  price: number;
  reorderPoint: number;
  vatRate: number;
};

export type Partner = {
  id: string;
  code: string;
  name: string;
  type: "customer" | "supplier" | "both";
  taxId: string;
  country: string;
};

export type LotStatus = "released" | "hold" | "blocked";

export type Lot = {
  id: string;
  productId: string;
  lotNo: string;
  receivedAt: string;
  expiresAt: string;
  status: LotStatus;
};

export type StockMovement = {
  id: string;
  productId: string;
  lotId: string;
  direction: "in" | "out";
  quantity: number;
  reference: string;
  postedAt: string;
  postedBy: string;
};

export type DocumentStatus = "draft" | "pending" | "approved" | "posted" | "void";

export type SaleLine = {
  productId: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discountRate: number;
  vatRate: number;
};

export type SaleDocument = {
  id: string;
  documentNo: string;
  type: "quotation" | "sales_order" | "delivery" | "tax_invoice" | "receipt";
  customerId: string;
  status: DocumentStatus;
  lines: SaleLine[];
  subtotal: number;
  vat: number;
  total: number;
  paidAmount: number;
  sourceDocumentId?: string;
  stockPosted: boolean;
  createdAt: string;
  createdBy: string;
};

export type ProductionOrder = {
  id: string;
  orderNo: string;
  productId: string;
  batchNo: string;
  plannedQuantity: number;
  producedQuantity: number;
  dueDate: string;
  status: "planned" | "in_progress" | "qa_hold" | "completed";
};

export type AuditEntry = {
  id: string;
  action: string;
  entity: string;
  entityId: string;
  detail: string;
  actor: string;
  createdAt: string;
};

export type ErpState = {
  products: Product[];
  partners: Partner[];
  lots: Lot[];
  movements: StockMovement[];
  salesDocuments: SaleDocument[];
  productionOrders: ProductionOrder[];
  auditEntries: AuditEntry[];
};
