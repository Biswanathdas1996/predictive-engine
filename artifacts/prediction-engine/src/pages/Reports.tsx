import { useState, useCallback, useRef, useMemo } from "react";
import { useListSimulations, type Simulation } from "@workspace/api-client-react";
import {
  FileText,
  Target,
  AlertTriangle,
  Users,
  GitMerge,
  Download,
  Radio,
  Sparkles,
  BarChart3,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { formatPercent, formatScore, cn, normalizeApiArray } from "@/lib/utils";
import { format } from "date-fns";
import { consumeSSEStream, type SSEEvent } from "@/lib/sse";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const SELECT_NONE = "__none__";

interface Report {
  simulationId: number;
  simulationName: string;
  generatedAt: string;
  keyOutcomes: { label: string; probability: number; impact: string }[];
  riskFactors: string[];
  influentialAgents: { agentId: number; name: string; influenceScore: number; stance: string }[];
  causalDrivers: string[];
  monteCarloSummary: { totalRuns: number; meanSupport: number; variance: number; confidenceInterval: number[] };
  beliefEvolution: { round: number; averagePolicySupport: number; averageTrustInGovernment: number; averageEconomicOutlook: number }[];
  executiveSummary?: string;
  conversationTranscriptChars?: number;
  llmSynthesized?: boolean;
}

export default function Reports() {
  const { data: simulations } = useListSimulations();
  const simulationList = normalizeApiArray<Simulation>(simulations);
  const [selectedSim, setSelectedSim] = useState<string>("");

  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [streamMessage, setStreamMessage] = useState("");
  const [streamPhase, setStreamPhase] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const simCount = simulationList.length;

  const loadReport = useCallback((simId: string) => {
    if (!simId) return;

    abortRef.current?.abort();
    setIsLoading(true);
    setReport(null);
    setStreamMessage("Starting…");
    setStreamPhase("init");

    const abort = new AbortController();
    abortRef.current = abort;

    consumeSSEStream({
      url: `/api/reports/${simId}/stream`,
      method: "GET",
      signal: abort.signal,
      onEvent: (event: SSEEvent) => {
        if (event.type === "status") {
          const e = event as SSEEvent & { phase?: string; message?: string };
          if (e.phase) setStreamPhase(e.phase);
          if (e.message) setStreamMessage(e.message);
        } else if (event.type === "complete") {
          const e = event as SSEEvent & { report: Report };
          setReport(e.report);
          setStreamMessage("Report generated");
        }
      },
      onError: (msg) => {
        setStreamMessage(`Error: ${msg}`);
      },
      onDone: () => {
        setIsLoading(false);
      },
    });
  }, []);

  const REPORT_PHASES = ["init", "synthesis", "finalize"] as const;

  const container = useMemo(
    () => ({
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { staggerChildren: 0.07 } },
    }),
    [],
  );
  const item = useMemo(
    () => ({
      hidden: { opacity: 0, y: 14 },
      show: {
        opacity: 1,
        y: 0,
        transition: { type: "spring" as const, stiffness: 380, damping: 28 },
      },
    }),
    [],
  );

  const selectedSimulation = useMemo(
    () => simulationList.find((s) => String(s.id) === selectedSim),
    [simulationList, selectedSim],
  );

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="relative min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5 text-primary" aria-hidden />
            GenAI intelligence
          </div>
          <h1 className="bg-gradient-to-r from-foreground to-foreground/55 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
            Intelligence reports
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Executive summaries of simulation outcomes, key drivers, and influencer dynamics—synthesized from dialogue,
            agent stats, and Monte Carlo runs.
          </p>
        </div>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <FileText className="h-24 w-24 text-primary" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Sources ready</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">{simCount}</p>
          <p className="mt-1 text-xs text-muted-foreground">Simulations you can summarize</p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-accent/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <BarChart3 className="h-24 w-24 text-accent" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Output</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">Narrative + metrics</p>
          <p className="mt-1 text-xs text-muted-foreground">Risks, drivers, and influencers in one view</p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-emerald-500/30"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <Zap className="h-24 w-24 text-emerald-500" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Live synthesis</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">Streaming</p>
          <p className="mt-1 text-xs text-muted-foreground">Progress updates while the model works</p>
        </motion.div>
      </motion.div>

      <div className="rounded-2xl border border-border/50 bg-card/50 p-4 shadow-lg backdrop-blur-md md:p-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Generate a report</h2>
            <p className="text-sm text-muted-foreground">Pick an environment, then run synthesis.</p>
          </div>
        </div>
        <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center">
          <Select
            value={selectedSim ? selectedSim : SELECT_NONE}
            disabled={isLoading}
            onValueChange={(v) => {
              const next = v === SELECT_NONE ? "" : v;
              setSelectedSim(next);
              setReport(null);
              setStreamMessage("");
              setStreamPhase("");
            }}
          >
            <SelectTrigger
              className={cn(
                "h-11 min-h-11 w-full rounded-xl border-border/60 bg-background/80 shadow-sm lg:min-w-[280px] lg:max-w-md lg:flex-1",
                !selectedSim && "text-muted-foreground",
              )}
            >
              <SelectValue placeholder="Select a simulation…" />
            </SelectTrigger>
            <SelectContent className="rounded-xl border-border/60">
              <SelectItem value={SELECT_NONE} className="rounded-lg">
                Select a simulation…
              </SelectItem>
              {simulationList.map((s) => (
                <SelectItem key={s.id} value={String(s.id)} className="rounded-lg">
                  {s.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              size="lg"
              className="h-11 gap-2 rounded-xl font-medium shadow-[0_0_24px_-8px_var(--color-primary)] transition-transform hover:-translate-y-0.5"
              disabled={isLoading || !selectedSim}
              onClick={() => void loadReport(selectedSim)}
            >
              {isLoading ? (
                <Radio className="h-4 w-4 animate-pulse" />
              ) : (
                <Sparkles className="h-4 w-4" />
              )}
              Generate report
            </Button>
            <Button
              type="button"
              size="lg"
              variant="secondary"
              className="h-11 gap-2 rounded-xl font-medium"
              disabled={!report}
            >
              <Download className="h-4 w-4" />
              PDF
            </Button>
          </div>
        </div>
        {selectedSimulation ? (
          <p className="mt-3 text-xs text-muted-foreground">
            Selected: <span className="font-medium text-foreground">{selectedSimulation.name}</span>
            {selectedSimulation.description ? (
              <span className="text-muted-foreground"> — {selectedSimulation.description}</span>
            ) : null}
          </p>
        ) : null}
      </div>

      {!selectedSim ? (
        <div className="relative flex min-h-[52vh] flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-border/40 bg-gradient-to-b from-card/40 to-card/20 px-6 py-16 text-center backdrop-blur-sm">
          <div
            className="pointer-events-none absolute inset-0 opacity-[0.35]"
            style={{
              background:
                "radial-gradient(ellipse 80% 50% at 50% -20%, hsl(var(--primary) / 0.22), transparent 55%), radial-gradient(ellipse 60% 40% at 100% 50%, hsl(var(--accent) / 0.12), transparent 50%)",
            }}
          />
          <div className="relative flex h-20 w-20 items-center justify-center rounded-2xl border border-border/50 bg-card/80 shadow-lg backdrop-blur-md">
            <FileText className="h-10 w-10 text-primary/80" />
          </div>
          <p className="relative mt-6 text-lg font-medium text-foreground">Choose a simulation to begin</p>
          <p className="relative mt-2 max-w-md text-sm text-muted-foreground">
            Reports combine GenAI reading of posts and replies with agent statistics and Monte Carlo output.
          </p>
        </div>
      ) : isLoading ? (
        <div className="relative flex min-h-[52vh] flex-col items-center justify-center overflow-hidden rounded-3xl border border-border/50 bg-card/60 shadow-xl backdrop-blur-md">
          <div
            className="pointer-events-none absolute inset-0 opacity-40"
            style={{
              background:
                "radial-gradient(circle at 30% 20%, hsl(var(--primary) / 0.2), transparent 45%), radial-gradient(circle at 70% 80%, hsl(var(--primary) / 0.08), transparent 40%)",
            }}
          />
          <div className="relative mb-5 h-14 w-14 rounded-full border-4 border-primary/25 border-t-primary animate-spin" />
          <p className="relative font-mono text-sm font-medium text-primary animate-pulse">Synthesizing intelligence…</p>
          <div className="relative mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Radio className="h-4 w-4 shrink-0 text-primary animate-pulse" />
            <span className="max-w-md truncate font-mono text-xs sm:text-sm">{streamMessage}</span>
          </div>
          <div className="relative mt-5 flex gap-1.5">
            {REPORT_PHASES.map((phase, i) => {
              const cur = (REPORT_PHASES as readonly string[]).indexOf(streamPhase);
              const done = cur >= 0 && i < cur;
              const active = streamPhase === phase;
              return (
                <div
                  key={phase}
                  className={cn(
                    "h-1.5 w-12 rounded-full transition-all duration-500",
                    active ? "scale-110 bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.5)]" : done ? "bg-primary/45" : "bg-secondary",
                  )}
                />
              );
            })}
          </div>
        </div>
      ) : report ? (
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ type: "spring", stiffness: 320, damping: 30 }}
          className="overflow-hidden rounded-2xl border border-border/50 bg-card/80 shadow-2xl backdrop-blur-sm print:border-none print:shadow-none"
        >
          <div className="relative border-b border-border/50 bg-gradient-to-br from-primary/[0.12] via-transparent to-accent/[0.06] px-6 py-8 md:px-8 md:py-10">
            <div
              className="pointer-events-none absolute right-0 top-0 h-64 w-64 -translate-y-1/2 translate-x-1/3 rounded-full opacity-[0.12] blur-3xl"
              style={{ background: "hsl(var(--primary))" }}
            />
            <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
              <div>
                <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-primary">
                  Classified prediction document
                </div>
                <h2 className="text-2xl font-bold tracking-tight text-foreground md:text-3xl">{report.simulationName}</h2>
                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm text-muted-foreground">
                  <span className="font-mono text-xs">SIM-{report.simulationId}</span>
                  <span>{format(new Date(report.generatedAt), "PPpp")}</span>
                  {report.llmSynthesized ? (
                    <span className="rounded-full border border-primary/30 bg-primary/10 px-2.5 py-0.5 text-xs font-medium text-primary">
                      GenAI + dialogue
                    </span>
                  ) : null}
                  {typeof report.conversationTranscriptChars === "number" ? (
                    <span className="text-xs opacity-90">Transcript: {report.conversationTranscriptChars.toLocaleString()} chars</span>
                  ) : null}
                </div>
              </div>
              <div className="rounded-2xl border border-border/60 bg-background/40 px-6 py-4 text-left shadow-inner backdrop-blur-sm lg:text-right">
                <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Expected outcome</div>
                <div
                  className={cn(
                    "mt-1 font-mono text-4xl font-bold tabular-nums",
                    report.monteCarloSummary.meanSupport > 0 ? "text-emerald-400" : "text-destructive",
                  )}
                >
                  {formatScore(report.monteCarloSummary.meanSupport)}
                </div>
              </div>
            </div>
          </div>

          {report.executiveSummary ? (
            <div className="border-b border-border/50 bg-muted/20 px-6 py-6 md:px-8">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wide text-primary">
                <Sparkles className="h-4 w-4" />
                Executive narrative
              </h3>
              <div className="prose prose-sm max-w-none whitespace-pre-wrap leading-relaxed text-muted-foreground dark:prose-invert">
                {report.executiveSummary}
              </div>
            </div>
          ) : null}

          <div className="grid grid-cols-1 gap-8 p-6 md:grid-cols-2 md:gap-10 md:p-8">
            <div className="space-y-8">
              <section>
                <h3 className="mb-4 flex items-center gap-2 border-b border-border/40 pb-2 text-base font-bold tracking-tight">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Target className="h-4 w-4" />
                  </span>
                  Key outcomes
                </h3>
                <div className="space-y-3">
                  {report.keyOutcomes.map((outcome, i) => (
                    <div
                      key={i}
                      className="flex items-center justify-between gap-4 rounded-xl border border-border/50 bg-secondary/15 p-4 transition-colors hover:border-primary/25"
                    >
                      <div className="min-w-0">
                        <div className="font-medium text-foreground">{outcome.label}</div>
                        <div className="text-xs text-muted-foreground">Impact: {outcome.impact}</div>
                      </div>
                      <div className="shrink-0 text-right">
                        <div className="font-mono text-xl font-semibold text-primary tabular-nums">
                          {formatPercent(outcome.probability)}
                        </div>
                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Prob</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-4 flex items-center gap-2 border-b border-border/40 pb-2 text-base font-bold tracking-tight">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent/15 text-accent">
                    <GitMerge className="h-4 w-4" />
                  </span>
                  Causal drivers
                </h3>
                <ul className="space-y-2.5 pl-1 text-sm text-muted-foreground">
                  {report.causalDrivers.map((driver, i) => (
                    <li key={i} className="flex gap-3">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-accent" />
                      <span>{driver}</span>
                    </li>
                  ))}
                </ul>
              </section>
            </div>

            <div className="space-y-8">
              <section>
                <h3 className="mb-4 flex items-center gap-2 border-b border-border/40 pb-2 text-base font-bold tracking-tight text-amber-500">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-amber-500/15 text-amber-500">
                    <AlertTriangle className="h-4 w-4" />
                  </span>
                  Risk factors
                </h3>
                <div className="space-y-2">
                  {report.riskFactors.map((risk, i) => (
                    <div
                      key={i}
                      className="flex gap-3 rounded-xl border border-amber-500/20 bg-amber-500/[0.06] p-3.5 text-sm text-amber-100/90"
                    >
                      <div className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-amber-500" />
                      <p className="leading-relaxed">{risk}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="mb-4 flex items-center gap-2 border-b border-border/40 pb-2 text-base font-bold tracking-tight">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-primary/15 text-primary">
                    <Users className="h-4 w-4" />
                  </span>
                  Key influencers
                </h3>
                <div className="divide-y divide-border/40 rounded-xl border border-border/50 bg-background/30">
                  {report.influentialAgents.map((agent, i) => (
                    <div key={i} className="flex items-center justify-between gap-4 px-4 py-3 text-sm last:rounded-b-xl first:rounded-t-xl">
                      <div className="min-w-0 font-medium text-foreground">{agent.name}</div>
                      <div className="flex shrink-0 items-center gap-4">
                        <span className="text-muted-foreground">{agent.stance}</span>
                        <span className="w-14 text-right font-mono text-sm font-semibold text-accent tabular-nums">
                          {formatScore(agent.influenceScore)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </motion.div>
      ) : (
        <div className="relative flex min-h-[40vh] flex-col items-center justify-center overflow-hidden rounded-3xl border border-dashed border-border/40 bg-card/30 px-6 py-12 text-center backdrop-blur-sm">
          <div className="rounded-xl border border-border/50 bg-background/50 p-4 shadow-sm">
            <Sparkles className="mx-auto h-8 w-8 text-primary/70" />
          </div>
          <p className="mt-4 max-w-sm text-sm text-muted-foreground">
            Click <span className="font-medium text-foreground">Generate report</span> to run GenAI on this
            simulation&apos;s threads.
          </p>
        </div>
      )}
    </div>
  );
}
