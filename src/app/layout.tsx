import type { Metadata, Viewport } from "next"
import { dmMono, fraunces, schibsted } from "./fonts"
import "./globals.css"

const SITE_URL = "https://getdinghy.sh"
const TITLE = "Dinghy · your first mate lives in your texts"
const DESCRIPTION = "dinghy is a first mate that lives in imessage. you text it like a person. it does the work."

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  themeColor: "#060B1A",
}

export const metadata: Metadata = {
  title: {
    default: TITLE,
    template: "%s — Dinghy",
  },
  description: DESCRIPTION,
  applicationName: "Dinghy",
  authors: [{ name: "Dinghy" }],
  creator: "Dinghy",
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
    icon: "/icon.svg",
    apple: "/logo.png",
  },
  manifest: "/manifest.json",

  // Open Graph
  openGraph: {
    type: "website",
    url: SITE_URL,
    title: TITLE,
    description: DESCRIPTION,
    siteName: "Dinghy",
    images: [
      {
        url: `${SITE_URL}/api/og`,
        width: 1200,
        height: 630,
        alt: "Dinghy · your first mate lives in your texts",
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
        className={`${fraunces.variable} ${schibsted.variable} ${dmMono.variable} antialiased min-h-screen`}
      >
        {children}
      </body>
    </html>
  )
}
