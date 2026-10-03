import { z } from "zod";
import type { Song } from "../subsonic.ts";
import type { ClientMessage, Device, DeviceKind, RemoteCommand, RemoteState, ServerMessage } from "../types/devices.ts";

const finiteNumber = z.number().finite();
const namedRefSchema = z.object({ id: z.string().max(500), name: z.string().max(1000) });
const replayGainSchema = z.object({
  trackGain: finiteNumber.optional(),
  albumGain: finiteNumber.optional(),
  trackPeak: finiteNumber.nonnegative().optional(),
  albumPeak: finiteNumber.nonnegative().optional(),
});

const songSchema: z.ZodType<Song> = z.object({
  id: z.string().min(1).max(500),
  parent: z.string().max(500).optional(),
  title: z.string().max(1000),
  album: z.string().max(1000).optional(),
  albumId: z.string().max(500).optional(),
  artist: z.string().max(1000).optional(),
  artistId: z.string().max(500).optional(),
  displayArtist: z.string().max(1000).optional(),
  artists: z.array(namedRefSchema).max(100).optional(),
  track: z.number().int().nonnegative().optional(),
  discNumber: z.number().int().nonnegative().optional(),
  year: z.number().int().optional(),
  releaseDate: z.string().max(100).optional(),
  genre: z.string().max(500).optional(),
  genres: z
    .array(z.object({ name: z.string().max(500) }))
    .max(100)
    .optional(),
  coverArt: z.string().max(2048).optional(),
  size: finiteNumber.nonnegative().optional(),
  contentType: z.string().max(200).optional(),
  suffix: z.string().max(50).optional(),
  duration: finiteNumber.nonnegative().optional(),
  bitRate: finiteNumber.nonnegative().optional(),
  bitDepth: finiteNumber.nonnegative().optional(),
  samplingRate: finiteNumber.nonnegative().optional(),
  channelCount: finiteNumber.nonnegative().optional(),
  path: z.string().max(4096).optional(),
  created: z.string().max(100).optional(),
  starred: z.string().max(100).optional(),
  userRating: finiteNumber.optional(),
  playCount: finiteNumber.nonnegative().optional(),
  played: z.string().max(100).optional(),
  replayGain: replayGainSchema.optional(),
  isrc: z.array(z.string().max(50)).max(100).optional(),
  musicBrainzId: z.string().max(100).optional(),
  source: z.enum(["spotify", "youtubeMusic"]).optional(),
  isAvailable: z.boolean().optional(),
  uri: z.string().max(4096).optional(),
});

export const DeviceKindSchema: z.ZodType<DeviceKind> = z.enum(["desktop", "phone", "tablet"]);

export const RemoteStateSchema: z.ZodType<RemoteState> = z.object({
  songId: z.string().min(1).max(500),
  title: z.string().max(1000),
  artist: z.string().max(1000),
  coverArt: z.string().max(2048).optional(),
  uri: z.string().max(4096).optional(),
  source: z.enum(["library", "spotify", "youtubeMusic"]).optional(),
  position: finiteNumber.nonnegative(),
  duration: finiteNumber.nonnegative(),
  playing: z.boolean(),
  volume: finiteNumber.min(0).max(1),
  updatedAt: finiteNumber.nonnegative(),
});

export const DeviceSchema: z.ZodType<Device> = z.object({
  id: z.string().min(1).max(200),
  name: z.string().min(1).max(200),
  kind: DeviceKindSchema,
  lastSeen: finiteNumber.nonnegative(),
  state: RemoteStateSchema.nullable(),
});

export const RemoteCommandSchema: z.ZodType<RemoteCommand> = z.union([
  z.object({ action: z.enum(["play", "pause", "next", "previous", "pull"]) }),
  z.object({ action: z.literal("seek"), position: finiteNumber.nonnegative() }),
  z.object({ action: z.literal("volume"), volume: finiteNumber.min(0).max(1) }),
  z.object({
    action: z.literal("transfer"),
    songs: z.array(songSchema).max(300),
    index: z.number().int().nonnegative().max(299),
    position: finiteNumber.nonnegative(),
    playing: z.boolean(),
  }),
]);

export const ClientMessageSchema: z.ZodType<ClientMessage> = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("hello"),
    device: z.object({
      id: z.string().min(1).max(200),
      name: z.string().min(1).max(200),
      kind: DeviceKindSchema,
    }),
  }),
  z.object({ type: z.literal("state"), state: RemoteStateSchema.nullable() }),
  z.object({ type: z.literal("command"), to: z.string().min(1).max(200), command: RemoteCommandSchema }),
]);

export const ServerMessageSchema: z.ZodType<ServerMessage> = z.discriminatedUnion("type", [
  z.object({ type: z.literal("devices"), devices: z.array(DeviceSchema), activeId: z.string().nullable() }),
  z.object({ type: z.literal("command"), from: z.string(), command: RemoteCommandSchema }),
]);
