import { Suspense } from "react";
import { Geist, Geist_Mono } from "next/font/google";
import type { Metadata, Viewport } from "next";
import "./globals.css";
import { Shell } from "@/components/shell";
import { PrivacyProvider } from "@/components/privacy";
import { TooltipProvider } from "@/components/ui/tooltip";
import { ThemeProvider } from "@/components/theme";
import { THEME_INIT_SCRIPT } from "@/lib/theme";

/**
 * Geist: a crisp, neutral sans with true tabular figures, so columns of P&L line up.
 * It is used everywhere (UI, reports, notes); Geist Mono covers code and identifiers.
 */
const sansFont = Geist({
  subsets: ["latin"],
  variable: "--font-geist-sans",
  display: "swap",
});
const monoFont = Geist_Mono({
  subsets: ["latin"],
  variable: "--font-geist-mono",
  display: "swap",
});

export const metadata: Metadata = {
  title: "Trade Journal",
  icons: { icon: [{ url: "/icon.svg", type: "image/svg+xml" }] },
  description:
    "The open-source trade journal — broker sync, deep analytics, daily journaling, and AI-native reflection. Self-hosted, free forever.",
};

/** viewport-fit=cover lets the page use the full screen on notched phones; the CSS adds safe-area padding. */
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#04060f" },
    { media: "(prefers-color-scheme: light)", color: "#f3f5fc" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className="dark" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
      </head>
      <body className={`min-h-screen font-sans antialiased ${sansFont.variable} ${monoFont.variable}`}>
        <TooltipProvider delayDuration={350} skipDelayDuration={150}>
          <Suspense>
            <ThemeProvider>
              <PrivacyProvider>
                <Shell>{children}</Shell>
              </PrivacyProvider>
            </ThemeProvider>
          </Suspense>
        </TooltipProvider>
      </body>
    </html>
  );
}
