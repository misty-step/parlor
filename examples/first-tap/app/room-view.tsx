"use client";

import { avatarForSeat, classifyPresence, parseSeatIndex } from "@parlor/core";
import {
  AvatarBadge,
  ConnectionStatus,
  QRCodeDisplay,
  useAudio,
  useHeartbeat,
  useWakeLock,
} from "@parlor/react";
import { useConvexConnectionState, useMutation, useQuery } from "convex/react";
import { useEffect, useRef, useState } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./error-message";

type Props = {
  roomId: Id<"rooms">;
  guestToken: string;
  joinUrl: string;
  onExit: () => void;
};

export function RoomView({ roomId, guestToken, joinUrl, onExit }: Props) {
  const [busy, setBusy] = useState<"start" | "tap" | "leave" | "close" | null>(null);
  const [error, setError] = useState("");
  const [confirmClose, setConfirmClose] = useState(false);
  const [shareStatus, setShareStatus] = useState("");
  const [now, setNow] = useState(Date.now);
  const inFlight = useRef(false);
  const start = useMutation(api.game.start);
  const tap = useMutation(api.game.tap);
  const heartbeat = useMutation(api.rooms.heartbeat);
  const leaveRoom = useMutation(api.rooms.leaveRoom);
  const closeRoom = useMutation(api.rooms.closeRoom);
  const room = useQuery(api.rooms.getRoomState, busy === "leave" ? "skip" : { roomId, guestToken });
  const roomOpen = room !== undefined && room.room.closedAt === undefined;
  const latest = useQuery(
    api.game.latest,
    roomOpen && busy !== "leave" ? { roomId, guestToken } : "skip",
  );
  const active = room?.activeMatch ?? null;
  const playing =
    room !== undefined && active !== null && active.participantIds.includes(room.viewerPlayerId);
  const connection = useConvexConnectionState();
  const audio = useAudio();
  const presence = useHeartbeat({
    enabled: roomOpen && busy !== "leave",
    send: async () => {
      // Heartbeat's transport contract is Promise<void>, not the mutation result.
      await heartbeat({ roomId, guestToken });
    },
  });
  const wakeLock = useWakeLock({ enabled: roomOpen && playing });

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  async function run(operation: Exclude<typeof busy, null>, action: () => Promise<unknown>) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(operation);
    setError("");
    try {
      await action();
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  if (busy === "leave") {
    return (
      <section className="panel" aria-busy="true">
        <p role="status">Leaving room…</p>
      </section>
    );
  }
  if (!room || (roomOpen && latest === undefined)) {
    return (
      <section className="panel" aria-busy="true">
        <p role="status">Loading the room and match…</p>
        <ConnectionStatus status={connection.isWebSocketConnected ? "connected" : "connecting"} />
      </section>
    );
  }

  const host = room.room.hostPlayerId === room.viewerPlayerId;
  const viewer = room.members.find((member) => member.playerId === room.viewerPlayerId);
  const presentCount = room.members.reduce(
    (count, member) => count + Number(classifyPresence(member, now) === "present"),
    0,
  );

  return (
    <div className="room-stack">
      <section className="panel" aria-labelledby="room-heading">
        <header className="room-header">
          <h2 id="room-heading">
            Room <span className="room-code">{room.room.code}</span>
          </h2>
          <ConnectionStatus status={connection.isWebSocketConnected ? "connected" : "connecting"} />
        </header>
        {presence.status === "degraded" && (
          <p className="error" role="status">
            Presence could not be updated. Check your connection or renew guest access below.
          </p>
        )}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}

        {!roomOpen ? (
          <section className="match-state" aria-labelledby="closed-heading">
            <h3 id="closed-heading">This room is closed</h3>
            <p role="status">
              The game has ended for everyone. Any unfinished match was abandoned.
            </p>
            <button type="button" onClick={onExit}>
              Return to lobby
            </button>
          </section>
        ) : (
          <>
            <section
              className="match-state"
              aria-labelledby="match-heading"
              aria-busy={busy === "start" || busy === "tap"}
            >
              {active ? (
                <>
                  <p className="match-number">Match {active.cycle}</p>
                  <h3 id="match-heading">
                    {playing ? "First tap wins" : "You’re watching this match"}
                  </h3>
                  {playing ? (
                    <button
                      type="button"
                      className="tap-button"
                      disabled={busy !== null || !connection.isWebSocketConnected}
                      onClick={() => {
                        audio.play("tap");
                        void run("tap", async () => {
                          await tap({ roomId, matchId: active.id, guestToken });
                          audio.play("win");
                        });
                      }}
                    >
                      {busy === "tap" ? "Tap sent…" : "Tap to win"}
                    </button>
                  ) : (
                    <p role="status">
                      The roster was frozen before you joined. Keep this window visible to play in
                      the next match.
                    </p>
                  )}
                  {!connection.isWebSocketConnected && (
                    <p role="status">Reconnecting. Wait for the live connection before tapping.</p>
                  )}
                </>
              ) : latest?.winner ? (
                <>
                  <p className="match-number">Match {latest.cycle} finished</p>
                  <h3 id="match-heading" className="winner" role="status">
                    {latest.winner.displayName} wins
                  </h3>
                  <p>Their tap was the first eligible one accepted by the server.</p>
                </>
              ) : latest?.status === "abandoned" ? (
                <>
                  <h3 id="match-heading">Match {latest.cycle} ended without a winner</h3>
                  <p role="status">
                    {latest.reason === "hard-deadline"
                      ? "The match reached its 30-minute limit."
                      : latest.reason === "everyone-away"
                        ? "Every player left or was away too long."
                        : "The host ended the match."}
                  </p>
                </>
              ) : (
                <>
                  <h3 id="match-heading">Ready when you are</h3>
                  <p>
                    Once the host starts, tap the big button. The first eligible tap accepted by the
                    server wins.
                  </p>
                </>
              )}
              {!active &&
                (host ? (
                  <>
                    <button
                      type="button"
                      disabled={
                        busy !== null || presentCount < 2 || !connection.isWebSocketConnected
                      }
                      onClick={() => {
                        void run("start", async () => {
                          await heartbeat({ roomId, guestToken });
                          await start({ roomId, guestToken });
                          audio.play("start");
                        });
                      }}
                    >
                      {busy === "start" ? "Starting…" : latest ? "Start rematch" : "Start match"}
                    </button>
                    {presentCount < 2 && (
                      <p role="status">
                        Waiting for at least two present players. Keep both windows visible.
                      </p>
                    )}
                  </>
                ) : (
                  <p role="status">
                    Waiting for the host to {latest ? "start the rematch" : "start the match"}. Keep
                    this window visible.
                  </p>
                ))}
              {playing && wakeLock.status === "unsupported" && (
                <p className="hint">Your browser cannot keep the screen awake automatically.</p>
              )}
              {playing && (wakeLock.status === "released" || wakeLock.status === "unavailable") && (
                <button
                  type="button"
                  className="secondary"
                  onClick={() => {
                    void wakeLock.start();
                  }}
                >
                  Keep screen awake
                </button>
              )}
            </section>
          </>
        )}

        <section className="roster" aria-labelledby="players-heading">
          <h3 id="players-heading">
            Players <span className="hint">{room.members.length}/12</span>
          </h3>
          <ul>
            {room.members.map((member) => {
              const seat = parseSeatIndex(member.seatIndex);
              const isYou = member.playerId === room.viewerPlayerId;
              const isPlaying = active?.participantIds.includes(member.playerId);
              return (
                <li key={member.playerId}>
                  {seat.ok && (
                    <AvatarBadge
                      descriptor={avatarForSeat(seat.value)}
                      name={member.displayName}
                      decorative
                      size="small"
                    />
                  )}
                  <span className="player-name">
                    {member.displayName}
                    {isYou ? " (you)" : ""}
                  </span>
                  <span className="player-role">
                    {member.isHost ? "Host" : `Seat ${member.seatIndex + 1}`}
                    {roomOpen &&
                      (active
                        ? isPlaying
                          ? " · Playing"
                          : " · Watching"
                        : classifyPresence(member, now) !== "present"
                          ? " · Away"
                          : " · Present")}
                  </span>
                </li>
              );
            })}
          </ul>
          <details className="identity-details">
            <summary>Your player and seat</summary>
            <p>
              Player ID <code className="player-id">{room.viewerPlayerId}</code>
            </p>
            {viewer && (
              <p>
                You occupy seat {viewer.seatIndex + 1}. Refresh and rejoin this code in the same
                browser to resume it.
              </p>
            )}
          </details>
        </section>

        {roomOpen && (
          <section className="room-controls" aria-label="Room controls">
            <div className="button-row">
              <button
                type="button"
                className="secondary"
                disabled={busy !== null}
                onClick={() => {
                  void run("leave", async () => {
                    await leaveRoom({ roomId, guestToken });
                    audio.play("leave");
                    onExit();
                  });
                }}
              >
                Leave room
              </button>
              {host && (
                <button
                  type="button"
                  className="danger secondary"
                  disabled={busy !== null}
                  onClick={() => setConfirmClose(true)}
                >
                  Close room
                </button>
              )}
            </div>
            {host && (
              <p className="hint">
                Leaving hands hosting to another eligible player. Closing ends the room for
                everyone.
              </p>
            )}
            {host && confirmClose && (
              <section className="close-confirmation" aria-labelledby="close-heading">
                <h3 id="close-heading">Close this room for everyone?</h3>
                <p>Any unfinished match will end without a winner. This cannot be undone.</p>
                <div className="button-row">
                  <button
                    type="button"
                    className="danger"
                    disabled={busy !== null}
                    onClick={() => {
                      void run("close", async () => {
                        await closeRoom({ roomId, guestToken });
                        setConfirmClose(false);
                      });
                    }}
                  >
                    {busy === "close" ? "Closing…" : "Close for everyone"}
                  </button>
                  <button
                    type="button"
                    className="secondary"
                    disabled={busy !== null}
                    onClick={() => setConfirmClose(false)}
                  >
                    Keep room open
                  </button>
                </div>
              </section>
            )}
          </section>
        )}
      </section>

      {roomOpen && joinUrl && (
        <details className="panel share-room">
          <summary>Invite another player</summary>
          <div className="share-content">
            <QRCodeDisplay
              value={joinUrl}
              label="Join this room"
              caption={`Room ${room.room.code}`}
            />
            <div>
              <label htmlFor="join-url">Room link</label>
              <input
                id="join-url"
                value={joinUrl}
                readOnly
                onFocus={(event) => event.currentTarget.select()}
              />
              <button
                type="button"
                className="secondary"
                onClick={() => {
                  void (async () => {
                    try {
                      await navigator.clipboard.writeText(joinUrl);
                      setShareStatus("Room link copied.");
                      audio.play("copy");
                    } catch {
                      setShareStatus(
                        "Copy is unavailable. Select the room link and copy it manually.",
                      );
                    }
                  })();
                }}
              >
                Copy room link
              </button>
              {shareStatus && <p role="status">{shareStatus}</p>}
              <p className="hint">
                A localhost link only works on this computer. Playing on phones needs a reachable
                HTTPS deployment and matching issuer configuration.
              </p>
            </div>
          </div>
        </details>
      )}
    </div>
  );
}
