import type { Metadata, Viewport } from "next";
import Script from "next/script";
import { Sarabun } from "next/font/google";
import { LiffProvider } from "@/providers/liff-provider";
import { LanguageProvider } from "@/providers/language-provider";
import { ThemeProvider } from "@/providers/theme-provider";
import "./globals.css";

const sarabun = Sarabun({
  subsets: ["thai", "latin"],
  weight: ["300", "400", "500", "600", "700", "800"],
  variable: "--font-sarabun",
  display: "swap",
});

export const metadata: Metadata = {
  title: "DearFile",
  description: "Cloud file storage via LINE OA",
  icons: {
    icon: "/icon/icon.png",
    apple: "/icon/icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover", // required for env(safe-area-inset-*) on iPhone
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="th" className={sarabun.variable}>
      <body>
        <Script
          src="https://static.line-scdn.net/liff/edge/versions/2.22.3/sdk.js"
          strategy="beforeInteractive"
        />
        <ThemeProvider>
          <LanguageProvider>
            <LiffProvider>{children}</LiffProvider>
          </LanguageProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
