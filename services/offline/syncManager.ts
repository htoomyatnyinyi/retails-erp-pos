import { useAppDispatch } from "@/hooks/redux-hooks/useAppDispatch";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import { POS_API_URL, remoteApi } from "@/services/api/remoteApi";
import { localApi } from "@/services/features/offline/localApi";
import {
  incrementFailedCount,
  incrementSyncedCount,
  resetSync,
  setFailedCount,
  setInitialized,
  setOnline,
  setQueuedCount,
  setSyncComplete,
  setSyncDuration,
  setSyncError,
  setSyncPhase,
  setSyncing,
  setSyncProgress,
} from "@/services/features/offline/offlineSlice";
import type { AppDispatch, RootState } from "@/services/store/store";
import { store } from "@/services/store/store";
import { and, eq, inArray, sql } from "drizzle-orm";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { useCallback, useEffect, useState } from "react";
import { getOfflineDb, runMigrations } from "./db";
import { createLocalId } from "./ids";
import { isOnline, subscribeToOnlineStatus } from "./network";
import {
  getDueOutboxItems,
  getFailedOutboxItems,
  getQueuedCount,
  getSyncStatus,
  markEntitySynced,
  markOutboxFailed,
  markOutboxSynced,
  retryOutboxItem,
  upsertBrands,
  upsertCategories,
  upsertCustomers,
  upsertInventory,
  upsertInventoryMovements,
  upsertPriceHistory,
  upsertProducts,
  upsertProductVariants,
  upsertSessions,
  upsertStores,
  upsertStaff,
  upsertSuppliers,
  upsertOrders,
} from "./repository";

import {
  brands,
  categories,
  customers,
  inventory,
  inventoryCounts,
  inventoryMovements,
  orders,
  priceHistory,
  products,
  productVariants,
  sessions,
  staff,
  stores,
  suppliers,
  syncOutbox,
} from "./schema";

// ============================================
// GLOBAL STATE
// ============================================

let syncInFlight = false;
let unsubscribeNetwork: (() => void) | undefined;
let syncInterval: NodeJS.Timeout | undefined;
let syncStartTime: number = 0;
let lastSyncTime: number = 0;
const MIN_SYNC_INTERVAL = 30000; // 30 seconds
let debounceTimeout: NodeJS.Timeout | undefined;

// ============================================
// 1. INITIALIZATION (FIXED)
// ============================================

export async function initializeOfflineSystem(
  dispatch: AppDispatch,
  getState: () => RootState,
) {
  try {
    await runMigrations();
    dispatch(setInitialized(true));

    const count = await getQueuedCount();
    dispatch(setQueuedCount(count));

    const failedCount = await getFailedCount();
    dispatch(setFailedCount(failedCount));

    const online = await isOnline();
    dispatch(setOnline(online));

    unsubscribeNetwork?.();
    unsubscribeNetwork = subscribeToOnlineStatus((nextOnline) => {
      dispatch(setOnline(nextOnline));
      if (nextOnline) {
        // Debounce: avoid multiple syncs on rapid network changes
        if (debounceTimeout) clearTimeout(debounceTimeout);
        debounceTimeout = setTimeout(() => {
          void syncNow(dispatch, getState);
        }, 2000);
      }
    });

    if (online) {
      await syncNow(dispatch, getState);
    }

    // ✅ Fix: Use the global syncInterval – do NOT redeclare it
    if (syncInterval) {
      clearInterval(syncInterval);
    }

    syncInterval = setInterval(
      () => {
        void syncNow(dispatch, getState);
      },
      5 * 60 * 1000,
    );

    console.log("✅ Offline system initialized");
  } catch (error) {
    console.error("❌ Failed to initialize offline system:", error);
    dispatch(setSyncError("Failed to initialize offline system"));
  }
}

// ============================================
// 2. SYNC NOW
// ============================================

export async function syncNow(
  dispatch: AppDispatch,
  getState: () => RootState,
  options: {
    force?: boolean;
    maxItems?: number;
    silent?: boolean;
  } = {},
) {
  const { force = false, maxItems = 50, silent = false } = options;

  // Cooldown (skip if not forced)
  const now = Date.now();
  if (!force && now - lastSyncTime < MIN_SYNC_INTERVAL) {
    if (!silent) console.log("⏳ Sync cooldown, skipping...");
    return { skipped: true, message: "Cooldown active" };
  }

  // A forced/manual sync must not overlap an automatic sync. Overlapping
  // pulls and pushes can create duplicate outbox attempts and stale caches.
  if (syncInFlight) {
    if (!silent) console.log("⏳ Sync already in progress, skipping...");
    return { skipped: true, message: "Sync already in progress" };
  }

  const online = await isOnline();
  if (!online) {
    if (!silent) console.log("📶 Offline mode, skipping sync");
    return { skipped: true, message: "Offline mode" };
  }

  syncInFlight = true;
  syncStartTime = Date.now();
  lastSyncTime = now;

  dispatch(setSyncing(true));
  dispatch(setSyncError(null as any));
  dispatch(setSyncProgress(0));

  let syncedItems = 0;
  let failedItems = 0;

  try {
    if (!silent) console.log("🔄 Starting sync...");
    dispatch(setSyncProgress(5));

    const state = store.getState();
    const tenantId = state.auth?.user?.tenantId;
    if (!tenantId) {
      if (!silent)
        console.log("🔒 User not logged in (no tenantId). Skipping sync.");
      dispatch(setSyncing(false));
      return { skipped: true, message: "User not logged in" };
    }

    // --- PULL Stores ---
    dispatch(setSyncPhase("Pulling stores"));
    // if (!silent) console.log("📥 Pulling stores...");
    const storeResult = await pullStores(dispatch, tenantId);
    syncedItems += storeResult.synced;
    dispatch(setSyncProgress(10));
    // if (!silent) console.log(`✅ Synced ${storeResult.synced} stores`);

    // --- PULL Brands ---
    dispatch(setSyncPhase("Pulling brands"));
    // if (!silent) console.log("📥 Pulling brands...");
    const brandResult = await pullBrands(dispatch, tenantId);
    syncedItems += brandResult.synced;
    dispatch(setSyncProgress(15));
    // if (!silent) console.log(`✅ Synced ${brandResult.synced} brands`);

    // --- PULL Categories ---
    dispatch(setSyncPhase("Pulling categories"));
    // if (!silent) console.log("📥 Pulling categories...");
    const categoryResult = await pullCategories(dispatch, tenantId);
    syncedItems += categoryResult.synced;
    dispatch(setSyncProgress(20));
    // if (!silent) console.log(`✅ Synced ${categoryResult.synced} categories`);

    // --- PULL Customers ---
    dispatch(setSyncPhase("Pulling customers"));
    // if (!silent) console.log("📥 Pulling customers...");
    const customerResult = await pullCustomers(dispatch, tenantId);
    syncedItems += customerResult.synced;
    dispatch(setSyncProgress(25));
    // if (!silent) console.log(`✅ Synced ${customerResult.synced} customers`);

    // --- PULL Staff --- (NEW)
    dispatch(setSyncPhase("Pulling staff"));
    // if (!silent) console.log("📥 Pulling staff...");
    const staffResult = await pullStaff(dispatch, tenantId);
    syncedItems += staffResult.synced;
    dispatch(setSyncProgress(30));
    // if (!silent) console.log(`✅ Synced ${staffResult.synced} staff`);

    // --- PULL Suppliers --- (NEW)
    dispatch(setSyncPhase("Pulling suppliers"));
    // if (!silent) console.log("📥 Pulling suppliers...");
    const supplierResult = await pullSuppliers(dispatch, tenantId);
    syncedItems += supplierResult.synced;
    dispatch(setSyncProgress(33));
    // if (!silent) console.log(`✅ Synced ${supplierResult.synced} suppliers`);

    // --- PULL Products --- (includes variants)
    dispatch(setSyncPhase("Pulling products and variants"));
    // if (!silent) console.log("📥 Pulling products...");
    const productResult = await pullProducts(dispatch, tenantId);
    syncedItems += productResult.synced;
    dispatch(setSyncProgress(45));
    if (!silent)
      console.log(`✅ Synced ${productResult.synced} products (with variants)`);

    // --- PULL Inventory ---
    dispatch(setSyncPhase("Pulling inventory and movements"));
    // if (!silent) console.log("📥 Pulling inventory...");
    const inventoryResult = await pullInventory(dispatch, tenantId);
    syncedItems += inventoryResult.synced;
    const movementResult = await pullInventoryMovements(dispatch, tenantId);
    syncedItems += movementResult.synced;
    dispatch(setSyncProgress(55));
    if (!silent)
      console.log(`✅ Synced ${inventoryResult.synced} inventory items`);

    // --- PULL Sessions ---
    dispatch(setSyncPhase("Pulling sessions"));
    // if (!silent) console.log("📥 Pulling sessions...");
    const sessionResult = await pullSessions(dispatch, tenantId);
    syncedItems += sessionResult.synced;
    dispatch(setSyncProgress(65));
    if (!silent) console.log(`✅ Synced ${sessionResult.synced} sessions`);

    // --- PULL Orders --- //byme
    dispatch(setSyncPhase("Pulling orders"));
    const orderResult = await pullOrders(dispatch, tenantId);
    syncedItems += orderResult.synced;
    dispatch(setSyncProgress(70));
    if (!silent) console.log(`✅ Synced ${orderResult.synced} orders`);

    // --- PULL Price History ---
    dispatch(setSyncPhase("Pulling price history"));
    // if (!silent) console.log("📥 Pulling price history...");
    const priceHistoryResult = await pullPriceHistory(dispatch, tenantId);
    syncedItems += priceHistoryResult.synced;
    dispatch(setSyncProgress(70));
    if (!silent)
      console.log(`✅ Synced ${priceHistoryResult.synced} price history items`);

    // --- PUSH Outbox ---
    dispatch(setSyncPhase("Pushing pending changes"));
    if (!silent) console.log("📤 Pushing outbox items...");
    const pushResult = await pushOutboxItems(dispatch, maxItems);
    syncedItems += pushResult.synced;
    failedItems += pushResult.failed;
    dispatch(setSyncProgress(85));
    if (!silent)
      console.log(
        `✅ Pushed ${pushResult.synced} items, ${pushResult.failed} failed`,
      );

    // A second full pull used to happen on every cycle. That doubled the
    // network/database work even when the outbox was empty. Refresh only the
    // entities affected by local writes; the next normal cycle handles the
    // remaining server-side changes.
    if (pushResult.synced > 0) {
      dispatch(setSyncPhase("Refreshing changed data"));
      const refreshed = await Promise.all([
        pullProducts(dispatch, tenantId),
        pullInventory(dispatch, tenantId),
        pullInventoryMovements(dispatch, tenantId),
        pullSessions(dispatch, tenantId),
        pullOrders(dispatch, tenantId),
      ]);
      syncedItems += refreshed.reduce(
        (total, result) => total + result.synced,
        0,
      );
    }
    dispatch(setSyncProgress(95));

    const remainingCount = await getQueuedCount();
    dispatch(setQueuedCount(remainingCount));

    const totalFailed = await getFailedCount();
    dispatch(setFailedCount(totalFailed));

    store.dispatch(
      localApi.util.invalidateTags([
        "LocalProducts",
        "LocalProductVariants",
        "LocalInventory",
        "LocalCategories",
        "LocalCustomers",
        "LocalStores",
        "LocalBrands",
        "LocalStaff",
        "LocalSuppliers",
        "LocalSessions",
        "LocalOrders",
        "LocalInventoryMovements",
        "LocalPriceHistory",
        "LocalSyncOutbox",
      ]),
    );

    const duration = Date.now() - syncStartTime;
    dispatch(setSyncDuration(duration));
    dispatch(incrementSyncedCount(syncedItems));

    if (failedItems > 0) {
      dispatch(incrementFailedCount(failedItems));
      dispatch(
        setSyncError(
          `Sync completed with ${failedItems} failed items. Please check and retry.`,
        ),
      );
      if (!silent) console.warn(`⚠️ ${failedItems} items failed to sync`);
    } else {
      dispatch(setSyncComplete());
      if (!silent) console.log("✅ Sync completed successfully");
    }

    console.log("=========== END ============");
    dispatch(setSyncProgress(100));

    return {
      success: true,
      synced: syncedItems,
      failed: failedItems,
      remaining: remainingCount,
      duration,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Offline sync failed";
    dispatch(setSyncError(message));
    console.error("❌ Sync error:", error);
    return { success: false, error: message };
  } finally {
    syncInFlight = false;
    dispatch(setSyncing(false));
  }
}

// ============================================
// PULL FUNCTIONS
// ============================================

function extractCollection(value: unknown, preferredKeys: string[]): any[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];

  const record = value as Record<string, unknown>;
  for (const key of preferredKeys) {
    const result = extractCollection(record[key], preferredKeys);
    if (result.length) return result;
  }

  for (const child of Object.values(record)) {
    const result = extractCollection(child, preferredKeys);
    if (result.length) return result;
  }
  return [];
}

const syncCursorKey = (tenantId: string, entity: string) =>
  `offline-sync-cursor:${tenantId}:${entity}`;

async function readSyncCursor(tenantId: string, entity: string) {
  const value = await AsyncStorage.getItem(syncCursorKey(tenantId, entity));
  const cursor = Number(value ?? 0);
  return Number.isFinite(cursor) ? Math.max(0, cursor) : 0;
}

async function saveSyncCursor(tenantId: string, entity: string, rows: any[]) {
  const timestamps = rows
    .map((row) =>
      Number(
        row.lastModified ??
          new Date(
            row.updatedAt ??
              row.updated_at ??
              row.createdAt ??
              row.created_at ??
              0,
          ).getTime(),
      ),
    )
    .filter((value) => Number.isFinite(value) && value > 0);
  if (timestamps.length) {
    await AsyncStorage.setItem(
      syncCursorKey(tenantId, entity),
      String(Math.max(...timestamps)),
    );
  }
}

async function readIncrementalRows(
  entity: string,
  endpoint: string,
  tenantId: string,
  keys: string[],
) {
  const cursor = await readSyncCursor(tenantId, entity);
  // A zero cursor means this device has never completed an initial pull.
  // Incremental endpoints commonly return only changed rows for this value
  // (and may legitimately return an empty array), which used to make stock
  // disappear until a later sync happened to return a change. Let callers
  // fall back to their paginated full pull on first use.
  if (cursor <= 0) return null;
  const result = await store.dispatch(
    (remoteApi.endpoints as any)[endpoint].initiate(
      { since: cursor > 0 ? cursor - 1 : 0 },
      { forceRefetch: true },
    ),
  );
  if (result.error) return null;
  return extractCollection(result.data, keys);
}

async function pullBrands(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping brand pull");
      return { synced: 0 };
    }
    if (!remoteApi.endpoints.getRemoteBrands) {
      console.warn("⚠️ getRemoteBrands endpoint not available");
      return { synced: 0 };
    }
    const { data, error } = await store.dispatch(
      remoteApi.endpoints.getRemoteBrands.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    if (error) {
      if (error.originalStatus === 404 || error.status === "PARSING_ERROR")
        return { synced: 0 };
      console.error("❌ Brand pull failed:", error);
      return { synced: 0 };
    }
    const brandsData = data?.brands || data?.data || data || [];
    if (brandsData.length > 0) {
      await upsertBrands(brandsData, tenantId);
      return { synced: brandsData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull brands:", error);
    return { synced: 0 };
  }
}

async function pullStores(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping store pull");
      return { synced: 0 };
    }
    const { data, error } = await store.dispatch(
      remoteApi.endpoints.getRemoteStores.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    if (error) {
      console.error("❌ Store pull failed:", error);
      return { synced: 0 };
    }
    const storesData = data?.stores || data?.data || data || [];
    if (storesData.length > 0) {
      await upsertStores(storesData, tenantId);
      return { synced: storesData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull stores:", error);
    return { synced: 0 };
  }
}

async function pullCategories(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping category pull");
      return { synced: 0 };
    }
    const { data, error } = await store.dispatch(
      remoteApi.endpoints.getRemoteCategories.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    if (error) {
      console.error("❌ Category pull failed:", error);
      return { synced: 0 };
    }
    const categoriesData = data?.categories || data?.data || data || [];
    if (categoriesData.length > 0) {
      await upsertCategories(categoriesData, tenantId);
      return { synced: categoriesData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull categories:", error);
    return { synced: 0 };
  }
}

async function pullCustomers(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping customer pull");
      return { synced: 0 };
    }
    const incremental = await readIncrementalRows(
      "customers",
      "getSyncCustomers",
      tenantId,
      ["customers", "data"],
    );
    if (incremental) {
      if (incremental.length) await upsertCustomers(incremental, tenantId);
      await saveSyncCursor(tenantId, "customers", incremental);
      return { synced: incremental.length };
    }
    const { data, error } = await store.dispatch(
      remoteApi.endpoints.getRemoteCustomers.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    if (error) {
      console.error("❌ Customer pull failed:", error);
      return { synced: 0 };
    }
    const customersData = data?.customers || data?.data || data || [];
    if (customersData.length > 0) {
      await upsertCustomers(customersData, tenantId);
      return { synced: customersData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull customers:", error);
    return { synced: 0 };
  }
}

// ✅ NEW: Pull Staff
async function pullStaff(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping staff pull");
      return { synced: 0 };
    }
    if (!remoteApi.endpoints.getRemoteStaff) {
      console.warn("⚠️ getRemoteStaff endpoint not available");
      return { synced: 0 };
    }
    const { data, error } = await store.dispatch(
      remoteApi.endpoints.getRemoteStaff.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    if (error) {
      if (error.originalStatus === 404 || error.status === "PARSING_ERROR")
        return { synced: 0 };
      console.error("❌ Staff pull failed:", error);
      return { synced: 0 };
    }
    const staffData = data?.staff || data?.data || data || [];
    if (staffData.length > 0) {
      await upsertStaff(staffData, tenantId);
      return { synced: staffData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull staff:", error);
    return { synced: 0 };
  }
}

// ✅ NEW: Pull Suppliers
async function pullSuppliers(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping supplier pull");
      return { synced: 0 };
    }
    if (!remoteApi.endpoints.getRemoteSuppliers) {
      console.warn("⚠️ getRemoteSuppliers endpoint not available");
      return { synced: 0 };
    }
    const { data, error } = await store.dispatch(
      remoteApi.endpoints.getRemoteSuppliers.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    if (error) {
      if (error.originalStatus === 404 || error.status === "PARSING_ERROR")
        return { synced: 0 };
      console.error("❌ Supplier pull failed:", error);
      return { synced: 0 };
    }
    const suppliersData = data?.suppliers || data?.data || data || [];
    if (suppliersData.length > 0) {
      await upsertSuppliers(suppliersData, tenantId);
      return { synced: suppliersData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull suppliers:", error);
    return { synced: 0 };
  }
}

async function pullProducts(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping product pull");
      return { synced: 0 };
    }
    const incremental = await readIncrementalRows(
      "products",
      "getSyncProducts",
      tenantId,
      ["products", "data"],
    );
    if (incremental) {
      if (incremental.length) {
        const productIdMap =
          (await upsertProducts(incremental, tenantId)) ?? {};
        const variants = incremental.flatMap((product: any) =>
          Array.isArray(product.variants)
            ? product.variants.map((variant: any) => ({
                ...variant,
                productId:
                  productIdMap[String(variant.productId ?? product.id)] ??
                  variant.productId ??
                  product.id,
                tenantId: variant.tenantId ?? tenantId,
              }))
            : [],
        );
        if (variants.length) await upsertProductVariants(variants, tenantId);
      }
      await saveSyncCursor(tenantId, "products", incremental);
      return { synced: incremental.length };
    }
    const productsData: any[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await store.dispatch(
        remoteApi.endpoints.getRemoteProducts.initiate(
          { page, limit: 100 },
          { forceRefetch: true },
        ),
      );
      if (error) {
        console.error("❌ Product pull failed:", error);
        return { synced: productsData.length };
      }
      const pageProducts = extractCollection(data, [
        "products",
        "items",
        "results",
        "data",
      ]);
      if (!pageProducts.length) break;
      for (const product of pageProducts) {
        const key = String(product.id ?? product._id ?? product.remoteId);
        if (!seen.has(key)) {
          seen.add(key);
          productsData.push(product);
        }
      }
      if (pageProducts.length < 100) break;
    }
    if (productsData.length > 0) {
      // Upsert products first
      const productIdMap = (await upsertProducts(productsData, tenantId)) ?? {};

      // Some product responses include stock under `inventories` (or
      // `inventory`). Keep those rows as well; the dedicated inventory pull
      // below can later refresh them with the authoritative values.
      const nestedInventory = productsData.flatMap((product: any) => {
        const rows = Array.isArray(product.inventories)
          ? product.inventories
          : Array.isArray(product.inventory)
            ? product.inventory
            : [];
        return rows.map((row: any) => ({
          ...row,
          productId:
            productIdMap[
              String(
                row.productId ?? row.product_id ?? product.id ?? product._id,
              )
            ] ??
            row.productId ??
            row.product_id ??
            product.id ??
            product._id,
          tenantId:
            row.tenantId ?? row.tenant_id ?? product.tenantId ?? tenantId,
        }));
      });
      if (nestedInventory.length > 0) {
        await upsertInventory(nestedInventory, tenantId);
      }

      // Extract and upsert variants from product data
      const allVariants = productsData.flatMap((p: any) =>
        Array.isArray(p.variants)
          ? p.variants.map((variant: any) => ({
              ...variant,
              productId:
                variant.productId ?? variant.product_id ?? p.id ?? p._id,
            }))
          : [],
      );
      if (allVariants.length > 0) {
        const variantsWithTenant = allVariants.map((v: any) => ({
          ...v,
          productId:
            productIdMap[String(v.productId || v.product_id)] ??
            (v.productId || v.product_id),
          tenantId: v.tenantId || tenantId,
        }));
        await upsertProductVariants(variantsWithTenant, tenantId);
      }

      return { synced: productsData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull products:", error);
    return { synced: 0 };
  }
}

async function pullInventory(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping inventory pull");
      return { synced: 0 };
    }
    const incremental = await readIncrementalRows(
      "inventory",
      "getSyncInventory",
      tenantId,
      ["inventory", "data"],
    );
    if (incremental) {
      if (incremental.length) await upsertInventory(incremental, tenantId);
      await saveSyncCursor(tenantId, "inventory", incremental);
      return { synced: incremental.length };
    }
    if (!remoteApi.endpoints.getRemoteInventory) {
      console.warn("⚠️ getRemoteInventory endpoint not available");
      return { synced: 0 };
    }
    const inventoryItems: any[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 100; page++) {
      const { data, error } = await store.dispatch(
        remoteApi.endpoints.getRemoteInventory.initiate(
          { page, limit: 100 },
          { forceRefetch: true },
        ),
      );
      if (error) {
        if (error.originalStatus === 404 || error.status === "PARSING_ERROR")
          return { synced: inventoryItems.length };
        console.error("❌ Inventory pull failed:", error);
        return { synced: inventoryItems.length };
      }
      const pageItems = extractCollection(data, [
        "inventory",
        "items",
        "results",
        "data",
      ]);
      if (!pageItems.length) break;
      for (const item of pageItems) {
        const key = String(item.id ?? item._id ?? item.remoteId);
        if (!seen.has(key)) {
          seen.add(key);
          inventoryItems.push(item);
        }
      }
      if (pageItems.length < 100) break;
    }
    if (inventoryItems.length > 0) {
      await upsertInventory(inventoryItems, tenantId);
      return { synced: inventoryItems.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull inventory:", error);
    return { synced: 0 };
  }
}

async function pullInventoryMovements(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    if (!state.auth?.user?.token) return { synced: 0 };

    const incremental = await readIncrementalRows(
      "inventoryMovements",
      "getSyncMovements",
      tenantId,
      ["movements", "data"],
    );
    if (incremental) {
      if (incremental.length) {
        await upsertInventoryMovements(incremental, tenantId);
      }
      await saveSyncCursor(tenantId, "inventoryMovements", incremental);
      return { synced: incremental.length };
    }

    const movements: any[] = [];
    const seen = new Set<string>();
    for (let page = 1; page <= 100; page += 1) {
      const { data, error } = await store.dispatch(
        remoteApi.endpoints.getRemoteInventoryMovements.initiate(
          { page, limit: 100 },
          { forceRefetch: true },
        ),
      );
      if (error) {
        const status = (error as any).originalStatus ?? (error as any).status;
        if (status === 404 || status === "PARSING_ERROR") break;
        console.error("❌ Inventory movements pull failed:", error);
        break;
      }
      const pageItems = extractCollection(data, [
        "movements",
        "items",
        "results",
        "data",
      ]);
      if (!pageItems.length) break;
      for (const movement of pageItems) {
        const id = String(
          movement.id ?? movement._id ?? movement.remoteId ?? "",
        );
        if (id && !seen.has(id)) {
          seen.add(id);
          movements.push(movement);
        }
      }
      if (pageItems.length < 100) break;
    }

    if (movements.length) await upsertInventoryMovements(movements, tenantId);
    return { synced: movements.length };
  } catch (error) {
    console.error("❌ Failed to pull inventory movements:", error);
    return { synced: 0 };
  }
}

async function pullSessions(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping session pull");
      return { synced: 0 };
    }
    const { data, error } = await store.dispatch(
      remoteApi.endpoints.getRemoteSessions.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    if (error) {
      console.error("❌ Session pull failed:", error);
      return { synced: 0 };
    }
    const sessionsData = data?.sessions || data?.data || data || [];
    if (sessionsData.length > 0) {
      await upsertSessions(sessionsData, tenantId);
      return { synced: sessionsData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull sessions:", error);
    return { synced: 0 };
  }
}

// byme
async function pullOrders(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping order pull");
      return { synced: 0 };
    }
    const incremental = await readIncrementalRows(
      "orders",
      "getSyncOrders",
      tenantId,
      ["orders", "data"],
    );
    if (incremental) {
      if (incremental.length) await upsertOrders(incremental, tenantId);
      await saveSyncCursor(tenantId, "orders", incremental);
      return { synced: incremental.length };
    }
    if (!remoteApi.endpoints.getRemoteOrders) {
      console.warn("⚠️ getRemoteOrders endpoint not available");
      return { synced: 0 };
    }
    const pageSize = 100;
    const maxPages = 100;
    let synced = 0;
    const seenPages = new Set<string>();

    for (let page = 1; page <= maxPages; page++) {
      const result = await store.dispatch(
        remoteApi.endpoints.getRemoteOrders.initiate(
          { page, limit: pageSize },
          { forceRefetch: true },
        ),
      );
      const { data, error } = result;
      if (error) {
        if (error.originalStatus === 404 || error.status === "PARSING_ERROR")
          return { synced };
        console.error("❌ Order pull failed:", error);
        return { synced };
      }

      const raw = (data as any)?.orders ?? (data as any)?.data ?? data;
      const pageOrders = Array.isArray(raw) ? raw : [];
      if (pageOrders.length === 0) break;

      const pageKey = `${pageOrders[0]?.id ?? ""}:${pageOrders[pageOrders.length - 1]?.id ?? ""}`;
      if (seenPages.has(pageKey)) break;
      seenPages.add(pageKey);

      await upsertOrders(pageOrders, tenantId);
      synced += pageOrders.length;

      const meta = (data as any)?.pagination ?? (data as any)?.meta;
      const totalPages = Number(meta?.totalPages ?? meta?.total_pages ?? 0);
      if (totalPages && page >= totalPages) break;
      if (pageOrders.length < pageSize) break;
    }

    return { synced };
  } catch (error) {
    console.error("❌ Failed to pull orders:", error);
    return { synced: 0 };
  }
}

async function pullPriceHistory(dispatch: AppDispatch, tenantId: string) {
  try {
    const state = store.getState();
    const token = state.auth?.user?.token;
    if (!token) {
      console.warn("⚠️ No auth token found, skipping price history pull");
      return { synced: 0 };
    }
    if (!remoteApi.endpoints.getRemotePriceHistory) {
      console.warn("⚠️ getRemotePriceHistory endpoint not available");
      return { synced: 0 };
    }
    const { data, error } = await store.dispatch(
      remoteApi.endpoints.getRemotePriceHistory.initiate(undefined, {
        forceRefetch: true,
      }),
    );
    if (error) {
      if (error.originalStatus === 404 || error.status === "PARSING_ERROR")
        return { synced: 0 };
      console.error("❌ Price history pull failed:", error);
      return { synced: 0 };
    }
    const priceHistoryData = data?.priceHistory || data?.data || data || [];
    if (priceHistoryData.length > 0) {
      await upsertPriceHistory(priceHistoryData, tenantId);
      return { synced: priceHistoryData.length };
    }
    return { synced: 0 };
  } catch (error) {
    console.error("❌ Failed to pull price history:", error);
    return { synced: 0 };
  }
}

// Exported for online-first reads (pull remote → cache locally → read local)
export const pullStoresForRead = pullStores;
export const pullBrandsForRead = pullBrands;
export const pullCategoriesForRead = pullCategories;
export const pullCustomersForRead = pullCustomers;
export const pullStaffForRead = pullStaff;
export const pullSuppliersForRead = pullSuppliers;
export const pullProductsForRead = pullProducts;
export const pullInventoryForRead = pullInventory;
export const pullInventoryMovementsForRead = pullInventoryMovements;
export const pullSessionsForRead = pullSessions;
export const pullOrdersForRead = pullOrders;
export const pullPriceHistoryForRead = pullPriceHistory;

// ============================================
// PUSH FUNCTIONS
// ============================================

async function pushOutboxItems(dispatch: AppDispatch, maxItems: number) {
  // Older builds incorrectly marked blocked movements as synced in the
  // outbox. Recreate their queue entries from the authoritative local rows so
  // upgrading to this build does not lose those movements.
  await restorePendingMovementOutbox();
  const items = await getDueOutboxItems(maxItems);
  const syncPriority: Record<string, number> = {
    stores: 10,
    brands: 20,
    categories: 30,
    suppliers: 40,
    staff: 50,
    products: 60,
    product_variants: 70,
    inventory: 80,
    inventory_movements: 90,
    sessions: 100,
    orders: 110,
  };
  items.sort(
    (a, b) =>
      (syncPriority[a.entity] ?? 500) - (syncPriority[b.entity] ?? 500) ||
      a.createdAt.localeCompare(b.createdAt),
  );
  if (items.length === 0) {
    return { synced: 0, failed: 0 };
  }

  let synced = 0;
  let failed = 0;

  const groupedItems = items.reduce(
    (acc, item) => {
      if (!acc[item.entity]) acc[item.entity] = [];
      acc[item.entity].push(item);
      return acc;
    },
    {} as Record<string, typeof items>,
  );

  for (const [entity, entityItems] of Object.entries(groupedItems)) {
    for (const item of entityItems) {
      try {
        const result = await processOutboxItem(item);
        if (result.success) {
          synced++;
          dispatch(setSyncProgress(65 + (synced / items.length) * 20));
        } else {
          failed++;
          await markOutboxFailed(
            item.id,
            item.attempts + 1,
            result.error || "Unknown error",
          );
        }
      } catch (error) {
        failed++;
        const message =
          error instanceof Error ? error.message : "Unknown error";
        await markOutboxFailed(item.id, item.attempts + 1, message);
        console.error(
          `❌ Failed to process ${item.entity} ${item.entityId}:`,
          message,
        );
      }
    }
  }

  return { synced, failed };
}

async function restorePendingMovementOutbox() {
  const db = getOfflineDb();
  const pending = await db
    .select()
    .from(inventoryMovements)
    .where(eq(inventoryMovements.syncStatus, "pending"));

  for (const movement of pending) {
    const [queued] = await db
      .select({ id: syncOutbox.id })
      .from(syncOutbox)
      .where(
        and(
          eq(syncOutbox.entity, "inventory_movements"),
          eq(syncOutbox.entityId, movement.id),
        ),
      )
      .limit(1);

    if (queued) continue;

    const now = new Date().toISOString();
    await db.insert(syncOutbox).values({
      id: createLocalId("outbox"),
      entity: "inventory_movements",
      entityId: movement.id,
      operation: "create",
      endpoint: "/api/tenant/inventory/movements",
      method: "POST",
      payload: {
        clientMovementId: movement.id,
        tenantId: movement.tenantId,
        storeId: movement.storeId,
        productId: movement.productId,
        variantId: movement.variantId ?? undefined,
        quantity: movement.quantity,
        type: movement.type,
        referenceId: movement.referenceId,
        referenceType: movement.referenceType,
        reason: movement.reason ?? undefined,
      },
      status: "pending",
      attempts: 0,
      nextAttemptAt: now,
      lastError: null,
      createdAt: movement.createdAt,
      updatedAt: now,
    });
  }
}

// Helper to strip null/undefined values (prevents server validation errors)
function stripNulls(obj: any): any {
  if (obj === null || obj === undefined) return undefined;
  if (Array.isArray(obj)) return obj.map(stripNulls);
  if (typeof obj === "object") {
    return Object.fromEntries(
      Object.entries(obj)
        .filter(([_, v]) => v !== null && v !== undefined)
        .map(([k, v]) => [k, typeof v === "object" ? stripNulls(v) : v]),
    );
  }
  return obj;
}

async function resolveProductReferences(payload: any) {
  const resolved = { ...payload };
  if (resolved.storeId) {
    const [storeRow] = await getOfflineDb()
      .select({ id: stores.id, remoteId: stores.remoteId })
      .from(stores)
      .where(eq(stores.id, String(resolved.storeId)))
      .limit(1);
    if (storeRow?.remoteId) resolved.storeId = storeRow.remoteId;
  }
  if (resolved.categoryId) {
    const [category] = await getOfflineDb()
      .select()
      .from(categories)
      .where(eq(categories.id, String(resolved.categoryId)))
      .limit(1);

    if (category?.remoteId) {
      resolved.categoryId = category.remoteId;
    } else if (category?.name) {
      // A locally-created category may not have synced yet. The backend can
      // create it from categoryName, so do not send the local SQLite id.
      delete resolved.categoryId;
      resolved.categoryName = category.name;
    }
  }
  for (const [field, table] of [
    ["brandId", brands],
    ["supplierId", suppliers],
  ] as const) {
    if (!resolved[field]) continue;
    const [row] = await getOfflineDb()
      .select()
      .from(table)
      .where(eq(table.id, String(resolved[field])))
      .limit(1);
    if (row?.remoteId) resolved[field] = row.remoteId;
    else if (row) delete resolved[field];
  }
  return resolved;
}

async function resolveRemoteTransactionReferences(payload: any) {
  const db = getOfflineDb();
  const resolved = { ...payload };

  if (resolved.storeId) {
    const [storeRow] = await db
      .select({ id: stores.id, remoteId: stores.remoteId })
      .from(stores)
      .where(eq(stores.id, String(resolved.storeId)))
      .limit(1);
    if (storeRow?.remoteId) resolved.storeId = storeRow.remoteId;
  }

  if (resolved.sessionId) {
    const [sessionRow] = await db
      .select({
        id: sessions.id,
        remoteId: sessions.remoteId,
        status: sessions.status,
      })
      .from(sessions)
      .where(eq(sessions.id, String(resolved.sessionId)))
      .limit(1);
    if (sessionRow?.remoteId) {
      resolved.sessionId = sessionRow.remoteId;
    } else {
      resolved.sessionId = undefined;
    }
  }

  if (resolved.customerId) {
    const [customerRow] = await db
      .select({ id: customers.id, remoteId: customers.remoteId })
      .from(customers)
      .where(eq(customers.id, String(resolved.customerId)))
      .limit(1);
    if (customerRow?.remoteId) resolved.customerId = customerRow.remoteId;
  }

  resolved.items = await Promise.all(
    (resolved.items ?? []).map(async (item: any) => {
      const [productRow] = await db
        .select({ id: products.id, remoteId: products.remoteId })
        .from(products)
        .where(eq(products.id, String(item.productId)))
        .limit(1);
      if (!productRow)
        throw new Error(`Product ${item.productId} is not cached locally.`);
      if (productRow.remoteId)
        item = { ...item, productId: productRow.remoteId };

      if (item.variantId) {
        const [variantRow] = await db
          .select({
            id: productVariants.id,
            remoteId: productVariants.remoteId,
          })
          .from(productVariants)
          .where(eq(productVariants.id, String(item.variantId)))
          .limit(1);
        if (!variantRow)
          throw new Error(`Variant ${item.variantId} is not cached locally.`);
        if (variantRow.remoteId)
          item = { ...item, variantId: variantRow.remoteId };
      }
      return item;
    }),
  );

  return resolved;
}

async function resolveRemoteMovementReferences(payload: any) {
  const db = getOfflineDb();
  const resolved = { ...payload };
  const [productRow] = await db
    .select({ id: products.id, remoteId: products.remoteId })
    .from(products)
    .where(eq(products.id, String(payload.productId)))
    .limit(1);
  if (!productRow)
    throw new Error(`Product ${payload.productId} is not cached locally.`);
  if (productRow.remoteId) resolved.productId = productRow.remoteId;

  if (payload.variantId) {
    const [variantRow] = await db
      .select({ id: productVariants.id, remoteId: productVariants.remoteId })
      .from(productVariants)
      .where(eq(productVariants.id, String(payload.variantId)))
      .limit(1);
    if (!variantRow)
      throw new Error(`Variant ${payload.variantId} is not cached locally.`);
    if (variantRow.remoteId) resolved.variantId = variantRow.remoteId;
  }

  const [storeRow] = await db
    .select({ id: stores.id, remoteId: stores.remoteId })
    .from(stores)
    .where(eq(stores.id, String(payload.storeId)))
    .limit(1);
  if (storeRow?.remoteId) resolved.storeId = storeRow.remoteId;
  return resolved;
}

async function resolveRemoteVariantReferences(payload: any) {
  const db = getOfflineDb();
  const resolved = { ...payload };
  const [product] = await db
    .select({ remoteId: products.remoteId })
    .from(products)
    .where(eq(products.id, String(payload.productId)))
    .limit(1);
  if (!product?.remoteId) {
    throw new Error(
      "Product is waiting for server sync; option will retry automatically.",
    );
  }
  resolved.productId = product.remoteId;
  return resolved;
}

async function resolveEntityRemoteId(entity: string, localId: string) {
  if (!localId) return localId;
  const db = getOfflineDb();
  const tables: Record<string, any> = {
    brands,
    brand: brands,
    products,
    product: products,
    categories,
    category: categories,
    customers,
    customer: customers,
    stores,
    store: stores,
    suppliers,
    supplier: suppliers,
    staff,
    product_variants: productVariants,
    variants: productVariants,
    variant: productVariants,
    sessions,
    session: sessions,
  };
  const table = tables[entity];
  if (!table) return localId;
  const [row] = await db
    .select({ remoteId: table.remoteId })
    .from(table)
    .where(eq(table.id, localId))
    .limit(1);
  return row?.remoteId || localId;
}

async function resolvePayloadForeignKeys(payload: any) {
  if (!payload || typeof payload !== "object") return payload;
  const copy = { ...payload };

  if (copy.storeId) {
    copy.storeId = await resolveEntityRemoteId("stores", String(copy.storeId));
  }
  if (copy.sourceStoreId) {
    copy.sourceStoreId = await resolveEntityRemoteId(
      "stores",
      String(copy.sourceStoreId),
    );
  }
  if (copy.targetStoreId) {
    copy.targetStoreId = await resolveEntityRemoteId(
      "stores",
      String(copy.targetStoreId),
    );
  }
  if (copy.categoryId) {
    copy.categoryId = await resolveEntityRemoteId(
      "categories",
      String(copy.categoryId),
    );
  }
  if (copy.brandId) {
    copy.brandId = await resolveEntityRemoteId("brands", String(copy.brandId));
  }
  if (copy.supplierId) {
    copy.supplierId = await resolveEntityRemoteId(
      "suppliers",
      String(copy.supplierId),
    );
  }
  if (copy.customerId) {
    copy.customerId = await resolveEntityRemoteId(
      "customers",
      String(copy.customerId),
    );
  }
  if (copy.productId) {
    copy.productId = await resolveEntityRemoteId(
      "products",
      String(copy.productId),
    );
  }
  if (copy.variantId) {
    copy.variantId = await resolveEntityRemoteId(
      "product_variants",
      String(copy.variantId),
    );
  }
  if (copy.sessionId) {
    const resolved = await resolveEntityRemoteId(
      "sessions",
      String(copy.sessionId),
    );
    copy.sessionId = resolved && resolved.length === 36 ? resolved : undefined;
  }

  return copy;
}

// ============================================
// PROCESS OUTBOX ITEM (FIXED)
// ============================================

async function processOutboxItem(
  item: any,
): Promise<{ success: boolean; error?: string }> {
  const db = getOfflineDb();

  // Clean payload – strip null/undefined
  const payload = stripNulls(item.payload) ?? {};

  switch (item.entity) {
    // ---- Brands ----
    case "brands": {
      try {
        if (item.operation === "create") {
          const { data, error } = await store.dispatch(
            remoteApi.endpoints.createRemoteBrand.initiate(payload),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .update(brands)
            .set({
              remoteId: (data as any)?.brand?.id ?? (data as any)?.id ?? null,
              syncStatus: "synced",
            })
            .where(eq(brands.id, item.entityId));
        } else if (item.operation === "update") {
          const { error } = await store.dispatch(
            remoteApi.endpoints.updateRemoteBrand.initiate({
              id: await resolveEntityRemoteId("brands", item.entityId),
              ...payload,
            }),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .update(brands)
            .set({ syncStatus: "synced" })
            .where(eq(brands.id, item.entityId));
        } else if (item.operation === "delete") {
          const { error } = await store.dispatch(
            remoteApi.endpoints.deleteRemoteBrand.initiate(
              await resolveEntityRemoteId("brands", item.entityId),
            ),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db.delete(brands).where(eq(brands.id, item.entityId));
        }
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // // original
    // // ---- Orders ----
    // case "orders": {
    //   try {
    //     // Only handle create
    //     if (item.operation === "create") {
    //       const { data, error } = await store.dispatch(
    //         remoteApi.endpoints.createRemoteOrder.initiate(payload),
    //       );
    //       if (error) throw new Error(JSON.stringify(error));
    //       await db
    //         .update(orders)
    //         .set({ remoteId: data.id, syncStatus: "synced" })
    //         .where(eq(orders.id, item.entityId));
    //     } else if (item.operation === "updateStatus") {
    //       // For status updates
    //       const { error } = await store.dispatch(
    //         remoteApi.endpoints.updateRemoteOrderStatus.initiate({
    //           id: item.entityId,
    //           ...payload,
    //         }),
    //       );
    //       if (error) throw new Error(JSON.stringify(error));
    //       await db
    //         .update(orders)
    //         .set({ syncStatus: "synced" })
    //         .where(eq(orders.id, item.entityId));
    //     } else if (item.operation === "delete") {
    //       const { error } = await store.dispatch(
    //         remoteApi.endpoints.deleteRemoteOrder.initiate(item.entityId),
    //       );
    //       if (error) throw new Error(JSON.stringify(error));
    //       await db.delete(orders).where(eq(orders.id, item.entityId));
    //     }
    //     await markOutboxSynced(item.id);
    //     return { success: true };
    //   } catch (error) {
    //     return { success: false, error: (error as Error).message };
    //   }
    // }

    case "orders": {
      try {
        // Only handle create
        if (item.operation === "create") {
          // A sale made before an offline session closes is still valid. Use
          // the session only when it has already reached the server and is
          // still open; otherwise submit the sale without a session instead
          // of permanently dead-lettering the order.
          const [session] = payload.sessionId
            ? await db
                .select()
                .from(sessions)
                .where(eq(sessions.id, payload.sessionId))
                .limit(1)
            : [];

          const resolvedSessionId =
            session?.status === "OPEN" && session.remoteId
              ? session.remoteId
              : undefined;

          // Proceed with order creation
          const remoteOrderPayload = await resolveRemoteTransactionReferences({
            ...payload,
            sessionId: resolvedSessionId,
            items: payload.items,
          });
          const { data, error } = await store.dispatch(
            remoteApi.endpoints.createRemoteOrder.initiate(remoteOrderPayload),
          );
          if (error) {
            const rawError = error as any;
            const errorMessage =
              rawError?.data?.message ||
              rawError?.data ||
              rawError?.error ||
              JSON.stringify(error);
            throw new Error(errorMessage);
          }
          console.log(
            "data orders from createRemoteOrder",
            data,
            "payload",
            remoteOrderPayload,
          );

          const remoteOrder =
            (data as any)?.order ?? (data as any)?.data ?? data;
          const remoteId = remoteOrder?.id || (data as any)?.id;
          if (!remoteId) {
            throw new Error("Order created but no ID returned");
          }

          await db
            .update(orders)
            .set({
              remoteId,
              // A successfully submitted POS sale has been paid locally. The
              // old code only changed syncStatus, leaving the UI at PENDING.
              status:
                remoteOrder?.status === "CANCELLED" ? "CANCELLED" : "COMPLETED",
              orderNumber: remoteOrder?.orderNumber ?? payload.orderNumber,
              syncStatus: "synced",
              syncError: null,
              lastSyncedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(orders.id, item.entityId));

          await markOutboxSynced(item.id);
          return { success: true };
        } else if (item.operation === "updateStatus") {
          const [orderRow] = await db
            .select({ remoteId: orders.remoteId })
            .from(orders)
            .where(eq(orders.id, item.entityId))
            .limit(1);

          const targetId = orderRow?.remoteId || item.entityId;

          const { error } = await store.dispatch(
            remoteApi.endpoints.updateRemoteOrderStatus.initiate({
              id: targetId,
              ...payload,
            }),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .update(orders)
            .set({ syncStatus: "synced" })
            .where(eq(orders.id, item.entityId));
          await markOutboxSynced(item.id);
          return { success: true };
        } else if (item.operation === "delete") {
          const [orderRow] = await db
            .select({ remoteId: orders.remoteId })
            .from(orders)
            .where(eq(orders.id, item.entityId))
            .limit(1);

          const targetId = orderRow?.remoteId || item.entityId;

          const { error } = await store.dispatch(
            remoteApi.endpoints.deleteRemoteOrder.initiate(targetId),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db.delete(orders).where(eq(orders.id, item.entityId));
          await markOutboxSynced(item.id);
          return { success: true };
        }
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // ---- Sessions ----
    case "sessions": {
      try {
        let result;
        let knownRemoteSessionId: string | null = null;
        if (item.operation === "open") {
          console.log("Opening session with ID:", item);
          // Server open body only accepts these fields; local userId/tenantId
          // would fail validation and leave close stuck without a remoteId.
          const openPayload: {
            openingBalance: number;
            storeId?: string;
            registerId?: string;
            notes?: string;
          } = {
            openingBalance: Number(payload.openingBalance) || 0,
            notes: payload.notes,
            registerId: payload.registerId,
          };
          if (payload.storeId) {
            openPayload.storeId = await resolveEntityRemoteId(
              "stores",
              String(payload.storeId),
            );
          }
          result = await store.dispatch(
            remoteApi.endpoints.openRemoteSession.initiate(openPayload),
          );

          console.log(result, "session open return data");
        } else if (item.operation === "close") {
          console.log("Closing session with ID:", item);
          const [localSession] = await db
            .select({ remoteId: sessions.remoteId })
            .from(sessions)
            .where(eq(sessions.id, item.entityId))
            .limit(1);
          // Never send the local ses_… id to the server — defer until open
          // has stored the real UUID (same pattern as product variants).
          if (!localSession?.remoteId) {
            return {
              success: false,
              error:
                "Session is waiting for server sync; close will retry automatically.",
            };
          }
          knownRemoteSessionId = localSession.remoteId;
          result = await store.dispatch(
            remoteApi.endpoints.closeRemoteSession.initiate({
              id: knownRemoteSessionId,
              ...payload,
            }),
          );
          console.log(result, "session close return data");
        } else {
          throw new Error(`Unknown session operation: ${item.operation}`);
        }
        const { data, error } = result;
        if (error) {
          // Open may have already created the session on a prior attempt.
          // Adopt that server id so a queued close can proceed.
          const errorData = (error as any)?.data;
          const existingSessionId =
            item.operation === "open"
              ? errorData?.sessionId || errorData?.session?.id
              : null;
          if (existingSessionId) {
            knownRemoteSessionId = String(existingSessionId);
          } else {
            throw new Error(JSON.stringify(error));
          }
        }
        const remoteSession = (data as any)?.session ?? (data as any);
        const remoteSessionId =
          remoteSession?.id || knownRemoteSessionId || null;
        if (!remoteSessionId)
          throw new Error("Session synced without a server ID");
        await db
          .update(sessions)
          .set({ remoteId: remoteSessionId, syncStatus: "synced" })
          .where(eq(sessions.id, item.entityId));
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // ---- Products ----
    case "products": {
      try {
        if (item.operation === "create") {
          const productPayload = await resolveProductReferences(payload);
          const { data, error } = await store.dispatch(
            remoteApi.endpoints.createRemoteProduct.initiate(productPayload),
          );
          if (error) throw new Error(JSON.stringify(error));
          let remoteProduct =
            (data as any)?.product ?? (data as any)?.data ?? (data as any);
          await db
            .update(products)
            .set({
              remoteId: remoteProduct?.id ?? null,
              syncStatus: "synced",
              syncError: null,
            })
            .where(eq(products.id, item.entityId));

          // Product creation may create its options atomically. Persist the
          // server option IDs immediately so queued checkout/movement records
          // can resolve local variant IDs before the next pull runs.
          // Some backend deployments return only the product ID from POST.
          // Read the created product once so its atomically-created variants
          // get their remote IDs before queued checkout records are pushed.
          if (remoteProduct?.id && !Array.isArray(remoteProduct?.variants)) {
            try {
              const fetched = await store.dispatch(
                remoteApi.endpoints.getRemoteProductById.initiate(
                  String(remoteProduct.id),
                  { forceRefetch: true },
                ),
              );
              remoteProduct =
                (fetched.data as any)?.product ??
                (fetched.data as any)?.data ??
                fetched.data ??
                remoteProduct;
            } catch {
              // The normal pull will reconcile the variants on the next cycle.
            }
          }
          const remoteVariants = Array.isArray(remoteProduct?.variants)
            ? remoteProduct.variants
            : [];
          for (const remoteVariant of remoteVariants) {
            const remoteVariantId = remoteVariant?.id ?? remoteVariant?._id;
            if (!remoteVariantId) continue;
            const remoteSku = String(remoteVariant.sku ?? "").trim();
            const remoteName = String(remoteVariant.name ?? "").trim();
            const candidates = await db
              .select({ id: productVariants.id })
              .from(productVariants)
              .where(
                and(
                  eq(productVariants.productId, item.entityId),
                  remoteSku
                    ? eq(productVariants.sku, remoteSku)
                    : eq(productVariants.name, remoteName),
                ),
              )
              .limit(1);
            const localVariant = candidates[0];
            if (!localVariant) continue;
            await db
              .update(productVariants)
              .set({
                remoteId: String(remoteVariantId),
                name: remoteVariant.name ?? undefined,
                sku: remoteVariant.sku ?? undefined,
                barcode: remoteVariant.barcode ?? undefined,
                price: Number(remoteVariant.price ?? 0),
                costPrice: Number(
                  remoteVariant.costPrice ?? remoteVariant.cost_price ?? 0,
                ),
                syncStatus: "synced",
                syncError: null,
                updatedAt: new Date().toISOString(),
                lastSyncedAt: new Date().toISOString(),
              })
              .where(eq(productVariants.id, localVariant.id));
          }
        } else if (item.operation === "update") {
          const remoteProductId = await resolveEntityRemoteId(
            "products",
            item.entityId,
          );
          const productPayload = await resolveProductReferences(payload);
          if (Array.isArray(productPayload.variants)) {
            productPayload.variants = await Promise.all(
              productPayload.variants.map(async (variant: any) => {
                if (!variant.id && !variant.remoteId) return variant;
                const variantId = variant.remoteId || variant.id;
                const [localVariant] = await db
                  .select({ remoteId: productVariants.remoteId })
                  .from(productVariants)
                  .where(eq(productVariants.id, variantId))
                  .limit(1);
                return {
                  ...variant,
                  id: localVariant?.remoteId || variant.remoteId || variant.id,
                };
              }),
            );
          }
          const { error } = await store.dispatch(
            remoteApi.endpoints.updateRemoteProduct.initiate({
              id: remoteProductId,
              ...productPayload,
            }),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .update(products)
            .set({ syncStatus: "synced" })
            .where(eq(products.id, item.entityId));
        } else if (item.operation === "delete") {
          const remoteProductId = await resolveEntityRemoteId(
            "products",
            item.entityId,
          );
          const { error } = await store.dispatch(
            remoteApi.endpoints.deleteRemoteProduct.initiate(remoteProductId),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db.delete(products).where(eq(products.id, item.entityId));
        }
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // ---- Product Variants ----
    case "product_variants": {
      try {
        const [localVariant] = await db
          .select({ remoteId: productVariants.remoteId })
          .from(productVariants)
          .where(eq(productVariants.id, item.entityId))
          .limit(1);
        if (item.operation === "create") {
          const variantPayload = await resolveRemoteVariantReferences(payload);
          const { data, error } = await store.dispatch(
            remoteApi.endpoints.createRemoteProductVariant.initiate(
              variantPayload,
            ),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .update(productVariants)
            .set({
              remoteId: (data as any)?.variant?.id ?? (data as any)?.id ?? null,
              syncStatus: "synced",
            })
            .where(eq(productVariants.id, item.entityId));
        } else if (item.operation === "update") {
          if (!localVariant?.remoteId)
            throw new Error(
              "Option is waiting for server sync; update will retry automatically.",
            );
          const { error } = await store.dispatch(
            remoteApi.endpoints.updateRemoteProductVariant.initiate({
              id: localVariant.remoteId,
              ...payload,
            }),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .update(productVariants)
            .set({ syncStatus: "synced" })
            .where(eq(productVariants.id, item.entityId));
        } else if (item.operation === "delete") {
          if (!localVariant?.remoteId) {
            // The option never reached the server, so its local deletion is final.
            await db
              .delete(productVariants)
              .where(eq(productVariants.id, item.entityId));
            await markOutboxSynced(item.id);
            return { success: true };
          }
          const { error } = await store.dispatch(
            remoteApi.endpoints.deleteRemoteProductVariant.initiate(
              localVariant.remoteId,
            ),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .delete(productVariants)
            .where(eq(productVariants.id, item.entityId));
        }
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // ---- Inventory (now sends update) ----
    case "inventory": {
      try {
        // Inventory has no PUT endpoint. Legacy inventory outbox rows are
        // converted into the authoritative stock-movement API.
        if (item.operation === "update") {
          const delta = Number(
            payload.quantityDelta ??
              payload.delta ??
              payload.quantity ??
              (payload.newQuantity != null && payload.currentQuantity != null
                ? payload.newQuantity - payload.currentQuantity
                : 0),
          );
          if (!delta) {
            await markOutboxSynced(item.id);
            return { success: true };
          }
          const movementPayload = await resolveRemoteMovementReferences({
            ...payload,
            quantity: delta,
            type: "ADJUSTMENT",
            referenceId: payload.referenceId ?? item.entityId,
            referenceType: "STOCK_ADJUSTMENT",
          });
          const { data, error } = await store.dispatch(
            remoteApi.endpoints.createRemoteInventoryMovement.initiate(
              movementPayload,
            ),
          );
          if (error) throw new Error(JSON.stringify(error));
          const remoteMovement =
            (data as any)?.movement ?? (data as any)?.data ?? data;
          await db
            .update(inventory)
            .set({
              remoteId: remoteMovement?.id ?? null,
              syncStatus: "synced",
              syncError: null,
            })
            .where(eq(inventory.id, item.entityId));
        } else {
          // If not an update, treat as synced to clear it
          await markOutboxSynced(item.id);
        }
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    case "inventory_movements": {
      try {
        // Only create is supported
        if (item.operation === "create") {
          let movementPayload = payload;

          // Sales reference a local order while offline. Wait for that order
          // instead of deleting the movement from the outbox. Non-order
          // movements (adjustments, purchases, transfers, counts) must sync
          // independently and must not be blocked by an order lookup.
          const normalizedReferenceType = String(
            payload.referenceType ?? "",
          ).toUpperCase();

          if (normalizedReferenceType === "ORDER") {
            const [order] = await db
              .select()
              .from(orders)
              .where(eq(orders.id, payload.referenceId))
              .limit(1);

            if (!order || order.syncStatus !== "synced") {
              return {
                success: false,
                error: `Order ${payload.referenceId} is not synced yet; retrying movement later.`,
              };
            }

            // Server order creation already writes the SALE/RETURN stock
            // movement atomically. Older mobile builds queued a duplicate
            // movement after checkout; retire it rather than applying the
            // stock delta twice.
            await db
              .update(inventoryMovements)
              .set({
                syncStatus: "synced",
                syncError: null,
                lastSyncedAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              })
              .where(eq(inventoryMovements.id, item.entityId));
            await markOutboxSynced(item.id);
            return { success: true };
          }

          // ✅ Map type to server enum
          const sourceType = String(movementPayload.type ?? "").toUpperCase();
          let mappedType = sourceType;
          // Use the same mapping helper from repository (we'll import it or duplicate)
          // We'll duplicate the logic here to keep syncManager self-contained.
          const referenceType = normalizedReferenceType;
          if (referenceType === "STOCK_ADJUSTMENT") {
            mappedType = "ADJUSTMENT";
          } else if (referenceType === "ORDER") {
            if (sourceType === "OUT") mappedType = "SALE";
            else if (sourceType === "IN") mappedType = "RETURN_IN";
          } else if (
            referenceType === "PURCHASE" ||
            referenceType === "PURCHASE_ORDER"
          ) {
            mappedType = "PURCHASE";
          } else if (
            referenceType === "TRANSFER" ||
            referenceType === "STOCK_TRANSFER"
          ) {
            if (sourceType === "IN") mappedType = "TRANSFER_IN";
            else if (sourceType === "OUT") mappedType = "TRANSFER_OUT";
          } else if (
            referenceType === "INVENTORY_COUNT" ||
            referenceType === "COUNT"
          ) {
            mappedType = "COUNTING";
          } else if (referenceType === "OPENING_STOCK") {
            mappedType = "OPENING_STOCK";
          } else {
            if (sourceType === "IN") mappedType = "PURCHASE";
            else if (sourceType === "OUT") mappedType = "SALE";
          }

          const remoteMovementPayload =
            await resolveRemoteMovementReferences(movementPayload);
          const isOutbound =
            ["OUT", "SALE", "TRANSFER_OUT"].includes(sourceType) ||
            ["SALE", "TRANSFER_OUT"].includes(mappedType);
          const cleanPayload = {
            ...remoteMovementPayload,
            // The backend receives a signed quantityDelta through `quantity`.
            quantity:
              Math.abs(Number(movementPayload.quantity ?? 0)) *
              (isOutbound ? -1 : 1),
            type: mappedType,
          };

          const { data, error } = await store.dispatch(
            remoteApi.endpoints.createRemoteInventoryMovement.initiate(
              cleanPayload,
            ),
          );
          if (error) {
            const errorMessage =
              error?.data?.message ||
              error?.data ||
              error?.error ||
              JSON.stringify(error);
            throw new Error(errorMessage);
          }
          const remoteMovement =
            (data as any)?.movement ?? (data as any)?.data ?? data;
          const remoteId = remoteMovement?.id;
          if (!remoteId) throw new Error("Movement created but no ID returned");

          await db
            .update(inventoryMovements)
            .set({
              remoteId,
              syncStatus: "synced",
              syncError: null,
              lastSyncedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            })
            .where(eq(inventoryMovements.id, item.entityId));
        } else {
          await markOutboxSynced(item.id);
        }
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // ---- Inventory Counts ----
    case "inventory_counts": {
      try {
        if (item.operation === "create") {
          const { data, error } = await store.dispatch(
            remoteApi.endpoints.createRemoteInventoryCount.initiate(payload),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .update(inventoryCounts)
            .set({ remoteId: data.id, syncStatus: "synced" })
            .where(eq(inventoryCounts.id, item.entityId));
        } else {
          await markOutboxSynced(item.id);
        }
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // ---- Price History ----
    case "price_history": {
      try {
        if (item.operation === "create") {
          const { data, error } = await store.dispatch(
            remoteApi.endpoints.createRemotePriceHistory.initiate(payload),
          );
          if (error) throw new Error(JSON.stringify(error));
          await db
            .update(priceHistory)
            .set({ remoteId: data.id, syncStatus: "synced" })
            .where(eq(priceHistory.id, item.entityId));
        } else {
          await markOutboxSynced(item.id);
        }
        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }

    // ---- Generic fallback ----
    default: {
      try {
        // Try to use the generic endpoint if available
        if (item.endpoint && item.method) {
          const state = store.getState() as any;
          const token = state.auth?.user?.token;

          if (!token) {
            throw new Error("No authentication token available for sync");
          }

          // Staff created offline keep a local primary key and a server remoteId.
          // Resolve the server ID at send time so queued edits made before the
          // create sync completed do not call `/staff/<local-id>` and receive 404.
          let endpoint = item.endpoint;
          let requestPayload = payload;
          if (item.operation !== "create") {
            const remoteId = await resolveEntityRemoteId(
              item.entity,
              item.entityId,
            );
            endpoint = `/api/tenant/${item.entity}/${remoteId}`;
          }

          if (requestPayload?.data && item.operation !== "create") {
            requestPayload = requestPayload.data;
          }

          // Universally resolve foreign keys (storeId, categoryId, brandId, supplierId, customerId, etc.)
          requestPayload = await resolvePayloadForeignKeys(requestPayload);

          // Build URL (avoid double /api)
          const baseUrl = POS_API_URL.endsWith("/api")
            ? POS_API_URL.slice(0, -4)
            : POS_API_URL;
          const url = endpoint.startsWith("http")
            ? endpoint
            : `${baseUrl}${endpoint.startsWith("/") ? "" : "/"}${endpoint}`;

          const response = await fetch(url, {
            method: item.method,
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${token}`,
            },
            body:
              requestPayload && item.method !== "GET"
                ? JSON.stringify(requestPayload)
                : undefined,
          });

          if (!response.ok) {
            const errorText = await response.text();
            throw new Error(`API Error ${response.status}: ${errorText}`);
          }

          const data = await response.json().catch(() => ({}));
          const remoteEntity =
            data?.brand ??
            data?.staff ??
            data?.supplier ??
            data?.store ??
            data?.category ??
            data?.customer ??
            data;
          if (remoteEntity && remoteEntity.id) {
            await markEntitySynced(item.entity, item.entityId, {
              ...remoteEntity,
              remoteId: remoteEntity.id,
            });
          } else {
            await markEntitySynced(item.entity, item.entityId, {});
          }
        } else {
          await markEntitySynced(item.entity, item.entityId, {});
        }

        await markOutboxSynced(item.id);
        return { success: true };
      } catch (error) {
        return { success: false, error: (error as Error).message };
      }
    }
  }
}

// ============================================
// HELPERS
// ============================================

async function getFailedCount(): Promise<number> {
  const db = getOfflineDb();
  const result = await db
    .select({ count: sql<number>`count(*)` })
    .from(syncOutbox)
    .where(inArray(syncOutbox.status, ["failed", "dead"]));
  return Number(result[0]?.count ?? 0);
}

// ============================================
// RETRY
// ============================================

export async function retryFailedItems(
  dispatch: AppDispatch,
  getState: () => RootState,
  itemIds?: string[],
) {
  const online = await isOnline();
  if (!online) {
    dispatch(setSyncError("Cannot retry: Offline mode"));
    return { error: "Offline mode" };
  }

  try {
    let itemsToRetry: string[] = [];

    if (itemIds && itemIds.length > 0) {
      for (const id of itemIds) {
        await retryOutboxItem(id);
        itemsToRetry.push(id);
      }
    } else {
      const failedItems = await getFailedOutboxItems(100);
      for (const item of failedItems) {
        await retryOutboxItem(item.id);
        itemsToRetry.push(item.id);
      }
    }

    dispatch(resetSync());
    const result = await syncNow(dispatch, getState, { force: true });

    return {
      success: true,
      retried: itemsToRetry.length,
      ...result,
    };
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Failed to retry items";
    dispatch(setSyncError(message));
    return { error: message };
  }
}

// ============================================
// CLEANUP
// ============================================

export function cleanupOfflineSystem() {
  if (unsubscribeNetwork) {
    unsubscribeNetwork();
    unsubscribeNetwork = undefined;
  }

  if (syncInterval) {
    clearInterval(syncInterval);
    syncInterval = undefined;
  }

  if (debounceTimeout) {
    clearTimeout(debounceTimeout);
    debounceTimeout = undefined;
  }

  syncInFlight = false;
  console.log("🧹 Offline system cleaned up");
}

// ============================================
// HOOK (useSync)
// ============================================

export function useSync() {
  const dispatch = useAppDispatch();

  const isOnline = useAppSelector((state) => state.offline.isOnline);
  const isSyncing = useAppSelector((state) => state.offline.isSyncing);
  const syncStatus = useAppSelector((state) => state.offline.syncStatus);
  const syncPhase = useAppSelector((state) => state.offline.syncPhase);
  const syncError = useAppSelector((state) => state.offline.syncError);
  const queueCount = useAppSelector((state) => state.offline.queuedCount);
  const failedCount = useAppSelector((state) => state.offline.failedCount);
  const syncProgress = useAppSelector((state) => state.offline.syncProgress);
  const lastSyncAt = useAppSelector((state) => state.offline.lastSyncAt);
  const syncStats = useAppSelector((state) => state.offline.syncStats);

  const [isLoading, setIsLoading] = useState(false);
  const [detailedStatus, setDetailedStatus] = useState<any>(null);

  // Use the real store's getState
  const getState = useCallback(() => store.getState(), []);

  const sync = useCallback(
    async (options?: { force?: boolean; maxItems?: number }) => {
      setIsLoading(true);
      try {
        const result = await syncNow(dispatch, getState, options);
        return result;
      } catch (error) {
        console.error("Sync failed:", error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [dispatch, getState],
  );

  const retry = useCallback(
    async (itemIds?: string[]) => {
      setIsLoading(true);
      try {
        const result = await retryFailedItems(dispatch, getState, itemIds);
        return result;
      } catch (error) {
        console.error("Retry failed:", error);
        throw error;
      } finally {
        setIsLoading(false);
      }
    },
    [dispatch, getState],
  );

  const refresh = useCallback(async () => {
    try {
      const count = await getQueuedCount();
      dispatch(setQueuedCount(count));
      const failed = await getFailedCount();
      dispatch(setFailedCount(failed));
      const status = await getSyncStatus();
      setDetailedStatus(status);
      return { queueCount: count, failedCount: failed, status };
    } catch (error) {
      console.error("Refresh failed:", error);
      throw error;
    }
  }, [dispatch]);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 30000);
    return () => clearInterval(interval);
  }, [refresh]);

  return {
    isOnline,
    isSyncing,
    isLoading,
    syncStatus,
    syncPhase,
    syncError,
    queueCount,
    failedCount,
    syncProgress,
    lastSyncAt,
    syncStats,
    detailedStatus,
    sync,
    retry,
    refresh,
  };
}

export type SyncResult = {
  success?: boolean;
  skipped?: boolean;
  message?: string;
  synced?: number;
  failed?: number;
  remaining?: number;
  duration?: number;
  retried?: number;
  error?: string;
};
