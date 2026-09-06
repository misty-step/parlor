import {
  ABANDON_AFTER_MS,
  AWAY_AFTER_MS,
  HARD_DEADLINE_MS as CORE_HARD_DEADLINE_MS,
  HEARTBEAT_INTERVAL_MS,
  HOST_STALE_AFTER_MS,
  MAX_SEATS,
  ROOM_CODE_ALPHABET as CORE_ROOM_CODE_ALPHABET,
  ROOM_CODE_LENGTH as CORE_ROOM_CODE_LENGTH,
  roomCodeFromBytes,
  normalizeDisplayName as coreNormalizeDisplayName,
  parseRoomCode as coreParseRoomCode,
  selectNextHost as coreSelectNextHost,
} from "@parlor/core";

import type { GenericId } from "convex/values";
import type {
  MatchParticipant as CoreMatchParticipant,
  RoomMember as CoreRoomMember,
  TimestampMs as CoreTimestampMs,
} from "@parlor/core";
import type { ParlorCtx, ParlorMutationCtx, ParlorQueryCtx } from "./dataModel.js";
interface WebCryptoRandomSource {
  readonly getRandomValues: (bytes: Uint8Array) => Uint8Array;
}

const globalScope = globalThis as typeof globalThis & {
  readonly crypto?: WebCryptoRandomSource;
};

export type PlayerId = GenericId<"players">;
export type RoomId = GenericId<"rooms">;
export type MatchId = GenericId<"matches">;

export type ConvexQueryCtx = ParlorQueryCtx;
export type ConvexMutationCtx = ParlorMutationCtx;
export type ConvexCtx = ParlorCtx;

export type ActorKind = "authenticated" | "guest";

export interface PlayerActor {
  readonly playerId: PlayerId;
  readonly identityKey: string;
  readonly kind: ActorKind;
  readonly guestId?: string;
}

export interface PlayerDoc {
  readonly _id: PlayerId;
  readonly _creationTime: number;
  readonly identityKey: string;
  readonly kind: ActorKind;
  readonly guestId?: string;
  readonly createdAt: number;
  readonly joinAttemptWindowStartedAt?: number;
  readonly joinAttemptCount?: number;
}

export interface RoomDoc {
  readonly _id: RoomId;
  readonly _creationTime: number;
  readonly code: string;
  readonly hostPlayerId: PlayerId;
  readonly createdAt: number;
  readonly closedAt?: number;
}

export interface RoomMemberDoc {
  readonly _id: GenericId<"roomMembers">;
  readonly _creationTime: number;
  readonly roomId: RoomId;
  readonly playerId: PlayerId;
  readonly displayName: string;
  readonly seatIndex: number;
  readonly joinedAt: number;
  readonly eligibleFromCycle: number;
  readonly lastSeenAt?: number;
  readonly closedAt?: number;
}

export type MatchStatus = "active" | "completed" | "abandoned";
export type AbandonmentReason = "everyone-away" | "hard-deadline" | "host-ended";

interface MatchDocBase {
  readonly _id: MatchId;
  readonly _creationTime: number;
  readonly roomId: RoomId;
  readonly cycle: number;
  readonly startedAt: number;
}

export interface ActiveMatchDoc extends MatchDocBase {
  readonly status: "active";
}

export interface CompletedMatchDoc extends MatchDocBase {
  readonly status: "completed";
  readonly completedAt: number;
}

export interface AbandonedMatchDoc extends MatchDocBase {
  readonly status: "abandoned";
  readonly abandonedAt: number;
  readonly reason: AbandonmentReason;
}

export type MatchDoc = ActiveMatchDoc | CompletedMatchDoc | AbandonedMatchDoc;

export interface MatchParticipantDoc {
  readonly _id: GenericId<"matchParticipants">;
  readonly matchId: MatchId;
  readonly playerId: PlayerId;
  readonly seatIndex: number;
}

export const ROOM_CODE_ALPHABET = CORE_ROOM_CODE_ALPHABET;
export const ROOM_CODE_LENGTH = CORE_ROOM_CODE_LENGTH;
export const MAX_ROOM_MEMBERS = MAX_SEATS;
export const MAX_ROOM_CODE_ATTEMPTS = 16;
export const MAX_OPEN_ROOMS_PER_PLAYER = 4;
export const MAX_OPEN_MEMBERSHIPS_PER_PLAYER = 16;
export const MAX_JOIN_ATTEMPTS_PER_WINDOW = 10;
export const JOIN_ATTEMPT_WINDOW_MS = 60_000;
export const MAX_GUEST_TOKEN_LENGTH = 4096;
export const MAX_DISPLAY_NAME_CODE_POINTS = 24;
export const MIN_DISPLAY_NAME_CODE_POINTS = 1;
export const DEFAULT_HEARTBEAT_INTERVAL_MS = HEARTBEAT_INTERVAL_MS;
export const DEFAULT_AWAY_AFTER_MS = AWAY_AFTER_MS;
export const DEFAULT_HOST_STALE_AFTER_MS = HOST_STALE_AFTER_MS;
export const DEFAULT_ABANDON_AFTER_MS = ABANDON_AFTER_MS;
export const DEFAULT_HARD_DEADLINE_MS = CORE_HARD_DEADLINE_MS;
export const DEFAULT_MIN_ELIGIBLE_PLAYERS = 2;
export const DEFAULT_MAX_ELIGIBLE_PLAYERS = MAX_ROOM_MEMBERS;
export const MAX_SWEEP_BATCH = 100;

export const safeNow = (): number => {
  const now = Date.now();
  return Number.isFinite(now) && now >= 0 ? now : 0;
};

export const normalizeRoomCode = (input: string): string | null => {
  const result = coreParseRoomCode(input);
  return result.ok ? String(result.value) : null;
};

export const normalizeDisplayName = (input: string): string | null => {
  const result = coreNormalizeDisplayName(input);
  return result.ok ? String(result.value) : null;
};

export const isPresent = (
  member: Pick<RoomMemberDoc, "joinedAt" | "lastSeenAt">,
  now: number,
  presentAfterMs = DEFAULT_HEARTBEAT_INTERVAL_MS,
): boolean => {
  const evidenceAt = member.lastSeenAt ?? member.joinedAt;
  return now - evidenceAt <= presentAfterMs;
};

export const isHostStale = (
  member: Pick<RoomMemberDoc, "joinedAt" | "lastSeenAt"> | undefined,
  now: number,
  staleAfterMs = DEFAULT_HOST_STALE_AFTER_MS,
): boolean => {
  if (!member) return true;
  const evidenceAt = member.lastSeenAt ?? member.joinedAt;
  return now - evidenceAt > staleAfterMs;
};

export const selectNextHost = (input: {
  readonly members: readonly RoomMemberDoc[];
  readonly participants?: readonly MatchParticipantDoc[];
  readonly now: number;
}): RoomMemberDoc | null => {
  const result =
    input.participants === undefined
      ? coreSelectNextHost({
          members: input.members as unknown as readonly CoreRoomMember[],
          now: input.now as CoreTimestampMs,
        })
      : coreSelectNextHost({
          members: input.members as unknown as readonly CoreRoomMember[],
          participants: input.participants as unknown as readonly CoreMatchParticipant[],
          now: input.now as CoreTimestampMs,
        });
  if (!result.ok) return null;
  return (
    input.members.find((member) => String(member.playerId) === String(result.value.playerId)) ??
    null
  );
};

export const generateRoomCode = (): string => {
  const cryptoObject = globalScope.crypto;
  if (!cryptoObject?.getRandomValues) {
    throw new Error("Web Crypto is required to generate room codes");
  }
  const bytes = new Uint8Array(ROOM_CODE_LENGTH);
  cryptoObject.getRandomValues(bytes);
  const result = roomCodeFromBytes(bytes);
  if (!result.ok) throw new Error("Web Crypto returned invalid room bytes");
  return String(result.value);
};
