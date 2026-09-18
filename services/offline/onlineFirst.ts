import type { AppDispatch } from "@/services/store/store";
import { isOnline } from "./network";

export type SyncEntity =
  | "stores"
  | "brands"
  | "categories"
  | "customers"
  | "staff"
  | "suppliers"
  | "products"
  | "inventory"
  | "inventoryMovements"
  | "sessions"
  | "orders"
  | "priceHistory"
  | "storeSettings";

const ENTITY_PULL_MAP: Record<
  SyncEntity,
  (dispatch: AppDispatch, tenantId: string) => Promise<void>
> = {
  stores: async (dispatch, tenantId) => {
    const { pullStoresForRead } = await import("./syncManager");
    await pullStoresForRead(dispatch, tenantId);
  },
  brands: async (dispatch, tenantId) => {
    const { pullBrandsForRead } = await import("./syncManager");
    await pullBrandsForRead(dispatch, tenantId);
  },
  categories: async (dispatch, tenantId) => {
    const { pullCategoriesForRead } = await import("./syncManager");
    await pullCategoriesForRead(dispatch, tenantId);
  },
  customers: async (dispatch, tenantId) => {
    const { pullCustomersForRead } = await import("./syncManager");
    await pullCustomersForRead(dispatch, tenantId);
  },
  staff: async (dispatch, tenantId) => {
    const { pullStaffForRead } = await import("./syncManager");
    await pullStaffForRead(dispatch, tenantId);
  },
  suppliers: async (dispatch, tenantId) => {
    const { pullSuppliersForRead } = await import("./syncManager");
    await pullSuppliersForRead(dispatch, tenantId);
  },
  products: async (dispatch, tenantId) => {
    const { pullProductsForRead } = await import("./syncManager");
    await pullProductsForRead(dispatch, tenantId);
  },
  inventory: async (dispatch, tenantId) => {
    const { pullInventoryForRead } = await import("./syncManager");
    await pullInventoryForRead(dispatch, tenantId);
  },
  inventoryMovements: async (dispatch, tenantId) => {
    const { pullInventoryMovementsForRead } = await import("./syncManager");
    await pullInventoryMovementsForRead(dispatch, tenantId);
  },
  sessions: async (dispatch, tenantId) => {
    const { pullSessionsForRead } = await import("./syncManager");
    await pullSessionsForRead(dispatch, tenantId);
  },
  orders: async (dispatch, tenantId) => {
    const { pullOrdersForRead } = await import("./syncManager");
    await pullOrdersForRead(dispatch, tenantId);
  },
  priceHistory: async (dispatch, tenantId) => {
    const { pullPriceHistoryForRead } = await import("./syncManager");
    await pullPriceHistoryForRead(dispatch, tenantId);
  },
  storeSettings: async (dispatch, tenantId) => {
    const { pullStoreSettingsForRead } = await import("./syncManager");
    await pullStoreSettingsForRead(dispatch, tenantId);
  },
};

// Do not import the store value at module load time. The store itself imports
// localApi, which imports this module; eager access would create a cycle.
async function getStore() {
  return (await import("@/services/store/store")).store;
}

const REFRESH_TTL_MS = 15_000;
const lastRefreshAt = new Map<string, number>();
const refreshInFlight = new Map<string, Promise<void>>();

/** Online-first read: pull fresh data from server when online, then read local cache. */
export async function refreshIfOnline(entities: SyncEntity[]): Promise<void> {
  if (!(await isOnline())) return;

  const store = await getStore();
  const tenantId = store.getState().auth?.user?.tenantId;
  if (!tenantId) return;

  const dispatch = store.dispatch;
  await Promise.all(
    [...new Set(entities)].map(async (entity) => {
      const refreshKey = `${tenantId}:${entity}`;
      const now = Date.now();
      if (now - (lastRefreshAt.get(refreshKey) ?? 0) < REFRESH_TTL_MS) return;
      const active = refreshInFlight.get(refreshKey);
      if (active) return active;

      const refresh = ENTITY_PULL_MAP[entity](dispatch, tenantId)
        .catch((error) => {
          console.warn(`⚠️ Online-first refresh failed for ${entity}:`, error);
        })
        .finally(() => {
          refreshInFlight.delete(refreshKey);
        });
      refreshInFlight.set(refreshKey, refresh);
      await refresh;
      lastRefreshAt.set(refreshKey, Date.now());
    }),
  );
}

/** Push pending local changes to server when online. */
export function pushIfOnline(): void {
  void (async () => {
    if (!(await isOnline())) return;
    const store = await getStore();
    const { syncNow } = await import("./syncManager");
    await syncNow(store.dispatch, store.getState, { silent: true });
  })();
}
