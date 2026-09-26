import type { Metadata } from "next";

import "./globals.css";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";

export const metadata: Metadata = {
  title: "MetaEngine",
  description:
    "Рабочая среда разработки и координации агентов.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="ru" className="dark">
      <body
        className="font-sans antialiased"
      >
        {children}
        <Toaster />
        <Sonner position="bottom-right" theme="dark" richColors closeButton />
      </body>
    </html>
  );
}
