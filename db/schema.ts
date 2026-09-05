import { integer, real, sqliteTable, text } from "drizzle-orm/sqlite-core";

export const linkRooms = sqliteTable("link_rooms", {
  id: text("id").primaryKey(),
  secretHash: text("secret_hash").notNull(),
  title: text("title").notNull(),
  songName: text("song_name").notNull().default("Untitled song"),
  bpm: integer("bpm").notNull().default(128),
  beatKey: text("beat_key"),
  beatName: text("beat_name"),
  beatMime: text("beat_mime"),
  sharedState: text("shared_state").notNull().default("{}"),
  notes: text("notes").notNull().default(""),
  createdAt: integer("created_at").notNull(),
  updatedAt: integer("updated_at").notNull(),
});

export const linkParticipants = sqliteTable("link_participants", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(()=>linkRooms.id,{onDelete:"cascade"}),
  name: text("name").notNull(),
  role: text("role").notNull(),
  deviceId: text("device_id").notNull(),
  status: text("status").notNull().default("joining"),
  joinedAt: integer("joined_at").notNull(),
  lastSeenAt: integer("last_seen_at").notNull(),
});

export const linkTakes = sqliteTable("link_takes", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(()=>linkRooms.id,{onDelete:"cascade"}),
  participantId: text("participant_id").notNull().references(()=>linkParticipants.id,{onDelete:"cascade"}),
  name: text("name").notNull(),
  objectKey: text("object_key").notNull(),
  mimeType: text("mime_type").notNull(),
  seconds: real("seconds").notNull(),
  startSeconds: real("start_seconds").notNull(),
  syncOffsetMs: integer("sync_offset_ms").notNull().default(0),
  state: text("state").notNull().default("captured"),
  createdAt: integer("created_at").notNull(),
});

export const linkEvents = sqliteTable("link_events", {
  id: text("id").primaryKey(),
  roomId: text("room_id").notNull().references(()=>linkRooms.id,{onDelete:"cascade"}),
  participantId: text("participant_id"),
  type: text("type").notNull(),
  payload: text("payload").notNull().default("{}"),
  createdAt: integer("created_at").notNull(),
});
