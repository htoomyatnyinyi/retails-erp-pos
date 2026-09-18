import {
  ActionButton,
  Card,
  Header,
  Pill,
  Screen,
  SectionTitle,
} from "@/components/app-ui";
import { useAppDispatch } from "@/hooks/redux-hooks/useAppDispatch";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import { setStore } from "@/services/features/auth/authSlice";
import { MaterialIcons } from "@expo/vector-icons";
import * as DocumentPicker from "expo-document-picker";
import * as FileSystem from "expo-file-system/legacy";
import * as Print from "expo-print";
import * as Sharing from "expo-sharing";
import { router, useLocalSearchParams } from "expo-router";
import QRCode from "react-native-qrcode-svg";
import { useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Modal,
  Pressable,
  ScrollView,
  Text,
  TouchableOpacity,
  View,
  RefreshControl,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
// import { BarcodeScannerModal } from "@/components/barcode-scanner-modal";

// Offline-first local APIs
import {
  useCloseLocalSessionMutation,
  useCreateLocalBrandMutation,
  useCreateLocalCategoryMutation,
  useCreateLocalCustomerMutation,
  useCreateLocalProductMutation,
  useCreateLocalStaffMutation,
  useCreateLocalStoreMutation,
  useCreateLocalSupplierMutation,
  useDeleteLocalBrandMutation,
  useDeleteLocalCategoryMutation,
  useDeleteLocalCustomerMutation,
  useDeleteLocalProductMutation,
  useDeleteLocalStaffMutation,
  useDeleteLocalStoreMutation,
  useDeleteLocalSupplierMutation,
  useGetLocalBrandsQuery,
  useGetLocalCategoriesQuery,
  useGetLocalCustomersQuery,
  useGetLocalInventoryQuery,
  useGetLocalProductsQuery,
  useGetLocalVariantsQuery,
  useGetLocalStaffQuery,
  useGetLocalStoresQuery,
  useGetLocalSuppliersQuery,
  useOpenLocalSessionMutation,
  useUpdateLocalBrandMutation,
  useUpdateLocalCategoryMutation,
  useUpdateLocalCustomerMutation,
  useUpdateLocalProductMutation,
  useUpdateLocalStaffMutation,
  useUpdateLocalStoreMutation,
  useUpdateLocalSupplierMutation,
  useGetLocalSessionsQuery,
  useGetLocalOrdersQuery,
} from "@/services/features/offline/localApi";

// Import our extracted components and utilities
import EmptyState from "@/components/manage/EmptyState";
import SessionModal from "@/components/manage/SessionModal";
import EditorModal from "@/components/manage/EditorModal";
import {
  ModuleKey,
  getModuleList,
  getSubtitle,
  getRightLabel,
  getIcon,
} from "@/utils/manage/helpers";
import { buildPayload } from "@/utils/manage/buildPayload";
import { useSync } from "@/services/offline/syncManager";
import {
  canUseSessions,
  hasAnyPermission,
  hasPermission,
} from "@/utils/auth/permissions";
import {
  parseProductCsv,
  productImportTemplateCsv,
  productsToCsv,
} from "@/utils/productTransfer";

export default function ManageScreen() {
  const dispatch = useAppDispatch();
  const { user, currentStoreId } = useAppSelector((state) => state.auth);
  const { module } = useLocalSearchParams<{ module?: string }>();
  const { isOnline, isSyncing, queueCount, failedCount, sync } = useSync();
  const isAdmin = user?.role === "ADMIN";
  const [moduleKey, setModuleKey] = useState<ModuleKey>("products");
  const [editor, setEditor] = useState<{
    open: boolean;
    mode: "create" | "edit";
    item?: any;
  }>({ open: false, mode: "create" });

  const [sessionModal, setSessionModal] = useState<"open" | "close" | null>(
    null,
  );
  const [refreshing, setRefreshing] = useState(false);
  const [labelProduct, setLabelProduct] = useState<any | null>(null);
  const qrRef = useRef<any>(null);

  useEffect(() => {
    if (module === "products") setModuleKey("products");
  }, [module]);

  // Store-scoped filter (if currentStoreId is null, shows all stores for admins)
  const scopedStoreId = currentStoreId || undefined;

  // Queries with store scoping
  const {
    data: stores = [],
    refetch: refetchStores,
    isFetching: fetchingStores,
  } = useGetLocalStoresQuery({});
  const {
    data: customers = [],
    refetch: refetchCustomers,
    isFetching: fetchingCustomers,
  } = useGetLocalCustomersQuery({});
  const {
    data: brands = [],
    refetch: refetchBrands,
    isFetching: fetchingBrands,
  } = useGetLocalBrandsQuery({
    isActive: true,
  });
  const {
    data: sessions = [],
    refetch: refetchSessions,
    isFetching: fetchingSessions,
  } = useGetLocalSessionsQuery({ storeId: scopedStoreId });
  const {
    data: orders = [],
    refetch: refetchOrders,
    isFetching: fetchingOrders,
  } = useGetLocalOrdersQuery({ storeId: scopedStoreId });
  const {
    data: staff = [],
    refetch: refetchStaff,
    isFetching: fetchingStaff,
  } = useGetLocalStaffQuery({
    storeId: scopedStoreId,
  });
  const {
    data: products = [],
    refetch: refetchProducts,
    isFetching: fetchingProducts,
  } = useGetLocalProductsQuery({});
  const { data: variants = [] } = useGetLocalVariantsQuery(undefined);
  const {
    data: inventory = [],
    refetch: refetchInventory,
    isFetching: fetchingInventory,
  } = useGetLocalInventoryQuery({ storeId: scopedStoreId });
  const {
    data: categories = [],
    refetch: refetchCategories,
    isFetching: fetchingCategories,
  } = useGetLocalCategoriesQuery({});
  const {
    data: suppliers = [],
    refetch: refetchSuppliers,
    isFetching: fetchingSuppliers,
  } = useGetLocalSuppliersQuery({});

  // Mutations
  const [createStaff, { isLoading: creatingStaff }] =
    useCreateLocalStaffMutation();
  const [updateStaff, { isLoading: updatingStaff }] =
    useUpdateLocalStaffMutation();
  const [deleteStaff, { isLoading: deletingStaff }] =
    useDeleteLocalStaffMutation();

  const [createProduct, { isLoading: creatingProduct }] =
    useCreateLocalProductMutation();
  const [updateProduct, { isLoading: updatingProduct }] =
    useUpdateLocalProductMutation();
  const [deleteProduct, { isLoading: deletingProduct }] =
    useDeleteLocalProductMutation();

  const [createStore, { isLoading: creatingStore }] =
    useCreateLocalStoreMutation();
  const [updateStore, { isLoading: updatingStore }] =
    useUpdateLocalStoreMutation();
  const [deleteStore, { isLoading: deletingStore }] =
    useDeleteLocalStoreMutation();

  const [createCategory, { isLoading: creatingCategory }] =
    useCreateLocalCategoryMutation();
  const [updateCategory, { isLoading: updatingCategory }] =
    useUpdateLocalCategoryMutation();
  const [deleteCategory, { isLoading: deletingCategory }] =
    useDeleteLocalCategoryMutation();

  const [createCustomer, { isLoading: creatingCustomer }] =
    useCreateLocalCustomerMutation();
  const [updateCustomer, { isLoading: updatingCustomer }] =
    useUpdateLocalCustomerMutation();
  const [deleteCustomer, { isLoading: deletingCustomer }] =
    useDeleteLocalCustomerMutation();

  const [createSupplier, { isLoading: creatingSupplier }] =
    useCreateLocalSupplierMutation();
  const [updateSupplier, { isLoading: updatingSupplier }] =
    useUpdateLocalSupplierMutation();
  const [deleteSupplier, { isLoading: deletingSupplier }] =
    useDeleteLocalSupplierMutation();

  const [createBrand, { isLoading: creatingBrand }] =
    useCreateLocalBrandMutation();
  const [updateBrand, { isLoading: updatingBrand }] =
    useUpdateLocalBrandMutation();
  const [deleteBrand, { isLoading: deletingBrand }] =
    useDeleteLocalBrandMutation();

  const [openSession, { isLoading: openingSession }] =
    useOpenLocalSessionMutation();
  const [closeSession, { isLoading: closingSession }] =
    useCloseLocalSessionMutation();

  const refetchers = {
    staff: refetchStaff,
    products: () => {
      refetchProducts();
      refetchInventory();
    },
    stores: refetchStores,
    categories: refetchCategories,
    customers: refetchCustomers,
    suppliers: refetchSuppliers,
    brands: refetchBrands,
    sessions: () => {
      refetchSessions();
      refetchOrders();
    },
  } as const;

  const isPrivileged = hasAnyPermission(user, [
    "MANAGE_STAFF",
    "MANAGE_INVENTORY",
  ]);
  const canManageStaff = hasPermission(user, "MANAGE_STAFF");
  const canManageInventory = hasPermission(user, "MANAGE_INVENTORY");
  const canEditPrices = hasPermission(user, "EDIT_PRICES");

  const storeOptions = isAdmin
    ? stores
    : stores.filter((store: any) =>
        user?.stores?.some(
          (assigned: any) =>
            assigned.id === store.id || assigned.storeId === store.id,
        ),
      );

  const activeSession = sessions.find((s: any) => s.status === "OPEN");

  const handleSync = async () => {
    try {
      await sync({ force: true });
    } catch (error: any) {
      Alert.alert(
        "Sync unavailable",
        error?.message || "Changes will retry automatically.",
      );
    }
  };

  const shareProductCsv = async (
    csv: string,
    filename: string,
    dialogTitle: string,
  ) => {
    const directory = FileSystem.cacheDirectory;
    if (!directory)
      throw new Error("Temporary storage is unavailable on this device.");
    const uri = `${directory}${filename}`;
    await FileSystem.writeAsStringAsync(uri, csv, {
      encoding: FileSystem.EncodingType.UTF8,
    });
    if (await Sharing.isAvailableAsync()) {
      await Sharing.shareAsync(uri, {
        mimeType: "text/csv",
        dialogTitle,
        UTI: "public.comma-separated-values-text",
      });
    } else {
      Alert.alert("File ready", `CSV saved to ${uri}`);
    }
  };

  const handleExportProducts = async () => {
    try {
      const csv = productsToCsv(productsWithVariants);
      await shareProductCsv(
        csv,
        `products-${new Date().toISOString().slice(0, 10)}.csv`,
        "Export products",
      );
    } catch (error: any) {
      Alert.alert(
        "Export failed",
        error?.message || "Could not export products.",
      );
    }
  };

  const handleDownloadProductTemplate = async () => {
    try {
      await shareProductCsv(
        productImportTemplateCsv,
        "product-import-template.csv",
        "Save product import template",
      );
    } catch (error: any) {
      Alert.alert(
        "Template failed",
        error?.message || "Could not create the CSV template.",
      );
    }
  };

  const handleImportProducts = async () => {
    if (!canManageInventory) {
      Alert.alert(
        "Permission required",
        "Only inventory managers can import products.",
      );
      return;
    }
    try {
      const result = await DocumentPicker.getDocumentAsync({
        type: [
          "text/csv",
          "text/comma-separated-values",
          "application/vnd.ms-excel",
          "text/plain",
        ],
        copyToCacheDirectory: true,
      });
      if (result.canceled) return;
      const asset = result.assets[0];
      const csv = await FileSystem.readAsStringAsync(asset.uri);
      const rows = parseProductCsv(csv);
      if (!rows.length) {
        Alert.alert("Nothing to import", "The CSV contains no product rows.");
        return;
      }
      const existingSkus = new Set(
        products.map((product: any) => String(product.sku || "").toLowerCase()),
      );
      const existingBarcodes = new Set(
        products.map((product: any) =>
          String(product.barcode || "").toLowerCase(),
        ),
      );
      const categoryIds = new Map(
        categories.map((category: any) => [
          String(category.name || "")
            .trim()
            .toLowerCase(),
          category.id,
        ]),
      );
      const seen = new Set<string>();
      let imported = 0;
      let skipped = 0;
      const importErrors: string[] = [];
      for (const row of rows) {
        const name = row.name.trim();
        const sku = row.sku.trim();
        const barcode = row.barcode.trim();
        if (
          !name ||
          !sku ||
          existingSkus.has(sku.toLowerCase()) ||
          (barcode && existingBarcodes.has(barcode.toLowerCase())) ||
          seen.has(sku.toLowerCase())
        ) {
          skipped += 1;
          continue;
        }
        try {
          const categoryName = row.categoryName.trim() || "General";
          const categoryKey = categoryName.toLowerCase();
          let categoryId = categoryIds.get(categoryKey);
          if (!categoryId) {
            const createdCategory = await createCategory(
              buildPayload(
                "categories",
                {
                  name: categoryName,
                  slug: categoryName
                    .toLowerCase()
                    .replace(/[^a-z0-9]+/g, "-")
                    .replace(/^-|-$/g, ""),
                },
                currentStoreId,
                user?.tenantId,
                "create",
              ),
            ).unwrap();
            categoryId = createdCategory?.id;
            if (!categoryId)
              throw new Error(`Could not create category "${categoryName}".`);
            categoryIds.set(categoryKey, categoryId);
          }
          await createProduct(
            buildPayload(
              "products",
              {
                ...row,
                name,
                sku,
                barcode,
                categoryId,
                categoryName,
                sellingPrice: Number(row.sellingPrice || 0),
                costPrice: Number(row.costPrice || 0),
                wholesalePrice: Number(row.wholesalePrice || 0),
                initialStock: Number(row.initialStock || 0),
              },
              currentStoreId,
              user?.tenantId,
              "create",
            ),
          ).unwrap();
          seen.add(sku.toLowerCase());
          imported += 1;
        } catch (error: any) {
          skipped += 1;
          importErrors.push(
            `${sku}: ${error?.data?.message || error?.message || "invalid row"}`,
          );
        }
      }
      await Promise.all([
        refetchProducts(),
        refetchCategories(),
        refetchInventory(),
      ]);
      Alert.alert(
        "Import complete",
        `${imported} products imported.${skipped ? ` ${skipped} skipped (missing, duplicate, or invalid).` : ""}${importErrors.length ? `\n${importErrors.slice(0, 3).join("\n")}` : ""}`,
      );
    } catch (error: any) {
      Alert.alert(
        "Import failed",
        error?.message || "Use a CSV exported from this screen.",
      );
    }
  };

  const handlePrintProductLabel = () => {
    if (!labelProduct || !qrRef.current?.toDataURL) return;
    const escapeHtml = (value: unknown) =>
      String(value ?? "").replace(
        /[&<>"']/g,
        (character) =>
          ({
            "&": "&amp;",
            "<": "&lt;",
            ">": "&gt;",
            '"': "&quot;",
            "'": "&#39;",
          })[character]!,
      );
    qrRef.current.toDataURL(async (data: string) => {
      try {
        await Print.printAsync({
          html: `<html><body style="font-family:Arial;text-align:center;padding:24px"><h2>${escapeHtml(labelProduct.name)}</h2><img src="data:image/png;base64,${data}" style="width:220px;height:220px"/><h3>${escapeHtml(labelProduct.barcode || labelProduct.sku)}</h3><p>SKU: ${escapeHtml(labelProduct.sku)}</p></body></html>`,
        });
      } catch (error: any) {
        Alert.alert(
          "Print failed",
          error?.message || "Could not print this label.",
        );
      }
    });
  };

  if (!isPrivileged) {
    return (
      <Screen>
        <SafeAreaView className="flex-1">
          <View className="flex-1 items-center justify-center px-6">
            <Pill label="Restricted" tone="rose" />
            <Text className="mt-4 text-3xl font-black text-white">
              Management locked
            </Text>
            <Text className="mt-3 text-center text-sm text-slate-300">
              Your account does not have access to staff, product, or store
              management.
            </Text>
          </View>
        </SafeAreaView>
      </Screen>
    );
  }

  const productsWithVariants = products.map((product: any) => {
    const productVariants = variants.filter(
      (variant: any) =>
        variant.productId === product.id ||
        variant.productId === product.remoteId,
    );
    const productInventory = inventory.filter(
      (inv: any) =>
        inv.productId === product.id || inv.productId === product.remoteId,
    );
    const totalStock = productInventory.reduce(
      (sum: number, inv: any) => sum + Number(inv.quantity ?? 0),
      0,
    );

    return {
      ...product,
      totalStock,
      variants: productVariants.map((variant: any) => {
        const variantInv = productInventory.find(
          (inv: any) =>
            inv.variantId === variant.id || inv.variantId === variant.remoteId,
        );
        return {
          ...variant,
          stock: variantInv ? Number(variantInv.quantity ?? 0) : 0,
        };
      }),
    };
  });

  const list = getModuleList({
    moduleKey,
    staff,
    products: productsWithVariants,
    stores,
    categories,
    customers,
    suppliers,
    brands,
    sessions,
  });

  const handleSave = async (values: Record<string, any>) => {
    try {
      const nextValues = buildPayload(
        moduleKey,
        values,
        currentStoreId,
        user?.tenantId,
        editor.mode,
      );

      if (moduleKey === "products") {
        if (!String(nextValues.name ?? "").trim()) {
          Alert.alert(
            "Product name required",
            "Enter a product name before saving.",
          );
          return;
        }
        if (!nextValues.categoryId && !nextValues.categoryName) {
          Alert.alert(
            "Category required",
            "Select a category before saving the product.",
          );
          return;
        }
        if (
          Array.isArray(nextValues.variants) &&
          nextValues.variants.length > 0
        ) {
          const emptyOption = nextValues.variants.find(
            (variant: any) =>
              !String(variant.name ?? "").trim() ||
              !String(variant.sku ?? "").trim(),
          );
          if (emptyOption) {
            Alert.alert(
              "Option details required",
              "Every sellable option needs a name and a unique SKU.",
            );
            return;
          }
          const optionSkus = nextValues.variants.map((variant: any) =>
            String(variant.sku).trim().toLowerCase(),
          );
          if (new Set(optionSkus).size !== optionSkus.length) {
            Alert.alert(
              "Duplicate option SKU",
              "Each option must have a different SKU.",
            );
            return;
          }
        }
      }
      if (moduleKey === "staff") {
        if (!nextValues.email) {
          Alert.alert(
            "Email required",
            "Enter an email address for the staff account.",
          );
          return;
        }
        if (
          editor.mode === "create" &&
          String(nextValues.password ?? "").length < 6
        ) {
          Alert.alert(
            "Password too short",
            "Password must contain at least 6 characters.",
          );
          return;
        }
        if (
          user?.role !== "ADMIN" &&
          user?.role !== "SUPER_ADMIN" &&
          (nextValues.permissions ?? []).some(
            (permission: string) => !hasPermission(user, permission as any),
          )
        ) {
          Alert.alert(
            "Permission assignment denied",
            "You can only grant permissions that you have yourself.",
          );
          return;
        }
      }

      if (moduleKey === "staff") {
        if (editor.mode === "create") await createStaff(nextValues).unwrap();
        else await updateStaff({ id: editor.item.id, ...nextValues }).unwrap();
      } else if (moduleKey === "products") {
        if (editor.mode === "create") await createProduct(nextValues).unwrap();
        else
          await updateProduct({ id: editor.item.id, ...nextValues }).unwrap();
      } else if (moduleKey === "stores") {
        if (editor.mode === "create") await createStore(nextValues).unwrap();
        else await updateStore({ id: editor.item.id, ...nextValues }).unwrap();
      } else if (moduleKey === "categories") {
        if (editor.mode === "create") await createCategory(nextValues).unwrap();
        else
          await updateCategory({ id: editor.item.id, ...nextValues }).unwrap();
      } else if (moduleKey === "customers") {
        if (editor.mode === "create") await createCustomer(nextValues).unwrap();
        else
          await updateCustomer({ id: editor.item.id, ...nextValues }).unwrap();
      } else if (moduleKey === "suppliers") {
        if (editor.mode === "create") await createSupplier(nextValues).unwrap();
        else
          await updateSupplier({ id: editor.item.id, ...nextValues }).unwrap();
      } else if (moduleKey === "brands") {
        if (editor.mode === "create") await createBrand(nextValues).unwrap();
        else await updateBrand({ id: editor.item.id, ...nextValues }).unwrap();
      }

      await refetchers[moduleKey]();
      setEditor({ open: false, mode: "create" });
    } catch (error: any) {
      Alert.alert(
        "Save failed",
        error?.data?.message || "Unable to save changes.",
      );
    }
  };

  const handleDelete = async (item: any) => {
    try {
      if (moduleKey === "staff") await deleteStaff(item.id).unwrap();
      else if (moduleKey === "products") await deleteProduct(item.id).unwrap();
      else if (moduleKey === "stores") await deleteStore(item.id).unwrap();
      else if (moduleKey === "categories")
        await deleteCategory(item.id).unwrap();
      else if (moduleKey === "customers")
        await deleteCustomer(item.id).unwrap();
      else if (moduleKey === "suppliers")
        await deleteSupplier(item.id).unwrap();
      else if (moduleKey === "brands") await deleteBrand(item.id).unwrap();
      await refetchers[moduleKey]();
      setEditor({ open: false, mode: "create" });
    } catch (error: any) {
      Alert.alert(
        "Delete failed",
        error?.data?.message || "Unable to delete item.",
      );
    }
  };

  const openEditor = (mode: "create" | "edit", item?: any) => {
    const allowed =
      moduleKey === "staff" || moduleKey === "stores"
        ? canManageStaff
        : canManageInventory || canEditPrices;
    if (!allowed) {
      Alert.alert(
        "Permission required",
        "You do not have permission to manage this module.",
      );
      return;
    }
    setEditor({ open: true, mode, item });
  };

  const handleOpenSession = async (openingBalance: string, notes: string) => {
    if (!user?.id) {
      Alert.alert("Error", "User not logged in");
      return;
    }
    try {
      await openSession({
        userId: user.id,
        tenantId: user.tenantId,
        openingBalance: Number(openingBalance) || 0,
        notes: notes.trim() || undefined,
        storeId: currentStoreId || undefined,
        registerId: "default-register",
      }).unwrap();
      await refetchSessions();
      await refetchOrders();
      Alert.alert("Success", "Session opened successfully");
      setSessionModal(null);
    } catch (error: any) {
      Alert.alert(
        "Open session failed",
        error?.data?.message || "Unable to open session.",
      );
    }
  };

  const handleCloseSession = async (
    closingBalance: string,
    notes: string,
    sessionId: string,
  ) => {
    const selectedSession = sessions.find((s: any) => s.id === sessionId);
    if (!selectedSession) {
      Alert.alert("Error", "Session not found");
      return;
    }
    try {
      const sessionOrders = orders.filter(
        (o: any) => o.sessionId === selectedSession.id,
      );
      const paymentTotals = sessionOrders
        .filter(isCountedSale)
        .reduce(
          (totals, order) => addPaymentTotals(totals, order),
          emptyPaymentTotals(),
        );
      const cashSales = paymentTotals.CASH;
      const cardSales = paymentTotals.CARD;
      const digitalSales = paymentTotals.DIGITAL;
      const expectedBalance =
        Number(selectedSession.openingBalance ?? 0) + cashSales;
      const countedBalance = Number(closingBalance) || 0;

      await closeSession({
        id: selectedSession.id,
        closingBalance: countedBalance,
        expectedBalance,
        discrepancy: countedBalance - expectedBalance,
        cashSales,
        cardSales,
        digitalSales,
        notes: notes.trim() || undefined,
      }).unwrap();
      await refetchSessions();
      await refetchOrders();
      Alert.alert("Success", "Session closed successfully");
      setSessionModal(null);
    } catch (error: any) {
      Alert.alert(
        "Close session failed",
        error?.data?.message || "Unable to close session.",
      );
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    await Promise.all([
      refetchStaff(),
      refetchProducts(),
      refetchInventory(),
      refetchStores(),
      refetchCategories(),
      refetchCustomers(),
      refetchSuppliers(),
      refetchBrands(),
      refetchSessions(),
      refetchOrders(),
    ]);
    setRefreshing(false);
  };

  const isLoading = {
    staff: fetchingStaff || creatingStaff || updatingStaff || deletingStaff,
    products:
      fetchingProducts ||
      fetchingInventory ||
      creatingProduct ||
      updatingProduct ||
      deletingProduct,
    stores: fetchingStores || creatingStore || updatingStore || deletingStore,
    categories:
      fetchingCategories ||
      creatingCategory ||
      updatingCategory ||
      deletingCategory,
    customers:
      fetchingCustomers ||
      creatingCustomer ||
      updatingCustomer ||
      deletingCustomer,
    suppliers:
      fetchingSuppliers ||
      creatingSupplier ||
      updatingSupplier ||
      deletingSupplier,
    brands: fetchingBrands || creatingBrand || updatingBrand || deletingBrand,
    sessions:
      fetchingSessions || fetchingOrders || openingSession || closingSession,
  };

  return (
    <Screen>
      <SafeAreaView className="flex-1">
        <ScrollView
          showsVerticalScrollIndicator={false}
          contentContainerStyle={{ paddingBottom: 28 }}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor="#38bdf8"
            />
          }
        >
          <Header
            eyebrow="Administration"
            title="Management"
            subtitle="Manage staff, products, stores, categories, customers, suppliers, brands, and session control from one place."
            right={
              <View className="items-end">
                <Pill
                  label={
                    isOnline ? (isSyncing ? "SYNCING" : "ONLINE") : "OFFLINE"
                  }
                  tone={isOnline ? "emerald" : "amber"}
                />
                {(queueCount > 0 || failedCount > 0) && (
                  <Text className="mt-1 text-[10px] text-slate-400">
                    {queueCount} pending
                    {failedCount ? ` • ${failedCount} failed` : ""}
                  </Text>
                )}
              </View>
            }
          />

          {/* Store Context */}
          <Card className="mb-4">
            <View className="flex-row items-center justify-between">
              <Text className="text-xs font-bold uppercase tracking-[3px] text-slate-400">
                Store Context
              </Text>
              {currentStoreId && (
                <Text className="text-xs text-sky-400 font-medium">
                  Active filter applied
                </Text>
              )}
            </View>
            <ScrollView
              horizontal
              showsHorizontalScrollIndicator={false}
              className="mt-3"
              contentContainerStyle={{ gap: 8 }}
            >
              {isAdmin && (
                <Pressable
                  onPress={() => dispatch(setStore(null))}
                  className={`rounded-full border px-4 py-2.5 flex-row items-center ${
                    !currentStoreId
                      ? "border-sky-400/40 bg-sky-500/20"
                      : "border-white/10 bg-white/5"
                  }`}
                >
                  <MaterialIcons
                    name="domain"
                    size={15}
                    color={!currentStoreId ? "#38bdf8" : "#94a3b8"}
                  />
                  <Text
                    className={`ml-1.5 text-xs font-bold uppercase tracking-[1.5px] ${
                      !currentStoreId ? "text-sky-200" : "text-slate-300"
                    }`}
                  >
                    All Stores
                  </Text>
                </Pressable>
              )}
              {storeOptions.map((store: any) => {
                const active = store.id === currentStoreId;
                return (
                  <Pressable
                    key={store.id}
                    onPress={() => dispatch(setStore(store.id))}
                    className={`rounded-full border px-4 py-2.5 flex-row items-center ${
                      active
                        ? "border-sky-400/40 bg-sky-500/20"
                        : "border-white/10 bg-white/5"
                    }`}
                  >
                    <MaterialIcons
                      name="storefront"
                      size={15}
                      color={active ? "#38bdf8" : "#94a3b8"}
                    />
                    <Text
                      className={`ml-1.5 text-xs font-bold uppercase tracking-[1.5px] ${
                        active ? "text-sky-200" : "text-slate-300"
                      }`}
                    >
                      {store.name}
                    </Text>
                  </Pressable>
                );
              })}
              {storeOptions.length === 0 && !isAdmin && (
                <Text className="text-slate-500 text-xs">
                  No stores available
                </Text>
              )}
            </ScrollView>
          </Card>

          {isAdmin && (
            <>
              <SectionTitle title="Admin Control & Audit" />
              <View className="flex-row flex-wrap gap-3 mb-6">
                <TouchableOpacity
                  className="w-[48%] bg-slate-900 border border-slate-800 rounded-2xl p-4"
                  onPress={() => router.push("/manage/sessions")}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <MaterialIcons name="fact-check" size={24} color="#60a5fa" />
                    <MaterialIcons name="chevron-right" size={18} color="#64748b" />
                  </View>
                  <Text className="text-white text-base font-bold">Session Logs</Text>
                  <Text className="text-slate-400 text-xs mt-1">
                    Cash drawer records
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="w-[48%] bg-slate-900 border border-slate-800 rounded-2xl p-4"
                  onPress={() => router.push("/manage/store-settings")}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <MaterialIcons name="settings" size={24} color="#a78bfa" />
                    <MaterialIcons name="chevron-right" size={18} color="#64748b" />
                  </View>
                  <Text className="text-white text-base font-bold">Store Settings</Text>
                  <Text className="text-slate-400 text-xs mt-1">Tax, currency & receipts</Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="w-[48%] bg-slate-900 border border-slate-800 rounded-2xl p-4"
                  onPress={() => router.push("/manage/inventory-movements")}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <MaterialIcons name="swap-horiz" size={24} color="#fbbf24" />
                    <MaterialIcons name="chevron-right" size={18} color="#64748b" />
                  </View>
                  <Text className="text-white text-base font-bold">Movements</Text>
                  <Text className="text-slate-400 text-xs mt-1">
                    Stock history & adjust
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="w-[48%] bg-slate-900 border border-slate-800 rounded-2xl p-4"
                  onPress={() => router.push("/manage/stock-audit")}
                >
                  <View className="flex-row items-center justify-between mb-3">
                    <MaterialIcons name="fact-check" size={24} color="#38bdf8" />
                    <MaterialIcons name="chevron-right" size={18} color="#64748b" />
                  </View>
                  <Text className="text-white text-base font-bold">Stock Audit</Text>
                  <Text className="text-slate-400 text-xs mt-1">
                    Physical count & take
                  </Text>
                </TouchableOpacity>

                <TouchableOpacity
                  className="w-[100%] bg-slate-900 border border-slate-800 rounded-2xl p-4 flex-row items-center justify-between"
                  onPress={() => router.push("/manage/audit-logs")}
                >
                  <View className="flex-row items-center gap-4">
                    <View className="w-12 h-12 rounded-full bg-rose-500/10 items-center justify-center border border-rose-500/20">
                      <MaterialIcons name="security" size={24} color="#f87171" />
                    </View>
                    <View>
                      <Text className="text-white text-base font-bold">System Audit Trail</Text>
                      <Text className="text-slate-400 text-xs mt-0.5">
                        Track price changes, deletes, and security events
                      </Text>
                    </View>
                  </View>
                  <MaterialIcons name="chevron-right" size={20} color="#64748b" />
                </TouchableOpacity>
              </View>
            </>
          )}

          <SectionTitle title="Modules" />
          <View className="mb-4 gap-3">
            {/* Store Operations */}
            <View>
              <Text className="mb-2 text-[11px] font-bold uppercase tracking-[2px] text-slate-400">
                🏪 Store Operations
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {(["sessions", "staff", "stores"] as ModuleKey[])
                  .filter((key) =>
                    key === "sessions" ? canUseSessions(user) : canManageStaff,
                  )
                  .map((key) => {
                    const isActive = moduleKey === key;
                    const count =
                      key === "sessions"
                        ? sessions.length
                        : key === "staff"
                          ? staff.length
                          : stores.length;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setModuleKey(key)}
                        className={`rounded-full border px-4 py-2.5 flex-row items-center ${
                          isActive
                            ? "border-emerald-400/40 bg-emerald-500/20"
                            : "border-white/10 bg-white/5"
                        }`}
                      >
                        <Text
                          className={`text-xs font-bold uppercase tracking-[1.5px] ${
                            isActive ? "text-emerald-200" : "text-slate-300"
                          }`}
                        >
                          {key}
                        </Text>
                        <View className="ml-2 rounded-full bg-slate-700/50 px-2 py-0.5">
                          <Text className="text-[10px] font-bold text-slate-300">
                            {count}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
              </View>
            </View>

            {/* Catalog & Supply */}
            <View>
              <Text className="mb-2 text-[11px] font-bold uppercase tracking-[2px] text-slate-400">
                📦 Catalog & Supply (Shared)
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {(
                  [
                    "products",
                    "categories",
                    "brands",
                    "suppliers",
                  ] as ModuleKey[]
                )
                  .filter(() => canManageInventory || canEditPrices)
                  .map((key) => {
                    const isActive = moduleKey === key;
                    const count =
                      key === "products"
                        ? products.length
                        : key === "categories"
                          ? categories.length
                          : key === "brands"
                            ? brands.length
                            : suppliers.length;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setModuleKey(key)}
                        className={`rounded-full border px-4 py-2.5 flex-row items-center ${
                          isActive
                            ? "border-sky-400/40 bg-sky-500/20"
                            : "border-white/10 bg-white/5"
                        }`}
                      >
                        <Text
                          className={`text-xs font-bold uppercase tracking-[1.5px] ${
                            isActive ? "text-sky-200" : "text-slate-300"
                          }`}
                        >
                          {key}
                        </Text>
                        <View className="ml-2 rounded-full bg-slate-700/50 px-2 py-0.5">
                          <Text className="text-[10px] font-bold text-slate-300">
                            {count}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
              </View>
            </View>

            {/* CRM */}
            <View>
              <Text className="mb-2 text-[11px] font-bold uppercase tracking-[2px] text-slate-400">
                👥 CRM (Shared)
              </Text>
              <View className="flex-row flex-wrap gap-2">
                {(["customers"] as ModuleKey[])
                  .filter(() => canManageInventory)
                  .map((key) => {
                    const isActive = moduleKey === key;
                    const count = customers.length;
                    return (
                      <Pressable
                        key={key}
                        onPress={() => setModuleKey(key)}
                        className={`rounded-full border px-4 py-2.5 flex-row items-center ${
                          isActive
                            ? "border-amber-400/40 bg-amber-500/20"
                            : "border-white/10 bg-white/5"
                        }`}
                      >
                        <Text
                          className={`text-xs font-bold uppercase tracking-[1.5px] ${
                            isActive ? "text-amber-200" : "text-slate-300"
                          }`}
                        >
                          {key}
                        </Text>
                        <View className="ml-2 rounded-full bg-slate-700/50 px-2 py-0.5">
                          <Text className="text-[10px] font-bold text-slate-300">
                            {count}
                          </Text>
                        </View>
                      </Pressable>
                    );
                  })}
              </View>
            </View>
          </View>

          <View className="mb-4 flex-row gap-3">
            <ActionButton
              title={isSyncing ? "Syncing" : "Sync now"}
              icon="sync"
              accent="sky"
              onPress={() => void handleSync()}
              disabled={!isOnline || isSyncing}
            />
            {moduleKey !== "sessions" && (
              <ActionButton
                title="Add New"
                icon="add"
                accent="emerald"
                onPress={() => openEditor("create")}
                disabled={
                  isLoading[moduleKey] ||
                  (moduleKey === "staff" || moduleKey === "stores"
                    ? !canManageStaff
                    : !canManageInventory && !canEditPrices)
                }
              />
            )}
            {/* {moduleKey === "products" && (
              <>
                <ActionButton
                  title="Export CSV"
                  icon="file-download"
                  accent="emerald"
                  onPress={() => void handleExportProducts()}
                />
                <ActionButton
                  title="Import CSV"
                  icon="file-upload"
                  accent="amber"
                  onPress={() => void handleImportProducts()}
                  disabled={!canManageInventory}
                />
                <ActionButton
                  title="CSV Template"
                  icon="description"
                  accent="slate"
                  onPress={() => void handleDownloadProductTemplate()}
                />
              </>
            )} */}
            {moduleKey === "sessions" ? (
              <ActionButton
                title={activeSession ? "Close Session" : "Open Session"}
                icon="schedule"
                accent={activeSession ? "rose" : "sky"}
                onPress={() =>
                  setSessionModal(activeSession ? "close" : "open")
                }
                disabled={isLoading.sessions}
              />
            ) : (
              <ActionButton
                title="Refresh"
                icon="refresh"
                accent="sky"
                onPress={() => refetchers[moduleKey]()}
                disabled={isLoading[moduleKey]}
              />
            )}
          </View>

          {moduleKey === "products" && (
            <View className="mb-4 flex-row gap-3">
              <ActionButton
                title="Export CSV"
                icon="file-download"
                accent="emerald"
                onPress={() => void handleExportProducts()}
              />
              <ActionButton
                title="Import CSV"
                icon="file-upload"
                accent="amber"
                onPress={() => void handleImportProducts()}
                disabled={!canManageInventory}
              />
              <ActionButton
                title="CSV Template"
                icon="description"
                accent="slate"
                onPress={() => void handleDownloadProductTemplate()}
              />
            </View>
          )}

          <SectionTitle
            title={`${moduleKey} list`}
            action="Tap an item to edit"
          />
          <Card>
            {isLoading[moduleKey] && moduleKey !== "sessions" ? (
              <View className="py-12 items-center">
                <ActivityIndicator size="large" color="#38bdf8" />
                <Text className="mt-4 text-slate-400">Loading...</Text>
              </View>
            ) : moduleKey === "sessions" ? (
              sessions.length ? (
                sessions.map((session: any) => {
                  const isActive = session.status === "OPEN";
                  const sessionOrders = orders.filter(
                    (o: any) => o.sessionId === session.id,
                  );
                  const totalSales = sessionOrders
                    .filter(isCountedSale)
                    .reduce(
                      (sum: number, o: any) => sum + (o.grandTotal || 0),
                      0,
                    );
                  const orderCount = sessionOrders.length;

                  return (
                    <View
                      key={session.id}
                      className={`border-b border-white/8 px-4 py-3 last:border-b-0 ${
                        isActive ? "bg-emerald-500/5" : ""
                      }`}
                    >
                      <View className="flex-row items-start justify-between">
                        <View className="flex-1">
                          <View className="flex-row items-center gap-2">
                            <Text className="text-base font-bold text-white">
                              Session #{session.id.slice(-6)}
                            </Text>
                            <Pill
                              label={isActive ? "OPEN" : "CLOSED"}
                              tone={isActive ? "emerald" : "rose"}
                            />
                          </View>

                          <Text className="text-slate-400 text-xs mt-1">
                            Opening Balance: $
                            {Number(session.openingBalance).toFixed(2)}
                          </Text>

                          <Text className="mt-1 text-xs text-slate-400">
                            Opened:{" "}
                            {new Date(session.openedAt).toLocaleString()}
                          </Text>
                          {session.closedAt && (
                            <Text className="text-xs text-slate-400">
                              Closed:{" "}
                              {new Date(session.closedAt).toLocaleString()}
                            </Text>
                          )}
                          <Text className="mt-0.5 text-xs text-slate-400">
                            Orders: {orderCount} • Total: $
                            {totalSales.toFixed(2)}
                          </Text>
                          {session.notes && (
                            <Text className="mt-1 text-xs italic text-slate-500">
                              {session.notes}
                            </Text>
                          )}
                        </View>
                        <View className="items-end">
                          <Text className="font-bold text-emerald-400">
                            ${totalSales.toFixed(2)}
                          </Text>
                          {isActive && (
                            <TouchableOpacity
                              className="mt-2 rounded-full border border-rose-500/30 bg-rose-500/20 px-3 py-1.5"
                              onPress={() => {
                                setSessionModal("close");
                                setEditor({
                                  open: false,
                                  mode: "create",
                                  item: session,
                                });
                              }}
                            >
                              <Text className="text-xs font-bold text-rose-400">
                                Close
                              </Text>
                            </TouchableOpacity>
                          )}
                        </View>
                      </View>
                    </View>
                  );
                })
              ) : (
                <EmptyState
                  icon="schedule"
                  title="No sessions yet"
                  description="Open your first session to start tracking sales."
                />
              )
            ) : list.length ? (
              list.map((item: any, index: number) => (
                <View
                  key={item.id ? `item-${item.id}` : `idx-${index}`}
                  pointerEvents="box-only"
                >
                  <TouchableOpacity
                    onPress={() => openEditor("edit", item)}
                    activeOpacity={0.7}
                    className="flex-row items-center justify-between px-4 py-3"
                  >
                    <View className="flex-1 flex-row items-center">
                      <MaterialIcons
                        name={getIcon(moduleKey)}
                        size={24}
                        color="#94a3b8"
                      />
                      <View className="ml-3 flex-1">
                        <Text className="text-base font-semibold text-white">
                          {item.name || item.username || item.code || item.id}
                        </Text>
                        {moduleKey === "staff" ? (
                          <View className="mt-1.5 flex-row flex-wrap items-center gap-1.5">
                            {(() => {
                              const assignedStore = stores.find(
                                (s: any) =>
                                  s.id === item.storeId ||
                                  (s.remoteId && s.remoteId === item.storeId),
                              );
                              const storeName =
                                assignedStore?.name ||
                                item.storeName ||
                                "Unassigned Store";
                              const isAssigned = Boolean(
                                assignedStore || item.storeName,
                              );
                              return (
                                <View
                                  className={`flex-row items-center rounded-md px-2 py-0.5 border ${
                                    isAssigned
                                      ? "bg-sky-500/15 border-sky-500/30"
                                      : "bg-amber-500/15 border-amber-500/30"
                                  }`}
                                >
                                  <MaterialIcons
                                    name="storefront"
                                    size={12}
                                    color={isAssigned ? "#38bdf8" : "#fbbf24"}
                                  />
                                  <Text
                                    className={`ml-1 text-[11px] font-semibold ${
                                      isAssigned
                                        ? "text-sky-300"
                                        : "text-amber-300"
                                    }`}
                                  >
                                    {storeName}
                                  </Text>
                                </View>
                              );
                            })()}
                            <View className="rounded-md bg-white/10 px-2 py-0.5">
                              <Text className="text-[11px] font-medium text-slate-300">
                                {item.role}
                              </Text>
                            </View>
                            {item.email ? (
                              <Text className="text-xs text-slate-400">
                                {item.email}
                              </Text>
                            ) : null}
                          </View>
                        ) : (
                          <Text
                            className="text-sm text-slate-400"
                            numberOfLines={1}
                          >
                            {getSubtitle(moduleKey, item, stores)}
                          </Text>
                        )}
                        {moduleKey === "products" &&
                          Array.isArray(item.variants) &&
                          item.variants.length > 0 && (
                            <ScrollView
                              horizontal
                              showsHorizontalScrollIndicator={false}
                              className="mt-2"
                            >
                              {item.variants.map((variant: any) => (
                                <View
                                  key={variant.id}
                                  className="mr-2 rounded-full border border-amber-400/20 bg-amber-400/10 px-2.5 py-1"
                                >
                                  <Text className="text-[10px] font-semibold text-amber-200">
                                    {variant.name} • $
                                    {Number(variant.price ?? 0).toFixed(2)}
                                    {variant.stock !== undefined
                                      ? ` • 📦 ${variant.stock}`
                                      : ""}
                                  </Text>
                                </View>
                              ))}
                            </ScrollView>
                          )}
                      </View>
                    </View>
                    <View className="ml-2 items-end">
                      <Text className="text-sm font-medium text-slate-300">
                        {getRightLabel(moduleKey, item)}
                      </Text>
                      {moduleKey === "products" && (
                        <TouchableOpacity
                          className="mt-2 rounded-full bg-sky-500/15 p-2"
                          onPress={() => setLabelProduct(item)}
                          accessibilityLabel={`Print label for ${item.name}`}
                        >
                          <MaterialIcons
                            name="qr-code-2"
                            size={18}
                            color="#38bdf8"
                          />
                        </TouchableOpacity>
                      )}
                    </View>
                  </TouchableOpacity>
                  {index < list.length - 1 && (
                    <View className="mx-4 my-2 h-px bg-white/8" />
                  )}
                </View>
              ))
            ) : (
              <EmptyState
                icon={getIcon(moduleKey)}
                title={`No ${moduleKey} found`}
                description={`Create a new ${moduleKey.slice(0, -1)} to get started.`}
              />
            )}
          </Card>
        </ScrollView>

        <EditorModal
          visible={editor.open}
          title={`${editor.mode === "create" ? "Create" : "Edit"} ${moduleKey}`}
          moduleKey={moduleKey}
          item={editor.item}
          mode={editor.mode}
          onClose={() => setEditor({ open: false, mode: "create" })}
          onSave={handleSave}
          onDelete={editor.item ? () => handleDelete(editor.item) : undefined}
          currentStoreId={currentStoreId}
          stores={stores}
          categories={categories}
          suppliers={suppliers}
          brands={brands}
          refetchCategories={refetchCategories}
          refetchSuppliers={refetchSuppliers}
          refetchBrands={refetchBrands}
          isLoading={isLoading[moduleKey]}
        />

        <SessionModal
          visible={sessionModal !== null}
          mode={sessionModal}
          activeSession={activeSession}
          sessions={sessions}
          orders={orders}
          onClose={() => setSessionModal(null)}
          onOpen={handleOpenSession}
          onCloseSession={handleCloseSession}
          isSubmitting={openingSession || closingSession}
        />

        <Modal
          visible={Boolean(labelProduct)}
          transparent
          animationType="fade"
          onRequestClose={() => setLabelProduct(null)}
        >
          <View className="flex-1 items-center justify-center bg-black/75 px-6">
            <View className="w-full max-w-sm items-center rounded-3xl border border-white/10 bg-slate-900 p-6">
              <Text className="text-xl font-black text-white">
                Product label
              </Text>
              <Text
                className="mt-1 text-center text-sm text-slate-400"
                numberOfLines={1}
              >
                {labelProduct?.name}
              </Text>
              {labelProduct && (
                <View className="my-6 rounded-2xl bg-white p-4">
                  <QRCode
                    getRef={(ref: any) => {
                      qrRef.current = ref;
                    }}
                    value={String(
                      labelProduct.barcode ||
                        labelProduct.sku ||
                        labelProduct.id,
                    )}
                    size={190}
                    backgroundColor="white"
                    color="black"
                  />
                </View>
              )}
              <Text className="text-base font-bold text-sky-300">
                {labelProduct?.barcode || labelProduct?.sku}
              </Text>
              <View className="mt-5 w-full flex-row gap-3">
                <ActionButton
                  title="Close"
                  icon="close"
                  accent="slate"
                  onPress={() => setLabelProduct(null)}
                />
                <ActionButton
                  title="Print"
                  icon="print"
                  accent="sky"
                  onPress={handlePrintProductLabel}
                />
              </View>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Screen>
  );
}

function isCountedSale(order: any) {
  return !["VOIDED", "CANCELLED"].includes(order.status);
}

function emptyPaymentTotals() {
  return { CASH: 0, CARD: 0, DIGITAL: 0 };
}

function addPaymentTotals(
  totals: { CASH: number; CARD: number; DIGITAL: number },
  order: any,
) {
  const breakdown = Array.isArray(order.paymentBreakdown)
    ? order.paymentBreakdown
    : [];
  if (breakdown.length) {
    for (const tender of breakdown) {
      const method = String(tender.method || "DIGITAL").toUpperCase();
      const amount = Number(tender.amount ?? 0);
      if (method === "CASH") totals.CASH += amount;
      else if (method === "CARD") totals.CARD += amount;
      else totals.DIGITAL += amount;
    }
    return totals;
  }
  const method = String(order.paymentMethod || "DIGITAL").toUpperCase();
  const amount = Number(order.grandTotal ?? 0);
  if (method === "CASH") totals.CASH += amount;
  else if (method === "CARD") totals.CARD += amount;
  else totals.DIGITAL += amount;
  return totals;
}
