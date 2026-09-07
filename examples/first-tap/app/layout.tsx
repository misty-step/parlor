import type { Metadata } from "next";
import type { ReactNode } from "react";
import "@parlor/react/styles.css";
import "./globals.css";
import { Providers } from "./providers";

export const metadata: Metadata = {
  title: "First Tap · Parlor example",
  description: "A real multiplayer room, a frozen roster, and one server-accepted winning tap.",
  robots: { index: false, follow: false },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
