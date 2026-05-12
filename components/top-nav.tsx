"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"
import { cn } from "@/lib/utils"
import { Button } from "@/components/ui/button"
import { ThemeToggle } from "@/components/theme-toggle"
import { PILLARS } from "@/lib/data/pillars"

export function TopNav() {
  const pathname = usePathname()

  return (
    <header className="fixed top-0 left-0 right-0 z-50 pointer-events-none">
      {/* Tricolor stripe at the very top of the page */}
      <div className="h-[3px] tricolor-line opacity-80" />

      <div className="px-6 pt-3 pointer-events-none">
        <div className="max-w-7xl mx-auto pointer-events-auto">
          <div className="rounded-full px-2 py-1.5 flex items-center justify-between gap-2
            backdrop-blur-xl border
            bg-white/90 border-black/10
            dark:bg-white/70 dark:border-white/20">
            {/* Brand */}
            <Link
              href="/"
              className="flex items-center gap-3 px-3 shrink-0 group"
            >
              <div className="w-5 h-[2px] tricolor-line rounded-full" />
              <span className="text-[10px] font-display tracking-[0.25em] uppercase text-neutral-900 group-hover:text-black transition-colors">
                Miranda Center
              </span>
            </Link>

            {/* Pillar buttons */}
            <nav className="hidden md:flex items-center gap-1">
              {PILLARS.map((pillar) => {
                const href = `/${pillar.slug}`
                const isActive =
                  pathname === href || pathname.startsWith(href + "/")
                return (
                  <Button
                    key={pillar.slug}
                    asChild
                    variant="ghost"
                    size="sm"
                    className={cn(
                      "rounded-full h-8 px-3 text-[11px] font-medium tracking-wide text-neutral-900 hover:text-black",
                      isActive
                        ? "bg-black/10 hover:bg-black/10"
                        : "hover:bg-black/[0.06]",
                    )}
                  >
                    <Link href={href}>
                      <span className="text-[9px] font-display tracking-[0.2em] uppercase text-neutral-900/60 mr-1">
                        P{pillar.number}
                      </span>
                      {pillar.shortTitle}
                    </Link>
                  </Button>
                )
              })}
            </nav>

            {/* Right actions */}
            <div className="flex items-center gap-1 shrink-0">
              <ThemeToggle />
              <Button
                asChild
                size="sm"
                className="rounded-full h-8 px-4 text-[10px] font-display tracking-[0.15em] uppercase"
              >
                <Link href="/#pillars">View Data</Link>
              </Button>
            </div>
          </div>
        </div>
      </div>
    </header>
  )
}
