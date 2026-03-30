import { useEffect, useRef, useState } from "react";

let mermaidInit = false;

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
          mermaid.initialize({
            startOnLoad: false,
            theme: "dark",
            securityLevel: "strict",
            themeVariables: {
              primaryColor: "#6366f1",
              primaryTextColor: "#f8fafc",
              primaryBorderColor: "#818cf8",
              lineColor: "#94a3b8",
              secondaryColor: "#1e293b",
              tertiaryColor: "#0f172a",
              fontFamily: "ui-sans-serif, system-ui, sans-serif",
            },
          });
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
      className={`rounded-xl border border-border/50 bg-card/40 p-4 overflow-x-auto ${className ?? ""}`}
    >
      {error ? (
        <p className="text-sm text-destructive">{error}</p>
      ) : (
        <div ref={containerRef} className="flex justify-center [&_svg]:max-w-full" />
      )}
    </div>
  );
}
