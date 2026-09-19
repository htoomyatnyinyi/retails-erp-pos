import { Card, Header, Pill, Screen } from "@/components/app-ui";
import { BarcodeScannerModal } from "@/components/barcode-scanner-modal";
import { useAppDispatch } from "@/hooks/redux-hooks/useAppDispatch";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import { canCreateOrders } from "@/utils/auth/permissions";

import {
  addToCart,
  clearCart,
  removeFromCart,
  updateQuantity,
} from "@/services/features/cart/cartSlice";
import {
  useCreateLocalOrderMutation,
  useGetActiveSessionQuery,
  useGetLocalCategoriesQuery,
  useGetLocalCustomersQuery,
  useGetLocalInventoryQuery,
  useGetLocalProductsQuery,
  useGetLocalStoreSettingsQuery,
  useGetLocalVariantsQuery,
} from "@/services/features/offline/localApi";
import { MaterialIcons } from "@expo/vector-icons";
import { router } from "expo-router";
import React, { useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Dimensions,
  FlatList,
  Modal,
  SafeAreaView,
  ScrollView,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from "react-native";

const { height } = Dimensions.get("window");

export default function POSScreen() {
  const dispatch = useAppDispatch();
  const { user, currentStoreId } = useAppSelector((state) => state.auth);
  const canCheckout = canCreateOrders(user);

  // State
  const [searchQuery, setSearchQuery] = useState("");
  const [showScannerModal, setShowScannerModal] = useState(false);
  const [selectedCategory, setSelectedCategory] = useState<string | undefined>(
    undefined,
  );
  const [showCartModal, setShowCartModal] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
  const [showCustomerSelect, setShowCustomerSelect] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
  const [customerSearch, setCustomerSearch] = useState("");
  const [selectedProductForVariants, setSelectedProductForVariants] =
    useState<any>(null);
  const [scannerMode, setScannerMode] = useState<"single" | "continuous">(
    "single",
  );
  const [scannedPreviewItems, setScannedPreviewItems] = useState<any[]>([]);

  // Animations
  const slideAnim = useRef(new Animated.Value(height)).current;

  // Queries
  const {
    data: productsData,
    isLoading: isProductsLoading,
    refetch,
  } = useGetLocalProductsQuery({
    search: searchQuery,
    categoryId: selectedCategory,
    storeId: currentStoreId || undefined,
  });
  const { data: variantsData } = useGetLocalVariantsQuery(undefined);

  const getProductVariants = React.useCallback(
    (product: any) =>
      (variantsData || []).filter(
        (variant: any) =>
          variant.productId === product.id ||
          variant.productId === product.remoteId,
      ),
    [variantsData],
  );

  const saleItems = React.useMemo(() => {
    if (!productsData) return [];
    return productsData.flatMap((product: any) => {
      const variants = getProductVariants(product);
      if (!variants.length) return [product];
      return variants.map((variant: any) => ({
        ...product,
        id: `${product.id}::variant::${variant.id}`,
        productId: product.id,
        variantId: variant.remoteId || variant.id,
        name: `${product.name} — ${variant.name}`,
        sku: variant.sku || product.sku,
        barcode: variant.barcode || product.barcode,
        sellingPrice: variant.price ?? product.sellingPrice,
      }));
    });
  }, [productsData, getProductVariants]);

  const { data: categoriesData } = useGetLocalCategoriesQuery(undefined);
  const { data: customersData } = useGetLocalCustomersQuery({
    search: customerSearch || undefined,
  });
  const { data: activeSession } = useGetActiveSessionQuery({
    userId: user?.id || "",
  });
  const { data: inventoryData } = useGetLocalInventoryQuery({
    storeId: currentStoreId || undefined,
  });
  const { data: storeSettings = [] } = useGetLocalStoreSettingsQuery(
    { storeId: currentStoreId || "" },
    { skip: !currentStoreId },
  );

  const matchesId = (value: any, target: any) =>
    value != null &&
    target != null &&
    (String(value) === String(target) ||
      String(value) === String(target.id) ||
      String(value) === String(target.remoteId));
  const findInventory = (product: any, variant?: any) =>
    (() => {
      const rows =
        inventoryData?.filter((inv: any) =>
          matchesId(inv.productId, product),
        ) ?? [];
      if (!variant) return rows.find((inv: any) => inv.variantId == null);
      const exact = rows.find((inv: any) => matchesId(inv.variantId, variant));
      if (exact) return exact;
      // Backward-compatible mode: the backend has variants but stock is still
      // stored on the parent product row (variantId = null).
      const hasSeparatedVariantStock = rows.some(
        (inv: any) => inv.variantId != null,
      );
      return hasSeparatedVariantStock
        ? undefined
        : rows.find((inv: any) => inv.variantId == null);
    })();
  const hasSeparatedVariantInventory = (product: any, variant: any) =>
    inventoryData?.some(
      (inv: any) =>
        matchesId(inv.productId, product) &&
        inv.variantId != null &&
        matchesId(inv.variantId, variant),
    ) ?? false;

  // Mutations
  const [createOrder] = useCreateLocalOrderMutation();

  // Cart state
  const cartItems = useAppSelector((state) => state.cart.items);
  const cartTotal = cartItems.reduce(
    (total, item) => total + item.price * item.qty,
    0,
  );
  const cartCount = cartItems.reduce((count, item) => count + item.qty, 0);
  const cartSubtotal = cartTotal;
  const settingValue = (key: string, fallback: any) => {
    const value = (storeSettings as any[]).find((item) => item.settingKey === key)?.settingValue;
    return value ?? fallback;
  };
  const taxRate = Number(settingValue("tax_rate", 0)) || 0;
  const taxableSubtotal = cartItems
    .filter((item: any) => item.isTaxable !== false)
    .reduce((total, item) => total + item.price * item.qty, 0);
  const taxAmount = taxableSubtotal * (taxRate / 100);
  const currencySymbol = String(settingValue("currency_symbol", "$"));
  const discountAmount = 0;
  const grandTotal = cartSubtotal + taxAmount - discountAmount;

  // // Check if any items are out of stock
  const hasOutOfStockItems = cartItems.some((item) => {
    const inventory = findInventory(item.productId || item.id, item.variantId);
    return inventory && inventory.quantity < item.qty;
  });

  const hasUnallocatedVariantStock = cartItems.some((item) => {
    if (!item.variantId) return false;
    const rows =
      inventoryData?.filter((inv: any) =>
        matchesId(inv.productId, item.productId || item.id),
      ) ?? [];
    const hasSeparatedVariantStock = rows.some(
      (inv: any) => inv.variantId != null,
    );
    if (!hasSeparatedVariantStock) {
      // Backend flattened or legacy product: stock is entirely on master product.
      // We gracefully fallback to master, so no unallocated error.
      return false;
    }
    // If separated stock exists for the product, but this specific variant is missing it:
    return !hasSeparatedVariantInventory(
      item.productId || item.id,
      item.variantId,
    );
  });
  // Handlers
  const handleAddToCart = (product: any) => {
    const inventory = findInventory(
      product.productId || product.id,
      product.variantId,
    );
    if (inventory && inventory.quantity <= 0) {
      Alert.alert("Out of Stock", `${product.name} is currently out of stock.`);
      return;
    }
    dispatch(
      addToCart({
        id: product.id,
        productId: product.productId || product.id,
        variantId: product.variantId,
        name: product.name,
        price: product.sellingPrice,
        qty: 1,
        sku: product.sku,
        barcode: product.barcode,
        stockQuantity: inventory?.quantity || 0,
      }),
    );
  };

  const handleProductPress = (product: any) => {
    const variants = getProductVariants(product);
    if (variants.length > 0) {
      setSelectedProductForVariants(product);
      return;
    }
    handleAddToCart(product);
  };

  const handleUpdateQuantity = (id: string, qty: number) => {
    if (qty <= 0) {
      dispatch(removeFromCart(id));
    } else {
      dispatch(updateQuantity({ id, qty }));
    }
  };

  const handleRemoveItem = (id: string) => {
    dispatch(removeFromCart(id));
  };

  const handleScan = (data: string) => {
    let scannedItem = null;
    const variant = variantsData?.find(
      (v: any) =>
        v.barcode === data ||
        v.sku === data ||
        v.id === data ||
        v.remoteId === data,
    );
    if (variant) {
      scannedItem = saleItems.find(
        (item: any) => item.variantId === variant.id,
      );
    } else {
      const product = productsData?.find(
        (p: any) => p.barcode === data || p.sku === data || p.id === data,
      );
      if (product) {
        scannedItem =
          saleItems.find((item: any) => item.id === product.id) || product;
      }
    }

    if (scannedItem) {
      if (scannerMode === "single") {
        setShowScannerModal(false);
        handleAddToCart(scannedItem);
      } else {
        setScannedPreviewItems((prev) => {
          const existing = prev.find((item) => item.id === scannedItem.id);
          if (existing) {
            return prev.map((item) =>
              item.id === scannedItem.id
                ? { ...item, previewQty: (item.previewQty || 1) + 1 }
                : item,
            );
          }
          return [...prev, { ...scannedItem, previewQty: 1 }];
        });
      }
    } else {
      if (scannerMode === "single") {
        setShowScannerModal(false);
        setSearchQuery(data);
      } else {
        Alert.alert("Not Found", `Barcode ${data} not found in catalog.`);
      }
    }
  };

  const openCart = () => {
    if (cartCount === 0) {
      Alert.alert("Cart Empty", "Please add items to the cart first.");
      return;
    }
    setShowCartModal(true);
    Animated.timing(slideAnim, {
      toValue: 0,
      duration: 160,
      useNativeDriver: true,
      // speed: 12,
    }).start();
  };

  const closeCart = () => {
    Animated.timing(slideAnim, {
      toValue: height,
      duration: 160,
      useNativeDriver: true,
      // speed: 12,
    }).start(() => setShowCartModal(false));
  };

  const handleCheckout = async () => {
    if (!canCheckout) {
      Alert.alert("Permission required", "You cannot create sales orders.");
      return;
    }
    if (cartItems.length === 0) {
      Alert.alert("Cart Empty", "Please add items to the cart first.");
      return;
    }
    if (hasOutOfStockItems) {
      Alert.alert(
        "Insufficient Stock",
        "Some items in your cart don't have enough stock. Please adjust quantities.",
      );
      return;
    }

    if (hasUnallocatedVariantStock) {
      Alert.alert(
        "Variant Stock Error",
        "This product has options, but its stock is still stored on the master product. Allocate the stock to each option before selling it.",
      );
      return;
    }
    if (!activeSession) {
      Alert.alert(
        "No Active Session",
        "Please open a session before placing an order.",
        [
          { text: "Open Session", onPress: () => router.push("/manage") },
          { text: "Cancel", style: "cancel" },
        ],
      );
      return;
    }

    setIsSubmitting(true);

    try {
      // For variant items, the cart `id` is "productId::variant::variantId"
      // but `productId` should always be the real product ID (not the composite).
      const resolveProductId = (item: any) => {
        if (item.productId) return item.productId;
        // Fallback: strip composite variant key if present
        const raw = item.id;
        if (typeof raw === "string" && raw.includes("::variant::")) {
          return raw.split("::variant::")[0];
        }
        return raw;
      };

      const orderPayload = {
        tenantId: user?.tenantId || "",
        storeId: activeSession.storeId || "",
        sessionId: activeSession.id,
        userId: user?.id || "",
        customerId: selectedCustomer?.id,
        paymentMethod: paymentMethod || "CASH",
        paymentStatus: "PAID",
        subTotal: cartSubtotal,
        taxAmount: taxAmount,
        discountAmount: discountAmount,
        grandTotal: grandTotal,
        paidAmount: grandTotal,
        changeAmount: 0,
        items: cartItems.map((item) => ({
          productId: resolveProductId(item),
          variantId: item.variantId || undefined,
          productName: item.name,
          quantity: item.qty,
          unitPrice: item.price,
          subTotal: item.price * item.qty,
          discountAmount: 0,
        })),
        syncItems: cartItems.map((item) => ({
          productId: resolveProductId(item),
          variantId: item.variantId || undefined,
          productName: item.name,
          quantity: item.qty,
          unitPrice: item.price,
          subTotal: item.price * item.qty,
          discountAmount: 0,
        })),
      };

      console.log("📦 Order payload:", JSON.stringify(orderPayload, null, 2));

      const result = await createOrder(orderPayload).unwrap();
      if (!result) throw new Error("Order was not created");

      // for (const item of cartItems) {
      //   await createInventoryMovement({
      //     tenantId: user?.tenantId,
      //     storeId: activeSession.storeId,
      //     productId: item.productId || item.id,
      //     // If the backend still stores shared product stock, send the
      //     // movement against the product row while keeping variantId on the
      //     // order item for reporting.
      //     variantId: hasSeparatedVariantInventory(
      //       item.productId || item.id,
      //       item.variantId,
      //     )
      //       ? item.variantId
      //       : undefined,
      //     quantity: item.qty,
      //     type: "OUT",
      //     referenceId: result.id,
      //     referenceType: "ORDER",
      //     reason: `Order #${result.orderNumber || result.id}`,
      //   }).unwrap();
      // }

      // The order sync endpoint deducts stock and writes the authoritative
      // SALE movement on the server. Do not enqueue a second movement here:
      // it would deduct the same quantity twice when the device reconnects.

      dispatch(clearCart());
      setSelectedCustomer(null);
      closeCart();
      router.push(`/receipt/${result.id}`);
      refetch();
    } catch (error: any) {
      console.error("❌ Checkout error:", error);
      console.error("❌ Error details:", JSON.stringify(error, null, 2));
      Alert.alert(
        "Checkout Failed",
        error?.message || error?.data?.message || "Failed to create order. Please try again.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  const renderCartItem = ({ item }: { item: any }) => {
    const inventory = findInventory(item.productId || item.id, item.variantId);
    const maxQty = inventory?.quantity || 0;

    return (
      <View className="flex-row items-center py-3 border-b border-white/5">
        <View className="flex-1">
          <Text className="text-white font-bold text-base">{item.name}</Text>
          <Text className="text-slate-400 text-xs">
            SKU: {item.sku || "N/A"}
          </Text>
          <Text className="text-sky-300 font-bold text-sm mt-1">
            ${item.price.toFixed(2)}
          </Text>
          {maxQty > 0 && (
            <Text className="text-slate-500 text-[10px]">
              Available: {maxQty}
            </Text>
          )}
        </View>

        <View className="flex-row items-center">
          <TouchableOpacity
            className="bg-white/10 rounded-full w-8 h-8 items-center justify-center"
            onPress={() => handleUpdateQuantity(item.id, item.qty - 1)}
          >
            <MaterialIcons name="remove" size={18} color="#cbd5e1" />
          </TouchableOpacity>

          <Text className="text-white font-bold text-lg w-10 text-center">
            {item.qty}
          </Text>

          <TouchableOpacity
            className={`bg-white/10 rounded-full w-8 h-8 items-center justify-center ${
              item.qty >= maxQty && maxQty > 0 ? "opacity-50" : ""
            }`}
            onPress={() => handleUpdateQuantity(item.id, item.qty + 1)}
            disabled={item.qty >= maxQty && maxQty > 0}
          >
            <MaterialIcons name="add" size={18} color="#cbd5e1" />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          className="ml-3 bg-red-500/20 p-2 rounded-full"
          onPress={() => handleRemoveItem(item.id)}
        >
          <MaterialIcons name="delete-outline" size={18} color="#f87171" />
        </TouchableOpacity>
      </View>
    );
  };

  // ✅ Updated renderProduct to show stock quantity
  const renderProduct = ({ item }: { item: any }) => {
    const variants = getProductVariants(item);
    const inCart = cartItems.find(
      (cartItem) => cartItem.productId === item.id && !cartItem.variantId,
    );
    const inventory = findInventory(item.id);
    const productRows =
      inventoryData?.filter((inv: any) => matchesId(inv.productId, item)) ?? [];
    const hasSeparatedVariantStock = productRows.some(
      (inv: any) => inv.variantId != null,
    );
    const stockQty =
      variants.length && hasSeparatedVariantStock
        ? variants.reduce(
            (total: number, variant: any) =>
              total + (findInventory(item, variant)?.quantity || 0),
            0,
          )
        : (inventory?.quantity ?? 0);
    const isOutOfStock = variants.length
      ? hasSeparatedVariantStock
        ? variants.every(
            (variant: any) =>
              (findInventory(item, variant)?.quantity || 0) <= 0,
          )
        : stockQty <= 0
      : stockQty === 0;

    return (
      <TouchableOpacity
        className={`flex-1 m-2 active:scale-95 transition-transform ${
          isOutOfStock ? "opacity-50" : ""
        }`}
        onPress={() => !isOutOfStock && handleProductPress(item)}
        disabled={isOutOfStock}
      >
        <Card className="flex-1 p-4 bg-slate-900/80">
          {inCart && (
            <View className="absolute top-2 right-2 bg-sky-500 rounded-full w-6 h-6 items-center justify-center z-10">
              <Text className="text-white text-xs font-bold">{inCart.qty}</Text>
            </View>
          )}
          {isOutOfStock && (
            <View className="absolute top-2 left-2 bg-rose-500/80 rounded-full px-2 py-0.5 z-10">
              <Text className="text-white text-[8px] font-bold uppercase">
                Out of Stock
              </Text>
            </View>
          )}
          <View className="h-28 bg-slate-800/50 rounded-xl mb-3 items-center justify-center border border-white/5">
            <MaterialIcons name="inventory-2" size={36} color="#64748b" />
          </View>
          <Text
            className="text-slate-200 font-bold text-base mb-1"
            numberOfLines={1}
          >
            {item.name}
          </Text>
          <Text
            className="text-sky-300/80 text-[10px] font-bold uppercase tracking-[2px] mb-3"
            numberOfLines={1}
          >
            {variants.length
              ? `${variants.length} variants`
              : `SKU: ${item.sku}`}
          </Text>
          <View className="flex-row items-center justify-between mt-auto">
            <View>
              <Text className="text-white font-black text-lg">
                {variants.length
                  ? `From $${Math.min(...variants.map((v: any) => Number(v.price) || 0)).toFixed(2)}`
                  : `$${item.sellingPrice?.toFixed(2) ?? "0.00"}`}
              </Text>
              {/* ✅ Stock label */}
              <Text className="text-slate-400 text-[10px] mt-0.5">
                {variants.length
                  ? `Choose variant • ${stockQty} total`
                  : `Stock: ${stockQty}`}
              </Text>
            </View>
            {!isOutOfStock && (
              <View className="bg-sky-500/20 p-2 rounded-full border border-sky-500/20">
                <MaterialIcons name="add" size={16} color="#7dd3fc" />
              </View>
            )}
          </View>
        </Card>
      </TouchableOpacity>
    );
  };

  return (
    <SafeAreaView className="flex-1 bg-slate-950 pt-2">
      <Screen padded={false}>
        <View className="px-5 pt-4 pb-2">
          <Header
            eyebrow={`${!user ? "Tenant" : user?.tenant?.code + " - " + user?.role}`}
            // eyebrow`${!user ? "Tenant" : user?.tenant.name}-${user?.tenant.code}`}
            title="New Order"
            subtitle={`${!user ? "Store" : user?.stores[0].code + " - " + user?.stores[0].name}`}
            // subtitle={`${!user ? "Store" : user?.stores.map((a: any) => a.code)}-${!user ? "Store" : user?.stores.map((a: any) => a.name).join(", ")} - ${!user ? "Store" : user?.role} : ${!user ? "Store" : user?.name}`}
            // subtitle={`${!user ? "Store" : user?.stores[0].code}-${user?.stores[0].name} - ${!user ? "Store" : user?.role} : ${!user ? "Store" : user?.name}`}
            // subtitle={
            //   user.role === "ADMIN"
            //     ? `${user.tenant.name}-${user.tenant.code}`
            //     : `${user.stores[0].code}-${user.stores[0].name} - ${user.role}`
            // }
          />
          <View className="flex-row items-center bg-white/5 rounded-full px-1 border border-white/10">
            <MaterialIcons name="search" size={22} color="#94a3b8" />
            <TextInput
              className="flex-1 ml-3 text-white text-sm font-medium"
              placeholder="Search products, SKUs..."
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
          <View className="mt-2 flex-row items-center">
            <View
              className={`w-2 h-2 rounded-full mr-2 ${
                activeSession ? "bg-emerald-400" : "bg-rose-400"
              }`}
            />
            <Text className="text-slate-400 text-xs">
              {activeSession
                ? `Session Active • ${new Date(activeSession.openedAt).toLocaleTimeString()}`
                : "No Active Session"}
            </Text>
          </View>
        </View>

        <View className="pl-5 mb-2 mt-3 h-10">
          <ScrollView
            horizontal
            showsHorizontalScrollIndicator={false}
            contentContainerStyle={{ paddingRight: 20 }}
          >
            <TouchableOpacity
              className="mr-2"
              onPress={() => setSelectedCategory(undefined)}
            >
              <Pill
                label="All Items"
                tone={!selectedCategory ? "sky" : "amber"}
              />
            </TouchableOpacity>
            {categoriesData?.map((cat: any) => (
              <TouchableOpacity
                key={cat.id}
                className="mr-2"
                onPress={() => setSelectedCategory(cat.id)}
              >
                <Pill
                  label={cat.name}
                  tone={selectedCategory === cat.id ? "sky" : "amber"}
                />
              </TouchableOpacity>
            ))}
          </ScrollView>
        </View>

        <FlatList
          data={productsData || []}
          keyExtractor={(item) => item.id}
          numColumns={2}
          contentContainerStyle={{
            paddingHorizontal: 12,
            paddingBottom: 120,
            paddingTop: 8,
          }}
          renderItem={renderProduct}
          ListEmptyComponent={
            <View className="flex-1 items-center justify-center mt-24">
              <View className="h-20 w-20 bg-white/5 rounded-full items-center justify-center border border-white/10">
                <MaterialIcons name="inbox" size={32} color="#64748b" />
              </View>
              <Text className="text-white mt-4 text-lg font-bold">
                No products found
              </Text>
              <Text className="text-slate-500 mt-2 text-sm text-center px-10 leading-5">
                Try adjusting your search or sync to pull latest items from the
                server.
              </Text>
            </View>
          }
        />

        {cartCount > 0 && (
          <View className="absolute bottom-6 left-5 right-5">
            <TouchableOpacity
              className="bg-sky-500 rounded-[24px] flex-row items-center justify-between p-4 shadow-lg shadow-sky-500/20 border border-sky-400"
              activeOpacity={0.9}
              onPress={openCart}
            >
              <View className="flex-row items-center">
                <View className="bg-white/20 rounded-full w-10 h-10 items-center justify-center border border-white/20">
                  <Text className="text-white font-black text-lg">
                    {cartCount}
                  </Text>
                </View>
                <Text className="text-white font-bold text-lg ml-3">
                  View Cart
                </Text>
              </View>
              <Text className="text-white font-black text-xl">
                {currencySymbol}{cartTotal.toFixed(2)}
              </Text>
            </TouchableOpacity>
          </View>
        )}

        <Modal
          visible={showCartModal}
          transparent
          animationType="none"
          onRequestClose={closeCart}
        >
          <View className="flex-1 bg-black/70">
            <TouchableOpacity
              className="flex-1"
              activeOpacity={1}
              onPress={closeCart}
            />
            <Animated.View
              style={{ transform: [{ translateY: slideAnim }] }}
              className="bg-slate-900 rounded-t-3xl max-h-[85%] min-h-[50%]"
            >
              <View className="px-5 pt-5 pb-4">
                <View className="flex-row justify-between items-center mb-4">
                  <Text className="text-white font-bold text-xl">
                    Your Cart ({cartCount} items)
                  </Text>
                  <TouchableOpacity onPress={closeCart}>
                    <MaterialIcons name="close" size={24} color="#94a3b8" />
                  </TouchableOpacity>
                </View>

                <TouchableOpacity
                  className="flex-row items-center justify-between bg-white/5 rounded-xl p-3 mb-4 border border-white/10"
                  onPress={() => setShowCustomerSelect(!showCustomerSelect)}
                >
                  <View className="flex-row items-center">
                    <MaterialIcons
                      name="person-outline"
                      size={20}
                      color="#94a3b8"
                    />
                    <Text className="text-white ml-2">
                      {selectedCustomer
                        ? `${selectedCustomer.name} (${selectedCustomer.code})`
                        : "Select Customer"}
                    </Text>
                  </View>
                  <MaterialIcons
                    name={showCustomerSelect ? "expand-less" : "expand-more"}
                    size={20}
                    color="#94a3b8"
                  />
                </TouchableOpacity>

                {showCustomerSelect && (
                  <View className="bg-white/5 rounded-xl p-3 mb-4 max-h-40">
                    <TextInput
                      className="bg-white/10 rounded-lg p-2 text-white text-sm mb-2"
                      placeholder="Search customers..."
                      placeholderTextColor="#64748b"
                      value={customerSearch}
                      onChangeText={setCustomerSearch}
                    />
                    <FlatList
                      data={customersData || []}
                      keyExtractor={(item) => item.id}
                      renderItem={({ item }) => (
                        <TouchableOpacity
                          className="py-2 border-b border-white/5"
                          onPress={() => {
                            setSelectedCustomer(item);
                            setShowCustomerSelect(false);
                            setCustomerSearch("");
                          }}
                        >
                          <Text className="text-white">{item.name}</Text>
                          <Text className="text-slate-400 text-xs">
                            {item.code} • {item.phone || "No phone"}
                          </Text>
                        </TouchableOpacity>
                      )}
                      ListEmptyComponent={
                        <Text className="text-slate-400 text-center py-2">
                          No customers found
                        </Text>
                      }
                    />
                  </View>
                )}

                <FlatList
                  data={cartItems}
                  keyExtractor={(item) => item.id}
                  renderItem={renderCartItem}
                  className="max-h-60"
                  showsVerticalScrollIndicator={false}
                />

                <View className="mt-4 pt-4 border-t border-white/10">
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-slate-400">Subtotal</Text>
                    <Text className="text-white">
                      ${cartSubtotal.toFixed(2)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-slate-400">Tax ({taxRate}%)</Text>
                    <Text className="text-white">{currencySymbol}{taxAmount.toFixed(2)}</Text>
                  </View>
                  <View className="flex-row justify-between mb-1">
                    <Text className="text-slate-400">Discount</Text>
                    <Text className="text-white">
                      -${discountAmount.toFixed(2)}
                    </Text>
                  </View>
                  <View className="flex-row justify-between mt-2 pt-2 border-t border-white/20">
                    <Text className="text-white font-bold text-lg">Total</Text>
                    <Text className="text-sky-400 font-bold text-lg">
                      ${grandTotal.toFixed(2)}
                    </Text>
                  </View>

                  <View className="flex-row mt-4 gap-2">
                    {["CASH", "CARD", "DIGITAL"].map((method) => (
                      <TouchableOpacity
                        key={method}
                        className={`flex-1 py-2 rounded-lg ${
                          paymentMethod === method
                            ? "bg-sky-500"
                            : "bg-white/10"
                        }`}
                        onPress={() => setPaymentMethod(method)}
                      >
                        <Text
                          className={`text-center text-sm font-bold ${
                            paymentMethod === method
                              ? "text-white"
                              : "text-slate-400"
                          }`}
                        >
                          {method}
                        </Text>
                      </TouchableOpacity>
                    ))}
                  </View>

                  {hasOutOfStockItems && (
                    <View className="mt-3 bg-rose-500/20 p-3 rounded-xl border border-rose-500/30">
                      <Text className="text-rose-400 text-xs font-medium text-center">
                        ⚠️ Some items exceed available stock
                      </Text>
                    </View>
                  )}

                  <TouchableOpacity
                    className={`mt-4 py-4 rounded-xl ${
                      !canCheckout ||
                      cartItems.length === 0 ||
                      isSubmitting ||
                      hasOutOfStockItems
                        ? "bg-slate-700"
                        : "bg-emerald-500"
                    }`}
                    onPress={handleCheckout}
                    disabled={
                      cartItems.length === 0 ||
                      isSubmitting ||
                      hasOutOfStockItems
                    }
                  >
                    {isSubmitting ? (
                      <ActivityIndicator color="white" />
                    ) : (
                      <Text className="text-white text-center font-bold text-lg">
                        Complete Order • ${grandTotal.toFixed(2)}
                      </Text>
                    )}
                  </TouchableOpacity>

                  <View className="flex-row mt-3 gap-3">
                    <TouchableOpacity
                      className="flex-1 py-2 bg-white/5 rounded-xl border border-white/10"
                      onPress={() => {
                        Alert.alert(
                          "Clear Cart",
                          "Are you sure you want to clear the cart?",
                          [
                            { text: "Cancel", style: "cancel" },
                            {
                              text: "Clear",
                              style: "destructive",
                              onPress: () => dispatch(clearCart()),
                            },
                          ],
                        );
                      }}
                    >
                      <Text className="text-red-400 text-center text-sm font-medium">
                        Clear Cart
                      </Text>
                    </TouchableOpacity>
                    <TouchableOpacity
                      className="flex-1 py-2 bg-white/5 rounded-xl border border-white/10"
                      onPress={() => {
                        setSelectedCustomer(null);
                        Alert.alert(
                          "Customer Cleared",
                          "Customer has been removed.",
                        );
                      }}
                    >
                      <Text className="text-slate-400 text-center text-sm font-medium">
                        Remove Customer
                      </Text>
                    </TouchableOpacity>
                  </View>
                </View>
              </View>
            </Animated.View>
          </View>
        </Modal>

        <Modal
          visible={!!selectedProductForVariants}
          transparent
          animationType="slide"
          onRequestClose={() => setSelectedProductForVariants(null)}
        >
          <View className="flex-1 bg-black/70 justify-end">
            <View className="bg-slate-900 rounded-t-3xl p-5 max-h-[75%]">
              <View className="flex-row items-center justify-between mb-2">
                <View className="flex-1 mr-3">
                  <Text className="text-white font-black text-xl">
                    {selectedProductForVariants?.name}
                  </Text>
                  <Text className="text-slate-400 text-sm mt-1">
                    Choose a variant
                  </Text>
                </View>
                <TouchableOpacity
                  onPress={() => setSelectedProductForVariants(null)}
                  className="bg-white/10 rounded-full p-2"
                >
                  <MaterialIcons name="close" size={20} color="#cbd5e1" />
                </TouchableOpacity>
              </View>

              <FlatList
                data={getProductVariants(selectedProductForVariants || {})}
                keyExtractor={(variant: any) => variant.id}
                renderItem={({ item: variant }: { item: any }) => {
                  const stock =
                    findInventory(selectedProductForVariants, variant)
                      ?.quantity || 0;
                  const saleItem = saleItems.find(
                    (item: any) =>
                      item.variantId === (variant.remoteId || variant.id),
                  );
                  const unavailable = stock <= 0;
                  return (
                    <TouchableOpacity
                      disabled={unavailable}
                      onPress={() => {
                        if (saleItem) handleAddToCart(saleItem);
                        setSelectedProductForVariants(null);
                      }}
                      className={`flex-row items-center p-4 mb-3 rounded-2xl border ${
                        unavailable
                          ? "bg-white/5 border-white/5 opacity-50"
                          : "bg-white/8 border-sky-400/30"
                      }`}
                    >
                      <View className="flex-1">
                        <Text className="text-white font-bold text-base">
                          {variant.name}
                        </Text>
                        <Text className="text-slate-400 text-xs mt-1">
                          {variant.color || variant.size
                            ? [variant.color, variant.size]
                                .filter(Boolean)
                                .join(" • ")
                            : variant.sku}
                        </Text>
                        <Text className="text-slate-500 text-[10px] mt-1">
                          SKU: {variant.sku} • Stock: {stock}
                        </Text>
                      </View>
                      <Text className="text-sky-300 font-black text-lg">
                        ${Number(variant.price || 0).toFixed(2)}
                      </Text>
                    </TouchableOpacity>
                  );
                }}
                ListEmptyComponent={
                  <Text className="text-slate-400 text-center py-8">
                    No variants available
                  </Text>
                }
              />
            </View>
          </View>
        </Modal>

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
                <View className="flex-row justify-between items-center mb-4">
                  <Text className="text-white font-bold text-lg">
                    Scanned Items (
                    {scannedPreviewItems.reduce(
                      (acc, i) => acc + (i.previewQty || 1),
                      0,
                    )}
                    )
                  </Text>
                  <TouchableOpacity
                    className="bg-sky-500 px-6 py-2 rounded-full"
                    onPress={() => {
                      scannedPreviewItems.forEach((item) => {
                        for (let i = 0; i < (item.previewQty || 1); i++) {
                          handleAddToCart(item);
                        }
                      });
                      setScannedPreviewItems([]);
                      setShowScannerModal(false);
                    }}
                  >
                    <Text className="text-white font-bold">Add to Cart</Text>
                  </TouchableOpacity>
                </View>
                <FlatList
                  data={scannedPreviewItems}
                  keyExtractor={(item) => item.id}
                  renderItem={({ item }) => (
                    <View className="flex-row justify-between items-center py-3 border-b border-white/10">
                      <View className="flex-1 pr-2">
                        <Text className="text-white font-bold">
                          {item.name}
                        </Text>
                        <Text className="text-white/60 text-xs mt-1">
                          SKU: {item.sku || "N/A"}
                        </Text>
                      </View>
                      <View className="flex-row items-center">
                        <Text className="text-white font-bold mr-4">
                          ${(item.sellingPrice || 0).toFixed(2)}
                        </Text>
                        <View className="bg-white/20 px-3 py-1 rounded-full">
                          <Text className="text-white font-bold">
                            x{item.previewQty || 1}
                          </Text>
                        </View>
                      </View>
                    </View>
                  )}
                />
              </View>
            ) : null
          }
        />
      </Screen>
    </SafeAreaView>
  );
}

// import { Card, Header, Pill, Screen } from "@/components/app-ui";
// import { BarcodeScannerModal } from "@/components/barcode-scanner-modal";
// import { useAppDispatch } from "@/hooks/redux-hooks/useAppDispatch";
// import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";

// import {
//   addToCart,
//   clearCart,
//   removeFromCart,
//   updateQuantity,
// } from "@/services/features/cart/cartSlice";
// import {
//   useCreateLocalInventoryMovementMutation,
//   useCreateLocalOrderMutation,
//   useGetActiveSessionQuery,
//   useGetLocalCategoriesQuery,
//   useGetLocalCustomersQuery,
//   useGetLocalInventoryQuery,
//   useGetLocalProductsQuery,
// } from "@/services/features/offline/localApi";
// import { MaterialIcons } from "@expo/vector-icons";
// import { router } from "expo-router";
// import React, { useRef, useState } from "react";
// import {
//   ActivityIndicator,
//   Alert,
//   Animated,
//   Dimensions,
//   FlatList,
//   Modal,
//   SafeAreaView,
//   ScrollView,
//   Text,
//   TextInput,
//   TouchableOpacity,
//   View,
// } from "react-native";

// const { height } = Dimensions.get("window");

// export default function POSScreen() {
//   const dispatch = useAppDispatch();
//   const user = useAppSelector((state) => state.auth.user);

//   // State
//   const [searchQuery, setSearchQuery] = useState("");
//   const [showScannerModal, setShowScannerModal] = useState(false);
//   const [selectedCategory, setSelectedCategory] = useState<string | undefined>(
//     undefined,
//   );
//   const [showCartModal, setShowCartModal] = useState(false);
//   const [selectedCustomer, setSelectedCustomer] = useState<any>(null);
//   const [showCustomerSelect, setShowCustomerSelect] = useState(false);
//   const [isSubmitting, setIsSubmitting] = useState(false);
//   const [paymentMethod, setPaymentMethod] = useState<string>("CASH");
//   const [customerSearch, setCustomerSearch] = useState("");

//   // Animations
//   const slideAnim = useRef(new Animated.Value(height)).current;

//   // Queries
//   const {
//     data: productsData,
//     isLoading: isProductsLoading,
//     refetch,
//   } = useGetLocalProductsQuery({
//     search: searchQuery,
//     categoryId: selectedCategory,
//   });

//   const { data: categoriesData } = useGetLocalCategoriesQuery();
//   const { data: customersData } = useGetLocalCustomersQuery({
//     search: customerSearch || undefined,
//   });
//   const { data: activeSession } = useGetActiveSessionQuery({
//     userId: user?.id || "",
//   });
//   const { data: inventoryData } = useGetLocalInventoryQuery({});

//   // Mutations
//   const [createOrder] = useCreateLocalOrderMutation();
//   const [createInventoryMovement] = useCreateLocalInventoryMovementMutation();

//   // Cart state
//   const cartItems = useAppSelector((state) => state.cart.items);
//   const cartTotal = cartItems.reduce(
//     (total, item) => total + item.price * item.qty,
//     0,
//   );
//   const cartCount = cartItems.reduce((count, item) => count + item.qty, 0);
//   const cartSubtotal = cartTotal;
//   const taxAmount = cartTotal * 0.05; // 5% tax
//   const discountAmount = 0;
//   const grandTotal = cartSubtotal + taxAmount - discountAmount;

//   // Check if any items are out of stock
//   const hasOutOfStockItems = cartItems.some((item) => {
//     const inventory = inventoryData?.find(
//       (inv: any) => inv.productId === item.id && inv.quantity < item.qty,
//     );
//     return inventory && inventory.quantity < item.qty;
//   });

//   // Handlers
//   const handleAddToCart = (product: any) => {
//     // Check if product has inventory
//     const inventory = inventoryData?.find(
//       (inv: any) => inv.productId === product.id,
//     );

//     if (inventory && inventory.quantity <= 0) {
//       Alert.alert("Out of Stock", `${product.name} is currently out of stock.`);
//       return;
//     }

//     dispatch(
//       addToCart({
//         id: product.id,
//         name: product.name,
//         price: product.sellingPrice,
//         qty: 1,
//         sku: product.sku,
//         barcode: product.barcode,
//         stockQuantity: inventory?.quantity || 0,
//       }),
//     );
//   };

//   const handleUpdateQuantity = (id: string, qty: number) => {
//     if (qty <= 0) {
//       dispatch(removeFromCart(id));
//     } else {
//       dispatch(updateQuantity({ id, qty }));
//     }
//   };

//   const handleRemoveItem = (id: string) => {
//     dispatch(removeFromCart(id));
//   };

//   const handleScan = (data: string) => {
//     setShowScannerModal(false);
//     const product = productsData?.find(
//       (p: any) => p.barcode === data || p.sku === data || p.id === data,
//     );
//     if (product) {
//       handleAddToCart(product);
//     } else {
//       setSearchQuery(data);
//     }
//   };

//   const openCart = () => {
//     if (cartCount === 0) {
//       Alert.alert("Cart Empty", "Please add items to the cart first.");
//       return;
//     }
//     setShowCartModal(true);
//     Animated.spring(slideAnim, {
//       toValue: 0,
//       useNativeDriver: true,
//       speed: 12,
//     }).start();
//   };

//   const closeCart = () => {
//     Animated.spring(slideAnim, {
//       toValue: height,
//       useNativeDriver: true,
//       speed: 12,
//     }).start(() => setShowCartModal(false));
//   };

//   const handleCheckout = async () => {
//     if (cartItems.length === 0) {
//       Alert.alert("Cart Empty", "Please add items to the cart first.");
//       return;
//     }

//     if (hasOutOfStockItems) {
//       Alert.alert(
//         "Insufficient Stock",
//         "Some items in your cart don't have enough stock. Please adjust quantities.",
//       );
//       return;
//     }

//     if (!activeSession) {
//       Alert.alert(
//         "No Active Session",
//         "Please open a session before placing an order.",
//         [
//           { text: "Open Session", onPress: () => router.push("/sessions") },
//           // { text: "Open Session", onPress: () => router.push("/sessions") },
//           { text: "Cancel", style: "cancel" },
//         ],
//       );
//       return;
//     }

//     setIsSubmitting(true);

//     try {
//       const orderPayload = {
//         tenantId: user?.tenantId,
//         storeId: activeSession.storeId,
//         sessionId: activeSession.id,
//         userId: user?.id,
//         customerId: selectedCustomer?.id,
//         paymentMethod: paymentMethod,
//         paymentStatus: "PAID",
//         subTotal: cartSubtotal,
//         taxAmount: taxAmount,
//         discountAmount: discountAmount,
//         grandTotal: grandTotal,
//         paidAmount: grandTotal,
//         changeAmount: 0,
//         items: cartItems.map((item) => ({
//           productId: item.id,
//           quantity: item.qty,
//           unitPrice: item.price,
//           subTotal: item.price * item.qty,
//           discountAmount: 0,
//         })),
//       };

//       const result = await createOrder(orderPayload).unwrap();

//       // Create inventory movements for each item
//       for (const item of cartItems) {
//         await createInventoryMovement({
//           tenantId: user?.tenantId,
//           storeId: activeSession.storeId,
//           productId: item.id,
//           quantity: item.qty,
//           type: "OUT",
//           referenceId: result.id,
//           referenceType: "ORDER",
//           reason: `Order #${result.orderNumber || result.id}`,
//         }).unwrap();
//       }

//       dispatch(clearCart());
//       setSelectedCustomer(null);
//       closeCart();

//       router.push(`/receipt/${result.id}`);
//       refetch();
//     } catch (error: any) {
//       Alert.alert(
//         "Checkout Failed",
//         error?.data?.message || "Failed to create order. Please try again.",
//       );
//     } finally {
//       setIsSubmitting(false);
//     }
//   };

//   const renderCartItem = ({ item }: { item: any }) => {
//     const inventory = inventoryData?.find(
//       (inv: any) => inv.productId === item.id,
//     );
//     const maxQty = inventory?.quantity || 0;

//     return (
//       <View className="flex-row items-center py-3 border-b border-white/5">
//         <View className="flex-1">
//           <Text className="text-white font-bold text-base">{item.name}</Text>
//           <Text className="text-slate-400 text-xs">
//             SKU: {item.sku || "N/A"}
//           </Text>
//           <Text className="text-sky-300 font-bold text-sm mt-1">
//             ${item.price.toFixed(2)}
//           </Text>
//           {maxQty > 0 && (
//             <Text className="text-slate-500 text-[10px]">
//               Available: {maxQty}
//             </Text>
//           )}
//         </View>

//         <View className="flex-row items-center">
//           <TouchableOpacity
//             className="bg-white/10 rounded-full w-8 h-8 items-center justify-center"
//             onPress={() => handleUpdateQuantity(item.id, item.qty - 1)}
//           >
//             <MaterialIcons name="remove" size={18} color="#cbd5e1" />
//           </TouchableOpacity>

//           <Text className="text-white font-bold text-lg w-10 text-center">
//             {item.qty}
//           </Text>

//           <TouchableOpacity
//             className={`bg-white/10 rounded-full w-8 h-8 items-center justify-center ${
//               item.qty >= maxQty && maxQty > 0 ? "opacity-50" : ""
//             }`}
//             onPress={() => handleUpdateQuantity(item.id, item.qty + 1)}
//             disabled={item.qty >= maxQty && maxQty > 0}
//           >
//             <MaterialIcons name="add" size={18} color="#cbd5e1" />
//           </TouchableOpacity>
//         </View>

//         <TouchableOpacity
//           className="ml-3 bg-red-500/20 p-2 rounded-full"
//           onPress={() => handleRemoveItem(item.id)}
//         >
//           <MaterialIcons name="delete-outline" size={18} color="#f87171" />
//         </TouchableOpacity>
//       </View>
//     );
//   };

//   const renderProduct = ({ item }: { item: any }) => {
//     const inCart = cartItems.find((i) => i.id === item.id);
//     const inventory = inventoryData?.find(
//       (inv: any) => inv.productId === item.id,
//     );
//     const isOutOfStock = inventory?.quantity === 0;

//     return (
//       <TouchableOpacity
//         className={`flex-1 m-2 active:scale-95 transition-transform ${
//           isOutOfStock ? "opacity-50" : ""
//         }`}
//         onPress={() => !isOutOfStock && handleAddToCart(item)}
//         disabled={isOutOfStock}
//       >
//         <Card className="flex-1 p-4 bg-slate-900/80">
//           {inCart && (
//             <View className="absolute top-2 right-2 bg-sky-500 rounded-full w-6 h-6 items-center justify-center z-10">
//               <Text className="text-white text-xs font-bold">{inCart.qty}</Text>
//             </View>
//           )}
//           {isOutOfStock && (
//             <View className="absolute top-2 left-2 bg-rose-500/80 rounded-full px-2 py-0.5 z-10">
//               <Text className="text-white text-[8px] font-bold uppercase">
//                 Out of Stock
//               </Text>
//             </View>
//           )}
//           <View className="h-28 bg-slate-800/50 rounded-xl mb-3 items-center justify-center border border-white/5">
//             <MaterialIcons name="inventory-2" size={36} color="#64748b" />
//           </View>
//           <Text
//             className="text-slate-200 font-bold text-base mb-1"
//             numberOfLines={1}
//           >
//             {item.name}
//           </Text>
//           <Text
//             className="text-sky-300/80 text-[10px] font-bold uppercase tracking-[2px] mb-3"
//             numberOfLines={1}
//           >
//             SKU: {item.sku}
//           </Text>
//           <View className="flex-row items-center justify-between mt-auto">
//             <Text className="text-white font-black text-lg">
//               ${item.sellingPrice?.toFixed(2) ?? "0.00"}
//             </Text>
//             {!isOutOfStock && (
//               <View className="bg-sky-500/20 p-2 rounded-full border border-sky-500/20">
//                 <MaterialIcons name="add" size={16} color="#7dd3fc" />
//               </View>
//             )}
//           </View>
//         </Card>
//       </TouchableOpacity>
//     );
//   };

//   return (
//     <SafeAreaView className="flex-1 bg-slate-950 pt-2">
//       <Screen padded={false}>
//         {/* Header Area */}
//         <View className="px-5 pt-4 pb-2">
//           <Header
//             eyebrow="Point of Sale"
//             title="New Order"
//             subtitle="Ready to take new orders"
//           />

//           {/* Search Bar */}
//           <View className="flex-row items-center bg-white/5 rounded-full px-1 border border-white/10">
//             <MaterialIcons name="search" size={22} color="#94a3b8" />
//             <TextInput
//               className="flex-1 ml-3 text-white text-sm font-medium"
//               placeholder="Search products, SKUs..."
//               placeholderTextColor="#64748b"
//               value={searchQuery}
//               onChangeText={setSearchQuery}
//             />
//             {searchQuery.length > 0 ? (
//               <TouchableOpacity
//                 onPress={() => setSearchQuery("")}
//                 className="bg-white/10 p-1.5 rounded-full"
//               >
//                 <MaterialIcons name="close" size={14} color="#cbd5e1" />
//               </TouchableOpacity>
//             ) : (
//               <TouchableOpacity
//                 onPress={() => setShowScannerModal(true)}
//                 className="bg-sky-500/20 p-1.5 rounded-full border border-sky-500/30"
//               >
//                 <MaterialIcons
//                   name="qr-code-scanner"
//                   size={16}
//                   color="#38bdf8"
//                 />
//               </TouchableOpacity>
//             )}
//           </View>

//           {/* Session Status */}
//           <View className="mt-2 flex-row items-center">
//             <View
//               className={`w-2 h-2 rounded-full mr-2 ${
//                 activeSession ? "bg-emerald-400" : "bg-rose-400"
//               }`}
//             />
//             <Text className="text-slate-400 text-xs">
//               {activeSession
//                 ? `Session Active • ${new Date(activeSession.openedAt).toLocaleTimeString()}`
//                 : "No Active Session"}
//             </Text>
//           </View>
//         </View>

//         {/* Categories Filter */}
//         <View className="pl-5 mb-2 mt-3 h-10">
//           <ScrollView
//             horizontal
//             showsHorizontalScrollIndicator={false}
//             contentContainerStyle={{ paddingRight: 20 }}
//           >
//             <TouchableOpacity
//               className="mr-2"
//               onPress={() => setSelectedCategory(undefined)}
//             >
//               <Pill
//                 label="All Items"
//                 tone={!selectedCategory ? "sky" : "amber"}
//               />
//             </TouchableOpacity>

//             {categoriesData?.map((cat: any) => (
//               <TouchableOpacity
//                 key={cat.id}
//                 className="mr-2"
//                 onPress={() => setSelectedCategory(cat.id)}
//               >
//                 <Pill
//                   label={cat.name}
//                   tone={selectedCategory === cat.id ? "sky" : "amber"}
//                 />
//               </TouchableOpacity>
//             ))}
//           </ScrollView>
//         </View>

//         {/* Products Grid */}
//         <FlatList
//           data={productsData || []}
//           keyExtractor={(item) => item.id}
//           numColumns={2}
//           contentContainerStyle={{
//             paddingHorizontal: 12,
//             paddingBottom: 120,
//             paddingTop: 8,
//           }}
//           renderItem={renderProduct}
//           ListEmptyComponent={
//             <View className="flex-1 items-center justify-center mt-24">
//               <View className="h-20 w-20 bg-white/5 rounded-full items-center justify-center border border-white/10">
//                 <MaterialIcons name="inbox" size={32} color="#64748b" />
//               </View>
//               <Text className="text-white mt-4 text-lg font-bold">
//                 No products found
//               </Text>
//               <Text className="text-slate-500 mt-2 text-sm text-center px-10 leading-5">
//                 Try adjusting your search or sync to pull latest items from the
//                 server.
//               </Text>
//             </View>
//           }
//         />

//         {/* Floating Cart Summary */}
//         {cartCount > 0 && (
//           <View className="absolute bottom-6 left-5 right-5">
//             <TouchableOpacity
//               className="bg-sky-500 rounded-[24px] flex-row items-center justify-between p-4 shadow-lg shadow-sky-500/20 border border-sky-400"
//               activeOpacity={0.9}
//               onPress={openCart}
//             >
//               <View className="flex-row items-center">
//                 <View className="bg-white/20 rounded-full w-10 h-10 items-center justify-center border border-white/20">
//                   <Text className="text-white font-black text-lg">
//                     {cartCount}
//                   </Text>
//                 </View>
//                 <Text className="text-white font-bold text-lg ml-3">
//                   View Cart
//                 </Text>
//               </View>
//               <Text className="text-white font-black text-xl">
//                 ${cartTotal.toFixed(2)}
//               </Text>
//             </TouchableOpacity>
//           </View>
//         )}

//         {/* Cart Modal */}
//         <Modal
//           visible={showCartModal}
//           transparent
//           animationType="none"
//           onRequestClose={closeCart}
//         >
//           <View className="flex-1 bg-black/70">
//             <TouchableOpacity
//               className="flex-1"
//               activeOpacity={1}
//               onPress={closeCart}
//             />
//             <Animated.View
//               style={{
//                 transform: [{ translateY: slideAnim }],
//               }}
//               className="bg-slate-900 rounded-t-3xl max-h-[85%] min-h-[50%]"
//             >
//               <View className="px-5 pt-5 pb-4">
//                 {/* Header */}
//                 <View className="flex-row justify-between items-center mb-4">
//                   <Text className="text-white font-bold text-xl">
//                     Your Cart ({cartCount} items)
//                   </Text>
//                   <TouchableOpacity onPress={closeCart}>
//                     <MaterialIcons name="close" size={24} color="#94a3b8" />
//                   </TouchableOpacity>
//                 </View>

//                 {/* Customer Selection */}
//                 <TouchableOpacity
//                   className="flex-row items-center justify-between bg-white/5 rounded-xl p-3 mb-4 border border-white/10"
//                   onPress={() => setShowCustomerSelect(!showCustomerSelect)}
//                 >
//                   <View className="flex-row items-center">
//                     <MaterialIcons
//                       name="person-outline"
//                       size={20}
//                       color="#94a3b8"
//                     />
//                     <Text className="text-white ml-2">
//                       {selectedCustomer
//                         ? `${selectedCustomer.name} (${selectedCustomer.code})`
//                         : "Select Customer"}
//                     </Text>
//                   </View>
//                   <MaterialIcons
//                     name={showCustomerSelect ? "expand-less" : "expand-more"}
//                     size={20}
//                     color="#94a3b8"
//                   />
//                 </TouchableOpacity>

//                 {showCustomerSelect && (
//                   <View className="bg-white/5 rounded-xl p-3 mb-4 max-h-40">
//                     <TextInput
//                       className="bg-white/10 rounded-lg p-2 text-white text-sm mb-2"
//                       placeholder="Search customers..."
//                       placeholderTextColor="#64748b"
//                       value={customerSearch}
//                       onChangeText={setCustomerSearch}
//                     />
//                     <FlatList
//                       data={customersData || []}
//                       keyExtractor={(item) => item.id}
//                       renderItem={({ item }) => (
//                         <TouchableOpacity
//                           className="py-2 border-b border-white/5"
//                           onPress={() => {
//                             setSelectedCustomer(item);
//                             setShowCustomerSelect(false);
//                             setCustomerSearch("");
//                           }}
//                         >
//                           <Text className="text-white">{item.name}</Text>
//                           <Text className="text-slate-400 text-xs">
//                             {item.code} • {item.phone || "No phone"}
//                           </Text>
//                         </TouchableOpacity>
//                       )}
//                       ListEmptyComponent={
//                         <Text className="text-slate-400 text-center py-2">
//                           No customers found
//                         </Text>
//                       }
//                     />
//                   </View>
//                 )}

//                 {/* Cart Items */}
//                 <FlatList
//                   data={cartItems}
//                   keyExtractor={(item) => item.id}
//                   renderItem={renderCartItem}
//                   className="max-h-60"
//                   showsVerticalScrollIndicator={false}
//                 />

//                 {/* Cart Summary */}
//                 <View className="mt-4 pt-4 border-t border-white/10">
//                   <View className="flex-row justify-between mb-1">
//                     <Text className="text-slate-400">Subtotal</Text>
//                     <Text className="text-white">
//                       ${cartSubtotal.toFixed(2)}
//                     </Text>
//                   </View>
//                   <View className="flex-row justify-between mb-1">
//                     <Text className="text-slate-400">Tax (5%)</Text>
//                     <Text className="text-white">${taxAmount.toFixed(2)}</Text>
//                   </View>
//                   <View className="flex-row justify-between mb-1">
//                     <Text className="text-slate-400">Discount</Text>
//                     <Text className="text-white">
//                       -${discountAmount.toFixed(2)}
//                     </Text>
//                   </View>
//                   <View className="flex-row justify-between mt-2 pt-2 border-t border-white/20">
//                     <Text className="text-white font-bold text-lg">Total</Text>
//                     <Text className="text-sky-400 font-bold text-lg">
//                       ${grandTotal.toFixed(2)}
//                     </Text>
//                   </View>

//                   {/* Payment Method */}
//                   <View className="flex-row mt-4 gap-2">
//                     {["CASH", "CARD", "DIGITAL"].map((method) => (
//                       <TouchableOpacity
//                         key={method}
//                         className={`flex-1 py-2 rounded-lg ${
//                           paymentMethod === method
//                             ? "bg-sky-500"
//                             : "bg-white/10"
//                         }`}
//                         onPress={() => setPaymentMethod(method)}
//                       >
//                         <Text
//                           className={`text-center text-sm font-bold ${
//                             paymentMethod === method
//                               ? "text-white"
//                               : "text-slate-400"
//                           }`}
//                         >
//                           {method}
//                         </Text>
//                       </TouchableOpacity>
//                     ))}
//                   </View>

//                   {/* Warning for out of stock */}
//                   {hasOutOfStockItems && (
//                     <View className="mt-3 bg-rose-500/20 p-3 rounded-xl border border-rose-500/30">
//                       <Text className="text-rose-400 text-xs font-medium text-center">
//                         ⚠️ Some items exceed available stock
//                       </Text>
//                     </View>
//                   )}

//                   {/* Checkout Button */}
//                   <TouchableOpacity
//                     className={`mt-4 py-4 rounded-xl ${
//                       cartItems.length === 0 ||
//                       isSubmitting ||
//                       hasOutOfStockItems
//                         ? "bg-slate-700"
//                         : "bg-emerald-500"
//                     }`}
//                     onPress={handleCheckout}
//                     disabled={
//                       cartItems.length === 0 ||
//                       isSubmitting ||
//                       hasOutOfStockItems
//                     }
//                   >
//                     {isSubmitting ? (
//                       <ActivityIndicator color="white" />
//                     ) : (
//                       <Text className="text-white text-center font-bold text-lg">
//                         Complete Order • ${grandTotal.toFixed(2)}
//                       </Text>
//                     )}
//                   </TouchableOpacity>

//                   <View className="flex-row mt-3 gap-3">
//                     <TouchableOpacity
//                       className="flex-1 py-2 bg-white/5 rounded-xl border border-white/10"
//                       onPress={() => {
//                         Alert.alert(
//                           "Clear Cart",
//                           "Are you sure you want to clear the cart?",
//                           [
//                             { text: "Cancel", style: "cancel" },
//                             {
//                               text: "Clear",
//                               style: "destructive",
//                               onPress: () => dispatch(clearCart()),
//                             },
//                           ],
//                         );
//                       }}
//                     >
//                       <Text className="text-red-400 text-center text-sm font-medium">
//                         Clear Cart
//                       </Text>
//                     </TouchableOpacity>
//                     <TouchableOpacity
//                       className="flex-1 py-2 bg-white/5 rounded-xl border border-white/10"
//                       onPress={() => {
//                         setSelectedCustomer(null);
//                         Alert.alert(
//                           "Customer Cleared",
//                           "Customer has been removed.",
//                         );
//                       }}
//                     >
//                       <Text className="text-slate-400 text-center text-sm font-medium">
//                         Remove Customer
//                       </Text>
//                     </TouchableOpacity>
//                   </View>
//                 </View>
//               </View>
//             </Animated.View>
//           </View>
//         </Modal>

//         <BarcodeScannerModal
//           visible={showScannerModal}
//           onClose={() => setShowScannerModal(false)}
//           onScan={handleScan}
//         />
//       </Screen>
//     </SafeAreaView>
//   );
// }
