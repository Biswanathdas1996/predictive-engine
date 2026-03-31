import { useCallback, useMemo, useState } from "react";
import {
  ApiError,
  useListEvents,
  useCreateEvent,
  useSuggestEventFromWeb,
  type Event,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  AlertTriangle,
  Globe,
  Plus,
  TrendingDown,
  TrendingUp,
  Waves,
  X,
  Zap,
} from "lucide-react";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { formatScore, normalizeApiArray, cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";

function ImpactTrack({ score }: { score: number }) {
  const clamped = Math.min(1, Math.max(-1, score));
  const pct = ((clamped + 1) / 2) * 100;
  return (
    <div className="relative flex h-4 items-center">
      <div className="relative h-2.5 w-full overflow-hidden rounded-full border border-border/50 bg-gradient-to-r from-rose-500/20 via-amber-500/15 to-emerald-500/20">
        <div
          className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/60"
          aria-hidden
        />
      </div>
      <div
        className="pointer-events-none absolute top-1/2 h-3.5 w-3.5 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-foreground shadow-md"
        style={{ left: `${pct}%` }}
        title={formatScore(score)}
      />
    </div>
  );
}

export default function Events() {
  const queryClient = useQueryClient();
  const { data: events, isLoading } = useListEvents();
  const createEvent = useCreateEvent();
  const suggestFromWeb = useSuggestEventFromWeb();
  const eventList = normalizeApiArray<Event>(events);

  const sortedEvents = useMemo(
    () =>
      [...eventList].sort(
        (a, b) =>
          new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    [eventList],
  );

  const stats = useMemo(() => {
    const total = eventList.length;
    if (total === 0) {
      return {
        total: 0,
        avg: null as number | null,
        positive: 0,
        negative: 0,
      };
    }
    const sum = eventList.reduce((acc, e) => acc + e.impactScore, 0);
    return {
      total,
      avg: sum / total,
      positive: eventList.filter((e) => e.impactScore > 0).length,
      negative: eventList.filter((e) => e.impactScore < 0).length,
    };
  }, [eventList]);

  const [dialogOpen, setDialogOpen] = useState(false);
  const [type, setType] = useState("");
  const [description, setDescription] = useState("");
  const [impactScore, setImpactScore] = useState(0);
  const [webFillHint, setWebFillHint] = useState<string | null>(null);

  const formBusy = createEvent.isPending || suggestFromWeb.isPending;

  const resetForm = useCallback(() => {
    setType("");
    setDescription("");
    setImpactScore(0);
    setWebFillHint(null);
  }, []);

  const handleWebFill = (e: React.MouseEvent<HTMLButtonElement>) => {
    e.preventDefault();
    e.stopPropagation();
    const q = type.trim();
    if (q.length < 2) {
      toast({
        variant: "destructive",
        title: "Enter a search topic",
        description:
          "Type keywords or a short question above first (at least 2 characters), then try again.",
      });
      return;
    }
    setWebFillHint(null);
    suggestFromWeb.mutate(
      { data: { query: q } },
      {
        onSuccess: (data) => {
          setType(data.type);
          setDescription(data.description);
          const nextImpact =
            typeof data.impactScore === "number" &&
            Number.isFinite(data.impactScore)
              ? data.impactScore
              : 0;
          setImpactScore(Math.min(1, Math.max(-1, nextImpact)));
          const prov = data.webSearchProvider
            ? `Sources: ${data.webSearchProvider.replace(/_/g, " ")}`
            : null;
          const note = data.sourcesNote?.trim() || null;
          setWebFillHint([prov, note].filter(Boolean).join(" · ") || null);
          toast({
            title: "Fields filled from web + AI",
            description: "Review and edit before injecting.",
          });
        },
        onError: (err) => {
          let message =
            err instanceof Error ? err.message : "Web fill failed.";
          if (err instanceof ApiError && err.status === 503) {
            message =
              err.message ||
              "Web search or PwC GenAI is unavailable. Add OLLAMA_API_KEY to the API .env and ensure PwC GenAI is configured.";
          }
          toast({
            variant: "destructive",
            title: "Could not fill from web",
            description: message,
          });
        },
      },
    );
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = type.trim();
    const d = description.trim();
    if (!t) {
      toast({
        variant: "destructive",
        title: "Type required",
        description: "Enter an event type (e.g. news_break, regulation).",
      });
      return;
    }
    if (!d) {
      toast({
        variant: "destructive",
        title: "Description required",
        description: "Describe the external event.",
      });
      return;
    }

    createEvent.mutate(
      {
        data: {
          type: t,
          description: d,
          impactScore: Math.min(1, Math.max(-1, impactScore)),
          simulationId: null,
        },
      },
      {
        onSuccess: () => {
          queryClient.invalidateQueries({ queryKey: ["/api/events"] });
          setDialogOpen(false);
          resetForm();
          toast({ title: "Event injected" });
        },
        onError: (err) => {
          const message =
            err instanceof Error ? err.message : "Could not create event.";
          toast({
            variant: "destructive",
            title: "Inject failed",
            description: message,
          });
        },
      },
    );
  };

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06 } },
  };
  const item = {
    hidden: { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 380, damping: 28 },
    },
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="relative min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <Waves className="h-3.5 w-3.5 text-amber-500" aria-hidden />
            Exogenous shocks
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/55 md:text-4xl">
            External events
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Curate real-world shocks for your simulations. Each entry becomes part
            of the shared catalog—attach events by ID from a simulation’s Config
            tab.
          </p>
        </div>
        <Button
          size="lg"
          className="h-11 shrink-0 rounded-xl bg-amber-500 text-amber-950 shadow-[0_0_24px_-8px_rgba(245,158,11,0.55)] transition-transform hover:-translate-y-0.5 hover:bg-amber-400"
          onClick={() => setDialogOpen(true)}
        >
          <Plus className="h-5 w-5" />
          Inject event
        </Button>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4"
      >
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-amber-500/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <Zap className="h-24 w-24 text-amber-500" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Catalog size
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.total}
          </p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <AlertTriangle className="h-24 w-24 text-primary" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Mean impact
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.avg === null ? "—" : formatScore(stats.avg)}
          </p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-emerald-500/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <TrendingUp className="h-24 w-24 text-emerald-500" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Positive tilt
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.positive}
          </p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-rose-500/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <TrendingDown className="h-24 w-24 text-rose-500" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Negative tilt
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.negative}
          </p>
        </motion.div>
      </motion.div>

      <div className="rounded-2xl border border-border/50 bg-card/50 p-4 shadow-lg backdrop-blur-md md:p-6">
        <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">
              Event catalog
            </h2>
            <p className="text-sm text-muted-foreground">
              Types, narratives, and calibrated impact scores for downstream runs.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-border/40 bg-secondary/20 p-5"
              >
                <div className="h-5 w-24 rounded-md bg-secondary/60" />
                <div className="mt-3 h-3 w-full rounded bg-secondary/40" />
                <div className="mt-2 h-3 w-4/5 rounded bg-secondary/40" />
                <div className="mt-6 h-2 w-full rounded-full bg-secondary/50" />
              </div>
            ))}
          </div>
        ) : sortedEvents.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/30 px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-card/80 shadow-inner">
              <Waves className="h-7 w-7 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-lg font-medium text-foreground">No events yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Inject your first external shock—manually or with web search and AI—
              to build the catalog simulations can reference.
            </p>
            <Button
              className="mt-6 rounded-xl bg-amber-500 text-amber-950 hover:bg-amber-400"
              onClick={() => setDialogOpen(true)}
            >
              <Plus className="h-4 w-4" />
              Inject event
            </Button>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {sortedEvents.map((event) => (
              <motion.article
                key={event.id}
                variants={item}
                className="group flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm transition-all duration-200 hover:border-amber-500/30 hover:shadow-md hover:shadow-amber-500/[0.06]"
              >
                <div className="flex items-start justify-between gap-3">
                  <span
                    className={cn(
                      "inline-flex max-w-[min(100%,14rem)] truncate rounded-lg border border-amber-500/25 bg-amber-500/10 px-2.5 py-1 text-xs font-semibold text-amber-600 dark:text-amber-400",
                    )}
                    title={event.type}
                  >
                    {event.type}
                  </span>
                  <span className="shrink-0 font-mono text-[10px] tabular-nums text-muted-foreground">
                    #{event.id}
                  </span>
                </div>
                <p className="mt-3 flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-4">
                  {event.description}
                </p>
                <div className="mt-5 space-y-2">
                  <div className="flex items-center justify-between text-xs text-muted-foreground">
                    <span>Impact (−1 → 1)</span>
                    <span className="font-mono font-semibold text-amber-600 dark:text-amber-400">
                      {formatScore(event.impactScore)}
                    </span>
                  </div>
                  <ImpactTrack score={event.impactScore} />
                </div>
                <p className="mt-4 text-[11px] text-muted-foreground/80">
                  Added{" "}
                  <time dateTime={event.createdAt}>
                    {format(new Date(event.createdAt), "MMM d, yyyy · HH:mm")}
                  </time>
                </p>
              </motion.article>
            ))}
          </motion.div>
        )}
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ scale: 0.96, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: "spring", stiffness: 420, damping: 32 }}
            className="w-full max-w-xl overflow-hidden rounded-2xl border border-border/60 bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b border-border/60 px-6 py-4">
              <h2 className="text-lg font-semibold tracking-tight">
                Inject external event
              </h2>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                className="h-9 w-9 rounded-xl"
                onClick={() => {
                  if (!formBusy) {
                    setDialogOpen(false);
                    resetForm();
                  }
                }}
                aria-label="Close"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
            <form onSubmit={handleSubmit} className="space-y-4 p-6">
              <div className="space-y-1.5">
                <label
                  htmlFor="event-type"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Topic / type
                </label>
                <input
                  id="event-type"
                  required
                  value={type}
                  onChange={(e) => {
                    setType(e.target.value);
                    setWebFillHint(null);
                  }}
                  disabled={formBusy}
                  className="w-full rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm transition-colors focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/25"
                  placeholder="Keywords or question (e.g. EU AI Act enforcement March 2026) — then “Search web & fill”"
                  autoComplete="off"
                />
                <Button
                  type="button"
                  variant="outline"
                  className="w-full rounded-xl border-amber-500/50 bg-amber-500/10 text-amber-950 hover:bg-amber-500/20 dark:text-amber-100 sm:w-auto"
                  onClick={handleWebFill}
                  disabled={formBusy}
                >
                  <Globe className="h-4 w-4 shrink-0" />
                  {suggestFromWeb.isPending
                    ? "Searching web & generating…"
                    : "Search web & fill with AI"}
                </Button>
                <p className="text-xs leading-relaxed text-muted-foreground">
                  Uses{" "}
                  <a
                    href="https://ollama.com/blog/web-search"
                    className="text-primary hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ollama Cloud web search
                  </a>{" "}
                  (<span className="font-mono">OLLAMA_API_KEY</span> in{" "}
                  <span className="font-mono">.env</span>), then PwC GenAI to
                  draft type, description, and impact score.
                </p>
                {webFillHint ? (
                  <p className="text-xs text-amber-600/90 dark:text-amber-400/90">
                    {webFillHint}
                  </p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="event-desc"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Description
                </label>
                <textarea
                  id="event-desc"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={formBusy}
                  rows={4}
                  className="min-h-[100px] w-full resize-y rounded-xl border border-border bg-secondary/50 px-3 py-2.5 text-sm transition-colors focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/25"
                  placeholder="What happened and how it might affect sentiment or behavior…"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  htmlFor="event-impact"
                  className="text-sm font-medium text-muted-foreground"
                >
                  Impact score (−1 to 1)
                </label>
                <input
                  id="event-impact"
                  type="number"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={impactScore}
                  onChange={(e) =>
                    setImpactScore(parseFloat(e.target.value) || 0)
                  }
                  disabled={formBusy}
                  className="w-full rounded-xl border border-border bg-secondary/50 px-3 py-2.5 font-mono text-sm focus:border-amber-500 focus:outline-none focus:ring-2 focus:ring-amber-500/25"
                />
              </div>
              <p className="text-xs leading-relaxed text-muted-foreground">
                Events are added to the shared global catalog. Simulations attach
                them by ID from the simulation Config tab.
              </p>
              <div className="flex justify-end gap-3 border-t border-border/50 pt-4">
                <Button
                  type="button"
                  variant="ghost"
                  className="rounded-xl"
                  onClick={() => {
                    if (!formBusy) {
                      setDialogOpen(false);
                      resetForm();
                    }
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={formBusy}
                  className="rounded-xl bg-amber-500 text-amber-950 hover:bg-amber-400"
                >
                  {createEvent.isPending ? "Injecting…" : "Inject"}
                </Button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
