import Link from "next/link"
import Image from "next/image"
import { TopNav } from "@/components/top-nav"
import { PILLARS } from "@/lib/data/pillars"

export default function LandingPage() {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <TopNav />

      {/* Video Hero Section */}
      <section className="relative min-h-screen flex flex-col items-center justify-center overflow-hidden">
        {/* Video Background */}
        <video
          autoPlay
          muted
          loop
          playsInline
          className="absolute inset-0 w-full h-full object-cover"
        >
          <source src="/video/mofeta-miranda.mp4" type="video/mp4" />
        </video>
        
        {/* Dark overlay for better text readability */}
        <div className="absolute inset-0 bg-black/50" />

        {/* Content */}
        <div className="relative z-10 text-center px-6 max-w-5xl">
          <h1 className="text-5xl md:text-7xl lg:text-[6rem] font-light tracking-tight font-sans text-white leading-[1.05]">
            Venezuelan
            <br />
            Transition
            <br />
            Tracker
          </h1>
        </div>
      </section>

      {/* Why This Exists */}
      <section id="about" className="px-6 py-16 md:py-20 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <p className="text-sm text-muted-foreground mb-6">
            Why this exists
          </p>
          <div className="max-w-3xl">
            <h2 className="text-3xl md:text-4xl lg:text-5xl font-light font-sans leading-[1.15] mb-4">
              Tracking Venezuela's democratic transition through measurable indices.
            </h2>
            <p className="text-base md:text-lg text-muted-foreground font-light leading-relaxed">
              Leveraging human data and artificial intelligence to create transparent, reproducible metrics.
            </p>
          </div>
        </div>
      </section>

      {/* Three Pillars */}
      <section id="pillars" className="px-6 py-12 md:py-16 bg-muted/30 scroll-mt-20">
        <div className="max-w-7xl mx-auto">
          <p className="text-sm text-muted-foreground mb-8">
            The indices
          </p>

          <div className="grid md:grid-cols-3 gap-5">
            {PILLARS.map((pillar) => {
              const Icon = pillar.icon
              return (
                <Link
                  key={pillar.slug}
                  href={`/${pillar.slug}`}
                  className="group bg-background rounded-2xl border border-border overflow-hidden transition-colors hover:border-foreground/30 flex flex-col"
                >
                  <div className="relative aspect-[4/3] overflow-hidden">
                    <Image
                      src={`/images/pillar-${pillar.number}.jpg`}
                      alt={pillar.title}
                      fill
                      sizes="(min-width: 768px) 33vw, 100vw"
                      className="object-cover transition-transform duration-700 ease-out group-hover:scale-105"
                    />
                    <div className="absolute inset-0 bg-gradient-to-t from-black/40 via-transparent to-transparent opacity-0 group-hover:opacity-100 transition-opacity duration-500" />
                  </div>
                  <div className="p-6 md:p-7 flex flex-col flex-1">
                    <div className="flex items-center justify-between mb-6">
                      <Icon className="w-5 h-5 text-muted-foreground" strokeWidth={1.5} />
                      <span className="text-[10px] font-display tracking-[0.2em] uppercase text-muted-foreground/70">
                        Pillar {pillar.number}
                      </span>
                    </div>
                    <h3 className="text-xl md:text-2xl font-light font-sans mb-3 group-hover:text-foreground transition-colors">
                      {pillar.title}
                    </h3>
                    <p className="text-sm text-muted-foreground leading-relaxed">
                      {pillar.description}
                    </p>
                  </div>
                </Link>
              )
            })}
          </div>
        </div>
      </section>

      {/* Footer */}
      <footer className="px-6 py-12 border-t border-border">
        <div className="max-w-7xl mx-auto flex flex-col md:flex-row items-center justify-between gap-6">
          <div className="flex items-center gap-3">
            <div className="w-5 h-[2px] tricolor-line rounded-full" />
            <span className="text-[10px] font-display tracking-[0.25em] uppercase text-muted-foreground">
              Miranda Center
            </span>
          </div>
          <p className="text-xs text-muted-foreground/50">
            Mofeta &amp; The Miranda Center
          </p>
        </div>
      </footer>
    </div>
  )
}
