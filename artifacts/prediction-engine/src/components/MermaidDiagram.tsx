import { useEffect, useRef, useState } from "react";
import type { MermaidConfig } from "mermaid";
import { cn } from "@/lib/utils";

let mermaidInit = false;

/** Mermaid theme aligned with index.css — electric cyan primary, purple accent, chart greens/oranges for variety */
const MERMAID_THEME: MermaidConfig = {
  startOnLoad: false,
  theme: "dark",
  securityLevel: "strict",
  flowchart: {
    curve: "basis" as const,
    padding: 14,
    htmlLabels: true,
    diagramPadding: 16,
    nodeSpacing: 56,
    rankSpacing: 72,
  },
  sequence: {
    actorMargin: 56,
    boxMargin: 12,
    boxTextMargin: 8,
    messageMargin: 40,
    mirrorActors: true,
    useMaxWidth: true,
  },
  themeVariables: {
    // Core nodes — cyan glass
    primaryColor: "hsl(199 78% 28%)",
    primaryTextColor: "hsl(210 40% 98%)",
    primaryBorderColor: "hsl(199 89% 52%)",
    // Secondary — purple (alt branches / contrast)
    secondaryColor: "hsl(265 62% 38%)",
    secondaryTextColor: "hsl(210 40% 98%)",
    secondaryBorderColor: "hsl(265 89% 62%)",
    // Tertiary — deep slate cards
    tertiaryColor: "hsl(222 42% 16%)",
    tertiaryBorderColor: "hsl(217 32% 32%)",
    tertiaryTextColor: "hsl(210 35% 92%)",
    // Canvas
    background: "transparent",
    mainBkg: "hsl(222 47% 11%)",
    secondBkg: "hsl(222 45% 13%)",
    textColor: "hsl(210 40% 96%)",
    nodeTextColor: "hsl(210 40% 96%)",
    nodeBorder: "hsl(199 55% 42%)",
    // Subgraphs / clusters — tinted panels
    clusterBkg: "hsl(222 48% 10% / 0.88)",
    clusterBorder: "hsl(199 70% 48% / 0.45)",
    titleColor: "hsl(199 90% 78%)",
    // Edges & labels
    lineColor: "hsl(199 72% 55%)",
    defaultLinkColor: "hsl(199 72% 55%)",
    edgeLabelBackground: "hsl(222 47% 14% / 0.96)",
    edgeLabelColor: "hsl(210 40% 94%)",
    // Sequence diagram
    actorBkg: "hsl(222 47% 14%)",
    actorBorder: "hsl(199 89% 48%)",
    actorTextColor: "hsl(210 40% 98%)",
    actorLineColor: "hsl(199 55% 50%)",
    signalColor: "hsl(199 75% 62%)",
    signalTextColor: "hsl(210 40% 96%)",
    labelBoxBkgColor: "hsl(265 45% 22% / 0.9)",
    labelBoxBorderColor: "hsl(265 70% 55%)",
    labelTextColor: "hsl(210 40% 98%)",
    loopTextColor: "hsl(199 85% 75%)",
    activationBorderColor: "hsl(199 89% 48%)",
    activationBkgColor: "hsl(199 50% 18% / 0.85)",
    sequenceNumberColor: "hsl(210 40% 98%)",
    noteBkgColor: "hsl(265 40% 20% / 0.92)",
    noteBorderColor: "hsl(265 75% 58%)",
    noteTextColor: "hsl(210 40% 96%)",
    // Sections / alt blocks
    altBackground: "hsl(265 35% 16% / 0.35)",
    // Typography
    fontFamily: "Inter, ui-sans-serif, system-ui, sans-serif",
    fontSize: "13px",
  },
};

type Props = {
  chart: string;
  className?: string;
};

export function MermaidDiagram({ chart, className }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const idRef = useRef(`m-${Math.random().toString(36).slice(2, 11)}`);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    const el = containerRef.current;
    if (!el) return;

    (async () => {
      try {
        const mermaid = (await import("mermaid")).default;
        if (!mermaidInit) {
          mermaid.initialize(MERMAID_THEME);
          mermaidInit = true;
        }
        const { svg } = await mermaid.render(idRef.current, chart);
        if (cancelled || !containerRef.current) return;
        containerRef.current.innerHTML = svg;
        setError(null);
      } catch (e) {
        if (!cancelled) {
          setError(e instanceof Error ? e.message : "Diagram failed to render");
        }
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [chart]);

  return (
    <div
      className={cn(
        "group/diagram relative overflow-hidden rounded-2xl p-px",
        "bg-gradient-to-br from-primary/70 via-accent/45 to-chart-4/50",
        "shadow-[0_24px_64px_-24px_hsl(var(--primary)/0.5),0_0_0_1px_hsl(var(--primary)/0.15)]",
        className,
      )}
    >
      <div
        className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_90%_55%_at_50%_-10%,hsl(var(--primary)/0.18),transparent_55%)]"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -right-20 top-1/3 h-56 w-56 -translate-y-1/2 rounded-full bg-accent/25 blur-3xl"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute -left-16 bottom-0 h-40 w-40 rounded-full bg-primary/20 blur-3xl"
        aria-hidden
      />

      <div
        className={cn(
          "relative overflow-x-auto rounded-[15px] sm:rounded-2xl",
          "border border-white/[0.08]",
          "bg-gradient-to-b from-card/95 via-card/[0.82] to-card/65",
          "p-4 sm:p-6 backdrop-blur-md",
          "ring-1 ring-inset ring-primary/15",
        )}
      >
        {error ? (
          <p className="rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">
            {error}
          </p>
        ) : (
          <div
            ref={containerRef}
            className={cn(
              "flex justify-center",
              "[&_svg]:max-w-full",
              "[&_svg]:drop-shadow-[0_2px_20px_hsl(var(--primary)/0.08)]",
              "[&_svg_.cluster-label_text]:font-semibold [&_svg_.cluster-label_text]:tracking-tight",
              "[&_svg_.edgeLabel]:rounded-md",
            )}
          />
        )}
      </div>
    </div>
  );
}
