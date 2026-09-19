import { ensureStoreSettingsTable, getOfflineDb } from "@/services/offline/db";
import {
  brands, // ✅ NEW: import brands table
  categories,
  customers,
  inventory,
  inventoryCountItems,
  inventoryCounts,
  inventoryMovements,
  orderItems,
  orders,
  priceHistory,
  products,
  productVariants,
  sessions,
  storeSettings,
  staff,
  stores,
  suppliers,
  syncOutbox,
} from "@/services/offline/schema";
import { refreshIfOnline, pushIfOnline } from "@/services/offline/onlineFirst";
import type { CloseSessionPayload } from "@/services/features/sessions/sessionTypes";
import { createApi, fakeBaseQuery } from "@reduxjs/toolkit/query/react";
import { and, desc, eq, or, sql } from "drizzle-orm";

async function hydrateOrderItems(db: ReturnType<typeof getOfflineDb>, items: any[]) {
  return Promise.all(
    items.map(async (item) => {
      const productId = String(item.productId ?? "");
      const variantId = item.variantId ? String(item.variantId) : null;
      const [product] = productId
        ? await db
            .select({ id: products.id, name: products.name })
            .from(products)
            .where(or(eq(products.id, productId), eq(products.remoteId, productId)))
            .limit(1)
        : [];
      const [variant] = variantId
        ? await db
            .select({ id: productVariants.id, name: productVariants.name })
            .from(productVariants)
            .where(
              or(
                eq(productVariants.id, variantId),
                eq(productVariants.remoteId, variantId),
              ),
            )
            .limit(1)
        : [];
      const baseName = item.productName || product?.name || "Item";
      const variantName = variant?.name || item.variantName || null;
      return {
        ...item,
        productName:
          variantName && !baseName.includes(variantName)
            ? `${baseName} — ${variantName}`
            : baseName,
        variantName,
      };
    }),
  );
}

// ============================================
// TAG TYPES
// ============================================
export type LocalTagTypes =
  | "LocalProducts"
  | "LocalProductVariants"
  | "LocalCategories"
  | "LocalCustomers"
  | "LocalStores"
  | "LocalSessions"
  | "LocalOrders"
  | "LocalInventory"
  | "LocalInventoryMovements"
  | "LocalInventoryCounts"
  | "LocalPriceHistory"
  | "LocalSyncOutbox"
  | "LocalStaff"
  | "LocalSuppliers"
  | "LocalBrands"
  | "LocalStoreSettings"; // ✅ NEW: add Brand tag

// ============================================
// LOCAL API
// ============================================
export const localApi = createApi({
  reducerPath: "localApi",
  baseQuery: fakeBaseQuery<{ message: string }>(),
  tagTypes: [
    "LocalProducts",
    "LocalProductVariants",
    "LocalCategories",
    "LocalCustomers",
    "LocalStores",
    "LocalSessions",
    "LocalOrders",
    "LocalInventory",
    "LocalInventoryMovements",
    "LocalInventoryCounts",
    "LocalPriceHistory",
    "LocalSyncOutbox",
    "LocalStaff",
    "LocalSuppliers",
    "LocalBrands", // ✅ NEW
    "LocalStoreSettings",
  ] as const,
  endpoints: (builder) => ({
    // Cached locally so checkout configuration is available offline.
    getLocalStoreSettings: builder.query({
      async queryFn({ storeId }: { storeId: string }) {
        try {
          ensureStoreSettingsTable();
          await refreshIfOnline(["storeSettings"]);
          const result = await getOfflineDb().select().from(storeSettings)
            .where(eq(storeSettings.storeId, storeId))
            .orderBy(storeSettings.settingKey);
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalStoreSettings"],
    }),

    saveLocalStoreSetting: builder.mutation({
      async queryFn(payload: {
        tenantId: string;
        storeId: string;
        settingKey: string;
        settingValue: unknown;
        description?: string;
        syncNow?: boolean;
      }) {
        try {
          ensureStoreSettingsTable();
          const { saveOfflineStoreSetting } = await import("@/services/offline/repository");
          const { syncNow, ...setting } = payload;
          const result = await saveOfflineStoreSetting(setting);
          if (syncNow) pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalStoreSettings"],
    }),

    // ============================================
    // 0. BRANDS (NEW)
    // ============================================
    getLocalBrands: builder.query({
      async queryFn({ isActive }: { isActive?: boolean } = {}) {
        try {
          await refreshIfOnline(["brands"]);
          const db = getOfflineDb();
          let query = db.select().from(brands).orderBy(brands.name).$dynamic();
          if (isActive !== undefined) {
            query = query.where(eq(brands.isActive, isActive));
          }
          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalBrands"],
    }),

    getLocalBrandById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["brands"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(brands)
            .where(eq(brands.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalBrands", id }],
    }),

    createLocalBrand: builder.mutation({
      async queryFn(payload: any) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();
          const { createLocalId } = await import("@/services/offline/ids");

          const brandId = createLocalId("brn");

          await db.insert(brands).values({
            id: brandId,
            remoteId: null,
            tenantId: payload.tenantId,
            name: payload.name,
            description: payload.description,
            isActive: payload.isActive ?? true,
            syncStatus: "pending",
            syncError: null,
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: null,
          });

          // Enqueue sync mutation
          await db.insert(syncOutbox).values({
            id: createLocalId("outbox"),
            entity: "brands",
            entityId: brandId,
            operation: "create",
            endpoint: "/api/tenant/brands",
            method: "POST",
            payload: payload,
            status: "pending",
            attempts: 0,
            nextAttemptAt: now,
            lastError: null,
            createdAt: now,
            updatedAt: now,
          });

          pushIfOnline();
          return { data: { id: brandId, ...payload } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalBrands"],
    }),

    updateLocalBrand: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & Record<string, any>) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();

          await db
            .update(brands)
            .set({
              ...payload,
              updatedAt: now,
              syncStatus: "pending",
            })
            .where(eq(brands.id, id));

          // Enqueue sync mutation
          const { createLocalId } = await import("@/services/offline/ids");
          await db.insert(syncOutbox).values({
            id: createLocalId("outbox"),
            entity: "brands",
            entityId: id,
            operation: "update",
            endpoint: `/api/tenant/brands/${id}`,
            method: "PUT",
            payload: payload,
            status: "pending",
            attempts: 0,
            nextAttemptAt: now,
            lastError: null,
            createdAt: now,
            updatedAt: now,
          });

          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalBrands", id },
        "LocalBrands",
        "LocalProducts", // because product may reference brand
      ],
    }),

    deleteLocalBrand: builder.mutation({
      async queryFn(id: string) {
        try {
          const db = getOfflineDb();
          await db
            .update(brands)
            .set({
              isActive: false,
              syncStatus: "pending",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(brands.id, id));

          // Enqueue soft delete
          const { createLocalId } = await import("@/services/offline/ids");
          await db.insert(syncOutbox).values({
            id: createLocalId("outbox"),
            entity: "brands",
            entityId: id,
            operation: "delete",
            endpoint: `/api/tenant/brands/${id}`,
            method: "DELETE",
            payload: {},
            status: "pending",
            attempts: 0,
            nextAttemptAt: new Date().toISOString(),
            lastError: null,
            createdAt: new Date().toISOString(),
            updatedAt: new Date().toISOString(),
          });

          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalBrands", id },
        "LocalBrands",
        "LocalProducts",
      ],
    }),

    // ============================================
    // 1. PRODUCTS (no changes needed; already uses brandId and storeId)
    // ============================================
    getLocalProducts: builder.query({
      async queryFn({
        search,
        categoryId,
        storeId,
        isActive,
      }: {
        search?: string;
        categoryId?: string;
        storeId?: string;
        isActive?: boolean;
      } = {}) {
        try {
          await refreshIfOnline(["products","inventory"]);
          const db = getOfflineDb();
          const conditions = [
            sql`${products.syncStatus} != 'pending_delete'`,
            ...(storeId
              ? [
                  or(
                    eq(products.storeId, storeId),
                    sql`${products.storeId} IS NULL`,
                  ),
                ]
              : []),
            ...(search
              ? [
                  sql`${products.name} LIKE ${`%${search}%`} OR ${products.sku} LIKE ${`%${search}%`} OR ${products.barcode} LIKE ${`%${search}%`}`,
                ]
              : []),
            ...(categoryId ? [eq(products.categoryId, categoryId)] : []),
            ...(isActive !== undefined ? [eq(products.isActive, isActive)] : []),
          ];
          let query = db
            .select()
            .from(products)
            .where(and(...conditions))
            .orderBy(desc(products.createdAt))
            .$dynamic();

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalProducts"],
    }),

    getLocalProductById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["products"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(products)
            .where(eq(products.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalProducts", id }],
    }),

    getLocalProductByBarcode: builder.query({
      async queryFn(barcode: string) {
        try {
          await refreshIfOnline(["products"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(products)
            .where(eq(products.barcode, barcode));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalProducts"],
    }),

    getLocalProductBySku: builder.query({
      async queryFn(sku: string) {
        try {
          await refreshIfOnline(["products"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(products)
            .where(eq(products.sku, sku));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalProducts"],
    }),

    createLocalProduct: builder.mutation({
      async queryFn(payload: any) {
        try {
          const { createOfflineProduct } =
            await import("@/services/offline/repository");
          const result = await createOfflineProduct(payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: [
        "LocalProducts",
        "LocalProductVariants",
        "LocalInventory",
        "LocalBrands", // in case brand is referenced
      ],
    }),

    updateLocalProduct: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & Record<string, any>) {
        try {
          const { updateOfflineProduct } =
            await import("@/services/offline/repository");
          const result = await updateOfflineProduct(id, payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalProducts", id },
        "LocalProducts",
        "LocalBrands",
      ],
    }),

    deleteLocalProduct: builder.mutation({
      async queryFn(id: string) {
        try {
          const { deleteOfflineProduct } =
            await import("@/services/offline/repository");
          await deleteOfflineProduct(id);
          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalProducts", id },
        "LocalProducts",
        "LocalInventory",
        "LocalBrands",
      ],
    }),

    // ============================================
    // 2. PRODUCT VARIANTS (unchanged)
    // ============================================
    getLocalVariants: builder.query({
      async queryFn(productId?: string) {
        try {
          await refreshIfOnline(["products"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(productVariants)
            .where(eq(productVariants.isActive, true))
            .$dynamic();

          if (productId) {
            query = query.where(eq(productVariants.productId, productId));
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalProductVariants"],
    }),

    getLocalVariantById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["products"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(productVariants)
            .where(eq(productVariants.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [
        { type: "LocalProductVariants", id },
      ],
    }),

    getLocalVariantByBarcode: builder.query({
      async queryFn(barcode: string) {
        try {
          await refreshIfOnline(["products"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(productVariants)
            .where(eq(productVariants.barcode, barcode));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalProductVariants"],
    }),

    createLocalVariant: builder.mutation({
      async queryFn(payload: any) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();
          const { createLocalId } = await import("@/services/offline/ids");

          const variantId = createLocalId("var");

          await db.insert(productVariants).values({
            id: variantId,
            productId: payload.productId,
            tenantId: payload.tenantId,
            name: payload.name,
            sku: payload.sku,
            barcode: payload.barcode,
            price: payload.price,
            costPrice: payload.costPrice,
            color: payload.color,
            size: payload.size,
            weight: payload.weight,
            isActive: payload.isActive ?? true,
            syncStatus: "pending",
            createdAt: now,
            updatedAt: now,
          });

          if (payload.storeId) {
            await db.insert(inventory).values({
              id: createLocalId("inv"),
              tenantId: payload.tenantId,
              storeId: payload.storeId,
              productId: payload.productId,
              variantId,
              quantity: Number(payload.initialStock ?? 0),
              reservedQty: 0,
              reorderPoint: 10,
              reorderQty: 0,
              version: 0,
              syncStatus: "pending",
              syncError: null,
              createdAt: now,
              updatedAt: now,
              lastSyncedAt: null,
            });
          }

          await db.insert(syncOutbox).values({
            id: createLocalId("outbox"), entity: "product_variants", entityId: variantId,
            operation: "create", endpoint: "/api/tenant/product-variants", method: "POST",
            payload: { ...payload }, status: "pending", attempts: 0, nextAttemptAt: now,
            lastError: null, createdAt: now, updatedAt: now,
          });

          pushIfOnline();
          return { data: { id: variantId, ...payload } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: [
        "LocalProductVariants",
        "LocalProducts",
        "LocalInventory",
      ],
    }),

    updateLocalVariant: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & Record<string, any>) {
        try {
          const { createLocalId } = await import("@/services/offline/ids");
          const db = getOfflineDb();
          const now = new Date().toISOString();

          await db
            .update(productVariants)
            .set({
              ...payload,
              updatedAt: now,
              syncStatus: "pending",
            })
            .where(eq(productVariants.id, id));

          await db.insert(syncOutbox).values({
            id: createLocalId("outbox"), entity: "product_variants", entityId: id,
            operation: "update", endpoint: `/api/tenant/product-variants/${id}`, method: "PUT",
            payload, status: "pending", attempts: 0, nextAttemptAt: now,
            lastError: null, createdAt: now, updatedAt: now,
          });

          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalProductVariants", id },
        "LocalProductVariants",
        "LocalProducts",
      ],
    }),

    deleteLocalVariant: builder.mutation({
      async queryFn(id: string) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();
          const { createLocalId } = await import("@/services/offline/ids");
          await db
            .update(productVariants)
            .set({
              isActive: false,
              syncStatus: "pending",
              updatedAt: now,
            })
            .where(eq(productVariants.id, id));
          await db.insert(syncOutbox).values({
            id: createLocalId("outbox"), entity: "product_variants", entityId: id,
            operation: "delete", endpoint: `/api/tenant/product-variants/${id}`, method: "DELETE",
            payload: {}, status: "pending", attempts: 0, nextAttemptAt: now,
            lastError: null, createdAt: now, updatedAt: now,
          });
          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalProductVariants", id },
        "LocalProductVariants",
        "LocalInventory",
      ],
    }),

    // ============================================
    // 3. CATEGORIES (unchanged)
    // ============================================
    getLocalCategories: builder.query({
      async queryFn({
        storeId,
        isActive,
      }: { storeId?: string; isActive?: boolean } = {}) {
        try {
          await refreshIfOnline(["categories"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(categories)
            .orderBy(categories.sortOrder)
            .$dynamic();

          if (isActive !== undefined) {
            query = query.where(eq(categories.isActive, isActive));
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalCategories"],
    }),

    getLocalCategoryById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["categories"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(categories)
            .where(eq(categories.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalCategories", id }],
    }),

    createLocalCategory: builder.mutation({
      async queryFn(payload: any) {
        try {
          const { createOfflineCategory } =
            await import("@/services/offline/repository");
          const result = await createOfflineCategory(payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalCategories"],
    }),

    updateLocalCategory: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & Record<string, any>) {
        try {
          const { updateOfflineCategory } =
            await import("@/services/offline/repository");
          const result = await updateOfflineCategory(id, payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalCategories", id },
        "LocalCategories",
      ],
    }),

    deleteLocalCategory: builder.mutation({
      async queryFn(id: string) {
        try {
          const { deleteOfflineCategory } =
            await import("@/services/offline/repository");
          await deleteOfflineCategory(id);
          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalCategories", id },
        "LocalCategories",
        "LocalProducts",
      ],
    }),

    // ============================================
    // 4. CUSTOMERS (unchanged)
    // ============================================
    getLocalCustomers: builder.query({
      async queryFn({
        search,
        tier,
        isActive,
      }: {
        search?: string;
        tier?: string;
        isActive?: boolean;
      } = {}) {
        try {
          await refreshIfOnline(["customers"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(customers)
            .orderBy(desc(customers.createdAt))
            .$dynamic();

          if (isActive !== undefined) {
            query = query.where(eq(customers.isActive, isActive));
          }
          if (search) {
            query = query.where(
              sql`${customers.name} LIKE ${`%${search}%`} OR ${customers.code} LIKE ${`%${search}%`} OR ${customers.phone} LIKE ${`%${search}%`}`,
            );
          }
          if (tier) {
            query = query.where(eq(customers.tier, tier));
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalCustomers"],
    }),

    getLocalCustomerById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["customers"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(customers)
            .where(eq(customers.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalCustomers", id }],
    }),

    getLocalCustomerByPhone: builder.query({
      async queryFn(phone: string) {
        try {
          await refreshIfOnline(["customers"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(customers)
            .where(eq(customers.phone, phone));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalCustomers"],
    }),

    createLocalCustomer: builder.mutation({
      async queryFn(payload: any) {
        try {
          const { createOfflineCustomer } =
            await import("@/services/offline/repository");
          const result = await createOfflineCustomer(payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalCustomers"],
    }),

    updateLocalCustomer: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & Record<string, any>) {
        try {
          const { updateOfflineCustomer } =
            await import("@/services/offline/repository");
          const result = await updateOfflineCustomer(id, payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalCustomers", id },
        "LocalCustomers",
      ],
    }),

    deleteLocalCustomer: builder.mutation({
      async queryFn(id: string) {
        try {
          const { deleteOfflineCustomer } =
            await import("@/services/offline/repository");
          await deleteOfflineCustomer(id);
          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalCustomers", id },
        "LocalCustomers",
      ],
    }),

    // ============================================
    // 5. STORES (unchanged)
    // ============================================
    getLocalStores: builder.query({
      async queryFn({ isActive }: { isActive?: boolean } = {}) {
        try {
          await refreshIfOnline(["stores"]);
          const db = getOfflineDb();
          let query = db.select().from(stores).$dynamic();

          if (isActive !== undefined) {
            query = query.where(eq(stores.isActive, isActive));
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalStores"],
    }),

    getLocalStoreById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["stores"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(stores)
            .where(eq(stores.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalStores", id }],
    }),

    createLocalStore: builder.mutation({
      async queryFn(payload: any) {
        try {
          const { createOfflineStore } =
            await import("@/services/offline/repository");
          const result = await createOfflineStore(payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalStores"],
    }),

    updateLocalStore: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & Record<string, any>) {
        try {
          const { updateOfflineStore } =
            await import("@/services/offline/repository");
          const result = await updateOfflineStore(id, payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalStores", id },
        "LocalStores",
      ],
    }),

    deleteLocalStore: builder.mutation({
      async queryFn(id: string) {
        try {
          const { deleteOfflineStore } =
            await import("@/services/offline/repository");
          await deleteOfflineStore(id);
          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalStores", id },
        "LocalStores",
        "LocalInventory",
      ],
    }),

    // ============================================
    // 6. STAFF (unchanged)
    // ============================================
    getLocalStaff: builder.query({
      async queryFn({
        storeId,
        isActive,
      }: { storeId?: string; isActive?: boolean } = {}) {
        try {
          await refreshIfOnline(["staff"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(staff)
            .orderBy(desc(staff.createdAt))
            .$dynamic();

          if (isActive !== undefined) {
            query = query.where(eq(staff.isActive, isActive));
          }
          if (storeId) {
            query = query.where(eq(staff.storeId, storeId));
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalStaff"],
    }),

    getLocalStaffById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["staff"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(staff)
            .where(eq(staff.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalStaff", id }],
    }),

    createLocalStaff: builder.mutation({
      async queryFn(payload: any) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();
          const { createLocalId } = await import("@/services/offline/ids");

          const staffId = createLocalId("stf");

          await db.insert(staff).values({
            id: staffId,
            tenantId: payload.tenantId,
            storeId: payload.storeId,
            username: payload.username,
            email: payload.email,
            name: payload.name,
            role: payload.role || "CASHIER",
            permissions: payload.permissions || [],
            isActive: payload.isActive ?? true,
            syncStatus: "pending",
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: null,
          });

          const { enqueueMutations } = await import("@/services/offline/repository");
          await enqueueMutations([
            {
              entity: "staff",
              entityId: staffId,
              operation: "create",
              endpoint: "/api/tenant/staff/",
              method: "POST",
              payload,
            },
          ]);

          pushIfOnline();
          return { data: { id: staffId, ...payload } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalStaff"],
    }),

    updateLocalStaff: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & Record<string, any>) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();
          const [currentStaff] = await db
            .select({ remoteId: staff.remoteId })
            .from(staff)
            .where(eq(staff.id, id));
          const remoteStaffId = currentStaff?.remoteId || id;

          await db
            .update(staff)
            .set({
              ...payload,
              updatedAt: now,
              syncStatus: "pending",
            })
            .where(eq(staff.id, id));

          const { enqueueMutations } = await import("@/services/offline/repository");
          await enqueueMutations([
            {
              entity: "staff",
              entityId: id,
              operation: "update",
              endpoint: `/api/tenant/staff/${remoteStaffId}`,
              method: "PUT",
              payload,
            },
          ]);

          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalStaff", id },
        "LocalStaff",
      ],
    }),

    deleteLocalStaff: builder.mutation({
      async queryFn(id: string) {
        try {
          const db = getOfflineDb();
          const [currentStaff] = await db
            .select({ remoteId: staff.remoteId })
            .from(staff)
            .where(eq(staff.id, id));
          const remoteStaffId = currentStaff?.remoteId || id;
          await db
            .update(staff)
            .set({
              isActive: false,
              syncStatus: "pending",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(staff.id, id));
          const { enqueueMutations } = await import("@/services/offline/repository");
          await enqueueMutations([
            {
              entity: "staff",
              entityId: id,
              operation: "delete",
              endpoint: `/api/tenant/staff/${remoteStaffId}`,
              method: "DELETE",
              payload: {},
            },
          ]);
          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalStaff", id },
        "LocalStaff",
      ],
    }),

    // ============================================
    // 7. SUPPLIERS (unchanged)
    // ============================================
    getLocalSuppliers: builder.query({
      async queryFn({
        storeId,
        isActive,
      }: { storeId?: string; isActive?: boolean } = {}) {
        try {
          await refreshIfOnline(["suppliers"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(suppliers)
            .orderBy(desc(suppliers.createdAt))
            .$dynamic();

          if (isActive !== undefined) {
            query = query.where(eq(suppliers.isActive, isActive));
          }
          if (storeId) {
            query = query.where(eq(suppliers.storeId, storeId));
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalSuppliers"],
    }),

    getLocalSupplierById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["suppliers"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(suppliers)
            .where(eq(suppliers.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalSuppliers", id }],
    }),

    createLocalSupplier: builder.mutation({
      async queryFn(payload: any) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();
          const { createLocalId } = await import("@/services/offline/ids");

          const supplierId = createLocalId("sup");

          await db.insert(suppliers).values({
            id: supplierId,
            tenantId: payload.tenantId,
            storeId: payload.storeId,
            code: payload.code,
            name: payload.name,
            contactName: payload.contactName,
            phone: payload.phone,
            email: payload.email,
            address: payload.address,
            taxNumber: payload.taxNumber ?? payload.taxId,
            paymentTerms: payload.paymentTerms,
            creditLimit: payload.creditLimit,
            currentBalance: payload.currentBalance || 0,
            isActive: payload.isActive ?? true,
            syncStatus: "pending",
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: null,
          });

          const { enqueueMutations } = await import("@/services/offline/repository");
          await enqueueMutations([
            {
              entity: "suppliers",
              entityId: supplierId,
              operation: "create",
              endpoint: "/api/tenant/suppliers/",
              method: "POST",
              payload,
            },
          ]);

          pushIfOnline();
          return { data: { id: supplierId, ...payload } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalSuppliers"],
    }),

    updateLocalSupplier: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & Record<string, any>) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();
          const { taxId, ...supplierPayload } = payload;

          await db
            .update(suppliers)
            .set({
              ...supplierPayload,
              ...(taxId !== undefined ? { taxNumber: taxId } : {}),
              updatedAt: now,
              syncStatus: "pending",
            })
            .where(eq(suppliers.id, id));

          const { enqueueMutations } = await import("@/services/offline/repository");
          await enqueueMutations([
            {
              entity: "suppliers",
              entityId: id,
              operation: "update",
              endpoint: `/api/tenant/suppliers/${id}`,
              method: "PUT",
              payload: { ...supplierPayload, ...(taxId !== undefined ? { taxId } : {}) },
            },
          ]);

          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalSuppliers", id },
        "LocalSuppliers",
      ],
    }),

    deleteLocalSupplier: builder.mutation({
      async queryFn(id: string) {
        try {
          const db = getOfflineDb();
          await db
            .update(suppliers)
            .set({
              isActive: false,
              syncStatus: "pending",
              updatedAt: new Date().toISOString(),
            })
            .where(eq(suppliers.id, id));
          const { enqueueMutations } = await import("@/services/offline/repository");
          await enqueueMutations([
            {
              entity: "suppliers",
              entityId: id,
              operation: "delete",
              endpoint: `/api/tenant/suppliers/${id}`,
              method: "DELETE",
              payload: {},
            },
          ]);
          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalSuppliers", id },
        "LocalSuppliers",
      ],
    }),

    // ============================================
    // 8. SESSIONS (unchanged)
    // ============================================
    getLocalSessions: builder.query({
      async queryFn({
        storeId,
        status,
        userId,
      }: {
        storeId?: string;
        status?: string;
        userId?: string;
      } = {}) {
        try {
          await refreshIfOnline(["sessions"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(sessions)
            .orderBy(desc(sessions.createdAt))
            .$dynamic();

          if (storeId) {
            query = query.where(eq(sessions.storeId, storeId));
          }
          if (status) {
            query = query.where(eq(sessions.status, status));
          }
          if (userId) {
            query = query.where(eq(sessions.userId, userId));
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalSessions"],
    }),

    getLocalSessionById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["sessions"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(sessions)
            .where(eq(sessions.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalSessions", id }],
    }),

    // getActiveSession: builder.query({
    //   async queryFn({ userId, storeId }: { userId: string; storeId?: string }) {
    //     try {
    //       await refreshIfOnline(["sessions"]);
    //       const db = getOfflineDb();
    //       let query = db
    //         .select()
    //         .from(sessions)
    //         .where(
    //           and(eq(sessions.userId, userId), eq(sessions.status, "OPEN")),
    //         )
    //         .$dynamic();

    //       if (storeId) {
    //         query = query.where(eq(sessions.storeId, storeId));
    //       }

    //       const [result] = await query;
    //       return { data: result };
    //     } catch (error) {
    //       return { error: { message: (error as Error).message } };
    //     }
    //   },
    //   providesTags: ["LocalSessions"],
    // }),

    getActiveSession: builder.query({
      async queryFn({ userId, storeId }: { userId: string; storeId?: string }) {
        try {
          await refreshIfOnline(["sessions"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(sessions)
            .where(
              and(eq(sessions.userId, userId), eq(sessions.status, "OPEN")),
            )
            .$dynamic();

          if (storeId) {
            query = query.where(eq(sessions.storeId, storeId));
          }

          const [result] = await query;

          // result က undefined ဖြစ်နေရင် null ကို အစားထိုးပြန်ပေးပါမယ်
          return { data: result ?? null };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalSessions"],
    }),

    openLocalSession: builder.mutation({
      async queryFn(payload: any) {
        try {
          const { openOfflineSession } =
            await import("@/services/offline/repository");
          const result = await openOfflineSession(payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalSessions"],
    }),

    closeLocalSession: builder.mutation({
      async queryFn({ id, ...payload }: { id: string } & CloseSessionPayload) {
        try {
          const { closeOfflineSession } =
            await import("@/services/offline/repository");
          const result = await closeOfflineSession(id, payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalSessions", id },
        "LocalSessions",
      ],
    }),

    // ============================================
    // 9. ORDERS (unchanged)
    // ============================================
    getLocalOrders: builder.query({
      async queryFn({
        storeId,
        status,
        sessionId,
        customerId,
        search,
        includeItems,
        page,
        limit,
      }: {
        storeId?: string;
        status?: string;
        sessionId?: string;
        customerId?: string;
        search?: string;
        includeItems?: boolean;
        page?: number;
        limit?: number;
      } = {}) {
        try {
          await refreshIfOnline(["orders"]);
          const db = getOfflineDb();
          const conditions = [] as any[];

          if (storeId) conditions.push(eq(orders.storeId, storeId));
          if (status) conditions.push(eq(orders.status, status));
          if (sessionId) conditions.push(eq(orders.sessionId, sessionId));
          if (customerId) conditions.push(eq(orders.customerId, customerId));

          const normalizedSearch = search?.trim().toLowerCase();
          if (normalizedSearch) {
            const pattern = `%${normalizedSearch}%`;
            conditions.push(sql`
              (
                lower(coalesce(${orders.id}, '')) LIKE ${pattern}
                OR lower(coalesce(${orders.remoteId}, '')) LIKE ${pattern}
                OR lower(coalesce(${orders.orderNumber}, '')) LIKE ${pattern}
                OR lower(coalesce(${orders.status}, '')) LIKE ${pattern}
                OR lower(coalesce(${orders.paymentMethod}, '')) LIKE ${pattern}
                OR EXISTS (
                  SELECT 1 FROM order_items oi
                  WHERE oi.order_id = ${orders.id}
                    AND lower(coalesce(oi.product_name, '')) LIKE ${pattern}
                )
                OR EXISTS (
                  SELECT 1 FROM customers c
                  WHERE c.id = ${orders.customerId}
                    AND (
                      lower(coalesce(c.name, '')) LIKE ${pattern}
                      OR lower(coalesce(c.phone, '')) LIKE ${pattern}
                      OR lower(coalesce(c.email, '')) LIKE ${pattern}
                    )
                )
              )
            `);
          }

          let query = db
            .select()
            .from(orders)
            .where(conditions.length ? and(...conditions) : undefined)
            .orderBy(desc(orders.createdAt))
            .$dynamic();

          if (page && limit) {
            query = query.limit(limit).offset((page - 1) * limit);
          }

          const result = await query;
          if (!includeItems) return { data: result };

          const ordersWithItems = await Promise.all(
            result.map(async (order: any) => ({
              ...order,
              items: await hydrateOrderItems(
                db,
                await db
                  .select()
                  .from(orderItems)
                  .where(eq(orderItems.orderId, order.id)),
              ),
            })),
          );
          return { data: ordersWithItems };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalOrders"],
    }),

    getLocalOrderById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["orders"]);
          const db = getOfflineDb();
          const [order] = await db
            .select()
            .from(orders)
            .where(eq(orders.id, id));

          if (!order) {
            return { data: null };
          }

          const items = await db
            .select()
            .from(orderItems)
            .where(eq(orderItems.orderId, id));

          return { data: { ...order, items: await hydrateOrderItems(db, items) } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalOrders", id }],
    }),

    createLocalOrder: builder.mutation({
      async queryFn(payload: any) {
        try {
          const { createOfflineOrder } =
            await import("@/services/offline/repository");
          const result = await createOfflineOrder(payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          console.error("❌ createLocalOrder failed:", (error as Error).message);
          console.error("❌ Full error:", error);
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalOrders", "LocalInventory", "LocalCustomers"],
    }),

    updateLocalOrderStatus: builder.mutation({
      async queryFn({ id, status }: { id: string; status: string }) {
        try {
          const { updateOfflineOrderStatus } =
            await import("@/services/offline/repository");
          const result = await updateOfflineOrderStatus(id, status);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, { id }) => [
        { type: "LocalOrders", id },
        "LocalOrders",
      ],
    }),

    deleteLocalOrder: builder.mutation({
      async queryFn(id: string) {
        try {
          const { deleteOfflineOrder } =
            await import("@/services/offline/repository");
          await deleteOfflineOrder(id);
          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: (result, error, id) => [
        { type: "LocalOrders", id },
        "LocalOrders",
        "LocalInventory",
      ],
    }),

    // ============================================
    // 10. INVENTORY (unchanged)
    // ============================================
    getLocalInventory: builder.query({
      async queryFn({
        storeId,
        productId,
        variantId,
      }: {
        storeId?: string;
        productId?: string;
        variantId?: string;
      } = {}) {
        try {
          // Stores must be refreshed first because inventory rows are stored
          // with the local store key, while the auth/session may hold the
          // server store key.
          await refreshIfOnline(["stores", "inventory", "products"]);
          const db = getOfflineDb();
          let query = db.select().from(inventory).$dynamic();
          const conditions = [];

          if (storeId) {
            const [localStore] = await db
              .select({ id: stores.id })
              .from(stores)
              .where(or(eq(stores.id, storeId), eq(stores.remoteId, storeId)))
              .limit(1);
            conditions.push(eq(inventory.storeId, localStore?.id ?? storeId));
          }
          if (productId) {
            conditions.push(eq(inventory.productId, productId));
          }
          if (variantId) {
            conditions.push(eq(inventory.variantId, variantId));
          }
          if (conditions.length) {
            query = query.where(and(...conditions));
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalInventory"],
    }),

    getLocalInventoryByProduct: builder.query({
      async queryFn({
        productId,
        storeId,
      }: {
        productId: string;
        storeId?: string;
      }) {
        try {
          await refreshIfOnline(["inventory"]);
          const db = getOfflineDb();
          let query = db.select().from(inventory).$dynamic();
          const conditions = [eq(inventory.productId, productId)];

          if (storeId) {
            conditions.push(eq(inventory.storeId, storeId));
          }
          query = query.where(and(...conditions));

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalInventory"],
    }),

    getLocalInventoryByVariant: builder.query({
      async queryFn({
        variantId,
        storeId,
      }: {
        variantId: string;
        storeId?: string;
      }) {
        try {
          await refreshIfOnline(["inventory"]);
          const db = getOfflineDb();
          let query = db.select().from(inventory).$dynamic();
          const conditions = [eq(inventory.variantId, variantId)];

          if (storeId) {
            conditions.push(eq(inventory.storeId, storeId));
          }
          query = query.where(and(...conditions));

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalInventory"],
    }),

    getLocalInventoryItem: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["inventory"]);
          const db = getOfflineDb();
          const [result] = await db
            .select()
            .from(inventory)
            .where(eq(inventory.id, id));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [{ type: "LocalInventory", id }],
    }),

    // ============================================
    // 11. INVENTORY MOVEMENTS (unchanged)
    // ============================================
    getLocalInventoryMovements: builder.query({
      async queryFn({
        storeId,
        type,
        productId,
        variantId,
        page,
        limit,
      }: {
        storeId?: string;
        type?: string;
        productId?: string;
        variantId?: string;
        page?: number;
        limit?: number;
      } = {}) {
        try {
          await refreshIfOnline(["inventoryMovements"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(inventoryMovements)
            .orderBy(desc(inventoryMovements.createdAt))
            .$dynamic();

          if (storeId) {
            const [localStore] = await db
              .select({ id: stores.id })
              .from(stores)
              .where(or(eq(stores.id, storeId), eq(stores.remoteId, storeId)))
              .limit(1);
            query = query.where(
              eq(inventoryMovements.storeId, localStore?.id ?? storeId),
            );
          }
          if (type) {
            query = query.where(eq(inventoryMovements.type, type));
          }
          if (productId) {
            query = query.where(eq(inventoryMovements.productId, productId));
          }
          if (variantId) {
            query = query.where(eq(inventoryMovements.variantId, variantId));
          }

          if (page && limit) {
            query = query.limit(limit).offset((page - 1) * limit);
          }

          const rawResult = await query;
          const seen = new Set<string>();
          const deduplicated: typeof rawResult = [];

          for (const item of rawResult) {
            const primaryKey = item.remoteId || item.id;
            const refKey = item.referenceId
              ? `${item.referenceId}_${item.type}_${item.storeId}_${item.productId}_${item.variantId || "base"}`
              : primaryKey;

            if (!seen.has(primaryKey) && !seen.has(refKey)) {
              seen.add(primaryKey);
              seen.add(refKey);
              deduplicated.push(item);
            }
          }

          return { data: deduplicated };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalInventoryMovements"],
    }),

    createLocalInventoryMovement: builder.mutation({
      async queryFn(payload: any) {
        try {
          const { createOfflineInventoryMovement } =
            await import("@/services/offline/repository");
          const result = await createOfflineInventoryMovement(payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: [
        "LocalInventoryMovements",
        "LocalInventory",
        "LocalProducts",
      ],
    }),

    adjustLocalStock: builder.mutation({
      async queryFn(payload: {
        productId: string;
        storeId: string;
        variantId?: string;
        newQuantity: number;
        reason?: string;
        tenantId?: string;
      }) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();

          let query = db
            .select()
            .from(inventory)
            .where(
              and(
                eq(inventory.productId, payload.productId),
                eq(inventory.storeId, payload.storeId),
              ),
            )
            .$dynamic();

          if (payload.variantId) {
            query = query.where(
              and(
                eq(inventory.variantId, payload.variantId),
                eq(inventory.productId, payload.productId),
                eq(inventory.storeId, payload.storeId),
              ),
            );
          } else {
            query = query.where(
              and(
                sql`${inventory.variantId} IS NULL`,
                eq(inventory.productId, payload.productId),
                eq(inventory.storeId, payload.storeId),
              ),
            );
          }

          const [existingInventory] = await query;

          if (!existingInventory) {
            return {
              error: {
                message: `Inventory not found for product ${payload.productId} in store ${payload.storeId}`,
              },
            };
          }

          const currentQuantity = existingInventory.quantity;
          const diff = payload.newQuantity - currentQuantity;

          if (diff === 0) {
            return {
              data: {
                ...existingInventory,
                message: "No change in quantity",
              },
            };
          }

          await db
            .update(inventory)
            .set({
              quantity: payload.newQuantity,
              updatedAt: now,
              syncStatus: "pending",
              version: (existingInventory.version || 0) + 1,
            })
            .where(eq(inventory.id, existingInventory.id));

          const { createLocalId } = await import("@/services/offline/ids");
          const movementId = createLocalId("mov");
          const movementType = diff > 0 ? "IN" : "OUT";
          const movementQuantity = Math.abs(diff);
          const adjustmentReferenceId = `adj-${movementId}`;

          await db.insert(inventoryMovements).values({
            id: movementId,
            tenantId: payload.tenantId || existingInventory.tenantId,
            storeId: payload.storeId,
            productId: payload.productId,
            variantId: payload.variantId || null,
            quantity: movementQuantity,
            type: movementType,
            referenceId: adjustmentReferenceId,
            referenceType: "STOCK_ADJUSTMENT",
            reason:
              payload.reason ??
              `Stock adjusted from ${currentQuantity} to ${payload.newQuantity}`,
            syncStatus: "pending",
            createdAt: now,
            updatedAt: now,
            lastSyncedAt: null,
          });

          const [updatedInventory] = await db
            .select()
            .from(inventory)
            .where(eq(inventory.id, existingInventory.id));

          await db.insert(syncOutbox).values({
            id: createLocalId("outbox"),
            entity: "inventory_movements",
            entityId: movementId,
            operation: "create",
            endpoint: "/api/tenant/inventory/movements",
            method: "POST",
            payload: {
              clientMovementId: movementId,
              storeId: payload.storeId,
              productId: payload.productId,
              ...(payload.variantId ? { variantId: payload.variantId } : {}),
              quantity: movementQuantity,
              direction: movementType,
              type: movementType,
              referenceId: adjustmentReferenceId,
              referenceType: "STOCK_ADJUSTMENT",
              reason:
                payload.reason ??
                `Stock adjusted from ${currentQuantity} to ${payload.newQuantity}`,
            },
            status: "pending",
            attempts: 0,
            nextAttemptAt: now,
            lastError: null,
            createdAt: now,
            updatedAt: now,
          });

          pushIfOnline();

          return {
            data: updatedInventory,
          };
        } catch (error) {
          console.error("❌ Adjust stock failed:", error);
          return {
            error: {
              message:
                error instanceof Error
                  ? error.message
                  : "Failed to adjust stock",
            },
          };
        }
      },
      invalidatesTags: [
        "LocalInventory",
        "LocalInventoryMovements",
        "LocalProducts",
      ],
    }),

    // ============================================
    // 12. INVENTORY COUNTS (unchanged)
    // ============================================
    getLocalInventoryCounts: builder.query({
      async queryFn({
        storeId,
        status,
        page,
        limit,
      }: {
        storeId?: string;
        status?: string;
        page?: number;
        limit?: number;
      } = {}) {
        try {
          await refreshIfOnline(["inventory"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(inventoryCounts)
            .orderBy(desc(inventoryCounts.createdAt))
            .$dynamic();

          if (storeId) {
            query = query.where(eq(inventoryCounts.storeId, storeId));
          }
          if (status) {
            query = query.where(eq(inventoryCounts.status, status));
          }

          if (page && limit) {
            query = query.limit(limit).offset((page - 1) * limit);
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalInventoryCounts"],
    }),

    getLocalInventoryCountById: builder.query({
      async queryFn(id: string) {
        try {
          await refreshIfOnline(["inventory"]);
          const db = getOfflineDb();
          const [count] = await db
            .select()
            .from(inventoryCounts)
            .where(eq(inventoryCounts.id, id));

          if (!count) {
            return { data: null };
          }

          const items = await db
            .select()
            .from(inventoryCountItems)
            .where(eq(inventoryCountItems.countId, id));

          return { data: { ...count, items } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: (result, error, id) => [
        { type: "LocalInventoryCounts", id },
      ],
    }),

    createLocalInventoryCount: builder.mutation({
      async queryFn(payload: any) {
        try {
          const { createOfflineInventoryCount } =
            await import("@/services/offline/repository");
          const result = await createOfflineInventoryCount(payload);
          pushIfOnline();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: [
        "LocalInventoryCounts",
        "LocalInventory",
        "LocalProducts",
      ],
    }),

    // ============================================
    // 13. PRICE HISTORY (unchanged)
    // ============================================
    getLocalPriceHistory: builder.query({
      async queryFn({
        productId,
        variantId,
        limit,
      }: {
        productId?: string;
        variantId?: string;
        limit?: number;
      } = {}) {
        try {
          await refreshIfOnline(["priceHistory"]);
          const db = getOfflineDb();
          let query = db
            .select()
            .from(priceHistory)
            .orderBy(desc(priceHistory.createdAt))
            .$dynamic();

          if (productId) {
            query = query.where(eq(priceHistory.productId, productId));
          }
          if (variantId) {
            query = query.where(eq(priceHistory.variantId, variantId));
          }

          if (limit) {
            query = query.limit(limit);
          }

          const result = await query;
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalPriceHistory"],
    }),

    createLocalPriceHistory: builder.mutation({
      async queryFn(payload: any) {
        try {
          const db = getOfflineDb();
          const now = new Date().toISOString();
          const { createLocalId } = await import("@/services/offline/ids");

          await db.insert(priceHistory).values({
            id: createLocalId("ph"),
            tenantId: payload.tenantId,
            productId: payload.productId,
            variantId: payload.variantId,
            oldPrice: payload.oldPrice,
            newPrice: payload.newPrice,
            changedBy: payload.changedBy,
            reason: payload.reason,
            syncStatus: "pending",
            createdAt: now,
            updatedAt: now,
          });

          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: [
        "LocalPriceHistory",
        "LocalProducts",
        "LocalProductVariants",
      ],
    }),

    // ============================================
    // 14. SYNC OUTBOX STATUS (unchanged)
    // ============================================
    getPendingSyncItems: builder.query({
      async queryFn() {
        try {
          const db = getOfflineDb();
          const result = await db
            .select()
            .from(syncOutbox)
            .where(eq(syncOutbox.status, "pending"))
            .orderBy(syncOutbox.createdAt);
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalSyncOutbox"],
    }),

    getFailedSyncItems: builder.query({
      async queryFn() {
        try {
          const db = getOfflineDb();
          const result = await db
            .select()
            .from(syncOutbox)
            .where(eq(syncOutbox.status, "failed"))
            .orderBy(desc(syncOutbox.updatedAt));
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalSyncOutbox"],
    }),

    getSyncQueueSummary: builder.query({
      async queryFn() {
        try {
          const { getSyncQueueSummary } =
            await import("@/services/offline/repository");
          const result = await getSyncQueueSummary();
          return { data: result };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      providesTags: ["LocalSyncOutbox"],
    }),

    retryFailedSyncItems: builder.mutation({
      async queryFn(itemIds?: string[]) {
        try {
          const { retryAllFailedOutboxItems, retryOutboxItem } =
            await import("@/services/offline/repository");

          if (itemIds && itemIds.length > 0) {
            for (const id of itemIds) {
              await retryOutboxItem(id);
            }
          } else {
            await retryAllFailedOutboxItems();
          }

          pushIfOnline();
          return { data: { success: true } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalSyncOutbox"],
    }),

    clearSyncedOutboxItems: builder.mutation({
      async queryFn() {
        try {
          const { clearSyncedOutboxItems } =
            await import("@/services/offline/repository");
          const count = await clearSyncedOutboxItems();
          pushIfOnline();
          return { data: { cleared: count } };
        } catch (error) {
          return { error: { message: (error as Error).message } };
        }
      },
      invalidatesTags: ["LocalSyncOutbox"],
    }),
  }),
});

// ============================================
// HOOKS EXPORTS
// ============================================
export const {
  // Brands
  useGetLocalBrandsQuery,
  useGetLocalBrandByIdQuery,
  useCreateLocalBrandMutation,
  useUpdateLocalBrandMutation,
  useDeleteLocalBrandMutation,

  // Store settings
  useGetLocalStoreSettingsQuery,
  useSaveLocalStoreSettingMutation,

  // Products
  useGetLocalProductsQuery,
  useGetLocalProductByIdQuery,
  useGetLocalProductByBarcodeQuery,
  useGetLocalProductBySkuQuery,
  useCreateLocalProductMutation,
  useUpdateLocalProductMutation,
  useDeleteLocalProductMutation,

  // Product Variants
  useGetLocalVariantsQuery,
  useGetLocalVariantByIdQuery,
  useGetLocalVariantByBarcodeQuery,
  useCreateLocalVariantMutation,
  useUpdateLocalVariantMutation,
  useDeleteLocalVariantMutation,

  // Categories
  useGetLocalCategoriesQuery,
  useGetLocalCategoryByIdQuery,
  useCreateLocalCategoryMutation,
  useUpdateLocalCategoryMutation,
  useDeleteLocalCategoryMutation,

  // Customers
  useGetLocalCustomersQuery,
  useGetLocalCustomerByIdQuery,
  useGetLocalCustomerByPhoneQuery,
  useCreateLocalCustomerMutation,
  useUpdateLocalCustomerMutation,
  useDeleteLocalCustomerMutation,

  // Stores
  useGetLocalStoresQuery,
  useGetLocalStoreByIdQuery,
  useCreateLocalStoreMutation,
  useUpdateLocalStoreMutation,
  useDeleteLocalStoreMutation,

  // Staff
  useGetLocalStaffQuery,
  useGetLocalStaffByIdQuery,
  useCreateLocalStaffMutation,
  useUpdateLocalStaffMutation,
  useDeleteLocalStaffMutation,

  // Suppliers
  useGetLocalSuppliersQuery,
  useGetLocalSupplierByIdQuery,
  useCreateLocalSupplierMutation,
  useUpdateLocalSupplierMutation,
  useDeleteLocalSupplierMutation,

  // Sessions
  useGetLocalSessionsQuery,
  useGetLocalSessionByIdQuery,
  useGetActiveSessionQuery,
  useOpenLocalSessionMutation,
  useCloseLocalSessionMutation,

  // Orders
  useGetLocalOrdersQuery,
  useGetLocalOrderByIdQuery,
  useCreateLocalOrderMutation,
  useUpdateLocalOrderStatusMutation,
  useDeleteLocalOrderMutation,

  // Inventory
  useGetLocalInventoryQuery,
  useGetLocalInventoryByProductQuery,
  useGetLocalInventoryByVariantQuery,
  useGetLocalInventoryItemQuery,

  // Inventory Movements
  useGetLocalInventoryMovementsQuery,
  useCreateLocalInventoryMovementMutation,

  // Adjust Local Stock
  useAdjustLocalStockMutation,

  // Inventory Counts
  useGetLocalInventoryCountsQuery,
  useGetLocalInventoryCountByIdQuery,
  useCreateLocalInventoryCountMutation,

  // Price History
  useGetLocalPriceHistoryQuery,
  useCreateLocalPriceHistoryMutation,

  // Sync Outbox
  useGetPendingSyncItemsQuery,
  useGetFailedSyncItemsQuery,
  useGetSyncQueueSummaryQuery,
  useRetryFailedSyncItemsMutation,
  useClearSyncedOutboxItemsMutation,
} = localApi;
