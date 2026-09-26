'use client'

import { ThemeProvider as NextThemesProvider } from 'next-themes'
import type * as React from 'react'

/**
 * EV-DARKMODE: app-wide theme provider.
 * - attribute="class" → <html class="dark|light"> (globals.css @custom-variant dark + html.light remap)
 * - defaultTheme="dark" → Mission Control brand look on first paint
 * - enableSystem={false} → binary dark/light toggle, deterministic, no flash-of-system
 */
export function ThemeProvider({ children }: { children: React.ReactNode }) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="dark"
      enableSystem={false}
      disableTransitionOnChange
    >
      {children}
    </NextThemesProvider>
  )
}
