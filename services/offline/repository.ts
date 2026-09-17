import type {
  Category,
  CreateCategoryPayload,
} from "@/services/features/categories/categoryTypes";
import type {
  CreateCustomerPayload,
  Customer,
} from "@/services/features/customers/customerTypes";
import type {
  CreateCountPayload,
  CreateMovementPayload,
  InventoryItem,
} from "@/services/features/inventory/inventoryTypes";
import type {
  CreateOrderPayload,
  Order,
  OrderItem,
} from "@/services/features/order/orderTypes";
import type { Product } from "@/services/features/products/productTypes";
import type {
  CloseSessionPayload,
  Session,
} from "@/services/features/sessions/sessionTypes";
import type {
  CreateStorePayload,
  Store,
} from "@/services/features/stores/storeTypes";
import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
import { getOfflineDb, getSqliteDatabase } from "./db";
import { createLocalId } from "./ids";
import { isOnline } from "./network";
import {
  brands,
  categories,
  customers,
  genericRecords,
  inventory,
  inventoryCounts,
  inventoryMovements,
  orderItems,
  orders,
  priceHistory,
  productVariants,
  products,
  sessions,
  staff,
  stores,
  suppliers,
  syncOutbox,
  type LocalBrand,
  type LocalCategory,
  type LocalCustomer,
  type LocalInventory,
  type LocalOrder,
  type LocalProduct,
  type LocalProductVariant,
  type LocalSession,
  type LocalStore,
} from "./schema";

// ============================================
// HELPER: Disable foreign keys temporarily
// ============================================
async function withForeignKeysOff<T>(
  db: ReturnType<typeof getOfflineDb>,
  callback: () => Promise<T>,
): Promise<T> {
  await db.run(sql`PRAGMA foreign_keys = OFF`);
  try {
    return await callback();
  } finally {
    await db.run(sql`PRAGMA foreign_keys = ON`);
  }
}

// ============================================
// MOVEMENT TYPE MAPPING (to backend enum)
// ============================================
function mapMovementType(type: string, referenceType?: string): string {
  type = String(type ?? "").toUpperCase();
  referenceType = String(referenceType ?? "").toUpperCase();
  // Stock adjustments → ADJUSTMENT
  if (referenceType === "STOCK_ADJUSTMENT") {
    return "ADJUSTMENT";
  }
  // Orders: OUT → SALE, IN → RETURN_IN
  if (referenceType === "ORDER") {
    if (type === "OUT") return "SALE";
    if (type === "IN") return "RETURN_IN";
  }
  // Purchase orders → PURCHASE
  if (referenceType === "PURCHASE" || referenceType === "PURCHASE_ORDER") {
    return "PURCHASE";
  }
  // Stock transfers
  if (referenceType === "TRANSFER" || referenceType === "STOCK_TRANSFER") {
    if (type === "IN") return "TRANSFER_IN";
    if (type === "OUT") return "TRANSFER_OUT";
  }
  // Inventory counts → COUNTING
  if (referenceType === "INVENTORY_COUNT" || referenceType === "COUNT") {
    return "COUNTING";
  }
  // Opening stock
  if (referenceType === "OPENING_STOCK") {
    return "OPENING_STOCK";
  }
  // Fallback
  if (type === "IN") return "PURCHASE";
  if (type === "OUT") return "SALE";
  return type;
}

// ============================================
// NORMALIZATION FUNCTIONS
// ============================================

export function normalizeProduct(
  product: Product & Record<string, any>,
): typeof products.$inferInsert {
  const raw = product as any;
  return {
    id: raw.id ?? raw._id ?? raw.productId ?? raw.product_id ?? raw.remoteId,
    remoteId: raw.remoteId ?? raw.remote_id ?? raw.id ?? null,
    tenantId: raw.tenantId ?? raw.tenant_id,
    name: raw.name || "Unnamed Product",
    description: raw.description,
    brandId:
      (raw.brandId ?? raw.brand_id) &&
      String(raw.brandId ?? raw.brand_id).trim() !== ""
        ? raw.brandId ?? raw.brand_id
        : null,
    storeId:
      (raw.storeId ?? raw.store_id) &&
      String(raw.storeId ?? raw.store_id).trim() !== ""
        ? raw.storeId ?? raw.store_id
        : null,
    categoryId:
      (raw.categoryId ?? raw.category_id) &&
      String(raw.categoryId ?? raw.category_id).trim() !== ""
        ? raw.categoryId ?? raw.category_id
        : null,
    supplierId:
      (raw.supplierId ?? raw.supplier_id) &&
      String(raw.supplierId ?? raw.supplier_id).trim() !== ""
        ? raw.supplierId ?? raw.supplier_id
        : null,
    sku:
      raw.sku ||
      `SKU-${String(
        raw.id ?? raw._id ?? raw.productId ?? raw.remoteId ?? Date.now(),
      ).slice(-8)}`,
    barcode: raw.barcode,
    costPrice: Number(raw.costPrice ?? raw.cost_price ?? 0),
    sellingPrice: Number(raw.sellingPrice ?? raw.selling_price ?? 0),
    wholesalePrice: Number(raw.wholesalePrice ?? raw.wholesale_price ?? 0),
    promoPrice: raw.promoPrice ? Number(raw.promoPrice) : null,
    promoStartAt: raw.promoStartAt ?? raw.promo_start_at,
    promoEndAt: raw.promoEndAt ?? raw.promo_end_at,
    isTaxable: raw.isTaxable ?? raw.is_taxable ?? true,
    isActive: raw.isActive ?? raw.is_active ?? true,
    isReturnable: raw.isReturnable ?? raw.is_returnable ?? true,
    expiryDate: raw.expiryDate ?? raw.expiry_date,
    manufacturingDate: raw.manufacturingDate ?? raw.manufacturing_date,
    bestBeforeDate: raw.bestBeforeDate ?? raw.best_before_date,
    deletedAt: raw.deletedAt ?? raw.deleted_at,
    version: Number(raw.version ?? 0),
    syncStatus: "synced",
    syncError: null,
    createdAt: raw.createdAt ?? raw.created_at ?? new Date().toISOString(),
    updatedAt: raw.updatedAt ?? raw.updated_at ?? new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
  };
}

export function normalizeProductVariant(
  variant: any,
): typeof productVariants.$inferInsert {
  const id = variant.id ?? variant._id ?? variant.remoteId ?? variant.remote_id;
  const productId =
    variant.productId ??
    variant.product_id ??
    variant.product?.id ??
    variant.product?._id;
  return {
    id,
    remoteId: variant.remoteId ?? variant.remote_id ?? variant.id ?? variant._id,
    name: variant.name ?? variant.variantName ?? variant.variant_name ?? "Unnamed Variant",
    productId,
    tenantId: variant.tenantId ?? variant.tenant_id,
    sku: variant.sku ?? `VAR-${String(id ?? Date.now()).slice(-8)}`,
    barcode: variant.barcode ?? variant.bar_code,
    price: Number(variant.price ?? variant.sellingPrice ?? variant.selling_price ?? 0),
    costPrice: Number(variant.costPrice ?? variant.cost_price ?? 0),
    color: variant.color,
    size: variant.size,
    weight: variant.weight != null ? Number(variant.weight) : null,
    isActive: variant.isActive ?? variant.is_active ?? true,
    syncStatus: "synced",
    syncError: null,
    createdAt: variant.createdAt ?? variant.created_at ?? new Date().toISOString(),
    updatedAt: variant.updatedAt ?? variant.updated_at ?? new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
  };
}

export function normalizeInventory(inv: any): typeof inventory.$inferInsert {
  const rawProductId =
    inv.productId ?? inv.product_id ?? inv.product?.id ?? inv.product?._id;
  const productId =
    rawProductId && typeof rawProductId === "object"
      ? rawProductId.id ?? rawProductId._id
      : rawProductId;
  const storeId = inv.storeId ?? inv.store_id ?? inv.store?.id ?? inv.store?._id;
  const rawVariantId =
    inv.variantId ??
    inv.variant_id ??
    inv.variant?.id ??
    inv.variant?._id ??
    null;
  const variantId =
    rawVariantId && typeof rawVariantId === "object"
      ? rawVariantId.id ?? rawVariantId._id
      : rawVariantId;
  return {
    id: inv.id ?? inv._id ?? inv.remoteId,
    remoteId: inv.remoteId ?? inv.remote_id ?? inv.id,
    tenantId: inv.tenantId ?? inv.tenant_id,
    storeId,
    productId: productId && String(productId).trim() !== "" ? productId : null,
    variantId: variantId && String(variantId).trim() !== "" ? variantId : null,
    quantity: Number(
      inv.quantity ??
        inv.availableQuantity ??
        inv.available_quantity ??
        inv.stockQuantity ??
        inv.stock_quantity ??
        inv.currentStock ??
        inv.current_stock ??
        inv.onHand ??
        inv.on_hand ??
        inv.stock ??
        0,
    ),
    reservedQty: Number(inv.reservedQty ?? inv.reserved_qty ?? 0),
    reorderPoint: Number(inv.reorderPoint ?? inv.reorder_point ?? 10),
    reorderQty: Number(inv.reorderQty ?? inv.reorder_qty ?? 0),
    shelfLocation: inv.shelfLocation ?? inv.shelf_location,
    version: Number(inv.version ?? 0),
    syncStatus: "synced",
    syncError: null,
    createdAt: inv.createdAt ?? new Date().toISOString(),
    updatedAt: inv.updatedAt ?? new Date().toISOString(),
    lastSyncedAt: new Date().toISOString(),
  };
}

// ============================================
// UPSERT FUNCTIONS (Pull from Server)
// ============================================

export async function upsertBrands(
  remoteBrands: any[],
  defaultTenantId: string,
) {
  if (!remoteBrands.length) return;
  const now = new Date().toISOString();

  const brandsToInsert = remoteBrands.map((brand) => ({
    id: brand.id,
    remoteId: brand.remoteId ?? brand.id,
    tenantId: brand.tenantId || defaultTenantId,
    name: brand.name,
    description: brand.description,
    isActive: brand.isActive ?? true,
    syncStatus: "synced",
    syncError: null,
    createdAt: brand.createdAt ?? now,
    updatedAt: brand.updatedAt ?? now,
    lastSyncedAt: now,
  }));

  await getOfflineDb()
    .insert(brands)
    .values(brandsToInsert)
    .onConflictDoUpdate({
      target: brands.id,
      set: {
        remoteId: sql`excluded.remote_id`,
        name: sql`excluded.name`,
        description: sql`excluded.description`,
        isActive: sql`excluded.is_active`,
        syncStatus: "synced",
        syncError: null,
        updatedAt: sql`excluded.updated_at`,
        lastSyncedAt: now,
      },
    });
}

export async function upsertProducts(
  remoteProducts: Product[],
  defaultTenantId: string,
) {
  if (!remoteProducts.length) return;
  const db = getOfflineDb();

  const remoteToLocalId: Record<string, string> = {};
  const productsToInsert: Array<typeof products.$inferInsert> = [];
  const seenIds = new Set<string>();

  for (const product of remoteProducts) {
    const normalized = normalizeProduct(product);
    if (!normalized.tenantId) normalized.tenantId = defaultTenantId;

    const remoteId = String(normalized.id);
    // A locally-created product receives its server ID as `remoteId` as soon
    // as its create mutation succeeds.  Match that first: master products
    // with sellable options intentionally have no product-level SKU/barcode.
    // Falling back to SKU/barcode preserves reconciliation for older records.
    const existingByRemoteId = (
      await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.remoteId, remoteId))
        .limit(1)
    )[0];
    const existing = existingByRemoteId ?? (normalized.barcode
      ? (
          await db
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(
              and(
                eq(products.tenantId, normalized.tenantId),
                eq(products.barcode, normalized.barcode),
              ),
            )
            .limit(1)
        )[0]
      : normalized.sku
        ? (
            await db
              .select({ id: products.id })
              .from(products)
              .where(
                and(
                  eq(products.tenantId, normalized.tenantId),
                  eq(products.sku, normalized.sku),
                ),
              )
              .limit(1)
          )[0]
        : undefined);

    if (existing && existing.id !== normalized.id) {
      remoteToLocalId[remoteId] = existing.id;
      normalized.id = existing.id;
      normalized.remoteId = remoteId;

      // The server accepted this product earlier; prevent the old local
      // create mutation from retrying and creating a duplicate.
      await db
        .update(syncOutbox)
        .set({ status: "synced", lastError: null, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(syncOutbox.entity, "products"),
            eq(syncOutbox.entityId, existing.id),
            eq(syncOutbox.operation, "create"),
          ),
        );
    }

    remoteToLocalId[remoteId] = normalized.id;

    if (!seenIds.has(String(normalized.id))) {
      seenIds.add(String(normalized.id));
      productsToInsert.push(normalized);
    }
  }

  await withForeignKeysOff(db, async () => {
    await db
      .insert(products)
      .values(productsToInsert)
      .onConflictDoUpdate({
        target: products.id,
        set: {
          sku: sql`excluded.sku`,
          barcode: sql`excluded.barcode`,
          name: sql`excluded.name`,
          description: sql`excluded.description`,
          brandId: sql`excluded.brand_id`,
          storeId: sql`excluded.store_id`,
          costPrice: sql`excluded.cost_price`,
          sellingPrice: sql`excluded.selling_price`,
          wholesalePrice: sql`excluded.wholesale_price`,
          promoPrice: sql`excluded.promo_price`,
          promoStartAt: sql`excluded.promo_start_at`,
          promoEndAt: sql`excluded.promo_end_at`,
          isTaxable: sql`excluded.is_taxable`,
          isActive: sql`excluded.is_active`,
          isReturnable: sql`excluded.is_returnable`,
          expiryDate: sql`excluded.expiry_date`,
          manufacturingDate: sql`excluded.manufacturing_date`,
          bestBeforeDate: sql`excluded.best_before_date`,
          categoryId: sql`excluded.category_id`,
          supplierId: sql`excluded.supplier_id`,
          deletedAt: sql`excluded.deleted_at`,
          version: sql`excluded.version`,
          syncStatus: "synced",
          syncError: null,
          updatedAt: sql`excluded.updated_at`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      });
  });

  return remoteToLocalId;
}

export async function upsertProductVariants(
  remoteVariants: any[],
  defaultTenantId: string,
) {
  if (!remoteVariants.length) return;
  const db = getOfflineDb();

  const variantsToInsert: Array<typeof productVariants.$inferInsert> = [];
  const seenVariantIds = new Set<string>();
  for (const variant of remoteVariants) {
    const normalized = normalizeProductVariant(variant);
    if (!normalized.tenantId) normalized.tenantId = defaultTenantId;
    const remoteId = String(normalized.id);

    // The API returns server product IDs while the offline row uses a local
    // product ID. Resolve that boundary before trying to match the variant.
    const [localProduct] = await db
      .select({ id: products.id })
      .from(products)
      .where(
        or(
          eq(products.id, String(normalized.productId)),
          eq(products.remoteId, String(normalized.productId)),
        ),
      )
      .limit(1);
    if (localProduct) normalized.productId = localProduct.id;

    // Like products, variants created offline have a local primary key. Once
    // the parent product is pushed, the next pull returns server variant IDs.
    // Merge that returned row into its local option by parent + SKU instead of
    // inserting a duplicate option.
    const existingByRemoteId = (
      await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(eq(productVariants.remoteId, remoteId))
        .limit(1)
    )[0];
    const skuCandidates = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, String(normalized.productId)),
          eq(productVariants.sku, String(normalized.sku)),
        ),
      )
      .limit(10);
    const existingByProductAndSku =
      skuCandidates.find((candidate) => candidate.id.startsWith("var_")) ??
      skuCandidates[0];
    const nameCandidates = await db
      .select({ id: productVariants.id })
      .from(productVariants)
      .where(
        and(
          eq(productVariants.productId, String(normalized.productId)),
          eq(productVariants.name, String(normalized.name)),
        ),
      )
      .limit(10);
    const existingByProductAndName =
      nameCandidates.find((candidate) => candidate.id.startsWith("var_")) ??
      nameCandidates[0];
    // Prefer the stable offline SKU/name identity over a server ID. This is
    // important for devices that previously pulled a server option as a
    // second row before the offline row received its remoteId.
    const existing = existingByProductAndSku ?? existingByProductAndName ?? existingByRemoteId;
    if (existing && existing.id !== normalized.id) {
      await db
        .update(inventory)
        .set({ variantId: existing.id, updatedAt: new Date().toISOString() })
        .where(eq(inventory.variantId, normalized.id));
      await db
        .update(orderItems)
        .set({ variantId: existing.id })
        .where(eq(orderItems.variantId, normalized.id));
      await db
        .update(syncOutbox)
        .set({ status: "synced", lastError: null, updatedAt: new Date().toISOString() })
        .where(
          and(
            eq(syncOutbox.entity, "product_variants"),
            eq(syncOutbox.entityId, normalized.id),
          ),
        );
      await db
        .delete(productVariants)
        .where(eq(productVariants.id, normalized.id));
      normalized.id = existing.id;
      normalized.remoteId = remoteId;
    }
    if (seenVariantIds.has(String(normalized.id))) continue;
    seenVariantIds.add(String(normalized.id));
    variantsToInsert.push(normalized);
  }

  await withForeignKeysOff(db, async () => {
    await db
      .insert(productVariants)
      .values(variantsToInsert)
      .onConflictDoUpdate({
        target: productVariants.id,
        set: {
          sku: sql`excluded.sku`,
          barcode: sql`excluded.barcode`,
          name: sql`excluded.name`,
          price: sql`excluded.price`,
          costPrice: sql`excluded.cost_price`,
          remoteId: sql`excluded.remote_id`,
          productId: sql`excluded.product_id`,
          color: sql`excluded.color`,
          size: sql`excluded.size`,
          weight: sql`excluded.weight`,
          isActive: sql`excluded.is_active`,
          syncStatus: "synced",
          syncError: null,
          updatedAt: sql`excluded.updated_at`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      });
  });
}

export async function upsertInventory(
  remoteInventory: any[],
  defaultTenantId: string,
) {
  if (!remoteInventory.length) return;
  const db = getOfflineDb();

  const inventoryToInsert: Array<typeof inventory.$inferInsert> = [];
  for (const inv of remoteInventory) {
    const normalized = normalizeInventory(inv);
    if (!normalized.tenantId) normalized.tenantId = defaultTenantId;
    const remoteId = String(normalized.id);

    // Resolve server IDs back to the stable local records created while
    // offline. Without this, the first server inventory pull after creating
    // a product with options would add a second inventory row per option.
    if (normalized.productId) {
      const [localProduct] = await db
        .select({ id: products.id })
        .from(products)
        .where(eq(products.remoteId, String(normalized.productId)))
        .limit(1);
      if (localProduct) normalized.productId = localProduct.id;
    }
    if (normalized.variantId) {
      const [localVariant] = await db
        .select({ id: productVariants.id })
        .from(productVariants)
        .where(
          or(
            eq(productVariants.id, String(normalized.variantId)),
            eq(productVariants.remoteId, String(normalized.variantId)),
          ),
        )
        .limit(1);
      if (localVariant) normalized.variantId = localVariant.id;
    }

    if (normalized.storeId) {
      const [localStore] = await db
        .select({ id: stores.id })
        .from(stores)
        .where(
          or(
            eq(stores.id, String(normalized.storeId)),
            eq(stores.remoteId, String(normalized.storeId)),
          ),
        )
        .limit(1);
      if (localStore) normalized.storeId = localStore.id;
    }

    // Do not let a malformed server row abort the whole inventory pull.
    // The local schema requires these keys and the row cannot be displayed
    // or edited without them anyway.
    if (!normalized.storeId || !normalized.productId) continue;

    const existingByRemoteId = (
      await db
        .select({ id: inventory.id })
        .from(inventory)
        .where(eq(inventory.remoteId, remoteId))
        .limit(1)
    )[0];
    const existingByIdentity = existingByRemoteId
      ? undefined
      : (
          await db
            .select({ id: inventory.id })
            .from(inventory)
            .where(
              and(
                eq(inventory.tenantId, normalized.tenantId),
                eq(inventory.storeId, normalized.storeId),
                eq(inventory.productId, normalized.productId),
                normalized.variantId
                  ? eq(inventory.variantId, normalized.variantId)
                  : sql`${inventory.variantId} IS NULL`,
              ),
            )
            .limit(1)
        )[0];
    const existing = existingByRemoteId ?? existingByIdentity;
    if (existing && existing.id !== normalized.id) {
      normalized.id = existing.id;
      normalized.remoteId = remoteId;
    }
    inventoryToInsert.push(normalized);
  }

  await withForeignKeysOff(db, async () => {
    await db
      .insert(inventory)
      .values(inventoryToInsert)
      .onConflictDoUpdate({
        target: inventory.id,
        set: {
          tenantId: sql`excluded.tenant_id`,
          storeId: sql`excluded.store_id`,
          productId: sql`excluded.product_id`,
          variantId: sql`excluded.variant_id`,
          quantity: sql`excluded.quantity`,
          reservedQty: sql`excluded.reserved_qty`,
          reorderPoint: sql`excluded.reorder_point`,
          reorderQty: sql`excluded.reorder_qty`,
          shelfLocation: sql`excluded.shelf_location`,
          version: sql`excluded.version`,
          syncStatus: "synced",
          syncError: null,
          updatedAt: sql`excluded.updated_at`,
          lastSyncedAt: sql`excluded.last_synced_at`,
        },
      });
  });
}

/** Cache server movement history locally so the inventory timeline works offline. */
export async function upsertInventoryMovements(
  remoteMovements: any[],
  defaultTenantId: string,
) {
  if (!remoteMovements.length) return;

  const db = getOfflineDb();
  const now = new Date().toISOString();

  const localMovementType = (value: unknown) => {
    const type = String(value ?? "").toUpperCase();
    if (["PURCHASE", "RETURN_IN", "OPENING_STOCK"].includes(type)) return "IN";
    if (type === "SALE") return "OUT";
    if (type === "COUNTING") return "COUNT";
    return type || "ADJUSTMENT";
  };
  const entityId = (value: any) =>
    value && typeof value === "object"
      ? value.id ?? value._id ?? value.remoteId
      : value;

  for (const movement of remoteMovements) {
    const remoteId = String(movement.id ?? movement._id ?? movement.remoteId ?? "");
    if (!remoteId) continue;

    const remoteProductId = entityId(
      movement.productId ?? movement.product_id ?? movement.product,
    );
    const remoteVariantId = entityId(
      movement.variantId ?? movement.variant_id ?? movement.variant,
    );
    const remoteStoreId = entityId(
      movement.storeId ?? movement.store_id ?? movement.store,
    );
    if (!remoteProductId || !remoteStoreId) continue;

    const [localProduct] = await db
      .select({ id: products.id })
      .from(products)
      .where(or(eq(products.remoteId, String(remoteProductId)), eq(products.id, String(remoteProductId))))
      .limit(1);
    const [localVariant] = remoteVariantId
      ? await db
          .select({ id: productVariants.id })
          .from(productVariants)
          .where(or(eq(productVariants.remoteId, String(remoteVariantId)), eq(productVariants.id, String(remoteVariantId))))
          .limit(1)
      : [];
    const [localStore] = await db
      .select({ id: stores.id })
      .from(stores)
      .where(
        or(
          eq(stores.id, String(remoteStoreId)),
          eq(stores.remoteId, String(remoteStoreId)),
        ),
      )
      .limit(1);
    const [existing] = await db
      .select({ id: inventoryMovements.id })
      .from(inventoryMovements)
      .where(or(eq(inventoryMovements.remoteId, remoteId), eq(inventoryMovements.id, remoteId)))
      .limit(1);

    const values = {
      remoteId,
      tenantId: movement.tenantId ?? movement.tenant_id ?? defaultTenantId,
      storeId: localStore?.id ?? String(remoteStoreId),
      productId: localProduct?.id ?? String(remoteProductId),
      variantId: localVariant?.id ?? (remoteVariantId ? String(remoteVariantId) : null),
      quantity: Math.abs(Number(movement.quantity ?? movement.quantityDelta ?? movement.quantity_delta ?? 0)),
      type: localMovementType(movement.type ?? movement.direction),
      referenceId: String(movement.referenceId ?? movement.reference_id ?? remoteId),
      referenceType: String(movement.referenceType ?? movement.reference_type ?? "INVENTORY_MOVEMENT"),
      reason: movement.reason ?? null,
      syncStatus: "synced",
      syncError: null,
      createdAt: movement.createdAt ?? movement.created_at ?? now,
      updatedAt: movement.updatedAt ?? movement.updated_at ?? now,
      lastSyncedAt: now,
    };

    if (existing) {
      await db.update(inventoryMovements).set(values).where(eq(inventoryMovements.id, existing.id));
    } else {
      await db.insert(inventoryMovements).values({ id: remoteId, ...values });
    }
  }
}

export async function upsertCategories(
  remoteCategories: Category[],
  defaultTenantId: string,
) {
  if (!remoteCategories.length) return;
  const now = new Date().toISOString();
  const db = getOfflineDb();

  for (const category of remoteCategories) {
    const tenantId = category.tenantId || defaultTenantId;
    const name = category.name || "Unnamed Category";

    // Check if a row already exists by remoteId or by the same (tenantId, name) pair
    const [existing] = await db
      .select({ id: categories.id })
      .from(categories)
      .where(
        or(
          eq(categories.id, category.id),
          category.remoteId
            ? eq(categories.remoteId, category.remoteId)
            : undefined,
          and(eq(categories.tenantId, tenantId), eq(categories.name, name)),
        ),
      )
      .limit(1);

    if (existing) {
      // Update the existing row
      await db
        .update(categories)
        .set({
          remoteId: category.remoteId ?? category.id,
          name,
          slug: category.slug,
          description: category.description,
          parentId: category.parentId,
          isActive: category.isActive ?? true,
          sortOrder: category.sortOrder ?? 0,
          syncStatus: "synced",
          syncError: null,
          updatedAt: category.updatedAt ?? now,
          lastSyncedAt: now,
        })
        .where(eq(categories.id, existing.id));
    } else {
      // Insert new row
      await db.insert(categories).values({
        id: category.id,
        remoteId: category.remoteId ?? category.id,
        tenantId,
        name,
        slug: category.slug,
        description: category.description,
        parentId: category.parentId,
        isActive: category.isActive ?? true,
        sortOrder: category.sortOrder ?? 0,
        syncStatus: "synced",
        syncError: null,
        createdAt: category.createdAt ?? now,
        updatedAt: category.updatedAt ?? now,
        lastSyncedAt: now,
      });
    }
  }
}

export async function upsertCustomers(
  remoteCustomers: Customer[],
  defaultTenantId: string,
) {
  if (!remoteCustomers.length) return;
  const now = new Date().toISOString();

  const customersToInsert = remoteCustomers.map((customer) => ({
    id: customer.id,
    remoteId: customer.remoteId ?? customer.id,
    tenantId: customer.tenantId || defaultTenantId,
    code: customer.code || `CUS-${Date.now()}`,
    name: customer.name || "Unnamed Customer",
    phone: customer.phone,
    email: customer.email,
    address: customer.address,
    dateOfBirth: customer.dateOfBirth,
    gender: customer.gender,
    debtAmount: customer.debtAmount ?? 0,
    loyaltyPoints: customer.loyaltyPoints ?? 0,
    totalSpent: customer.totalSpent ?? 0,
    totalOrders: customer.totalOrders ?? 0,
    tier: customer.tier ?? "BRONZE",
    tierValidUntil: customer.tierValidUntil,
    isActive: customer.isActive ?? true,
    syncStatus: "synced",
    syncError: null,
    createdAt: customer.createdAt ?? now,
    updatedAt: customer.updatedAt ?? now,
    lastSyncedAt: now,
  }));

  await getOfflineDb()
    .insert(customers)
    .values(customersToInsert)
    .onConflictDoUpdate({
      target: customers.id,
      set: {
        remoteId: sql`excluded.remote_id`,
        code: sql`excluded.code`,
        name: sql`excluded.name`,
        phone: sql`excluded.phone`,
        email: sql`excluded.email`,
        address: sql`excluded.address`,
        dateOfBirth: sql`excluded.date_of_birth`,
        gender: sql`excluded.gender`,
        debtAmount: sql`excluded.debt_amount`,
        loyaltyPoints: sql`excluded.loyalty_points`,
        totalSpent: sql`excluded.total_spent`,
        totalOrders: sql`excluded.total_orders`,
        tier: sql`excluded.tier`,
        tierValidUntil: sql`excluded.tier_valid_until`,
        isActive: sql`excluded.is_active`,
        syncStatus: "synced",
        syncError: null,
        updatedAt: sql`excluded.updated_at`,
        lastSyncedAt: now,
      },
    });
}

export async function upsertStaff(remoteStaff: any[], defaultTenantId: string) {
  if (!remoteStaff.length) return;
  const now = new Date().toISOString();

  const seen = new Set<string>();
  const uniqueStaff = remoteStaff.filter((s) => {
    const key = `${s.tenantId || defaultTenantId}:${(s.username || "").toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  const staffToInsert = uniqueStaff.map((s) => ({
    id: s.id,
    remoteId: s.remoteId ?? s.id,
    tenantId: s.tenantId || defaultTenantId,
    storeId: s.storeId,
    username: s.username,
    email: s.email?.trim() || null,
    name: s.name,
    role: s.role,
    permissions: s.permissions || [],
    isActive: s.isActive ?? true,
    syncStatus: "synced",
    syncError: null,
    createdAt: s.createdAt ?? now,
    updatedAt: s.updatedAt ?? now,
    lastSyncedAt: now,
  }));

  await getOfflineDb()
    .insert(staff)
    .values(staffToInsert)
    .onConflictDoUpdate({
      target: [staff.tenantId, staff.username],
      set: {
        remoteId: sql`excluded.remote_id`,
        username: sql`excluded.username`,
        email: sql`excluded.email`,
        name: sql`excluded.name`,
        role: sql`excluded.role`,
        permissions: sql`excluded.permissions`,
        storeId: sql`excluded.store_id`,
        isActive: sql`excluded.is_active`,
        syncStatus: "synced",
        syncError: null,
        updatedAt: sql`excluded.updated_at`,
        lastSyncedAt: now,
      },
    });
}

export async function upsertSuppliers(
  remoteSuppliers: any[],
  defaultTenantId: string,
) {
  if (!remoteSuppliers.length) return;
  const now = new Date().toISOString();

  const seenRemoteIds = new Set<string>();
  const db = getOfflineDb();
  for (const supplier of remoteSuppliers) {
    const remoteId = String(supplier.remoteId ?? supplier.remote_id ?? supplier.id ?? "");
    if (!remoteId || seenRemoteIds.has(remoteId)) continue;
    seenRemoteIds.add(remoteId);

    const tenantId = supplier.tenantId ?? supplier.tenant_id ?? defaultTenantId;
    const email = supplier.email?.trim() || null;
    const code = String(supplier.code ?? "").trim() || `SUP-${remoteId.slice(-8)}`;
    const [byRemoteId] = await db
      .select({ id: suppliers.id })
      .from(suppliers)
      .where(eq(suppliers.remoteId, remoteId))
      .limit(1);
    const [byEmail] = !byRemoteId && email
      ? await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.email, email)))
          .limit(1)
      : [];
    const [byCode] = !byRemoteId && !byEmail
      ? await db
          .select({ id: suppliers.id })
          .from(suppliers)
          .where(and(eq(suppliers.tenantId, tenantId), eq(suppliers.code, code)))
          .limit(1)
      : [];
    // Prefer the stable tenant identity before remoteId so an older local
    // row is reused instead of creating a second supplier row.
    const existing = byEmail ?? byCode ?? byRemoteId;
    const values = {
      remoteId,
      tenantId,
      storeId: supplier.storeId ?? supplier.store_id ?? null,
      code,
      name: supplier.name || "Unnamed Supplier",
      contactName: supplier.contactName ?? supplier.contact_name ?? null,
      phone: supplier.phone ?? null,
      email,
      address: supplier.address ?? null,
      taxNumber: supplier.taxNumber ?? supplier.tax_number ?? null,
      paymentTerms: supplier.paymentTerms ?? supplier.payment_terms ?? null,
      creditLimit: supplier.creditLimit ?? supplier.credit_limit ?? null,
      currentBalance: Number(supplier.currentBalance ?? supplier.current_balance ?? 0),
      isActive: supplier.isActive ?? supplier.is_active ?? true,
      syncStatus: "synced",
      syncError: null,
      updatedAt: supplier.updatedAt ?? supplier.updated_at ?? now,
      lastSyncedAt: now,
    };
    if (existing) {
      await db.update(suppliers).set(values).where(eq(suppliers.id, existing.id));
      await db
        .update(syncOutbox)
        .set({ status: "synced", lastError: null, updatedAt: now })
        .where(
          and(
            eq(syncOutbox.entity, "suppliers"),
            eq(syncOutbox.entityId, existing.id),
            eq(syncOutbox.operation, "create"),
          ),
        );
    } else {
      await db.insert(suppliers).values({
        id: String(supplier.id ?? remoteId),
        createdAt: supplier.createdAt ?? supplier.created_at ?? now,
        ...values,
      });
    }
  }
}

export async function upsertStores(
  remoteStores: Store[],
  defaultTenantId: string,
) {
  if (!remoteStores.length) return;
  const now = new Date().toISOString();

  const storesToInsert = remoteStores.map((store) => ({
    id: store.id,
    remoteId: store.remoteId ?? store.id,
    tenantId: store.tenantId || defaultTenantId,
    code: store.code || `STORE-${Date.now()}`,
    name: store.name || "Unnamed Store",
    address: store.address,
    phone: store.phone,
    email: store.email,
    taxNumber: store.taxNumber,
    isActive: store.isActive ?? true,
    syncStatus: "synced",
    syncError: null,
    createdAt: store.createdAt ?? now,
    updatedAt: store.updatedAt ?? now,
    lastSyncedAt: now,
  }));

  await getOfflineDb()
    .insert(stores)
    .values(storesToInsert)
    .onConflictDoUpdate({
      target: stores.id,
      set: {
        remoteId: sql`excluded.remote_id`,
        code: sql`excluded.code`,
        name: sql`excluded.name`,
        address: sql`excluded.address`,
        phone: sql`excluded.phone`,
        email: sql`excluded.email`,
        taxNumber: sql`excluded.tax_number`,
        isActive: sql`excluded.is_active`,
        syncStatus: "synced",
        syncError: null,
        updatedAt: sql`excluded.updated_at`,
        lastSyncedAt: now,
      },
    });
}

export async function upsertSessions(
  remoteSessions: Session[],
  defaultTenantId: string,
) {
  if (!remoteSessions.length) return;
  const now = new Date().toISOString();

  const db = getOfflineDb();
  for (const session of remoteSessions) {
    const remoteId = String(session.remoteId ?? session.id);
    const [existing] = await db
      .select({ id: sessions.id })
      .from(sessions)
      .where(
        or(eq(sessions.remoteId, remoteId), eq(sessions.id, String(session.id))),
      )
      .limit(1);
    const localId = existing?.id ?? String(session.id);

    await db
      .insert(sessions)
      .values({
        id: localId,
        remoteId,
        tenantId: session.tenantId || defaultTenantId,
        storeId: session.storeId,
        registerId: session.registerId,
        userId: session.userId,
        status: session.status || "OPEN",
        openedAt: session.openedAt || now,
        closedAt: session.closedAt,
        openingBalance: session.openingBalance ?? 0,
        closingBalance: session.closingBalance,
        expectedBalance: session.expectedBalance,
        discrepancy: session.discrepancy,
        cashSales: session.cashSales ?? 0,
        cardSales: session.cardSales ?? 0,
        digitalSales: session.digitalSales ?? 0,
        notes: session.notes,
        syncStatus: "synced",
        syncError: null,
        createdAt: session.openedAt ?? now,
        updatedAt: session.closedAt ?? session.openedAt ?? now,
        lastSyncedAt: now,
      })
      .onConflictDoUpdate({
        target: sessions.id,
        set: {
          remoteId,
          status: sql`excluded.status`,
          closedAt: sql`excluded.closed_at`,
          closingBalance: sql`excluded.closing_balance`,
          expectedBalance: sql`excluded.expected_balance`,
          discrepancy: sql`excluded.discrepancy`,
          cashSales: sql`excluded.cash_sales`,
          cardSales: sql`excluded.card_sales`,
          digitalSales: sql`excluded.digital_sales`,
          notes: sql`excluded.notes`,
          syncStatus: "synced",
          syncError: null,
          updatedAt: sql`excluded.updated_at`,
          lastSyncedAt: now,
        },
      });
  }
}

export async function upsertOrders(
  remoteOrders: (Order & Record<string, any>)[],
  defaultTenantId: string,
) {
  if (!remoteOrders.length) return;
  const now = new Date().toISOString();

  const db = getOfflineDb();
  await db.transaction(async (tx) => {
    for (const order of remoteOrders) {
      const tenantId = order.tenantId || defaultTenantId;
      const remoteId = String(order.remoteId ?? order.id);
      const orderNumber = order.orderNumber || `ORD-${order.id}`;
      // A server-created order may have a different primary key from the
      // local offline row. Reuse the local row when either stable identifier
      // matches, otherwise pull would create a second local order.
      const [existing] = await tx
        .select({ id: orders.id })
        .from(orders)
        .where(
          or(
            eq(orders.remoteId, remoteId),
            and(
              eq(orders.tenantId, tenantId),
              eq(orders.orderNumber, orderNumber),
            ),
          ),
        )
        .limit(1);
      const localId = existing?.id ?? order.id;
      const remoteSessionId = order.sessionId ? String(order.sessionId) : null;
      const [localSession] = remoteSessionId
        ? await tx
            .select({ id: sessions.id })
            .from(sessions)
            .where(
              or(
                eq(sessions.id, remoteSessionId),
                eq(sessions.remoteId, remoteSessionId),
              ),
            )
            .limit(1)
        : [];

      await tx
        .insert(orders)
        .values({
          id: localId,
          remoteId,
          tenantId,
          storeId: order.storeId,
          registerId: order.registerId,
          userId: order.userId ?? "",
          customerId: order.customerId,
          sessionId: localSession?.id ?? order.sessionId,
          orderNumber,
          status: order.status ?? "COMPLETED",
          paymentStatus: order.paymentStatus ?? "PAID",
          paymentMethod: order.paymentMethod ?? "CASH",
          subTotal: Number(order.subTotal ?? order.grandTotal ?? 0),
          taxAmount: Number(order.taxAmount ?? 0),
          discountAmount: Number(order.discountAmount ?? 0),
          grandTotal: Number(order.grandTotal ?? 0),
          paidAmount: Number(order.paidAmount ?? 0),
          changeAmount: Number(order.changeAmount ?? 0),
          paymentBreakdown: order.paymentBreakdown ?? null,
          syncStatus: "synced",
          syncError: null,
          createdAt: order.createdAt ?? now,
          updatedAt: order.updatedAt ?? now,
          lastSyncedAt: now,
        })
        .onConflictDoUpdate({
          target: orders.id,
          set: {
            remoteId: sql`excluded.remote_id`,
            orderNumber: sql`excluded.order_number`,
            storeId: sql`excluded.store_id`,
            registerId: sql`excluded.register_id`,
            userId: sql`excluded.user_id`,
            customerId: sql`excluded.customer_id`,
            sessionId: sql`excluded.session_id`,
            status: sql`excluded.status`,
            paymentStatus: sql`excluded.payment_status`,
            paymentMethod: sql`excluded.payment_method`,
            grandTotal: sql`excluded.grand_total`,
            subTotal: sql`excluded.sub_total`,
            taxAmount: sql`excluded.tax_amount`,
            discountAmount: sql`excluded.discount_amount`,
            paidAmount: sql`excluded.paid_amount`,
            changeAmount: sql`excluded.change_amount`,
            paymentBreakdown: sql`excluded.payment_breakdown`,
            syncStatus: "synced",
            syncError: null,
            updatedAt: sql`excluded.updated_at`,
            lastSyncedAt: now,
          },
        });

      if (Array.isArray(order.items)) {
        // The server response contains the complete authoritative item list.
        // Replace the local list before inserting it; otherwise an offline
        // item plus its server-created copy remains duplicated because the
        // local schema has no remoteId column for order items.
        await tx.delete(orderItems).where(eq(orderItems.orderId, localId));
        const seenItemKeys = new Set<string>();
        for (const item of order.items as (OrderItem & Record<string, any>)[]) {
          const remoteProductId = String(
            item.productId ?? item.product_id ?? item.product?.id ?? "",
          );
          const [localProduct] = await tx
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(
              or(
                eq(products.id, remoteProductId),
                eq(products.remoteId, remoteProductId),
              ),
            )
            .limit(1);
          const remoteVariantId = item.variantId ?? item.variant_id ?? item.variant?.id;
          const itemKey = [
            remoteProductId,
            remoteVariantId ?? "",
            Number(item.quantity ?? 0),
            Number(item.unitPrice ?? item.price ?? 0),
            Number(item.discountAmount ?? 0),
          ].join(":");
          if (seenItemKeys.has(itemKey)) continue;
          seenItemKeys.add(itemKey);
          const [localVariant] = remoteVariantId
            ? await tx
                .select({ id: productVariants.id, name: productVariants.name })
                .from(productVariants)
                .where(
                  or(
                    eq(productVariants.id, String(remoteVariantId)),
                    eq(productVariants.remoteId, String(remoteVariantId)),
                  ),
                )
                .limit(1)
            : [];
          await tx
            .insert(orderItems)
            .values({
              id: item.id ?? createLocalId("item"),
              orderId: localId,
              productId: localProduct?.id ?? remoteProductId,
              variantId: localVariant?.id ?? null,
              productName:
                item.productName ??
                (localProduct?.name
                  ? localVariant?.name
                    ? `${localProduct.name} — ${localVariant.name}`
                    : localProduct.name
                  : item.product?.name
                    ? item.variant?.name
                      ? `${item.product.name} — ${item.variant.name}`
                      : item.product.name
                    : item.variant?.name ?? null),
              quantity: item.quantity,
              unitPrice: Number(item.unitPrice ?? item.price ?? 0),
              discountAmount: Number(item.discountAmount ?? 0),
              subTotal: Number(
                item.subTotal ??
                  item.quantity * Number(item.unitPrice ?? item.price ?? 0),
              ),
              createdAt: item.createdAt ?? now,
            })
            .onConflictDoUpdate({
              target: orderItems.id,
              set: {
                quantity: sql`excluded.quantity`,
                unitPrice: sql`excluded.unit_price`,
                subTotal: sql`excluded.sub_total`,
              },
            });
        }
      }
    }
  });
}

export async function upsertPriceHistory(
  remotePriceHistory: any[],
  defaultTenantId: string,
) {
  if (!remotePriceHistory.length) return;
  const now = new Date().toISOString();

  const priceHistoryToInsert = remotePriceHistory.map((ph) => ({
    id: ph.id,
    remoteId: ph.remoteId,
    tenantId: ph.tenantId || defaultTenantId,
    productId: ph.productId,
    variantId: ph.variantId,
    oldPrice: Number(ph.oldPrice ?? 0),
    newPrice: Number(ph.newPrice ?? 0),
    changedBy: ph.changedBy,
    reason: ph.reason,
    syncStatus: "synced",
    syncError: null,
    createdAt: ph.createdAt ?? now,
    updatedAt: ph.updatedAt ?? now,
    lastSyncedAt: now,
  }));

  await getOfflineDb()
    .insert(priceHistory)
    .values(priceHistoryToInsert)
    .onConflictDoUpdate({
      target: priceHistory.id,
      set: {
        oldPrice: sql`excluded.old_price`,
        newPrice: sql`excluded.new_price`,
        changedBy: sql`excluded.changed_by`,
        reason: sql`excluded.reason`,
        syncStatus: "synced",
        syncError: null,
        updatedAt: sql`excluded.updated_at`,
        lastSyncedAt: now,
      },
    });
}

export async function upsertGenericRecords<T extends { id: string }>(
  entity: string,
  records: T[],
  defaultTenantId: string,
) {
  if (!records.length) return;
  const now = new Date().toISOString();
  await getOfflineDb()
    .insert(genericRecords)
    .values(
      records.map((record) => ({
        id: record.id,
        remoteId: (record as any).remoteId,
        entity,
        data: record,
        tenantId: (record as any).tenantId || defaultTenantId,
        isActive: (record as any).isActive ?? true,
        syncStatus: "synced",
        syncError: null,
        createdAt: (record as any).createdAt ?? now,
        updatedAt: (record as any).updatedAt ?? now,
        lastSyncedAt: now,
      })),
    )
    .onConflictDoUpdate({
      target: genericRecords.id,
      set: {
        data: sql`excluded.data`,
        isActive: sql`excluded.is_active`,
        syncStatus: "synced",
        syncError: null,
        updatedAt: sql`excluded.updated_at`,
        lastSyncedAt: now,
      },
    });
}

// ============================================
// GET LOCAL FUNCTIONS
// ============================================

export async function getLocalProducts(storeId?: string) {
  const db = getOfflineDb();
  const rows = await db
    .select()
    .from(products)
    .where(
      and(
        eq(products.isActive, true),
        storeId
          ? or(eq(products.storeId, storeId), sql`${products.storeId} IS NULL`)
          : undefined,
      ),
    );

  return rows.map((row) => toProduct(row));
}

export async function getLocalProductById(id: string) {
  const db = getOfflineDb();
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return row ? toProduct(row) : undefined;
}

export async function getLocalProductByBarcode(barcode: string) {
  const db = getOfflineDb();
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.barcode, barcode), eq(products.isActive, true)))
    .limit(1);
  return row ? toProduct(row) : undefined;
}

export async function getLocalProductBySku(sku: string) {
  const db = getOfflineDb();
  const [row] = await db
    .select()
    .from(products)
    .where(and(eq(products.sku, sku), eq(products.isActive, true)))
    .limit(1);
  return row ? toProduct(row) : undefined;
}

export async function getLocalVariants(productId?: string) {
  const db = getOfflineDb();
  let query = db.select().from(productVariants).$dynamic();

  if (productId) {
    query = query.where(eq(productVariants.productId, productId));
  }

  const rows = await query.where(eq(productVariants.isActive, true));
  return rows.map((row) => toProductVariant(row));
}

export async function getLocalVariantById(id: string) {
  const db = getOfflineDb();
  const [row] = await db
    .select()
    .from(productVariants)
    .where(eq(productVariants.id, id))
    .limit(1);
  return row ? toProductVariant(row) : undefined;
}

export async function getLocalVariantByBarcode(barcode: string) {
  const db = getOfflineDb();
  const [row] = await db
    .select()
    .from(productVariants)
    .where(
      and(
        eq(productVariants.barcode, barcode),
        eq(productVariants.isActive, true),
      ),
    )
    .limit(1);
  return row ? toProductVariant(row) : undefined;
}

export async function getLocalInventory(storeId?: string) {
  const db = getOfflineDb();
  let query = db.select().from(inventory).$dynamic();

  const conditions = [];
  if (storeId) {
    conditions.push(eq(inventory.storeId, storeId));
  }
  if (conditions.length) {
    query = query.where(and(...conditions));
  }

  const rows = await query;
  return rows.map((row) => toInventoryItem(row));
}

export async function getLocalInventoryByProduct(
  productId: string,
  storeId?: string,
) {
  const db = getOfflineDb();
  let query = db
    .select()
    .from(inventory)
    .where(eq(inventory.productId, productId))
    .$dynamic();

  if (storeId) {
    query = query.where(eq(inventory.storeId, storeId));
  }

  const rows = await query;
  return rows.map((row) => toInventoryItem(row));
}

export async function getLocalInventoryByVariant(
  variantId: string,
  storeId?: string,
) {
  const db = getOfflineDb();
  let query = db
    .select()
    .from(inventory)
    .where(eq(inventory.variantId, variantId))
    .$dynamic();

  if (storeId) {
    query = query.where(eq(inventory.storeId, storeId));
  }

  const rows = await query;
  return rows.map((row) => toInventoryItem(row));
}

export async function getLocalInventoryItem(id: string) {
  const db = getOfflineDb();
  const [row] = await db
    .select()
    .from(inventory)
    .where(eq(inventory.id, id))
    .limit(1);
  return row ? toInventoryItem(row) : undefined;
}

export async function getLocalCategories(_storeId?: string | null) {
  const rows = await getOfflineDb()
    .select()
    .from(categories)
    .where(eq(categories.isActive, true));

  return rows.map((row) => toCategory(row));
}

export async function getLocalCategoryById(id: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  return row ? toCategory(row) : undefined;
}

export async function getLocalCategoryByName(name: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(categories)
    .where(and(eq(categories.name, name), eq(categories.isActive, true)))
    .limit(1);
  return row ? toCategory(row) : undefined;
}

export async function getLocalCustomers() {
  const rows = await getOfflineDb()
    .select()
    .from(customers)
    .where(eq(customers.isActive, true));

  return rows.map((row) => toCustomer(row));
}

export async function getLocalCustomerById(id: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return row ? toCustomer(row) : undefined;
}

export async function getLocalCustomerByPhone(phone: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(customers)
    .where(and(eq(customers.phone, phone), eq(customers.isActive, true)))
    .limit(1);
  return row ? toCustomer(row) : undefined;
}

export async function getLocalCustomerByCode(code: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(customers)
    .where(and(eq(customers.code, code), eq(customers.isActive, true)))
    .limit(1);
  return row ? toCustomer(row) : undefined;
}

export async function getLocalStores() {
  const rows = await getOfflineDb()
    .select()
    .from(stores)
    .where(eq(stores.isActive, true));
  return rows.map((row) => toStore(row));
}

export async function getLocalStoreById(id: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(stores)
    .where(eq(stores.id, id))
    .limit(1);
  return row ? toStore(row) : undefined;
}

export async function getLocalStoreByCode(code: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(stores)
    .where(and(eq(stores.code, code), eq(stores.isActive, true)))
    .limit(1);
  return row ? toStore(row) : undefined;
}

export async function getLocalSessions(storeId?: string, status?: string) {
  const db = getOfflineDb();
  let query = db.select().from(sessions).$dynamic();

  const conditions = [];
  if (storeId) conditions.push(eq(sessions.storeId, storeId));
  if (status) conditions.push(eq(sessions.status, status));
  if (conditions.length) {
    query = query.where(and(...conditions));
  }

  const rows = await query.orderBy(desc(sessions.createdAt));
  return rows.map((row) => toSession(row));
}

export async function getLocalActiveSession(userId: string, storeId?: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(sessions)
    .where(
      and(
        eq(sessions.userId, userId),
        eq(sessions.status, "OPEN"),
        storeId
          ? or(eq(sessions.storeId, storeId), sql`${sessions.storeId} IS NULL`)
          : undefined,
      ),
    )
    .limit(1);

  return row ? toSession(row) : undefined;
}

export async function getLocalSessionById(id: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(sessions)
    .where(eq(sessions.id, id))
    .limit(1);
  return row ? toSession(row) : undefined;
}

export async function getLocalOrders(storeId?: string) {
  const rows = await getOfflineDb()
    .select()
    .from(orders)
    .where(storeId ? eq(orders.storeId, storeId) : undefined);

  return Promise.all(rows.map((order) => toOrder(order)));
}

export async function getLocalOrderById(id: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(orders)
    .where(eq(orders.id, id))
    .limit(1);

  return row ? toOrder(row) : undefined;
}

export async function getLocalOrdersByCustomer(customerId: string) {
  const rows = await getOfflineDb()
    .select()
    .from(orders)
    .where(eq(orders.customerId, customerId));

  return Promise.all(rows.map((order) => toOrder(order)));
}

export async function getLocalOrdersBySession(sessionId: string) {
  const rows = await getOfflineDb()
    .select()
    .from(orders)
    .where(eq(orders.sessionId, sessionId));

  return Promise.all(rows.map((order) => toOrder(order)));
}

export async function getLocalInventoryMovements(
  storeId?: string,
  type?: string,
  productId?: string,
) {
  const db = getOfflineDb();
  let query = db.select().from(inventoryMovements).$dynamic();

  const conditions = [];
  if (storeId) conditions.push(eq(inventoryMovements.storeId, storeId));
  if (type) conditions.push(eq(inventoryMovements.type, type));
  if (productId) conditions.push(eq(inventoryMovements.productId, productId));
  if (conditions.length) {
    query = query.where(and(...conditions));
  }

  return await query.orderBy(desc(inventoryMovements.createdAt));
}

export async function getLocalInventoryMovementById(id: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.id, id))
    .limit(1);
  return row;
}

export async function getLocalPriceHistory(
  productId?: string,
  variantId?: string,
) {
  const db = getOfflineDb();
  let query = db.select().from(priceHistory).$dynamic();

  const conditions = [];
  if (productId) conditions.push(eq(priceHistory.productId, productId));
  if (variantId) conditions.push(eq(priceHistory.variantId, variantId));
  if (conditions.length) {
    query = query.where(and(...conditions));
  }

  return await query.orderBy(desc(priceHistory.createdAt));
}

export async function getLocalGenericRecords<T>(entity: string) {
  const rows = await getOfflineDb()
    .select()
    .from(genericRecords)
    .where(
      and(eq(genericRecords.entity, entity), eq(genericRecords.isActive, true)),
    );

  return rows.map((row) => ({
    ...(row.data as T),
    id: row.id,
  }));
}

export async function getLocalGenericRecord<T>(entity: string, id: string) {
  const [row] = await getOfflineDb()
    .select()
    .from(genericRecords)
    .where(
      and(
        eq(genericRecords.entity, entity),
        eq(genericRecords.id, id),
        eq(genericRecords.isActive, true),
      ),
    )
    .limit(1);

  return row ? { ...(row.data as T), id: row.id } : undefined;
}

// ============================================
// CREATE OFFLINE FUNCTIONS
// ============================================

export async function createOfflineProduct(
  payload: Partial<Product> & {
    categoryName?: string;
    storeId?: string;
    brandId?: string;
    variants?: any[];
    initialStock?: number;
  },
) {
  const now = new Date().toISOString();
  const id = createLocalId("prod");

  const db = getOfflineDb();
  const sqlite = getSqliteDatabase();

  let productId = id;

  sqlite.withTransactionSync(() => {
    sqlite.runSync(
      `INSERT INTO products (
        id, tenant_id, name, sku, barcode, description,
        brand_id, store_id, category_id, supplier_id,
        cost_price, selling_price, wholesale_price,
        is_active, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        productId,
        payload.tenantId || null,
        payload.name || "Offline product",
        payload.sku || `LOCAL-${Date.now().toString(36).toUpperCase()}`,
        payload.barcode || null,
        payload.description || null,
        payload.brandId || null,
        payload.storeId || null,
        payload.categoryId || null,
        payload.supplierId || null,
        Number(payload.costPrice ?? 0),
        Number(payload.sellingPrice ?? 0),
        Number(payload.wholesalePrice ?? 0),
        1,
        "pending",
        now,
        now,
      ],
    );

    if (payload.variants && payload.variants.length > 0) {
      for (const variant of payload.variants) {
        const variantId = createLocalId("var");
        sqlite.runSync(
          `INSERT INTO product_variants (
            id, product_id, tenant_id, name, sku, barcode,
            price, cost_price, color, size, weight, is_active,
            sync_status, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            variantId,
            productId,
            payload.tenantId || null,
            variant.name || "Variant",
            variant.sku || `VAR-${Date.now().toString(36).toUpperCase()}`,
            variant.barcode || null,
            Number(variant.price ?? 0),
            Number(variant.costPrice ?? 0),
            variant.color || null,
            variant.size || null,
            variant.weight ? Number(variant.weight) : null,
            variant.isActive !== undefined ? (variant.isActive ? 1 : 0) : 1,
            "pending",
            now,
            now,
          ],
        );

        if (payload.storeId) {
          const invId = createLocalId("inv");
          sqlite.runSync(
            `INSERT INTO inventory (
              id, tenant_id, store_id, product_id, variant_id, quantity,
              sync_status, created_at, updated_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              invId,
              payload.tenantId || null,
              payload.storeId,
              productId,
              variantId,
              Number(variant.initialStock ?? 0),
              "pending",
              now,
              now,
            ],
          );
        }
      }
    }

    if (
      payload.storeId &&
      (!payload.variants || payload.variants.length === 0)
    ) {
      const invId = createLocalId("inv");
      sqlite.runSync(
        `INSERT INTO inventory (
          id, tenant_id, store_id, product_id, quantity,
          sync_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          invId,
          payload.tenantId || null,
          payload.storeId,
          productId,
          Number(payload.initialStock ?? 0),
          "pending",
          now,
          now,
        ],
      );
    }

    sqlite.runSync(
      `INSERT INTO sync_outbox (
        id, entity, entity_id, operation, endpoint, method, payload, status,
        attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createLocalId("outbox"),
        "products",
        productId,
        "create",
        "/api/tenant/products",
        "POST",
        JSON.stringify(payload),
        "pending",
        0,
        now,
        now,
        now,
      ],
    );
  });

  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, productId))
    .limit(1);

  return toProduct(row);
}

export async function createOfflineCategory(
  payload: CreateCategoryPayload & { storeId?: string },
) {
  const now = new Date().toISOString();
  const id = createLocalId("cat");

  await getOfflineDb()
    .insert(categories)
    .values({
      id: id,
      remoteId: null,
      tenantId: payload.tenantId,
      name: payload.name || "Unnamed Category",
      slug:
        (payload.slug ?? payload.name?.toLowerCase().replace(/\s+/g, "-")) ||
        "cat-" + Date.now(),
      description: payload.description,
      parentId: payload.parentId,
      isActive: payload.isActive ?? true,
      sortOrder: payload.sortOrder ?? 0,
      syncStatus: "pending",
      syncError: null,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
    });

  await enqueueMutation(
    "categories",
    id,
    "create",
    "/api/tenant/categories",
    "POST",
    payload,
  );
  return toCategory(
    (
      await getOfflineDb()
        .select()
        .from(categories)
        .where(eq(categories.id, id))
        .limit(1)
    )[0],
  );
}

export async function createOfflineCustomer(payload: CreateCustomerPayload) {
  const now = new Date().toISOString();
  const id = createLocalId("cus");
  const code = payload.code ?? `LOCAL-${Date.now().toString(36).toUpperCase()}`;

  await getOfflineDb()
    .insert(customers)
    .values({
      id: id,
      remoteId: null,
      tenantId: payload.tenantId,
      code,
      name: payload.name || "Unnamed Customer",
      phone: payload.phone,
      email: payload.email,
      address: payload.address,
      dateOfBirth: payload.dateOfBirth,
      gender: payload.gender,
      debtAmount: payload.debtAmount ?? 0,
      loyaltyPoints: 0,
      totalSpent: 0,
      totalOrders: 0,
      tier: "BRONZE",
      tierValidUntil: null,
      isActive: true,
      syncStatus: "pending",
      syncError: null,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
    });

  await enqueueMutation(
    "customers",
    id,
    "create",
    "/api/tenant/customers",
    "POST",
    payload,
  );
  return toCustomer(
    (
      await getOfflineDb()
        .select()
        .from(customers)
        .where(eq(customers.id, id))
        .limit(1)
    )[0],
  );
}

export async function createOfflineStore(payload: CreateStorePayload) {
  const now = new Date().toISOString();
  const id = createLocalId("store");
  const code = payload.code ?? `LOCAL-${Date.now().toString(36).toUpperCase()}`;

  await getOfflineDb()
    .insert(stores)
    .values({
      id: id,
      remoteId: null,
      tenantId: payload.tenantId,
      code,
      name: payload.name || "Unnamed Store",
      address: payload.address,
      phone: payload.phone,
      email: payload.email,
      taxNumber: payload.taxNumber,
      isActive: payload.isActive ?? true,
      syncStatus: "pending",
      syncError: null,
      createdAt: now,
      updatedAt: now,
      lastSyncedAt: null,
    });

  await enqueueMutation("stores", id, "create", "/api/tenant/stores", "POST", {
    ...payload,
    code,
  });
  return toStore(
    (
      await getOfflineDb()
        .select()
        .from(stores)
        .where(eq(stores.id, id))
        .limit(1)
    )[0],
  );
}

export async function openOfflineSession(payload: {
  userId: string;
  tenantId: string;
  openingBalance: number;
  notes?: string;
  storeId?: string;
  registerId?: string;
}) {
  const now = new Date().toISOString();
  const id = createLocalId("ses");

  await getOfflineDb().insert(sessions).values({
    id: id,
    remoteId: null,
    tenantId: payload.tenantId,
    userId: payload.userId,
    storeId: payload.storeId,
    registerId: payload.registerId,
    status: "OPEN",
    openedAt: now,
    closedAt: null,
    openingBalance: payload.openingBalance,
    closingBalance: null,
    expectedBalance: null,
    discrepancy: null,
    cashSales: 0,
    cardSales: 0,
    digitalSales: 0,
    notes: payload.notes,
    syncStatus: "pending",
    syncError: null,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
  });

  await enqueueMutation(
    "sessions",
    id,
    "open",
    "/api/tenant/sessions/open",
    "POST",
    payload,
  );
  return toSession(
    (
      await getOfflineDb()
        .select()
        .from(sessions)
        .where(eq(sessions.id, id))
        .limit(1)
    )[0],
  );
}

export async function createOfflineOrder(
  payload: CreateOrderPayload,
): Promise<Order> {
  const db = getOfflineDb();
  const sqlite = getSqliteDatabase();
  const now = new Date().toISOString();
  const orderId = createLocalId("ord");
  // Persist these values in the outbox payload so retries identify the same
  // order instead of creating a second server order after a timeout.
  const clientOrderId = payload.clientOrderId ?? orderId;
  const orderNumber = payload.orderNumber ?? `ORD-${orderId}`;

  const { syncItems, ...orderPayload } = payload as CreateOrderPayload & {
    syncItems?: any[];
  };
  const cleanPayload = {
    ...orderPayload,
    clientOrderId,
    orderNumber,
    subTotal: Number(payload.subTotal) || 0,
    taxAmount: Number(payload.taxAmount) || 0,
    discountAmount: Number(payload.discountAmount) || 0,
    grandTotal: Number(payload.grandTotal) || 0,
    paidAmount: Number(payload.paidAmount) || 0,
    changeAmount: Number(payload.changeAmount) || 0,
    items: payload.items.map((item: any) => ({
      ...item,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      subTotal: Number(item.subTotal) || 0,
      discountAmount: Number(item.discountAmount) || 0,
    })),
  };
  const remotePayload = {
    ...cleanPayload,
    items: (syncItems ?? cleanPayload.items).map((item: any) => ({
      ...item,
      quantity: Number(item.quantity) || 0,
      unitPrice: Number(item.unitPrice) || 0,
      subTotal: Number(item.subTotal) || 0,
      discountAmount: Number(item.discountAmount) || 0,
    })),
  };

  sqlite.withTransactionSync(() => {
    sqlite.runSync(
      `INSERT INTO orders (
        id, tenant_id, store_id, register_id, user_id, customer_id, session_id, order_number,
        status, payment_status, payment_method, sub_total, tax_amount, 
        discount_amount, grand_total, paid_amount, change_amount, 
        payment_breakdown, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        orderId,
        payload.tenantId || null,
        cleanPayload.storeId ?? null,
        cleanPayload.registerId ?? null,
        cleanPayload.userId,
        cleanPayload.customerId ?? null,
        cleanPayload.sessionId ?? null,
        orderNumber,
        "PENDING",
        cleanPayload.paymentStatus ?? "PAID",
        cleanPayload.paymentMethod,
        cleanPayload.subTotal,
        cleanPayload.taxAmount ?? 0,
        cleanPayload.discountAmount ?? 0,
        cleanPayload.grandTotal,
        cleanPayload.paidAmount,
        cleanPayload.changeAmount,
        JSON.stringify(cleanPayload.paymentBreakdown ?? []),
        "pending",
        now,
        now,
      ],
    );

    for (const item of cleanPayload.items) {
      sqlite.runSync(
        `INSERT INTO order_items (
          id, order_id, product_id, variant_id, product_name, quantity, unit_price,
          discount_amount, sub_total, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createLocalId("item"),
          orderId,
          item.productId,
          item.variantId ?? null,
          item.productName ?? item.name ?? item.variantName ?? null,
          item.quantity,
          item.unitPrice,
          item.discountAmount ?? 0,
          item.subTotal,
          now,
        ],
      );

      const variantCondition = item.variantId
        ? `AND (variant_id = '${item.variantId}' OR (variant_id IS NULL AND NOT EXISTS (
             SELECT 1 FROM inventory AS variant_inventory
             WHERE variant_inventory.product_id = ?
               AND variant_inventory.store_id = ?
               AND variant_inventory.variant_id = '${item.variantId}'
           )))`
        : `AND variant_id IS NULL`;

      sqlite.runSync(
        `UPDATE inventory SET quantity = MAX(quantity - ?, 0), updated_at = ? 
         WHERE product_id = ? AND store_id = ? ${variantCondition}`,
        item.variantId
          ? [
              item.quantity,
              now,
              item.productId,
              cleanPayload.storeId,
              item.productId,
              cleanPayload.storeId,
            ]
          : [item.quantity, now, item.productId, cleanPayload.storeId],
      );
    }

    sqlite.runSync(
      `INSERT INTO sync_outbox (
        id, entity, entity_id, operation, endpoint, method, payload, status,
        attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createLocalId("outbox"),
        "orders",
        orderId,
        "create",
        "/api/tenant/orders",
        "POST",
        JSON.stringify(remotePayload),
        "pending",
        0,
        now,
        now,
        now,
      ],
    );
  });

  const [created] = await db
    .select()
    .from(orders)
    .where(eq(orders.id, orderId))
    .limit(1);
  const items = await db
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, orderId));

  return {
    id: created.id,
    tenantId: created.tenantId,
    grandTotal: created.grandTotal,
    status: created.status as Order["status"],
    createdAt: created.createdAt,
    updatedAt: created.updatedAt,
    subTotal: created.subTotal,
    taxAmount: created.taxAmount,
    discountAmount: created.discountAmount,
    paidAmount: created.paidAmount,
    changeAmount: created.changeAmount,
    paymentMethod: created.paymentMethod as Order["paymentMethod"],
    paymentStatus: created.paymentStatus as Order["paymentStatus"],
    paymentBreakdown: parsePaymentBreakdown(
      created.paymentBreakdown ?? cleanPayload.paymentBreakdown,
    ),
    customerId: created.customerId ?? undefined,
    storeId: created.storeId ?? undefined,
    userId: created.userId,
    items: items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId,
      variantId: item.variantId ?? undefined,
      productName: item.productName ?? "",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      subTotal: item.subTotal,
      createdAt: item.createdAt,
      product: {
        id: item.productId,
        sku: "",
        name: item.productName ?? "",
        sellingPrice: String(item.unitPrice),
        costPrice: 0,
        isTaxable: true,
        isActive: true,
        isReturnable: true,
        createdAt: item.createdAt,
      } as any,
    })),
  };
}

export async function createOfflineInventoryMovement(
  payload: CreateMovementPayload,
) {
  const now = new Date().toISOString();
  const id = createLocalId("mov");
  const sqlite = getSqliteDatabase();
  const db = getOfflineDb();

  sqlite.withTransactionSync(() => {
    sqlite.runSync(
      `INSERT INTO inventory_movements (
        id, tenant_id, store_id, product_id, variant_id, quantity, type,
        reference_id, reference_type, reason, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        payload.tenantId || null,
        payload.storeId,
        payload.productId,
        payload.variantId ?? null,
        payload.quantity,
        payload.type,
        payload.referenceId,
        payload.referenceType,
        payload.reason ?? null,
        "pending",
        now,
        now,
      ],
    );

    const multiplier = ["IN", "TRANSFER_IN"].includes(payload.type) ? 1 : -1;
    const newQuantity =
      multiplier > 0
        ? `quantity + ${payload.quantity}`
        : `MAX(quantity - ${payload.quantity}, 0)`;

    const variantCondition = payload.variantId
      ? `AND (variant_id = '${payload.variantId}' OR (variant_id IS NULL AND NOT EXISTS (
           SELECT 1 FROM inventory AS variant_inventory
           WHERE variant_inventory.product_id = ?
             AND variant_inventory.store_id = ?
             AND variant_inventory.variant_id = '${payload.variantId}'
         )))`
      : `AND variant_id IS NULL`;

    const updateResult = sqlite.runSync(
      `UPDATE inventory SET quantity = ${newQuantity}, updated_at = ? 
       WHERE product_id = ? AND store_id = ? ${variantCondition}`,
      payload.variantId
        ? [
            now,
            payload.productId,
            payload.storeId,
            payload.productId,
            payload.storeId,
          ]
        : [now, payload.productId, payload.storeId],
    );

    // Destination stores often have no inventory row yet. Mirror server
    // adjustInventory by creating the row when the update matched nothing.
    if ((updateResult?.changes ?? 0) === 0) {
      const initialQuantity = multiplier > 0 ? payload.quantity : 0;
      sqlite.runSync(
        `INSERT INTO inventory (
          id, tenant_id, store_id, product_id, variant_id, quantity,
          sync_status, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createLocalId("inv"),
          payload.tenantId || null,
          payload.storeId,
          payload.productId,
          payload.variantId ?? null,
          initialQuantity,
          "pending",
          now,
          now,
        ],
      );
    }

    // ✅ Map type to server enum
    const mappedType = mapMovementType(payload.type, payload.referenceType);

    // Strip null/undefined values and build clean payload
    const cleanPayload: any = {
      clientMovementId: id,
      storeId: payload.storeId,
      productId: payload.productId,
      quantity: payload.quantity,
      direction: String(payload.type).toUpperCase(),
      type: mappedType,
      referenceId: payload.referenceId,
      referenceType: payload.referenceType,
      reason: payload.reason || null,
    };

    if (payload.variantId && payload.variantId.trim() !== "") {
      cleanPayload.variantId = payload.variantId;
    }

    sqlite.runSync(
      `INSERT INTO sync_outbox (
        id, entity, entity_id, operation, endpoint, method, payload, status,
        attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createLocalId("outbox"),
        "inventory_movements",
        id,
        "create",
        "/api/tenant/inventory/movements",
        "POST",
        JSON.stringify(cleanPayload),
        "pending",
        0,
        now,
        now,
        now,
      ],
    );
  });

  const [row] = await db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.id, id))
    .limit(1);
  return row;
}

export async function createOfflineInventoryCount(payload: CreateCountPayload) {
  const now = new Date().toISOString();
  const countId = createLocalId("cnt");
  const sqlite = getSqliteDatabase();

  sqlite.withTransactionSync(() => {
    sqlite.runSync(
      `INSERT INTO inventory_counts (
        id, tenant_id, store_id, status, scheduled_date, sync_status, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        countId,
        payload.tenantId || null,
        payload.storeId,
        "COMPLETED",
        payload.scheduledDate ?? null,
        "pending",
        now,
        now,
      ],
    );

    for (const item of payload.items) {
      const diff = item.countedQuantity - item.systemQuantity;
      sqlite.runSync(
        `INSERT INTO inventory_count_items (
          id, count_id, product_id, variant_id, system_quantity, counted_quantity, difference, reason, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          createLocalId("cnti"),
          countId,
          item.productId,
          item.variantId ?? null,
          item.systemQuantity,
          item.countedQuantity,
          diff,
          item.reason ?? null,
          now,
        ],
      );

      const variantCondition = item.variantId
        ? `AND variant_id = '${item.variantId}'`
        : `AND variant_id IS NULL`;

      sqlite.runSync(
        `UPDATE inventory SET quantity = ?, updated_at = ? 
         WHERE product_id = ? AND store_id = ? ${variantCondition}`,
        [item.countedQuantity, now, item.productId, payload.storeId],
      );
    }

    sqlite.runSync(
      `INSERT INTO sync_outbox (
        id, entity, entity_id, operation, endpoint, method, payload, status,
        attempts, next_attempt_at, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        createLocalId("outbox"),
        "inventory_counts",
        countId,
        "create",
        "/api/tenant/inventory/counts",
        "POST",
        JSON.stringify(payload),
        "pending",
        0,
        now,
        now,
        now,
      ],
    );
  });

  return { id: countId, status: "COMPLETED" };
}

export async function createOfflineGenericRecord<T extends Record<string, any>>(
  entity: string,
  endpoint: string,
  payload: T,
) {
  const now = new Date().toISOString();
  const id = createLocalId(entity.slice(0, 4));
  const data = {
    ...payload,
    id,
    code: payload.code ?? `LOCAL-${Date.now().toString(36).toUpperCase()}`,
    isActive: payload.isActive ?? true,
    createdAt: now,
    updatedAt: now,
  };

  await getOfflineDb().insert(genericRecords).values({
    id: id,
    remoteId: null,
    entity,
    data,
    isActive: data.isActive,
    syncStatus: "pending",
    syncError: null,
    createdAt: now,
    updatedAt: now,
    lastSyncedAt: null,
  });

  await enqueueMutation(entity, id, "create", endpoint, "POST", payload);
  return data;
}

// ============================================
// UPDATE OFFLINE FUNCTIONS
// ============================================

export async function updateOfflineProduct(
  id: string,
  data: Partial<Product> & { categoryName?: string; variants?: any[] },
) {
  const now = new Date().toISOString();
  const db = getOfflineDb();

  // Strip the variants array from the product-level update (it's not a product column)
  const { variants: variantsPayload, ...productData } = data as any;

  await db
    .update(products)
    .set({
      ...productData,
      updatedAt: now,
      syncStatus: "pending",
    } as Partial<typeof products.$inferInsert>)
    .where(eq(products.id, id));

  // ── Sync variants locally if provided ──
  if (Array.isArray(variantsPayload) && variantsPayload.length > 0) {
    // Get existing local variants for this product
    const existingVariants = await db
      .select()
      .from(productVariants)
      .where(eq(productVariants.productId, id));

    const existingIds = new Set(existingVariants.map((v) => v.id));
    const keptIds = new Set<string>();

    for (const v of variantsPayload) {
      if (v.id && existingIds.has(v.id)) {
        // Update existing variant
        keptIds.add(v.id);
        await db
          .update(productVariants)
          .set({
            name: v.name,
            sku: v.sku,
            barcode: v.barcode || null,
            price: Number(v.price ?? 0),
            costPrice: Number(v.costPrice ?? 0),
            color: v.color,
            size: v.size,
            isActive: v.isActive ?? true,
            updatedAt: now,
            syncStatus: "pending",
          } as Partial<typeof productVariants.$inferInsert>)
          .where(eq(productVariants.id, v.id));
      } else {
        // Create new variant locally
        const newId = v.id || createLocalId("var");
        keptIds.add(newId);
        await db.insert(productVariants).values({
          id: newId,
          remoteId: v.id || null,
          productId: id,
          tenantId: (productData as any).tenantId ?? "default",
          name: v.name,
          sku: v.sku || `VAR-${newId.slice(-8)}`,
          barcode: v.barcode || null,
          price: Number(v.price ?? 0),
          costPrice: Number(v.costPrice ?? 0),
          color: v.color,
          size: v.size,
          isActive: v.isActive ?? true,
          syncStatus: "pending",
          createdAt: now,
          updatedAt: now,
        } as typeof productVariants.$inferInsert);
      }
    }

    // Deactivate variants that were removed from the list
    for (const existing of existingVariants) {
      if (!keptIds.has(existing.id)) {
        await db
          .update(productVariants)
          .set({ isActive: false, updatedAt: now, syncStatus: "pending" } as Partial<typeof productVariants.$inferInsert>)
          .where(eq(productVariants.id, existing.id));
      }
    }
  }

  await enqueueMutation(
    "products",
    id,
    "update",
    `/api/tenant/products/${id}`,
    "PUT",
    data,
  );
  const [row] = await db
    .select()
    .from(products)
    .where(eq(products.id, id))
    .limit(1);
  return toProduct(row);
}

export async function updateOfflineCategory(
  id: string,
  data: Partial<Category>,
) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(categories)
    .set({
      ...data,
      updatedAt: now,
      syncStatus: "pending",
    } as Partial<typeof categories.$inferInsert>)
    .where(eq(categories.id, id));

  await enqueueMutation(
    "categories",
    id,
    "update",
    `/api/tenant/categories/${id}`,
    "PUT",
    data,
  );
  const [row] = await getOfflineDb()
    .select()
    .from(categories)
    .where(eq(categories.id, id))
    .limit(1);
  return toCategory(row);
}

export async function updateOfflineCustomer(
  id: string,
  data: Partial<Customer>,
) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(customers)
    .set({
      ...data,
      updatedAt: now,
      syncStatus: "pending",
    } as Partial<typeof customers.$inferInsert>)
    .where(eq(customers.id, id));

  await enqueueMutation(
    "customers",
    id,
    "update",
    `/api/tenant/customers/${id}`,
    "PUT",
    data,
  );
  const [row] = await getOfflineDb()
    .select()
    .from(customers)
    .where(eq(customers.id, id))
    .limit(1);
  return toCustomer(row);
}

export async function updateOfflineStore(id: string, data: Partial<Store>) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(stores)
    .set({
      ...data,
      updatedAt: now,
      syncStatus: "pending",
    } as Partial<typeof stores.$inferInsert>)
    .where(eq(stores.id, id));

  await enqueueMutation(
    "stores",
    id,
    "update",
    `/api/tenant/stores/${id}`,
    "PUT",
    data,
  );
  const [row] = await getOfflineDb()
    .select()
    .from(stores)
    .where(eq(stores.id, id))
    .limit(1);
  return toStore(row);
}

export async function updateOfflineOrderStatus(id: string, status: string) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(orders)
    .set({ status, syncStatus: "pending", updatedAt: now })
    .where(eq(orders.id, id));

  await enqueueMutation(
    "orders",
    id,
    "updateStatus",
    `/api/tenant/orders/${id}/status`,
    "PATCH",
    { status },
  );
  const order = await getLocalOrderById(id);
  if (!order) throw new Error("Order not found in offline cache");
  return order;
}

export async function closeOfflineSession(
  sessionId: string,
  payload: CloseSessionPayload,
) {
  const now = new Date().toISOString();

  await getOfflineDb()
    .update(sessions)
    .set({
      status: "CLOSED",
      closedAt: now,
      closingBalance: payload.closingBalance,
      expectedBalance: payload.expectedBalance,
      discrepancy: payload.discrepancy,
      cashSales: payload.cashSales ?? 0,
      cardSales: payload.cardSales ?? 0,
      digitalSales: payload.digitalSales ?? 0,
      notes: payload.notes,
      syncStatus: "pending",
      updatedAt: now,
    })
    .where(eq(sessions.id, sessionId));

  await enqueueMutation(
    "sessions",
    sessionId,
    "close",
    `/api/tenant/sessions/${sessionId}/close`,
    "POST",
    payload,
  );
  const [row] = await getOfflineDb()
    .select()
    .from(sessions)
    .where(eq(sessions.id, sessionId))
    .limit(1);

  return toSession(row);
}

export async function updateOfflineGenericRecord<T extends Record<string, any>>(
  entity: string,
  endpoint: string,
  id: string,
  data: T,
) {
  const now = new Date().toISOString();
  const [row] = await getOfflineDb()
    .select()
    .from(genericRecords)
    .where(eq(genericRecords.id, id))
    .limit(1);
  const nextData = {
    ...((row?.data as Record<string, any>) ?? { id }),
    ...data,
    updatedAt: now,
  };

  await getOfflineDb()
    .update(genericRecords)
    .set({ data: nextData, syncStatus: "pending", updatedAt: now })
    .where(eq(genericRecords.id, id));

  await enqueueMutation(entity, id, "update", endpoint, "PUT", data);
  return nextData;
}

// ============================================
// DELETE OFFLINE FUNCTIONS
// ============================================

export async function deleteOfflineProduct(id: string) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(products)
    .set({
      isActive: false,
      deletedAt: now,
      updatedAt: now,
      syncStatus: "pending",
    })
    .where(eq(products.id, id));

  await enqueueMutation(
    "products",
    id,
    "delete",
    `/api/tenant/products/${id}`,
    "DELETE",
    {},
  );
}

export async function deleteOfflineCategory(id: string) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(categories)
    .set({
      isActive: false,
      updatedAt: now,
      syncStatus: "pending",
    })
    .where(eq(categories.id, id));

  await enqueueMutation(
    "categories",
    id,
    "delete",
    `/api/tenant/categories/${id}`,
    "DELETE",
    {},
  );
}

export async function deleteOfflineCustomer(id: string) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(customers)
    .set({
      isActive: false,
      updatedAt: now,
      syncStatus: "pending",
    })
    .where(eq(customers.id, id));

  await enqueueMutation(
    "customers",
    id,
    "delete",
    `/api/tenant/customers/${id}`,
    "DELETE",
    {},
  );
}

export async function deleteOfflineStore(id: string) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(stores)
    .set({
      isActive: false,
      updatedAt: now,
      syncStatus: "pending",
    })
    .where(eq(stores.id, id));

  await enqueueMutation(
    "stores",
    id,
    "delete",
    `/api/tenant/stores/${id}`,
    "DELETE",
    {},
  );
}

export async function deleteOfflineOrder(id: string) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(orders)
    .set({ status: "VOIDED", syncStatus: "pending", updatedAt: now })
    .where(eq(orders.id, id));

  await enqueueMutation(
    "orders",
    id,
    "delete",
    `/api/tenant/orders/${id}`,
    "DELETE",
    {},
  );
}

export async function deleteOfflineGenericRecord(
  entity: string,
  endpoint: string,
  id: string,
) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(genericRecords)
    .set({ isActive: false, syncStatus: "pending", updatedAt: now })
    .where(eq(genericRecords.id, id));

  await enqueueMutation(entity, id, "delete", endpoint, "DELETE", {});
}

// ============================================
// SYNC OUTBOX FUNCTIONS
// ============================================

async function enqueueMutation(
  entity: string,
  entityId: string,
  operation: string,
  endpoint: string,
  method: string,
  payload: unknown,
) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .insert(syncOutbox)
    .values({
      id: createLocalId("outbox"),
      entity,
      entityId,
      operation,
      endpoint,
      method,
      payload,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    });
}

export async function enqueueMutations(
  items: Array<{
    entity: string;
    entityId: string;
    operation: string;
    endpoint: string;
    method: string;
    payload: unknown;
  }>,
) {
  if (!items.length) return;

  const now = new Date().toISOString();
  const db = getOfflineDb();

  await db.insert(syncOutbox).values(
    items.map((item) => ({
      id: createLocalId("outbox"),
      ...item,
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      createdAt: now,
      updatedAt: now,
    })),
  );
}

export async function getDueOutboxItems(limit = 25) {
  return getOfflineDb()
    .select()
    .from(syncOutbox)
    .where(
      and(
        inArray(syncOutbox.status, ["pending", "failed"]),
        lte(syncOutbox.nextAttemptAt, new Date().toISOString()),
      ),
    )
    .limit(limit);
}

export async function getOutboxItems(limit = 100) {
  return getOfflineDb()
    .select()
    .from(syncOutbox)
    .orderBy(syncOutbox.updatedAt)
    .limit(limit);
}

export async function getFailedOutboxItems(limit = 100) {
  return getOfflineDb()
    .select()
    .from(syncOutbox)
    .where(inArray(syncOutbox.status, ["failed", "dead"]))
    .orderBy(syncOutbox.updatedAt)
    .limit(limit);
}

export async function retryOutboxItem(id: string) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(syncOutbox)
    .set({
      status: "pending",
      nextAttemptAt: now,
      updatedAt: now,
      lastError: null,
    })
    .where(eq(syncOutbox.id, id));
}

export async function retryAllFailedOutboxItems() {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(syncOutbox)
    .set({
      status: "pending",
      nextAttemptAt: now,
      updatedAt: now,
      lastError: null,
    })
    .where(inArray(syncOutbox.status, ["failed", "dead"]));
}

export async function markOutboxSynced(id: string) {
  await getOfflineDb().delete(syncOutbox).where(eq(syncOutbox.id, id));
}

export async function markOutboxFailed(
  id: string,
  attempts: number,
  error: string,
) {
  const MAX_ATTEMPTS = 10;

  if (attempts >= MAX_ATTEMPTS) {
    await getOfflineDb()
      .update(syncOutbox)
      .set({
        status: "dead",
        attempts,
        lastError: `[DEAD after ${MAX_ATTEMPTS} attempts] ${error}`,
        updatedAt: new Date().toISOString(),
      })
      .where(eq(syncOutbox.id, id));
    return;
  }

  const delaySeconds = Math.min(300, Math.pow(2, attempts) * 5);
  const nextAttemptAt = new Date(
    Date.now() + delaySeconds * 1000,
  ).toISOString();

  await getOfflineDb()
    .update(syncOutbox)
    .set({
      status: "failed",
      attempts,
      lastError: error,
      nextAttemptAt,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(syncOutbox.id, id));
}

export async function markOutboxDead(id: string) {
  await getOfflineDb()
    .update(syncOutbox)
    .set({
      status: "dead",
      updatedAt: new Date().toISOString(),
    })
    .where(eq(syncOutbox.id, id));
}

export async function getQueuedCount() {
  const result = await getOfflineDb()
    .select({ count: sql<number>`count(*)` })
    .from(syncOutbox)
    .where(inArray(syncOutbox.status, ["pending", "failed"]));
  return Number(result[0]?.count ?? 0);
}

export async function getFailedCount() {
  const result = await getOfflineDb()
    .select({ count: sql<number>`count(*)` })
    .from(syncOutbox)
    .where(inArray(syncOutbox.status, ["failed", "dead"]));
  return Number(result[0]?.count ?? 0);
}

export async function clearSyncedOutboxItems() {
  const db = getOfflineDb();
  const result = await db
    .delete(syncOutbox)
    .where(eq(syncOutbox.status, "synced"))
    .returning();
  return result.length;
}

export async function clearAllOutboxItems() {
  const db = getOfflineDb();
  const result = await db.delete(syncOutbox).returning();
  return result.length;
}

/** Remove failed/dead queue entries while preserving cached business data. */
export async function clearFailedOutboxItems() {
  const result = await getOfflineDb()
    .delete(syncOutbox)
    .where(inArray(syncOutbox.status, ["failed", "dead"]))
    .returning();
  return result.length;
}

/** Discard one invalid queued change without clearing the local cache. */
export async function discardOutboxItem(id: string) {
  const [item] = await getOfflineDb()
    .delete(syncOutbox)
    .where(eq(syncOutbox.id, id))
    .returning();
  return item;
}

// ============================================
// SYNC STATUS FUNCTIONS
// ============================================

export async function getSyncStats() {
  const db = getOfflineDb();

  const [totalPending] = await db
    .select({ count: sql<number>`count(*)` })
    .from(syncOutbox)
    .where(eq(syncOutbox.status, "pending"));

  const [totalFailed] = await db
    .select({ count: sql<number>`count(*)` })
    .from(syncOutbox)
    .where(eq(syncOutbox.status, "failed"));

  const [totalDead] = await db
    .select({ count: sql<number>`count(*)` })
    .from(syncOutbox)
    .where(eq(syncOutbox.status, "dead"));

  const [ordersPending] = await db
    .select({ count: sql<number>`count(*)` })
    .from(orders)
    .where(eq(orders.syncStatus, "pending"));

  const [productsPending] = await db
    .select({ count: sql<number>`count(*)` })
    .from(products)
    .where(eq(products.syncStatus, "pending"));

  const [variantsPending] = await db
    .select({ count: sql<number>`count(*)` })
    .from(productVariants)
    .where(eq(productVariants.syncStatus, "pending"));

  const [inventoryPending] = await db
    .select({ count: sql<number>`count(*)` })
    .from(inventory)
    .where(eq(inventory.syncStatus, "pending"));

  return {
    outbox: {
      pending: Number(totalPending?.count ?? 0),
      failed: Number(totalFailed?.count ?? 0),
      dead: Number(totalDead?.count ?? 0),
    },
    entities: {
      orders: Number(ordersPending?.count ?? 0),
      products: Number(productsPending?.count ?? 0),
      variants: Number(variantsPending?.count ?? 0),
      inventory: Number(inventoryPending?.count ?? 0),
    },
  };
}

// ============================================
// MARK SYNCED FUNCTIONS
// ============================================

export async function markOrderSynced(
  localId: string,
  remote: Order & Record<string, any>,
) {
  const now = new Date().toISOString();
  await getOfflineDb()
    .update(orders)
    .set({
      status: remote.status ?? "COMPLETED",
      syncStatus: "synced",
      syncError: null,
      lastSyncedAt: now,
      updatedAt: now,
    })
    .where(eq(orders.id, localId));
}

export async function markEntitySynced(
  entity: string,
  localId: string,
  remote: Record<string, any>,
) {
  const now = new Date().toISOString();

  if (entity === "products") {
    await getOfflineDb()
      .update(products)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.sku && { sku: remote.sku }),
        ...(remote.name && { name: remote.name }),
        ...(remote.sellingPrice && { sellingPrice: remote.sellingPrice }),
        ...(remote.brandId && { brandId: remote.brandId }),
        ...(remote.storeId && { storeId: remote.storeId }),
      })
      .where(eq(products.id, localId));
  } else if (entity === "product_variants") {
    await getOfflineDb()
      .update(productVariants)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.sku && { sku: remote.sku }),
        ...(remote.name && { name: remote.name }),
        ...(remote.price && { price: remote.price }),
      })
      .where(eq(productVariants.id, localId));
  } else if (entity === "inventory") {
    await getOfflineDb()
      .update(inventory)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.quantity !== undefined && { quantity: remote.quantity }),
      })
      .where(eq(inventory.id, localId));
  } else if (entity === "customers") {
    await getOfflineDb()
      .update(customers)
      .set({
        ...(remote.id || remote.remoteId
          ? { remoteId: remote.id ?? remote.remoteId }
          : {}),
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.code && { code: remote.code }),
        ...(remote.name && { name: remote.name }),
      })
      .where(eq(customers.id, localId));
  } else if (entity === "categories") {
    await getOfflineDb()
      .update(categories)
      .set({
        ...(remote.id || remote.remoteId
          ? { remoteId: remote.id ?? remote.remoteId }
          : {}),
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.name && { name: remote.name }),
        ...(remote.slug && { slug: remote.slug }),
      })
      .where(eq(categories.id, localId));
  } else if (entity === "stores") {
    await getOfflineDb()
      .update(stores)
      .set({
        ...(remote.id || remote.remoteId
          ? { remoteId: remote.id ?? remote.remoteId }
          : {}),
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.code && { code: remote.code }),
        ...(remote.name && { name: remote.name }),
      })
      .where(eq(stores.id, localId));
  } else if (entity === "staff") {
    await getOfflineDb()
      .update(staff)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.id || remote.remoteId
          ? { remoteId: remote.id ?? remote.remoteId }
          : {}),
      })
      .where(eq(staff.id, localId));
  } else if (entity === "suppliers") {
    await getOfflineDb()
      .update(suppliers)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.id || remote.remoteId
          ? { remoteId: remote.id ?? remote.remoteId }
          : {}),
      })
      .where(eq(suppliers.id, localId));
  } else if (entity === "sessions") {
    await getOfflineDb()
      .update(sessions)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
        ...(remote.status && { status: remote.status }),
        ...(remote.closedAt && { closedAt: remote.closedAt }),
      })
      .where(eq(sessions.id, localId));
  } else if (entity === "inventory_movements") {
    await getOfflineDb()
      .update(inventoryMovements)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
      } as any)
      .where(eq(inventoryMovements.id, localId));
  } else if (entity === "inventory_counts") {
    await getOfflineDb()
      .update(inventoryCounts)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
      } as any)
      .where(eq(inventoryCounts.id, localId));
  } else if (entity === "price_history") {
    await getOfflineDb()
      .update(priceHistory)
      .set({
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
      })
      .where(eq(priceHistory.id, localId));
  } else {
    await getOfflineDb()
      .update(genericRecords)
      .set({
        data: remote.id ? remote : sql`${genericRecords.data}`,
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
      })
      .where(eq(genericRecords.id, localId));
  }
}

export async function markOrderSyncFailed(localId: string, error: string) {
  await getOfflineDb()
    .update(orders)
    .set({
      syncStatus: "failed",
      syncError: error,
      updatedAt: new Date().toISOString(),
    })
    .where(eq(orders.id, localId));
}

export async function markEntitySyncFailed(
  entity: string,
  localId: string,
  error: string,
) {
  const update = {
    syncStatus: "failed",
    syncError: error,
    updatedAt: new Date().toISOString(),
  };

  if (entity === "products") {
    await getOfflineDb()
      .update(products)
      .set(update)
      .where(eq(products.id, localId));
  } else if (entity === "product_variants") {
    await getOfflineDb()
      .update(productVariants)
      .set(update)
      .where(eq(productVariants.id, localId));
  } else if (entity === "inventory") {
    await getOfflineDb()
      .update(inventory)
      .set(update)
      .where(eq(inventory.id, localId));
  } else if (entity === "customers") {
    await getOfflineDb()
      .update(customers)
      .set(update)
      .where(eq(customers.id, localId));
  } else if (entity === "categories") {
    await getOfflineDb()
      .update(categories)
      .set(update)
      .where(eq(categories.id, localId));
  } else if (entity === "stores") {
    await getOfflineDb()
      .update(stores)
      .set(update)
      .where(eq(stores.id, localId));
  } else if (entity === "sessions") {
    await getOfflineDb()
      .update(sessions)
      .set(update)
      .where(eq(sessions.id, localId));
  } else if (entity === "inventory_movements") {
    await getOfflineDb()
      .update(inventoryMovements)
      .set(update)
      .where(eq(inventoryMovements.id, localId));
  } else if (entity === "inventory_counts") {
    await getOfflineDb()
      .update(inventoryCounts)
      .set(update)
      .where(eq(inventoryCounts.id, localId));
  } else if (entity === "price_history") {
    await getOfflineDb()
      .update(priceHistory)
      .set(update)
      .where(eq(priceHistory.id, localId));
  } else {
    await getOfflineDb()
      .update(genericRecords)
      .set(update)
      .where(eq(genericRecords.id, localId));
  }
}

// ============================================
// CONFLICT RESOLUTION
// ============================================

export async function resolveConflict(
  entity: string,
  localId: string,
  resolution: "local" | "remote",
  remoteData?: Record<string, any>,
) {
  const db = getOfflineDb();
  const now = new Date().toISOString();

  if (resolution === "remote" && remoteData) {
    const table = getTableForEntity(entity);
    if (!table) return;

    await db
      .update(table)
      .set({
        ...remoteData,
        syncStatus: "synced",
        syncError: null,
        updatedAt: now,
        lastSyncedAt: now,
      } as any)
      .where(eq(table.id, localId));

    await db
      .delete(syncOutbox)
      .where(
        and(eq(syncOutbox.entity, entity), eq(syncOutbox.entityId, localId)),
      );
  } else {
    await db
      .update(syncOutbox)
      .set({
        status: "pending",
        attempts: 0,
        nextAttemptAt: now,
        updatedAt: now,
        lastError: null,
      })
      .where(
        and(eq(syncOutbox.entity, entity), eq(syncOutbox.entityId, localId)),
      );
  }
}

function getTableForEntity(entity: string) {
  switch (entity) {
    case "products":
      return products;
    case "product_variants":
      return productVariants;
    case "inventory":
      return inventory;
    case "categories":
      return categories;
    case "customers":
      return customers;
    case "stores":
      return stores;
    case "sessions":
      return sessions;
    case "orders":
      return orders;
    case "inventory_movements":
      return inventoryMovements;
    case "inventory_counts":
      return inventoryCounts;
    case "price_history":
      return priceHistory;
    default:
      return null;
  }
}

// ============================================
// CLEANUP FUNCTIONS
// ============================================

export async function cleanupOldData(daysToKeep = 30) {
  const db = getOfflineDb();
  const cutoff = new Date(
    Date.now() - daysToKeep * 24 * 60 * 60 * 1000,
  ).toISOString();

  const syncedOutbox = await db
    .delete(syncOutbox)
    .where(
      and(eq(syncOutbox.status, "synced"), lte(syncOutbox.createdAt, cutoff)),
    )
    .returning();

  const deletedGeneric = await db
    .delete(genericRecords)
    .where(
      and(
        eq(genericRecords.isActive, false),
        lte(genericRecords.updatedAt, cutoff),
      ),
    )
    .returning();

  const deletedCounts = await db
    .delete(inventoryCounts)
    .where(
      and(
        eq(inventoryCounts.status, "COMPLETED"),
        lte(inventoryCounts.createdAt, cutoff),
      ),
    )
    .returning();

  return {
    outbox: syncedOutbox.length,
    genericRecords: deletedGeneric.length,
    inventoryCounts: deletedCounts.length,
  };
}

// ============================================
// HELPER FUNCTIONS (conversion)
// ============================================

function parsePaymentBreakdown(value: unknown) {
  if (!value) return [];
  if (Array.isArray(value)) return value as Order["paymentBreakdown"];
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
  return [];
}

// ✅ Fixed toProduct
function toProduct(product: LocalProduct): Product {
  return {
    id: product.id,
    remoteId: product.remoteId ?? undefined,
    sku: product.sku,
    barcode: product.barcode ?? undefined,
    name: product.name,
    description: product.description ?? undefined,
    brand: product.brandId ?? undefined,
    costPrice: product.costPrice,
    sellingPrice: product.sellingPrice,
    wholesalePrice: product.wholesalePrice ?? 0,
    categoryId: product.categoryId ?? "",
    category: product.categoryId
      ? {
          id: product.categoryId,
          tenantId: product.tenantId,
          name: "",
          slug: "",
          isActive: true,
          sortOrder: 0,
          createdAt: product.createdAt,
          updatedAt: product.createdAt,
        }
      : undefined,
    supplierId: product.supplierId ?? undefined,
    tenantId: product.tenantId,
    isTaxable: product.isTaxable,
    isActive: product.isActive,
    isReturnable: product.isReturnable,
    manufacturingDate: product.manufacturingDate ?? undefined,
    expiryDate: product.expiryDate ?? undefined,
    version: product.version ?? 1,
    createdAt: product.createdAt,
    updatedAt: product.updatedAt ?? product.createdAt,
  };
}

function toProductVariant(variant: LocalProductVariant): any {
  return {
    id: variant.id,
    name: variant.name,
    productId: variant.productId,
    tenantId: variant.tenantId,
    sku: variant.sku,
    barcode: variant.barcode ?? undefined,
    price: variant.price,
    costPrice: variant.costPrice,
    color: variant.color ?? undefined,
    size: variant.size ?? undefined,
    weight: variant.weight ?? undefined,
    isActive: variant.isActive,
    createdAt: variant.createdAt,
    updatedAt: variant.updatedAt,
  };
}

function toInventoryItem(inv: LocalInventory): InventoryItem {
  return {
    id: inv.id,
    productId: inv.productId,
    storeId: inv.storeId,
    variantId: inv.variantId ?? undefined,
    quantity: inv.quantity,
    reservedQty: inv.reservedQty,
    reorderPoint: inv.reorderPoint,
    reorderQty: inv.reorderQty,
    shelfLocation: inv.shelfLocation ?? undefined,
    version: inv.version,
    product: {
      id: "",
      name: "",
      sku: "",
    },
  };
}

async function toOrder(order: LocalOrder): Promise<Order> {
  const items = await getOfflineDb()
    .select()
    .from(orderItems)
    .where(eq(orderItems.orderId, order.id));

  return {
    id: order.id,
    tenantId: order.tenantId,
    grandTotal: order.grandTotal,
    status: order.status as Order["status"],
    createdAt: order.createdAt,
    updatedAt: order.updatedAt,
    syncStatus: order.syncStatus,
    subTotal: order.subTotal,
    taxAmount: order.taxAmount,
    discountAmount: order.discountAmount,
    paidAmount: order.paidAmount,
    changeAmount: order.changeAmount,
    paymentMethod: order.paymentMethod as Order["paymentMethod"],
    paymentStatus: order.paymentStatus as Order["paymentStatus"],
    paymentBreakdown: parsePaymentBreakdown(order.paymentBreakdown),
    customerId: order.customerId ?? undefined,
    storeId: order.storeId ?? undefined,
    userId: order.userId,
    items: items.map((item) => ({
      id: item.id,
      orderId: item.orderId,
      productId: item.productId,
      variantId: item.variantId ?? undefined,
      productName: item.productName ?? "",
      quantity: item.quantity,
      unitPrice: item.unitPrice,
      discountAmount: item.discountAmount,
      subTotal: item.subTotal,
      createdAt: item.createdAt,
      product: {
        id: item.productId,
        sku: "",
        name: item.productName ?? "",
        sellingPrice: String(item.unitPrice),
        costPrice: 0,
        isTaxable: true,
        isActive: true,
        isReturnable: true,
        createdAt: item.createdAt,
      } as any,
    })),
  };
}

function toCategory(category: LocalCategory): Category {
  return {
    id: category.id,
    remoteId: category.remoteId ?? null,
    tenantId: category.tenantId,
    storeId: (category as any).storeId ?? null,
    name: category.name,
    slug: category.slug ?? "",
    description: category.description ?? undefined,
    parentId: category.parentId ?? undefined,
    isActive: category.isActive,
    sortOrder: category.sortOrder,
    createdAt: category.createdAt,
    updatedAt: category.updatedAt,
  };
}

function toCustomer(customer: LocalCustomer): Customer {
  return {
    id: customer.id,
    remoteId: customer.remoteId ?? undefined,
    tenantId: customer.tenantId,
    code: customer.code,
    name: customer.name,
    phone: customer.phone ?? undefined,
    email: customer.email ?? undefined,
    address: customer.address ?? undefined,
    dateOfBirth: customer.dateOfBirth ?? undefined,
    gender: customer.gender as "MALE" | "FEMALE" | "OTHER" | undefined,
    debtAmount: customer.debtAmount ?? 0,
    loyaltyPoints: customer.loyaltyPoints,
    totalSpent: customer.totalSpent,
    totalOrders: customer.totalOrders,
    tier: (customer.tier as Customer["tier"]) ?? "BRONZE",
    tierValidUntil: customer.tierValidUntil ?? undefined,
    isActive: customer.isActive,
    createdAt: customer.createdAt,
    updatedAt: customer.updatedAt,
  };
}

function toStore(store: LocalStore): Store {
  return {
    id: store.id,
    remoteId: store.remoteId,
    tenantId: store.tenantId,
    code: store.code,
    name: store.name,
    address: store.address ?? undefined,
    phone: store.phone ?? undefined,
    email: store.email ?? undefined,
    taxNumber: store.taxNumber ?? undefined,
    isActive: store.isActive,
    createdAt: store.createdAt,
    updatedAt: store.updatedAt,
  };
}

function toSession(session: LocalSession): Session {
  return {
    id: session.id,
    remoteId: session.remoteId,
    tenantId: session.tenantId,
    userId: session.userId,
    status: session.status as Session["status"],
    openedAt: session.openedAt,
    closedAt: session.closedAt ?? undefined,
    openingBalance: session.openingBalance,
    closingBalance: session.closingBalance ?? undefined,
    expectedBalance: session.expectedBalance ?? undefined,
    discrepancy: session.discrepancy ?? undefined,
    cashSales: session.cashSales,
    cardSales: session.cardSales,
    digitalSales: session.digitalSales,
    notes: session.notes ?? undefined,
    createdAt: session.createdAt,
    updatedAt: session.updatedAt,
  };
}

// ============================================
// SYNC STATUS INTERFACE AND FUNCTIONS
// ============================================

export interface SyncStatus {
  isOnline: boolean;
  queueCount: number;
  failedCount: number;
  totalPending: number;
  items: Array<{
    id: string;
    entity: string;
    operation: string;
    status: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>;
  failedItems: Array<{
    id: string;
    entity: string;
    operation: string;
    attempts: number;
    lastError: string | null;
    createdAt: string;
  }>;
  entityCounts: {
    [entity: string]: {
      pending: number;
      failed: number;
      synced: number;
      total: number;
    };
  };
}

export async function getSyncStatus(): Promise<SyncStatus> {
  const db = getOfflineDb();
  const online = await isOnline();

  const allItems = await db
    .select()
    .from(syncOutbox)
    .orderBy(syncOutbox.createdAt);

  const pendingItems = allItems.filter(
    (item) => item.status === "pending" || item.status === "failed",
  );

  const failedItems = allItems.filter(
    (item) => item.status === "failed" || item.status === "dead",
  );

  const entityCounts: SyncStatus["entityCounts"] = {};

  for (const item of allItems) {
    if (!entityCounts[item.entity]) {
      entityCounts[item.entity] = {
        pending: 0,
        failed: 0,
        synced: 0,
        total: 0,
      };
    }
    entityCounts[item.entity].total++;

    if (item.status === "pending") {
      entityCounts[item.entity].pending++;
    } else if (item.status === "failed" || item.status === "dead") {
      entityCounts[item.entity].failed++;
    } else if (item.status === "synced") {
      entityCounts[item.entity].synced++;
    }
  }

  return {
    isOnline: online,
    queueCount: pendingItems.length,
    failedCount: failedItems.length,
    totalPending: allItems.filter((item) => item.status === "pending").length,
    items: pendingItems.map((item) => ({
      id: item.id,
      entity: item.entity,
      operation: item.operation,
      status: item.status,
      attempts: item.attempts,
      lastError: item.lastError ?? null,
      createdAt: item.createdAt,
    })),
    failedItems: failedItems.map((item) => ({
      id: item.id,
      entity: item.entity,
      operation: item.operation,
      attempts: item.attempts,
      lastError: item.lastError ?? null,
      createdAt: item.createdAt,
    })),
    entityCounts,
  };
}

export async function getSyncStatusByEntity(entity: string) {
  const db = getOfflineDb();

  const items = await db
    .select()
    .from(syncOutbox)
    .where(eq(syncOutbox.entity, entity));

  const pending = items.filter((item) => item.status === "pending").length;
  const failed = items.filter(
    (item) => item.status === "failed" || item.status === "dead",
  ).length;
  const synced = items.filter((item) => item.status === "synced").length;

  return {
    total: items.length,
    pending,
    failed,
    synced,
    items: items.map((item) => ({
      id: item.id,
      entityId: item.entityId,
      operation: item.operation,
      status: item.status,
      attempts: item.attempts,
      lastError: item.lastError ?? null,
      createdAt: item.createdAt,
      updatedAt: item.updatedAt,
    })),
  };
}

export async function getFailedItemsWithDetails(limit = 50) {
  const db = getOfflineDb();

  const items = await db
    .select()
    .from(syncOutbox)
    .where(inArray(syncOutbox.status, ["failed", "dead"]))
    .orderBy(syncOutbox.updatedAt)
    .limit(limit);

  const result = [];
  for (const item of items) {
    let entityData = null;

    switch (item.entity) {
      case "products": {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, item.entityId))
          .limit(1);
        entityData = product;
        break;
      }
      case "product_variants": {
        const [variant] = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, item.entityId))
          .limit(1);
        entityData = variant;
        break;
      }
      case "inventory": {
        const [inv] = await db
          .select()
          .from(inventory)
          .where(eq(inventory.id, item.entityId))
          .limit(1);
        entityData = inv;
        break;
      }
      case "orders": {
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.id, item.entityId))
          .limit(1);
        entityData = order;
        break;
      }
      case "customers": {
        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, item.entityId))
          .limit(1);
        entityData = customer;
        break;
      }
      case "categories": {
        const [category] = await db
          .select()
          .from(categories)
          .where(eq(categories.id, item.entityId))
          .limit(1);
        entityData = category;
        break;
      }
      case "stores": {
        const [store] = await db
          .select()
          .from(stores)
          .where(eq(stores.id, item.entityId))
          .limit(1);
        entityData = store;
        break;
      }
      case "sessions": {
        const [session] = await db
          .select()
          .from(sessions)
          .where(eq(sessions.id, item.entityId))
          .limit(1);
        entityData = session;
        break;
      }
      case "price_history": {
        const [ph] = await db
          .select()
          .from(priceHistory)
          .where(eq(priceHistory.id, item.entityId))
          .limit(1);
        entityData = ph;
        break;
      }
    }

    result.push({
      ...item,
      entityData,
    });
  }

  return result;
}

export async function getPendingItemsWithDetails(limit = 50) {
  const db = getOfflineDb();

  const items = await db
    .select()
    .from(syncOutbox)
    .where(eq(syncOutbox.status, "pending"))
    .orderBy(syncOutbox.createdAt)
    .limit(limit);

  const result = [];
  for (const item of items) {
    let entityData = null;

    switch (item.entity) {
      case "products": {
        const [product] = await db
          .select()
          .from(products)
          .where(eq(products.id, item.entityId))
          .limit(1);
        entityData = product;
        break;
      }
      case "product_variants": {
        const [variant] = await db
          .select()
          .from(productVariants)
          .where(eq(productVariants.id, item.entityId))
          .limit(1);
        entityData = variant;
        break;
      }
      case "inventory": {
        const [inv] = await db
          .select()
          .from(inventory)
          .where(eq(inventory.id, item.entityId))
          .limit(1);
        entityData = inv;
        break;
      }
      case "orders": {
        const [order] = await db
          .select()
          .from(orders)
          .where(eq(orders.id, item.entityId))
          .limit(1);
        entityData = order;
        break;
      }
      case "customers": {
        const [customer] = await db
          .select()
          .from(customers)
          .where(eq(customers.id, item.entityId))
          .limit(1);
        entityData = customer;
        break;
      }
      case "categories": {
        const [category] = await db
          .select()
          .from(categories)
          .where(eq(categories.id, item.entityId))
          .limit(1);
        entityData = category;
        break;
      }
      case "stores": {
        const [store] = await db
          .select()
          .from(stores)
          .where(eq(stores.id, item.entityId))
          .limit(1);
        entityData = store;
        break;
      }
      case "sessions": {
        const [session] = await db
          .select()
          .from(sessions)
          .where(eq(sessions.id, item.entityId))
          .limit(1);
        entityData = session;
        break;
      }
      case "price_history": {
        const [ph] = await db
          .select()
          .from(priceHistory)
          .where(eq(priceHistory.id, item.entityId))
          .limit(1);
        entityData = ph;
        break;
      }
    }

    result.push({
      ...item,
      entityData,
    });
  }

  return result;
}

export async function getSyncQueueSummary() {
  const db = getOfflineDb();

  const allItems = await db.select().from(syncOutbox);

  const summary = {
    total: allItems.length,
    pending: 0,
    synced: 0,
    failed: 0,
    dead: 0,
    byEntity: {} as Record<
      string,
      {
        total: number;
        pending: number;
        synced: number;
        failed: number;
        dead: number;
      }
    >,
    oldestPending: null as string | null,
    newestPending: null as string | null,
  };

  for (const item of allItems) {
    if (item.status === "pending") summary.pending++;
    else if (item.status === "synced") summary.synced++;
    else if (item.status === "failed") summary.failed++;
    else if (item.status === "dead") summary.dead++;

    if (!summary.byEntity[item.entity]) {
      summary.byEntity[item.entity] = {
        total: 0,
        pending: 0,
        synced: 0,
        failed: 0,
        dead: 0,
      };
    }
    summary.byEntity[item.entity].total++;
    if (item.status === "pending") summary.byEntity[item.entity].pending++;
    else if (item.status === "synced") summary.byEntity[item.entity].synced++;
    else if (item.status === "failed") summary.byEntity[item.entity].failed++;
    else if (item.status === "dead") summary.byEntity[item.entity].dead++;

    if (item.status === "pending") {
      if (!summary.oldestPending || item.createdAt < summary.oldestPending) {
        summary.oldestPending = item.createdAt;
      }
      if (!summary.newestPending || item.createdAt > summary.newestPending) {
        summary.newestPending = item.createdAt;
      }
    }
  }

  return summary;
}

// // ============================================
// // FILE: services/offline/repository.ts
// // ============================================

// import type {
//   Category,
//   CreateCategoryPayload,
// } from "@/services/features/categories/categoryTypes";
// import type {
//   CreateCustomerPayload,
//   Customer,
// } from "@/services/features/customers/customerTypes";
// import type {
//   CreateCountPayload,
//   CreateMovementPayload,
//   InventoryItem,
// } from "@/services/features/inventory/inventoryTypes";
// import type {
//   CreateOrderPayload,
//   Order,
//   OrderItem,
// } from "@/services/features/order/orderTypes";
// import type { Product } from "@/services/features/products/productTypes";
// import type {
//   CloseSessionPayload,
//   Session,
// } from "@/services/features/sessions/sessionTypes";
// import type {
//   CreateStorePayload,
//   Store,
// } from "@/services/features/stores/storeTypes";
// import { and, desc, eq, inArray, lte, or, sql } from "drizzle-orm";
// import { getOfflineDb, getSqliteDatabase } from "./db";
// import { createLocalId } from "./ids";
// import { isOnline } from "./network";
// import {
//   brands,
//   categories,
//   customers,
//   genericRecords,
//   inventory,
//   inventoryCounts,
//   inventoryMovements,
//   orderItems,
//   orders,
//   priceHistory,
//   productVariants,
//   products,
//   sessions,
//   staff,
//   stores,
//   suppliers,
//   syncOutbox,
//   type LocalBrand,
//   type LocalCategory,
//   type LocalCustomer,
//   type LocalInventory,
//   type LocalOrder,
//   type LocalProduct,
//   type LocalProductVariant,
//   type LocalSession,
//   type LocalStore,
// } from "./schema";

// // ============================================
// // NORMALIZATION FUNCTIONS

// // ============================================

// // Add this near the top of repository.ts
// async function withForeignKeysOff<T>(
//   db: ReturnType<typeof getOfflineDb>,
//   callback: () => Promise<T>,
// ): Promise<T> {
//   await db.run(sql`PRAGMA foreign_keys = OFF`);
//   try {
//     return await callback();
//   } finally {
//     await db.run(sql`PRAGMA foreign_keys = ON`);
//   }
// }

// export function normalizeProduct(
//   product: Product & Record<string, any>,
// ): typeof products.$inferInsert {
//   return {
//     id: product.id,
//     remoteId: product.remoteId || null,
//     tenantId: product.tenantId,
//     name: product.name || "Unnamed Product",
//     description: product.description,
//     // 🔥 Convert empty strings to null for foreign keys
//     brandId:
//       product.brandId && product.brandId.trim() !== "" ? product.brandId : null,
//     storeId:
//       product.storeId && product.storeId.trim() !== "" ? product.storeId : null,
//     categoryId:
//       product.categoryId && product.categoryId.trim() !== ""
//         ? product.categoryId
//         : null,
//     supplierId:
//       product.supplierId && product.supplierId.trim() !== ""
//         ? product.supplierId
//         : null,
//     sku: product.sku || `SKU-${product.id?.slice(-8) || Date.now()}`,
//     barcode: product.barcode,
//     costPrice: Number(product.costPrice ?? 0),
//     sellingPrice: Number(product.sellingPrice ?? 0),
//     wholesalePrice: Number(product.wholesalePrice ?? 0),
//     promoPrice: product.promoPrice ? Number(product.promoPrice) : null,
//     promoStartAt: product.promoStartAt,
//     promoEndAt: product.promoEndAt,
//     isTaxable: product.isTaxable ?? true,
//     isActive: product.isActive ?? true,
//     isReturnable: product.isReturnable ?? true,
//     expiryDate: product.expiryDate,
//     manufacturingDate: product.manufacturingDate,
//     bestBeforeDate: product.bestBeforeDate,
//     deletedAt: product.deletedAt,
//     version: Number(product.version ?? 0),
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: product.createdAt ?? new Date().toISOString(),
//     updatedAt: product.updatedAt ?? new Date().toISOString(),
//     lastSyncedAt: new Date().toISOString(),
//   };
// }
// // export function normalizeProduct(
// //   product: Product & Record<string, any>,
// // ): typeof products.$inferInsert {
// //   return {
// //     id: product.id,
// //     remoteId: product.remoteId || null,
// //     tenantId: product.tenantId,
// //     name: product.name || "Unnamed Product",
// //     description: product.description,
// //     brandId: product.brandId ?? null,
// //     storeId: product.storeId ?? null,
// //     sku: product.sku || `SKU-${product.id?.slice(-8) || Date.now()}`,
// //     barcode: product.barcode,
// //     costPrice: Number(product.costPrice ?? 0),
// //     sellingPrice: Number(product.sellingPrice ?? 0),
// //     wholesalePrice: Number(product.wholesalePrice ?? 0),
// //     promoPrice: product.promoPrice ? Number(product.promoPrice) : null,
// //     promoStartAt: product.promoStartAt,
// //     promoEndAt: product.promoEndAt,
// //     isTaxable: product.isTaxable ?? true,
// //     isActive: product.isActive ?? true,
// //     isReturnable: product.isReturnable ?? true,
// //     expiryDate: product.expiryDate,
// //     manufacturingDate: product.manufacturingDate,
// //     bestBeforeDate: product.bestBeforeDate,
// //     // 🔥 FALLBACK for categoryId (required in schema)
// //     categoryId: product.categoryId || null,
// //     supplierId: product.supplierId || null,
// //     deletedAt: product.deletedAt,
// //     version: Number(product.version ?? 0),
// //     syncStatus: "synced",
// //     syncError: null,
// //     createdAt: product.createdAt ?? new Date().toISOString(),
// //     updatedAt: product.updatedAt ?? new Date().toISOString(),
// //     lastSyncedAt: new Date().toISOString(),
// //   };
// // }

// export function normalizeProductVariant(
//   variant: any,
// ): typeof productVariants.$inferInsert {
//   return {
//     id: variant.id,
//     remoteId: variant.remoteId,
//     name: variant.name || "Unnamed Variant",
//     productId: variant.productId,
//     tenantId: variant.tenantId,
//     sku: variant.sku || `VAR-${Date.now()}`,
//     barcode: variant.barcode,
//     price: Number(variant.price ?? 0),
//     costPrice: Number(variant.costPrice ?? 0),
//     color: variant.color,
//     size: variant.size,
//     weight: variant.weight ? Number(variant.weight) : null,
//     isActive: variant.isActive ?? true,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: variant.createdAt ?? new Date().toISOString(),
//     updatedAt: variant.updatedAt ?? new Date().toISOString(),
//     lastSyncedAt: new Date().toISOString(),
//   };
// }

// export function normalizeInventory(inv: any): typeof inventory.$inferInsert {
//   return {
//     id: inv.id,
//     remoteId: inv.remoteId,
//     tenantId: inv.tenantId,
//     storeId: inv.storeId,
//     productId:
//       inv.productId && inv.productId.trim() !== "" ? inv.productId : null,
//     variantId:
//       inv.variantId && inv.variantId.trim() !== "" ? inv.variantId : null,

//     // productId: inv.productId,
//     // variantId: inv.variantId,
//     quantity: Number(inv.quantity ?? 0),
//     reservedQty: Number(inv.reservedQty ?? 0),
//     reorderPoint: Number(inv.reorderPoint ?? 10),
//     reorderQty: Number(inv.reorderQty ?? 0),
//     shelfLocation: inv.shelfLocation,
//     version: Number(inv.version ?? 0),
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: inv.createdAt ?? new Date().toISOString(),
//     updatedAt: inv.updatedAt ?? new Date().toISOString(),
//     lastSyncedAt: new Date().toISOString(),
//   };
// }

// // ============================================
// // UPSERT FUNCTIONS (Pull from Server)
// // ============================================

// export async function upsertBrands(
//   remoteBrands: any[],
//   defaultTenantId: string,
// ) {
//   if (!remoteBrands.length) return;
//   const now = new Date().toISOString();

//   const brandsToInsert = remoteBrands.map((brand) => ({
//     id: brand.id,
//     remoteId: brand.remoteId,
//     tenantId: brand.tenantId || defaultTenantId,
//     name: brand.name,
//     description: brand.description,
//     isActive: brand.isActive ?? true,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: brand.createdAt ?? now,
//     updatedAt: brand.updatedAt ?? now,
//     lastSyncedAt: now,
//   }));

//   await getOfflineDb()
//     .insert(brands)
//     .values(brandsToInsert)
//     .onConflictDoUpdate({
//       target: brands.id,
//       set: {
//         name: sql`excluded.name`,
//         description: sql`excluded.description`,
//         isActive: sql`excluded.is_active`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// export async function upsertProducts(
//   remoteProducts: Product[],
//   defaultTenantId: string,
// ) {
//   if (!remoteProducts.length) return;
//   const db = getOfflineDb();

//   const productsToInsert = remoteProducts.map((product) => {
//     const normalized = normalizeProduct(product);
//     if (!normalized.tenantId) normalized.tenantId = defaultTenantId;
//     return normalized;
//   });

//   await withForeignKeysOff(db, async () => {
//     await db
//       .insert(products)
//       .values(productsToInsert)
//       .onConflictDoUpdate({
//         target: products.id,
//         set: {
//           sku: sql`excluded.sku`,
//           barcode: sql`excluded.barcode`,
//           name: sql`excluded.name`,
//           description: sql`excluded.description`,
//           brandId: sql`excluded.brand_id`,
//           storeId: sql`excluded.store_id`,
//           costPrice: sql`excluded.cost_price`,
//           sellingPrice: sql`excluded.selling_price`,
//           wholesalePrice: sql`excluded.wholesale_price`,
//           promoPrice: sql`excluded.promo_price`,
//           promoStartAt: sql`excluded.promo_start_at`,
//           promoEndAt: sql`excluded.promo_end_at`,
//           isTaxable: sql`excluded.is_taxable`,
//           isActive: sql`excluded.is_active`,
//           isReturnable: sql`excluded.is_returnable`,
//           expiryDate: sql`excluded.expiry_date`,
//           manufacturingDate: sql`excluded.manufacturing_date`,
//           bestBeforeDate: sql`excluded.best_before_date`,
//           categoryId: sql`excluded.category_id`,
//           supplierId: sql`excluded.supplier_id`,
//           deletedAt: sql`excluded.deleted_at`,
//           version: sql`excluded.version`,
//           syncStatus: "synced",
//           syncError: null,
//           updatedAt: sql`excluded.updated_at`,
//           lastSyncedAt: sql`excluded.last_synced_at`,
//         },
//       });
//   });
// }

// // export async function upsertProducts(
// //   remoteProducts: Product[],
// //   defaultTenantId: string,
// // ) {
// //   if (!remoteProducts.length) return;

// //   const db = getOfflineDb();

// //   const productsToInsert = remoteProducts.map((product) => {
// //     const normalized = normalizeProduct(product);
// //     if (!normalized.tenantId) {
// //       normalized.tenantId = defaultTenantId;
// //     }
// //     return normalized;
// //   });

// //   await db
// //     .insert(products)
// //     .values(productsToInsert)
// //     .onConflictDoUpdate({
// //       target: products.id,
// //       set: {
// //         sku: sql`excluded.sku`,
// //         barcode: sql`excluded.barcode`,
// //         name: sql`excluded.name`,
// //         description: sql`excluded.description`,
// //         brandId: sql`excluded.brand_id`,
// //         storeId: sql`excluded.store_id`,
// //         costPrice: sql`excluded.cost_price`,
// //         sellingPrice: sql`excluded.selling_price`,
// //         wholesalePrice: sql`excluded.wholesale_price`,
// //         promoPrice: sql`excluded.promo_price`,
// //         promoStartAt: sql`excluded.promo_start_at`,
// //         promoEndAt: sql`excluded.promo_end_at`,
// //         isTaxable: sql`excluded.is_taxable`,
// //         isActive: sql`excluded.is_active`,
// //         isReturnable: sql`excluded.is_returnable`,
// //         expiryDate: sql`excluded.expiry_date`,
// //         manufacturingDate: sql`excluded.manufacturing_date`,
// //         bestBeforeDate: sql`excluded.best_before_date`,
// //         categoryId: sql`excluded.category_id`,
// //         supplierId: sql`excluded.supplier_id`,
// //         deletedAt: sql`excluded.deleted_at`,
// //         version: sql`excluded.version`,
// //         syncStatus: "synced",
// //         syncError: null,
// //         updatedAt: sql`excluded.updated_at`,
// //         lastSyncedAt: sql`excluded.last_synced_at`,
// //       },
// //     });
// // }

// // export async function upsertProducts(
// //   remoteProducts: Product[],
// //   defaultTenantId: string,
// // ) {
// //   if (!remoteProducts.length) return;

// //   const db = getOfflineDb();

// //   // ✅ Disable foreign key constraints temporarily
// //   await db.run(sql`PRAGMA foreign_keys = OFF`);

// //   try {
// //     const productsToInsert = remoteProducts.map((product) => {
// //       const normalized = normalizeProduct(product);
// //       if (!normalized.tenantId) {
// //         normalized.tenantId = defaultTenantId;
// //       }
// //       return normalized;
// //     });

// //     await db
// //       .insert(products)
// //       .values(productsToInsert)
// //       .onConflictDoUpdate({
// //         target: products.id,
// //         set: {
// //           sku: sql`excluded.sku`,
// //           barcode: sql`excluded.barcode`,
// //           name: sql`excluded.name`,
// //           description: sql`excluded.description`,
// //           brandId: sql`excluded.brand_id`,
// //           storeId: sql`excluded.store_id`,
// //           costPrice: sql`excluded.cost_price`,
// //           sellingPrice: sql`excluded.selling_price`,
// //           wholesalePrice: sql`excluded.wholesale_price`,
// //           promoPrice: sql`excluded.promo_price`,
// //           promoStartAt: sql`excluded.promo_start_at`,
// //           promoEndAt: sql`excluded.promo_end_at`,
// //           isTaxable: sql`excluded.is_taxable`,
// //           isActive: sql`excluded.is_active`,
// //           isReturnable: sql`excluded.is_returnable`,
// //           expiryDate: sql`excluded.expiry_date`,
// //           manufacturingDate: sql`excluded.manufacturing_date`,
// //           bestBeforeDate: sql`excluded.best_before_date`,
// //           categoryId: sql`excluded.category_id`,
// //           supplierId: sql`excluded.supplier_id`,
// //           deletedAt: sql`excluded.deleted_at`,
// //           version: sql`excluded.version`,
// //           syncStatus: "synced",
// //           syncError: null,
// //           updatedAt: sql`excluded.updated_at`,
// //           lastSyncedAt: sql`excluded.last_synced_at`,
// //         },
// //       });
// //   } finally {
// //     // ✅ Re-enable foreign key constraints
// //     await db.run(sql`PRAGMA foreign_keys = ON`);
// //   }
// // }
// // export async function upsertProductVariants(
// //   remoteVariants: any[],
// //   defaultTenantId: string,
// // ) {
// //   if (!remoteVariants.length) return;

// //   const db = getOfflineDb();
// //   const variantsToInsert = remoteVariants.map((variant) => {
// //     const normalized = normalizeProductVariant(variant);
// //     if (!normalized.tenantId) {
// //       normalized.tenantId = defaultTenantId;
// //     }
// //     return normalized;
// //   });

// //   await db
// //     .insert(productVariants)
// //     .values(variantsToInsert)
// //     .onConflictDoUpdate({
// //       target: productVariants.id,
// //       set: {
// //         sku: sql`excluded.sku`,
// //         barcode: sql`excluded.barcode`,
// //         name: sql`excluded.name`,
// //         price: sql`excluded.price`,
// //         costPrice: sql`excluded.cost_price`,
// //         color: sql`excluded.color`,
// //         size: sql`excluded.size`,
// //         weight: sql`excluded.weight`,
// //         isActive: sql`excluded.is_active`,
// //         syncStatus: "synced",
// //         syncError: null,
// //         updatedAt: sql`excluded.updated_at`,
// //         lastSyncedAt: sql`excluded.last_synced_at`,
// //       },
// //     });
// // }

// export async function upsertProductVariants(
//   remoteVariants: any[],
//   defaultTenantId: string,
// ) {
//   if (!remoteVariants.length) return;
//   const db = getOfflineDb();

//   const variantsToInsert = remoteVariants.map((variant) => {
//     const normalized = normalizeProductVariant(variant);
//     if (!normalized.tenantId) normalized.tenantId = defaultTenantId;
//     return normalized;
//   });

//   await withForeignKeysOff(db, async () => {
//     await db
//       .insert(productVariants)
//       .values(variantsToInsert)
//       .onConflictDoUpdate({
//         target: productVariants.id,
//         set: {
//           sku: sql`excluded.sku`,
//           barcode: sql`excluded.barcode`,
//           name: sql`excluded.name`,
//           price: sql`excluded.price`,
//           costPrice: sql`excluded.cost_price`,
//           color: sql`excluded.color`,
//           size: sql`excluded.size`,
//           weight: sql`excluded.weight`,
//           isActive: sql`excluded.is_active`,
//           syncStatus: "synced",
//           syncError: null,
//           updatedAt: sql`excluded.updated_at`,
//           lastSyncedAt: sql`excluded.last_synced_at`,
//         },
//       });
//   });
// }
// // // export async function upsertInventory(
// // //   remoteInventory: any[],
// // //   defaultTenantId: string,
// // // ) {
// // //   if (!remoteInventory.length) return;

// // //   const db = getOfflineDb();
// // //   const inventoryToInsert = remoteInventory.map((inv) => {
// // //     const normalized = normalizeInventory(inv);
// // //     if (!normalized.tenantId) {
// // //       normalized.tenantId = defaultTenantId;
// // //     }
// // //     return normalized;
// // //   });

// // //   await db
// // //     .insert(inventory)
// // //     .values(inventoryToInsert)
// // //     .onConflictDoUpdate({
// // //       target: inventory.id,
// // //       set: {
// // //         tenantId: sql`excluded.tenant_id`,
// // //         storeId: sql`excluded.store_id`,
// // //         productId: sql`excluded.product_id`,
// // //         variantId: sql`excluded.variant_id`,
// // //         quantity: sql`excluded.quantity`,
// // //         reservedQty: sql`excluded.reserved_qty`,
// // //         reorderPoint: sql`excluded.reorder_point`,
// // //         reorderQty: sql`excluded.reorder_qty`,
// // //         shelfLocation: sql`excluded.shelf_location`,
// // //         version: sql`excluded.version`,
// // //         syncStatus: "synced",
// // //         syncError: null,
// // //         updatedAt: sql`excluded.updated_at`,
// // //         lastSyncedAt: sql`excluded.last_synced_at`,
// // //       },
// // //     });
// // // }

// // export async function upsertInventory(
// //   remoteInventory: any[],
// //   defaultTenantId: string,
// // ) {
// //   if (!remoteInventory.length) return;

// //   const db = getOfflineDb();
// //   await db.run(sql`PRAGMA foreign_keys = OFF`);
// //   try {
// //     const inventoryToInsert = remoteInventory.map((inv) => {
// //       const normalized = normalizeInventory(inv);
// //       if (!normalized.tenantId) {
// //         normalized.tenantId = defaultTenantId;
// //       }
// //       return normalized;
// //     });

// //     await db
// //       .insert(inventory)
// //       .values(inventoryToInsert)
// //       .onConflictDoUpdate({
// //         target: inventory.id,
// //         set: {
// //           tenantId: sql`excluded.tenant_id`,
// //           storeId: sql`excluded.store_id`,
// //           productId: sql`excluded.product_id`,
// //           variantId: sql`excluded.variant_id`,
// //           quantity: sql`excluded.quantity`,
// //           reservedQty: sql`excluded.reserved_qty`,
// //           reorderPoint: sql`excluded.reorder_point`,
// //           reorderQty: sql`excluded.reorder_qty`,
// //           shelfLocation: sql`excluded.shelf_location`,
// //           version: sql`excluded.version`,
// //           syncStatus: "synced",
// //           syncError: null,
// //           updatedAt: sql`excluded.updated_at`,
// //           lastSyncedAt: sql`excluded.last_synced_at`,
// //         },
// //       });
// //   } finally {
// //     await db.run(sql`PRAGMA foreign_keys = ON`);
// //   }
// // }

// export async function upsertInventory(
//   remoteInventory: any[],
//   defaultTenantId: string,
// ) {
//   if (!remoteInventory.length) return;
//   const db = getOfflineDb();

//   const inventoryToInsert = remoteInventory.map((inv) => {
//     const normalized = normalizeInventory(inv);
//     if (!normalized.tenantId) normalized.tenantId = defaultTenantId;
//     return normalized;
//   });

//   await withForeignKeysOff(db, async () => {
//     await db
//       .insert(inventory)
//       .values(inventoryToInsert)
//       .onConflictDoUpdate({
//         target: inventory.id,
//         set: {
//           tenantId: sql`excluded.tenant_id`,
//           storeId: sql`excluded.store_id`,
//           productId: sql`excluded.product_id`,
//           variantId: sql`excluded.variant_id`,
//           quantity: sql`excluded.quantity`,
//           reservedQty: sql`excluded.reserved_qty`,
//           reorderPoint: sql`excluded.reorder_point`,
//           reorderQty: sql`excluded.reorder_qty`,
//           shelfLocation: sql`excluded.shelf_location`,
//           version: sql`excluded.version`,
//           syncStatus: "synced",
//           syncError: null,
//           updatedAt: sql`excluded.updated_at`,
//           lastSyncedAt: sql`excluded.last_synced_at`,
//         },
//       });
//   });
// }

// export async function upsertCategories(
//   remoteCategories: Category[],
//   defaultTenantId: string,
// ) {
//   if (!remoteCategories.length) return;
//   const now = new Date().toISOString();

//   const categoriesToInsert = remoteCategories.map((category) => ({
//     id: category.id,
//     remoteId: category.remoteId,
//     tenantId: category.tenantId || defaultTenantId,
//     name: category.name || "Unnamed Category",
//     slug: category.slug,
//     description: category.description,
//     parentId: category.parentId,
//     isActive: category.isActive ?? true,
//     sortOrder: category.sortOrder ?? 0,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: category.createdAt ?? now,
//     updatedAt: category.updatedAt ?? now,
//     lastSyncedAt: now,
//   }));

//   await getOfflineDb()
//     .insert(categories)
//     .values(categoriesToInsert)
//     .onConflictDoUpdate({
//       target: categories.id,
//       set: {
//         name: sql`excluded.name`,
//         slug: sql`excluded.slug`,
//         description: sql`excluded.description`,
//         parentId: sql`excluded.parent_id`,
//         isActive: sql`excluded.is_active`,
//         sortOrder: sql`excluded.sort_order`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// export async function upsertCustomers(
//   remoteCustomers: Customer[],
//   defaultTenantId: string,
// ) {
//   if (!remoteCustomers.length) return;
//   const now = new Date().toISOString();

//   const customersToInsert = remoteCustomers.map((customer) => ({
//     id: customer.id,
//     remoteId: customer.remoteId,
//     tenantId: customer.tenantId || defaultTenantId,
//     code: customer.code || `CUS-${Date.now()}`,
//     name: customer.name || "Unnamed Customer",
//     phone: customer.phone,
//     email: customer.email,
//     address: customer.address,
//     dateOfBirth: customer.dateOfBirth,
//     gender: customer.gender,
//     debtAmount: customer.debtAmount ?? 0,
//     loyaltyPoints: customer.loyaltyPoints ?? 0,
//     totalSpent: customer.totalSpent ?? 0,
//     totalOrders: customer.totalOrders ?? 0,
//     tier: customer.tier ?? "BRONZE",
//     tierValidUntil: customer.tierValidUntil,
//     isActive: customer.isActive ?? true,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: customer.createdAt ?? now,
//     updatedAt: customer.updatedAt ?? now,
//     lastSyncedAt: now,
//   }));

//   await getOfflineDb()
//     .insert(customers)
//     .values(customersToInsert)
//     .onConflictDoUpdate({
//       target: customers.id,
//       set: {
//         code: sql`excluded.code`,
//         name: sql`excluded.name`,
//         phone: sql`excluded.phone`,
//         email: sql`excluded.email`,
//         address: sql`excluded.address`,
//         dateOfBirth: sql`excluded.date_of_birth`,
//         gender: sql`excluded.gender`,
//         debtAmount: sql`excluded.debt_amount`,
//         loyaltyPoints: sql`excluded.loyalty_points`,
//         totalSpent: sql`excluded.total_spent`,
//         totalOrders: sql`excluded.total_orders`,
//         tier: sql`excluded.tier`,
//         tierValidUntil: sql`excluded.tier_valid_until`,
//         isActive: sql`excluded.is_active`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// // export async function upsertStaff(
// //   remoteStaff: Staff[],
// //   defaultTenantId: string,
// // ) {
// //   if (!remoteStaff.length) return;
// //   const now = new Date().toISOString();

// //   const staffToInsert = remoteStaff.map((staff) => ({
// //     id: staff.id,
// //     remoteId: staff.remoteId,
// //     tenantId: staff.tenantId || defaultTenantId,
// //     code: staff.code || `STAFF-${Date.now()}`,
// //     name: staff.name || "Unnamed Staff",
// //     phone: staff.phone,
// //     email: staff.email,
// //     role: staff.role,
// //     isActive: staff.isActive ?? true,
// //     syncStatus: "synced",
// //     syncError: null,
// //     createdAt: staff.createdAt ?? now,
// //     updatedAt: staff.updatedAt ?? now,
// //     lastSyncedAt: now,
// //   }));

// //   await getOfflineDb()
// //     .insert(staff)
// //     .values(staffToInsert)
// //     .onConflictDoUpdate({
// //       target: staff.id,
// //       set: {
// //         code: sql`excluded.code`,
// //         name: sql`excluded.name`,
// //         phone: sql`excluded.phone`,
// //         email: sql`excluded.email`,
// //         role: sql`excluded.role`,
// //         isActive: sql`excluded.is_active`,
// //         syncStatus: "synced",
// //         syncError: null,
// //         updatedAt: sql`excluded.updated_at`,
// //         lastSyncedAt: now,
// //       },
// //     });
// // }
// // export async function upsertSuppliers(
// //   remoteSuppliers: Supplier[],
// //   defaultTenantId: string,
// // ) {
// //   if (!remoteSuppliers.length) return;
// //   const now = new Date().toISOString();

// //   const suppliersToInsert = remoteSuppliers.map((supplier) => ({
// //     id: supplier.id,
// //     remoteId: supplier.remoteId,
// //     tenantId: supplier.tenantId || defaultTenantId,
// //     code: supplier.code || `SUPPLIER-${Date.now()}`,
// //     name: supplier.name || "Unnamed Supplier",
// //     address: supplier.address,
// //     phone: supplier.phone,
// //     email: supplier.email,
// //     taxNumber: supplier.taxNumber,
// //     isActive: supplier.isActive ?? true,
// //     syncStatus: "synced",
// //     syncError: null,
// //     createdAt: supplier.createdAt ?? now,
// //     updatedAt: supplier.updatedAt ?? now,
// //     lastSyncedAt: now,
// //   }));

// //   await getOfflineDb()
// //     .insert(suppliers)
// //     .values(suppliersToInsert)
// //     .onConflictDoUpdate({
// //       target: suppliers.id,
// //       set: {
// //         code: sql`excluded.code`,
// //         name: sql`excluded.name`,
// //         phone: sql`excluded.phone`,
// //         email: sql`excluded.email`,
// //         address: sql`excluded.address`,
// //         taxNumber: sql`excluded.tax_number`,
// //         isActive: sql`excluded.is_active`,
// //         syncStatus: "synced",
// //         syncError: null,
// //         updatedAt: sql`excluded.updated_at`,
// //         lastSyncedAt: now,
// //       },
// //     });
// // }

// export async function upsertStaff(remoteStaff: any[], defaultTenantId: string) {
//   if (!remoteStaff.length) return;
//   const now = new Date().toISOString();

//   // Deduplicate by (tenantId, username)
//   const seen = new Set<string>();
//   const uniqueStaff = remoteStaff.filter((s) => {
//     const key = `${s.tenantId || defaultTenantId}:${(s.username || "").toLowerCase()}`;
//     if (seen.has(key)) return false;
//     seen.add(key);
//     return true;
//   });

//   const staffToInsert = uniqueStaff.map((s) => ({
//     id: s.id,
//     remoteId: s.remoteId,
//     tenantId: s.tenantId || defaultTenantId,
//     storeId: s.storeId,
//     username: s.username,
//     email: s.email?.trim() || null,
//     name: s.name,
//     role: s.role,
//     permissions: s.permissions || [],
//     isActive: s.isActive ?? true,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: s.createdAt ?? now,
//     updatedAt: s.updatedAt ?? now,
//     lastSyncedAt: now,
//   }));

//   await getOfflineDb()
//     .insert(staff)
//     .values(staffToInsert)
//     .onConflictDoUpdate({
//       target: [staff.tenantId, staff.username], // ✅ Use composite index
//       set: {
//         username: sql`excluded.username`,
//         email: sql`excluded.email`,
//         name: sql`excluded.name`,
//         role: sql`excluded.role`,
//         permissions: sql`excluded.permissions`,
//         storeId: sql`excluded.store_id`,
//         isActive: sql`excluded.is_active`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// // // ============================================
// // // UPSERT STAFF (corrected)
// // // ============================================
// // export async function upsertStaff(remoteStaff: any[], defaultTenantId: string) {
// //   if (!remoteStaff.length) return;
// //   const now = new Date().toISOString();

// //   const staffToInsert = remoteStaff.map((staff) => ({
// //     id: staff.id,
// //     remoteId: staff.remoteId,
// //     tenantId: staff.tenantId || defaultTenantId,
// //     storeId: staff.storeId,
// //     username: staff.username,
// //     email: staff.email,
// //     name: staff.name,
// //     role: staff.role,
// //     permissions: staff.permissions || [],
// //     isActive: staff.isActive ?? true,
// //     syncStatus: "synced",
// //     syncError: null,
// //     createdAt: staff.createdAt ?? now,
// //     updatedAt: staff.updatedAt ?? now,
// //     lastSyncedAt: now,
// //   }));

// //   await getOfflineDb()
// //     .insert(staff)
// //     .values(staffToInsert)
// //     .onConflictDoUpdate({
// //       target: staff.id,
// //       set: {
// //         username: sql`excluded.username`,
// //         email: sql`excluded.email`,
// //         name: sql`excluded.name`,
// //         role: sql`excluded.role`,
// //         permissions: sql`excluded.permissions`,
// //         storeId: sql`excluded.store_id`,
// //         isActive: sql`excluded.is_active`,
// //         syncStatus: "synced",
// //         syncError: null,
// //         updatedAt: sql`excluded.updated_at`,
// //         lastSyncedAt: now,
// //       },
// //     });
// // }

// // // ============================================
// // // UPSERT SUPPLIERS (corrected)
// // // ============================================
// // export async function upsertSuppliers(
// //   remoteSuppliers: any[],
// //   defaultTenantId: string,
// // ) {
// //   if (!remoteSuppliers.length) return;
// //   const now = new Date().toISOString();

// //   const suppliersToInsert = remoteSuppliers.map((supplier) => ({
// //     id: supplier.id,
// //     remoteId: supplier.remoteId,
// //     tenantId: supplier.tenantId || defaultTenantId,
// //     storeId: supplier.storeId,
// //     code: supplier.code,
// //     name: supplier.name,
// //     contactName: supplier.contactName,
// //     phone: supplier.phone,
// //     email: supplier.email,
// //     address: supplier.address,
// //     taxNumber: supplier.taxNumber,
// //     paymentTerms: supplier.paymentTerms,
// //     creditLimit: supplier.creditLimit,
// //     currentBalance: supplier.currentBalance ?? 0,
// //     isActive: supplier.isActive ?? true,
// //     syncStatus: "synced",
// //     syncError: null,
// //     createdAt: supplier.createdAt ?? now,
// //     updatedAt: supplier.updatedAt ?? now,
// //     lastSyncedAt: now,
// //   }));

// //   await getOfflineDb()
// //     .insert(suppliers)
// //     .values(suppliersToInsert)
// //     .onConflictDoUpdate({
// //       target: suppliers.id,
// //       set: {
// //         code: sql`excluded.code`,
// //         name: sql`excluded.name`,
// //         contactName: sql`excluded.contact_name`,
// //         phone: sql`excluded.phone`,
// //         email: sql`excluded.email`,
// //         address: sql`excluded.address`,
// //         taxNumber: sql`excluded.tax_number`,
// //         paymentTerms: sql`excluded.payment_terms`,
// //         creditLimit: sql`excluded.credit_limit`,
// //         currentBalance: sql`excluded.current_balance`,
// //         storeId: sql`excluded.store_id`,
// //         isActive: sql`excluded.is_active`,
// //         syncStatus: "synced",
// //         syncError: null,
// //         updatedAt: sql`excluded.updated_at`,
// //         lastSyncedAt: now,
// //       },
// //     });
// // }

// // ============================================
// // UPSERT SUPPLIERS (fixed)
// // ============================================
// export async function upsertSuppliers(
//   remoteSuppliers: any[],
//   defaultTenantId: string,
// ) {
//   if (!remoteSuppliers.length) return;
//   const now = new Date().toISOString();

//   // 1. Deduplicate by (tenantId, email) to avoid batch conflicts
//   const seen = new Set<string>();
//   const uniqueSuppliers = remoteSuppliers.filter((s) => {
//     const key = `${s.tenantId || defaultTenantId}:${(s.email || "").toLowerCase()}`;
//     if (seen.has(key)) return false;
//     seen.add(key);
//     return true;
//   });

//   const suppliersToInsert = uniqueSuppliers.map((supplier) => ({
//     id: supplier.id,
//     remoteId: supplier.remoteId,
//     tenantId: supplier.tenantId || defaultTenantId,
//     storeId: supplier.storeId,
//     code: supplier.code,
//     name: supplier.name,
//     contactName: supplier.contactName,
//     phone: supplier.phone,
//     email: supplier.email?.trim() || null, // ✅ convert empty to null
//     address: supplier.address,
//     taxNumber: supplier.taxNumber,
//     paymentTerms: supplier.paymentTerms,
//     creditLimit: supplier.creditLimit,
//     currentBalance: supplier.currentBalance ?? 0,
//     isActive: supplier.isActive ?? true,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: supplier.createdAt ?? now,
//     updatedAt: supplier.updatedAt ?? now,
//     lastSyncedAt: now,
//   }));

//   // 2. Upsert using the composite unique index
//   await getOfflineDb()
//     .insert(suppliers)
//     .values(suppliersToInsert)
//     .onConflictDoUpdate({
//       target: [suppliers.tenantId, suppliers.email], // ✅ Use the composite index
//       set: {
//         code: sql`excluded.code`,
//         name: sql`excluded.name`,
//         contactName: sql`excluded.contact_name`,
//         phone: sql`excluded.phone`,
//         email: sql`excluded.email`,
//         address: sql`excluded.address`,
//         taxNumber: sql`excluded.tax_number`,
//         paymentTerms: sql`excluded.payment_terms`,
//         creditLimit: sql`excluded.credit_limit`,
//         currentBalance: sql`excluded.current_balance`,
//         storeId: sql`excluded.store_id`,
//         isActive: sql`excluded.is_active`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// export async function upsertStores(
//   remoteStores: Store[],
//   defaultTenantId: string,
// ) {
//   if (!remoteStores.length) return;
//   const now = new Date().toISOString();

//   const storesToInsert = remoteStores.map((store) => ({
//     id: store.id,
//     remoteId: store.remoteId,
//     tenantId: store.tenantId || defaultTenantId,
//     code: store.code || `STORE-${Date.now()}`,
//     name: store.name || "Unnamed Store",
//     address: store.address,
//     phone: store.phone,
//     email: store.email,
//     taxNumber: store.taxNumber,
//     isActive: store.isActive ?? true,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: store.createdAt ?? now,
//     updatedAt: store.updatedAt ?? now,
//     lastSyncedAt: now,
//   }));

//   await getOfflineDb()
//     .insert(stores)
//     .values(storesToInsert)
//     .onConflictDoUpdate({
//       target: stores.id,
//       set: {
//         code: sql`excluded.code`,
//         name: sql`excluded.name`,
//         address: sql`excluded.address`,
//         phone: sql`excluded.phone`,
//         email: sql`excluded.email`,
//         taxNumber: sql`excluded.tax_number`,
//         isActive: sql`excluded.is_active`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// export async function upsertSessions(
//   remoteSessions: Session[],
//   defaultTenantId: string,
// ) {
//   if (!remoteSessions.length) return;
//   const now = new Date().toISOString();

//   const sessionsToInsert = remoteSessions.map((session) => ({
//     id: session.id,
//     remoteId: session.remoteId,
//     tenantId: session.tenantId || defaultTenantId,
//     storeId: session.storeId,
//     registerId: session.registerId,
//     userId: session.userId,
//     status: session.status || "OPEN",
//     openedAt: session.openedAt || now,
//     closedAt: session.closedAt,
//     openingBalance: session.openingBalance ?? 0,
//     closingBalance: session.closingBalance,
//     expectedBalance: session.expectedBalance,
//     discrepancy: session.discrepancy,
//     cashSales: session.cashSales ?? 0,
//     cardSales: session.cardSales ?? 0,
//     digitalSales: session.digitalSales ?? 0,
//     notes: session.notes,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: session.openedAt ?? now,
//     updatedAt: session.closedAt ?? session.openedAt ?? now,
//     lastSyncedAt: now,
//   }));

//   await getOfflineDb()
//     .insert(sessions)
//     .values(sessionsToInsert)
//     .onConflictDoUpdate({
//       target: sessions.id,
//       set: {
//         status: sql`excluded.status`,
//         closedAt: sql`excluded.closed_at`,
//         closingBalance: sql`excluded.closing_balance`,
//         expectedBalance: sql`excluded.expected_balance`,
//         discrepancy: sql`excluded.discrepancy`,
//         cashSales: sql`excluded.cash_sales`,
//         cardSales: sql`excluded.card_sales`,
//         digitalSales: sql`excluded.digital_sales`,
//         notes: sql`excluded.notes`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// export async function upsertOrders(
//   remoteOrders: (Order & Record<string, any>)[],
//   defaultTenantId: string,
// ) {
//   if (!remoteOrders.length) return;
//   const now = new Date().toISOString();

//   const db = getOfflineDb();
//   await db.transaction(async (tx) => {
//     for (const order of remoteOrders) {
//       const tenantId = order.tenantId || defaultTenantId;

//       await tx
//         .insert(orders)
//         .values({
//           id: order.id,
//           remoteId: order.remoteId,
//           tenantId,
//           storeId: order.storeId,
//           registerId: order.registerId,
//           userId: order.userId ?? "",
//           customerId: order.customerId,
//           sessionId: order.sessionId,
//           orderNumber: order.orderNumber || `ORD-${Date.now()}`,
//           status: order.status ?? "COMPLETED",
//           paymentStatus: order.paymentStatus ?? "PAID",
//           paymentMethod: order.paymentMethod ?? "CASH",
//           subTotal: Number(order.subTotal ?? order.grandTotal ?? 0),
//           taxAmount: Number(order.taxAmount ?? 0),
//           discountAmount: Number(order.discountAmount ?? 0),
//           grandTotal: Number(order.grandTotal ?? 0),
//           paidAmount: Number(order.paidAmount ?? 0),
//           changeAmount: Number(order.changeAmount ?? 0),
//           paymentBreakdown: order.paymentBreakdown ?? null,
//           syncStatus: "synced",
//           syncError: null,
//           createdAt: order.createdAt ?? now,
//           updatedAt: order.updatedAt ?? now,
//           lastSyncedAt: now,
//         })
//         .onConflictDoUpdate({
//           target: orders.id,
//           set: {
//             status: sql`excluded.status`,
//             paymentStatus: sql`excluded.payment_status`,
//             grandTotal: sql`excluded.grand_total`,
//             syncStatus: "synced",
//             syncError: null,
//             updatedAt: sql`excluded.updated_at`,
//             lastSyncedAt: now,
//           },
//         });

//       if (Array.isArray(order.items)) {
//         for (const item of order.items as (OrderItem & Record<string, any>)[]) {
//           await tx
//             .insert(orderItems)
//             .values({
//               id: item.id ?? createLocalId("item"),
//               orderId: order.id,
//               productId: item.productId,
//               variantId: item.variantId,
//               productName: item.productName ?? item.product?.name ?? null,
//               quantity: item.quantity,
//               unitPrice: Number(item.unitPrice ?? item.price ?? 0),
//               discountAmount: Number(item.discountAmount ?? 0),
//               subTotal: Number(
//                 item.subTotal ??
//                   item.quantity * Number(item.unitPrice ?? item.price ?? 0),
//               ),
//               createdAt: item.createdAt ?? now,
//             })
//             .onConflictDoUpdate({
//               target: orderItems.id,
//               set: {
//                 quantity: sql`excluded.quantity`,
//                 unitPrice: sql`excluded.unit_price`,
//                 subTotal: sql`excluded.sub_total`,
//               },
//             });
//         }
//       }
//     }
//   });
// }

// export async function upsertPriceHistory(
//   remotePriceHistory: any[],
//   defaultTenantId: string,
// ) {
//   if (!remotePriceHistory.length) return;
//   const now = new Date().toISOString();

//   const priceHistoryToInsert = remotePriceHistory.map((ph) => ({
//     id: ph.id,
//     remoteId: ph.remoteId,
//     tenantId: ph.tenantId || defaultTenantId,
//     productId: ph.productId,
//     variantId: ph.variantId,
//     oldPrice: Number(ph.oldPrice ?? 0),
//     newPrice: Number(ph.newPrice ?? 0),
//     changedBy: ph.changedBy,
//     reason: ph.reason,
//     syncStatus: "synced",
//     syncError: null,
//     createdAt: ph.createdAt ?? now,
//     updatedAt: ph.updatedAt ?? now,
//     lastSyncedAt: now,
//   }));

//   await getOfflineDb()
//     .insert(priceHistory)
//     .values(priceHistoryToInsert)
//     .onConflictDoUpdate({
//       target: priceHistory.id,
//       set: {
//         oldPrice: sql`excluded.old_price`,
//         newPrice: sql`excluded.new_price`,
//         changedBy: sql`excluded.changed_by`,
//         reason: sql`excluded.reason`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// export async function upsertGenericRecords<T extends { id: string }>(
//   entity: string,
//   records: T[],
//   defaultTenantId: string,
// ) {
//   if (!records.length) return;
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .insert(genericRecords)
//     .values(
//       records.map((record) => ({
//         id: record.id,
//         remoteId: (record as any).remoteId,
//         entity,
//         data: record,
//         tenantId: (record as any).tenantId || defaultTenantId,
//         isActive: (record as any).isActive ?? true,
//         syncStatus: "synced",
//         syncError: null,
//         createdAt: (record as any).createdAt ?? now,
//         updatedAt: (record as any).updatedAt ?? now,
//         lastSyncedAt: now,
//       })),
//     )
//     .onConflictDoUpdate({
//       target: genericRecords.id,
//       set: {
//         data: sql`excluded.data`,
//         isActive: sql`excluded.is_active`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: sql`excluded.updated_at`,
//         lastSyncedAt: now,
//       },
//     });
// }

// // ============================================
// // GET LOCAL FUNCTIONS
// // ============================================

// export async function getLocalProducts(storeId?: string) {
//   const db = getOfflineDb();
//   const rows = await db
//     .select()
//     .from(products)
//     .where(
//       and(
//         eq(products.isActive, true),
//         storeId
//           ? or(eq(products.storeId, storeId), sql`${products.storeId} IS NULL`)
//           : undefined,
//       ),
//     );

//   return rows.map((row) => toProduct(row));
// }

// export async function getLocalProductById(id: string) {
//   const db = getOfflineDb();
//   const [row] = await db
//     .select()
//     .from(products)
//     .where(eq(products.id, id))
//     .limit(1);
//   return row ? toProduct(row) : undefined;
// }

// export async function getLocalProductByBarcode(barcode: string) {
//   const db = getOfflineDb();
//   const [row] = await db
//     .select()
//     .from(products)
//     .where(and(eq(products.barcode, barcode), eq(products.isActive, true)))
//     .limit(1);
//   return row ? toProduct(row) : undefined;
// }

// export async function getLocalProductBySku(sku: string) {
//   const db = getOfflineDb();
//   const [row] = await db
//     .select()
//     .from(products)
//     .where(and(eq(products.sku, sku), eq(products.isActive, true)))
//     .limit(1);
//   return row ? toProduct(row) : undefined;
// }

// export async function getLocalVariants(productId?: string) {
//   const db = getOfflineDb();
//   let query = db.select().from(productVariants).$dynamic();

//   if (productId) {
//     query = query.where(eq(productVariants.productId, productId));
//   }

//   const rows = await query.where(eq(productVariants.isActive, true));
//   return rows.map((row) => toProductVariant(row));
// }

// export async function getLocalVariantById(id: string) {
//   const db = getOfflineDb();
//   const [row] = await db
//     .select()
//     .from(productVariants)
//     .where(eq(productVariants.id, id))
//     .limit(1);
//   return row ? toProductVariant(row) : undefined;
// }

// export async function getLocalVariantByBarcode(barcode: string) {
//   const db = getOfflineDb();
//   const [row] = await db
//     .select()
//     .from(productVariants)
//     .where(
//       and(
//         eq(productVariants.barcode, barcode),
//         eq(productVariants.isActive, true),
//       ),
//     )
//     .limit(1);
//   return row ? toProductVariant(row) : undefined;
// }

// export async function getLocalInventory(storeId?: string) {
//   const db = getOfflineDb();
//   let query = db.select().from(inventory).$dynamic();

//   const conditions = [];
//   if (storeId) {
//     conditions.push(eq(inventory.storeId, storeId));
//   }
//   if (conditions.length) {
//     query = query.where(and(...conditions));
//   }

//   const rows = await query;
//   return rows.map((row) => toInventoryItem(row));
// }

// export async function getLocalInventoryByProduct(
//   productId: string,
//   storeId?: string,
// ) {
//   const db = getOfflineDb();
//   let query = db
//     .select()
//     .from(inventory)
//     .where(eq(inventory.productId, productId))
//     .$dynamic();

//   if (storeId) {
//     query = query.where(eq(inventory.storeId, storeId));
//   }

//   const rows = await query;
//   return rows.map((row) => toInventoryItem(row));
// }

// export async function getLocalInventoryByVariant(
//   variantId: string,
//   storeId?: string,
// ) {
//   const db = getOfflineDb();
//   let query = db
//     .select()
//     .from(inventory)
//     .where(eq(inventory.variantId, variantId))
//     .$dynamic();

//   if (storeId) {
//     query = query.where(eq(inventory.storeId, storeId));
//   }

//   const rows = await query;
//   return rows.map((row) => toInventoryItem(row));
// }

// export async function getLocalInventoryItem(id: string) {
//   const db = getOfflineDb();
//   const [row] = await db
//     .select()
//     .from(inventory)
//     .where(eq(inventory.id, id))
//     .limit(1);
//   return row ? toInventoryItem(row) : undefined;
// }

// export async function getLocalCategories(_storeId?: string | null) {
//   const rows = await getOfflineDb()
//     .select()
//     .from(categories)
//     .where(eq(categories.isActive, true));

//   return rows.map((row) => toCategory(row));
// }

// export async function getLocalCategoryById(id: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(categories)
//     .where(eq(categories.id, id))
//     .limit(1);
//   return row ? toCategory(row) : undefined;
// }

// export async function getLocalCategoryByName(name: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(categories)
//     .where(and(eq(categories.name, name), eq(categories.isActive, true)))
//     .limit(1);
//   return row ? toCategory(row) : undefined;
// }

// export async function getLocalCustomers() {
//   const rows = await getOfflineDb()
//     .select()
//     .from(customers)
//     .where(eq(customers.isActive, true));

//   return rows.map((row) => toCustomer(row));
// }

// export async function getLocalCustomerById(id: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(customers)
//     .where(eq(customers.id, id))
//     .limit(1);
//   return row ? toCustomer(row) : undefined;
// }

// export async function getLocalCustomerByPhone(phone: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(customers)
//     .where(and(eq(customers.phone, phone), eq(customers.isActive, true)))
//     .limit(1);
//   return row ? toCustomer(row) : undefined;
// }

// export async function getLocalCustomerByCode(code: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(customers)
//     .where(and(eq(customers.code, code), eq(customers.isActive, true)))
//     .limit(1);
//   return row ? toCustomer(row) : undefined;
// }

// export async function getLocalStores() {
//   const rows = await getOfflineDb()
//     .select()
//     .from(stores)
//     .where(eq(stores.isActive, true));
//   return rows.map((row) => toStore(row));
// }

// export async function getLocalStoreById(id: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(stores)
//     .where(eq(stores.id, id))
//     .limit(1);
//   return row ? toStore(row) : undefined;
// }

// export async function getLocalStoreByCode(code: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(stores)
//     .where(and(eq(stores.code, code), eq(stores.isActive, true)))
//     .limit(1);
//   return row ? toStore(row) : undefined;
// }

// export async function getLocalSessions(storeId?: string, status?: string) {
//   const db = getOfflineDb();
//   let query = db.select().from(sessions).$dynamic();

//   const conditions = [];
//   if (storeId) conditions.push(eq(sessions.storeId, storeId));
//   if (status) conditions.push(eq(sessions.status, status));
//   if (conditions.length) {
//     query = query.where(and(...conditions));
//   }

//   const rows = await query.orderBy(desc(sessions.createdAt));
//   return rows.map((row) => toSession(row));
// }

// export async function getLocalActiveSession(userId: string, storeId?: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(sessions)
//     .where(
//       and(
//         eq(sessions.userId, userId),
//         eq(sessions.status, "OPEN"),
//         storeId
//           ? or(eq(sessions.storeId, storeId), sql`${sessions.storeId} IS NULL`)
//           : undefined,
//       ),
//     )
//     .limit(1);

//   return row ? toSession(row) : undefined;
// }

// export async function getLocalSessionById(id: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(sessions)
//     .where(eq(sessions.id, id))
//     .limit(1);
//   return row ? toSession(row) : undefined;
// }

// export async function getLocalOrders(storeId?: string) {
//   const rows = await getOfflineDb()
//     .select()
//     .from(orders)
//     .where(storeId ? eq(orders.storeId, storeId) : undefined);

//   return Promise.all(rows.map((order) => toOrder(order)));
// }

// export async function getLocalOrderById(id: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(orders)
//     .where(eq(orders.id, id))
//     .limit(1);

//   return row ? toOrder(row) : undefined;
// }

// export async function getLocalOrdersByCustomer(customerId: string) {
//   const rows = await getOfflineDb()
//     .select()
//     .from(orders)
//     .where(eq(orders.customerId, customerId));

//   return Promise.all(rows.map((order) => toOrder(order)));
// }

// export async function getLocalOrdersBySession(sessionId: string) {
//   const rows = await getOfflineDb()
//     .select()
//     .from(orders)
//     .where(eq(orders.sessionId, sessionId));

//   return Promise.all(rows.map((order) => toOrder(order)));
// }

// export async function getLocalInventoryMovements(
//   storeId?: string,
//   type?: string,
//   productId?: string,
// ) {
//   const db = getOfflineDb();
//   let query = db.select().from(inventoryMovements).$dynamic();

//   const conditions = [];
//   if (storeId) conditions.push(eq(inventoryMovements.storeId, storeId));
//   if (type) conditions.push(eq(inventoryMovements.type, type));
//   if (productId) conditions.push(eq(inventoryMovements.productId, productId));
//   if (conditions.length) {
//     query = query.where(and(...conditions));
//   }

//   return await query.orderBy(desc(inventoryMovements.createdAt));
// }

// export async function getLocalInventoryMovementById(id: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(inventoryMovements)
//     .where(eq(inventoryMovements.id, id))
//     .limit(1);
//   return row;
// }

// export async function getLocalPriceHistory(
//   productId?: string,
//   variantId?: string,
// ) {
//   const db = getOfflineDb();
//   let query = db.select().from(priceHistory).$dynamic();

//   const conditions = [];
//   if (productId) conditions.push(eq(priceHistory.productId, productId));
//   if (variantId) conditions.push(eq(priceHistory.variantId, variantId));
//   if (conditions.length) {
//     query = query.where(and(...conditions));
//   }

//   return await query.orderBy(desc(priceHistory.createdAt));
// }

// export async function getLocalGenericRecords<T>(entity: string) {
//   const rows = await getOfflineDb()
//     .select()
//     .from(genericRecords)
//     .where(
//       and(eq(genericRecords.entity, entity), eq(genericRecords.isActive, true)),
//     );

//   return rows.map((row) => ({
//     ...(row.data as T),
//     id: row.id,
//   }));
// }

// export async function getLocalGenericRecord<T>(entity: string, id: string) {
//   const [row] = await getOfflineDb()
//     .select()
//     .from(genericRecords)
//     .where(
//       and(
//         eq(genericRecords.entity, entity),
//         eq(genericRecords.id, id),
//         eq(genericRecords.isActive, true),
//       ),
//     )
//     .limit(1);

//   return row ? { ...(row.data as T), id: row.id } : undefined;
// }

// // ============================================
// // CREATE OFFLINE FUNCTIONS
// // ============================================

// export async function createOfflineProduct(
//   payload: Partial<Product> & {
//     categoryName?: string;
//     storeId?: string;
//     brandId?: string;
//     variants?: any[];
//     initialStock?: number;
//   },
// ) {
//   const now = new Date().toISOString();
//   const id = createLocalId("prod");

//   const db = getOfflineDb();
//   const sqlite = getSqliteDatabase();

//   let productId = id;

//   sqlite.withTransactionSync(() => {
//     sqlite.runSync(
//       `INSERT INTO products (
//         id, tenant_id, name, sku, barcode, description,
//         brand_id, store_id, category_id, supplier_id,
//         cost_price, selling_price, wholesale_price,
//         is_active, sync_status, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         productId,
//         payload.tenantId || null,
//         payload.name || "Offline product",
//         payload.sku || `LOCAL-${Date.now().toString(36).toUpperCase()}`,
//         payload.barcode || null,
//         payload.description || null,
//         payload.brandId || null,
//         payload.storeId || null,
//         payload.categoryId || "default-category",
//         payload.supplierId || null,
//         Number(payload.costPrice ?? 0),
//         Number(payload.sellingPrice ?? 0),
//         Number(payload.wholesalePrice ?? 0),
//         1,
//         "pending",
//         now,
//         now,
//       ],
//     );

//     if (payload.variants && payload.variants.length > 0) {
//       for (const variant of payload.variants) {
//         const variantId = createLocalId("var");
//         sqlite.runSync(
//           `INSERT INTO product_variants (
//             id, product_id, tenant_id, name, sku, barcode,
//             price, cost_price, color, size, weight, is_active,
//             sync_status, created_at, updated_at
//           ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//           [
//             variantId,
//             productId,
//             payload.tenantId || null,
//             variant.name || "Variant",
//             variant.sku || `VAR-${Date.now().toString(36).toUpperCase()}`,
//             variant.barcode || null,
//             Number(variant.price ?? 0),
//             Number(variant.costPrice ?? 0),
//             variant.color || null,
//             variant.size || null,
//             variant.weight ? Number(variant.weight) : null,
//             variant.isActive !== undefined ? (variant.isActive ? 1 : 0) : 1,
//             "pending",
//             now,
//             now,
//           ],
//         );

//         if (payload.storeId) {
//           const invId = createLocalId("inv");
//           sqlite.runSync(
//             `INSERT INTO inventory (
//               id, tenant_id, store_id, product_id, variant_id, quantity,
//               sync_status, created_at, updated_at
//             ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//             [
//               invId,
//               payload.tenantId || null,
//               payload.storeId,
//               productId,
//               variantId,
//               Number(variant.initialStock ?? 0),
//               "pending",
//               now,
//               now,
//             ],
//           );
//         }
//       }
//     }

//     if (
//       payload.storeId &&
//       (!payload.variants || payload.variants.length === 0)
//     ) {
//       const invId = createLocalId("inv");
//       sqlite.runSync(
//         `INSERT INTO inventory (
//           id, tenant_id, store_id, product_id, quantity,
//           sync_status, created_at, updated_at
//         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//         [
//           invId,
//           payload.tenantId || null,
//           payload.storeId,
//           productId,
//           Number(payload.initialStock ?? 0),
//           "pending",
//           now,
//           now,
//         ],
//       );
//     }

//     sqlite.runSync(
//       `INSERT INTO sync_outbox (
//         id, entity, entity_id, operation, endpoint, method, payload, status,
//         attempts, next_attempt_at, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         createLocalId("outbox"),
//         "products",
//         productId,
//         "create",
//         "/api/tenant/products",
//         "POST",
//         JSON.stringify(payload),
//         "pending",
//         0,
//         now,
//         now,
//         now,
//       ],
//     );
//   });

//   const [row] = await db
//     .select()
//     .from(products)
//     .where(eq(products.id, productId))
//     .limit(1);

//   return toProduct(row);
// }

// export async function createOfflineCategory(
//   payload: CreateCategoryPayload & { storeId?: string },
// ) {
//   const now = new Date().toISOString();
//   const id = createLocalId("cat");

//   await getOfflineDb()
//     .insert(categories)
//     .values({
//       id: id,
//       remoteId: null,
//       tenantId: payload.tenantId,
//       // storeId: payload.storeId,
//       name: payload.name || "Unnamed Category",
//       slug:
//         (payload.slug ?? payload.name?.toLowerCase().replace(/\s+/g, "-")) ||
//         "cat-" + Date.now(),
//       description: payload.description,
//       parentId: payload.parentId,
//       isActive: payload.isActive ?? true,
//       sortOrder: payload.sortOrder ?? 0,
//       syncStatus: "pending",
//       syncError: null,
//       createdAt: now,
//       updatedAt: now,
//       lastSyncedAt: null,
//     });

//   await enqueueMutation(
//     "categories",
//     id,
//     "create",
//     "/api/tenant/categories",
//     "POST",
//     payload,
//   );
//   return toCategory(
//     (
//       await getOfflineDb()
//         .select()
//         .from(categories)
//         .where(eq(categories.id, id))
//         .limit(1)
//     )[0],
//   );
// }

// export async function createOfflineCustomer(payload: CreateCustomerPayload) {
//   const now = new Date().toISOString();
//   const id = createLocalId("cus");
//   const code = payload.code ?? `LOCAL-${Date.now().toString(36).toUpperCase()}`;

//   await getOfflineDb()
//     .insert(customers)
//     .values({
//       id: id,
//       remoteId: null,
//       tenantId: payload.tenantId,
//       code,
//       name: payload.name || "Unnamed Customer",
//       phone: payload.phone,
//       email: payload.email,
//       address: payload.address,
//       dateOfBirth: payload.dateOfBirth,
//       gender: payload.gender,
//       debtAmount: payload.debtAmount ?? 0,
//       loyaltyPoints: 0,
//       totalSpent: 0,
//       totalOrders: 0,
//       tier: "BRONZE",
//       tierValidUntil: null,
//       isActive: true,
//       syncStatus: "pending",
//       syncError: null,
//       createdAt: now,
//       updatedAt: now,
//       lastSyncedAt: null,
//     });

//   await enqueueMutation(
//     "customers",
//     id,
//     "create",
//     "/api/tenant/customers",
//     "POST",
//     payload,
//   );
//   return toCustomer(
//     (
//       await getOfflineDb()
//         .select()
//         .from(customers)
//         .where(eq(customers.id, id))
//         .limit(1)
//     )[0],
//   );
// }

// export async function createOfflineStore(payload: CreateStorePayload) {
//   const now = new Date().toISOString();
//   const id = createLocalId("store");
//   const code = payload.code ?? `LOCAL-${Date.now().toString(36).toUpperCase()}`;

//   await getOfflineDb()
//     .insert(stores)
//     .values({
//       id: id,
//       remoteId: null,
//       tenantId: payload.tenantId,
//       code,
//       name: payload.name || "Unnamed Store",
//       address: payload.address,
//       phone: payload.phone,
//       email: payload.email,
//       taxNumber: payload.taxNumber,
//       isActive: payload.isActive ?? true,
//       syncStatus: "pending",
//       syncError: null,
//       createdAt: now,
//       updatedAt: now,
//       lastSyncedAt: null,
//     });

//   await enqueueMutation("stores", id, "create", "/api/tenant/stores", "POST", {
//     ...payload,
//     code,
//   });
//   return toStore(
//     (
//       await getOfflineDb()
//         .select()
//         .from(stores)
//         .where(eq(stores.id, id))
//         .limit(1)
//     )[0],
//   );
// }

// export async function openOfflineSession(payload: {
//   userId: string;
//   tenantId: string;
//   openingBalance: number;
//   notes?: string;
//   storeId?: string;
//   registerId?: string;
// }) {
//   const now = new Date().toISOString();
//   const id = createLocalId("ses");

//   await getOfflineDb().insert(sessions).values({
//     id: id,
//     remoteId: null,
//     tenantId: payload.tenantId,
//     userId: payload.userId,
//     storeId: payload.storeId,
//     registerId: payload.registerId,
//     status: "OPEN",
//     openedAt: now,
//     closedAt: null,
//     openingBalance: payload.openingBalance,
//     closingBalance: null,
//     expectedBalance: null,
//     discrepancy: null,
//     cashSales: 0,
//     cardSales: 0,
//     digitalSales: 0,
//     notes: payload.notes,
//     syncStatus: "pending",
//     syncError: null,
//     createdAt: now,
//     updatedAt: now,
//     lastSyncedAt: null,
//   });

//   await enqueueMutation(
//     "sessions",
//     id,
//     "open",
//     "/api/tenant/sessions/open",
//     "POST",
//     payload,
//   );
//   return toSession(
//     (
//       await getOfflineDb()
//         .select()
//         .from(sessions)
//         .where(eq(sessions.id, id))
//         .limit(1)
//     )[0],
//   );
// }

// export async function createOfflineOrder(
//   payload: CreateOrderPayload,
// ): Promise<Order> {
//   const db = getOfflineDb();
//   const sqlite = getSqliteDatabase();
//   const now = new Date().toISOString();
//   const orderId = createLocalId("ord");

//   const cleanPayload = {
//     ...payload,
//     subTotal: Number(payload.subTotal) || 0,
//     taxAmount: Number(payload.taxAmount) || 0,
//     discountAmount: Number(payload.discountAmount) || 0,
//     grandTotal: Number(payload.grandTotal) || 0,
//     paidAmount: Number(payload.paidAmount) || 0,
//     changeAmount: Number(payload.changeAmount) || 0,
//     items: payload.items.map((item: any) => ({
//       ...item,
//       quantity: Number(item.quantity) || 0,
//       unitPrice: Number(item.unitPrice) || 0,
//       subTotal: Number(item.subTotal) || 0,
//       discountAmount: Number(item.discountAmount) || 0,
//     })),
//   };

//   sqlite.withTransactionSync(() => {
//     sqlite.runSync(
//       `INSERT INTO orders (
//         id, tenant_id, store_id, register_id, user_id, customer_id, session_id,
//         status, payment_status, payment_method, sub_total, tax_amount,
//         discount_amount, grand_total, paid_amount, change_amount,
//         payment_breakdown, sync_status, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         orderId,
//         payload.tenantId || null,
//         cleanPayload.storeId ?? null,
//         cleanPayload.registerId ?? null,
//         cleanPayload.userId,
//         cleanPayload.customerId ?? null,
//         cleanPayload.sessionId ?? null,
//         "PENDING",
//         cleanPayload.paymentStatus ?? "PAID",
//         cleanPayload.paymentMethod,
//         cleanPayload.subTotal,
//         cleanPayload.taxAmount ?? 0,
//         cleanPayload.discountAmount ?? 0,
//         cleanPayload.grandTotal,
//         cleanPayload.paidAmount,
//         cleanPayload.changeAmount,
//         JSON.stringify(cleanPayload.paymentBreakdown ?? []),
//         "pending",
//         now,
//         now,
//       ],
//     );

//     for (const item of cleanPayload.items) {
//       sqlite.runSync(
//         `INSERT INTO order_items (
//           id, order_id, product_id, variant_id, product_name, quantity, unit_price,
//           discount_amount, sub_total, created_at
//         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//         [
//           createLocalId("item"),
//           orderId,
//           item.productId,
//           item.variantId ?? null,
//           null,
//           item.quantity,
//           item.unitPrice,
//           item.discountAmount ?? 0,
//           item.subTotal,
//           now,
//         ],
//       );

//       const variantCondition = item.variantId
//         ? `AND variant_id = '${item.variantId}'`
//         : `AND variant_id IS NULL`;

//       sqlite.runSync(
//         `UPDATE inventory SET quantity = MAX(quantity - ?, 0), updated_at = ?
//          WHERE product_id = ? AND store_id = ? ${variantCondition}`,
//         [item.quantity, now, item.productId, cleanPayload.storeId],
//       );
//     }

//     sqlite.runSync(
//       `INSERT INTO sync_outbox (
//         id, entity, entity_id, operation, endpoint, method, payload, status,
//         attempts, next_attempt_at, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         createLocalId("outbox"),
//         "orders",
//         orderId,
//         "create",
//         "/api/tenant/orders",
//         "POST",
//         JSON.stringify(cleanPayload),
//         "pending",
//         0,
//         now,
//         now,
//         now,
//       ],
//     );
//   });

//   const [created] = await db
//     .select()
//     .from(orders)
//     .where(eq(orders.id, orderId))
//     .limit(1);
//   const items = await db
//     .select()
//     .from(orderItems)
//     .where(eq(orderItems.orderId, orderId));

//   return {
//     id: created.id,
//     tenantId: created.tenantId,
//     grandTotal: created.grandTotal,
//     status: created.status as Order["status"],
//     createdAt: created.createdAt,
//     updatedAt: created.updatedAt,
//     subTotal: created.subTotal,
//     taxAmount: created.taxAmount,
//     discountAmount: created.discountAmount,
//     paidAmount: created.paidAmount,
//     changeAmount: created.changeAmount,
//     paymentMethod: created.paymentMethod as Order["paymentMethod"],
//     paymentStatus: created.paymentStatus as Order["paymentStatus"],
//     paymentBreakdown: parsePaymentBreakdown(
//       created.paymentBreakdown ?? cleanPayload.paymentBreakdown,
//     ),
//     customerId: created.customerId ?? undefined,
//     storeId: created.storeId ?? undefined,
//     userId: created.userId,
//     items: items.map((item) => ({
//       id: item.id,
//       orderId: item.orderId,
//       productId: item.productId,
//       variantId: item.variantId ?? undefined,
//       productName: item.productName ?? "",
//       quantity: item.quantity,
//       unitPrice: item.unitPrice,
//       discountAmount: item.discountAmount,
//       subTotal: item.subTotal,
//       createdAt: item.createdAt,
//       product: {
//         id: item.productId,
//         sku: "",
//         name: item.productName ?? "",
//         sellingPrice: String(item.unitPrice),
//         costPrice: 0,
//         isTaxable: true,
//         isActive: true,
//         isReturnable: true,
//         createdAt: item.createdAt,
//       } as any,
//     })),
//   };
// }

// export async function createOfflineInventoryMovement(
//   payload: CreateMovementPayload,
// ) {
//   const now = new Date().toISOString();
//   const id = createLocalId("mov");
//   const sqlite = getSqliteDatabase();
//   const db = getOfflineDb();

//   sqlite.withTransactionSync(() => {
//     sqlite.runSync(
//       `INSERT INTO inventory_movements (
//         id, tenant_id, store_id, product_id, variant_id, quantity, type,
//         reference_id, reference_type, reason, sync_status, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         id,
//         payload.tenantId || null,
//         payload.storeId,
//         payload.productId,
//         payload.variantId ?? null,
//         payload.quantity,
//         payload.type,
//         payload.referenceId,
//         payload.referenceType,
//         payload.reason ?? null,
//         "pending",
//         now,
//         now,
//       ],
//     );

//     const multiplier = ["IN", "TRANSFER_IN"].includes(payload.type) ? 1 : -1;
//     const newQuantity =
//       multiplier > 0
//         ? `quantity + ${payload.quantity}`
//         : `MAX(quantity - ${payload.quantity}, 0)`;

//     const variantCondition = payload.variantId
//       ? `AND variant_id = '${payload.variantId}'`
//       : `AND variant_id IS NULL`;

//     sqlite.runSync(
//       `UPDATE inventory SET quantity = ${newQuantity}, updated_at = ?
//        WHERE product_id = ? AND store_id = ? ${variantCondition}`,
//       [now, payload.productId, payload.storeId],
//     );

//     // Strip null/undefined values (e.g. variantId) before persisting
//     // to avoid server 422 validation errors during sync
//     const cleanPayload = Object.fromEntries(
//       Object.entries(payload).filter(([_, v]) => v !== null && v !== undefined),
//     );

//     sqlite.runSync(
//       `INSERT INTO sync_outbox (
//         id, entity, entity_id, operation, endpoint, method, payload, status,
//         attempts, next_attempt_at, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         createLocalId("outbox"),
//         "inventory_movements",
//         id,
//         "create",
//         "/api/tenant/inventory/movements",
//         "POST",
//         JSON.stringify(cleanPayload),
//         "pending",
//         0,
//         now,
//         now,
//         now,
//       ],
//     );
//   });

//   const [row] = await db
//     .select()
//     .from(inventoryMovements)
//     .where(eq(inventoryMovements.id, id))
//     .limit(1);
//   return row;
// }

// export async function createOfflineInventoryCount(payload: CreateCountPayload) {
//   const now = new Date().toISOString();
//   const countId = createLocalId("cnt");
//   const sqlite = getSqliteDatabase();

//   sqlite.withTransactionSync(() => {
//     sqlite.runSync(
//       `INSERT INTO inventory_counts (
//         id, tenant_id, store_id, status, scheduled_date, sync_status, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         countId,
//         payload.tenantId || null,
//         payload.storeId,
//         "COMPLETED",
//         payload.scheduledDate ?? null,
//         "pending",
//         now,
//         now,
//       ],
//     );

//     for (const item of payload.items) {
//       const diff = item.countedQuantity - item.systemQuantity;
//       sqlite.runSync(
//         `INSERT INTO inventory_count_items (
//           id, count_id, product_id, variant_id, system_quantity, counted_quantity, difference, reason, created_at
//         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//         [
//           createLocalId("cnti"),
//           countId,
//           item.productId,
//           item.variantId ?? null,
//           item.systemQuantity,
//           item.countedQuantity,
//           diff,
//           item.reason ?? null,
//           now,
//         ],
//       );

//       const variantCondition = item.variantId
//         ? `AND variant_id = '${item.variantId}'`
//         : `AND variant_id IS NULL`;

//       sqlite.runSync(
//         `UPDATE inventory SET quantity = ?, updated_at = ?
//          WHERE product_id = ? AND store_id = ? ${variantCondition}`,
//         [item.countedQuantity, now, item.productId, payload.storeId],
//       );
//     }

//     sqlite.runSync(
//       `INSERT INTO sync_outbox (
//         id, entity, entity_id, operation, endpoint, method, payload, status,
//         attempts, next_attempt_at, created_at, updated_at
//       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
//       [
//         createLocalId("outbox"),
//         "inventory_counts",
//         countId,
//         "create",
//         "/api/tenant/inventory/counts",
//         "POST",
//         JSON.stringify(payload),
//         "pending",
//         0,
//         now,
//         now,
//         now,
//       ],
//     );
//   });

//   return { id: countId, status: "COMPLETED" };
// }

// export async function createOfflineGenericRecord<T extends Record<string, any>>(
//   entity: string,
//   endpoint: string,
//   payload: T,
// ) {
//   const now = new Date().toISOString();
//   const id = createLocalId(entity.slice(0, 4));
//   const data = {
//     ...payload,
//     id,
//     code: payload.code ?? `LOCAL-${Date.now().toString(36).toUpperCase()}`,
//     isActive: payload.isActive ?? true,
//     createdAt: now,
//     updatedAt: now,
//   };

//   await getOfflineDb().insert(genericRecords).values({
//     id: id,
//     remoteId: null,
//     entity,
//     data,
//     isActive: data.isActive,
//     syncStatus: "pending",
//     syncError: null,
//     createdAt: now,
//     updatedAt: now,
//     lastSyncedAt: null,
//   });

//   await enqueueMutation(entity, id, "create", endpoint, "POST", payload);
//   return data;
// }

// // ============================================
// // UPDATE OFFLINE FUNCTIONS
// // ============================================

// export async function updateOfflineProduct(
//   id: string,
//   data: Partial<Product> & { categoryName?: string },
// ) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(products)
//     .set({
//       ...data,
//       updatedAt: now,
//       syncStatus: "pending",
//     } as Partial<typeof products.$inferInsert>)
//     .where(eq(products.id, id));

//   await enqueueMutation(
//     "products",
//     id,
//     "update",
//     `/api/tenant/products/${id}`,
//     "PUT",
//     data,
//   );
//   const [row] = await getOfflineDb()
//     .select()
//     .from(products)
//     .where(eq(products.id, id))
//     .limit(1);
//   return toProduct(row);
// }

// export async function updateOfflineCategory(
//   id: string,
//   data: Partial<Category>,
// ) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(categories)
//     .set({
//       ...data,
//       updatedAt: now,
//       syncStatus: "pending",
//     } as Partial<typeof categories.$inferInsert>)
//     .where(eq(categories.id, id));

//   await enqueueMutation(
//     "categories",
//     id,
//     "update",
//     `/api/tenant/categories/${id}`,
//     "PUT",
//     data,
//   );
//   const [row] = await getOfflineDb()
//     .select()
//     .from(categories)
//     .where(eq(categories.id, id))
//     .limit(1);
//   return toCategory(row);
// }

// export async function updateOfflineCustomer(
//   id: string,
//   data: Partial<Customer>,
// ) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(customers)
//     .set({
//       ...data,
//       updatedAt: now,
//       syncStatus: "pending",
//     } as Partial<typeof customers.$inferInsert>)
//     .where(eq(customers.id, id));

//   await enqueueMutation(
//     "customers",
//     id,
//     "update",
//     `/api/tenant/customers/${id}`,
//     "PUT",
//     data,
//   );
//   const [row] = await getOfflineDb()
//     .select()
//     .from(customers)
//     .where(eq(customers.id, id))
//     .limit(1);
//   return toCustomer(row);
// }

// export async function updateOfflineStore(id: string, data: Partial<Store>) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(stores)
//     .set({
//       ...data,
//       updatedAt: now,
//       syncStatus: "pending",
//     } as Partial<typeof stores.$inferInsert>)
//     .where(eq(stores.id, id));

//   await enqueueMutation(
//     "stores",
//     id,
//     "update",
//     `/api/tenant/stores/${id}`,
//     "PUT",
//     data,
//   );
//   const [row] = await getOfflineDb()
//     .select()
//     .from(stores)
//     .where(eq(stores.id, id))
//     .limit(1);
//   return toStore(row);
// }

// export async function updateOfflineOrderStatus(id: string, status: string) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(orders)
//     .set({ status, syncStatus: "pending", updatedAt: now })
//     .where(eq(orders.id, id));

//   await enqueueMutation(
//     "orders",
//     id,
//     "updateStatus",
//     `/api/tenant/orders/${id}/status`,
//     "PATCH",
//     { status },
//   );
//   const order = await getLocalOrderById(id);
//   if (!order) throw new Error("Order not found in offline cache");
//   return order;
// }

// export async function closeOfflineSession(
//   sessionId: string,
//   payload: CloseSessionPayload,
// ) {
//   const now = new Date().toISOString();

//   await getOfflineDb()
//     .update(sessions)
//     .set({
//       status: "CLOSED",
//       closedAt: now,
//       closingBalance: payload.closingBalance,
//       expectedBalance: payload.expectedBalance,
//       discrepancy: payload.discrepancy,
//       cashSales: payload.cashSales ?? 0,
//       cardSales: payload.cardSales ?? 0,
//       digitalSales: payload.digitalSales ?? 0,
//       notes: payload.notes,
//       syncStatus: "pending",
//       updatedAt: now,
//     })
//     .where(eq(sessions.id, sessionId));

//   await enqueueMutation(
//     "sessions",
//     sessionId,
//     "close",
//     `/api/tenant/sessions/${sessionId}/close`,
//     "POST",
//     payload,
//   );
//   const [row] = await getOfflineDb()
//     .select()
//     .from(sessions)
//     .where(eq(sessions.id, sessionId))
//     .limit(1);

//   return toSession(row);
// }

// export async function updateOfflineGenericRecord<T extends Record<string, any>>(
//   entity: string,
//   endpoint: string,
//   id: string,
//   data: T,
// ) {
//   const now = new Date().toISOString();
//   const [row] = await getOfflineDb()
//     .select()
//     .from(genericRecords)
//     .where(eq(genericRecords.id, id))
//     .limit(1);
//   const nextData = {
//     ...((row?.data as Record<string, any>) ?? { id }),
//     ...data,
//     updatedAt: now,
//   };

//   await getOfflineDb()
//     .update(genericRecords)
//     .set({ data: nextData, syncStatus: "pending", updatedAt: now })
//     .where(eq(genericRecords.id, id));

//   await enqueueMutation(entity, id, "update", endpoint, "PUT", data);
//   return nextData;
// }

// // ============================================
// // DELETE OFFLINE FUNCTIONS
// // ============================================

// export async function deleteOfflineProduct(id: string) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(products)
//     .set({
//       isActive: false,
//       deletedAt: now,
//       updatedAt: now,
//       syncStatus: "pending",
//     })
//     .where(eq(products.id, id));

//   await enqueueMutation(
//     "products",
//     id,
//     "delete",
//     `/api/tenant/products/${id}`,
//     "DELETE",
//     {},
//   );
// }

// export async function deleteOfflineCategory(id: string) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(categories)
//     .set({
//       isActive: false,
//       updatedAt: now,
//       syncStatus: "pending",
//     })
//     .where(eq(categories.id, id));

//   await enqueueMutation(
//     "categories",
//     id,
//     "delete",
//     `/api/tenant/categories/${id}`,
//     "DELETE",
//     {},
//   );
// }

// export async function deleteOfflineCustomer(id: string) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(customers)
//     .set({
//       isActive: false,
//       updatedAt: now,
//       syncStatus: "pending",
//     })
//     .where(eq(customers.id, id));

//   await enqueueMutation(
//     "customers",
//     id,
//     "delete",
//     `/api/tenant/customers/${id}`,
//     "DELETE",
//     {},
//   );
// }

// export async function deleteOfflineStore(id: string) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(stores)
//     .set({
//       isActive: false,
//       updatedAt: now,
//       syncStatus: "pending",
//     })
//     .where(eq(stores.id, id));

//   await enqueueMutation(
//     "stores",
//     id,
//     "delete",
//     `/api/tenant/stores/${id}`,
//     "DELETE",
//     {},
//   );
// }

// export async function deleteOfflineOrder(id: string) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(orders)
//     .set({ status: "VOIDED", syncStatus: "pending", updatedAt: now })
//     .where(eq(orders.id, id));

//   await enqueueMutation(
//     "orders",
//     id,
//     "delete",
//     `/api/tenant/orders/${id}`,
//     "DELETE",
//     {},
//   );
// }

// export async function deleteOfflineGenericRecord(
//   entity: string,
//   endpoint: string,
//   id: string,
// ) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(genericRecords)
//     .set({ isActive: false, syncStatus: "pending", updatedAt: now })
//     .where(eq(genericRecords.id, id));

//   await enqueueMutation(entity, id, "delete", endpoint, "DELETE", {});
// }

// // ============================================
// // SYNC OUTBOX FUNCTIONS
// // ============================================

// async function enqueueMutation(
//   entity: string,
//   entityId: string,
//   operation: string,
//   endpoint: string,
//   method: string,
//   payload: unknown,
// ) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .insert(syncOutbox)
//     .values({
//       id: createLocalId("outbox"),
//       entity,
//       entityId,
//       operation,
//       endpoint,
//       method,
//       payload,
//       status: "pending",
//       attempts: 0,
//       nextAttemptAt: now,
//       lastError: null,
//       createdAt: now,
//       updatedAt: now,
//     });
// }

// export async function enqueueMutations(
//   items: Array<{
//     entity: string;
//     entityId: string;
//     operation: string;
//     endpoint: string;
//     method: string;
//     payload: unknown;
//   }>,
// ) {
//   if (!items.length) return;

//   const now = new Date().toISOString();
//   const db = getOfflineDb();

//   await db.insert(syncOutbox).values(
//     items.map((item) => ({
//       id: createLocalId("outbox"),
//       ...item,
//       status: "pending",
//       attempts: 0,
//       nextAttemptAt: now,
//       lastError: null,
//       createdAt: now,
//       updatedAt: now,
//     })),
//   );
// }

// export async function getDueOutboxItems(limit = 25) {
//   return getOfflineDb()
//     .select()
//     .from(syncOutbox)
//     .where(
//       and(
//         inArray(syncOutbox.status, ["pending", "failed"]),
//         lte(syncOutbox.nextAttemptAt, new Date().toISOString()),
//       ),
//     )
//     .limit(limit);
// }

// export async function getOutboxItems(limit = 100) {
//   return getOfflineDb()
//     .select()
//     .from(syncOutbox)
//     .orderBy(syncOutbox.updatedAt)
//     .limit(limit);
// }

// export async function getFailedOutboxItems(limit = 100) {
//   return getOfflineDb()
//     .select()
//     .from(syncOutbox)
//     .where(inArray(syncOutbox.status, ["failed", "dead"]))
//     .orderBy(syncOutbox.updatedAt)
//     .limit(limit);
// }

// export async function retryOutboxItem(id: string) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(syncOutbox)
//     .set({
//       status: "pending",
//       nextAttemptAt: now,
//       updatedAt: now,
//       lastError: null,
//     })
//     .where(eq(syncOutbox.id, id));
// }

// export async function retryAllFailedOutboxItems() {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(syncOutbox)
//     .set({
//       status: "pending",
//       nextAttemptAt: now,
//       updatedAt: now,
//       lastError: null,
//     })
//     .where(inArray(syncOutbox.status, ["failed", "dead"]));
// }

// export async function markOutboxSynced(id: string) {
//   await getOfflineDb().delete(syncOutbox).where(eq(syncOutbox.id, id));
// }

// export async function markOutboxFailed(
//   id: string,
//   attempts: number,
//   error: string,
// ) {
//   const MAX_ATTEMPTS = 10;

//   // Escalate to "dead" after max attempts to stop infinite retries
//   if (attempts >= MAX_ATTEMPTS) {
//     await getOfflineDb()
//       .update(syncOutbox)
//       .set({
//         status: "dead",
//         attempts,
//         lastError: `[DEAD after ${MAX_ATTEMPTS} attempts] ${error}`,
//         updatedAt: new Date().toISOString(),
//       })
//       .where(eq(syncOutbox.id, id));
//     return;
//   }

//   const delaySeconds = Math.min(300, Math.pow(2, attempts) * 5);
//   const nextAttemptAt = new Date(
//     Date.now() + delaySeconds * 1000,
//   ).toISOString();

//   await getOfflineDb()
//     .update(syncOutbox)
//     .set({
//       status: "failed",
//       attempts,
//       lastError: error,
//       nextAttemptAt,
//       updatedAt: new Date().toISOString(),
//     })
//     .where(eq(syncOutbox.id, id));
// }

// export async function markOutboxDead(id: string) {
//   await getOfflineDb()
//     .update(syncOutbox)
//     .set({
//       status: "dead",
//       updatedAt: new Date().toISOString(),
//     })
//     .where(eq(syncOutbox.id, id));
// }

// export async function getQueuedCount() {
//   const result = await getOfflineDb()
//     .select({ count: sql<number>`count(*)` })
//     .from(syncOutbox)
//     .where(inArray(syncOutbox.status, ["pending", "failed"]));

//   return Number(result[0]?.count ?? 0);
// }

// export async function getFailedCount() {
//   const result = await getOfflineDb()
//     .select({ count: sql<number>`count(*)` })
//     .from(syncOutbox)
//     .where(inArray(syncOutbox.status, ["failed", "dead"]));

//   return Number(result[0]?.count ?? 0);
// }

// export async function clearSyncedOutboxItems() {
//   const db = getOfflineDb();
//   const result = await db
//     .delete(syncOutbox)
//     .where(eq(syncOutbox.status, "synced"))
//     .returning();
//   return result.length;
// }

// export async function clearAllOutboxItems() {
//   const db = getOfflineDb();
//   const result = await db.delete(syncOutbox).returning();
//   return result.length;
// }

// // ============================================
// // SYNC STATUS FUNCTIONS
// // ============================================

// export async function getSyncStats() {
//   const db = getOfflineDb();

//   const [totalPending] = await db
//     .select({ count: sql<number>`count(*)` })
//     .from(syncOutbox)
//     .where(eq(syncOutbox.status, "pending"));

//   const [totalFailed] = await db
//     .select({ count: sql<number>`count(*)` })
//     .from(syncOutbox)
//     .where(eq(syncOutbox.status, "failed"));

//   const [totalDead] = await db
//     .select({ count: sql<number>`count(*)` })
//     .from(syncOutbox)
//     .where(eq(syncOutbox.status, "dead"));

//   const [ordersPending] = await db
//     .select({ count: sql<number>`count(*)` })
//     .from(orders)
//     .where(eq(orders.syncStatus, "pending"));

//   const [productsPending] = await db
//     .select({ count: sql<number>`count(*)` })
//     .from(products)
//     .where(eq(products.syncStatus, "pending"));

//   const [variantsPending] = await db
//     .select({ count: sql<number>`count(*)` })
//     .from(productVariants)
//     .where(eq(productVariants.syncStatus, "pending"));

//   const [inventoryPending] = await db
//     .select({ count: sql<number>`count(*)` })
//     .from(inventory)
//     .where(eq(inventory.syncStatus, "pending"));

//   return {
//     outbox: {
//       pending: Number(totalPending?.count ?? 0),
//       failed: Number(totalFailed?.count ?? 0),
//       dead: Number(totalDead?.count ?? 0),
//     },
//     entities: {
//       orders: Number(ordersPending?.count ?? 0),
//       products: Number(productsPending?.count ?? 0),
//       variants: Number(variantsPending?.count ?? 0),
//       inventory: Number(inventoryPending?.count ?? 0),
//     },
//   };
// }

// // ============================================
// // MARK SYNCED FUNCTIONS
// // ============================================

// export async function markOrderSynced(
//   localId: string,
//   remote: Order & Record<string, any>,
// ) {
//   const now = new Date().toISOString();
//   await getOfflineDb()
//     .update(orders)
//     .set({
//       status: remote.status ?? "COMPLETED",
//       syncStatus: "synced",
//       syncError: null,
//       lastSyncedAt: now,
//       updatedAt: now,
//     })
//     .where(eq(orders.id, localId));
// }

// export async function markEntitySynced(
//   entity: string,
//   localId: string,
//   remote: Record<string, any>,
// ) {
//   const now = new Date().toISOString();

//   if (entity === "products") {
//     await getOfflineDb()
//       .update(products)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//         ...(remote.sku && { sku: remote.sku }),
//         ...(remote.name && { name: remote.name }),
//         ...(remote.sellingPrice && { sellingPrice: remote.sellingPrice }),
//         ...(remote.brandId && { brandId: remote.brandId }),
//         ...(remote.storeId && { storeId: remote.storeId }),
//       })
//       .where(eq(products.id, localId));
//   } else if (entity === "product_variants") {
//     await getOfflineDb()
//       .update(productVariants)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//         ...(remote.sku && { sku: remote.sku }),
//         ...(remote.name && { name: remote.name }),
//         ...(remote.price && { price: remote.price }),
//       })
//       .where(eq(productVariants.id, localId));
//   } else if (entity === "inventory") {
//     await getOfflineDb()
//       .update(inventory)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//         ...(remote.quantity !== undefined && { quantity: remote.quantity }),
//       })
//       .where(eq(inventory.id, localId));
//   } else if (entity === "customers") {
//     await getOfflineDb()
//       .update(customers)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//         ...(remote.code && { code: remote.code }),
//         ...(remote.name && { name: remote.name }),
//       })
//       .where(eq(customers.id, localId));
//   } else if (entity === "categories") {
//     await getOfflineDb()
//       .update(categories)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//         ...(remote.name && { name: remote.name }),
//         ...(remote.slug && { slug: remote.slug }),
//       })
//       .where(eq(categories.id, localId));
//   } else if (entity === "stores") {
//     await getOfflineDb()
//       .update(stores)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//         ...(remote.code && { code: remote.code }),
//         ...(remote.name && { name: remote.name }),
//       })
//       .where(eq(stores.id, localId));
//   } else if (entity === "sessions") {
//     await getOfflineDb()
//       .update(sessions)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//         ...(remote.status && { status: remote.status }),
//         ...(remote.closedAt && { closedAt: remote.closedAt }),
//       })
//       .where(eq(sessions.id, localId));
//   } else if (entity === "inventory_movements") {
//     await getOfflineDb()
//       .update(inventoryMovements)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//       } as any)
//       .where(eq(inventoryMovements.id, localId));
//   } else if (entity === "inventory_counts") {
//     await getOfflineDb()
//       .update(inventoryCounts)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//       } as any)
//       .where(eq(inventoryCounts.id, localId));
//   } else if (entity === "price_history") {
//     await getOfflineDb()
//       .update(priceHistory)
//       .set({
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//       })
//       .where(eq(priceHistory.id, localId));
//   } else {
//     await getOfflineDb()
//       .update(genericRecords)
//       .set({
//         data: remote.id ? remote : sql`${genericRecords.data}`,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//       })
//       .where(eq(genericRecords.id, localId));
//   }
// }

// export async function markOrderSyncFailed(localId: string, error: string) {
//   await getOfflineDb()
//     .update(orders)
//     .set({
//       syncStatus: "failed",
//       syncError: error,
//       updatedAt: new Date().toISOString(),
//     })
//     .where(eq(orders.id, localId));
// }

// export async function markEntitySyncFailed(
//   entity: string,
//   localId: string,
//   error: string,
// ) {
//   const update = {
//     syncStatus: "failed",
//     syncError: error,
//     updatedAt: new Date().toISOString(),
//   };

//   if (entity === "products") {
//     await getOfflineDb()
//       .update(products)
//       .set(update)
//       .where(eq(products.id, localId));
//   } else if (entity === "product_variants") {
//     await getOfflineDb()
//       .update(productVariants)
//       .set(update)
//       .where(eq(productVariants.id, localId));
//   } else if (entity === "inventory") {
//     await getOfflineDb()
//       .update(inventory)
//       .set(update)
//       .where(eq(inventory.id, localId));
//   } else if (entity === "customers") {
//     await getOfflineDb()
//       .update(customers)
//       .set(update)
//       .where(eq(customers.id, localId));
//   } else if (entity === "categories") {
//     await getOfflineDb()
//       .update(categories)
//       .set(update)
//       .where(eq(categories.id, localId));
//   } else if (entity === "stores") {
//     await getOfflineDb()
//       .update(stores)
//       .set(update)
//       .where(eq(stores.id, localId));
//   } else if (entity === "sessions") {
//     await getOfflineDb()
//       .update(sessions)
//       .set(update)
//       .where(eq(sessions.id, localId));
//   } else if (entity === "inventory_movements") {
//     await getOfflineDb()
//       .update(inventoryMovements)
//       .set(update)
//       .where(eq(inventoryMovements.id, localId));
//   } else if (entity === "inventory_counts") {
//     await getOfflineDb()
//       .update(inventoryCounts)
//       .set(update)
//       .where(eq(inventoryCounts.id, localId));
//   } else if (entity === "price_history") {
//     await getOfflineDb()
//       .update(priceHistory)
//       .set(update)
//       .where(eq(priceHistory.id, localId));
//   } else {
//     await getOfflineDb()
//       .update(genericRecords)
//       .set(update)
//       .where(eq(genericRecords.id, localId));
//   }
// }

// // ============================================
// // CONFLICT RESOLUTION
// // ============================================

// export async function resolveConflict(
//   entity: string,
//   localId: string,
//   resolution: "local" | "remote",
//   remoteData?: Record<string, any>,
// ) {
//   const db = getOfflineDb();
//   const now = new Date().toISOString();

//   if (resolution === "remote" && remoteData) {
//     const table = getTableForEntity(entity);
//     if (!table) return;

//     await db
//       .update(table)
//       .set({
//         ...remoteData,
//         syncStatus: "synced",
//         syncError: null,
//         updatedAt: now,
//         lastSyncedAt: now,
//       } as any)
//       .where(eq(table.id, localId));

//     await db
//       .delete(syncOutbox)
//       .where(
//         and(eq(syncOutbox.entity, entity), eq(syncOutbox.entityId, localId)),
//       );
//   } else {
//     await db
//       .update(syncOutbox)
//       .set({
//         status: "pending",
//         attempts: 0,
//         nextAttemptAt: now,
//         updatedAt: now,
//         lastError: null,
//       })
//       .where(
//         and(eq(syncOutbox.entity, entity), eq(syncOutbox.entityId, localId)),
//       );
//   }
// }

// function getTableForEntity(entity: string) {
//   switch (entity) {
//     case "products":
//       return products;
//     case "product_variants":
//       return productVariants;
//     case "inventory":
//       return inventory;
//     case "categories":
//       return categories;
//     case "customers":
//       return customers;
//     case "stores":
//       return stores;
//     case "sessions":
//       return sessions;
//     case "orders":
//       return orders;
//     case "inventory_movements":
//       return inventoryMovements;
//     case "inventory_counts":
//       return inventoryCounts;
//     case "price_history":
//       return priceHistory;
//     default:
//       return null;
//   }
// }

// // ============================================
// // CLEANUP FUNCTIONS
// // ============================================

// export async function cleanupOldData(daysToKeep = 30) {
//   const db = getOfflineDb();
//   const cutoff = new Date(
//     Date.now() - daysToKeep * 24 * 60 * 60 * 1000,
//   ).toISOString();

//   const syncedOutbox = await db
//     .delete(syncOutbox)
//     .where(
//       and(eq(syncOutbox.status, "synced"), lte(syncOutbox.createdAt, cutoff)),
//     )
//     .returning();

//   const deletedGeneric = await db
//     .delete(genericRecords)
//     .where(
//       and(
//         eq(genericRecords.isActive, false),
//         lte(genericRecords.updatedAt, cutoff),
//       ),
//     )
//     .returning();

//   const deletedCounts = await db
//     .delete(inventoryCounts)
//     .where(
//       and(
//         eq(inventoryCounts.status, "COMPLETED"),
//         lte(inventoryCounts.createdAt, cutoff),
//       ),
//     )
//     .returning();

//   return {
//     outbox: syncedOutbox.length,
//     genericRecords: deletedGeneric.length,
//     inventoryCounts: deletedCounts.length,
//   };
// }

// // ============================================
// // HELPER FUNCTIONS (conversion)
// // ============================================

// function parsePaymentBreakdown(value: unknown) {
//   if (!value) return [];
//   if (Array.isArray(value)) return value as Order["paymentBreakdown"];
//   if (typeof value === "string") {
//     try {
//       const parsed = JSON.parse(value);
//       return Array.isArray(parsed) ? parsed : [];
//     } catch {
//       return [];
//     }
//   }
//   return [];
// }

// // ✅ Fixed toProduct
// function toProduct(product: LocalProduct): Product {
//   return {
//     id: product.id,
//     sku: product.sku,
//     barcode: product.barcode ?? undefined,
//     name: product.name,
//     description: product.description ?? undefined,
//     brand: product.brandId ?? undefined,
//     costPrice: product.costPrice,
//     sellingPrice: product.sellingPrice,
//     wholesalePrice: product.wholesalePrice ?? 0,
//     categoryId: product.categoryId ?? "",
//     category: product.categoryId
//       ? {
//           id: product.categoryId,
//           tenantId: product.tenantId,
//           name: "",
//           slug: "",
//           isActive: true,
//           sortOrder: 0,
//           createdAt: product.createdAt,
//           updatedAt: product.createdAt,
//         }
//       : undefined,
//     supplierId: product.supplierId ?? undefined,
//     tenantId: product.tenantId,
//     isTaxable: product.isTaxable,
//     isActive: product.isActive,
//     isReturnable: product.isReturnable,
//     manufacturingDate: product.manufacturingDate ?? undefined,
//     expiryDate: product.expiryDate ?? undefined,
//     version: product.version ?? 1,
//     createdAt: product.createdAt,
//     updatedAt: product.updatedAt ?? product.createdAt,
//   };
// }

// function toProductVariant(variant: LocalProductVariant): any {
//   return {
//     id: variant.id,
//     name: variant.name,
//     productId: variant.productId,
//     tenantId: variant.tenantId,
//     sku: variant.sku,
//     barcode: variant.barcode ?? undefined,
//     price: variant.price,
//     costPrice: variant.costPrice,
//     color: variant.color ?? undefined,
//     size: variant.size ?? undefined,
//     weight: variant.weight ?? undefined,
//     isActive: variant.isActive,
//     createdAt: variant.createdAt,
//     updatedAt: variant.updatedAt,
//   };
// }

// function toInventoryItem(inv: LocalInventory): InventoryItem {
//   return {
//     id: inv.id,
//     productId: inv.productId,
//     storeId: inv.storeId,
//     variantId: inv.variantId ?? undefined,
//     quantity: inv.quantity,
//     reservedQty: inv.reservedQty,
//     reorderPoint: inv.reorderPoint,
//     reorderQty: inv.reorderQty,
//     shelfLocation: inv.shelfLocation ?? undefined,
//     version: inv.version,
//     product: {
//       id: "",
//       name: "",
//       sku: "",
//     },
//   };
// }

// async function toOrder(order: LocalOrder): Promise<Order> {
//   const items = await getOfflineDb()
//     .select()
//     .from(orderItems)
//     .where(eq(orderItems.orderId, order.id));

//   return {
//     id: order.id,
//     tenantId: order.tenantId,
//     grandTotal: order.grandTotal,
//     status: order.status as Order["status"],
//     createdAt: order.createdAt,
//     updatedAt: order.updatedAt,
//     subTotal: order.subTotal,
//     taxAmount: order.taxAmount,
//     discountAmount: order.discountAmount,
//     paidAmount: order.paidAmount,
//     changeAmount: order.changeAmount,
//     paymentMethod: order.paymentMethod as Order["paymentMethod"],
//     paymentStatus: order.paymentStatus as Order["paymentStatus"],
//     paymentBreakdown: parsePaymentBreakdown(order.paymentBreakdown),
//     customerId: order.customerId ?? undefined,
//     storeId: order.storeId ?? undefined,
//     userId: order.userId,
//     items: items.map((item) => ({
//       id: item.id,
//       orderId: item.orderId,
//       productId: item.productId,
//       variantId: item.variantId ?? undefined,
//       productName: item.productName ?? "",
//       quantity: item.quantity,
//       unitPrice: item.unitPrice,
//       discountAmount: item.discountAmount,
//       subTotal: item.subTotal,
//       createdAt: item.createdAt,
//       // ✅ Provide a minimal Product (or leave undefined)
//       product: {
//         id: item.productId,
//         sku: "",
//         name: item.productName ?? "",
//         sellingPrice: String(item.unitPrice),
//         costPrice: 0,
//         isTaxable: true,
//         isActive: true,
//         isReturnable: true,
//         createdAt: item.createdAt,
//       } as any, // as Product
//     })),
//   };
// }

// function toCategory(category: LocalCategory): Category {
//   return {
//     id: category.id,
//     remoteId: category.remoteId ?? null,
//     tenantId: category.tenantId,
//     storeId: (category as any).storeId ?? null,
//     name: category.name,
//     slug: category.slug ?? "",
//     description: category.description ?? undefined,
//     parentId: category.parentId ?? undefined,
//     isActive: category.isActive,
//     sortOrder: category.sortOrder,
//     createdAt: category.createdAt,
//     updatedAt: category.updatedAt,
//   };
// }

// function toCustomer(customer: LocalCustomer): Customer {
//   return {
//     id: customer.id,
//     remoteId: customer.remoteId ?? undefined,
//     tenantId: customer.tenantId,
//     code: customer.code,
//     name: customer.name,
//     phone: customer.phone ?? undefined,
//     email: customer.email ?? undefined,
//     address: customer.address ?? undefined,
//     dateOfBirth: customer.dateOfBirth ?? undefined,
//     gender: customer.gender as "MALE" | "FEMALE" | "OTHER" | undefined,
//     debtAmount: customer.debtAmount ?? 0,
//     loyaltyPoints: customer.loyaltyPoints,
//     totalSpent: customer.totalSpent,
//     totalOrders: customer.totalOrders,
//     tier: (customer.tier as Customer["tier"]) ?? "BRONZE",
//     tierValidUntil: customer.tierValidUntil ?? undefined,
//     isActive: customer.isActive,
//     createdAt: customer.createdAt,
//     updatedAt: customer.updatedAt,
//   };
// }

// function toStore(store: LocalStore): Store {
//   return {
//     id: store.id,
//     remoteId: store.remoteId, // ✅ add
//     tenantId: store.tenantId, // ✅ add
//     code: store.code,
//     name: store.name,
//     address: store.address ?? undefined,
//     phone: store.phone ?? undefined,
//     email: store.email ?? undefined,
//     taxNumber: store.taxNumber ?? undefined,
//     isActive: store.isActive,
//     createdAt: store.createdAt,
//     updatedAt: store.updatedAt,
//   };
// }

// function toSession(session: LocalSession): Session {
//   return {
//     id: session.id,
//     remoteId: session.remoteId, // ✅ add
//     tenantId: session.tenantId,
//     userId: session.userId,
//     status: session.status as Session["status"],
//     openedAt: session.openedAt,
//     closedAt: session.closedAt ?? undefined,
//     openingBalance: session.openingBalance,
//     closingBalance: session.closingBalance ?? undefined,
//     expectedBalance: session.expectedBalance ?? undefined,
//     discrepancy: session.discrepancy ?? undefined,
//     cashSales: session.cashSales,
//     cardSales: session.cardSales,
//     digitalSales: session.digitalSales,
//     notes: session.notes ?? undefined,
//     createdAt: session.createdAt, // ✅ add
//     updatedAt: session.updatedAt, // ✅ add
//   };
// }

// // ============================================
// // SYNC STATUS INTERFACE AND FUNCTIONS
// // ============================================

// export interface SyncStatus {
//   isOnline: boolean;
//   queueCount: number;
//   failedCount: number;
//   totalPending: number;
//   items: Array<{
//     id: string;
//     entity: string;
//     operation: string;
//     status: string;
//     attempts: number;
//     lastError: string | null;
//     createdAt: string;
//   }>;
//   failedItems: Array<{
//     id: string;
//     entity: string;
//     operation: string;
//     attempts: number;
//     lastError: string | null;
//     createdAt: string;
//   }>;
//   entityCounts: {
//     [entity: string]: {
//       pending: number;
//       failed: number;
//       synced: number;
//       total: number;
//     };
//   };
// }

// export async function getSyncStatus(): Promise<SyncStatus> {
//   const db = getOfflineDb();
//   const online = await isOnline();

//   const allItems = await db
//     .select()
//     .from(syncOutbox)
//     .orderBy(syncOutbox.createdAt);

//   const pendingItems = allItems.filter(
//     (item) => item.status === "pending" || item.status === "failed",
//   );

//   const failedItems = allItems.filter(
//     (item) => item.status === "failed" || item.status === "dead",
//   );

//   const entityCounts: SyncStatus["entityCounts"] = {};

//   for (const item of allItems) {
//     if (!entityCounts[item.entity]) {
//       entityCounts[item.entity] = {
//         pending: 0,
//         failed: 0,
//         synced: 0,
//         total: 0,
//       };
//     }
//     entityCounts[item.entity].total++;

//     if (item.status === "pending") {
//       entityCounts[item.entity].pending++;
//     } else if (item.status === "failed" || item.status === "dead") {
//       entityCounts[item.entity].failed++;
//     } else if (item.status === "synced") {
//       entityCounts[item.entity].synced++;
//     }
//   }

//   return {
//     isOnline: online,
//     queueCount: pendingItems.length,
//     failedCount: failedItems.length,
//     totalPending: allItems.filter((item) => item.status === "pending").length,
//     items: pendingItems.map((item) => ({
//       id: item.id,
//       entity: item.entity,
//       operation: item.operation,
//       status: item.status,
//       attempts: item.attempts,
//       lastError: item.lastError ?? null,
//       createdAt: item.createdAt,
//     })),
//     failedItems: failedItems.map((item) => ({
//       id: item.id,
//       entity: item.entity,
//       operation: item.operation,
//       attempts: item.attempts,
//       lastError: item.lastError ?? null,
//       createdAt: item.createdAt,
//     })),
//     entityCounts,
//   };
// }

// export async function getSyncStatusByEntity(entity: string) {
//   const db = getOfflineDb();

//   const items = await db
//     .select()
//     .from(syncOutbox)
//     .where(eq(syncOutbox.entity, entity));

//   const pending = items.filter((item) => item.status === "pending").length;
//   const failed = items.filter(
//     (item) => item.status === "failed" || item.status === "dead",
//   ).length;
//   const synced = items.filter((item) => item.status === "synced").length;

//   return {
//     total: items.length,
//     pending,
//     failed,
//     synced,
//     items: items.map((item) => ({
//       id: item.id,
//       entityId: item.entityId,
//       operation: item.operation,
//       status: item.status,
//       attempts: item.attempts,
//       lastError: item.lastError ?? null,
//       createdAt: item.createdAt,
//       updatedAt: item.updatedAt,
//     })),
//   };
// }

// export async function getFailedItemsWithDetails(limit = 50) {
//   const db = getOfflineDb();

//   const items = await db
//     .select()
//     .from(syncOutbox)
//     .where(inArray(syncOutbox.status, ["failed", "dead"]))
//     .orderBy(syncOutbox.updatedAt)
//     .limit(limit);

//   const result = [];
//   for (const item of items) {
//     let entityData = null;

//     switch (item.entity) {
//       case "products": {
//         const [product] = await db
//           .select()
//           .from(products)
//           .where(eq(products.id, item.entityId))
//           .limit(1);
//         entityData = product;
//         break;
//       }
//       case "product_variants": {
//         const [variant] = await db
//           .select()
//           .from(productVariants)
//           .where(eq(productVariants.id, item.entityId))
//           .limit(1);
//         entityData = variant;
//         break;
//       }
//       case "inventory": {
//         const [inv] = await db
//           .select()
//           .from(inventory)
//           .where(eq(inventory.id, item.entityId))
//           .limit(1);
//         entityData = inv;
//         break;
//       }
//       case "orders": {
//         const [order] = await db
//           .select()
//           .from(orders)
//           .where(eq(orders.id, item.entityId))
//           .limit(1);
//         entityData = order;
//         break;
//       }
//       case "customers": {
//         const [customer] = await db
//           .select()
//           .from(customers)
//           .where(eq(customers.id, item.entityId))
//           .limit(1);
//         entityData = customer;
//         break;
//       }
//       case "categories": {
//         const [category] = await db
//           .select()
//           .from(categories)
//           .where(eq(categories.id, item.entityId))
//           .limit(1);
//         entityData = category;
//         break;
//       }
//       case "stores": {
//         const [store] = await db
//           .select()
//           .from(stores)
//           .where(eq(stores.id, item.entityId))
//           .limit(1);
//         entityData = store;
//         break;
//       }
//       case "sessions": {
//         const [session] = await db
//           .select()
//           .from(sessions)
//           .where(eq(sessions.id, item.entityId))
//           .limit(1);
//         entityData = session;
//         break;
//       }
//       case "price_history": {
//         const [ph] = await db
//           .select()
//           .from(priceHistory)
//           .where(eq(priceHistory.id, item.entityId))
//           .limit(1);
//         entityData = ph;
//         break;
//       }
//     }

//     result.push({
//       ...item,
//       entityData,
//     });
//   }

//   return result;
// }

// export async function getPendingItemsWithDetails(limit = 50) {
//   const db = getOfflineDb();

//   const items = await db
//     .select()
//     .from(syncOutbox)
//     .where(eq(syncOutbox.status, "pending"))
//     .orderBy(syncOutbox.createdAt)
//     .limit(limit);

//   const result = [];
//   for (const item of items) {
//     let entityData = null;

//     switch (item.entity) {
//       case "products": {
//         const [product] = await db
//           .select()
//           .from(products)
//           .where(eq(products.id, item.entityId))
//           .limit(1);
//         entityData = product;
//         break;
//       }
//       case "product_variants": {
//         const [variant] = await db
//           .select()
//           .from(productVariants)
//           .where(eq(productVariants.id, item.entityId))
//           .limit(1);
//         entityData = variant;
//         break;
//       }
//       case "inventory": {
//         const [inv] = await db
//           .select()
//           .from(inventory)
//           .where(eq(inventory.id, item.entityId))
//           .limit(1);
//         entityData = inv;
//         break;
//       }
//       case "orders": {
//         const [order] = await db
//           .select()
//           .from(orders)
//           .where(eq(orders.id, item.entityId))
//           .limit(1);
//         entityData = order;
//         break;
//       }
//       case "customers": {
//         const [customer] = await db
//           .select()
//           .from(customers)
//           .where(eq(customers.id, item.entityId))
//           .limit(1);
//         entityData = customer;
//         break;
//       }
//       case "categories": {
//         const [category] = await db
//           .select()
//           .from(categories)
//           .where(eq(categories.id, item.entityId))
//           .limit(1);
//         entityData = category;
//         break;
//       }
//       case "stores": {
//         const [store] = await db
//           .select()
//           .from(stores)
//           .where(eq(stores.id, item.entityId))
//           .limit(1);
//         entityData = store;
//         break;
//       }
//       case "sessions": {
//         const [session] = await db
//           .select()
//           .from(sessions)
//           .where(eq(sessions.id, item.entityId))
//           .limit(1);
//         entityData = session;
//         break;
//       }
//       case "price_history": {
//         const [ph] = await db
//           .select()
//           .from(priceHistory)
//           .where(eq(priceHistory.id, item.entityId))
//           .limit(1);
//         entityData = ph;
//         break;
//       }
//     }

//     result.push({
//       ...item,
//       entityData,
//     });
//   }

//   return result;
// }

// export async function getSyncQueueSummary() {
//   const db = getOfflineDb();

//   const allItems = await db.select().from(syncOutbox);

//   const summary = {
//     total: allItems.length,
//     pending: 0,
//     synced: 0,
//     failed: 0,
//     dead: 0,
//     byEntity: {} as Record<
//       string,
//       {
//         total: number;
//         pending: number;
//         synced: number;
//         failed: number;
//         dead: number;
//       }
//     >,
//     oldestPending: null as string | null,
//     newestPending: null as string | null,
//   };

//   for (const item of allItems) {
//     if (item.status === "pending") summary.pending++;
//     else if (item.status === "synced") summary.synced++;
//     else if (item.status === "failed") summary.failed++;
//     else if (item.status === "dead") summary.dead++;

//     if (!summary.byEntity[item.entity]) {
//       summary.byEntity[item.entity] = {
//         total: 0,
//         pending: 0,
//         synced: 0,
//         failed: 0,
//         dead: 0,
//       };
//     }
//     summary.byEntity[item.entity].total++;
//     if (item.status === "pending") summary.byEntity[item.entity].pending++;
//     else if (item.status === "synced") summary.byEntity[item.entity].synced++;
//     else if (item.status === "failed") summary.byEntity[item.entity].failed++;
//     else if (item.status === "dead") summary.byEntity[item.entity].dead++;

//     if (item.status === "pending") {
//       if (!summary.oldestPending || item.createdAt < summary.oldestPending) {
//         summary.oldestPending = item.createdAt;
//       }
//       if (!summary.newestPending || item.createdAt > summary.newestPending) {
//         summary.newestPending = item.createdAt;
//       }
//     }
//   }

//   return summary;
// }
