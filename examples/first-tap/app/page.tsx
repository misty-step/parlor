"use client";

import { normalizeDisplayName } from "@parlor/core";
import { RoomCodeInput, normalizeRoomCode, useAudio, useGuestCredential } from "@parlor/react";
import { useMutation } from "convex/react";
import { useRef, useState, useSyncExternalStore } from "react";
import { api } from "../convex/_generated/api";
import type { Id } from "../convex/_generated/dataModel";
import { errorMessage } from "./error-message";
import { issueGuest } from "./guest-issuer";
import { RoomBoundary } from "./room-boundary";
import { RoomView } from "./room-view";

function subscribeToNavigation(notify: () => void) {
  window.addEventListener("popstate", notify);
  return () => window.removeEventListener("popstate", notify);
}

function subscribeToStorage(notify: () => void) {
  window.addEventListener("storage", notify);
  return () => window.removeEventListener("storage", notify);
}

function getInviteCode() {
  return normalizeRoomCode(new URLSearchParams(window.location.search).get("room") ?? "");
}

function getRememberedName() {
  try {
    return sessionStorage.getItem("first-tap:name") ?? "";
  } catch {
    return "";
  }
}

function getServerValue() {
  return "";
}

export default function Page() {
  const guest = useGuestCredential({ issuer: issueGuest, autoAcquire: true, storage: null });
  // Keep room selection outside credential-gated queries. Even an expired token
  // or failed renewal must not discard the room or manufacture a new identity.
  const [roomId, setRoomId] = useState<Id<"rooms"> | null>(null);
  const rememberedName = useSyncExternalStore(
    subscribeToStorage,
    getRememberedName,
    getServerValue,
  );
  const inviteCode = useSyncExternalStore(subscribeToNavigation, getInviteCode, getServerValue);
  const [editedName, setDisplayName] = useState<string>();
  const [editedCode, setCode] = useState<string>();
  const displayName = editedName ?? rememberedName;
  const code = editedCode ?? inviteCode;
  const [joinUrl, setJoinUrl] = useState("");
  const [busy, setBusy] = useState<"create" | "join" | null>(null);
  const [error, setError] = useState("");
  const inFlight = useRef(false);
  const createRoom = useMutation(api.rooms.createRoom);
  const joinRoom = useMutation(api.rooms.joinRoom);
  const audio = useAudio();
  const name = normalizeDisplayName(displayName);
  const entryDisabled = !guest.credential || busy !== null || !name.ok;

  async function enter(mode: "create" | "join") {
    if (inFlight.current || !guest.credential || !name.ok) return;
    inFlight.current = true;
    setBusy(mode);
    setError("");
    try {
      const args = { displayName: name.value, guestToken: guest.credential };
      const result = mode === "create" ? await createRoom(args) : await joinRoom({ ...args, code });
      if ("ok" in result && !result.ok) throw new Error(result.code);
      setRoomId(result.roomId);
      setCode(result.code);
      const url = new URL(window.location.href);
      url.search = new URLSearchParams({ room: result.code }).toString();
      url.hash = "";
      window.history.replaceState(null, "", url);
      setJoinUrl(url.toString());
      try {
        sessionStorage.setItem("first-tap:name", name.value);
      } catch {
        // Losing the remembered display name must not block joining a room.
      }
      audio.play("join");
    } catch (cause) {
      setError(errorMessage(cause));
    } finally {
      inFlight.current = false;
      setBusy(null);
    }
  }

  function exit() {
    setRoomId(null);
    setJoinUrl("");
    setCode("");
    setError("");
    const url = new URL(window.location.href);
    url.search = "";
    url.hash = "";
    window.history.replaceState(null, "", url);
  }

  return (
    <main className="shell">
      <header className="app-header">
        <div>
          <h1>First Tap</h1>
          <p>A room. Two or more players. One winning tap.</p>
        </div>
        <button
          type="button"
          className="sound-toggle secondary"
          aria-pressed={audio.enabled}
          onClick={() => {
            if (audio.toggleMuted()) audio.play("ready");
          }}
        >
          Sound {audio.enabled ? "on" : "off"}
        </button>
      </header>

      {roomId ? (
        guest.credential ? (
          <RoomBoundary credential={guest.credential} onExit={exit}>
            <RoomView
              roomId={roomId}
              guestToken={guest.credential}
              joinUrl={joinUrl}
              onExit={exit}
            />
          </RoomBoundary>
        ) : (
          <section className="panel" aria-busy={guest.loading}>
            <h2>Keeping your place</h2>
            <p role="status">
              {guest.loading
                ? "Renewing guest access…"
                : "Renew guest access below to reconnect to your selected room."}
            </p>
          </section>
        )
      ) : (
        <section className="panel lobby" aria-labelledby="lobby-heading">
          <h2 id="lobby-heading">Get everyone in the room</h2>
          <p>
            Create a room, share its code, then start when at least two players are here. No
            accounts needed.
          </p>
          {!guest.credential && (
            <p role="status">
              {guest.loading
                ? "Getting guest access…"
                : "Guest access is needed before you can join. Use the controls below to retry."}
            </p>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (code.length === 4) void enter("join");
            }}
            aria-busy={busy !== null}
          >
            <label htmlFor="display-name">Your name</label>
            <input
              id="display-name"
              name="displayName"
              autoComplete="nickname"
              value={displayName}
              maxLength={48}
              required
              disabled={busy !== null}
              aria-describedby="name-help"
              onChange={(event) => setDisplayName(event.currentTarget.value)}
            />
            <p id="name-help" className="hint">
              1–24 characters. Rejoining from this browser keeps your player and seat.
            </p>
            {displayName.trim() && !name.ok && (
              <p role="status">Use a name between 1 and 24 characters.</p>
            )}
            <button
              type="button"
              disabled={entryDisabled}
              onClick={() => {
                void enter("create");
              }}
            >
              {busy === "create" ? "Creating room…" : "Create room"}
            </button>
            <div className="join-form">
              <RoomCodeInput
                value={code}
                onChange={setCode}
                label="Room code"
                description="Ask your host for the four-character code."
                disabled={busy !== null}
                sound={audio.enabled}
              />
              <button
                type="submit"
                className="secondary"
                disabled={entryDisabled || code.length !== 4}
              >
                {busy === "join" ? "Joining room…" : "Join room"}
              </button>
            </div>
          </form>
          {error && (
            <p className="error" role="alert">
              {error}
            </p>
          )}
          <p className="hint">
            For a second player on one computer, use a separate browser profile or private window.
            Tabs in the same browser share an identity.
          </p>
        </section>
      )}

      <section className="guest-tools" aria-labelledby="guest-heading">
        <h2 id="guest-heading">Browser identity</h2>
        {guest.error !== null && (
          <p className="error" role="alert">
            {errorMessage(guest.error)}
          </p>
        )}
        <p className="hint">
          {guest.credential ? "Guest access is ready. " : "Guest access is not ready. "}
          A signed cookie preserves your player when you refresh. Access tokens stay in memory.
        </p>
        <button
          type="button"
          className="secondary"
          disabled={guest.loading}
          onClick={() => {
            // The hook retains the error and old proof; never clear identity on failure.
            const request = guest.expiresAt === null ? guest.acquire() : guest.refresh();
            void request.catch(() => {});
          }}
        >
          {guest.loading
            ? "Getting guest access…"
            : guest.credential
              ? "Renew guest access"
              : "Retry guest access"}
        </button>
      </section>
      <footer className="app-footer">
        <p>
          The first eligible tap accepted by the server wins. Network latency counts; this is not a
          physical reaction-time measurement.
        </p>
        <a href="https://github.com/misty-step/parlor/tree/master/examples/first-tap">
          View the example source
        </a>
      </footer>
    </main>
  );
}
