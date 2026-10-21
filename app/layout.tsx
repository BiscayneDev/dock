import type { Metadata } from "next"
import { Geist, Geist_Mono, Instrument_Serif } from "next/font/google"
import "./globals.css"
import { ConditionalLayout } from "@/components/ConditionalLayout"

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] })
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] })
const instrumentSerif = Instrument_Serif({
  variable: "--font-serif-display",
  weight: "400",
  style: ["normal", "italic"],
  subsets: ["latin"],
})

export const metadata: Metadata = {
  title: "Dock",
  description: "The open-source Agent OS for solo founders",
  metadataBase: new URL("https://shipyard-teal.vercel.app"),
  keywords: [
    "ai agents",
    "agent os",
    "autonomous agents",
    "task management",
    "agent orchestration",
    "solo founder",
    "ai dashboard",
  ],
  openGraph: {
    title: "Dock",
    description: "The open-source Agent OS for solo founders",
    url: "/os",
    siteName: "Dock",
    type: "website",
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    title: "Dock",
    description: "The open-source Agent OS for solo founders",
  },
  other: {
    "theme-color": "#0a0a0f",
  },
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable}`}>
      <body
        className="antialiased"
        style={{ backgroundColor: "#08080b", color: "#e9eaf0" }}
      >
        <ConditionalLayout>{children}</ConditionalLayout>
      </body>
    </html>
  )
}
