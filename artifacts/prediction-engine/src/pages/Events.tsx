import { useCallback, useState } from "react";
import {
  ApiError,
  useListEvents,
  useCreateEvent,
  useSuggestEventFromWeb,
  type Event,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, Globe, Plus } from "lucide-react";
import { motion } from "framer-motion";
import { formatScore, normalizeApiArray } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

export default function Events() {
  const queryClient = useQueryClient();
  const { data: events, isLoading } = useListEvents();
  const createEvent = useCreateEvent();
  const suggestFromWeb = useSuggestEventFromWeb();
  const eventList = normalizeApiArray<Event>(events);

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
        description: "Type keywords or a short question above first (at least 2 characters), then try again.",
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
            typeof data.impactScore === "number" && Number.isFinite(data.impactScore)
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
              "Web search or PwC GenAI is unavailable. Add OLLAMA_API_KEY to the API .env and ensure PWC GenAI is configured.";
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

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            External Events
          </h1>
          <p className="text-muted-foreground mt-1">Exogenous shocks injected into simulations.</p>
        </div>
        <button
          type="button"
          onClick={() => setDialogOpen(true)}
          className="flex items-center gap-2 bg-amber-500 text-amber-950 px-4 py-2 rounded-xl font-medium shadow-sm hover:bg-amber-400"
        >
          <Plus className="w-4 h-4" /> Inject Event
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-secondary/30 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Description</th>
              <th className="px-6 py-4 font-medium">Impact Score</th>
              <th className="px-6 py-4 font-medium text-right font-mono">ID</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading ? (
              <tr>
                <td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">
                  Loading...
                </td>
              </tr>
            ) : eventList.length === 0 ? (
              <tr>
                <td colSpan={4} className="px-6 py-12 text-center text-muted-foreground text-sm">
                  No events yet. Use Inject Event to add one.
                </td>
              </tr>
            ) : (
              eventList.map((event) => (
                <tr key={event.id} className="hover:bg-secondary/10 transition-colors">
                  <td className="px-6 py-4 font-medium">
                    <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-1 rounded text-xs">
                      {event.type}
                    </span>
                  </td>
                  <td className="px-6 py-4 text-sm text-muted-foreground">{event.description}</td>
                  <td className="px-6 py-4 font-mono font-bold text-amber-500">
                    {formatScore(event.impactScore)}
                  </td>
                  <td className="px-6 py-4 text-right text-sm font-mono text-muted-foreground">{event.id}</td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {dialogOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-xl overflow-hidden"
          >
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h2 className="text-xl font-bold">Inject external event</h2>
              <button
                type="button"
                onClick={() => {
                  if (!formBusy) {
                    setDialogOpen(false);
                    resetForm();
                  }
                }}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label htmlFor="event-type" className="text-sm font-medium text-muted-foreground">
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
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500 focus:ring-1 focus:ring-amber-500/40"
                  placeholder="Keywords or question (e.g. EU AI Act enforcement March 2026) — then “Search web & fill”"
                  autoComplete="off"
                />
                <button
                  type="button"
                  onClick={handleWebFill}
                  disabled={formBusy}
                  className="w-full sm:w-auto inline-flex items-center justify-center gap-2 min-h-10 px-4 py-2.5 rounded-xl text-sm font-medium border border-amber-500/60 bg-amber-500/15 text-amber-950 dark:text-amber-100 hover:bg-amber-500/25 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                >
                  <Globe className="w-4 h-4 shrink-0" />
                  {suggestFromWeb.isPending ? "Searching web & generating…" : "Search web & fill with AI"}
                </button>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Uses{" "}
                  <a
                    href="https://ollama.com/blog/web-search"
                    className="text-primary hover:underline"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Ollama Cloud web search
                  </a>{" "}
                  (<span className="font-mono">OLLAMA_API_KEY</span> in <span className="font-mono">.env</span>),
                  then PwC GenAI to draft type, description, and impact score.
                </p>
                {webFillHint ? (
                  <p className="text-xs text-amber-600/90 dark:text-amber-400/90">{webFillHint}</p>
                ) : null}
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event-desc" className="text-sm font-medium text-muted-foreground">
                  Description
                </label>
                <textarea
                  id="event-desc"
                  required
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  disabled={formBusy}
                  rows={4}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-amber-500 min-h-[100px] resize-y"
                  placeholder="What happened and how it might affect sentiment or behavior…"
                />
              </div>
              <div className="space-y-1.5">
                <label htmlFor="event-impact" className="text-sm font-medium text-muted-foreground">
                  Impact score (−1 to 1)
                </label>
                <input
                  id="event-impact"
                  type="number"
                  min={-1}
                  max={1}
                  step={0.05}
                  value={impactScore}
                  onChange={(e) => setImpactScore(parseFloat(e.target.value) || 0)}
                  disabled={formBusy}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-amber-500"
                />
              </div>
              <p className="text-xs text-muted-foreground leading-relaxed">
                Events are added to the shared global catalog. Simulations attach them by ID from the simulation Config tab.
              </p>
              <div className="flex justify-end gap-3 pt-4 border-t border-border/50">
                <button
                  type="button"
                  onClick={() => {
                    if (!formBusy) {
                      setDialogOpen(false);
                      resetForm();
                    }
                  }}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={formBusy}
                  className="px-6 py-2 bg-amber-500 text-amber-950 rounded-xl text-sm font-medium hover:bg-amber-400 disabled:opacity-50 transition-colors"
                >
                  {createEvent.isPending ? "Injecting…" : "Inject"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
