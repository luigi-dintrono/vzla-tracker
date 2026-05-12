import type React from "react"
import Link from "next/link"
import { TopNav } from "@/components/top-nav"

export default function PillarsLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <TopNav />
      <main className="flex-1 pt-24">{children}</main>
      <footer className="px-6 py-10 border-t border-border">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="w-5 h-[2px] tricolor-line rounded-full" />
            <span className="text-[10px] font-display tracking-[0.25em] uppercase text-muted-foreground">
              Miranda Center
            </span>
          </div>
          <div className="flex items-center gap-6 text-xs text-muted-foreground">
            <Link href="/" className="hover:text-foreground transition-colors">Home</Link>
            <Link href="/existing-work" className="hover:text-foreground transition-colors">Existing work</Link>
          </div>
        </div>
      </footer>
    </div>
  )
}
