import {
  Card,
  Header,
  Pill,
  Screen,
  SectionTitle,
} from "@/components/app-ui";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import {
  useGetLocalInventoryMovementsQuery,
  useGetLocalProductsQuery,
  useGetLocalStoresQuery,
} from "@/services/features/offline/localApi";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useMemo, useState } from "react";
import {
  ActivityIndicator,
  RefreshControl,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type FilterType = "ALL" | "IN" | "OUT" | "ADJUSTMENT" | "TRANSFER" | "COUNT";

const TYPE_CONFIG: Record<
  string,
  { icon: keyof typeof MaterialIcons.glyphMap; color: string; label: string }
> = {
  IN: { icon: "add-circle", color: "#34d399", label: "Stock In" },
  OUT: { icon: "remove-circle", color: "#f87171", label: "Stock Out" },
  ADJUSTMENT: {
    icon: "tune",
    color: "#fbbf24",
    label: "Adjustment",
  },
  TRANSFER: {
    icon: "swap-horiz",
    color: "#60a5fa",
    label: "Transfer",
  },
  COUNT: { icon: "fact-check", color: "#c084fc", label: "Count" },
  SALE: { icon: "shopping-cart", color: "#f87171", label: "Sale" },
};

export default function InventoryMovementsScreen() {
  const { currentStoreId } = useAppSelector((state) => state.auth);
  const [filterType, setFilterType] = useState<FilterType>("ALL");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: movements = [],
    isLoading,
    refetch: refetchMovements,
  } = useGetLocalInventoryMovementsQuery({
    storeId: currentStoreId || undefined,
    type: filterType === "ALL" ? undefined : filterType,
  });

  const { data: products = [] } = useGetLocalProductsQuery({});
  const { data: storeList = [] } = useGetLocalStoresQuery({});

  const getProductName = (productId: string) => {
    const found = products.find(
      (p: any) => p.id === productId || p.remoteId === productId,
    );
    return found?.name || productId?.slice(0, 8) || "Unknown Product";
  };

  const getStoreName = (storeId: string | null) => {
    if (!storeId) return "—";
    const found = storeList.find(
      (s: any) => s.id === storeId || s.remoteId === storeId,
    );
    return found?.name || storeId?.slice(0, 8) || "—";
  };

  // Summary stats
  const stats = useMemo(() => {
    const totalIn = movements
      .filter((m: any) => m.type === "IN")
      .reduce((sum: number, m: any) => sum + Math.abs(Number(m.quantity || 0)), 0);
    const totalOut = movements
      .filter((m: any) => m.type === "OUT" || m.type === "SALE")
      .reduce((sum: number, m: any) => sum + Math.abs(Number(m.quantity || 0)), 0);
    const totalAdjustments = movements.filter(
      (m: any) => m.type === "ADJUSTMENT",
    ).length;
    return {
      totalMovements: movements.length,
      totalIn,
      totalOut,
      totalAdjustments,
    };
  }, [movements]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      await refetchMovements();
    } finally {
      setIsRefreshing(false);
    }
  };

  const formatDate = (dateStr: string | null | undefined) => {
    if (!dateStr) return "—";
    const d = new Date(dateStr);
    return d.toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  };

  // Group by date
  const groupedMovements = useMemo(() => {
    const groups: Record<string, any[]> = {};
    for (const m of movements as any[]) {
      const dateKey = new Date(m.createdAt).toDateString();
      if (!groups[dateKey]) groups[dateKey] = [];
      groups[dateKey].push(m);
    }
    // Sort keys descending
    return Object.entries(groups).sort(
      ([a], [b]) => new Date(b).getTime() - new Date(a).getTime(),
    );
  }, [movements]);

  return (
    <Screen padded={false}>
      <SafeAreaView className="flex-1 bg-slate-950">
        {/* Header */}
        <View className="px-5 pt-6 pb-2">
          <View className="flex-row items-center mb-3">
            <TouchableOpacity
              onPress={() => router.back()}
              className="mr-3 w-9 h-9 rounded-full bg-slate-800 items-center justify-center"
            >
              <MaterialIcons name="arrow-back" size={20} color="#94a3b8" />
            </TouchableOpacity>
            <Header
              eyebrow="Inventory"
              title="Stock Movements"
              subtitle="All stock in/out, adjustments & transfers"
            />
          </View>
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text className="text-slate-400 mt-4 font-medium">
              Loading movements...
            </Text>
          </View>
        ) : (
          <ScrollView
            className="px-5"
            contentContainerStyle={{ paddingBottom: 60 }}
            refreshControl={
              <RefreshControl
                refreshing={isRefreshing}
                onRefresh={onRefresh}
                tintColor="#38bdf8"
              />
            }
            showsVerticalScrollIndicator={false}
          >
            {/* Summary Cards */}
            <View className="flex-row flex-wrap gap-3 mb-5">
              <View className="w-[31%]">
                <Card>
                  <Text className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    Total
                  </Text>
                  <Text className="text-white text-xl font-black mt-0.5">
                    {stats.totalMovements}
                  </Text>
                </Card>
              </View>
              <View className="w-[31%]">
                <Card>
                  <Text className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    Stock In
                  </Text>
                  <Text className="text-emerald-400 text-xl font-black mt-0.5">
                    +{stats.totalIn}
                  </Text>
                </Card>
              </View>
              <View className="w-[31%]">
                <Card>
                  <Text className="text-slate-500 text-[9px] font-bold uppercase tracking-wider">
                    Stock Out
                  </Text>
                  <Text className="text-rose-400 text-xl font-black mt-0.5">
                    -{stats.totalOut}
                  </Text>
                </Card>
              </View>
            </View>

            {/* Filter Pills */}
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mb-4"
              contentContainerStyle={{ gap: 8 }}
            >
              {(
                [
                  "ALL",
                  "IN",
                  "OUT",
                  "ADJUSTMENT",
                  "TRANSFER",
                  "COUNT",
                ] as FilterType[]
              ).map((type) => {
                const active = filterType === type;
                return (
                  <TouchableOpacity
                    key={type}
                    onPress={() => setFilterType(type)}
                    className={`rounded-full border px-3.5 py-2 flex-row items-center gap-1.5 ${
                      active
                        ? "border-sky-400/40 bg-sky-500/20"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    {type !== "ALL" && TYPE_CONFIG[type] && (
                      <MaterialIcons
                        name={TYPE_CONFIG[type].icon}
                        size={13}
                        color={active ? "#7dd3fc" : "#64748b"}
                      />
                    )}
                    <Text
                      className={`text-[10px] font-bold uppercase tracking-wider ${
                        active ? "text-sky-200" : "text-slate-400"
                      }`}
                    >
                      {type}
                    </Text>
                  </TouchableOpacity>
                );
              })}
            </ScrollView>

            {/* Grouped Movement List */}
            {groupedMovements.length === 0 ? (
              <Card className="mb-4">
                <View className="items-center py-8">
                  <MaterialIcons
                    name="inventory"
                    size={40}
                    color="#334155"
                  />
                  <Text className="text-slate-500 text-sm mt-3 font-medium">
                    No stock movements found.
                  </Text>
                </View>
              </Card>
            ) : (
              groupedMovements.map(([dateStr, items]) => {
                const isToday =
                  dateStr === new Date().toDateString();
                const displayDate = isToday
                  ? "Today"
                  : new Date(dateStr).toLocaleDateString("en-US", {
                      weekday: "short",
                      month: "short",
                      day: "numeric",
                    });

                return (
                  <View key={dateStr} className="mb-5">
                    <View className="flex-row items-center gap-2 mb-2">
                      <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                        {displayDate}
                      </Text>
                      <View className="rounded-full bg-slate-700/50 px-2 py-0.5">
                        <Text className="text-[10px] font-bold text-slate-400">
                          {items.length}
                        </Text>
                      </View>
                    </View>

                    {items.map((movement: any) => {
                      const typeKey = movement.type?.toUpperCase() || "IN";
                      const config = TYPE_CONFIG[typeKey] || TYPE_CONFIG.IN;
                      const qty = Number(movement.quantity || 0);
                      const isPositive =
                        typeKey === "IN" ||
                        (typeKey === "ADJUSTMENT" && qty > 0);

                      return (
                        <Card key={movement.id} className="mb-2">
                          <View className="flex-row items-center justify-between">
                            <View className="flex-row items-center gap-2.5 flex-1">
                              <View
                                className="w-8 h-8 rounded-full items-center justify-center"
                                style={{
                                  backgroundColor: `${config.color}15`,
                                }}
                              >
                                <MaterialIcons
                                  name={config.icon}
                                  size={16}
                                  color={config.color}
                                />
                              </View>
                              <View className="flex-1">
                                <Text
                                  className="text-white text-sm font-semibold"
                                  numberOfLines={1}
                                >
                                  {getProductName(movement.productId)}
                                </Text>
                                <View className="flex-row items-center gap-1.5 mt-0.5">
                                  <Pill
                                    label={config.label}
                                    tone={
                                      isPositive ? "emerald" : "rose"
                                    }
                                  />
                                  <Text className="text-slate-500 text-[10px]">
                                    {formatDate(movement.createdAt)}
                                  </Text>
                                </View>
                              </View>
                            </View>

                            <View className="items-end ml-2">
                              <Text
                                className={`text-base font-black ${
                                  isPositive
                                    ? "text-emerald-400"
                                    : "text-rose-400"
                                }`}
                              >
                                {isPositive ? "+" : ""}
                                {qty}
                              </Text>
                              <Text className="text-slate-500 text-[9px]">
                                {getStoreName(movement.storeId)}
                              </Text>
                            </View>
                          </View>

                          {/* Reason */}
                          {movement.reason && (
                            <View className="mt-2 pt-2 border-t border-white/5 flex-row items-start gap-1.5">
                              <MaterialIcons
                                name="info-outline"
                                size={12}
                                color="#475569"
                              />
                              <Text className="text-slate-400 text-[11px] flex-1 leading-4">
                                {movement.reason}
                              </Text>
                            </View>
                          )}

                          {/* Reference */}
                          {movement.referenceType && (
                            <View className="mt-1 flex-row items-center gap-1">
                              <MaterialIcons
                                name="link"
                                size={10}
                                color="#334155"
                              />
                              <Text className="text-slate-600 text-[9px]">
                                {movement.referenceType}:{" "}
                                {movement.referenceId?.slice(0, 12)}
                              </Text>
                            </View>
                          )}
                        </Card>
                      );
                    })}
                  </View>
                );
              })
            )}
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}
