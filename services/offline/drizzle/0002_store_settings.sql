CREATE TABLE `store_settings` (
	`id` text PRIMARY KEY NOT NULL,
	`remote_id` text,
	`tenant_id` text NOT NULL,
	`store_id` text NOT NULL,
	`setting_key` text NOT NULL,
	`setting_value` text NOT NULL,
	`description` text,
	`sync_status` text DEFAULT 'synced' NOT NULL,
	`sync_error` text,
	`created_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`updated_at` text DEFAULT CURRENT_TIMESTAMP NOT NULL,
	`last_synced_at` text
);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_settings_remote_id_unique` ON `store_settings` (`remote_id`);
--> statement-breakpoint
CREATE UNIQUE INDEX `store_settings_store_key_idx` ON `store_settings` (`store_id`,`setting_key`);
--> statement-breakpoint
CREATE INDEX `store_settings_tenant_store_idx` ON `store_settings` (`tenant_id`,`store_id`);
