import type { Metadata, Viewport } from "next";
import { Rubik } from "next/font/google";
import "./globals.css";

const rubik = Rubik({
  variable: "--font-rubik",
  subsets: ["latin", "hebrew"],
});

export const metadata: Metadata = {
  title: "Studio&more",
  description: "Task & time tracking for Studio&more",
};

// This app had NO viewport export at all, so it ran on Next's default. That
// default is the right `width=device-width, initial-scale=1` — the reason to
// state it explicitly is `viewportFit`, which has no default worth having:
// without it `env(safe-area-inset-bottom)` resolves to 0px on an iPhone, and
// the mobile bottom bar would sit under the home indicator.
//
// ⚠️ `maximumScale` is deliberately absent. Locking zoom is the usual quick fix
// for iOS's zoom-on-focus, but it disables pinch-zoom for everyone (WCAG 1.4.4)
// and iOS ignores it inconsistently anyway. The real fix is the 16px field rule
// in globals.css.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      data-theme="electric"
      className={`${rubik.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
