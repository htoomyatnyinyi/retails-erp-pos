import { relations, sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

export const syncEntities = [
  "products",
  "product_variants",
  "categories",
  "brands", // new
  "inventory",
  "inventory_movements",
  "inventory_counts",
  "customers",
  "stores",
  "sessions",
  "orders",
  "price_history",
  "staff",
  "suppliers",
  "store_settings",
] as const;
export type SyncEntity = (typeof syncEntities)[number];

export const brands = sqliteTable(
  "brands",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    tenantNameIdx: uniqueIndex("brands_tenant_name_idx").on(
      table.tenantId,
      table.name,
    ),
    tenantIdx: index("brands_tenant_idx").on(table.tenantId),
    activeIdx: index("brands_active_idx").on(table.isActive),
  }),
);

// ============================================
// 2. PRODUCTS (UPDATED)
// ============================================
export const products = sqliteTable(
  "products",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    // 🔽 Replaced 'brand' text with foreign key to brands
    brandId: text("brand_id").references(() => brands.id),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    costPrice: real("cost_price").notNull().default(0),
    sellingPrice: real("selling_price").notNull().default(0),
    wholesalePrice: real("wholesale_price").default(0),
    promoPrice: real("promo_price"),
    promoStartAt: text("promo_start_at"),
    promoEndAt: text("promo_end_at"),
    isTaxable: integer("is_taxable", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    isReturnable: integer("is_returnable", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    expiryDate: text("expiry_date"),
    manufacturingDate: text("manufacturing_date"),
    bestBeforeDate: text("best_before_date"),
    categoryId: text("category_id"),
    supplierId: text("supplier_id").references(() => suppliers.id),
    // 🔽 New: storeId (foreign key to stores)
    storeId: text("store_id").references(() => stores.id),
    deletedAt: text("deleted_at"),
    version: integer("version").notNull().default(0),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    skuIdx: uniqueIndex("products_tenant_sku_idx").on(
      table.tenantId,
      table.sku,
    ),
    barcodeIdx: uniqueIndex("products_tenant_barcode_idx").on(
      table.tenantId,
      table.barcode,
    ),
    categoryIdx: index("products_category_idx").on(table.categoryId),
    brandIdx: index("products_brand_idx").on(table.brandId),
    storeIdx: index("products_store_idx").on(table.storeId),
    tenantActiveIdx: index("products_tenant_active_idx").on(
      table.tenantId,
      table.isActive,
    ),
    expiryIdx: index("products_expiry_idx").on(table.expiryDate),
    deletedIdx: index("products_deleted_idx").on(table.deletedAt),
    skuIdx2: index("products_sku_idx").on(table.sku),
    barcodeIdx2: index("products_barcode_idx").on(table.barcode),
    tenantCreatedIdx: index("products_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
    nameIdx: index("products_name_idx").on(table.name),
  }),
);

// ============================================
// 3. PRODUCT VARIANTS
// ============================================
export const productVariants = sqliteTable(
  "product_variants",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    name: text("name").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    tenantId: text("tenant_id").notNull(),
    sku: text("sku").notNull(),
    barcode: text("barcode"),
    price: real("price").notNull(),
    costPrice: real("cost_price").notNull(),
    color: text("color"),
    size: text("size"),
    weight: real("weight"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    tenantSkuIdx: uniqueIndex("variant_tenant_sku_idx").on(
      table.tenantId,
      table.sku,
    ),
    tenantBarcodeIdx: uniqueIndex("variant_tenant_barcode_idx").on(
      table.tenantId,
      table.barcode,
    ),
    productNameIdx: uniqueIndex("variant_product_name_idx").on(
      table.productId,
      table.name,
    ),
    productIdx: index("variant_product_idx").on(table.productId),
    activeIdx: index("variant_active_idx").on(table.isActive),
    tenantIdx: index("variant_tenant_idx").on(table.tenantId),
    tenantCreatedIdx: index("variant_tenant_created_idx").on(
      table.tenantId,
      table.createdAt,
    ),
  }),
);

export const categories = sqliteTable(
  "categories",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    name: text("name").notNull(),
    description: text("description"),
    slug: text("slug"),
    parentId: text("parent_id"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    sortOrder: integer("sort_order").notNull().default(0),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    tenantNameIdx: uniqueIndex("categories_tenant_name_idx").on(
      table.tenantId,
      table.name,
    ),
    tenantSlugIdx: uniqueIndex("categories_tenant_slug_idx").on(
      table.tenantId,
      table.slug,
    ),
    parentIdx: index("categories_parent_idx").on(table.parentId),
    activeIdx: index("categories_active_idx").on(table.isActive),
  }),
);

export const inventory = sqliteTable(
  "inventory",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    storeId: text("store_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id),
    variantId: text("variant_id").references(() => productVariants.id),
    quantity: integer("quantity").notNull().default(0),
    reservedQty: integer("reserved_qty").notNull().default(0),
    reorderPoint: integer("reorder_point").notNull().default(10),
    reorderQty: integer("reorder_qty").notNull().default(0),
    shelfLocation: text("shelf_location"),
    version: integer("version").notNull().default(0),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    storeProductVariantIdx: uniqueIndex("store_product_variant_idx").on(
      table.storeId,
      table.productId,
      table.variantId,
    ),
    storeQuantityIdx: index("inventory_store_quantity_idx").on(
      table.storeId,
      table.quantity,
    ),
    productStoreIdx: index("inventory_product_store_idx").on(
      table.productId,
      table.storeId,
    ),
    reorderIdx: index("inventory_reorder_idx").on(
      table.reorderPoint,
      table.quantity,
    ),
    quantityIdx: index("inventory_quantity_idx").on(table.quantity),
    tenantIdx: index("inventory_tenant_idx").on(table.tenantId),
  }),
);

export const inventoryMovements = sqliteTable(
  "inventory_movements",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id").notNull(),
    variantId: text("variant_id"),
    storeId: text("store_id").notNull(),
    quantity: integer("quantity").notNull(),
    type: text("type").notNull(), // IN, OUT, TRANSFER, ADJUSTMENT, COUNT
    referenceId: text("reference_id").notNull(),
    referenceType: text("reference_type").notNull(),
    reason: text("reason"),
    syncStatus: text("sync_status").notNull().default("pending"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    productIdx: index("movements_product_idx").on(table.productId),
    storeIdx: index("movements_store_idx").on(table.storeId),
    typeIdx: index("movements_type_idx").on(table.type),
    referenceIdx: index("movements_reference_idx").on(
      table.referenceId,
      table.referenceType,
    ),
    createdAtIdx: index("movements_created_at_idx").on(table.createdAt),
  }),
);

// ============================================
// 7. INVENTORY COUNTS
// ============================================
export const inventoryCounts = sqliteTable(
  "inventory_counts",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    storeId: text("store_id").notNull(),
    status: text("status").notNull().default("PENDING"),
    scheduledDate: text("scheduled_date"),
    completedAt: text("completed_at"),
    notes: text("notes"),
    syncStatus: text("sync_status").notNull().default("pending"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    storeIdx: index("counts_store_idx").on(table.storeId),
    statusIdx: index("counts_status_idx").on(table.status),
    scheduledIdx: index("counts_scheduled_idx").on(table.scheduledDate),
  }),
);

export const inventoryCountItems = sqliteTable(
  "inventory_count_items",
  {
    id: text("id").primaryKey(),
    countId: text("count_id")
      .notNull()
      .references(() => inventoryCounts.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    variantId: text("variant_id"),
    systemQuantity: integer("system_quantity").notNull(),
    countedQuantity: integer("counted_quantity").notNull(),
    difference: integer("difference").notNull(),
    reason: text("reason"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    countIdx: index("count_items_count_idx").on(table.countId),
    productIdx: index("count_items_product_idx").on(table.productId),
  }),
);

export const customers = sqliteTable(
  "customers",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    dateOfBirth: text("date_of_birth"),
    gender: text("gender"),
    debtAmount: real("debt_amount").notNull().default(0),
    loyaltyPoints: integer("loyalty_points").notNull().default(0),
    totalSpent: real("total_spent").notNull().default(0),
    totalOrders: integer("total_orders").notNull().default(0),
    tier: text("tier").notNull().default("BRONZE"),
    tierValidUntil: text("tier_valid_until"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    tenantCodeIdx: uniqueIndex("customers_tenant_code_idx").on(
      table.tenantId,
      table.code,
    ),
    tenantPhoneIdx: uniqueIndex("customers_tenant_phone_idx").on(
      table.tenantId,
      table.phone,
    ),
    tenantEmailIdx: uniqueIndex("customers_tenant_email_idx").on(
      table.tenantId,
      table.email,
    ),
    nameIdx: index("customers_name_idx").on(table.name),
    activeIdx: index("customers_active_idx").on(table.isActive),
  }),
);

export const stores = sqliteTable(
  "stores",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    code: text("code").notNull(),
    name: text("name").notNull(),
    address: text("address"),
    phone: text("phone"),
    email: text("email"),
    taxNumber: text("tax_number"),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    tenantCodeIdx: uniqueIndex("stores_tenant_code_idx").on(
      table.tenantId,
      table.code,
    ),
    nameIdx: index("stores_name_idx").on(table.name),
    activeIdx: index("stores_active_idx").on(table.isActive),
  }),
);

export const sessions = sqliteTable(
  "sessions",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    storeId: text("store_id"),
    registerId: text("register_id"),
    userId: text("user_id").notNull(),
    status: text("status").notNull().default("OPEN"),
    openedAt: text("opened_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    closedAt: text("closed_at"),
    openingBalance: real("opening_balance").notNull().default(0),
    closingBalance: real("closing_balance"),
    expectedBalance: real("expected_balance"),
    discrepancy: real("discrepancy"),
    cashSales: real("cash_sales").notNull().default(0),
    cardSales: real("card_sales").notNull().default(0),
    digitalSales: real("digital_sales").notNull().default(0),
    notes: text("notes"),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    storeIdx: index("sessions_store_idx").on(table.storeId),
    userIdx: index("sessions_user_idx").on(table.userId),
    statusIdx: index("sessions_status_idx").on(table.status),
    openedIdx: index("sessions_opened_idx").on(table.openedAt),
  }),
);

// A checkout must be able to read its configuration without a network call.
// One row per key also lets a changed value be synced independently.
export const storeSettings = sqliteTable(
  "store_settings",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    storeId: text("store_id").notNull(),
    settingKey: text("setting_key").notNull(),
    settingValue: text("setting_value", { mode: "json" }).$type<unknown>().notNull(),
    description: text("description"),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at").notNull().default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    storeKeyIdx: uniqueIndex("store_settings_store_key_idx").on(table.storeId, table.settingKey),
    tenantStoreIdx: index("store_settings_tenant_store_idx").on(table.tenantId, table.storeId),
  }),
);

export const staff = sqliteTable(
  "staff",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    storeId: text("store_id"),
    username: text("username").notNull(),
    email: text("email"),
    name: text("name").notNull(),
    role: text("role").notNull().default("CASHIER"),
    permissions: text("permissions", { mode: "json" })
      .$type<string[]>()
      .default([]),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    tenantUsernameIdx: uniqueIndex("staff_tenant_username_idx").on(
      table.tenantId,
      table.username,
    ),
    tenantEmailIdx: uniqueIndex("staff_tenant_email_idx").on(
      table.tenantId,
      table.email,
    ),
    storeIdx: index("staff_store_idx").on(table.storeId),
    roleIdx: index("staff_role_idx").on(table.role),
    activeIdx: index("staff_active_idx").on(table.isActive),
    tenantIdx: index("staff_tenant_idx").on(table.tenantId),
  }),
);

export const suppliers = sqliteTable(
  "suppliers",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    storeId: text("store_id"),
    code: text("code").notNull(),
    name: text("name").notNull(),
    contactName: text("contact_name"),
    phone: text("phone"),
    email: text("email"),
    address: text("address"),
    taxNumber: text("tax_number"),
    paymentTerms: integer("payment_terms"),
    creditLimit: real("credit_limit"),
    currentBalance: real("current_balance").notNull().default(0),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    tenantCodeIdx: uniqueIndex("suppliers_tenant_code_idx").on(
      table.tenantId,
      table.code,
    ),
    tenantPhoneIdx: uniqueIndex("suppliers_tenant_phone_idx").on(
      table.tenantId,
      table.phone,
    ),
    tenantEmailIdx: uniqueIndex("suppliers_tenant_email_idx").on(
      table.tenantId,
      table.email,
    ),
    storeIdx: index("suppliers_store_idx").on(table.storeId),
    nameIdx: index("suppliers_name_idx").on(table.name),
    activeIdx: index("suppliers_active_idx").on(table.isActive),
    tenantIdx: index("suppliers_tenant_idx").on(table.tenantId),
  }),
);

export const orders = sqliteTable(
  "orders",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    storeId: text("store_id"),
    registerId: text("register_id"),
    userId: text("user_id").notNull(),
    customerId: text("customer_id"),
    sessionId: text("session_id"),
    orderNumber: text("order_number"),
    status: text("status").notNull().default("PENDING"),
    paymentStatus: text("payment_status").notNull().default("PENDING"),
    paymentMethod: text("payment_method").notNull(),
    subTotal: real("sub_total").notNull(),
    taxAmount: real("tax_amount").notNull().default(0),
    discountAmount: real("discount_amount").notNull().default(0),
    grandTotal: real("grand_total").notNull(),
    paidAmount: real("paid_amount").notNull().default(0),
    changeAmount: real("change_amount").notNull().default(0),
    paymentBreakdown: text("payment_breakdown", { mode: "json" }),
    syncStatus: text("sync_status").notNull().default("pending"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    tenantOrderIdx: uniqueIndex("orders_tenant_order_idx").on(
      table.tenantId,
      table.orderNumber,
    ),
    storeIdx: index("orders_store_idx").on(table.storeId),
    customerIdx: index("orders_customer_idx").on(table.customerId),
    sessionIdx: index("orders_session_idx").on(table.sessionId),
    statusIdx: index("orders_status_idx").on(table.status),
    paymentStatusIdx: index("orders_payment_status_idx").on(
      table.paymentStatus,
    ),
    createdAtIdx: index("orders_created_at_idx").on(table.createdAt),
  }),
);

export const orderItems = sqliteTable(
  "order_items",
  {
    id: text("id").primaryKey(),
    orderId: text("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    productId: text("product_id").notNull(),
    variantId: text("variant_id").references(() => productVariants.id),
    productName: text("product_name"),
    quantity: integer("quantity").notNull(),
    unitPrice: real("unit_price").notNull(),
    discountAmount: real("discount_amount").notNull().default(0),
    subTotal: real("sub_total").notNull(),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    orderIdx: index("order_items_order_idx").on(table.orderId),
    productIdx: index("order_items_product_idx").on(table.productId),
    variantIdx: index("order_items_variant_idx").on(table.variantId),
  }),
);

export const priceHistory = sqliteTable(
  "price_history",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id").unique(),
    tenantId: text("tenant_id").notNull(),
    productId: text("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    variantId: text("variant_id").references(() => productVariants.id),
    oldPrice: real("old_price").notNull(),
    newPrice: real("new_price").notNull(),
    changedBy: text("changed_by"),
    reason: text("reason"),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    productIdx: index("price_history_product_idx").on(table.productId),
    variantIdx: index("price_history_variant_idx").on(table.variantId),
    tenantIdx: index("price_history_tenant_idx").on(table.tenantId),
    createdIdx: index("price_history_created_idx").on(table.createdAt),
  }),
);

export const syncOutbox = sqliteTable(
  "sync_outbox",
  {
    id: text("id").primaryKey(),
    entity: text("entity").notNull(),
    entityId: text("entity_id").notNull(),
    operation: text("operation").notNull(),
    endpoint: text("endpoint").notNull(),
    method: text("method").notNull(),
    payload: text("payload", { mode: "json" }).notNull(),
    status: text("status").notNull().default("pending"),
    attempts: integer("attempts").notNull().default(0),
    nextAttemptAt: text("next_attempt_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastError: text("last_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
  },
  (table) => ({
    entityIdx: index("outbox_entity_idx").on(table.entity),
    statusIdx: index("outbox_status_idx").on(table.status),
    nextAttemptIdx: index("outbox_next_attempt_idx").on(table.nextAttemptAt),
  }),
);

export const syncState = sqliteTable(
  "sync_state",
  {
    entity: text("entity").primaryKey(),
    cursor: text("cursor"),
    lastPulledAt: text("last_pulled_at"),
    lastPushedAt: text("last_pushed_at"),
    lastError: text("last_error"),
  },
  (table) => ({
    entityIdx: index("sync_state_entity_idx").on(table.entity),
  }),
);

export const genericRecords = sqliteTable(
  "generic_records",
  {
    id: text("id").primaryKey(),
    remoteId: text("remote_id"),
    entity: text("entity").notNull(),
    data: text("data", { mode: "json" }).notNull(),
    isActive: integer("is_active", { mode: "boolean" })
      .notNull()
      .default(sql`1`),
    syncStatus: text("sync_status").notNull().default("synced"),
    syncError: text("sync_error"),
    createdAt: text("created_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    updatedAt: text("updated_at")
      .notNull()
      .default(sql`CURRENT_TIMESTAMP`),
    lastSyncedAt: text("last_synced_at"),
  },
  (table) => ({
    entityIdx: index("generic_entity_idx").on(table.entity),
    activeIdx: index("generic_active_idx").on(table.isActive),
  }),
);

export const brandsRelations = relations(brands, ({ many }) => ({
  products: many(products),
}));

export const productsRelations = relations(products, ({ many, one }) => ({
  category: one(categories, {
    fields: [products.categoryId],
    references: [categories.id],
  }),
  brand: one(brands, {
    fields: [products.brandId],
    references: [brands.id],
  }),
  store: one(stores, {
    fields: [products.storeId],
    references: [stores.id],
  }),
  supplier: one(suppliers, {
    fields: [products.supplierId],
    references: [suppliers.id],
  }),
  variants: many(productVariants),
  inventory: many(inventory),
  orderItems: many(orderItems),
  stockMovements: many(inventoryMovements),
  priceHistory: many(priceHistory),
}));

export const productVariantsRelations = relations(
  productVariants,
  ({ one, many }) => ({
    product: one(products, {
      fields: [productVariants.productId],
      references: [products.id],
    }),
    inventory: many(inventory),
    orderItems: many(orderItems),
    stockMovements: many(inventoryMovements),
    priceHistory: many(priceHistory),
  }),
);

export const categoriesRelations = relations(categories, ({ one, many }) => ({
  parent: one(categories, {
    fields: [categories.parentId],
    references: [categories.id],
  }),
  children: many(categories),
  products: many(products),
}));

export const inventoryRelations = relations(inventory, ({ one }) => ({
  product: one(products, {
    fields: [inventory.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [inventory.variantId],
    references: [productVariants.id],
  }),
  store: one(stores, {
    fields: [inventory.storeId],
    references: [stores.id],
  }),
}));

export const inventoryMovementsRelations = relations(
  inventoryMovements,
  ({ one }) => ({
    product: one(products, {
      fields: [inventoryMovements.productId],
      references: [products.id],
    }),
    variant: one(productVariants, {
      fields: [inventoryMovements.variantId],
      references: [productVariants.id],
    }),
    store: one(stores, {
      fields: [inventoryMovements.storeId],
      references: [stores.id],
    }),
  }),
);

export const inventoryCountsRelations = relations(
  inventoryCounts,
  ({ one, many }) => ({
    store: one(stores, {
      fields: [inventoryCounts.storeId],
      references: [stores.id],
    }),
    items: many(inventoryCountItems),
  }),
);

export const inventoryCountItemsRelations = relations(
  inventoryCountItems,
  ({ one }) => ({
    count: one(inventoryCounts, {
      fields: [inventoryCountItems.countId],
      references: [inventoryCounts.id],
    }),
    product: one(products, {
      fields: [inventoryCountItems.productId],
      references: [products.id],
    }),
    variant: one(productVariants, {
      fields: [inventoryCountItems.variantId],
      references: [productVariants.id],
    }),
  }),
);

export const customersRelations = relations(customers, ({ many }) => ({
  orders: many(orders),
}));

export const storesRelations = relations(stores, ({ many }) => ({
  inventory: many(inventory),
  orders: many(orders),
  sessions: many(sessions),
  staff: many(staff),
  suppliers: many(suppliers),
  products: many(products),
}));

export const sessionsRelations = relations(sessions, ({ many }) => ({
  orders: many(orders),
}));

export const staffRelations = relations(staff, ({ one }) => ({
  store: one(stores, {
    fields: [staff.storeId],
    references: [stores.id],
  }),
}));

export const suppliersRelations = relations(suppliers, ({ one, many }) => ({
  store: one(stores, {
    fields: [suppliers.storeId],
    references: [stores.id],
  }),
  products: many(products),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  customer: one(customers, {
    fields: [orders.customerId],
    references: [customers.id],
  }),
  store: one(stores, {
    fields: [orders.storeId],
    references: [stores.id],
  }),
  session: one(sessions, {
    fields: [orders.sessionId],
    references: [sessions.id],
  }),
  items: many(orderItems),
}));

export const orderItemsRelations = relations(orderItems, ({ one }) => ({
  order: one(orders, {
    fields: [orderItems.orderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderItems.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [orderItems.variantId],
    references: [productVariants.id],
  }),
}));

export const priceHistoryRelations = relations(priceHistory, ({ one }) => ({
  product: one(products, {
    fields: [priceHistory.productId],
    references: [products.id],
  }),
  variant: one(productVariants, {
    fields: [priceHistory.variantId],
    references: [productVariants.id],
  }),
}));

export type LocalBrand = typeof brands.$inferSelect;
export type LocalProduct = typeof products.$inferSelect;
export type LocalProductVariant = typeof productVariants.$inferSelect;
export type LocalCategory = typeof categories.$inferSelect;
export type LocalInventory = typeof inventory.$inferSelect;
export type LocalInventoryMovement = typeof inventoryMovements.$inferSelect;
export type LocalInventoryCount = typeof inventoryCounts.$inferSelect;
export type LocalInventoryCountItem = typeof inventoryCountItems.$inferSelect;
export type LocalCustomer = typeof customers.$inferSelect;
export type LocalStore = typeof stores.$inferSelect;
export type LocalStaff = typeof staff.$inferSelect;
export type LocalSupplier = typeof suppliers.$inferSelect;
export type LocalSession = typeof sessions.$inferSelect;
export type LocalStoreSetting = typeof storeSettings.$inferSelect;
export type LocalOrder = typeof orders.$inferSelect;
export type LocalOrderItem = typeof orderItems.$inferSelect;
export type LocalPriceHistory = typeof priceHistory.$inferSelect;
export type SyncOutboxItem = typeof syncOutbox.$inferSelect;
export type SyncState = typeof syncState.$inferSelect;
export type GenericRecord = typeof genericRecords.$inferSelect;

// ============================================
// 22. INSERT TYPES
// ============================================

export type InsertBrand = typeof brands.$inferInsert;
export type InsertProduct = typeof products.$inferInsert;
export type InsertProductVariant = typeof productVariants.$inferInsert;
export type InsertCategory = typeof categories.$inferInsert;
export type InsertInventory = typeof inventory.$inferInsert;
export type InsertInventoryMovement = typeof inventoryMovements.$inferInsert;
export type InsertInventoryCount = typeof inventoryCounts.$inferInsert;
export type InsertInventoryCountItem = typeof inventoryCountItems.$inferInsert;
export type InsertCustomer = typeof customers.$inferInsert;
export type InsertStore = typeof stores.$inferInsert;
export type InsertStaff = typeof staff.$inferInsert;
export type InsertSupplier = typeof suppliers.$inferInsert;
export type InsertSession = typeof sessions.$inferInsert;
export type InsertStoreSetting = typeof storeSettings.$inferInsert;
export type InsertOrder = typeof orders.$inferInsert;
export type InsertOrderItem = typeof orderItems.$inferInsert;
export type InsertPriceHistory = typeof priceHistory.$inferInsert;
export type InsertSyncOutbox = typeof syncOutbox.$inferInsert;
export type InsertSyncState = typeof syncState.$inferInsert;
export type InsertGenericRecord = typeof genericRecords.$inferInsert;
