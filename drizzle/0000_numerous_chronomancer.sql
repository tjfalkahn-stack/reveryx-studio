CREATE TABLE `link_events` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`participant_id` text,
	`type` text NOT NULL,
	`payload` text DEFAULT '{}' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `link_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `link_participants` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`name` text NOT NULL,
	`role` text NOT NULL,
	`device_id` text NOT NULL,
	`status` text DEFAULT 'joining' NOT NULL,
	`joined_at` integer NOT NULL,
	`last_seen_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `link_rooms`(`id`) ON UPDATE no action ON DELETE cascade
);
--> statement-breakpoint
CREATE TABLE `link_rooms` (
	`id` text PRIMARY KEY NOT NULL,
	`secret_hash` text NOT NULL,
	`title` text NOT NULL,
	`song_name` text DEFAULT 'Untitled song' NOT NULL,
	`bpm` integer DEFAULT 128 NOT NULL,
	`beat_key` text,
	`beat_name` text,
	`beat_mime` text,
	`shared_state` text DEFAULT '{}' NOT NULL,
	`notes` text DEFAULT '' NOT NULL,
	`created_at` integer NOT NULL,
	`updated_at` integer NOT NULL
);
--> statement-breakpoint
CREATE TABLE `link_takes` (
	`id` text PRIMARY KEY NOT NULL,
	`room_id` text NOT NULL,
	`participant_id` text NOT NULL,
	`name` text NOT NULL,
	`object_key` text NOT NULL,
	`mime_type` text NOT NULL,
	`seconds` real NOT NULL,
	`start_seconds` real NOT NULL,
	`sync_offset_ms` integer DEFAULT 0 NOT NULL,
	`state` text DEFAULT 'captured' NOT NULL,
	`created_at` integer NOT NULL,
	FOREIGN KEY (`room_id`) REFERENCES `link_rooms`(`id`) ON UPDATE no action ON DELETE cascade,
	FOREIGN KEY (`participant_id`) REFERENCES `link_participants`(`id`) ON UPDATE no action ON DELETE cascade
);
