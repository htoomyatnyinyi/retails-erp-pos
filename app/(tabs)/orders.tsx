import {
  Card,
  Header,
  Pill,
  Screen,
  SectionTitle,
  StatRow,
} from "@/components/app-ui";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import { hasPermission } from "@/utils/auth/permissions";
import {
  useGetLocalOrdersQuery,
  useGetLocalOrderByIdQuery,
  useUpdateLocalOrderStatusMutation,
} from "@/services/features/offline/localApi";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useCallback, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Modal,
  RefreshControl,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";

type OrderStatus = "PENDING" | "COMPLETED" | "VOIDED" | "CANCELLED";

/** Sync status badge for an order */
function SyncBadge({ syncStatus }: { syncStatus?: string }) {
  if (syncStatus === "pending") {
    return (
      <View className="flex-row items-center gap-1 bg-amber-500/10 border border-amber-500/20 rounded-full px-2 py-0.5">
        <MaterialIcons name="cloud-upload" size={10} color="#f59e0b" />
        <Text className="text-amber-400 text-[9px] font-bold uppercase tracking-wider">
          Pending
        </Text>
      </View>
    );
  }
  if (syncStatus === "synced") {
    return (
      <View className="flex-row items-center gap-1 bg-emerald-500/10 border border-emerald-500/20 rounded-full px-2 py-0.5">
        <MaterialIcons name="cloud-done" size={10} color="#10b981" />
        <Text className="text-emerald-400 text-[9px] font-bold uppercase tracking-wider">
          Synced
        </Text>
      </View>
    );
  }
  if (syncStatus === "failed") {
    return (
      <View className="flex-row items-center gap-1 bg-rose-500/10 border border-rose-500/20 rounded-full px-2 py-0.5">
        <MaterialIcons name="cloud-off" size={10} color="#f43f5e" />
        <Text className="text-rose-400 text-[9px] font-bold uppercase tracking-wider">
          Failed
        </Text>
      </View>
    );
  }
  return null;
}

export default function OrdersScreen() {
  const { currentStoreId, user } = useAppSelector((state) => state.auth);
  const canVoidOrders = hasPermission(user, "VOID_ORDERS");
  const canRefundOrders = hasPermission(user, "REFUND_ORDERS");
  const [filterStatus, setFilterStatus] = useState<OrderStatus | "ALL">("ALL");
  const [dateFilter, setDateFilter] = useState<"TODAY" | "YESTERDAY" | "ALL">(
    "TODAY",
  );
  const [search, setSearch] = useState("");
  const [selectedOrderId, setSelectedOrderId] = useState<string | null>(null);

  const {
    data: orders = [],
    isLoading,
    refetch,
  } = useGetLocalOrdersQuery(
    {
      storeId: currentStoreId || undefined,
      status: filterStatus === "ALL" ? undefined : filterStatus,
      search: search.trim() || undefined,
    },
    { pollingInterval: 15000 },
  );

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

  const filteredOrders = useMemo(() => {
    if (dateFilter === "ALL") return orders;
    const targetDate = new Date();
    if (dateFilter === "YESTERDAY") {
      targetDate.setDate(targetDate.getDate() - 1);
    }
    return orders.filter((o: any) =>
      isSameDay(parseDate(o.createdAt), targetDate),
    );
  }, [orders, dateFilter]);

  const [updateStatus, { isLoading: isUpdatingStatus }] =
    useUpdateLocalOrderStatusMutation();

  const { data: orderDetail, refetch: refetchDetail } =
    useGetLocalOrderByIdQuery(selectedOrderId || "", {
      skip: !selectedOrderId,
    });

  const statusColors = {
    PENDING: "amber",
    COMPLETED: "emerald",
    VOIDED: "rose",
    CANCELLED: "rose",
  } as const;

  const handleStatusUpdate = useCallback(
    (orderId: string, newStatus: string, label: string) => {
      if (
        (newStatus === "VOIDED" && !canVoidOrders) ||
        (newStatus === "CANCELLED" && !canRefundOrders)
      ) {
        Alert.alert(
          "Permission required",
          "You do not have permission for this order action.",
        );
        return;
      }
      Alert.alert(
        `${label} Order?`,
        `Are you sure you want to mark this order as ${newStatus}?`,
        [
          { text: "Cancel", style: "cancel" },
          {
            text: label,
            style: newStatus === "COMPLETED" ? "default" : "destructive",
            onPress: async () => {
              try {
                await updateStatus({ id: orderId, status: newStatus }).unwrap();
                // Close and reopen to force refetch of detail
                setSelectedOrderId(null);
                setTimeout(() => {
                  setSelectedOrderId(orderId);
                  refetch();
                }, 300);
              } catch (e: any) {
                Alert.alert("Error", e?.message || "Failed to update status");
              }
            },
          },
        ],
      );
    },
    [updateStatus, refetch, canVoidOrders, canRefundOrders],
  );

  const renderOrderItem = ({ item }: { item: any }) => (
    <TouchableOpacity
      activeOpacity={0.7}
      onPress={() => setSelectedOrderId(item.id)}
    >
      <Card className="mb-3">
        <View className="flex-row justify-between items-start">
          <View className="flex-1">
            <Text className="text-white font-bold text-base">
              #{item.orderNumber || item.id.slice(-6)}
            </Text>
            <Text className="text-slate-400 text-xs mt-1">
              {new Date(item.createdAt).toLocaleString()}
            </Text>
            {/* Sync badge inline */}
            <View className="mt-1.5">
              <SyncBadge syncStatus={item.syncStatus} />
            </View>
          </View>
          <View className="items-end">
            <Pill
              label={item.status}
              tone={statusColors[item.status as OrderStatus] || "sky"}
            />
            <Text className="text-emerald-400 font-black text-lg mt-2">
              ${item.grandTotal?.toFixed(2) || "0.00"}
            </Text>
          </View>
        </View>
      </Card>
    </TouchableOpacity>
  );

  return (
    <Screen padded={false}>
      <SafeAreaView className="flex-1 bg-slate-950">
        <View className="px-5 pt-6 pb-2">
          <Header
            eyebrow="Transactions"
            title="Orders"
            subtitle="View all orders and their details"
            // right={
            //   <TouchableOpacity
            //     className="bg-sky-500/20 px-3 py-1.5 rounded-full border border-sky-500/30"
            //     onPress={() => router.push("/pos")}
            //   >
            //     <Text className="text-sky-400 text-xs font-bold">+ New</Text>
            //   </TouchableOpacity>
            // }
          />
        </View>

        {/* Search by order number/ID, customer, phone, email, product, or payment */}
        <View className="mx-5 mb-4 flex-row items-center rounded-2xl border border-white/10 bg-white/5 px-3">
          <MaterialIcons name="search" size={20} color="#64748b" />
          <TextInput
            value={search}
            onChangeText={setSearch}
            placeholder="Search order ID, customer, product..."
            placeholderTextColor="#64748b"
            autoCapitalize="none"
            autoCorrect={false}
            returnKeyType="search"
            className="flex-1 p-2 text-sm text-white"
            // className="flex-1 px-3 py-3.5 text-sm text-white"
          />
          {search.length > 0 && (
            <TouchableOpacity
              accessibilityLabel="Clear order search"
              onPress={() => setSearch("")}
              className="p-1"
            >
              <MaterialIcons name="close" size={18} color="#94a3b8" />
            </TouchableOpacity>
          )}
        </View>

        {/* Date Filters (Today vs Yesterday vs All History) */}
        <View className="flex-row px-5 mb-3 gap-2">
          <TouchableOpacity
            onPress={() => setDateFilter("TODAY")}
            className={`px-3.5 py-1.5 rounded-xl border flex-row items-center gap-1.5 ${
              dateFilter === "TODAY"
                ? "bg-sky-500/20 border-sky-400/40"
                : "bg-white/5 border-white/10"
            }`}
          >
            <MaterialIcons
              name="today"
              size={14}
              color={dateFilter === "TODAY" ? "#38bdf8" : "#94a3b8"}
            />
            <Text
              className={`text-xs font-bold ${
                dateFilter === "TODAY" ? "text-sky-300" : "text-slate-400"
              }`}
            >
              Today
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setDateFilter("YESTERDAY")}
            className={`px-3.5 py-1.5 rounded-xl border flex-row items-center gap-1.5 ${
              dateFilter === "YESTERDAY"
                ? "bg-sky-500/20 border-sky-400/40"
                : "bg-white/5 border-white/10"
            }`}
          >
            <MaterialIcons
              name="history"
              size={14}
              color={dateFilter === "YESTERDAY" ? "#38bdf8" : "#94a3b8"}
            />
            <Text
              className={`text-xs font-bold ${
                dateFilter === "YESTERDAY" ? "text-sky-300" : "text-slate-400"
              }`}
            >
              Yesterday
            </Text>
          </TouchableOpacity>

          <TouchableOpacity
            onPress={() => setDateFilter("ALL")}
            className={`px-3.5 py-1.5 rounded-xl border flex-row items-center gap-1.5 ${
              dateFilter === "ALL"
                ? "bg-sky-500/20 border-sky-400/40"
                : "bg-white/5 border-white/10"
            }`}
          >
            <MaterialIcons
              name="view-list"
              size={14}
              color={dateFilter === "ALL" ? "#38bdf8" : "#94a3b8"}
            />
            <Text
              className={`text-xs font-bold ${
                dateFilter === "ALL" ? "text-sky-300" : "text-slate-400"
              }`}
            >
              All History
            </Text>
          </TouchableOpacity>
        </View>

        {/* Status Filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          className="px-5 mb-4"
          contentContainerStyle={{ gap: 8 }}
        >
          {["ALL", "PENDING", "COMPLETED", "VOIDED", "CANCELLED"].map(
            (status) => (
              <TouchableOpacity
                key={status}
                onPress={() => setFilterStatus(status as any)}
                className={`px-4 py-2 rounded-full border ${
                  filterStatus === status
                    ? "border-sky-400/40 bg-sky-500/20"
                    : "border-white/10 bg-white/5"
                }`}
              >
                <Text
                  className={`text-xs font-bold uppercase tracking-wider ${
                    filterStatus === status ? "text-sky-300" : "text-slate-400"
                  }`}
                >
                  {status}
                </Text>
              </TouchableOpacity>
            ),
          )}
        </ScrollView>

        {/* Orders List */}
        <FlatList
          data={filteredOrders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 120 }}
          renderItem={renderOrderItem}
          refreshControl={
            <RefreshControl
              refreshing={isLoading}
              onRefresh={refetch}
              tintColor="#38bdf8"
            />
          }
          ListEmptyComponent={
            <View className="items-center justify-center mt-20">
              <View className="h-20 w-20 bg-white/5 rounded-full items-center justify-center border border-white/10">
                <MaterialIcons name="receipt-long" size={32} color="#64748b" />
              </View>
              <Text className="text-white mt-4 text-lg font-bold">
                No orders found
              </Text>
              <Text className="text-slate-500 text-sm text-center px-10 mt-2">
                {search.trim()
                  ? "Try another order number, customer, or product."
                  : filterStatus === "ALL"
                    ? "Start taking orders from the POS screen."
                    : `No ${filterStatus} orders yet.`}
              </Text>
            </View>
          }
        />

        {/* Order Detail Modal */}
        <Modal
          visible={!!selectedOrderId}
          animationType="slide"
          transparent
          onRequestClose={() => setSelectedOrderId(null)}
        >
          <View className="flex-1 bg-black/80">
            <View className="flex-1 bg-slate-900 rounded-t-3xl mt-12">
              <View className="px-5 pt-5 pb-4 flex-1">
                <View className="flex-row justify-between items-center mb-4">
                  <Text className="text-white font-bold text-xl">
                    Order Details
                  </Text>
                  <TouchableOpacity onPress={() => setSelectedOrderId(null)}>
                    <MaterialIcons name="close" size={24} color="#94a3b8" />
                  </TouchableOpacity>
                </View>

                {orderDetail ? (
                  <ScrollView
                    showsVerticalScrollIndicator={false}
                    contentContainerStyle={{ paddingBottom: 40 }}
                  >
                    {/* Info Card */}
                    <Card className="mb-4">
                      <StatRow
                        label="Order ID"
                        value={
                          orderDetail.orderNumber ||
                          `#${orderDetail.id.slice(-6)}`
                        }
                      />
                      <StatRow
                        label="Status"
                        value={orderDetail.status}
                        valueColor={
                          orderDetail.status === "COMPLETED"
                            ? "#34d399"
                            : orderDetail.status === "PENDING"
                              ? "#fbbf24"
                              : "#f87171"
                        }
                      />
                      <StatRow
                        label="Date"
                        value={new Date(orderDetail.createdAt).toLocaleString()}
                      />
                      <StatRow
                        label="Payment Method"
                        value={orderDetail.paymentMethod || "CASH"}
                      />
                      <StatRow
                        label="Customer"
                        value={orderDetail.customerId || "Walk-in"}
                      />
                    </Card>

                    {/* Sync Status Card */}
                    <Card className="mb-4">
                      <View className="flex-row items-center justify-between">
                        <Text className="text-slate-400 text-xs font-bold uppercase tracking-wider">
                          Cloud Sync
                        </Text>
                        <SyncBadge syncStatus={orderDetail.syncStatus} />
                      </View>
                    </Card>

                    {/* Status Actions — only show if the order is actionable */}
                    {(orderDetail.status === "PENDING" ||
                      orderDetail.status === "COMPLETED") && (
                      <View className="mb-4">
                        <Text className="text-slate-500 text-[10px] font-bold uppercase tracking-[3px] mb-2">
                          Actions
                        </Text>
                        <View className="flex-row gap-2">
                          {orderDetail.status === "PENDING" && (
                            <>
                              <TouchableOpacity
                                className="flex-1 bg-emerald-500/15 py-3 rounded-xl border border-emerald-500/30 flex-row items-center justify-center gap-2"
                                onPress={() =>
                                  handleStatusUpdate(
                                    orderDetail.id,
                                    "COMPLETED",
                                    "Complete",
                                  )
                                }
                                disabled={isUpdatingStatus}
                              >
                                <MaterialIcons
                                  name="check-circle"
                                  size={16}
                                  color="#34d399"
                                />
                                <Text className="text-emerald-400 font-bold text-xs">
                                  {isUpdatingStatus
                                    ? "Updating..."
                                    : "COMPLETE"}
                                </Text>
                              </TouchableOpacity>
                              {canRefundOrders && (
                                <TouchableOpacity
                                  className="flex-1 bg-rose-500/15 py-3 rounded-xl border border-rose-500/30 flex-row items-center justify-center gap-2"
                                  onPress={() =>
                                    handleStatusUpdate(
                                      orderDetail.id,
                                      "CANCELLED",
                                      "Cancel",
                                    )
                                  }
                                  disabled={isUpdatingStatus}
                                >
                                  <MaterialIcons
                                    name="cancel"
                                    size={16}
                                    color="#f87171"
                                  />
                                  <Text className="text-rose-400 font-bold text-xs">
                                    CANCEL
                                  </Text>
                                </TouchableOpacity>
                              )}
                            </>
                          )}
                          {orderDetail.status === "COMPLETED" &&
                            canVoidOrders && (
                              <TouchableOpacity
                                className="flex-1 bg-rose-500/15 py-3 rounded-xl border border-rose-500/30 flex-row items-center justify-center gap-2"
                                onPress={() =>
                                  handleStatusUpdate(
                                    orderDetail.id,
                                    "VOIDED",
                                    "Void",
                                  )
                                }
                                disabled={isUpdatingStatus}
                              >
                                <MaterialIcons
                                  name="block"
                                  size={16}
                                  color="#f87171"
                                />
                                <Text className="text-rose-400 font-bold text-xs">
                                  VOID ORDER
                                </Text>
                              </TouchableOpacity>
                            )}
                        </View>
                      </View>
                    )}

                    <SectionTitle title="Items" />
                    <Card className="mb-4">
                      {orderDetail.items?.map((item: any) => (
                        <View
                          key={item.id}
                          className="flex-row justify-between py-3 border-b border-white/5 last:border-0"
                        >
                          <View className="flex-1">
                            <Text className="text-white font-medium">
                              {item.productName || "Item"}
                            </Text>
                            <Text className="text-slate-400 text-xs">
                              {item.quantity} × ${item.unitPrice?.toFixed(2)}
                            </Text>
                          </View>
                          <Text className="text-white font-bold">
                            ${item.subTotal?.toFixed(2) || "0.00"}
                          </Text>
                        </View>
                      ))}
                    </Card>

                    <SectionTitle title="Summary" />
                    <Card className="mb-4">
                      <StatRow
                        label="Subtotal"
                        value={`$${orderDetail.subTotal?.toFixed(2) || "0.00"}`}
                      />
                      <StatRow
                        label="Tax"
                        value={`$${orderDetail.taxAmount?.toFixed(2) || "0.00"}`}
                      />
                      <StatRow
                        label="Discount"
                        value={`-$${orderDetail.discountAmount?.toFixed(2) || "0.00"}`}
                        valueColor="#fbbf24"
                      />
                      <StatRow
                        label="Total"
                        value={`$${orderDetail.grandTotal?.toFixed(2) || "0.00"}`}
                        valueColor="#34d399"
                        // bold
                      />
                    </Card>

                    <TouchableOpacity
                      className="bg-sky-500/20 py-3 rounded-xl border border-sky-500/30 mb-6"
                      onPress={() => {
                        setSelectedOrderId(null);
                        router.push(`/receipt/${orderDetail.id}`);
                      }}
                    >
                      <Text className="text-sky-400 font-bold text-center">
                        View Receipt
                      </Text>
                    </TouchableOpacity>
                  </ScrollView>
                ) : (
                  <View className="flex-1 items-center justify-center">
                    <ActivityIndicator size="large" color="#38bdf8" />
                  </View>
                )}
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Screen>
  );
}
