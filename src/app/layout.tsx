import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "3D Scene Generator",
  description: "Generate 3D scenes from text descriptions",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en">
      <body className="bg-gray-950 text-white min-h-screen antialiased">
        {children}
      </body>
    </html>
  );
}
