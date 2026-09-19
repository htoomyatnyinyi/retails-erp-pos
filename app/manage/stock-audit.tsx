import React, { useState, useMemo, useCallback } from "react";
import {
  View,
  Text,
  TouchableOpacity,
  FlatList,
  TextInput,
  Alert,
  ActivityIndicator,
  ScrollView,
} from "react-native";
import { router } from "expo-router";
import { MaterialIcons } from "@expo/vector-icons";
import { Screen, Card, Pill, Header, MetricCard } from "@/components/app-ui";
import { BarcodeScannerModal } from "@/components/barcode-scanner-modal";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import {
  useGetLocalInventoryQuery,
  useGetLocalProductsQuery,
  useGetLocalVariantsQuery,
  useGetLocalStoresQuery,
  useAdjustLocalStockMutation,
} from "@/services/features/offline/localApi";
import { SafeAreaView } from "react-native-safe-area-context";

type FilterMode = "ALL" | "VARIANCE" | "UNCOUNTED" | "MATCHED";

export default function StockAuditScreen() {
  const { currentStoreId, user } = useAppSelector((state) => state.auth);
  const [selectedStoreId, setSelectedStoreId] = useState<string>(
    currentStoreId || "",
  );
  const [sessionActive, setSessionActive] = useState<boolean>(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [filterMode, setFilterMode] = useState<FilterMode>("ALL");
  const [showScanner, setShowScanner] = useState(false);

  // Map of inventory key (productId + (variantId || "")) to counted quantity
  const [countsMap, setCountsMap] = useState<Record<string, number>>({});

  // Queries
  const { data: stores = [] } = useGetLocalStoresQuery({ isActive: true });
  const {
    data: inventoryData = [],
    isLoading: isInventoryLoading,
    refetch: refetchInventory,
  } = useGetLocalInventoryQuery({
    storeId: selectedStoreId || undefined,
  });
  const { data: productsData = [], refetch: refetchProducts } =
    useGetLocalProductsQuery({});
  const { data: variantsData = [] } = useGetLocalVariantsQuery(undefined);

  // Mutation
  const [adjustStock, { isLoading: isAdjusting }] =
    useAdjustLocalStockMutation();

  // Active store resolution
  const activeStore = useMemo(() => {
    if (!selectedStoreId) return stores[0];
    return stores.find(
      (s: any) => s.id === selectedStoreId || s.remoteId === selectedStoreId,
    );
  }, [stores, selectedStoreId]);

  // Set default store when loaded
  React.useEffect(() => {
    if (!selectedStoreId && stores.length > 0) {
      setSelectedStoreId(stores[0].id);
    }
  }, [stores, selectedStoreId]);

  // Build combined audit list
  const auditList = useMemo(() => {
    if (!inventoryData || !productsData) return [];

    return inventoryData.map((inv: any) => {
      const product = productsData.find(
        (p: any) => p.id === inv.productId || p.remoteId === inv.productId,
      );
      const variant = inv.variantId
        ? variantsData.find(
            (v: any) => v.id === inv.variantId || v.remoteId === inv.variantId,
          )
        : undefined;

      const itemKey = inv.id;
      const countedQty = countsMap[itemKey];
      const isCounted = countedQty !== undefined;
      const systemQty = Number(inv.quantity || 0);
      const finalCounted = isCounted ? countedQty : systemQty;
      const variance = finalCounted - systemQty;

      return {
        ...inv,
        itemKey,
        productName: product?.name || "Unknown Product",
        variantName: variant?.name || null,
        sku: variant?.sku || product?.sku || "N/A",
        barcode: variant?.barcode || product?.barcode || null,
        systemQty,
        countedQty: finalCounted,
        isCounted,
        variance,
      };
    });
  }, [inventoryData, productsData, variantsData, countsMap]);

  // Start Session
  const handleStartAudit = useCallback(() => {
    setCountsMap({});
    setSessionActive(true);
  }, []);

  // Handle Qty Update
  const updateCount = useCallback((itemKey: string, newQty: number) => {
    const validQty = Math.max(0, newQty);
    setCountsMap((prev) => ({
      ...prev,
      [itemKey]: validQty,
    }));
  }, []);

  // Handle Barcode Scan
  const handleBarcodeScan = useCallback(
    (scannedCode: string) => {
      const matchedItem = auditList.find(
        (item) =>
          item.barcode === scannedCode ||
          item.sku === scannedCode ||
          item.id === scannedCode,
      );

      if (matchedItem) {
        setCountsMap((prev) => {
          const current = prev[matchedItem.itemKey];
          return {
            ...prev,
            [matchedItem.itemKey]: current !== undefined ? current + 1 : 1,
          };
        });
      } else {
        Alert.alert(
          "Not Found",
          `No product/variant matched barcode: ${scannedCode}`,
        );
      }
    },
    [auditList],
  );

  // Filter items
  const filteredList = useMemo(() => {
    return auditList.filter((item) => {
      // Search
      if (searchQuery) {
        const q = searchQuery.toLowerCase();
        const matchesName = item.productName.toLowerCase().includes(q);
        const matchesVariant = item.variantName?.toLowerCase().includes(q);
        const matchesSku = item.sku.toLowerCase().includes(q);
        const matchesBarcode = item.barcode?.toLowerCase().includes(q);
        if (!matchesName && !matchesVariant && !matchesSku && !matchesBarcode) {
          return false;
        }
      }

      // Quick filter
      if (filterMode === "VARIANCE") return item.variance !== 0;
      if (filterMode === "UNCOUNTED") return !item.isCounted;
      if (filterMode === "MATCHED") return item.variance === 0;

      return true;
    });
  }, [auditList, searchQuery, filterMode]);

  // Metrics
  const totalItemsCount = auditList.length;
  const countedItemsCount = Object.keys(countsMap).length;
  const itemsWithVarianceCount = auditList.filter(
    (i) => i.variance !== 0,
  ).length;
  const totalGainQty = auditList
    .filter((i) => i.variance > 0)
    .reduce((sum, i) => sum + i.variance, 0);
  const totalLossQty = auditList
    .filter((i) => i.variance < 0)
    .reduce((sum, i) => sum + Math.abs(i.variance), 0);

  // Reconcile Stock
  const handleReconcile = useCallback(() => {
    const itemsToReconcile = auditList.filter((i) => i.variance !== 0);

    if (itemsToReconcile.length === 0) {
      Alert.alert(
        "No Variances",
        "All counted items match system inventory records exactly!",
      );
      return;
    }

    Alert.alert(
      "Confirm Stock Reconciliation",
      `Are you sure you want to reconcile ${itemsToReconcile.length} item(s)?\n\nTotal Gain: +${totalGainQty}\nTotal Loss: -${totalLossQty}\n\nThis will update physical inventory records and record count adjustment logs.`,
      [
        { text: "Cancel", style: "cancel" },
        {
          text: "Approve & Reconcile",
          style: "destructive",
          onPress: async () => {
            try {
              for (const item of itemsToReconcile) {
                await adjustStock({
                  productId: item.productId,
                  storeId: item.storeId,
                  variantId: item.variantId || undefined,
                  newQuantity: item.countedQty,
                  reason: `Stock Audit Take Session Reconciliation (Variance: ${item.variance > 0 ? `+${item.variance}` : item.variance})`,
                }).unwrap();
              }

              refetchInventory();
              refetchProducts();
              setSessionActive(false);
              setCountsMap({});
              Alert.alert(
                "Audit Completed!",
                `Successfully reconciled ${itemsToReconcile.length} item(s) to matched physical stock levels.`,
              );
            } catch (err: any) {
              Alert.alert(
                "Reconciliation Failed",
                err?.message || "Failed to complete stock adjustment.",
              );
            }
          },
        },
      ],
    );
  }, [
    auditList,
    totalGainQty,
    totalLossQty,
    adjustStock,
    refetchInventory,
    refetchProducts,
  ]);

  const renderAuditCard = ({ item }: { item: any }) => {
    const isGain = item.variance > 0;
    const isLoss = item.variance < 0;

    return (
      <Card className="mb-3">
        <View className="flex-row items-start justify-between">
          <View className="flex-1 pr-3">
            <Text className="text-white font-bold text-sm" numberOfLines={1}>
              {item.productName}
            </Text>
            {item.variantName && (
              <Text className="text-amber-300 text-xs font-semibold mt-0.5">
                Variant: {item.variantName}
              </Text>
            )}
            <View className="flex-row items-center gap-2 mt-1">
              <Text className="text-slate-400 text-[10px]">
                SKU: {item.sku}
              </Text>
              {item.barcode && (
                <Text className="text-slate-500 text-[10px]">
                  • Barcode: {item.barcode}
                </Text>
              )}
            </View>
          </View>

          {/* Variance Pill */}
          <View className="items-end">
            {item.variance === 0 ? (
              <View className="bg-slate-800 px-2 py-1 rounded-md border border-slate-700">
                <Text className="text-slate-400 text-[10px] font-bold">
                  MATCHED
                </Text>
              </View>
            ) : isGain ? (
              <View className="bg-emerald-500/20 px-2.5 py-1 rounded-md border border-emerald-500/40">
                <Text className="text-emerald-400 text-[10px] font-bold">
                  +{item.variance} GAIN
                </Text>
              </View>
            ) : (
              <View className="bg-rose-500/20 px-2.5 py-1 rounded-md border border-rose-500/40">
                <Text className="text-rose-400 text-[10px] font-bold">
                  {item.variance} LOSS
                </Text>
              </View>
            )}
          </View>
        </View>

        <View className="mt-3 pt-3 border-t border-white/5 flex-row items-center justify-between">
          {/* System Qty */}
          <View>
            <Text className="text-slate-500 text-[10px]">System Stock</Text>
            <Text className="text-slate-300 font-bold text-base">
              {item.systemQty}
            </Text>
          </View>

          {/* Counted Qty Input & Controls */}
          {sessionActive ? (
            <View className="flex-row items-center gap-2">
              <TouchableOpacity
                onPress={() => updateCount(item.itemKey, item.countedQty - 1)}
                className="w-8 h-8 rounded-lg bg-white/10 items-center justify-center border border-white/10"
              >
                <MaterialIcons name="remove" size={18} color="#cbd5e1" />
              </TouchableOpacity>

              <TextInput
                keyboardType="number-pad"
                value={String(item.countedQty)}
                onChangeText={(text) => {
                  const val = parseInt(text, 10);
                  updateCount(item.itemKey, Number.isNaN(val) ? 0 : val);
                }}
                className="bg-slate-900 text-sky-400 font-black text-center text-base rounded-lg border border-sky-500/40 px-3 py-1 min-w-[50px]"
              />

              <TouchableOpacity
                onPress={() => updateCount(item.itemKey, item.countedQty + 1)}
                className="w-8 h-8 rounded-lg bg-sky-500/20 items-center justify-center border border-sky-500/40"
              >
                <MaterialIcons name="add" size={18} color="#38bdf8" />
              </TouchableOpacity>
            </View>
          ) : (
            <View className="items-end">
              <Text className="text-slate-500 text-[10px]">Counted</Text>
              <Text className="text-sky-300 font-bold text-base">
                {item.countedQty}
              </Text>
            </View>
          )}
        </View>
      </Card>
    );
  };

  return (
    <Screen>
      {/* Header */}
      <SafeAreaView className="">
        {/* <View className="px-5 pt-3 pb-2"> */}
        <Header
          eyebrow="Inventory Management"
          title="Stock Audit & Take"
          subtitle={
            activeStore
              ? `Physical count & audit for ${activeStore.name}`
              : "Physical inventory reconciliation"
          }
          right={
            <TouchableOpacity
              onPress={() => router.back()}
              className="rounded-full bg-slate-800 p-2"
            >
              <MaterialIcons name="arrow-back" size={20} color="#cbd5e1" />
            </TouchableOpacity>
          }
        />
      </SafeAreaView>
      {/* <View className="px-5 pt-3 pb-2">
        <Header
          title="Stock Audit & Take"
          subtitle={
            activeStore
              ? `Physical count & audit for ${activeStore.name}`
              : "Physical inventory reconciliation"
          }
          showBack
          onBack={() => router.back()}
        />
      </View> */}

      {/* Store Filter Scroll */}
      <View className="mb-4">
        {/* <View className="px-5 mb-4"> */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={{ gap: 8 }}
        >
          {stores.map((st: any) => {
            const isSelected = selectedStoreId === st.id;
            return (
              <TouchableOpacity
                key={st.id}
                disabled={sessionActive}
                onPress={() => setSelectedStoreId(st.id)}
                className={`px-3.5 py-1.5 rounded-xl border flex-row items-center ${
                  isSelected
                    ? "bg-sky-500/20 border-sky-400/50"
                    : "bg-white/5 border-white/10 opacity-70"
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

      {/* Metrics Banner */}
      <View className="flex-row gap-2 mb-4">
        <MetricCard
          label="Total Items"
          value={totalItemsCount.toString()}
          tone="sky"
        />
        <MetricCard
          label="Variances"
          value={itemsWithVarianceCount.toString()}
          tone={itemsWithVarianceCount > 0 ? "amber" : "emerald"}
        />
        <MetricCard
          label="Net Gain/Loss"
          value={
            totalGainQty - totalLossQty >= 0
              ? `+${totalGainQty - totalLossQty}`
              : `-${totalLossQty - totalGainQty}`
          }
          tone={totalGainQty - totalLossQty >= 0 ? "emerald" : "rose"}
        />
      </View>

      {/* Session Action Control Bar */}
      <View className="mb-4 flex-row items-center gap-3">
        {!sessionActive ? (
          <TouchableOpacity
            onPress={handleStartAudit}
            className="flex-1 bg-sky-500 py-3 rounded-2xl flex-row items-center justify-center gap-2"
          >
            <MaterialIcons name="play-arrow" size={20} color="#0f172a" />
            <Text className="text-slate-950 font-bold text-sm">
              Start Audit Session
            </Text>
          </TouchableOpacity>
        ) : (
          <>
            <TouchableOpacity
              onPress={() => setShowScanner(true)}
              className="bg-sky-500/20 border border-sky-500/40 p-3 rounded-2xl flex-row items-center justify-center gap-2"
            >
              <MaterialIcons name="qr-code-scanner" size={20} color="#38bdf8" />
              <Text className="text-sky-300 font-bold text-xs">
                Scan Barcode
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              disabled={isAdjusting}
              onPress={handleReconcile}
              className="flex-1 bg-emerald-500 py-3 rounded-2xl flex-row items-center justify-center gap-2"
            >
              {isAdjusting ? (
                <ActivityIndicator color="#0f172a" size="small" />
              ) : (
                <>
                  <MaterialIcons
                    name="check-circle"
                    size={20}
                    color="#0f172a"
                  />
                  <Text className="text-slate-950 font-bold text-sm">
                    Reconcile Stock
                  </Text>
                </>
              )}
            </TouchableOpacity>
          </>
        )}
      </View>

      {/* Search & Filter Bar */}
      <View className="mb-3 flex-row items-center gap-2">
        <View className="flex-1 flex-row items-center bg-white/5 rounded-[18px] p-2 border border-white/10">
          <MaterialIcons name="search" size={18} color="#94a3b8" />
          <TextInput
            className="flex-1 ml-2 text-white text-xs font-medium"
            placeholder="Search item, SKU or barcode..."
            placeholderTextColor="#64748b"
            value={searchQuery}
            onChangeText={setSearchQuery}
          />
          {searchQuery.length > 0 && (
            <TouchableOpacity onPress={() => setSearchQuery("")}>
              <MaterialIcons name="close" size={14} color="#cbd5e1" />
            </TouchableOpacity>
          )}
        </View>
      </View>

      {/* Quick Filter Pills */}
      <View className="mb-3 flex-row gap-2">
        {(["ALL", "VARIANCE", "MATCHED"] as FilterMode[]).map((mode) => (
          <TouchableOpacity key={mode} onPress={() => setFilterMode(mode)}>
            <Pill
              label={
                mode === "ALL"
                  ? "All"
                  : mode === "VARIANCE"
                    ? "With Variance"
                    : "Matched"
              }
              tone={filterMode === mode ? "sky" : "amber"}
            />
          </TouchableOpacity>
        ))}
      </View>

      {/* Main Inventory List */}
      {isInventoryLoading ? (
        <View className="flex-1 items-center justify-center">
          <ActivityIndicator size="large" color="#38bdf8" />
        </View>
      ) : (
        <FlatList
          className="flex-1"
          data={filteredList}
          keyExtractor={(item, index) =>
            item?.itemKey ? String(item.itemKey) : String(index)
          }
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 100 }}
          renderItem={renderAuditCard}
          ListEmptyComponent={() => (
            <View className="items-center justify-center mt-12">
              <MaterialIcons name="fact-check" size={40} color="#64748b" />
              <Text className="text-white mt-3 font-bold text-base">
                No inventory items
              </Text>
              <Text className="text-slate-500 text-xs text-center mt-1 px-8">
                Select a valid store location or sync products to begin stock
                take.
              </Text>
            </View>
          )}
        />
      )}

      {/* Continuous Barcode Scanner Modal */}
      <BarcodeScannerModal
        visible={showScanner}
        onClose={() => setShowScanner(false)}
        onScan={handleBarcodeScan}
      />
    </Screen>
  );
}
