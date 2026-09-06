import { useMemo, useState } from "react";
import { avatarForSeat, type AvatarDescriptor, type SeatIndex } from "@parlor/core";
import {
  ACTION_HINTS,
  ACTION_LABELS,
  ACTION_SEQUENCE,
  MAX_SEATS,
  applyLifecycleAction,
  createInitialLifecycle,
  getActiveMatch,
  getActiveParticipants,
  getCompletedStepCount,
  getCurrentCycle,
  getCurrentHost,
  getMember,
  getNextAction,
  getStage,
  isMemberStale,
  type LifecycleAction,
  type LifecycleStage,
  type LifecycleState,
  type RoomMember,
} from "./lifecycle";
import type { CSSProperties } from "react";
import "./styles.css";

const SEAT_POSITIONS = [
  { left: "50%", top: "-3%" },
  { left: "68%", top: "1%" },
  { left: "85%", top: "16%" },
  { left: "98%", top: "39%" },
  { left: "95%", top: "66%" },
  { left: "79%", top: "88%" },
  { left: "62%", top: "101%" },
  { left: "38%", top: "101%" },
  { left: "21%", top: "88%" },
  { left: "5%", top: "66%" },
  { left: "2%", top: "39%" },
  { left: "15%", top: "16%" },
] as const;

const STAGE_LABELS: Record<LifecycleStage, string> = {
  empty: "Waiting for a room",
  "room-ready": "Room is open",
  "cycle-one-ready": "Ready for cycle one",
  "cycle-one-active": "Cycle one is active",
  "spectator-queued": "Spectator is queued",
  "host-stale": "Host migration needed",
  "host-migrated": "Host migrated",
  "cycle-one-complete": "Cycle one is complete",
  "cycle-two-active": "Cycle two is active",
  complete: "Rehearsal complete",
};

const STAGE_DESCRIPTIONS: Record<LifecycleStage, string> = {
  empty: "Set the room in motion with one deterministic opening move.",
  "room-ready": "Ari is hosting. Add one more player to make the first table possible.",
  "cycle-one-ready": "The room has two eligible players. Snapshot them into cycle one.",
  "cycle-one-active": "The first envelope is active. A late arrival can wait without changing it.",
  "spectator-queued": "The current table stays fixed while Cal waits for the next cycle.",
  "host-stale": "Ari is past the stale threshold. Choose a fresh participant as host.",
  "host-migrated": "Bea now hosts the active envelope. Finish cycle one to rematch.",
  "cycle-one-complete": "The first envelope is complete. Begin again without resetting the room.",
  "cycle-two-active": "The new envelope includes Cal: the queued spectator has joined the table.",
  complete: "Every move in the proving sequence is complete.",
};

export function App() {
  const [state, setState] = useState<LifecycleState>(() => createInitialLifecycle());
  const [liveMessage, setLiveMessage] = useState("The room is waiting for its first move.");
  const stage = getStage(state);
  const nextAction = getNextAction(state);
  const activeMatch = getActiveMatch(state);
  const currentHost = getCurrentHost(state);
  const activeParticipants = getActiveParticipants(state);
  const spectator = getMember(state, "player-spectator");
  const completedSteps = getCompletedStepCount(state);
  const cycle = activeMatch?.cycle ?? getCurrentCycle(state);
  const participantIds = useMemo(
    () => new Set(activeParticipants.map((participant) => participant.playerId)),
    [activeParticipants],
  );

  function handleAction(action: LifecycleAction) {
    const result = applyLifecycleAction(state, action);
    setState(result.state);
    if (result.ok) {
      const latestEvent = result.state.events[result.state.events.length - 1];
      setLiveMessage(latestEvent?.detail ?? `${ACTION_LABELS[action]} complete.`);
    } else {
      setLiveMessage(result.error.message);
    }
  }

  return (
    <div className="app-shell" data-testid="playground">
      <header className="site-header">
        <div className="header-copy">
          <p className="wordmark">Parlor</p>
          <h1>A room with a next move.</h1>
          <p className="intro-copy">
            A deterministic tabletop for seeing a party-room lifecycle settle into place, one
            deliberate action at a time.
          </p>
        </div>
        <div className="rehearsal-stamp" aria-label="Local lifecycle rehearsal">
          <span className="stamp-dot" aria-hidden="true" />
          <span>Local rehearsal</span>
        </div>
      </header>

      <main className="workspace">
        <section className="table-panel" aria-labelledby="table-heading">
          <div className="room-ribbon">
            <div>
              <p className="section-kicker">Room code</p>
              <p className="room-code" data-testid="room-code">
                {state.room?.code ?? "----"}
              </p>
            </div>
            <div className="room-facts">
              <p>
                <span className="fact-label">Cycle</span>
                <strong data-testid="cycle-number">{cycle === 0 ? "—" : cycle}</strong>
              </p>
              <p>
                <span className="fact-label">Host</span>
                <strong data-testid="current-host">{currentHost?.displayName ?? "—"}</strong>
              </p>
            </div>
          </div>

          <div className="table-heading-row">
            <div>
              <p className="section-kicker">The table</p>
              <h2 id="table-heading">One room, twelve seats</h2>
            </div>
            <span className={`stage-pill stage-pill--${stage}`} data-testid="room-stage">
              {STAGE_LABELS[stage]}
            </span>
          </div>

          <div
            className="table-stage"
            data-testid="table-stage"
            aria-label={`Parlor table, ${activeParticipants.length} of ${MAX_SEATS} seats occupied`}
          >
            <div className="oval-table" data-testid="table">
              <div className="table-inlay" aria-hidden="true" />
              {SEAT_POSITIONS.map((position, index) => {
                const participant = activeParticipants.find(
                  (candidate) => candidate.seatIndex === index,
                );
                const occupant =
                  participant === undefined ? undefined : getMember(state, participant.playerId);
                const descriptor = avatarForSeat(index as SeatIndex);
                return (
                  <div
                    className={`seat-slot${occupant === undefined ? "" : " seat-slot--occupied"}`}
                    data-testid={`seat-${index + 1}`}
                    key={`seat-${index + 1}`}
                    style={
                      {
                        "--seat-left": position.left,
                        "--seat-top": position.top,
                      } as CSSProperties
                    }
                    aria-label={
                      occupant === undefined
                        ? `Seat ${index + 1}, open`
                        : `Seat ${index + 1}, ${occupant.displayName}`
                    }
                  >
                    {occupant === undefined ? (
                      <span className="open-seat" aria-hidden="true">
                        {index + 1}
                      </span>
                    ) : (
                      <PlayerToken
                        descriptor={descriptor}
                        member={occupant}
                        arrived={
                          occupant.playerId === "player-spectator" && activeMatch?.cycle === 2
                        }
                        stale={isMemberStale(state, occupant)}
                      />
                    )}
                  </div>
                );
              })}
              <div className="table-center" data-testid="match-status">
                <span className="table-center-mark" aria-hidden="true">
                  ◌
                </span>
                <strong>{activeMatch ? `Cycle ${activeMatch.cycle}` : "Open table"}</strong>
                <span>{activeMatch ? "Envelope active" : STAGE_LABELS[stage]}</span>
              </div>
            </div>
          </div>

          <div className="table-caption">
            <p>{STAGE_DESCRIPTIONS[stage]}</p>
            <div className="table-legend" aria-label="Seat legend">
              <span>
                <i className="legend-swatch legend-swatch--occupied" aria-hidden="true" /> On table
              </span>
              <span>
                <i className="legend-swatch legend-swatch--open" aria-hidden="true" /> Open seat
              </span>
            </div>
          </div>

          {spectator !== undefined && (
            <div
              className={`spectator-transfer ${
                activeMatch?.cycle === 2 && participantIds.has(spectator.playerId)
                  ? "spectator-transfer--seated"
                  : "spectator-transfer--queued"
              }`}
              data-testid="queued-spectator"
              data-state={
                activeMatch?.cycle === 2 && participantIds.has(spectator.playerId)
                  ? "seated"
                  : "queued"
              }
            >
              <span className="transfer-glyph" aria-hidden="true">
                {activeMatch?.cycle === 2 && participantIds.has(spectator.playerId) ? "↗" : "→"}
              </span>
              <div>
                <strong>{spectator.displayName}</strong>
                <span>
                  {activeMatch?.cycle === 2 && participantIds.has(spectator.playerId)
                    ? "Moved from the queue to seat three"
                    : `Queued for cycle ${spectator.eligibleFromCycle}`}
                </span>
              </div>
            </div>
          )}
        </section>

        <section className="action-panel" aria-labelledby="actions-heading">
          <div className="panel-heading">
            <div>
              <p className="section-kicker">Operator controls</p>
              <h2 id="actions-heading">Make the next move</h2>
            </div>
            <span className="progress-count" data-testid="scenario-progress">
              {completedSteps}/{ACTION_SEQUENCE.length}
            </span>
          </div>
          <p className="action-lede" data-testid="next-action">
            {nextAction === null
              ? "The full lifecycle is visible above."
              : `Next: ${ACTION_LABELS[nextAction]}.`}
          </p>
          <p className="live-message" aria-live="polite" data-testid="action-message">
            {liveMessage}
          </p>
          {state.lastError !== null && (
            <div className="failure-message" role="alert" data-testid="lifecycle-error">
              <strong>Action held.</strong>
              <span>{state.lastError.message}</span>
              {state.lastError.nextAction !== null && (
                <span>
                  Try <b>{ACTION_LABELS[state.lastError.nextAction]}</b> next.
                </span>
              )}
            </div>
          )}
          <div className="action-list">
            {ACTION_SEQUENCE.map((action, index) => {
              const isNext = action === nextAction;
              const isComplete = index < completedSteps;
              return (
                <div className="action-row" data-testid={`action-${action}`} key={action}>
                  <span className={`action-index${isComplete ? " action-index--complete" : ""}`}>
                    {isComplete ? "✓" : String(index + 1).padStart(2, "0")}
                  </span>
                  <div className="action-copy">
                    <strong>{ACTION_LABELS[action]}</strong>
                    <span>{ACTION_HINTS[action]}</span>
                  </div>
                  <button
                    className={`action-button${isNext ? " action-button--next" : ""}`}
                    data-testid={action}
                    onClick={() => handleAction(action)}
                    type="button"
                    aria-label={`${ACTION_LABELS[action]}: ${ACTION_HINTS[action]}`}
                  >
                    {isComplete ? "Done" : isNext ? "Run" : "Try"}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        <aside className="ledger-panel" aria-labelledby="ledger-heading" data-testid="event-ledger">
          <div className="panel-heading ledger-heading">
            <div>
              <p className="section-kicker">A visible trail</p>
              <h2 id="ledger-heading">Event ledger</h2>
            </div>
            <span className="ledger-count">{state.events.length} moves</span>
          </div>
          <p className="ledger-intro">
            Each successful decision leaves one plain-language mark. Failed moves stay visible above
            the controls instead of changing the room.
          </p>
          {state.events.length === 0 ? (
            <div className="ledger-empty">
              <span className="ledger-empty-mark" aria-hidden="true">
                ·
              </span>
              <p>The ledger will start when the room opens.</p>
            </div>
          ) : (
            <ol className="event-list">
              {state.events.map((event, index) => (
                <li className="event-item" data-testid={`event-${event.action}`} key={event.id}>
                  <span className="event-line" aria-hidden="true" />
                  <div className="event-number">{String(index + 1).padStart(2, "0")}</div>
                  <div className="event-copy">
                    <strong>{event.title}</strong>
                    <span>{event.detail}</span>
                  </div>
                </li>
              ))}
            </ol>
          )}
          <div className="ledger-footer">
            <span className={`status-dot status-dot--${activeMatch ? "active" : "quiet"}`} />
            <span data-testid="envelope-status">
              {activeMatch ? `Envelope ${activeMatch.id} active` : "No active envelope"}
            </span>
          </div>
        </aside>
      </main>
    </div>
  );
}

type PlayerTokenProps = {
  readonly descriptor: AvatarDescriptor;
  readonly member: RoomMember;
  readonly arrived: boolean;
  readonly stale: boolean;
};

function PlayerToken({ descriptor, member, arrived, stale }: PlayerTokenProps) {
  return (
    <span
      className={`player-token player-token--${descriptor.shape}${arrived ? " player-token--arrived" : ""}${
        stale ? " player-token--stale" : ""
      }`}
      style={
        {
          "--avatar-bg": descriptor.background,
          "--avatar-fg": descriptor.foreground,
        } as CSSProperties
      }
      data-avatar-key={descriptor.key}
      data-player-id={member.playerId}
      data-shape={descriptor.shape}
      data-testid={`player-${member.playerId.slice("player-".length)}`}
      title={`${member.displayName}${stale ? " (stale)" : ""}`}
    >
      <span className="player-avatar" aria-hidden="true">
        {member.displayName.slice(0, 1)}
      </span>
      <span className="player-name">{member.displayName}</span>
      {stale && <span className="stale-flag">away</span>}
    </span>
  );
}
