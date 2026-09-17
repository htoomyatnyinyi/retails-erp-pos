import AsyncStorage from "@react-native-async-storage/async-storage";
import { drizzle } from "drizzle-orm/expo-sqlite";
import { migrate } from "drizzle-orm/expo-sqlite/migrator";
import { openDatabaseSync, type SQLiteDatabase } from "expo-sqlite";
import migrations from "./drizzle/migrations";
import * as schema from "./schema";

const databaseName = "midnightcorner_offline_v2.db";

let sqlite: SQLiteDatabase | undefined;
let db: ReturnType<typeof drizzle<typeof schema>> | undefined;

// 1. DATABASE INITIALIZATION

export function getSqliteDatabase() {
  if (!sqlite) {
    sqlite = openDatabaseSync(databaseName);
    sqlite.execSync("PRAGMA journal_mode = WAL;");
    sqlite.execSync("PRAGMA foreign_keys = ON;");
    sqlite.execSync("PRAGMA synchronous = NORMAL;");
  }
  return sqlite;
}

export function getOfflineDb() {
  if (!db) {
    db = drizzle(getSqliteDatabase(), { schema });
  }
  return db;
}

export const database = getOfflineDb();
export type Database = typeof database;

// 2. MIGRATION FUNCTIONS - FIXED ✅

/**
 * Run migrations using Drizzle Kit generated migrations
 */
export async function runMigrations() {
  try {
    const db = getSqliteDatabase();
    const drizzleDb = drizzle(db);

    console.log("📦 Running database migrations...");
    console.log(
      `📋 Available migrations: ${Object.keys(migrations.migrations).join(", ")}`,
    );

    await migrate(drizzleDb, migrations);
    console.log("✅ Database migrations completed successfully!");
  } catch (error) {
    console.error("❌ Failed to run migrations, resetting database...", error);
    try {
      // Instead of deleting the file (which fails if the connection is open),
      // drop all tables and re-run migrations from scratch.
      const db = getSqliteDatabase();

      console.log("🗑️ Dropping all tables for clean migration...");

      // Get all user tables
      const tables = db
        .getAllSync<{
          name: string;
        }>(
          "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
        )
        .map((r) => r.name);

      // Disable FK constraints temporarily so we can drop in any order
      db.execSync("PRAGMA foreign_keys = OFF;");
      for (const table of tables) {
        db.execSync(`DROP TABLE IF EXISTS "${table}";`);
        console.log(`  dropped ${table}`);
      }
      db.execSync("PRAGMA foreign_keys = ON;");

      console.log("✅ All tables dropped. Re-running migrations...");

      const drizzleDb = drizzle(db);
      await migrate(drizzleDb, migrations);
      console.log("✅ Database recreated and migrated successfully!");
    } catch (fallbackError) {
      console.error("❌ Fallback migration failed:", fallbackError);
      throw fallbackError;
    }
  }
}

/**
 * Initialize database with migrations
 */
export async function initializeDatabase() {
  try {
    getSqliteDatabase();
    await runMigrations();
    console.log("✅ Database initialized successfully!");
  } catch (error) {
    console.error("❌ Failed to initialize database:", error);
    throw error;
  }
}

// 3. UTILITY FUNCTIONS

export async function getOfflineDbSize(): Promise<string> {
  try {
    const db = getOfflineDb();
    const result = await db.get<{ page_count: number }>("PRAGMA page_count");
    const pageCount = result?.page_count || 0;
    const pageSize = 4096;
    const sizeInBytes = pageCount * pageSize;

    if (sizeInBytes < 1024) return `${sizeInBytes} B`;
    if (sizeInBytes < 1024 * 1024)
      return `${(sizeInBytes / 1024).toFixed(1)} KB`;
    if (sizeInBytes < 1024 * 1024 * 1024) {
      return `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
    }
    return `${(sizeInBytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  } catch (error) {
    console.error("Failed to get DB size:", error);
    return "Unknown";
  }
}

export async function clearOfflineDatabase() {
  try {
    const rawDb = getSqliteDatabase();
    const offlineDb = getOfflineDb();

    console.log("🗑️ Clearing offline database...");

    // Disable foreign key constraints temporarily for bulk deletion
    try {
      rawDb.execSync("PRAGMA foreign_keys = OFF;");
    } catch (e) {
      console.warn("Could not disable foreign_keys pragma:", e);
    }

    await offlineDb.delete(schema.orderItems);
    await offlineDb.delete(schema.inventoryCountItems);
    await offlineDb.delete(schema.inventoryCounts);
    await offlineDb.delete(schema.inventoryMovements);
    await offlineDb.delete(schema.inventory);
    await offlineDb.delete(schema.productVariants);
    await offlineDb.delete(schema.priceHistory);
    await offlineDb.delete(schema.products);
    await offlineDb.delete(schema.categories);
    await offlineDb.delete(schema.brands);
    await offlineDb.delete(schema.suppliers);
    await offlineDb.delete(schema.staff);
    await offlineDb.delete(schema.orders);
    await offlineDb.delete(schema.sessions);
    await offlineDb.delete(schema.customers);
    await offlineDb.delete(schema.stores);
    await offlineDb.delete(schema.syncOutbox);
    await offlineDb.delete(schema.syncState);
    await offlineDb.delete(schema.genericRecords);

    // Re-enable foreign key constraints
    try {
      rawDb.execSync("PRAGMA foreign_keys = ON;");
    } catch (e) {
      console.warn("Could not re-enable foreign_keys pragma:", e);
    }

    // Clear all AsyncStorage sync cursors so next sync pulls full dataset from cloud
    try {
      const keys = await AsyncStorage.getAllKeys();
      const cursorKeys = keys.filter((k) => k.startsWith("offline-sync-cursor:"));
      if (cursorKeys.length > 0) {
        await AsyncStorage.multiRemove(cursorKeys);
        console.log(`🧹 Cleared ${cursorKeys.length} sync cursors from AsyncStorage`);
      }
    } catch (cursorError) {
      console.warn("Could not clear sync cursors from AsyncStorage:", cursorError);
    }

    console.log("🔥 Offline database cleared successfully!");
  } catch (error) {
    console.error("❌ Failed to clear offline database:", error);
    throw error;
  }
}

export function resetDatabaseConnection() {
  if (sqlite) {
    try {
      sqlite.closeSync();
    } catch (e) {
      // Already closed or invalid — safe to ignore
    }
  }
  sqlite = undefined;
  db = undefined;
  console.log("🔄 Database connection reset");
}

// Run this once to completely reset the database

export async function resetDatabaseCompletely() {
  try {
    const db = getSqliteDatabase();

    console.log("Dropping all tables...");

    try {
      db.execSync("PRAGMA foreign_keys = OFF;");
    } catch (e) {
      console.warn("Could not disable foreign_keys pragma:", e);
    }

    // Drop all tables in correct order
    const tablesToDrop = [
      "order_items",
      "inventory_count_items",
      "inventory_counts",
      "inventory_movements",
      "inventory",
      "product_variants",
      "price_history",
      "products",
      "categories",
      "brands",
      "suppliers",
      "staff",
      "orders",
      "sessions",
      "customers",
      "stores",
      "sync_outbox",
      "sync_state",
      "generic_records",
      "__drizzle_migrations",
    ];

    for (const table of tablesToDrop) {
      try {
        db.execSync(`DROP TABLE IF EXISTS ${table}`);
        console.log(`✅ Dropped ${table}`);
      } catch (e) {
        // Table might not exist, ignore
      }
    }

    try {
      db.execSync("PRAGMA foreign_keys = ON;");
    } catch (e) {
      console.warn("Could not re-enable foreign_keys pragma:", e);
    }

    console.log("✅ All tables dropped!");
    console.log("🔄 Please restart the app to run migrations fresh.");

    return { success: true };
  } catch (error) {
    console.error("❌ Failed to reset database:", error);
    return { success: false, error };
  }
}

export function isDatabaseInitialized(): boolean {
  return !!sqlite && !!db;
}

export async function getDatabaseStats(): Promise<Record<string, number>> {
  try {
    const offlineDb = getOfflineDb();
    const tables = await offlineDb.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'",
    );

    const stats: Record<string, number> = {};
    for (const table of tables) {
      const result = await offlineDb.get<{ count: number }>(
        `SELECT COUNT(*) as count FROM ${table.name}`,
      );
      stats[table.name] = result?.count || 0;
    }

    return stats;
  } catch (error) {
    console.error("Failed to get database stats:", error);
    return {};
  }
}

export async function vacuumDatabase() {
  try {
    const db = getSqliteDatabase();
    db.execSync("VACUUM;");
    console.log("✅ Database vacuumed successfully");
  } catch (error) {
    console.error("❌ Failed to vacuum database:", error);
    throw error;
  }
}

export async function getTableCount(tableName: string): Promise<number> {
  try {
    const offlineDb = getOfflineDb();
    const result = await offlineDb.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM ${tableName}`,
    );
    return result?.count || 0;
  } catch (error) {
    console.error(`Failed to get count for ${tableName}:`, error);
    return 0;
  }
}

export async function tableExists(tableName: string): Promise<boolean> {
  try {
    const offlineDb = getOfflineDb();
    const result = await offlineDb.get<{ count: number }>(
      `SELECT COUNT(*) as count FROM sqlite_master WHERE type='table' AND name='${tableName}'`,
    );
    return (result?.count || 0) > 0;
  } catch (error) {
    console.error(`Failed to check table ${tableName}:`, error);
    return false;
  }
}

export async function getAllTableNames(): Promise<string[]> {
  try {
    const offlineDb = getOfflineDb();
    const tables = await offlineDb.all<{ name: string }>(
      "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name",
    );
    return tables.map((t) => t.name);
  } catch (error) {
    console.error("Failed to get table names:", error);
    return [];
  }
}
