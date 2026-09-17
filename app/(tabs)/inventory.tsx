import {
  Card,
  Divider,
  Header,
  MetricCard,
  Pill,
  Screen,
  StatRow,
} from "@/components/app-ui";
import { BarcodeScannerModal } from "@/components/barcode-scanner-modal";
import {
  useAdjustLocalStockMutation,
  useCreateLocalBrandMutation,
  useCreateLocalInventoryMovementMutation,
  useCreateLocalProductMutation,
  useGetLocalBrandsQuery,
  useGetLocalCategoriesQuery,
  useGetLocalInventoryMovementsQuery,
  useGetLocalInventoryQuery,
  useGetLocalProductsQuery,
  useGetLocalVariantsQuery,
  useGetLocalStoresQuery,
} from "@/services/features/offline/localApi";
import { MaterialIcons } from "@expo/vector-icons";
import React, { useCallback, useState } from "react";
import { router } from "expo-router";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import { hasPermission } from "@/utils/auth/permissions";
import { useAllocateProductStockMutation } from "@/services/api/remoteApi";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

type ActiveTab = "stock" | "movements";

const formatInventoryDate = (value: unknown) => {
  if (!value) return "";
  const date = new Date(String(value));
  if (Number.isNaN(date.getTime())) return String(value);
  return date.toLocaleDateString();
};

export default function InventoryScreen() {
  const { currentStoreId, user } = useAppSelector((state) => state.auth);
  const canManageInventory = hasPermission(user, "MANAGE_INVENTORY");
  const [selectedStoreFilter, setSelectedStoreFilter] = useState<string | "ALL">("ALL");
  const [activeTab, setActiveTab] = useState<ActiveTab>("stock");
  const [searchQuery, setSearchQuery] = useState("");
  const [showAdjustModal, setShowAdjustModal] = useState(false);
  const [showMovementModal, setShowMovementModal] = useState(false);
  // const [showProductModal, setShowProductModal] = useState(false);
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [showAllocationModal, setShowAllocationModal] = useState(false);
  const [selectedAllocationProduct, setSelectedAllocationProduct] =
    useState<any>(null);
  const [selectedInventory, setSelectedInventory] = useState<any>(null);
  const [scannerMode, setScannerMode] = useState<"single" | "continuous">(
    "single",
  );
  const [scannedPreviewItems, setScannedPreviewItems] = useState<any[]>([]);

  const queryStoreId =
    selectedStoreFilter === "ALL"
      ? currentStoreId || undefined
      : selectedStoreFilter;

  // ✅ Queries
  const {
    data: inventoryData,
    isLoading: isInventoryLoading,
    refetch: refetchInventory,
  } = useGetLocalInventoryQuery({ storeId: queryStoreId });

  const {
    data: movementsData,
    isLoading: isMovementsLoading,
    refetch: refetchMovements,
  } = useGetLocalInventoryMovementsQuery({
    storeId: queryStoreId,
  });

  const { data: productsData, refetch: refetchProducts } =
    useGetLocalProductsQuery({});
  // console.log(productsData, "inventory products data at inventory screen");
  const { data: variantsData } = useGetLocalVariantsQuery(undefined);
  const { data: categories } = useGetLocalCategoriesQuery({});
  const { data: stores = [] } = useGetLocalStoresQuery({ isActive: true });
  const { data: brands, refetch: refetchBrands } = useGetLocalBrandsQuery({
    isActive: true,
  });

  // Mutations
  const [createMovement, { isLoading: isCreatingMovement }] =
    useCreateLocalInventoryMovementMutation();
  const [allocateProductStock, { isLoading: isAllocating }] =
    useAllocateProductStockMutation();
  const [adjustStock, { isLoading: isAdjusting }] =
    useAdjustLocalStockMutation();
  const [createProduct, { isLoading: isCreatingProduct }] =
    useCreateLocalProductMutation();

  // ✅ Build inventory items with product & brand details
  const inventoryWithDetails = React.useMemo(() => {
    if (!inventoryData || !productsData) return [];

    return inventoryData.map((inv: any) => {
      const product = productsData.find(
        (p: any) => p.id === inv.productId || p.remoteId === inv.productId,
      );
      const variant = inv.variantId
        ? variantsData?.find(
            (v: any) => v.id === inv.variantId || v.remoteId === inv.variantId,
          )
        : undefined;
      const variantOptions =
        variantsData?.filter(
          (candidate: any) =>
            candidate.productId === product?.id ||
            candidate.productId === product?.remoteId,
        ) ?? [];
      const brand = product?.brandId
        ? brands?.find((b: any) => b.id === product.brandId)
        : null;
      const store = inv.storeId
        ? stores?.find(
            (s: any) => s.id === inv.storeId || s.remoteId === inv.storeId,
          )
        : null;
      return {
        ...inv,
        name: product?.name || "Unknown Product",
        variantName: variant?.name || null,
        variantOptions,
        sku: variant?.sku || product?.sku || "N/A",
        barcode: variant?.barcode || product?.barcode || null,
        sellingPrice: variant?.price ?? product?.sellingPrice ?? 0,
        costPrice: variant?.costPrice ?? product?.costPrice ?? 0,
        manufacturingDate:
          (variant as any)?.manufacturingDate ??
          product?.manufacturingDate ??
          inv.manufacturingDate,
        expiryDate:
          (variant as any)?.expiryDate ?? product?.expiryDate ?? inv.expiryDate,
        isActive: variant?.isActive ?? product?.isActive ?? inv.isActive,
        categoryId: product?.categoryId,
        brandName: brand?.name || null,
        brandId: product?.brandId || null,
        storeName: store?.name || null,
      };
    });
  }, [inventoryData, productsData, variantsData, brands, stores]);

  // Computed values
  const filteredInventory = inventoryWithDetails.filter((item: any) => {
    if (!searchQuery) return true;
    const q = searchQuery.toLowerCase();
    return (
      item.name?.toLowerCase().includes(q) ||
      item.variantName?.toLowerCase().includes(q) ||
      item.sku?.toLowerCase().includes(q) ||
      item.brandName?.toLowerCase().includes(q)
    );
  });

  const inventoryGroups = React.useMemo(() => {
    const groups = new Map<string, any>();
    for (const row of filteredInventory) {
      const key = row.productId;
      const group = groups.get(key);
      if (group) group.rows.push(row);
      else groups.set(key, { ...row, rows: [row] });
    }
    return Array.from(groups.values());
  }, [filteredInventory]);

  const totalProducts = inventoryWithDetails.length;
  const lowStockCount = inventoryWithDetails.filter(
    (p: any) => p.quantity <= 10 && p.quantity > 0,
  ).length;
  const outOfStockCount = inventoryWithDetails.filter(
    (p: any) => p.quantity === 0,
  ).length;

  // ============================================
  // HANDLERS
  // ============================================

  const handleAdjustStock = useCallback(
    async (newQty: number, reason: string) => {
      if (!canManageInventory) {
        Alert.alert(
          "Permission required",
          "Inventory management permission is required.",
        );
        return;
      }
      if (!selectedInventory) return;
      try {
        await adjustStock({
          productId: selectedInventory.productId,
          storeId: selectedInventory.storeId,
          variantId: selectedInventory.variantId || undefined,
          newQuantity: newQty,
          reason,
        }).unwrap();
        setShowAdjustModal(false);
        setSelectedInventory(null);
        refetchInventory();
        refetchMovements();
        refetchProducts();
        Alert.alert("Success", "Stock adjusted successfully");
      } catch (err: any) {
        Alert.alert("Error", err?.message ?? "Failed to adjust stock");
      }
    },
    [
      selectedInventory,
      canManageInventory,
      adjustStock,
      refetchInventory,
      refetchMovements,
      refetchProducts,
    ],
  );

  const handleCreateMovement = useCallback(
    async (payload: {
      productId: string;
      variantId?: string;
      quantity: number;
      type: "IN" | "OUT";
      reason: string;
      tenantId: string;
      storeId: string;
      transferToStoreId?: string;
    }) => {
      try {
        if (!canManageInventory) {
          Alert.alert(
            "Permission required",
            "Inventory management permission is required.",
          );
          return;
        }
        if (!payload.tenantId || !payload.storeId) {
          throw new Error("Missing tenant or source store for movement");
        }
        if (!payload.quantity || payload.quantity <= 0) {
          throw new Error("Quantity must be greater than zero");
        }

        const sourceItem = inventoryWithDetails.find(
          (item: any) =>
            item.productId === payload.productId &&
            item.storeId === payload.storeId &&
            (payload.variantId
              ? item.variantId === payload.variantId
              : !item.variantId),
        );
        const available = Number(sourceItem?.quantity ?? 0);
        const sourceStoreName =
          stores.find((store: any) => store.id === payload.storeId)?.name ||
          "source store";
        const destinationStoreName =
          stores.find((store: any) => store.id === payload.transferToStoreId)
            ?.name || "destination store";

        if (payload.transferToStoreId) {
          if (payload.transferToStoreId === payload.storeId) {
            throw new Error("Choose a different destination store");
          }
          if (payload.quantity > available) {
            throw new Error(
              `Only ${available} available at ${sourceStoreName}`,
            );
          }

          const referenceId = `transfer-${Date.now()}-${Math.random()
            .toString(36)
            .slice(2, 8)}`;
          const base = {
            tenantId: payload.tenantId,
            productId: payload.productId,
            variantId: payload.variantId,
            quantity: payload.quantity,
          };

          // Always record local OUT+IN so stock moves immediately online and
          // offline. Sync pushes TRANSFER_OUT / TRANSFER_IN to the server.
          await createMovement({
            ...base,
            storeId: payload.storeId,
            type: "OUT",
            referenceId,
            referenceType: "STOCK_TRANSFER",
            reason:
              payload.reason || `Transfer out to ${destinationStoreName}`,
          }).unwrap();
          await createMovement({
            ...base,
            storeId: payload.transferToStoreId,
            type: "IN",
            referenceId,
            referenceType: "STOCK_TRANSFER",
            reason: payload.reason || `Transfer in from ${sourceStoreName}`,
          }).unwrap();

          setShowMovementModal(false);
          refetchInventory();
          refetchMovements();
          Alert.alert(
            "Transferred",
            `Moved ${payload.quantity} from ${sourceStoreName} to ${destinationStoreName}.`,
          );
          return;
        }

        if (payload.type === "OUT" && payload.quantity > available) {
          throw new Error(`Only ${available} available at ${sourceStoreName}`);
        }

        await createMovement({
          tenantId: payload.tenantId,
          productId: payload.productId,
          variantId: payload.variantId,
          quantity: payload.quantity,
          storeId: payload.storeId,
          type: payload.type,
          referenceId: `manual-${Date.now()}`,
          referenceType: "STOCK_ADJUSTMENT",
          reason: payload.reason,
        }).unwrap();

        setShowMovementModal(false);
        refetchInventory();
        refetchMovements();
        Alert.alert(
          "Success",
          payload.type === "IN"
            ? "Stock in recorded successfully"
            : "Stock out recorded successfully",
        );
      } catch (err: any) {
        Alert.alert("Error", err?.message ?? "Failed to create movement");
      }
    },
    [
      createMovement,
      refetchInventory,
      refetchMovements,
      inventoryWithDetails,
      stores,
      canManageInventory,
    ],
  );

  const handleCreateProduct = useCallback(
    async (payload: any) => {
      try {
        await createProduct({
          ...payload,
          storeId: "default", // TODO: Get from context
        }).unwrap();
        // setShowProductModal(false);
        refetchInventory();
        refetchProducts();
        refetchBrands();
        Alert.alert("Success", "Product created successfully");
      } catch (err: any) {
        Alert.alert("Error", err?.message ?? "Failed to create product");
      }
    },
    [createProduct, refetchInventory, refetchProducts, refetchBrands],
  );

  const resolveScannedInventory = useCallback(
    (data: string) => {
      // Also check variant barcodes directly
      const variant = variantsData?.find(
        (v: any) => v.barcode === data || v.sku === data,
      );
      if (variant) {
        return inventoryWithDetails.find(
          (inv: any) =>
            inv.variantId === variant.id || inv.variantId === variant.remoteId,
        );
      }
      return inventoryWithDetails.find(
        (p: any) => p.barcode === data || p.sku === data || p.id === data,
      );
    },
    [inventoryWithDetails, variantsData],
  );

  const handleScan = useCallback(
    (data: string) => {
      const inventory = resolveScannedInventory(data);

      if (scannerMode === "single") {
        setShowScannerModal(false);
        if (inventory) {
          setSelectedInventory(inventory);
          setShowAdjustModal(true);
        } else {
          Alert.alert(
            "Not Found",
            `No local product found for barcode/SKU:\n${data}`,
          );
        }
      } else {
        // Continuous mode — stage items in preview list
        if (inventory) {
          setScannedPreviewItems((prev) => {
            const existing = prev.find((item) => item.id === inventory.id);
            if (existing) {
              return prev.map((item) =>
                item.id === inventory.id
                  ? { ...item, scanCount: (item.scanCount || 1) + 1 }
                  : item,
              );
            }
            return [...prev, { ...inventory, scanCount: 1 }];
          });
        } else {
          Alert.alert("Not Found", `Barcode ${data} not found in inventory.`);
        }
      }
    },
    [resolveScannedInventory, scannerMode],
  );

  // ============================================
  // RENDER HELPERS
  // ============================================

  const getStockBadge = (qty: number) => {
    if (qty === 0) return { label: "OUT OF STOCK", tone: "rose" as const };
    if (qty <= 10) return { label: "LOW STOCK", tone: "amber" as const };
    return { label: "IN STOCK", tone: "emerald" as const };
  };

  const getMovementIcon = (type: string, referenceType?: string) => {
    const isTransfer =
      referenceType === "STOCK_TRANSFER" ||
      type === "TRANSFER" ||
      type === "TRANSFER_IN" ||
      type === "TRANSFER_OUT";
    if (isTransfer) {
      return { name: "swap-horiz" as const, color: "#a78bfa" };
    }
    switch (type) {
      case "IN":
        return { name: "arrow-downward" as const, color: "#34d399" };
      case "OUT":
        return { name: "arrow-upward" as const, color: "#f87171" };
      case "ADJUSTMENT":
        return { name: "tune" as const, color: "#fbbf24" };
      case "COUNT":
        return { name: "fact-check" as const, color: "#60a5fa" };
      default:
        return { name: "circle" as const, color: "#94a3b8" };
    }
  };

  const renderStockItem = ({ item }: { item: any }) => {
    if (
      item.rows?.length > 1 ||
      item.rows?.[0]?.variantName ||
      item.variantOptions?.length
    ) {
      const hasVariantRows = item.rows.some((row: any) => row.variantId);
      const totalStock = hasVariantRows
        ? item.rows.reduce(
            (total: number, row: any) => total + Number(row.quantity || 0),
            0,
          )
        : Number(item.rows?.[0]?.quantity || 0);
      return (
        <Card className="mb-3">
          <View className="flex-row items-center mb-3">
            <View className="h-11 w-11 rounded-2xl bg-white/8 items-center justify-center mr-3 border border-white/5">
              <MaterialIcons name="inventory-2" size={21} color="#94a3b8" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-bold text-sm" numberOfLines={1}>
                {item.name}
              </Text>

              <Text className="text-slate-400 text-[10px] mt-1">
                {item.variantOptions?.length || item.rows.length} variants • tap
                a row to adjust stock
              </Text>
              <Text className="text-emerald-300 text-[10px] font-bold mt-1">
                Total stock: {totalStock}
              </Text>
              {item.variantOptions?.length > 0 &&
                !item.rows.some((row: any) => row.variantId) && (
                  <Text className="text-amber-300/80 text-[10px] mt-1">
                    {item.variantOptions
                      .map((variant: any) => variant.name)
                      .join(" • ")}{" "}
                    (shared stock)
                  </Text>
                )}
            </View>
          </View>
          {canManageInventory &&
            item.variantOptions?.length > 0 &&
            !item.rows.some((row: any) => row.variantId) && (
              <TouchableOpacity
                className="mb-3 rounded-xl bg-amber-500/15 border border-amber-400/30 px-3 py-2"
                onPress={() => {
                  setSelectedAllocationProduct(item);
                  setShowAllocationModal(true);
                }}
              >
                <Text className="text-amber-200 text-center text-xs font-bold">
                  Allocate shared stock to variants
                </Text>
              </TouchableOpacity>
            )}
          {item.rows.map((variantRow: any) => {
            const badge = getStockBadge(variantRow.quantity);
            return (
              <TouchableOpacity
                disabled={!canManageInventory}
                key={variantRow.id}
                className="flex-row items-center py-3 px-3 mb-2 rounded-xl bg-white/5 border border-white/5"
                onPress={() => {
                  setSelectedInventory(variantRow);
                  setShowAdjustModal(true);
                }}
              >
                <View className="flex-1">
                  <Text className="text-amber-300 font-semibold text-xs">
                    {variantRow.variantName ||
                      (item.variantOptions?.length
                        ? "Shared product stock"
                        : "Variant")}
                  </Text>
                  <View className="flex-row items-center mt-1">
                    <Text className="text-slate-400 text-[10px]">
                      SKU: {variantRow.sku}
                    </Text>
                    {variantRow.storeName && (
                      <>
                        <Text className="text-slate-500 text-[9px] mx-1">•</Text>
                        <Text className="text-sky-300 text-[9px] font-bold">
                          🏬 {variantRow.storeName}
                        </Text>
                      </>
                    )}
                  </View>
                  <View className="flex-row flex-wrap gap-x-2 mt-1">
                    {variantRow.manufacturingDate && (
                      <Text className="text-slate-500 text-[9px]">
                        Made:{" "}
                        {formatInventoryDate(variantRow.manufacturingDate)}
                      </Text>
                    )}
                    {variantRow.expiryDate && (
                      <Text className="text-amber-300/80 text-[9px]">
                        Expires: {formatInventoryDate(variantRow.expiryDate)}
                      </Text>
                    )}
                    {variantRow.isActive !== undefined &&
                      variantRow.isActive !== null && (
                        <Text
                          className={`text-[9px] font-semibold ${variantRow.isActive ? "text-emerald-300" : "text-rose-300"}`}
                        >
                          {variantRow.isActive ? "Active" : "Inactive"}
                        </Text>
                      )}
                  </View>
                </View>
                <View className="items-end">
                  <Text className="text-white font-black text-base">
                    {variantRow.quantity}
                  </Text>
                  <Pill label={badge.label} tone={badge.tone} />
                </View>
              </TouchableOpacity>
            );
          })}
        </Card>
      );
    }

    const row = item.rows?.[0] || item;
    const badge = getStockBadge(row.quantity);
    return (
      <TouchableOpacity
        disabled={!canManageInventory}
        activeOpacity={0.8}
        onPress={() => {
          setSelectedInventory(row);
          setShowAdjustModal(true);
        }}
      >
        <Card className="mb-3">
          <View className="flex-row items-center">
            <View className="h-12 w-12 rounded-2xl bg-white/8 items-center justify-center mr-3 border border-white/5">
              <MaterialIcons name="inventory-2" size={22} color="#94a3b8" />
            </View>
            <View className="flex-1">
              <Text className="text-white font-bold text-sm" numberOfLines={1}>
                {row.name}
              </Text>
              {row.variantName && (
                <Text
                  className="text-amber-300/90 text-[10px] font-semibold mt-0.5"
                  numberOfLines={1}
                >
                  Variant: {row.variantName}
                </Text>
              )}
              <View className="flex-row items-center mt-0.5">
                <Text className="text-sky-300/80 text-[10px] font-bold uppercase tracking-[2px]">
                  {row.sku}
                </Text>
                {item.brandName && (
                  <>
                    <Text className="text-slate-500 text-[9px] mx-1">•</Text>
                    <Text className="text-purple-300/80 text-[9px] font-medium">
                      {item.brandName}
                    </Text>
                  </>
                )}
                {row.storeName && (
                  <>
                    <Text className="text-slate-500 text-[9px] mx-1">•</Text>
                    <View className="flex-row items-center bg-sky-500/10 border border-sky-500/30 px-1.5 py-0.5 rounded-md">
                      <MaterialIcons name="store" size={10} color="#38bdf8" />
                      <Text className="text-sky-300 text-[9px] font-bold ml-1">
                        {row.storeName}
                      </Text>
                    </View>
                  </>
                )}
              </View>
              <View className="flex-row flex-wrap gap-x-2 mt-1">
                {row.manufacturingDate && (
                  <Text className="text-slate-500 text-[9px]">
                    Made: {formatInventoryDate(row.manufacturingDate)}
                  </Text>
                )}
                {row.expiryDate && (
                  <Text className="text-amber-300/80 text-[9px]">
                    Expires: {formatInventoryDate(row.expiryDate)}
                  </Text>
                )}
                {row.isActive !== undefined && row.isActive !== null && (
                  <Text
                    className={`text-[9px] font-semibold ${row.isActive ? "text-emerald-300" : "text-rose-300"}`}
                  >
                    {row.isActive ? "Active" : "Inactive"}
                  </Text>
                )}
              </View>
            </View>
            <View className="items-end">
              <Text className="text-white font-black text-lg">
                {row.quantity}
              </Text>
              <Pill label={badge.label} tone={badge.tone} />
            </View>
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  const renderMovementItem = ({ item }: { item: any }) => {
    const isTransfer =
      item.referenceType === "STOCK_TRANSFER" ||
      ["TRANSFER", "TRANSFER_IN", "TRANSFER_OUT"].includes(item.type);
    const isIn = ["IN", "TRANSFER_IN"].includes(item.type);
    const icon = getMovementIcon(item.type, item.referenceType);
    const storeName =
      stores.find((store: any) => store.id === item.storeId)?.name ||
      item.storeId;
    const movementVariant = item.variantId
      ? variantsData?.find(
          (variant: any) =>
            variant.id === item.variantId ||
            variant.remoteId === item.variantId,
        )
      : undefined;
    const title = isTransfer
      ? isIn
        ? "Transfer in"
        : "Transfer out"
      : item.referenceType === "STOCK_ADJUSTMENT"
        ? isIn
          ? "Stock in"
          : "Stock out"
        : `${item.type} — ${item.referenceType}`;
    return (
      <Card className="mb-3">
        <View className="flex-row items-center">
          <View
            className="h-10 w-10 rounded-xl items-center justify-center mr-3"
            style={{ backgroundColor: `${icon.color}20` }}
          >
            <MaterialIcons name={icon.name} size={20} color={icon.color} />
          </View>
          <View className="flex-1">
            <Text className="text-white font-semibold text-sm">{title}</Text>
            <Text className="text-slate-400 text-xs mt-0.5">
              {item.reason ?? "No reason"}
            </Text>
            <Text className="text-slate-500 text-[10px] mt-0.5">
              Store: {storeName}
            </Text>
            {item.variantId && (
              <Text className="text-slate-500 text-[9px] mt-0.5">
                Variant: {movementVariant?.name || item.variantId}
              </Text>
            )}
          </View>
          <View className="items-end">
            <Text
              className={`font-black text-base ${
                isIn ? "text-emerald-400" : "text-rose-400"
              }`}
            >
              {isIn ? "+" : "-"}
              {item.quantity}
            </Text>
            <Text className="text-slate-500 text-[10px] mt-0.5">
              {new Date(item.createdAt).toLocaleDateString()}
            </Text>
          </View>
        </View>
      </Card>
    );
  };

  if (isInventoryLoading) {
    return (
      <Screen>
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#38bdf8" />
          <Text className="text-slate-400 mt-4">Loading inventory...</Text>
        </View>
      </Screen>
    );
  }

  return (
    <Screen padded={false}>
      <View className="px-5 pt-6 pb-2">
        <Header
          eyebrow="Warehouse"
          title="Inventory"
          subtitle="Track stock levels and movements"
          // right={
          //   canManageInventory ? (
          //     <TouchableOpacity
          //       className="bg-sky-500/20 px-3 py-1.5 rounded-full border border-sky-500/30 flex-row items-center"
          //       // onPress={() => setShowProductModal(true)}
          //     >
          //       <MaterialIcons name="add" size={16} color="#38bdf8" />
          //       <Text className="text-sky-400 font-bold text-xs ml-1">
          //         Product
          //       </Text>
          //     </TouchableOpacity>
          //   ) : undefined
          // }
        />
      </View>

      {/* Metrics */}
      <View className="flex-row gap-3 px-5 mb-5">
        <MetricCard
          // icon="inventory"
          label="Total"
          value={totalProducts.toString()}
          tone="sky"
        />
        <MetricCard
          // icon="warning"
          label="Low Stock"
          value={lowStockCount.toString()}
          tone={lowStockCount > 0 ? "amber" : "emerald"}
        />
        <MetricCard
          // icon="remove-shopping-cart"
          label="Out"
          value={outOfStockCount.toString()}
          tone={outOfStockCount > 0 ? "rose" : "emerald"}
        />
      </View>

      {/* Tabs */}
      <View className="flex-row items-center justify-between px-5 mb-4">
        <View className="flex-row">
          <TouchableOpacity
            className="mr-2"
            onPress={() => setActiveTab("stock")}
          >
            <Pill
              label="Stock Levels"
              tone={activeTab === "stock" ? "sky" : "amber"}
            />
          </TouchableOpacity>
          <TouchableOpacity
            className="mr-2"
            onPress={() => setActiveTab("movements")}
          >
            <Pill
              label="Movements"
              tone={activeTab === "movements" ? "sky" : "amber"}
            />
          </TouchableOpacity>
        </View>

        {canManageInventory && (
          <TouchableOpacity
            onPress={() => router.push("/manage/stock-audit")}
            className="flex-row items-center bg-sky-500/20 border border-sky-400/40 px-3 py-1.5 rounded-xl"
          >
            <MaterialIcons name="fact-check" size={14} color="#38bdf8" />
            <Text className="text-sky-300 font-bold text-xs ml-1.5">
              Stock Audit
            </Text>
          </TouchableOpacity>
        )}
      </View>

      {/* Store Filter (Stock tab only) */}
      {activeTab === "stock" && stores && stores.length > 0 && (
        <View className="mb-3 px-5">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ gap: 8, paddingRight: 20 }}
          >
            <TouchableOpacity
              onPress={() => setSelectedStoreFilter("ALL")}
              className={`px-3.5 py-1.5 rounded-xl border flex-row items-center ${
                selectedStoreFilter === "ALL"
                  ? "bg-sky-500/20 border-sky-400/50"
                  : "bg-white/5 border-white/10"
              }`}
            >
              <MaterialIcons
                name="storefront"
                size={14}
                color={selectedStoreFilter === "ALL" ? "#38bdf8" : "#94a3b8"}
              />
              <Text
                className={`text-xs font-semibold ml-1.5 ${
                  selectedStoreFilter === "ALL" ? "text-sky-300" : "text-slate-300"
                }`}
              >
                All Stores
              </Text>
            </TouchableOpacity>

            {stores.map((st: any) => {
              const isSelected = selectedStoreFilter === st.id;
              return (
                <TouchableOpacity
                  key={st.id}
                  onPress={() => setSelectedStoreFilter(st.id)}
                  className={`px-3.5 py-1.5 rounded-xl border flex-row items-center ${
                    isSelected
                      ? "bg-sky-500/20 border-sky-400/50"
                      : "bg-white/5 border-white/10"
                  }`}
                >
                  <MaterialIcons
                    name="store"
                    size={14}
                    color={isSelected ? "#38bdf8" : "#94a3b8"}
                  />
                  <Text
                    className={`text-xs font-semibold ml-1.5 ${
                      isSelected ? "text-sky-300" : "text-slate-300"
                    }`}
                  >
                    {st.name}
                  </Text>
                </TouchableOpacity>
              );
            })}
          </ScrollView>
        </View>
      )}

      {/* Search (Stock tab only) */}
      {activeTab === "stock" && (
        <View className="px-5 mb-4">
          <View className="flex-row items-center bg-white/5 rounded-[20px] px-4 py-1 border border-white/10">
            <MaterialIcons name="search" size={20} color="#94a3b8" />
            <TextInput
              className="flex-1 ml-3 text-white text-sm font-medium"
              placeholder="Search by name, SKU, or brand..."
              placeholderTextColor="#64748b"
              value={searchQuery}
              onChangeText={setSearchQuery}
            />
            {searchQuery.length > 0 ? (
              <TouchableOpacity
                onPress={() => setSearchQuery("")}
                className="bg-white/10 p-1.5 rounded-full"
              >
                <MaterialIcons name="close" size={14} color="#cbd5e1" />
              </TouchableOpacity>
            ) : (
              <TouchableOpacity
                onPress={() => setShowScannerModal(true)}
                className="bg-sky-500/20 p-1.5 rounded-full border border-sky-500/30"
              >
                <MaterialIcons
                  name="qr-code-scanner"
                  size={16}
                  color="#38bdf8"
                />
              </TouchableOpacity>
            )}
          </View>
        </View>
      )}

      {/* Content */}
      {activeTab === "stock" ? (
        <FlatList
          data={inventoryGroups}
          keyExtractor={(item) => item.productId}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
          renderItem={renderStockItem}
          ListEmptyComponent={
            <View className="items-center justify-center mt-16">
              <View className="h-20 w-20 bg-white/5 rounded-full items-center justify-center border border-white/10">
                <MaterialIcons name="inventory" size={32} color="#64748b" />
              </View>
              <Text className="text-white mt-4 text-lg font-bold">
                No inventory items
              </Text>
              <Text className="text-slate-500 mt-2 text-sm text-center px-10">
                Sync products from the server or create them locally.
              </Text>
            </View>
          }
        />
      ) : (
        <FlatList
          data={movementsData ?? []}
          keyExtractor={(item: any) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
          renderItem={renderMovementItem}
          ListEmptyComponent={
            <View className="items-center justify-center mt-16">
              <View className="h-20 w-20 bg-white/5 rounded-full items-center justify-center border border-white/10">
                <MaterialIcons name="swap-vert" size={32} color="#64748b" />
              </View>
              <Text className="text-white mt-4 text-lg font-bold">
                No movements yet
              </Text>
              <Text className="text-slate-500 mt-2 text-sm text-center px-10">
                Stock adjustments and movements will appear here.
              </Text>
            </View>
          }
        />
      )}

      {/* FAB — New Movement */}
      {canManageInventory && (
        <TouchableOpacity
          className="absolute bottom-6 right-5 h-14 w-14 bg-sky-500 rounded-full items-center justify-center shadow-lg shadow-sky-500/30 border border-sky-400"
          activeOpacity={0.8}
          onPress={() => setShowMovementModal(true)}
        >
          <MaterialIcons name="add" size={28} color="#fff" />
        </TouchableOpacity>
      )}

      {/* ============================================ */}
      {/* ADJUST STOCK MODAL */}
      {/* ============================================ */}
      <AdjustStockModal
        visible={showAdjustModal}
        inventory={selectedInventory}
        isLoading={isAdjusting}
        onClose={() => {
          setShowAdjustModal(false);
          setSelectedInventory(null);
        }}
        onSubmit={handleAdjustStock}
      />

      {/* ============================================ */}
      {/* NEW MOVEMENT MODAL */}
      {/* ============================================ */}
      <NewMovementModal
        visible={showMovementModal}
        inventoryItems={inventoryWithDetails}
        stores={stores}
        isLoading={isCreatingMovement}
        onClose={() => setShowMovementModal(false)}
        onSubmit={handleCreateMovement}
      />

      <StockAllocationModal
        visible={showAllocationModal}
        product={selectedAllocationProduct}
        storeId={currentStoreId || ""}
        isLoading={isAllocating}
        onClose={() => {
          setShowAllocationModal(false);
          setSelectedAllocationProduct(null);
        }}
        onSubmit={async (allocations) => {
          if (!selectedAllocationProduct || !currentStoreId) return;
          try {
            await allocateProductStock({
              productId: selectedAllocationProduct.productId,
              storeId: currentStoreId,
              allocations,
            }).unwrap();
            setShowAllocationModal(false);
            setSelectedAllocationProduct(null);
            await refetchInventory();
            await refetchMovements();
            Alert.alert("Success", "Variant stock allocated successfully");
          } catch (error: any) {
            Alert.alert(
              "Allocation failed",
              error?.data?.message ||
                error?.message ||
                "Unable to allocate stock",
            );
          }
        }}
      />

      {/* ============================================ */}
      {/* NEW PRODUCT MODAL (with Brand support) */}
      {/* ============================================ */}
      {/* <NewProductModal
        visible={showProductModal}
        categories={categories ?? []}
        brands={brands ?? []}
        isLoading={isCreatingProduct}
        onClose={() => setShowProductModal(false)}
        onSubmit={handleCreateProduct}
        onBrandCreated={refetchBrands}
      /> */}

      {/* ============================================ */}
      {/* SCANNER MODAL */}
      {/* ============================================ */}
      <BarcodeScannerModal
        visible={showScannerModal}
        onClose={() => {
          setShowScannerModal(false);
          setScannedPreviewItems([]);
        }}
        onScan={handleScan}
        allowModeToggle
        mode={scannerMode}
        onModeChange={setScannerMode}
        bottomContent={
          scannerMode === "continuous" && scannedPreviewItems.length > 0 ? (
            <View className="bg-black/90 p-4 border-t border-white/20 rounded-t-3xl h-full pb-8">
              <View className="flex-row justify-between items-center mb-3">
                <Text className="text-white font-bold text-lg">
                  Scanned ({scannedPreviewItems.length})
                </Text>
                <TouchableOpacity
                  className="bg-red-500/80 px-4 py-1.5 rounded-full"
                  onPress={() => setScannedPreviewItems([])}
                >
                  <Text className="text-white font-bold text-xs">
                    Clear All
                  </Text>
                </TouchableOpacity>
              </View>
              <FlatList
                data={scannedPreviewItems}
                keyExtractor={(item) => item.id}
                renderItem={({ item }) => (
                  <TouchableOpacity
                    className="flex-row justify-between items-center py-3 border-b border-white/10"
                    onPress={() => {
                      setShowScannerModal(false);
                      setScannedPreviewItems([]);
                      setSelectedInventory(item);
                      setShowAdjustModal(true);
                    }}
                  >
                    <View className="flex-1 pr-2">
                      <Text className="text-white font-bold">
                        {item.name}
                        {item.variantName ? ` — ${item.variantName}` : ""}
                      </Text>
                      <Text className="text-white/60 text-xs mt-1">
                        SKU: {item.sku} • Stock: {item.quantity}
                      </Text>
                    </View>
                    <View className="flex-row items-center">
                      <View className="bg-white/20 px-3 py-1 rounded-full mr-2">
                        <Text className="text-white font-bold">
                          x{item.scanCount || 1}
                        </Text>
                      </View>
                      <MaterialIcons
                        name="chevron-right"
                        size={20}
                        color="#94a3b8"
                      />
                    </View>
                  </TouchableOpacity>
                )}
              />
            </View>
          ) : null
        }
      />
    </Screen>
  );
}

// ============================================
// ADJUST STOCK MODAL COMPONENT
// ============================================
function StockAllocationModal({
  visible,
  product,
  isLoading,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  product: any;
  storeId: string;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (
    allocations: Array<{ variantId: string; quantity: number }>,
  ) => void;
}) {
  const variants = product?.variantOptions || [];
  const totalStock = Number(product?.rows?.[0]?.quantity ?? 0);
  const [quantities, setQuantities] = useState<Record<string, string>>({});
  const allocatedTotal = variants.reduce(
    (sum: number, variant: any) => sum + Number(quantities[variant.id] || 0),
    0,
  );

  const reset = useCallback(() => {
    setQuantities(
      Object.fromEntries(variants.map((variant: any) => [variant.id, "0"])),
    );
  }, [product]);

  const submit = () => {
    if (allocatedTotal !== totalStock) {
      Alert.alert(
        "Total mismatch",
        `Allocate exactly ${totalStock} units across all variants.`,
      );
      return;
    }
    onSubmit(
      variants.map((variant: any) => ({
        variantId: variant.remoteId || variant.id,
        quantity: Number(quantities[variant.id] || 0),
      })),
    );
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={reset}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1 justify-end"
      >
        <View className="bg-black/60 flex-1 justify-end">
          <View className="bg-slate-900 rounded-t-4xl p-6 border-t border-white/10">
            <View className="flex-row items-center justify-between mb-4">
              <View>
                <Text className="text-white font-black text-xl">
                  Allocate Variant Stock
                </Text>
                <Text className="text-slate-400 text-xs mt-1">
                  {product?.name} • Total: {totalStock}
                </Text>
              </View>

              <TouchableOpacity
                onPress={onClose}
                className="bg-white/10 p-2 rounded-full"
              >
                <MaterialIcons name="close" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView keyboardShouldPersistTaps="handled">
              {variants.map((variant: any) => (
                <View key={variant.id} className="mb-3">
                  <Text className="text-white font-semibold text-sm mb-2">
                    {variant.name}
                  </Text>
                  <TextInput
                    value={quantities[variant.id] ?? "0"}
                    onChangeText={(value) =>
                      setQuantities((current) => ({
                        ...current,
                        [variant.id]: value.replace(/[^0-9]/g, ""),
                      }))
                    }
                    keyboardType="number-pad"
                    placeholder="0"
                    placeholderTextColor="#64748b"
                    className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-white"
                  />
                </View>
              ))}
            </ScrollView>

            <Text
              className={`text-center text-xs font-bold my-3 ${
                allocatedTotal === totalStock
                  ? "text-emerald-400"
                  : "text-amber-400"
              }`}
            >
              Allocated {allocatedTotal} / {totalStock}
            </Text>
            <TouchableOpacity
              disabled={isLoading}
              onPress={submit}
              className="rounded-2xl bg-emerald-500 py-4"
            >
              {isLoading ? (
                <ActivityIndicator color="#fff" />
              ) : (
                <Text className="text-white text-center font-black">
                  Save Allocation
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

function AdjustStockModal({
  visible,
  inventory,
  isLoading,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  inventory: any;
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (qty: number, reason: string) => void;
}) {
  const [newQty, setNewQty] = useState("");
  const [reason, setReason] = useState("");

  const handleOpen = useCallback(() => {
    setNewQty(inventory?.quantity?.toString() ?? "0");
    setReason("");
  }, [inventory]);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={handleOpen}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="bg-slate-900 rounded-t-4xl border-t border-white/10 p-6">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-white font-black text-xl">
                Adjust Stock
              </Text>
              <TouchableOpacity
                onPress={onClose}
                className="bg-white/10 p-2 rounded-full"
              >
                <MaterialIcons name="close" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            {inventory && (
              <Card className="mb-5">
                <StatRow label="Product" value={inventory.name} />
                {inventory.brandName && (
                  <>
                    <Divider />
                    <StatRow label="Brand" value={inventory.brandName} />
                  </>
                )}
                <Divider />
                <StatRow label="SKU" value={inventory.sku} />
                <Divider />
                <StatRow
                  label="Current Stock"
                  value={inventory.quantity?.toString() ?? "0"}
                />
                {inventory.variantId && (
                  <>
                    <Divider />
                    <StatRow
                      label="Variant"
                      value={inventory.variantName || inventory.variantId}
                    />
                  </>
                )}
              </Card>
            )}

            <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
              New Quantity
            </Text>
            <TextInput
              className="bg-white/5 text-white text-lg font-bold rounded-2xl px-4 py-3 border border-white/10 mb-4"
              keyboardType="number-pad"
              value={newQty}
              onChangeText={setNewQty}
              placeholder="0"
              placeholderTextColor="#64748b"
            />

            <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
              Reason
            </Text>
            <TextInput
              className="bg-white/5 text-white text-sm rounded-2xl px-4 py-3 border border-white/10 mb-6"
              value={reason}
              onChangeText={setReason}
              placeholder="e.g. Physical count correction"
              placeholderTextColor="#64748b"
              multiline
            />

            <TouchableOpacity
              className={`bg-sky-500 rounded-2xl py-4 items-center border border-sky-400 ${
                isLoading ? "opacity-60" : ""
              }`}
              onPress={() => onSubmit(Number(newQty), reason)}
              disabled={isLoading || !newQty}
              activeOpacity={0.8}
            >
              {isLoading ? (
                <ActivityIndicator color="white" />
              ) : (
                <Text className="text-white font-bold text-lg">
                  Confirm Adjustment
                </Text>
              )}
            </TouchableOpacity>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// ============================================
// NEW MOVEMENT MODAL COMPONENT
// ============================================
function NewMovementModal({
  visible,
  inventoryItems,
  stores,
  isLoading,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  inventoryItems: any[];
  stores: any[];
  isLoading: boolean;
  onClose: () => void;
  onSubmit: (payload: {
    productId: string;
    variantId?: string;
    quantity: number;
    type: "IN" | "OUT";
    reason: string;
    tenantId: string;
    storeId: string;
    transferToStoreId?: string;
  }) => void;
}) {
  const [selectedInventoryId, setSelectedInventoryId] = useState("");
  const [quantity, setQuantity] = useState("");
  const [movementType, setMovementType] = useState<"IN" | "OUT">("IN");
  const [movementMode, setMovementMode] = useState<"STOCK" | "TRANSFER">(
    "STOCK",
  );
  const [targetStoreId, setTargetStoreId] = useState("");
  const [reason, setReason] = useState("");
  const [productSearch, setProductSearch] = useState("");

  const handleOpen = useCallback(() => {
    setSelectedInventoryId("");
    setQuantity("");
    setMovementType("IN");
    setMovementMode("STOCK");
    setTargetStoreId("");
    setReason("");
    setProductSearch("");
  }, []);

  const filteredItems = inventoryItems.filter((item: any) => {
    if (!productSearch) return true;
    const q = productSearch.toLowerCase();
    return (
      item.name?.toLowerCase().includes(q) ||
      item.sku?.toLowerCase().includes(q) ||
      item.brandName?.toLowerCase().includes(q)
    );
  });

  const selectedItem = inventoryItems.find(
    (item: any) => item.id === selectedInventoryId,
  );
  const sourceStore = stores.find(
    (store: any) => store.id === selectedItem?.storeId,
  );
  const destinationStore = stores.find(
    (store: any) => store.id === targetStoreId,
  );
  const destinationStores = stores.filter(
    (store: any) => store.id !== selectedItem?.storeId,
  );
  const quantityNumber = Number(quantity) || 0;
  const canSubmit =
    !!selectedInventoryId &&
    quantityNumber > 0 &&
    (movementMode === "STOCK" || !!targetStoreId);

  return (
    <Modal
      visible={visible}
      transparent
      animationType="slide"
      onShow={handleOpen}
      onRequestClose={onClose}
    >
      <KeyboardAvoidingView
        behavior={Platform.OS === "ios" ? "padding" : "height"}
        className="flex-1"
      >
        <View className="flex-1 justify-end bg-black/60">
          <View className="bg-slate-900 rounded-t-4xl border-t border-white/10 p-6 max-h-[85%]">
            <View className="flex-row items-center justify-between mb-6">
              <Text className="text-white font-black text-xl">
                {movementMode === "TRANSFER"
                  ? "Transfer Between Stores"
                  : "New Movement"}
              </Text>
              <TouchableOpacity
                onPress={onClose}
                className="bg-white/10 p-2 rounded-full"
              >
                <MaterialIcons name="close" size={18} color="#94a3b8" />
              </TouchableOpacity>
            </View>

            <ScrollView showsVerticalScrollIndicator={false}>
              <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
                Action
              </Text>
              <View className="flex-row gap-3 mb-5">
                <TouchableOpacity
                  className={`flex-1 rounded-2xl py-3 items-center border ${
                    movementMode === "STOCK"
                      ? "bg-sky-500/20 border-sky-500/40"
                      : "bg-white/5 border-white/10"
                  }`}
                  onPress={() => {
                    setMovementMode("STOCK");
                    setTargetStoreId("");
                  }}
                >
                  <MaterialIcons
                    name="tune"
                    size={20}
                    color={movementMode === "STOCK" ? "#38bdf8" : "#64748b"}
                  />
                  <Text
                    className={`font-bold text-sm mt-1 ${
                      movementMode === "STOCK"
                        ? "text-sky-300"
                        : "text-slate-400"
                    }`}
                  >
                    Adjust stock
                  </Text>
                </TouchableOpacity>
                <TouchableOpacity
                  className={`flex-1 rounded-2xl py-3 items-center border ${
                    movementMode === "TRANSFER"
                      ? "bg-violet-500/20 border-violet-500/40"
                      : "bg-white/5 border-white/10"
                  }`}
                  onPress={() => setMovementMode("TRANSFER")}
                >
                  <MaterialIcons
                    name="swap-horiz"
                    size={20}
                    color={movementMode === "TRANSFER" ? "#a78bfa" : "#64748b"}
                  />
                  <Text
                    className={`font-bold text-sm mt-1 ${
                      movementMode === "TRANSFER"
                        ? "text-violet-300"
                        : "text-slate-400"
                    }`}
                  >
                    Store transfer
                  </Text>
                </TouchableOpacity>
              </View>

              {movementMode === "STOCK" && (
                <>
                  <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
                    Type
                  </Text>
                  <View className="flex-row gap-3 mb-5">
                    <TouchableOpacity
                      className={`flex-1 rounded-2xl py-3 items-center border ${
                        movementType === "IN"
                          ? "bg-emerald-500/20 border-emerald-500/40"
                          : "bg-white/5 border-white/10"
                      }`}
                      onPress={() => setMovementType("IN")}
                    >
                      <MaterialIcons
                        name="arrow-downward"
                        size={20}
                        color={movementType === "IN" ? "#34d399" : "#64748b"}
                      />
                      <Text
                        className={`font-bold text-sm mt-1 ${
                          movementType === "IN"
                            ? "text-emerald-400"
                            : "text-slate-400"
                        }`}
                      >
                        Stock In
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className={`flex-1 rounded-2xl py-3 items-center border ${
                        movementType === "OUT"
                          ? "bg-rose-500/20 border-rose-500/40"
                          : "bg-white/5 border-white/10"
                      }`}
                      onPress={() => setMovementType("OUT")}
                    >
                      <MaterialIcons
                        name="arrow-upward"
                        size={20}
                        color={movementType === "OUT" ? "#f87171" : "#64748b"}
                      />
                      <Text
                        className={`font-bold text-sm mt-1 ${
                          movementType === "OUT"
                            ? "text-rose-400"
                            : "text-slate-400"
                        }`}
                      >
                        Stock Out
                      </Text>
                    </TouchableOpacity>
                  </View>
                </>
              )}

              {/* Product Selection */}
              <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
                Product
              </Text>
              {selectedItem ? (
                <Card className="mb-4">
                  <View className="flex-row items-center justify-between">
                    <View className="flex-1">
                      <Text className="text-white font-bold">
                        {selectedItem.name}
                      </Text>
                      {selectedItem.variantName && (
                        <Text className="text-amber-300 font-bold text-xs mt-1">
                          Variant: {selectedItem.variantName}
                        </Text>
                      )}
                      <View className="flex-row items-center mt-0.5">
                        <Text className="text-sky-300/60 text-xs">
                          {selectedItem.sku}
                        </Text>
                        {selectedItem.brandName && (
                          <>
                            <Text className="text-slate-500 text-[9px] mx-1">
                              •
                            </Text>
                            <Text className="text-purple-300/60 text-[9px]">
                              {selectedItem.brandName}
                            </Text>
                          </>
                        )}
                      </View>
                      <Text className="text-slate-400 text-xs mt-0.5">
                        At {sourceStore?.name || "this store"}:{" "}
                        {selectedItem.quantity} in stock
                      </Text>
                    </View>
                    <TouchableOpacity
                      onPress={() => {
                        setSelectedInventoryId("");
                        setTargetStoreId("");
                      }}
                      className="bg-white/10 p-1.5 rounded-full"
                    >
                      <MaterialIcons name="close" size={14} color="#94a3b8" />
                    </TouchableOpacity>
                  </View>
                </Card>
              ) : (
                <>
                  <View className="flex-row items-center bg-white/5 rounded-2xl px-4 py-2 border border-white/10 mb-2">
                    <MaterialIcons name="search" size={18} color="#64748b" />
                    <TextInput
                      className="flex-1 ml-2 text-white text-sm"
                      placeholder="Search by name, SKU, or brand..."
                      placeholderTextColor="#64748b"
                      value={productSearch}
                      onChangeText={setProductSearch}
                    />
                  </View>
                  <View className="max-h-40 mb-4">
                    <ScrollView nestedScrollEnabled>
                      {filteredItems.slice(0, 10).map((item: any) => (
                        <TouchableOpacity
                          key={item.id}
                          className="flex-row items-center py-2.5 px-3 rounded-xl active:bg-white/5"
                          onPress={() => {
                            setSelectedInventoryId(item.id);
                            setTargetStoreId("");
                            setProductSearch("");
                          }}
                        >
                          <MaterialIcons
                            name="inventory-2"
                            size={16}
                            color="#64748b"
                          />
                          <View className="flex-1 ml-2">
                            <Text className="text-slate-200 font-medium text-sm">
                              {item.name}
                            </Text>
                            {item.variantName && (
                              <Text className="text-amber-300/80 text-[10px] mt-0.5">
                                Variant: {item.variantName}
                              </Text>
                            )}
                            {item.brandName && (
                              <Text className="text-purple-300/60 text-[9px]">
                                {item.brandName}
                              </Text>
                            )}
                          </View>
                          <Text className="text-slate-500 text-xs">
                            Stock: {item.quantity}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  </View>
                </>
              )}

              {movementMode === "TRANSFER" && selectedItem && (
                <View className="mb-5">
                  <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
                    Destination store
                  </Text>
                  {destinationStores.length === 0 ? (
                    <Text className="text-slate-500 text-sm mb-3">
                      No other stores available for transfer.
                    </Text>
                  ) : (
                    <ScrollView
                      horizontal
                      showsHorizontalScrollIndicator={false}
                    >
                      {destinationStores.map((store: any) => (
                        <TouchableOpacity
                          key={store.id}
                          className={`mr-2 px-4 py-3 rounded-xl border ${
                            targetStoreId === store.id
                              ? "bg-violet-500/20 border-violet-400"
                              : "bg-white/5 border-white/10"
                          }`}
                          onPress={() => setTargetStoreId(store.id)}
                        >
                          <Text className="text-white font-semibold">
                            {store.name}
                          </Text>
                          <Text className="text-slate-400 text-xs">
                            {store.code}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </ScrollView>
                  )}

                  {destinationStore && (
                    <View className="mt-4 rounded-2xl border border-violet-500/30 bg-violet-500/10 px-4 py-3">
                      <Text className="text-violet-200 font-bold text-sm">
                        {sourceStore?.name || "Source"} → {destinationStore.name}
                      </Text>
                      <Text className="text-slate-400 text-xs mt-1">
                        Moving stock out of {sourceStore?.name || "source"} and
                        into {destinationStore.name}.
                      </Text>
                    </View>
                  )}
                </View>
              )}

              {/* Quantity */}
              <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
                Quantity
              </Text>
              <TextInput
                className="bg-white/5 text-white text-lg font-bold rounded-2xl px-4 py-3 border border-white/10 mb-2"
                keyboardType="number-pad"
                value={quantity}
                onChangeText={setQuantity}
                placeholder="0"
                placeholderTextColor="#64748b"
              />
              {selectedItem &&
                (movementMode === "TRANSFER" || movementType === "OUT") && (
                  <Text className="text-slate-500 text-xs mb-4 ml-1">
                    Available: {selectedItem.quantity}
                  </Text>
                )}
              {!(
                selectedItem &&
                (movementMode === "TRANSFER" || movementType === "OUT")
              ) && <View className="mb-4" />}

              {/* Reason */}
              <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
                Reason
              </Text>
              <TextInput
                className="bg-white/5 text-white text-sm rounded-2xl px-4 py-3 border border-white/10 mb-6"
                value={reason}
                onChangeText={setReason}
                placeholder={
                  movementMode === "TRANSFER"
                    ? "e.g. Restock downtown branch"
                    : "e.g. New shipment received"
                }
                placeholderTextColor="#64748b"
                multiline
              />

              {/* Submit */}
              <TouchableOpacity
                className={`rounded-2xl py-4 items-center border mb-4 ${
                  movementMode === "TRANSFER"
                    ? "bg-violet-500 border-violet-400"
                    : movementType === "IN"
                      ? "bg-emerald-500 border-emerald-400"
                      : "bg-rose-500 border-rose-400"
                } ${isLoading || !canSubmit ? "opacity-50" : ""}`}
                onPress={() => {
                  const product = inventoryItems.find(
                    (item: any) => item.id === selectedInventoryId,
                  );
                  onSubmit({
                    productId: product?.productId || selectedInventoryId,
                    variantId: product?.variantId || undefined,
                    quantity: quantityNumber,
                    type: movementType,
                    reason,
                    tenantId: product?.tenantId,
                    storeId: product?.storeId,
                    transferToStoreId:
                      movementMode === "TRANSFER" ? targetStoreId : undefined,
                  });
                }}
                disabled={isLoading || !canSubmit}
                activeOpacity={0.8}
              >
                {isLoading ? (
                  <ActivityIndicator color="white" />
                ) : (
                  <Text className="text-white font-bold text-lg">
                    {movementMode === "TRANSFER"
                      ? destinationStore
                        ? `Transfer to ${destinationStore.name}`
                        : "Transfer to store"
                      : movementType === "IN"
                        ? "Record Stock In"
                        : "Record Stock Out"}
                  </Text>
                )}
              </TouchableOpacity>
            </ScrollView>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

// // ============================================
// // NEW PRODUCT MODAL COMPONENT (with Brand)
// // ============================================
// function NewProductModal({
//   visible,
//   categories,
//   brands,
//   isLoading,
//   onClose,
//   onSubmit,
//   onBrandCreated,
// }: {
//   visible: boolean;
//   categories: any[];
//   brands: any[];
//   isLoading: boolean;
//   onClose: () => void;
//   onSubmit: (payload: {
//     name: string;
//     sku: string;
//     barcode: string;
//     costPrice: number;
//     sellingPrice: number;
//     stockQuantity: number;
//     categoryId: string;
//     brandId?: string;
//   }) => void;
//   onBrandCreated: () => void;
// }) {
//   const [name, setName] = useState("");
//   const [sku, setSku] = useState("");
//   const [barcode, setBarcode] = useState("");
//   const [costPrice, setCostPrice] = useState("");
//   const [sellingPrice, setSellingPrice] = useState("");
//   const [stockQuantity, setStockQuantity] = useState("");
//   const [categoryId, setCategoryId] = useState("");
//   const [brandId, setBrandId] = useState("");
//   const [showCreateBrand, setShowCreateBrand] = useState(false);
//   const [newBrandName, setNewBrandName] = useState("");
//   const [newBrandDescription, setNewBrandDescription] = useState("");
//   const [isCreatingBrand, setIsCreatingBrand] = useState(false);
//   const [createBrand] = useCreateLocalBrandMutation();

//   const handleOpen = useCallback(() => {
//     setName("");
//     setSku("");
//     setBarcode("");
//     setCostPrice("");
//     setSellingPrice("");
//     setStockQuantity("");
//     setCategoryId("");
//     setBrandId("");
//     setShowCreateBrand(false);
//     setNewBrandName("");
//     setNewBrandDescription("");
//   }, []);

//   const handleCreateBrand = async () => {
//     if (!newBrandName.trim()) {
//       Alert.alert("Error", "Brand name is required");
//       return;
//     }
//     setIsCreatingBrand(true);
//     try {
//       const result = await createBrand({
//         tenantId: "default",
//         name: newBrandName.trim(),
//         description: newBrandDescription.trim() || undefined,
//         isActive: true,
//       }).unwrap();
//       await onBrandCreated();
//       setBrandId(result.id);
//       setShowCreateBrand(false);
//       setNewBrandName("");
//       setNewBrandDescription("");
//       Alert.alert("Success", "Brand created successfully");
//     } catch (err: any) {
//       Alert.alert("Error", err?.message || "Failed to create brand");
//     } finally {
//       setIsCreatingBrand(false);
//     }
//   };

//   return (
//     <Modal
//       visible={visible}
//       transparent
//       animationType="slide"
//       onShow={handleOpen}
//       onRequestClose={onClose}
//     >
//       <KeyboardAvoidingView
//         behavior={Platform.OS === "ios" ? "padding" : "height"}
//         className="flex-1"
//       >
//         <View className="flex-1 justify-end bg-black/60">
//           <View className="bg-slate-900 rounded-t-4xl border-t border-white/10 p-6 max-h-[90%]">
//             <View className="flex-row items-center justify-between mb-6">
//               <Text className="text-white font-black text-xl">New Product</Text>
//               <TouchableOpacity
//                 onPress={onClose}
//                 className="bg-white/10 p-2 rounded-full"
//               >
//                 <MaterialIcons name="close" size={18} color="#94a3b8" />
//               </TouchableOpacity>
//             </View>

//             <ScrollView showsVerticalScrollIndicator={false}>
//               <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
//                 Name *
//               </Text>
//               <TextInput
//                 className="bg-white/5 text-white text-base rounded-2xl px-4 py-3 border border-white/10 mb-4"
//                 value={name}
//                 onChangeText={setName}
//                 placeholder="Product Name"
//                 placeholderTextColor="#64748b"
//               />

//               <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
//                 Barcode / QR (Optional)
//               </Text>
//               <TextInput
//                 className="bg-white/5 text-white text-base rounded-2xl px-4 py-3 border border-white/10 mb-4"
//                 value={barcode}
//                 onChangeText={setBarcode}
//                 placeholder="Scan or leave empty to auto-generate"
//                 placeholderTextColor="#64748b"
//               />

//               <View className="flex-row gap-3">
//                 <View className="flex-1">
//                   <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
//                     SKU (Optional)
//                   </Text>
//                   <TextInput
//                     className="bg-white/5 text-white text-base rounded-2xl px-4 py-3 border border-white/10 mb-4"
//                     value={sku}
//                     onChangeText={setSku}
//                     placeholder="Auto-generated"
//                     placeholderTextColor="#64748b"
//                   />
//                 </View>
//                 <View className="flex-1">
//                   <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
//                     Initial Stock
//                   </Text>
//                   <TextInput
//                     className="bg-white/5 text-white text-base font-bold rounded-2xl px-4 py-3 border border-white/10 mb-4"
//                     keyboardType="number-pad"
//                     value={stockQuantity}
//                     onChangeText={setStockQuantity}
//                     placeholder="0"
//                     placeholderTextColor="#64748b"
//                   />
//                 </View>
//               </View>

//               <View className="flex-row gap-3">
//                 <View className="flex-1">
//                   <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
//                     Cost Price
//                   </Text>
//                   <TextInput
//                     className="bg-white/5 text-white text-base font-bold rounded-2xl px-4 py-3 border border-white/10 mb-4"
//                     keyboardType="decimal-pad"
//                     value={costPrice}
//                     onChangeText={setCostPrice}
//                     placeholder="0.00"
//                     placeholderTextColor="#64748b"
//                   />
//                 </View>
//                 <View className="flex-1">
//                   <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
//                     Selling Price *
//                   </Text>
//                   <TextInput
//                     className="bg-white/5 text-white text-base font-bold rounded-2xl px-4 py-3 border border-white/10 mb-4"
//                     keyboardType="decimal-pad"
//                     value={sellingPrice}
//                     onChangeText={setSellingPrice}
//                     placeholder="0.00"
//                     placeholderTextColor="#64748b"
//                   />
//                 </View>
//               </View>

//               {/* Category Selection */}
//               <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
//                 Category
//               </Text>
//               <ScrollView
//                 horizontal
//                 showsHorizontalScrollIndicator={false}
//                 className="mb-4"
//                 contentContainerStyle={{ paddingRight: 20 }}
//               >
//                 {categories.map((cat: any) => (
//                   <TouchableOpacity
//                     key={cat.id}
//                     className={`mr-2 px-4 py-2 rounded-full border ${
//                       categoryId === cat.id
//                         ? "bg-sky-500/20 border-sky-500/40"
//                         : "bg-white/5 border-white/10"
//                     }`}
//                     onPress={() => setCategoryId(cat.id)}
//                   >
//                     <Text
//                       className={`font-semibold text-sm ${
//                         categoryId === cat.id
//                           ? "text-sky-400"
//                           : "text-slate-300"
//                       }`}
//                     >
//                       {cat.name}
//                     </Text>
//                   </TouchableOpacity>
//                 ))}
//               </ScrollView>

//               {/* Brand Selection */}
//               <Text className="text-slate-400 font-semibold text-xs uppercase tracking-widest mb-2 ml-1">
//                 Brand (Optional)
//               </Text>
//               {showCreateBrand ? (
//                 <View className="mb-4 rounded-2xl border border-purple-500/30 bg-purple-500/10 p-4">
//                   <Text className="mb-2 text-xs font-bold uppercase tracking-[3px] text-purple-400">
//                     Create New Brand
//                   </Text>
//                   <TextInput
//                     className="bg-white/5 text-white text-base rounded-2xl px-4 py-3 border border-white/10 mb-3"
//                     value={newBrandName}
//                     onChangeText={setNewBrandName}
//                     placeholder="Brand Name"
//                     placeholderTextColor="#64748b"
//                   />
//                   <TextInput
//                     className="bg-white/5 text-white text-base rounded-2xl px-4 py-3 border border-white/10 mb-3"
//                     value={newBrandDescription}
//                     onChangeText={setNewBrandDescription}
//                     placeholder="Description (optional)"
//                     placeholderTextColor="#64748b"
//                   />
//                   <View className="flex-row gap-3">
//                     <TouchableOpacity
//                       className="flex-1 bg-white/10 rounded-2xl py-3 items-center"
//                       onPress={() => setShowCreateBrand(false)}
//                     >
//                       <Text className="text-white font-bold">Cancel</Text>
//                     </TouchableOpacity>
//                     <TouchableOpacity
//                       className={`flex-1 bg-purple-500 rounded-2xl py-3 items-center ${
//                         isCreatingBrand ? "opacity-50" : ""
//                       }`}
//                       onPress={handleCreateBrand}
//                       disabled={isCreatingBrand}
//                     >
//                       {isCreatingBrand ? (
//                         <ActivityIndicator color="white" />
//                       ) : (
//                         <Text className="text-white font-bold">Create</Text>
//                       )}
//                     </TouchableOpacity>
//                   </View>
//                 </View>
//               ) : (
//                 <>
//                   <ScrollView
//                     horizontal
//                     showsHorizontalScrollIndicator={false}
//                     className="mb-2"
//                     contentContainerStyle={{ paddingRight: 20 }}
//                   >
//                     {brands.map((brand: any) => (
//                       <TouchableOpacity
//                         key={brand.id}
//                         className={`mr-2 px-4 py-2 rounded-full border ${
//                           brandId === brand.id
//                             ? "bg-purple-500/20 border-purple-500/40"
//                             : "bg-white/5 border-white/10"
//                         }`}
//                         onPress={() => setBrandId(brand.id)}
//                       >
//                         <Text
//                           className={`font-semibold text-sm ${
//                             brandId === brand.id
//                               ? "text-purple-400"
//                               : "text-slate-300"
//                           }`}
//                         >
//                           {brand.name}
//                         </Text>
//                       </TouchableOpacity>
//                     ))}
//                   </ScrollView>
//                   <TouchableOpacity
//                     onPress={() => setShowCreateBrand(true)}
//                     className="border border-dashed border-purple-500/30 rounded-2xl py-3 items-center mb-4"
//                   >
//                     <Text className="text-purple-400">+ Create New Brand</Text>
//                   </TouchableOpacity>
//                 </>
//               )}

//               {/* Submit */}
//               <TouchableOpacity
//                 className={`bg-sky-500 rounded-2xl py-4 items-center border border-sky-400 mb-6 ${
//                   isLoading || !name || !sellingPrice ? "opacity-50" : ""
//                 }`}
//                 onPress={() =>
//                   onSubmit({
//                     name,
//                     sku,
//                     barcode,
//                     costPrice: Number(costPrice) || 0,
//                     sellingPrice: Number(sellingPrice) || 0,
//                     stockQuantity: Number(stockQuantity) || 0,
//                     categoryId,
//                     brandId: brandId || undefined,
//                   })
//                 }
//                 disabled={isLoading || !name || !sellingPrice}
//                 activeOpacity={0.8}
//               >
//                 {isLoading ? (
//                   <ActivityIndicator color="white" />
//                 ) : (
//                   <Text className="text-white font-bold text-lg">
//                     Create Product
//                   </Text>
//                 )}
//               </TouchableOpacity>
//             </ScrollView>
//           </View>
//         </View>
//       </KeyboardAvoidingView>
//     </Modal>
//   );
// }
