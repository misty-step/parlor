"use client";

import { AudioProvider } from "@parlor/react";
import { ConvexProvider, ConvexReactClient } from "convex/react";
import { useState, type ReactNode } from "react";

export function Providers({ children }: { children: ReactNode }) {
  const [client] = useState(() => {
    const url = process.env["NEXT_PUBLIC_CONVEX_URL"];
    return url ? new ConvexReactClient(url) : null;
  });
  if (!client) {
    return (
      <main className="shell">
        <h1>First Tap</h1>
        <section className="panel" role="alert">
          <h2>Connect the backend first</h2>
          <p>
            Run <code>pnpm --filter @parlor/first-tap dev:backend</code> and choose a development
            backend.
          </p>
          <p>
            Then run <code>pnpm --filter @parlor/first-tap run setup</code> and restart this web
            server. Convex must write <code>NEXT_PUBLIC_CONVEX_URL</code> to this example’s{" "}
            <code>.env.local</code>.
          </p>
        </section>
      </main>
    );
  }
  return (
    <ConvexProvider client={client}>
      <AudioProvider>{children}</AudioProvider>
    </ConvexProvider>
  );
}
