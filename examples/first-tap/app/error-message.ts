import { ConvexError } from "convex/values";

const messages: Record<string, string> = {
  INVALID_DISPLAY_NAME: "Use a name between 1 and 24 characters.",
  INVALID_ROOM_CODE: "Enter the four-character room code shown by your host.",
  ROOM_NOT_OPEN: "That room is not open. Check the code or ask the host to create a new room.",
  ROOM_NOT_FOUND: "This room no longer exists. Return to the lobby to create or join another.",
  ROOM_CLOSED: "The host has closed this room. Return to the lobby to play again.",
  ROOM_FULL:
    "This room already has 12 players. Join a different room or wait for someone to leave.",
  ROOM_JOIN_RATE_LIMIT:
    "Too many recent joins or open rooms. Leave unused rooms and wait a minute before trying again.",
  ROOM_CREATION_RATE_LIMIT:
    "You have too many open rooms. Close or leave an unused room before creating another.",
  ROOM_CODE_EXHAUSTED: "A room code could not be allocated right now. Try creating the room again.",
  ROOM_DATA_INVALID:
    "The room data is inconsistent. Check this development backend's data before continuing.",
  MATCH_DATA_INVALID:
    "The match history is inconsistent. Check this development backend's data before continuing.",
  NOT_A_ROOM_MEMBER: "You are no longer a member of this room. Return to the lobby and join again.",
  HOST_REQUIRED:
    "Only the current host can do that. Check who is marked as host in the player list.",
  MATCH_ALREADY_ACTIVE: "A match is already running. Finish it before starting the next one.",
  MATCH_NOT_ACTIVE:
    "That match has already ended or expired. Check the result before the next match.",
  MATCH_PARTICIPANT_REQUIRED:
    "You are watching this match. Stay here and keep this window visible to join the next one.",
  NOT_ENOUGH_PRESENT_PLAYERS:
    "At least two players must be present. Keep both windows visible, then try starting again.",
  TOO_MANY_PRESENT_PLAYERS:
    "Only 12 players can play one match. Ask an extra player to leave, then try again.",
  UNAUTHENTICATED:
    "Guest access was not accepted. Renew guest access; if this persists, check that the web server and Convex use the same access keys and audience.",
  PLAYER_NOT_FOUND:
    "Your player could not be found. Return to the lobby and join again with this browser.",
  GAME_NOT_FOUND: "This match has no First Tap game data. Close the room and create a new one.",
  GUEST_ISSUER_UNCONFIGURED:
    "The guest issuer is not configured. Finish setup and restart the web development server.",
  GUEST_ISSUER_UNAVAILABLE:
    "Guest access is unavailable. Check the web server and your connection, then retry.",
  INVALID_GUEST_RESPONSE:
    "The guest issuer returned unusable access. Check the web server, then retry.",
  SAME_ORIGIN_REQUIRED:
    "Use http://localhost:3000 for this local example, not 127.0.0.1 or a different port.",
  GUEST_CONTINUITY_REQUIRED:
    "This browser's identity cookie is missing. Existing access cannot recover the seat without it. Do not clear site data if you want to preserve your identity.",
  GUEST_CONTINUITY_INVALID:
    "This browser's identity cookie is invalid or expired. Retrying will not create a different guest. Recover the original server configuration if it changed; clearing site data deliberately starts a new identity.",
};

export function errorMessage(error: unknown): string {
  const data: unknown = error instanceof ConvexError ? error.data : null;
  const code =
    typeof data === "object" && data !== null && "code" in data && typeof data.code === "string"
      ? data.code
      : error instanceof Error
        ? error.message
        : "";
  // Never show raw transport errors, request arguments or credential material.
  return (
    messages[code] ?? "The request could not be completed. Check your connection and try again."
  );
}
