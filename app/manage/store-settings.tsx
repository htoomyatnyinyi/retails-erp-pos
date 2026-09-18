import { Card, Header, Screen } from "@/components/app-ui";
import { useAppSelector } from "@/hooks/redux-hooks/useAppSelector";
import {
  useGetLocalStoreSettingsQuery,
  useSaveLocalStoreSettingMutation,
} from "@/services/features/offline/localApi";
import { router } from "expo-router";
import { useEffect, useMemo, useState } from "react";
import { Alert, ActivityIndicator, Modal, NativeModules, PermissionsAndroid, Platform, ScrollView, Switch, Text, TextInput, TouchableOpacity, View } from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { runMigrations } from "@/services/offline/db";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { MaterialIcons } from "@expo/vector-icons";

let BleManager: any = null;
let BluetoothClassic: any = null;
try {
  if (NativeModules.BleManager) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("react-native-ble-manager");
    BleManager = module.default || module;
  }
  if (Platform.OS === "android" && NativeModules.RNBluetoothClassic) {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const module = require("react-native-bluetooth-classic");
    BluetoothClassic = module.default || module;
  }
} catch {}

const fields = [
  { key: "tax_rate", label: "Tax rate (%)", fallback: "0", description: "Applied to taxable items at checkout" },
  { key: "currency_symbol", label: "Currency symbol", fallback: "$", description: "Shown on the POS checkout" },
  { key: "receipt_header", label: "Receipt header", fallback: "", description: "Printed above receipt details" },
  { key: "receipt_footer", label: "Receipt footer", fallback: "Thank you!", description: "Printed at the end of receipts" },
  { key: "thermal_printer_name", label: "Thermal printer name", fallback: "", description: "Label for the paired receipt printer" },
  { key: "thermal_paper_width", label: "Thermal paper width (mm)", fallback: "80", description: "Receipt layout width: usually 58 or 80" },
  { key: "auto_print_receipt", label: "Auto-print receipt (true/false)", fallback: "false", description: "Print immediately after an order when a printer is connected" },
] as const;

export default function StoreSettingsScreen() {
  const { user, currentStoreId } = useAppSelector((state) => state.auth);
  const { data: settings = [], isFetching } = useGetLocalStoreSettingsQuery(
    { storeId: currentStoreId || "" },
    { skip: !currentStoreId },
  );
  const [saveSetting, { isLoading }] = useSaveLocalStoreSettingMutation();
  const [values, setValues] = useState<Record<string, string>>({});
  const [printerModalVisible, setPrinterModalVisible] = useState(false);
  const [devices, setDevices] = useState<any[]>([]);
  const [scanning, setScanning] = useState(false);
  const [connecting, setConnecting] = useState(false);
  const [section, setSection] = useState<"checkout" | "receipt" | "printer">("checkout");
  const [hasChanges, setHasChanges] = useState(false);

  const requestBluetoothPermissions = async () => {
    if (Platform.OS !== "android") return true;
    const permissions = Number(Platform.Version) >= 31
      ? [PermissionsAndroid.PERMISSIONS.BLUETOOTH_SCAN, PermissionsAndroid.PERMISSIONS.BLUETOOTH_CONNECT]
      : [PermissionsAndroid.PERMISSIONS.ACCESS_FINE_LOCATION];
    const result = await PermissionsAndroid.requestMultiple(permissions);
    return permissions.every((permission) => result[permission] === PermissionsAndroid.RESULTS.GRANTED);
  };

  const scanPrinters = async () => {
    if (!BluetoothClassic && !BleManager) {
      Alert.alert("Bluetooth unavailable", "Install a native build with Bluetooth printer support.");
      return;
    }
    try {
      if (!(await requestBluetoothPermissions())) {
        Alert.alert("Permission needed", "Allow Nearby devices / Bluetooth permission to search printers.");
        return;
      }
      setScanning(true);
      setDevices([]);
      if (Platform.OS === "android" && BluetoothClassic) {
        if (!(await BluetoothClassic.isBluetoothEnabled())) await BluetoothClassic.requestBluetoothEnabled();
        const paired = await BluetoothClassic.getBondedDevices();
        const found = await BluetoothClassic.startDiscovery();
        const unique = [...paired, ...found].map((device: any) => ({
          id: device.address || device.id, address: device.address || device.id,
          name: device.name || "Unnamed Bluetooth printer", bonded: device.bonded, transport: "classic",
        })).filter((device: any, index: number, rows: any[]) => rows.findIndex((row) => row.id === device.id) === index);
        setDevices(unique);
        setScanning(false);
        return;
      }
      await BleManager.start?.({ showAlert: false });
      BleManager.onDiscoverPeripheral((device: any) => setDevices((rows) => {
        const printer = { ...device, name: device.name || device.advertising?.localName || "Unnamed BLE printer", transport: "ble" };
        return rows.some((row) => row.id === printer.id) ? rows : [...rows, printer];
      }));
      BleManager.onStopScan(() => setScanning(false));
      await BleManager.scan({ seconds: 8, allowDuplicates: false });
    } catch (error: any) {
      Alert.alert("Scan error", error?.message || "Unable to search Bluetooth printers.");
      setScanning(false);
    }
  };

  const connectPrinter = async (device: any) => {
    try {
      setConnecting(true);
      let saved: any;
      if (device.transport === "classic") {
        let printer = device;
        if (!device.bonded) printer = await BluetoothClassic.pairDevice(device.address || device.id);
        const connected = await BluetoothClassic.connectToDevice(printer.address || printer.id);
        saved = { id: connected.address || printer.address || device.id, name: connected.name || printer.name || device.name, transport: "classic" };
      } else {
        await BleManager.connect(device.id);
        const peripheral = await BleManager.retrieveServices(device.id);
        const characteristic = peripheral.characteristics?.find((item: any) => item.properties?.Write || item.properties?.WriteWithoutResponse);
        if (!characteristic) throw new Error("Printer has no writable Bluetooth characteristic.");
        saved = { id: device.id, name: device.name, transport: "ble", writeCharacteristic: { service: characteristic.service, characteristic: characteristic.characteristic, withoutResponse: Boolean(characteristic.properties?.WriteWithoutResponse) } };
      }
      await AsyncStorage.setItem("selected_printer", JSON.stringify(saved));
      updateValue("thermal_printer_name", saved.name);
      setPrinterModalVisible(false);
      Alert.alert("Printer connected", `${saved.name} selected. Tap Save Store Settings to sync its name.`);
    } catch (error: any) {
      Alert.alert("Connection error", error?.message || "Could not connect to this printer.");
    } finally {
      setConnecting(false);
    }
  };

  useEffect(() => {
    const next: Record<string, string> = {};
    for (const field of fields) {
      const found = (settings as any[]).find((row) => row.settingKey === field.key);
      next[field.key] = String(found?.settingValue ?? field.fallback);
    }
    // RTK Query may provide a new empty-array reference during refetches.
    // Do not enqueue a state update unless the actual form values changed.
    setValues((previous) => {
      const unchanged = fields.every(
        (field) => previous[field.key] === next[field.key],
      );
      return unchanged ? previous : next;
    });
  }, [settings]);

  const updateValue = (key: string, value: string) => {
    setHasChanges(true);
    setValues((previous) => ({ ...previous, [key]: value }));
  };
  const autoPrint = values.auto_print_receipt === "true";
  const taxRate = Number(values.tax_rate || 0) || 0;
  const previewTotal = useMemo(() => 10 * (1 + taxRate / 100), [taxRate]);

  const save = async () => {
    if (!user?.tenantId || !currentStoreId) return;
    const tax = Number(values.tax_rate);
    const paperWidth = Number(values.thermal_paper_width);
    if (!Number.isFinite(tax) || tax < 0 || tax > 100) {
      Alert.alert("Invalid tax rate", "Enter a value between 0 and 100.");
      return;
    }
    if (![58, 80].includes(paperWidth)) {
      Alert.alert("Invalid paper width", "Thermal paper width must be 58 or 80 mm.");
      return;
    }
    try {
      // This also upgrades installs that opened this screen before the app
      // initialization finished. Save serially: concurrent SQLite writes can
      // otherwise produce a transient "database is locked" error on Android.
      await runMigrations();
      for (const [index, field] of fields.entries()) {
        const settingValue = field.key === "tax_rate"
          ? tax
          : field.key === "thermal_paper_width"
            ? paperWidth
            : values[field.key] ?? field.fallback;
        await saveSetting({
          tenantId: user.tenantId,
          storeId: currentStoreId,
          settingKey: field.key,
          settingValue,
          description: field.description,
          syncNow: index === fields.length - 1,
        }).unwrap();
      }
      Alert.alert("Saved", "Settings are saved locally and will sync automatically.");
      setHasChanges(false);
      router.back();
    } catch (error: any) {
      console.error("Store settings save failed", error);
      const message =
        error?.data?.message ||
        error?.message ||
        (typeof error === "string" ? error : null) ||
        "Unable to save store settings.";
      Alert.alert("Save failed", message);
    }
  };

  return (
    <Screen>
      <SafeAreaView className="flex-1">
        <ScrollView contentContainerStyle={{ paddingBottom: 110 }} showsVerticalScrollIndicator={false}>
          <Header eyebrow="Store configuration" title="Store Settings" subtitle="Set up checkout, receipts, and your printer." right={<View className={`rounded-full px-2.5 py-1 ${hasChanges ? "bg-amber-400/15" : "bg-emerald-400/15"}`}><Text className={`text-[10px] font-bold ${hasChanges ? "text-amber-300" : "text-emerald-300"}`}>{hasChanges ? "UNSAVED" : "SAVED"}</Text></View>} />
          {!currentStoreId ? (
            <Card><Text className="text-amber-300">Select a store in Manage before editing its settings.</Text></Card>
          ) : (
            <>
              <View className="mb-5 flex-row rounded-2xl bg-slate-900 p-1.5">
                {([ ["checkout", "Checkout", "point-of-sale"], ["receipt", "Receipt", "receipt-long"], ["printer", "Printer", "print"] ] as const).map(([key, label, icon]) => <TouchableOpacity key={key} className={`flex-1 flex-row items-center justify-center rounded-xl px-2 py-2.5 ${section === key ? "bg-sky-500" : ""}`} onPress={() => setSection(key)}><MaterialIcons name={icon} size={16} color={section === key ? "#082f49" : "#94a3b8"} /><Text className={`ml-1.5 text-xs font-bold ${section === key ? "text-slate-950" : "text-slate-400"}`}>{label}</Text></TouchableOpacity>)}
              </View>

              {section === "checkout" && <>
                <Card className="mb-3"><View className="flex-row items-center"><View className="rounded-2xl bg-emerald-400/15 p-3"><MaterialIcons name="calculate" size={22} color="#6ee7b7" /></View><View className="ml-3 flex-1"><Text className="text-white font-bold">Tax at checkout</Text><Text className="mt-1 text-xs text-slate-400">Applied only to taxable products.</Text></View></View><View className="mt-4 flex-row items-center rounded-2xl border border-white/10 bg-slate-950 px-4"><Text className="text-slate-400 text-base">Tax rate</Text><TextInput value={values.tax_rate ?? "0"} onChangeText={(value) => updateValue("tax_rate", value)} keyboardType="decimal-pad" className="ml-auto min-w-20 py-4 text-right text-lg font-bold text-white" /><Text className="ml-1 text-slate-400">%</Text></View></Card>
                <Card className="mb-3"><View className="flex-row items-center"><View className="rounded-2xl bg-violet-400/15 p-3"><MaterialIcons name="payments" size={22} color="#c4b5fd" /></View><View className="ml-3 flex-1"><Text className="text-white font-bold">Currency display</Text><Text className="mt-1 text-xs text-slate-400">Shown throughout checkout and receipts.</Text></View></View><View className="mt-4 flex-row items-center rounded-2xl border border-white/10 bg-slate-950 px-4"><Text className="text-slate-400">Symbol</Text><TextInput value={values.currency_symbol ?? "$"} onChangeText={(value) => updateValue("currency_symbol", value)} maxLength={4} className="ml-auto min-w-20 py-4 text-right text-lg font-bold text-white" /></View></Card>
                <Card><Text className="text-xs font-bold uppercase tracking-[2px] text-slate-400">Checkout preview</Text><View className="mt-3 flex-row justify-between"><Text className="text-slate-300">Sample sale</Text><Text className="font-bold text-white">{values.currency_symbol || "$"}10.00</Text></View><View className="mt-2 flex-row justify-between"><Text className="text-slate-300">Tax ({taxRate}%)</Text><Text className="font-bold text-white">{values.currency_symbol || "$"}{(taxRate / 10).toFixed(2)}</Text></View><View className="mt-3 border-t border-white/10 pt-3 flex-row justify-between"><Text className="font-bold text-white">Customer pays</Text><Text className="text-lg font-black text-sky-300">{values.currency_symbol || "$"}{previewTotal.toFixed(2)}</Text></View></Card>
              </>}

              {section === "receipt" && <>
                <Card className="mb-3"><Text className="text-white font-bold">Receipt message</Text><Text className="mt-1 text-xs text-slate-400">Use a short message that fits a thermal receipt.</Text><Text className="mt-4 text-xs font-bold uppercase tracking-widest text-slate-500">Header</Text><TextInput value={values.receipt_header ?? ""} onChangeText={(value) => updateValue("receipt_header", value)} placeholder="e.g. Welcome to our store" placeholderTextColor="#64748b" className="mt-2 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3.5 text-white" /><Text className="mt-4 text-xs font-bold uppercase tracking-widest text-slate-500">Footer</Text><TextInput value={values.receipt_footer ?? ""} onChangeText={(value) => updateValue("receipt_footer", value)} placeholder="Thank you!" placeholderTextColor="#64748b" className="mt-2 rounded-2xl border border-white/10 bg-slate-950 px-4 py-3.5 text-white" /></Card>
                <View className="mb-4 items-center"><Text className="mb-3 text-[11px] font-bold uppercase tracking-[2px] text-slate-400">Live receipt preview</Text><View className="bg-white px-4 py-5" style={{ width: values.thermal_paper_width === "58" ? 220 : 300 }}><Text className="text-center text-base font-bold text-black">Your Store</Text>{values.receipt_header ? <Text className="mt-1 text-center text-xs text-black">{values.receipt_header}</Text> : null}<Text className="my-3 text-center text-xs text-black">--------------------------</Text><View className="flex-row justify-between"><Text className="text-xs text-black">Sample item</Text><Text className="text-xs text-black">{values.currency_symbol || "$"}10.00</Text></View><View className="mt-2 flex-row justify-between"><Text className="text-xs text-black">Tax</Text><Text className="text-xs text-black">{values.currency_symbol || "$"}{(taxRate / 10).toFixed(2)}</Text></View><View className="mt-2 border-t border-black pt-2 flex-row justify-between"><Text className="text-sm font-bold text-black">TOTAL</Text><Text className="text-sm font-bold text-black">{values.currency_symbol || "$"}{previewTotal.toFixed(2)}</Text></View><Text className="mt-5 text-center text-xs text-black">{values.receipt_footer || "Thank you!"}</Text></View></View>
              </>}

              {section === "printer" && <><Card className="mb-3"><View className="flex-row items-center"><View className={`rounded-2xl p-3 ${values.thermal_printer_name ? "bg-emerald-400/15" : "bg-slate-800"}`}><MaterialIcons name="print" size={22} color={values.thermal_printer_name ? "#6ee7b7" : "#94a3b8"} /></View><View className="ml-3 flex-1"><Text className="text-white font-bold">{values.thermal_printer_name || "No printer selected"}</Text><Text className="mt-1 text-xs text-slate-400">{values.thermal_printer_name ? "Ready for receipt printing" : "Connect a Bluetooth thermal printer"}</Text></View></View><TouchableOpacity className="mt-4 flex-row items-center justify-center rounded-2xl bg-sky-500 px-4 py-3.5" onPress={() => setPrinterModalVisible(true)}><MaterialIcons name="bluetooth-searching" size={20} color="#082f49" /><Text className="ml-2 font-bold text-slate-950">{values.thermal_printer_name ? "Change Printer" : "Search for Printer"}</Text></TouchableOpacity></Card><Card className="mb-3"><Text className="text-white font-bold">Paper size</Text><Text className="mt-1 text-xs text-slate-400">Choose the roll installed in the printer.</Text><View className="mt-4 flex-row gap-3">{["58", "80"].map((width) => <TouchableOpacity key={width} onPress={() => updateValue("thermal_paper_width", width)} className={`flex-1 rounded-2xl border p-4 ${values.thermal_paper_width === width ? "border-sky-400 bg-sky-500/15" : "border-white/10 bg-slate-950"}`}><Text className={`text-center text-lg font-black ${values.thermal_paper_width === width ? "text-sky-300" : "text-white"}`}>{width} mm</Text><Text className="mt-1 text-center text-[10px] text-slate-400">{width === "58" ? "Compact" : "Standard"}</Text></TouchableOpacity>)}</View></Card><Card><View className="flex-row items-center"><View className="flex-1"><Text className="text-white font-bold">Auto-print receipt</Text><Text className="mt-1 text-xs text-slate-400">Print after completing a sale.</Text></View><Switch value={autoPrint} onValueChange={(enabled) => updateValue("auto_print_receipt", String(enabled))} trackColor={{ false: "#334155", true: "#0284c7" }} /></View></Card></>}
            </>
          )}
        </ScrollView>
        {currentStoreId && <View className="absolute bottom-0 left-0 right-0 border-t border-white/10 bg-slate-950 px-4 pb-5 pt-3"><TouchableOpacity disabled={isLoading || isFetching || !hasChanges} onPress={save} className={`flex-row items-center justify-center rounded-2xl py-4 ${(isLoading || isFetching || !hasChanges) ? "bg-slate-800" : "bg-sky-400"}`}><MaterialIcons name="save" size={20} color={(isLoading || isFetching || !hasChanges) ? "#64748b" : "#082f49"} /><Text className={`ml-2 font-black ${(isLoading || isFetching || !hasChanges) ? "text-slate-500" : "text-slate-950"}`}>{isLoading ? "Saving settings..." : hasChanges ? "Save changes" : "All changes saved"}</Text></TouchableOpacity></View>}
        <Modal visible={printerModalVisible} transparent animationType="slide" onRequestClose={() => setPrinterModalVisible(false)}>
          <View className="flex-1 justify-end bg-black/60">
            <View className="max-h-[80%] rounded-t-3xl bg-slate-900 p-6">
              <View className="mb-4 flex-row items-center justify-between"><Text className="text-xl font-bold text-white">Bluetooth Printers</Text><TouchableOpacity onPress={() => setPrinterModalVisible(false)}><MaterialIcons name="close" size={24} color="#94a3b8" /></TouchableOpacity></View>
              <TouchableOpacity className="mb-4 flex-row items-center justify-center rounded-xl bg-sky-500/20 p-3" onPress={scanPrinters} disabled={scanning}>
                <MaterialIcons name="bluetooth-searching" size={20} color="#38bdf8" /><Text className="ml-2 font-bold text-sky-300">{scanning ? "Scanning..." : "Scan for Printers"}</Text>
              </TouchableOpacity>
              {scanning && <ActivityIndicator className="mb-3" color="#38bdf8" />}
              <ScrollView>{devices.map((device) => <TouchableOpacity key={device.id} className="mb-2 rounded-xl border border-white/10 bg-white/5 p-4" onPress={() => connectPrinter(device)} disabled={connecting}><Text className="font-semibold text-white">{device.name}</Text><Text className="mt-1 text-xs text-slate-400">{device.id}</Text>{connecting && <ActivityIndicator className="mt-2" color="#38bdf8" />}</TouchableOpacity>)}{!devices.length && !scanning && <Text className="py-8 text-center text-slate-400">Tap scan to find printers</Text>}</ScrollView>
            </View>
          </View>
        </Modal>
      </SafeAreaView>
    </Screen>
  );
}
