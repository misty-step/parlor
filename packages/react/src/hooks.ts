import {
  createGuestCredentialStore,
  createHeartbeatController,
  createWakeLockController,
  type GuestCredential,
  type GuestCredentialIssuer,
  type GuestCredentialStore,
  type GuestCredentialStoreOptions,
  type HeartbeatControllerOptions,
  type HeartbeatSnapshot,
  type WakeLockControllerOptions,
  type WakeLockSnapshot,
} from "@parlor/web";
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";

export interface UseHeartbeatOptions extends HeartbeatControllerOptions {
  /** Stop the controller when false; defaults to true. */
  enabled?: boolean;
}

export interface UseHeartbeatResult extends HeartbeatSnapshot {
  start: () => void;
  stop: () => void;
  beat: () => Promise<void>;
}

const STOPPED_HEARTBEAT: HeartbeatSnapshot = {
  status: "stopped",
  inFlight: false,
  lastBeatAt: null,
  lastFailureAt: null,
};

const heartbeatSnapshotCache = new WeakMap<object, HeartbeatSnapshot>();
const wakeLockSnapshotCache = new WeakMap<object, WakeLockSnapshot>();

function heartbeatExternalStore(controller: {
  getSnapshot: () => HeartbeatSnapshot;
  subscribe: (listener: () => void) => () => void;
}) {
  heartbeatSnapshotCache.set(controller, controller.getSnapshot());
  return {
    getSnapshot: () => heartbeatSnapshotCache.get(controller) ?? STOPPED_HEARTBEAT,
    subscribe: (listener: () => void) =>
      controller.subscribe(() => {
        heartbeatSnapshotCache.set(controller, controller.getSnapshot());
        listener();
      }),
  };
}

function wakeLockExternalStore(controller: {
  getSnapshot: () => WakeLockSnapshot;
  subscribe: (listener: () => void) => () => void;
}) {
  wakeLockSnapshotCache.set(controller, controller.getSnapshot());
  return {
    getSnapshot: () => wakeLockSnapshotCache.get(controller) ?? UNSUPPORTED_WAKE_LOCK,
    subscribe: (listener: () => void) =>
      controller.subscribe(() => {
        wakeLockSnapshotCache.set(controller, controller.getSnapshot());
        listener();
      }),
  };
}
/** Owns a visibility-aware heartbeat controller for the component lifetime. */
export function useHeartbeat(options: UseHeartbeatOptions): UseHeartbeatResult {
  const {
    enabled = true,
    send,
    document: visibilityDocument,
    scheduler,
    clock,
    intervalMs,
  } = options;
  const controller = useMemo(
    () =>
      createHeartbeatController({
        send,
        ...(visibilityDocument === undefined ? {} : { document: visibilityDocument }),
        ...(scheduler === undefined ? {} : { scheduler }),
        ...(clock === undefined ? {} : { clock }),
        ...(intervalMs === undefined ? {} : { intervalMs }),
      }),
    [clock, intervalMs, scheduler, send, visibilityDocument],
  );
  const externalStore = useMemo(() => heartbeatExternalStore(controller), [controller]);
  const snapshot = useSyncExternalStore(
    externalStore.subscribe,
    externalStore.getSnapshot,
    () => STOPPED_HEARTBEAT,
  );

  useEffect(() => {
    if (enabled) {
      controller.start();
    }
    return () => {
      controller.stop();
    };
  }, [controller, enabled]);

  const start = useCallback(() => {
    controller.start();
  }, [controller]);

  const stop = useCallback(() => {
    controller.stop();
  }, [controller]);

  const beat = useCallback(() => controller.beat(), [controller]);

  return { ...snapshot, start, stop, beat };
}

export interface UseWakeLockOptions extends WakeLockControllerOptions {
  /** Acquire the screen lock while true; defaults to true. */
  enabled?: boolean;
}

export interface UseWakeLockResult extends WakeLockSnapshot {
  start: () => Promise<void>;
  stop: () => Promise<void>;
}

const UNSUPPORTED_WAKE_LOCK: WakeLockSnapshot = { status: "unsupported" };

/** Owns progressive screen wake-lock acquisition and releases it on unmount. */
export function useWakeLock(options: UseWakeLockOptions = {}): UseWakeLockResult {
  const { enabled = true, navigator: navigatorValue, document: visibilityDocument } = options;
  const controller = useMemo(
    () =>
      createWakeLockController({
        ...(navigatorValue === undefined ? {} : { navigator: navigatorValue }),
        ...(visibilityDocument === undefined ? {} : { document: visibilityDocument }),
      }),
    [navigatorValue, visibilityDocument],
  );
  const externalStore = useMemo(() => wakeLockExternalStore(controller), [controller]);
  const snapshot = useSyncExternalStore(
    externalStore.subscribe,
    externalStore.getSnapshot,
    () => UNSUPPORTED_WAKE_LOCK,
  );

  useEffect(() => {
    if (enabled) {
      void controller.start();
    }
    return () => {
      void controller.stop();
    };
  }, [controller, enabled]);

  const start = useCallback(() => controller.start(), [controller]);
  const stop = useCallback(() => controller.stop(), [controller]);

  return { ...snapshot, start, stop };
}

export interface UseGuestCredentialOptions extends GuestCredentialStoreOptions {
  /** Acquire through the injected issuer on mount; defaults to false. */
  autoAcquire?: boolean;
}

export interface UseGuestCredentialResult {
  credential: GuestCredential | null;
  loading: boolean;
  error: unknown;
  acquire: (issuerOverride?: GuestCredentialIssuer) => Promise<GuestCredential>;
  refresh: (issuerOverride?: GuestCredentialIssuer) => Promise<GuestCredential>;
  clear: () => void;
}

interface GuestCredentialState {
  readonly store: GuestCredentialStore;
  readonly credential: GuestCredential | null;
  readonly loading: boolean;
  readonly error: unknown;
}

function readGuestCredential(
  store: GuestCredentialStore,
): Pick<GuestCredentialState, "credential" | "error"> {
  try {
    return { credential: store.get(), error: null };
  } catch (cause) {
    return { credential: null, error: cause };
  }
}

/** Keeps an opaque guest credential in the web package's storage abstraction. */
export function useGuestCredential(
  options: UseGuestCredentialOptions = {},
): UseGuestCredentialResult {
  const { autoAcquire = false, storage, key, issuer, clock } = options;
  const store = useMemo(
    () =>
      createGuestCredentialStore({
        ...(storage === undefined ? {} : { storage }),
        ...(key === undefined ? {} : { key }),
        ...(issuer === undefined ? {} : { issuer }),
        ...(clock === undefined ? {} : { clock }),
      }),
    [clock, issuer, key, storage],
  );
  const [state, setState] = useState<GuestCredentialState>(() => ({
    store,
    ...readGuestCredential(store),
    loading: false,
  }));
  const activeState =
    state.store === store
      ? state
      : {
          store,
          credential: null,
          loading: false,
          error: null,
        };
  const mountedRef = useRef(false);
  const autoAcquireStoreRef = useRef<GuestCredentialStore | null>(null);
  const operationGenerationRef = useRef(0);

  const acquire = useCallback(
    async (issuerOverride?: GuestCredentialIssuer): Promise<GuestCredential> => {
      const operationGeneration = operationGenerationRef.current;
      if (mountedRef.current) {
        setState((current) =>
          current.store === store ? { ...current, loading: true, error: null } : current,
        );
      }
      try {
        const nextCredential = await store.acquire(issuerOverride);
        if (mountedRef.current) {
          setState((current) =>
            current.store === store && operationGenerationRef.current === operationGeneration
              ? { ...current, credential: nextCredential, loading: false }
              : current,
          );
        }
        return nextCredential;
      } catch (cause) {
        if (mountedRef.current) {
          setState((current) =>
            current.store === store && operationGenerationRef.current === operationGeneration
              ? { ...current, error: cause, loading: false }
              : current,
          );
        }
        throw cause;
      }
    },
    [store],
  );

  const refresh = useCallback(
    async (issuerOverride?: GuestCredentialIssuer): Promise<GuestCredential> => {
      const operationGeneration = operationGenerationRef.current;
      if (mountedRef.current) {
        setState((current) =>
          current.store === store ? { ...current, loading: true, error: null } : current,
        );
      }
      try {
        const nextCredential = await store.refresh(issuerOverride);
        if (mountedRef.current) {
          setState((current) =>
            current.store === store && operationGenerationRef.current === operationGeneration
              ? { ...current, credential: nextCredential, loading: false }
              : current,
          );
        }
        return nextCredential;
      } catch (cause) {
        if (mountedRef.current) {
          setState((current) =>
            current.store === store && operationGenerationRef.current === operationGeneration
              ? { ...current, error: cause, loading: false }
              : current,
          );
        }
        throw cause;
      }
    },
    [store],
  );

  const clear = useCallback(() => {
    operationGenerationRef.current += 1;
    store.clear();
    if (mountedRef.current) {
      setState((current) =>
        current.store === store
          ? { ...current, credential: null, error: null, loading: false }
          : current,
      );
    }
  }, [store]);

  useEffect(() => {
    mountedRef.current = true;
    if (state.store !== store) {
      const nextState: GuestCredentialState = {
        store,
        ...readGuestCredential(store),
        loading: false,
      };
      // Synchronize the external credential store after its identity changes.
      // oxlint-disable-next-line react/set-state-in-effect -- state must follow the external store boundary
      setState(nextState);
      return () => {
        mountedRef.current = false;
      };
    }
    if (autoAcquire && autoAcquireStoreRef.current !== store) {
      autoAcquireStoreRef.current = store;
      void Promise.resolve()
        .then(() => acquire())
        .catch(() => {
          // The rejected promise is represented through the hook's error state.
        });
    }
    return () => {
      mountedRef.current = false;
    };
  }, [acquire, autoAcquire, state.store, store]);

  return {
    credential: activeState.credential,
    loading: activeState.loading,
    error: activeState.error,
    acquire,
    refresh,
    clear,
  };
}
