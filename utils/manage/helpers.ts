// utils/helpers.ts
// import { ModuleKey } from "@/types"; // We'll define ModuleKey later or keep inline
// import { ModuleKey } from "./types";

export type ModuleKey =
  | "staff"
  | "products"
  | "stores"
  | "categories"
  | "customers"
  | "suppliers"
  | "brands"
  | "sessions";

export function getModuleList(input: any) {
  const {
    moduleKey,
    staff,
    products,
    stores,
    categories,
    customers,
    suppliers,
    brands,
    sessions,
  } = input;
  if (moduleKey === "staff") return staff;
  if (moduleKey === "products") return products;
  if (moduleKey === "stores") return stores;
  if (moduleKey === "categories") return categories;
  if (moduleKey === "customers") return customers;
  if (moduleKey === "suppliers") return suppliers;
  if (moduleKey === "brands") return brands;
  // sessions sorted by openedAt descending
  return [...sessions].sort(
    (a, b) => new Date(b.openedAt).getTime() - new Date(a.openedAt).getTime(),
  );
}

export function getSubtitle(moduleKey: ModuleKey, item: any, stores?: any[]) {
  if (moduleKey === "staff") {
    const store = stores?.find(
      (s: any) =>
        s.id === item.storeId ||
        (s.remoteId && s.remoteId === item.storeId),
    );
    const storeName = store?.name || item.storeName || "Unassigned Store";
    return `${storeName} • ${item.role} • ${item.email ?? "no email"}`;
  }
  if (moduleKey === "products") {
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const store = stores?.find(
      (s: any) =>
        s.id === item.storeId ||
        (s.remoteId && s.remoteId === item.storeId),
    );
    const storePrefix = store?.name ? `🏬 ${store.name} • ` : "";
    const expDate = item.expiryDate
      ? ` • Exp: ${new Date(item.expiryDate).toLocaleDateString()}`
      : "";
    return variants.length
      ? `${storePrefix}${variants.length} variants • ${variants.map((v: any) => v.name).join(", ")}${expDate}`
      : `${storePrefix}SKU: ${item.sku || "N/A"} • Cost: $${Number(item.costPrice ?? 0).toFixed(2)}${expDate}`;
  }
  if (moduleKey === "stores") return item.address ?? "No address";
  if (moduleKey === "categories") return item.slug ?? "No slug";
  if (moduleKey === "customers") return item.phone ?? item.code;
  if (moduleKey === "suppliers")
    return item.phone ?? item.email ?? "No contact";
  if (moduleKey === "brands") return item.description ?? "No description";
  if (moduleKey === "sessions")
    return `${item.status} • ${item.openedAt ?? ""}`;
  return "";
}

export function getRightLabel(moduleKey: ModuleKey, item: any) {
  if (moduleKey === "staff") return item.isActive ? "Active" : "Inactive";
  if (moduleKey === "products") {
    const variants = Array.isArray(item.variants) ? item.variants : [];
    const stockInfo =
      item.totalStock !== undefined ? ` • 📦 ${item.totalStock}` : "";
    if (variants.length) {
      const prices = variants.map((v: any) => Number(v.price ?? 0));
      return `From $${Math.min(...prices).toFixed(2)}${stockInfo}`;
    }
    return `$${Number(item.sellingPrice ?? 0).toFixed(2)}${stockInfo}`;
  }
  if (moduleKey === "stores") return item.isActive ? "Open" : "Closed";
  if (moduleKey === "categories") return item.isActive ? "Live" : "Off";
  if (moduleKey === "customers") return item.tier ?? "BRONZE";
  if (moduleKey === "suppliers") {
    if (item.currentBalance !== undefined && item.currentBalance !== null) {
      return `$${Number(item.currentBalance).toFixed(2)}`;
    }
    return item.isActive ? "Active" : "Inactive";
  }
  if (moduleKey === "brands") return item.isActive ? "Active" : "Inactive";
  if (moduleKey === "sessions") return item.status ?? "OPEN";
  return "";
}

export function getIcon(moduleKey: ModuleKey) {
  if (moduleKey === "staff") return "groups";
  if (moduleKey === "products") return "inventory-2";
  if (moduleKey === "stores") return "store";
  if (moduleKey === "categories") return "category";
  if (moduleKey === "customers") return "person";
  if (moduleKey === "suppliers") return "local-shipping";
  if (moduleKey === "brands") return "branding-watermark";
  if (moduleKey === "sessions") return "schedule";
  return "schedule";
}

export function generateBarcode() {
  const digits = `${Date.now()}`.slice(-12).padStart(12, "0");
  const checksum = digits.split("").reduce((sum, digit, index) => {
    return sum + Number(digit) * (index % 2 === 0 ? 1 : 3);
  }, 0);
  return `${digits}${(10 - (checksum % 10)) % 10}`;
}
