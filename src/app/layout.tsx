import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "ME2 CHAT-SWARM v1.0.0 — живой рой чат-агентов",
  description:
    "Рой автономных непрерывно живущих чат-агентов: координация, память, самовоспроизведение, самоулучшение, самообновление и живое обновление браузера. Без бюджетов, лимитов и cron.",
  applicationName: "ME2 Mission Control",
  manifest: "/manifest.webmanifest",
  icons: {
    icon: "https://z-cdn.chatglm.cn/z-ai/static/logo.svg",
    apple: "/icons/apple-touch-icon.png",
  },
  appleWebApp: {
    capable: true,
    statusBarStyle: "black-translucent",
    title: "ME2 MC",
  },
};

// EV-PWA: theme-color zinc-950 — PWA-мета Mission Control
export const viewport: Viewport = {
  themeColor: "#09090b",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="dark">
      <body
        className={`${geistSans.variable} ${geistMono.variable} font-sans antialiased`}
      >
        {children}
        <Toaster />
        <Sonner position="bottom-right" theme="dark" richColors closeButton />
      </body>
    </html>
  );
}
