import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Company info",
  description: "Company info",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="bg-background overscroll-none font-sans antialiased" suppressHydrationWarning>
        {children}
      </body>
    </html>
  );
}
