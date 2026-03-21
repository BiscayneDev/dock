import type { Metadata, Viewport } from "next"
import { Geist, Geist_Mono } from "next/font/google"
import "./globals.css"

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
})

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
})

const SITE_URL = "https://dock-six.vercel.app"
const TITLE = "Dock — Your AI First Mate"
const DESCRIPTION = "AI assistant that manages your email, calendar, GitHub, Notion, and crypto wallets through natural conversation in Telegram. No app switching. Just chat."

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#d6dce8",
}

export const metadata: Metadata = {
  title: {
    default: TITLE,
    template: "%s — Dock",
  },
  description: DESCRIPTION,
  applicationName: "Dock",
  authors: [{ name: "Dock" }],
  creator: "Dock",
  keywords: [
    "AI assistant",
    "Telegram bot",
    "email automation",
    "calendar management",
    "GitHub integration",
    "Notion integration",
    "crypto wallet",
    "productivity",
    "automation",
    "recipes",
  ],
  icons: {
    icon: "/logo.png",
    apple: "/logo.png",
  },
  manifest: "/manifest.json",

  // Open Graph
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Dock",
    images: [
      {
        url: `${SITE_URL}/api/og`,
        width: 1200,
        height: 630,
        alt: "Dock — Your AI first mate, always on deck",
        type: "image/png",
      },
    ],
    locale: "en_US",
  },

  // Twitter
  twitter: {
    card: "summary_large_image",
    title: TITLE,
    description: DESCRIPTION,
    images: [`${SITE_URL}/api/og`],
  },

  // Other
  robots: {
    index: true,
    follow: true,
  },
  metadataBase: new URL(SITE_URL),
  alternates: {
    canonical: "/",
  },
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased min-h-screen`}
      >
        {children}
      </body>
    </html>
  )
}
