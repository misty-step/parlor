// @vitest-environment happy-dom

import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import { useGuestCredential, useHeartbeat, useWakeLock } from "../src/index.js";

const testClock = () => 1_000;

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (error: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return { promise, resolve, reject };
}

describe("useHeartbeat", () => {
  it("stops timers and visibility listeners when the hook unmounts", () => {
    const send = vi.fn();
    const removeEventListener = vi.fn();
    const documentRef = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener,
    };
    const scheduler = {
      setTimeout: vi.fn(() => 1),
      clearTimeout: vi.fn(),
    };

    const { result, unmount } = renderHook(() =>
      useHeartbeat({ send, document: documentRef, scheduler, intervalMs: 1000 }),
    );

    expect(result.current.status).toBe("running");
    expect(send).toHaveBeenCalledTimes(1);
    unmount();

    expect(scheduler.clearTimeout).toHaveBeenCalledWith(1);
    expect(removeEventListener).toHaveBeenCalledWith("visibilitychange", expect.any(Function));
  });
});

describe("useWakeLock", () => {
  it("releases the browser lock when the hook unmounts", async () => {
    const release = vi.fn(() => Promise.resolve());
    const sentinel = {
      released: false,
      release,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };
    const request = vi.fn(() => Promise.resolve(sentinel));
    const navigatorRef = { wakeLock: { request } };
    const documentRef = {
      hidden: false,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    };

    const { result, unmount } = renderHook(() =>
      useWakeLock({ navigator: navigatorRef, document: documentRef }),
    );
    await act(async () => {
      await result.current.start();
    });

    expect(request).toHaveBeenCalledWith("screen");
    expect(result.current.status).toBe("active");
    unmount();
    await act(async () => {
      await Promise.resolve();
    });

    expect(release).toHaveBeenCalledTimes(1);
  });
});

describe("useGuestCredential", () => {
  it("acquires and clears only the opaque credential value", async () => {
    let stored: string | null = null;
    const storage = {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => {
        stored = value;
      }),
      removeItem: vi.fn(() => {
        stored = null;
      }),
    };
    const issuer = vi.fn(async () => ({ token: "opaque-guest-value", expiresAt: 10_000 }));
    const { result } = renderHook(() => useGuestCredential({ storage, issuer, clock: testClock }));

    await act(async () => {
      await result.current.acquire();
    });

    expect(result.current.credential).toBe("opaque-guest-value");
    act(() => {
      result.current.clear();
    });
    expect(result.current.credential).toBeNull();
    expect(storage.removeItem).toHaveBeenCalledTimes(1);
  });

  it("ignores a cancelled acquire while a replacement remains pending", async () => {
    let stored: string | null = null;
    const storage = {
      getItem: vi.fn(() => stored),
      setItem: vi.fn((_key: string, value: string) => {
        stored = value;
      }),
      removeItem: vi.fn(() => {
        stored = null;
      }),
    };
    const stale = deferred<{ token: string; expiresAt: number }>();
    const replacement = deferred<{ token: string; expiresAt: number }>();
    const issuer = vi
      .fn<() => Promise<{ token: string; expiresAt: number }>>()
      .mockImplementationOnce(() => stale.promise)
      .mockImplementationOnce(() => replacement.promise);
    const { result } = renderHook(() => useGuestCredential({ storage, issuer, clock: testClock }));

    let staleAcquisition!: Promise<unknown>;
    act(() => {
      staleAcquisition = result.current.acquire();
    });
    act(() => {
      result.current.clear();
    });
    expect(result.current.credential).toBeNull();
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();

    let replacementAcquisition!: Promise<unknown>;
    act(() => {
      replacementAcquisition = result.current.acquire();
    });
    expect(result.current.loading).toBe(true);

    await act(async () => {
      stale.resolve({ token: "stale-token", expiresAt: 10_000 });
      await expect(staleAcquisition).rejects.toMatchObject({ code: "cancelled" });
    });
    expect(result.current.credential).toBeNull();
    expect(result.current.loading).toBe(true);
    expect(result.current.error).toBeNull();
    expect(stored).toBeNull();

    await act(async () => {
      replacement.resolve({ token: "fresh-token", expiresAt: 10_000 });
      await expect(replacementAcquisition).resolves.toBe("fresh-token");
    });
    expect(result.current.credential).toBe("fresh-token");
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });
});

describe("useGuestCredential store identity", () => {
  it("does not expose a prior store credential when dependencies change", async () => {
    const firstStorage = {
      getItem: vi.fn(() => null),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const secondStorage = {
      getItem: vi.fn(() => JSON.stringify({ token: "token-two", expiresAt: 10_000 })),
      setItem: vi.fn(),
      removeItem: vi.fn(),
    };
    const firstIssuer = vi.fn(async () => ({ token: "token-one", expiresAt: 10_000 }));
    const secondIssuer = vi.fn(async () => ({ token: "token-three", expiresAt: 10_000 }));
    type Props = {
      storage: typeof firstStorage;
      key: string;
      issuer: typeof firstIssuer;
    };
    const { result, rerender } = renderHook(
      (props: Props) =>
        useGuestCredential({
          ...props,
          autoAcquire: true,
          clock: testClock,
        }),
      {
        initialProps: {
          storage: firstStorage,
          key: "first",
          issuer: firstIssuer,
        },
      },
    );

    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.credential).toBe("token-one");

    rerender({
      storage: secondStorage,
      key: "second",
      issuer: secondIssuer,
    });
    expect(result.current.credential).not.toBe("token-one");
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.credential).toBe("token-two");
  });
});
