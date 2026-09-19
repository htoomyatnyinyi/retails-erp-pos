import {
  Card,
  Header,
  MetricCard,
  Pill,
  Screen,
  SectionTitle,
  ActionButton,
} from "@/components/app-ui";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import { hasPermission } from "@/utils/auth/permissions";
import {
  useGetLocalOrdersQuery,
  useGetLocalProductsQuery,
  useGetLocalInventoryQuery,
  useGetLocalSessionsQuery,
  useGetLocalInventoryMovementsQuery,
  useGetLocalStaffQuery,
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
import Svg, {
  Path,
  Defs,
  LinearGradient,
  Stop,
  Circle,
  Line as SvgLine,
} from "react-native-svg";

type ChartType = "bar" | "area" | "line";

//
// Enhanced Bar Chart Component
//

function EnhancedBarChart({
  data,
  labels,
}: {
  data: number[];
  labels: string[];
}) {
  const maxValue = Math.max(...data, 1);
  const barHeight = 110;
  const todayIndex = data.length - 1;

  return (
    <View className="mt-2">
      <View className="flex-row items-end justify-between h-[130px] px-1">
        {data.map((value, index) => {
          const height = (value / maxValue) * barHeight;
          const isToday = index === todayIndex;
          const color = isToday ? "#38bdf8" : "#475569";
          return (
            <View key={index} className="items-center flex-1">
              {/* Value Label above bar */}
              <Text
                className={`text-[9px] font-bold mb-1.5 ${
                  isToday ? "text-sky-300" : "text-slate-400"
                }`}
                numberOfLines={1}
              >
                $
                {value >= 1000
                  ? (value / 1000).toFixed(1) + "k"
                  : value.toFixed(0)}
              </Text>

              <View
                style={{
                  height: Math.max(height, 6),
                  width: 26,
                  backgroundColor: color,
                  borderTopLeftRadius: 6,
                  borderTopRightRadius: 6,
                  borderBottomLeftRadius: 2,
                  borderBottomRightRadius: 2,
                  opacity: isToday ? 1 : 0.7,
                }}
              />
            </View>
          );
        })}
      </View>
      {/* X-Axis Labels */}
      <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-slate-800/80">
        {labels.map((label, index) => (
          <Text
            key={index}
            className={`text-center flex-1 text-[10px] font-semibold ${
              index === todayIndex ? "text-sky-300 font-bold" : "text-slate-400"
            }`}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

//
// Enhanced Area & Line Chart Component
//

function EnhancedSvgChart({
  data,
  labels,
  variant = "area",
}: {
  data: number[];
  labels: string[];
  variant: "area" | "line";
}) {
  const maxValue = Math.max(...data, 1);
  const width = 320;
  const height = 130;
  const paddingX = 22;
  const paddingTop = 26;
  const paddingBottom = 16;
  const plotWidth = width - paddingX * 2;
  const plotHeight = height - paddingTop - paddingBottom;
  const todayIndex = data.length - 1;

  // Calculate coordinates for points
  const points = data.map((val, idx) => {
    const x = paddingX + idx * (plotWidth / (data.length - 1 || 1));
    const y = paddingTop + plotHeight - (val / maxValue) * plotHeight;
    return { x, y, val };
  });

  // Construct smooth line path (curved)
  let linePath = "";
  if (points.length > 0) {
    linePath = `M ${points[0].x} ${points[0].y}`;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[i];
      const p1 = points[i + 1];
      const cx = (p0.x + p1.x) / 2;
      linePath += ` C ${cx} ${p0.y}, ${cx} ${p1.y}, ${p1.x} ${p1.y}`;
    }
  }

  // Construct closed area path for gradient
  const areaPath =
    points.length > 0
      ? `${linePath} L ${points[points.length - 1].x} ${height - paddingBottom} L ${points[0].x} ${height - paddingBottom} Z`
      : "";

  return (
    <View className="mt-2">
      <View className="items-center">
        <Svg width="100%" height={height} viewBox={`0 0 ${width} ${height}`}>
          <Defs>
            <LinearGradient id="areaGradient" x1="0" y1="0" x2="0" y2="1">
              <Stop offset="0%" stopColor="#38bdf8" stopOpacity="0.45" />
              <Stop offset="80%" stopColor="#38bdf8" stopOpacity="0.05" />
              <Stop offset="100%" stopColor="#38bdf8" stopOpacity="0.0" />
            </LinearGradient>
            <LinearGradient id="lineStroke" x1="0" y1="0" x2="1" y2="0">
              <Stop offset="0%" stopColor="#0284c7" />
              <Stop offset="70%" stopColor="#38bdf8" />
              <Stop offset="100%" stopColor="#34d399" />
            </LinearGradient>
          </Defs>

          {/* Grid lines */}
          <SvgLine
            x1={paddingX}
            y1={paddingTop}
            x2={width - paddingX}
            y2={paddingTop}
            stroke="#334155"
            strokeWidth="1"
            strokeDasharray="4 4"
            strokeOpacity="0.4"
          />
          <SvgLine
            x1={paddingX}
            y1={paddingTop + plotHeight / 2}
            x2={width - paddingX}
            y2={paddingTop + plotHeight / 2}
            stroke="#334155"
            strokeWidth="1"
            strokeDasharray="4 4"
            strokeOpacity="0.4"
          />
          <SvgLine
            x1={paddingX}
            y1={height - paddingBottom}
            x2={width - paddingX}
            y2={height - paddingBottom}
            stroke="#334155"
            strokeWidth="1"
            strokeOpacity="0.6"
          />

          {/* Area Fill */}
          {variant === "area" && (
            <Path d={areaPath} fill="url(#areaGradient)" />
          )}

          {/* Smooth Line */}
          <Path
            d={linePath}
            fill="none"
            stroke="url(#lineStroke)"
            strokeWidth="3"
            strokeLinecap="round"
          />

          {/* Dots on data points */}
          {points.map((p, idx) => {
            const isToday = idx === todayIndex;
            return (
              <React.Fragment key={idx}>
                {isToday && (
                  <Circle
                    cx={p.x}
                    cy={p.y}
                    r="8"
                    fill="#38bdf8"
                    fillOpacity="0.25"
                  />
                )}
                <Circle
                  cx={p.x}
                  cy={p.y}
                  r={isToday ? "5" : "3.5"}
                  fill={isToday ? "#38bdf8" : "#0f172a"}
                  stroke={isToday ? "#ffffff" : "#38bdf8"}
                  strokeWidth={isToday ? "2" : "1.5"}
                />
              </React.Fragment>
            );
          })}
        </Svg>
      </View>

      {/* Top Value Labels floating over points */}
      <View className="flex-row items-center justify-between px-1 -mt-2">
        {data.map((value, index) => {
          const isToday = index === todayIndex;
          return (
            <Text
              key={index}
              className={`text-[9px] font-bold text-center flex-1 ${
                isToday ? "text-sky-300" : "text-slate-400"
              }`}
            >
              $
              {value >= 1000
                ? (value / 1000).toFixed(1) + "k"
                : value.toFixed(0)}
            </Text>
          );
        })}
      </View>

      {/* X-Axis Labels */}
      <View className="flex-row items-center justify-between mt-2 pt-2 border-t border-slate-800/80">
        {labels.map((label, index) => (
          <Text
            key={index}
            className={`text-center flex-1 text-[10px] font-semibold ${
              index === todayIndex ? "text-sky-300 font-bold" : "text-slate-400"
            }`}
          >
            {label}
          </Text>
        ))}
      </View>
    </View>
  );
}

//
// Main Component
//

export default function DashboardScreen() {
  const { currentStoreId, user } = useAppSelector((state) => state.auth);
  // const canManageInventory = hasPermission(user, "MANAGE_INVENTORY");
  const [chartType, setChartType] = useState<ChartType>("area");
  const [isRefreshing, setIsRefreshing] = useState(false);

  const {
    data: orders = [],
    isLoading: ordersLoading,
    refetch: refetchOrders,
  } = useGetLocalOrdersQuery(
    { storeId: currentStoreId || undefined, includeItems: true },
    { pollingInterval: 30000 },
  );

  const {
    data: products = [],
    isLoading: productsLoading,
    refetch: refetchProducts,
  } = useGetLocalProductsQuery({
    storeId: currentStoreId || undefined,
  });

  const {
    data: inventory = [],
    isLoading: inventoryLoading,
    refetch: refetchInventory,
  } = useGetLocalInventoryQuery({
    storeId: currentStoreId || undefined,
  });

  const {
    data: sessions = [],
    isLoading: sessionsLoading,
    refetch: refetchSessions,
  } = useGetLocalSessionsQuery({
    storeId: currentStoreId || undefined,
  });

  const {
    data: movements = [],
    isLoading: movementsLoading,
    refetch: refetchMovements,
  } = useGetLocalInventoryMovementsQuery({
    storeId: currentStoreId || undefined,
    limit: 5,
  });

  const { data: staffList = [] } = useGetLocalStaffQuery({
    storeId: currentStoreId || undefined,
  });

  const isLoading =
    ordersLoading ||
    productsLoading ||
    inventoryLoading ||
    sessionsLoading ||
    movementsLoading;

  // Compute metrics
  const metrics = useMemo(() => {
    const parseDate = (d: any): Date | null => {
      if (!d) return null;
      if (d instanceof Date) return isNaN(d.getTime()) ? null : d;
      if (typeof d === "number") return new Date(d);
      if (typeof d === "string") {
        const formatted =
          d.includes(" ") && !d.includes("T") ? d.replace(" ", "T") : d;
        const date = new Date(formatted);
        return isNaN(date.getTime()) ? null : date;
      }
      return null;
    };

    const isSameDay = (d1: Date | null, d2: Date | null) => {
      if (!d1 || !d2) return false;
      return (
        d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate()
      );
    };

    const isVoided = (order: any) =>
      ["VOIDED", "CANCELLED", "CANCELED", "REFUNDED"].includes(
        String(order.status || "").toUpperCase(),
      );

    const countsAsRevenue = (order: any) =>
      !isVoided(order) &&
      (["COMPLETED", "PAID", "CLOSED", "PENDING"].includes(
        String(order.status || "").toUpperCase(),
      ) ||
        String(order.paymentStatus || "").toUpperCase() === "PAID");

    const now = new Date();
    const yesterday = new Date();
    yesterday.setDate(yesterday.getDate() - 1);

    const todayOrders = orders.filter((o: any) =>
      isSameDay(parseDate(o.createdAt), now),
    );
    const yesterdayOrders = orders.filter((o: any) =>
      isSameDay(parseDate(o.createdAt), yesterday),
    );

    const todayRevenue = todayOrders
      .filter(countsAsRevenue)
      .reduce((sum: number, o: any) => sum + Number(o.grandTotal || 0), 0);
    const yesterdayRevenue = yesterdayOrders
      .filter(countsAsRevenue)
      .reduce((sum: number, o: any) => sum + Number(o.grandTotal || 0), 0);

    const completedRevenueOrders = orders.filter(countsAsRevenue);
    const totalOrders = completedRevenueOrders.length;
    const totalRevenue = completedRevenueOrders.reduce(
      (sum: number, o: any) => sum + Number(o.grandTotal || 0),
      0,
    );
    const avgOrderValue = totalOrders > 0 ? totalRevenue / totalOrders : 0;

    // Trend calculations
    const revenueDeltaNum =
      yesterdayRevenue > 0
        ? ((todayRevenue - yesterdayRevenue) / yesterdayRevenue) * 100
        : todayRevenue > 0
          ? 100
          : 0;
    const revenueDelta =
      revenueDeltaNum === 0
        ? "0%"
        : `${revenueDeltaNum > 0 ? "+" : ""}${revenueDeltaNum.toFixed(1)}%`;
    const revenueTrendTone = revenueDeltaNum >= 0 ? "emerald" : "rose";

    const ordersDeltaNum =
      yesterdayOrders.length > 0
        ? ((todayOrders.length - yesterdayOrders.length) /
            yesterdayOrders.length) *
          100
        : todayOrders.length > 0
          ? 100
          : 0;
    const ordersDelta =
      ordersDeltaNum === 0
        ? "0%"
        : `${ordersDeltaNum > 0 ? "+" : ""}${ordersDeltaNum.toFixed(1)}%`;
    const ordersTrendTone = ordersDeltaNum >= 0 ? "emerald" : "rose";

    // Order status breakdown (Today)
    let completedOrdersCount = 0;
    let pendingOrdersCount = 0;
    let voidedOrdersCount = 0;

    for (const order of todayOrders) {
      const statusUpper = String(order.status || "").toUpperCase();
      const paymentUpper = String(order.paymentStatus || "").toUpperCase();

      if (
        ["VOIDED", "CANCELLED", "CANCELED", "REFUNDED"].includes(statusUpper)
      ) {
        voidedOrdersCount++;
      } else if (
        statusUpper === "COMPLETED" ||
        statusUpper === "PAID" ||
        paymentUpper === "PAID"
      ) {
        completedOrdersCount++;
      } else {
        pendingOrdersCount++;
      }
    }

    // Last 7 days revenue for chart
    const last7Days = Array.from({ length: 7 }, (_, i) => {
      const d = new Date();
      d.setDate(d.getDate() - (6 - i));
      return d;
    });

    const dailyRevenue = last7Days.map((targetDate) => {
      return orders
        .filter(
          (o: any) =>
            isSameDay(parseDate(o.createdAt), targetDate) && countsAsRevenue(o),
        )
        .reduce((sum: number, o: any) => sum + Number(o.grandTotal || 0), 0);
    });

    // Top products (Today)
    const productSales: Record<
      string,
      { name: string; qty: number; revenue: number }
    > = {};
    for (const order of todayOrders) {
      if (countsAsRevenue(order) && order.items && Array.isArray(order.items)) {
        for (const item of order.items) {
          const prodKey = item.variantId
            ? `${item.productId}_${item.variantId}`
            : item.productId;
          if (!prodKey) continue;
          if (!productSales[prodKey]) {
            const product = products.find((p: any) => p.id === item.productId);
            const name =
              item.productName || item.name || product?.name || "Product";
            productSales[prodKey] = {
              name,
              qty: 0,
              revenue: 0,
            };
          }
          productSales[prodKey].qty += Number(item.quantity || 0);
          productSales[prodKey].revenue +=
            Number(item.subTotal) ||
            Number(item.unitPrice || 0) * Number(item.quantity || 0);
        }
      }
    }
    const topProducts = Object.values(productSales)
      .sort((a, b) => b.qty - a.qty)
      .slice(0, 4);

    const maxProductQty =
      topProducts.length > 0 ? Math.max(...topProducts.map((p) => p.qty)) : 1;

    const paymentMix = todayOrders
      .filter(countsAsRevenue)
      .reduce((acc: Record<string, number>, order: any) => {
        const method = String(order.paymentMethod || "CASH").toUpperCase();
        acc[method] = (acc[method] || 0) + Number(order.grandTotal || 0);
        return acc;
      }, {});
    const lowStockItems = inventory.filter(
      (item: any) =>
        Number(item.quantity || 0) <= Number(item.reorderPoint || 0),
    );
    const outOfStockItems = inventory.filter(
      (item: any) => Number(item.quantity || 0) <= 0,
    );
    const activeSession = sessions.find(
      (session: any) => String(session.status).toUpperCase() === "OPEN",
    );
    const unsyncedCount = [...orders, ...inventory].filter((item: any) =>
      ["pending", "failed"].includes(String(item.syncStatus)),
    ).length;

    // Recent 5 Orders
    const recentOrders = [...orders]
      .sort((a, b) => {
        const da = parseDate(a.createdAt)?.getTime() || 0;
        const db = parseDate(b.createdAt)?.getTime() || 0;
        return db - da;
      })
      .slice(0, 5);

    // Cashier & Staff Sales Breakdown (Today)
    const staffSalesMap: Record<
      string,
      {
        id: string;
        name: string;
        role: string;
        ordersCount: number;
        totalSales: number;
      }
    > = {};

    for (const order of todayOrders) {
      if (countsAsRevenue(order)) {
        const uId = order.userId || "staff_default";
        if (!staffSalesMap[uId]) {
          const staffMember = staffList.find(
            (s: any) => s.id === uId || s.remoteId === uId,
          );
          const name =
            staffMember?.name ||
            order.user?.name ||
            (uId === user?.id
              ? user?.name || "Cashier"
              : `Staff #${uId.slice(-4)}`);
          const role =
            staffMember?.role || (uId === user?.id ? user?.role : "CASHIER");
          staffSalesMap[uId] = {
            id: uId,
            name,
            role,
            ordersCount: 0,
            totalSales: 0,
          };
        }
        staffSalesMap[uId].ordersCount += 1;
        staffSalesMap[uId].totalSales += Number(order.grandTotal || 0);
      }
    }
    const staffSales = Object.values(staffSalesMap).sort(
      (a, b) => b.totalSales - a.totalSales,
    );

    return {
      todayOrders: todayOrders.length,
      yesterdayOrders: yesterdayOrders.length,
      ordersDelta,
      ordersTrendTone,

      todayRevenue,
      yesterdayRevenue,
      revenueDelta,
      revenueTrendTone,

      avgOrderValue,

      pendingOrders: pendingOrdersCount,
      completedOrders: completedOrdersCount,
      voidedOrders: voidedOrdersCount,

      dailyRevenue,
      last7DaysLabels: last7Days.map((d, idx) =>
        idx === 6
          ? "Today"
          : d.toLocaleDateString("en-US", { weekday: "short" }),
      ),

      topProducts,
      maxProductQty,
      paymentMix,
      staffSales,
      lowStockCount: lowStockItems.length,
      outOfStockCount: outOfStockItems.length,
      activeSession,
      unsyncedCount,
      recentOrders,
    };
  }, [orders, products, inventory, sessions, staffList, user]);

  const onRefresh = async () => {
    setIsRefreshing(true);
    try {
      await Promise.all([
        refetchOrders(),
        refetchProducts(),
        refetchInventory(),
        refetchSessions(),
        refetchMovements(),
      ]);
    } finally {
      setIsRefreshing(false);
    }
  };

  return (
    <Screen padded={false}>
      <SafeAreaView className="flex-1 bg-slate-950">
        <View className="px-5 pt-6 pb-2">
          <Header
            eyebrow="Overview"
            title="Dashboard"
            subtitle={`Store: ${currentStoreId ? "Active" : "Global"}`}
            right={
              <View className="flex-row items-center gap-2">
                <Pill
                  label={currentStoreId ? "Store View" : "Global View"}
                  tone={currentStoreId ? "emerald" : "sky"}
                />
                {metrics.unsyncedCount > 0 && (
                  <Pill
                    label={`${metrics.unsyncedCount} pending`}
                    tone="amber"
                  />
                )}
              </View>
            }
          />
        </View>

        {isLoading ? (
          <View className="flex-1 items-center justify-center">
            <ActivityIndicator size="large" color="#38bdf8" />
            <Text className="text-slate-400 mt-4 font-medium">
              Loading analytics...
            </Text>
          </View>
        ) : (
          <ScrollView
            className="px-5 mb-10"
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
            {/* KPIs Row */}
            <View className="flex-row flex-wrap gap-3 mb-6">
              <View className="w-[48%]">
                <MetricCard
                  // icon="attach-money"
                  label="Today's Sales"
                  value={`$${metrics.todayRevenue.toFixed(2)}`}
                  delta={`${metrics.revenueDelta} vs yesterday`}
                  tone={metrics.revenueTrendTone as any}
                />
              </View>
              <View className="w-[48%]">
                <MetricCard
                  // icon="receipt-long"
                  label="Today's Orders"
                  value={String(metrics.todayOrders)}
                  delta={`${metrics.ordersDelta} vs yesterday`}
                  tone={metrics.ordersTrendTone as any}
                />
              </View>
              <View className="w-[48%]">
                <MetricCard
                  label="Avg. Order"
                  value={`$${metrics.avgOrderValue.toFixed(2)}`}
                  delta="All completed sales"
                  tone="sky"
                />
              </View>
              <View className="w-[48%]">
                <MetricCard
                  label="Low Stock"
                  value={String(metrics.lowStockCount)}
                  delta={`${metrics.outOfStockCount} out of stock`}
                  tone={metrics.outOfStockCount > 0 ? "rose" : "amber"}
                />
              </View>
            </View>

            {/* Revenue Trend Chart with Graph Type Switcher */}
            <View className="flex-col items-center justify-between mb-2">
              <SectionTitle title="Revenue Trend (7 Days)" />
              <View className="flex-row bg-slate-900 border border-slate-800 rounded-lg p-0.5">
                <TouchableOpacity
                  onPress={() => setChartType("area")}
                  className={`px-2.5 py-1 rounded-md flex-row items-center gap-1 ${
                    chartType === "area"
                      ? "bg-sky-500/20 border border-sky-500/30"
                      : ""
                  }`}
                >
                  <MaterialIcons
                    name="show-chart"
                    size={14}
                    color={chartType === "area" ? "#38bdf8" : "#64748b"}
                  />
                  <Text
                    className={`text-[10px] font-bold ${
                      chartType === "area" ? "text-sky-300" : "text-slate-400"
                    }`}
                  >
                    Area
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setChartType("bar")}
                  className={`px-2.5 py-1 rounded-md flex-row items-center gap-1 ${
                    chartType === "bar"
                      ? "bg-sky-500/20 border border-sky-500/30"
                      : ""
                  }`}
                >
                  <MaterialIcons
                    name="bar-chart"
                    size={14}
                    color={chartType === "bar" ? "#38bdf8" : "#64748b"}
                  />
                  <Text
                    className={`text-[10px] font-bold ${
                      chartType === "bar" ? "text-sky-300" : "text-slate-400"
                    }`}
                  >
                    Bar
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  onPress={() => setChartType("line")}
                  className={`px-2.5 py-1 rounded-md flex-row items-center gap-1 ${
                    chartType === "line"
                      ? "bg-sky-500/20 border border-sky-500/30"
                      : ""
                  }`}
                >
                  <MaterialIcons
                    name="timeline"
                    size={14}
                    color={chartType === "line" ? "#38bdf8" : "#64748b"}
                  />
                  <Text
                    className={`text-[10px] font-bold ${
                      chartType === "line" ? "text-sky-300" : "text-slate-400"
                    }`}
                  >
                    Line
                  </Text>
                </TouchableOpacity>
              </View>
            </View>

            <Card className="mb-6">
              {chartType === "bar" && (
                <EnhancedBarChart
                  data={metrics.dailyRevenue}
                  labels={metrics.last7DaysLabels}
                />
              )}
              {chartType === "area" && (
                <EnhancedSvgChart
                  data={metrics.dailyRevenue}
                  labels={metrics.last7DaysLabels}
                  variant="area"
                />
              )}
              {chartType === "line" && (
                <EnhancedSvgChart
                  data={metrics.dailyRevenue}
                  labels={metrics.last7DaysLabels}
                  variant="line"
                />
              )}
            </Card>

            <SectionTitle title="Operational Health" />
            <View className="flex-row flex-wrap gap-3 mb-6">
              <TouchableOpacity
                className="w-[48%] bg-slate-900 border border-slate-800 rounded-2xl p-4"
                onPress={() => router.push("/inventory")}
              >
                <View className="flex-row items-center justify-between">
                  <MaterialIcons name="inventory-2" size={20} color="#fbbf24" />
                  <MaterialIcons
                    name="chevron-right"
                    size={18}
                    color="#64748b"
                  />
                </View>
                <Text className="text-white text-xl font-black mt-3">
                  {metrics.lowStockCount}
                </Text>
                <Text className="text-slate-400 text-xs mt-1">
                  Low-stock items
                </Text>
                {metrics.outOfStockCount > 0 && (
                  <Text className="text-rose-400 text-[10px] font-bold mt-2">
                    {metrics.outOfStockCount} out of stock
                  </Text>
                )}
              </TouchableOpacity>
              <TouchableOpacity
                className="w-[48%] bg-slate-900 border border-slate-800 rounded-2xl p-4"
                onPress={() => router.push("/manage")}
              >
                <View className="flex-row items-center justify-between">
                  <MaterialIcons
                    name="point-of-sale"
                    size={20}
                    color={metrics.activeSession ? "#34d399" : "#f87171"}
                  />
                  <MaterialIcons
                    name="chevron-right"
                    size={18}
                    color="#64748b"
                  />
                </View>
                <Text className="text-white text-xl font-black mt-3">
                  {metrics.activeSession ? "Open" : "Closed"}
                </Text>
                <Text className="text-slate-400 text-xs mt-1">
                  Register session
                </Text>
                <Text
                  className={`text-[10px] font-bold mt-2 ${metrics.activeSession ? "text-emerald-400" : "text-rose-400"}`}
                >
                  {metrics.activeSession
                    ? "Ready for checkout"
                    : "Open a session to sell"}
                </Text>
              </TouchableOpacity>
            </View>

            <SectionTitle title="Recent Orders" />
            <Card className="mb-6">
              {metrics.recentOrders.length === 0 ? (
                <Text className="text-slate-500 text-sm text-center py-4">
                  No orders yet.
                </Text>
              ) : (
                metrics.recentOrders.map((order: any) => (
                  <TouchableOpacity
                    key={order.id}
                    className="flex-row items-center justify-between py-3 border-b border-white/5 last:border-b-0"
                    onPress={() => router.push("/orders")}
                  >
                    <View className="flex-1">
                      <Text className="text-white text-sm font-semibold">
                        {order.orderNumber || `#${String(order.id).slice(-6)}`}
                      </Text>
                      <Text className="text-slate-500 text-[10px] mt-1">
                        {new Date(order.createdAt).toLocaleString()} •{" "}
                        {order.status}
                      </Text>
                    </View>
                    <Text className="text-emerald-400 font-bold">
                      ${Number(order.grandTotal || 0).toFixed(2)}
                    </Text>
                  </TouchableOpacity>
                ))
              )}
            </Card>

            {/* Recent Activity & Stock Logs */}
            <View className="flex-row items-center justify-between mb-2">
              <SectionTitle title="Recent Stock & Activity Logs" />
              <TouchableOpacity
                onPress={() => router.push("/manage/inventory-movements")}
                className="flex-row items-center gap-1"
              >
                <Text className="text-sky-400 text-xs font-semibold">
                  View All
                </Text>
                <MaterialIcons name="chevron-right" size={14} color="#38bdf8" />
              </TouchableOpacity>
            </View>
            <Card className="mb-6">
              {movements.length === 0 ? (
                <Text className="text-slate-500 text-sm text-center py-4">
                  No recent stock activity logged.
                </Text>
              ) : (
                movements.slice(0, 5).map((m: any) => {
                  const isPositive =
                    ["IN", "ADJUSTMENT"].includes(m.type) &&
                    Number(m.quantity) > 0;
                  const typeColor =
                    m.type === "IN"
                      ? "text-emerald-400"
                      : m.type === "OUT" || m.type === "SALE"
                        ? "text-rose-400"
                        : "text-amber-400";
                  const iconName =
                    m.type === "IN"
                      ? "add-circle"
                      : m.type === "OUT" || m.type === "SALE"
                        ? "remove-circle"
                        : "tune";

                  const prodName =
                    m.productName ||
                    products.find((p: any) => p.id === m.productId)?.name ||
                    "Inventory Item";

                  return (
                    <TouchableOpacity
                      key={m.id}
                      className="flex-row items-center justify-between py-3 border-b border-white/5 last:border-b-0"
                      onPress={() => router.push("/manage/inventory-movements")}
                    >
                      <View className="flex-row items-center gap-3 flex-1 pr-2">
                        <View
                          className={`w-8 h-8 rounded-full items-center justify-center ${
                            m.type === "IN"
                              ? "bg-emerald-500/10 border border-emerald-500/20"
                              : m.type === "OUT" || m.type === "SALE"
                                ? "bg-rose-500/10 border border-rose-500/20"
                                : "bg-amber-500/10 border border-amber-500/20"
                          }`}
                        >
                          <MaterialIcons
                            name={iconName as any}
                            size={16}
                            color={
                              m.type === "IN"
                                ? "#34d399"
                                : m.type === "OUT" || m.type === "SALE"
                                  ? "#f87171"
                                  : "#fbbf24"
                            }
                          />
                        </View>
                        <View className="flex-1">
                          <Text
                            className="text-white text-sm font-semibold"
                            numberOfLines={1}
                          >
                            {prodName}
                          </Text>
                          <Text className="text-slate-500 text-[10px] mt-0.5">
                            {m.type} • {m.reason || "Movement"} •{" "}
                            {new Date(m.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </Text>
                        </View>
                      </View>
                      <Text className={`font-bold ${typeColor}`}>
                        {isPositive ? "+" : ""}
                        {m.quantity}
                      </Text>
                    </TouchableOpacity>
                  );
                })
              )}
            </Card>

            {/* Status Breakdown (Today) */}
            <SectionTitle title="Today's Order Status" />
            <Card className="mb-6">
              <View className="flex-row justify-between py-2 px-2">
                <View className="items-center flex-1 border-r border-slate-800">
                  <Text className="text-emerald-400 font-black text-2xl">
                    {metrics.completedOrders}
                  </Text>
                  <Text className="text-slate-500 text-xs mt-1 font-bold uppercase tracking-wider">
                    Completed
                  </Text>
                </View>
                <View className="items-center flex-1 border-r border-slate-800">
                  <Text className="text-amber-400 font-black text-2xl">
                    {metrics.pendingOrders}
                  </Text>
                  <Text className="text-slate-500 text-xs mt-1 font-bold uppercase tracking-wider">
                    Pending
                  </Text>
                </View>
                <View className="items-center flex-1">
                  <Text className="text-rose-400 font-black text-2xl">
                    {metrics.voidedOrders}
                  </Text>
                  <Text className="text-slate-500 text-xs mt-1 font-bold uppercase tracking-wider">
                    Voided
                  </Text>
                </View>
              </View>
            </Card>

            {/* Top Selling Products */}
            <SectionTitle title="Top Selling Products (Today)" />
            <Card className="mb-6">
              {metrics.topProducts.length === 0 ? (
                <View className="py-6 items-center">
                  <MaterialIcons name="inventory-2" size={32} color="#334155" />
                  <Text className="text-slate-500 text-sm mt-3 font-medium">
                    No sales recorded today.
                  </Text>
                </View>
              ) : (
                metrics.topProducts.map((p, index) => {
                  const widthPct = (p.qty / metrics.maxProductQty) * 100;
                  return (
                    <View key={index} className="mb-4 last:mb-0">
                      <View className="flex-row justify-between items-center mb-1.5">
                        <Text
                          className="text-white font-semibold text-sm"
                          numberOfLines={1}
                        >
                          {p.name}
                        </Text>
                        <Text className="text-slate-400 text-xs font-bold">
                          {p.qty} units
                        </Text>
                      </View>
                      <View className="h-2 w-full bg-slate-800 rounded-full overflow-hidden">
                        <View
                          className="h-full bg-sky-500 rounded-full"
                          style={{ width: `${widthPct}%` }}
                        />
                      </View>
                    </View>
                  );
                })
              )}
            </Card>

            {/* Operational health */}
            {/* <SectionTitle title="Operational Health" /> */}
            {/* <View className="flex-row flex-wrap gap-3 mb-6">
              <TouchableOpacity
                className="w-[48%] bg-slate-900 border border-slate-800 rounded-2xl p-4"
                onPress={() => router.push("/inventory")}
              >
                <View className="flex-row items-center justify-between">
                  <MaterialIcons name="inventory-2" size={20} color="#fbbf24" />
                  <MaterialIcons
                    name="chevron-right"
                    size={18}
                    color="#64748b"
                  />
                </View>
                <Text className="text-white text-xl font-black mt-3">
                  {metrics.lowStockCount}
                </Text>
                <Text className="text-slate-400 text-xs mt-1">
                  Low stock items
                </Text>
                {metrics.outOfStockCount > 0 && (
                  <Text className="text-rose-400 text-[10px] font-bold mt-2">
                    {metrics.outOfStockCount} out of stock
                  </Text>
                )}
              </TouchableOpacity>
              

              <TouchableOpacity
                className="w-[48%] bg-slate-900 border border-slate-800 rounded-2xl p-4"
                onPress={() => router.push("/manage")}
              >
                <View className="flex-row items-center justify-between">
                  <MaterialIcons
                    name="point-of-sale"
                    size={20}
                    color={metrics.activeSession ? "#34d399" : "#f87171"}
                  />
                  <MaterialIcons
                    name="chevron-right"
                    size={18}
                    color="#64748b"
                  />
                </View>
                <Text className="text-white text-xl font-black mt-3">
                  {metrics.activeSession ? "Open" : "Closed"}
                </Text>
                <Text className="text-slate-400 text-xs mt-1">
                  Register session
                </Text>
                <Text
                  className={`text-[10px] font-bold mt-2 ${
                    metrics.activeSession ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {metrics.activeSession
                    ? `Opening $${Number(
                        metrics.activeSession.openingBalance || 0,
                      ).toFixed(2)}`
                    : "Open a session to sell"}
                </Text>
              </TouchableOpacity>
            </View> */}

            <SectionTitle title="Today's Payment Mix" />
            <Card className="mb-6">
              {Object.keys(metrics.paymentMix).length === 0 ? (
                <Text className="text-slate-500 text-sm text-center py-4">
                  No completed payments today.
                </Text>
              ) : (
                Object.entries(metrics.paymentMix)
                  .sort(([, a], [, b]) => b - a)
                  .map(([method, amount]) => (
                    <View
                      key={method}
                      className="flex-row justify-between py-2 border-b border-white/5 last:border-b-0"
                    >
                      <Text className="text-slate-300 text-sm font-semibold">
                        {method.replace(/_/g, " ")}
                      </Text>
                      <Text className="text-emerald-400 text-sm font-bold">
                        ${amount.toFixed(2)}
                      </Text>
                    </View>
                  ))
              )}
            </Card>

            {/* Cashier & Staff Sales Breakdown */}
            <SectionTitle title="Cashier & Staff Sales (Today)" />
            <Card className="mb-6">
              {metrics.staffSales.length === 0 ? (
                <Text className="text-slate-500 text-sm text-center py-4">
                  No staff sales recorded today.
                </Text>
              ) : (
                metrics.staffSales.map((s) => (
                  <View
                    key={s.id}
                    className="flex-row items-center justify-between py-3 border-b border-white/5 last:border-b-0"
                  >
                    <View className="flex-row items-center gap-3">
                      <View className="w-9 h-9 rounded-full bg-sky-500/10 border border-sky-500/20 items-center justify-center">
                        <MaterialIcons
                          name="person"
                          size={18}
                          color="#38bdf8"
                        />
                      </View>
                      <View>
                        <Text className="text-white text-sm font-semibold">
                          {s.name}
                        </Text>
                        <Text className="text-slate-500 text-[10px]">
                          {s.role} • {s.ordersCount}{" "}
                          {s.ordersCount === 1 ? "order" : "orders"}
                        </Text>
                      </View>
                    </View>
                    <Text className="text-emerald-400 font-bold text-sm">
                      ${s.totalSales.toFixed(2)}
                    </Text>
                  </View>
                ))
              )}
            </Card>
          </ScrollView>
        )}
      </SafeAreaView>
    </Screen>
  );
}
