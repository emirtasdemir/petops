import "./globals.css";
import { JetBrains_Mono, Space_Grotesk } from "next/font/google";
import { cn } from "@/lib/utils";

const spaceGrotesk = Space_Grotesk({ subsets: ["latin"], variable: "--font-space-grotesk" });
const jetBrainsMono = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains-mono" });

export const metadata = { title: "PetOps | AI Pet Care Agent" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={cn("dark font-sans antialiased", spaceGrotesk.variable, jetBrainsMono.variable)}>
      <body>{children}</body>
    </html>
  );
}
