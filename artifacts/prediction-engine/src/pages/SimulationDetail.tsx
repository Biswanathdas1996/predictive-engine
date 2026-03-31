import { useState, useCallback, useRef, useEffect, useMemo } from "react";
import { useRoute } from "wouter";
import {
  useGetSimulation,
  useGetSimulationPosts,
  useListPolicies,
  useListEvents,
  getListEventsQueryKey,
  getGetSimulationQueryKey,
  patchSimulationConfig,
  ApiError,
  customFetch,
  type Post,
  type GraphComment,
  type Policy,
  type Event,
} from "@workspace/api-client-react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Play,
  RefreshCw,
  MessageSquare,
  ArrowLeft,
  Network,
  Radio,
  CornerDownRight,
  BarChart2,
  Info,
  Settings,
  Sparkles,
  Heart,
  Repeat2,
  Share2,
  MessageCircle,
  Zap,
} from "lucide-react";
import { Link } from "wouter";
import { cn, formatScore, normalizeApiArray } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function shortFeedTime(iso: string | undefined): string {
  if (!iso) return "";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  } catch {
    return "";
  }
}

function formatConfigDate(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return iso;
    return d.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
  } catch {
    return iso;
  }
}

/** Layman wording for where a −1…1 “support” score lands (no numbers). */
function scoreToBackingLabel(score: number): string {
  if (score < -0.55) return "mostly opposed to the policy";
  if (score < -0.2) return "skeptical, with concern outweighing buy-in";
  if (score <= 0.2) return "split—neither clearly for nor against";
  if (score <= 0.55) return "cautiously supportive on balance";
  return "clearly supportive overall";
}

/** Layman wording for public mood from a −1…1 style score (no numbers). */
function scoreToPublicMoodLabel(score: number): string {
  if (score < -0.55) return "the tone is quite negative";
  if (score < -0.2) return "people sound guarded or uneasy";
  if (score <= 0.2) return "reaction is fairly neutral";
  if (score <= 0.55) return "the tone is mildly positive";
  return "the mood looks clearly positive";
}

function supportTrendLayman(t: "up" | "down" | "flat"): string {
  if (t === "up") return "Policy support has been building across the steps on the chart.";
  if (t === "down") return "Policy support has softened compared with earlier in the run.";
  return "Policy support has stayed in a similar range across the steps shown.";
}

function sentimentTrendLayman(t: "up" | "down" | "flat"): string {
  if (t === "up") return "Public sentiment has warmed.";
  if (t === "down") return "Public sentiment has cooled.";
  return "Public sentiment has held fairly steady.";
}

const EMPTY_EVENT_IDS: number[] = [];

function normalizeConfigEventIds(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [];
  const out: number[] = [];
  for (const x of raw) {
    const n = typeof x === "number" ? x : parseInt(String(x), 10);
    if (Number.isFinite(n) && n > 0) out.push(n);
  }
  return [...new Set(out)];
}

function avatarGradientClass(agentId: number): string {
  const palettes = [
    "bg-gradient-to-br from-sky-400 to-blue-600 text-white shadow-inner",
    "bg-gradient-to-br from-violet-400 to-fuchsia-600 text-white shadow-inner",
    "bg-gradient-to-br from-emerald-400 to-teal-600 text-white shadow-inner",
    "bg-gradient-to-br from-amber-400 to-orange-600 text-white shadow-inner",
    "bg-gradient-to-br from-rose-400 to-pink-600 text-white shadow-inner",
    "bg-gradient-to-br from-cyan-400 to-sky-700 text-white shadow-inner",
  ];
  return palettes[Math.abs(agentId) % palettes.length];
}
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { SimulationNetworkPanel } from "@/components/SimulationNetworkPanel";
import { consumeSSEStream, type SSEEvent } from "@/lib/sse";

type StreamPhase = "idle" | "init" | "loaded" | "beliefs" | "generation" | "writing" | "done" | "error";

interface AgentAction {
  agentId: number;
  agentName: string;
  action: string;
  sentiment: number;
  content: string;
}

export default function SimulationDetail() {
  const [, params] = useRoute("/simulations/:id");
  const id = parseInt(params?.id || "0");

  const queryClient = useQueryClient();
  const { data: sim, isLoading } = useGetSimulation(id);
  const { data: policiesData } = useListPolicies();
  const { data: postsData } = useGetSimulationPosts(id, { limit: 100 });
  const posts = normalizeApiArray<Post>(postsData);

  const { data: commentsRaw = [] } = useQuery({
    queryKey: [`/api/simulations/${id}/comments`],
    queryFn: () =>
      customFetch<GraphComment[]>(`/api/simulations/${id}/comments?limit=400`, {
        method: "GET",
      }),
    enabled: Number.isFinite(id) && id > 0,
  });

  const commentsByPostId = useMemo(() => {
    const m = new Map<number, GraphComment[]>();
    for (const c of commentsRaw) {
      const raw = c as GraphComment & { post_id?: number };
      const pid = Number(raw.postId ?? raw.post_id);
      if (!Number.isFinite(pid)) continue;
      if (!m.has(pid)) m.set(pid, []);
      m.get(pid)!.push(c);
    }
    for (const [, list] of m) {
      list.sort((a, b) => {
        const ta = a.createdAt ?? "";
        const tb = b.createdAt ?? "";
        if (ta && tb) return ta.localeCompare(tb);
        return a.round - b.round || a.id - b.id;
      });
    }
    return m;
  }, [commentsRaw]);

  const { data: eventsData, isLoading: eventsLoading } = useListEvents(undefined, {
    query: {
      queryKey: getListEventsQueryKey(),
      enabled: Number.isFinite(id) && id > 0,
    },
  });

  const globalCatalogEvents = useMemo(() => {
    const list = normalizeApiArray<Event>(eventsData);
    return list
      .filter((e) => e.simulationId == null)
      .sort((a, b) => (b.createdAt ?? "").localeCompare(a.createdAt ?? ""));
  }, [eventsData]);

  const savedEventIds = useMemo(() => {
    if (!sim) return EMPTY_EVENT_IDS;
    return normalizeConfigEventIds(sim.config.eventIds);
  }, [sim]);

  const [draftEventIds, setDraftEventIds] = useState<number[]>([]);
  const [eventPicker, setEventPicker] = useState("");
  const [savingEventSelection, setSavingEventSelection] = useState(false);

  useEffect(() => {
    setDraftEventIds(savedEventIds);
  }, [savedEventIds]);

  const eventSelectionDirty =
    draftEventIds.length !== savedEventIds.length ||
    draftEventIds.some((x, i) => x !== savedEventIds[i]);

  const draftResolvedEvents = useMemo(() => {
    const m = new Map(globalCatalogEvents.map((e) => [e.id, e]));
    return draftEventIds.map((eid) => m.get(eid)).filter(Boolean) as Event[];
  }, [draftEventIds, globalCatalogEvents]);

  const handleAddPickedEvent = useCallback(() => {
    const eid = parseInt(eventPicker, 10);
    if (!Number.isFinite(eid) || eid <= 0) return;
    if (!globalCatalogEvents.some((e) => e.id === eid)) return;
    setDraftEventIds((prev) => (prev.includes(eid) ? prev : [...prev, eid]));
    setEventPicker("");
  }, [eventPicker, globalCatalogEvents]);

  const handleSaveEventSelection = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0) return;
    setSavingEventSelection(true);
    try {
      await patchSimulationConfig(id, { eventIds: draftEventIds });
      await queryClient.invalidateQueries({ queryKey: getGetSimulationQueryKey(id) });
      toast({ title: "Selection saved", description: "These catalog events will be used on the next round." });
    } catch (err) {
      toast({
        variant: "destructive",
        title: "Could not save selection",
        description: err instanceof ApiError ? err.message : err instanceof Error ? err.message : "Try again.",
      });
    } finally {
      setSavingEventSelection(false);
    }
  }, [id, draftEventIds, queryClient]);

  const [isRunning, setIsRunning] = useState(false);
  const [streamPhase, setStreamPhase] = useState<StreamPhase>("idle");
  const [streamMessage, setStreamMessage] = useState("");
  const [streamProgress, setStreamProgress] = useState<{ current: number; total: number } | null>(null);
  const [liveActions, setLiveActions] = useState<AgentAction[]>([]);
  /** Drives graph node pulse on the Network tab during SSE (generation phase). */
  const [streamGraphHighlightAgentId, setStreamGraphHighlightAgentId] = useState<number | null>(null);
  /** `null` = show full graph; `[]` = round started, empty canvas; ids = only those nodes visible (SSE). */
  const [streamRevealedAgentIds, setStreamRevealedAgentIds] = useState<number[] | null>(null);
  const [beliefDecodeLoading, setBeliefDecodeLoading] = useState(false);
  const [beliefDecodeError, setBeliefDecodeError] = useState<string | null>(null);
  const [beliefDecodeReport, setBeliefDecodeReport] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      abortRef.current?.abort();
      abortRef.current = null;
    };
  }, []);

  const handleRunRound = useCallback(() => {
    if (isRunning) return;
    setIsRunning(true);
    setStreamPhase("init");
    setStreamMessage("Starting round...");
    setStreamProgress(null);
    setLiveActions([]);
    setStreamGraphHighlightAgentId(null);
    setStreamRevealedAgentIds([]);

    const abort = new AbortController();
    abortRef.current = abort;

    // SSE often delivers many `agent_action` lines in one synchronous read; React 18 batches
    // those setStates into one paint → all graph nodes appear at once. Queue and apply one
    // event per animation frame so the graph grows visibly.
    type AgentActionEvt = SSEEvent &
      AgentAction & { current?: number; total?: number };
    const agentActionQueue: AgentActionEvt[] = [];
    let agentActionRaf: number | null = null;

    const applyOneAgentAction = (e: AgentActionEvt) => {
      if (!mountedRef.current) return;
      const aid = typeof e.agentId === "number" ? e.agentId : Number(e.agentId);
      if (!Number.isFinite(aid)) return;
      setStreamGraphHighlightAgentId(aid);
      setStreamRevealedAgentIds((prev) =>
        prev === null ? null : [...new Set([...prev, aid])],
      );
      setLiveActions((prev) => [
        ...prev.slice(-19),
        {
          agentId: aid,
          agentName: String(e.agentName ?? ""),
          action: String(e.action ?? ""),
          sentiment: typeof e.sentiment === "number" ? e.sentiment : Number(e.sentiment) || 0,
          content: String(e.content ?? ""),
        },
      ]);
      if (e.current != null && e.total != null) {
        const cur = Number(e.current);
        const tot = Number(e.total);
        if (Number.isFinite(cur) && Number.isFinite(tot) && tot > 0) {
          setStreamProgress({ current: cur, total: tot });
        }
      }
      setStreamMessage(`Agent ${e.agentName ?? "?"}: ${e.action ?? "?"}`);
    };

    const flushAgentActionQueueSync = () => {
      while (agentActionQueue.length > 0) {
        applyOneAgentAction(agentActionQueue.shift()!);
      }
    };

    const scheduleNextAgentActionFrame = () => {
      if (agentActionRaf != null) return;
      agentActionRaf = requestAnimationFrame(() => {
        agentActionRaf = null;
        if (!mountedRef.current) {
          agentActionQueue.length = 0;
          return;
        }
        const next = agentActionQueue.shift();
        if (next) applyOneAgentAction(next);
        if (agentActionQueue.length > 0) scheduleNextAgentActionFrame();
      });
    };

    const enqueueAgentAction = (e: AgentActionEvt) => {
      agentActionQueue.push(e);
      scheduleNextAgentActionFrame();
    };

    consumeSSEStream({
      url: `/api/simulations/${id}/run-stream`,
      signal: abort.signal,
      onEvent: (event: SSEEvent) => {
        if (event.type === "status") {
          const e = event as SSEEvent & { phase?: string; message?: string; current?: number; total?: number };
          setStreamPhase((e.phase as StreamPhase) || "init");
          if (e.message) setStreamMessage(e.message);
          if (e.current != null && e.total != null) {
            setStreamProgress({ current: e.current, total: e.total });
          }
          const ph = e.phase;
          if (ph && ph !== "generation") {
            setStreamGraphHighlightAgentId(null);
          }
        } else if (event.type === "agent_action") {
          enqueueAgentAction(event as AgentActionEvt);
        } else if (event.type === "complete") {
          if (agentActionRaf != null) {
            cancelAnimationFrame(agentActionRaf);
            agentActionRaf = null;
          }
          flushAgentActionQueueSync();
          setStreamGraphHighlightAgentId(null);
          setStreamRevealedAgentIds(null);
          setStreamPhase("done");
          setStreamMessage("Round complete!");
          queueMicrotask(() => {
            queryClient.invalidateQueries({ queryKey: [`/api/simulations/${id}`] });
            queryClient.invalidateQueries({ queryKey: [`/api/simulations/${id}/posts`] });
            queryClient.invalidateQueries({ queryKey: [`/api/simulations/${id}/comments`] });
            queryClient.invalidateQueries({ queryKey: [`/api/simulations/${id}/graph`] });
          });
        }
      },
      onError: (msg) => {
        if (agentActionRaf != null) {
          cancelAnimationFrame(agentActionRaf);
          agentActionRaf = null;
        }
        flushAgentActionQueueSync();
        setStreamGraphHighlightAgentId(null);
        setStreamRevealedAgentIds(null);
        setStreamPhase("error");
        setStreamMessage(msg);
      },
      onDone: () => {
        if (agentActionRaf != null) {
          cancelAnimationFrame(agentActionRaf);
          agentActionRaf = null;
        }
        flushAgentActionQueueSync();
        setIsRunning(false);
        setStreamRevealedAgentIds(null);
        setTimeout(() => {
          if (abortRef.current === abort) {
            setStreamPhase("idle");
            setStreamMessage("");
            setStreamProgress(null);
          }
        }, 3000);
      },
    });
  }, [id, isRunning, queryClient]);

  const mockEvolutionData = useMemo(() => {
    if (!sim) return [];
    return Array.from({ length: sim.currentRound + 1 }).map((_, i) => ({
      round: i,
      support: 0.2 + Math.sin(i * 0.5) * 0.3 + i * 0.05,
      sentiment: 0.5 + Math.cos(i * 0.5) * 0.2,
    }));
  }, [sim]);

  const beliefChartStateSummary = useMemo(() => {
    const data = mockEvolutionData;
    if (data.length === 0) return null;
    const first = data[0];
    const last = data[data.length - 1];
    const eps = 0.02;
    const trend = (a: number, b: number): "up" | "down" | "flat" =>
      b - a > eps ? "up" : b - a < -eps ? "down" : "flat";
    return {
      roundCount: data.length,
      lastRound: last.round,
      supportTrend: trend(first.support, last.support),
      sentimentTrend: trend(first.sentiment, last.sentiment),
      lastSupport: last.support,
      lastSentiment: last.sentiment,
    };
  }, [mockEvolutionData]);

  const handleDecodeBeliefChart = useCallback(async () => {
    if (!Number.isFinite(id) || id <= 0 || mockEvolutionData.length === 0) return;
    setBeliefDecodeLoading(true);
    setBeliefDecodeError(null);
    try {
      const res = await customFetch<{ report: string }>(`/api/simulations/${id}/decode-belief-chart`, {
        method: "POST",
        body: JSON.stringify({ series: mockEvolutionData }),
      });
      setBeliefDecodeReport(res.report);
    } catch (e) {
      setBeliefDecodeReport(null);
      setBeliefDecodeError(
        e instanceof ApiError ? e.message : e instanceof Error ? e.message : "Could not generate the report. Try again.",
      );
    } finally {
      setBeliefDecodeLoading(false);
    }
  }, [id, mockEvolutionData]);

  if (isLoading || !sim) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading simulation core...</div>;

  const policyList = normalizeApiArray<Policy>(policiesData);
  const policyId = sim.config.policyId;
  const linkedPolicy =
    policyId != null && policyId > 0 ? policyList.find((p) => p.id === policyId) : undefined;
  const groupIds = sim.config.groupIds?.filter((g) => g > 0) ?? [];

  const progressPct =
    streamProgress && streamProgress.total > 0
      ? Math.round((streamProgress.current / streamProgress.total) * 100)
      : 0;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4 text-sm text-muted-foreground mb-4">
        <Link href="/simulations" className="hover:text-foreground flex items-center gap-1 transition-colors">
          <ArrowLeft className="w-4 h-4" /> Back to List
        </Link>
      </div>

      <div className="flex flex-col lg:flex-row justify-between items-start lg:items-center gap-4 bg-card border border-border p-6 rounded-2xl shadow-lg relative overflow-hidden">
        <div className="absolute top-0 right-0 p-8 opacity-5">
          <Activity className="w-32 h-32 text-primary" />
        </div>

        <div className="relative z-10">
          <div className="flex items-center gap-3 mb-1">
            <h1 className="text-2xl font-bold text-foreground">{sim.name}</h1>
            <span className={`px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-wider ${
              sim.status === 'running' ? 'bg-primary/10 text-primary border border-primary/20' :
              sim.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
              'bg-secondary text-secondary-foreground border border-border'
            }`}>
              {sim.status}
            </span>
          </div>
          <p className="text-muted-foreground text-sm max-w-2xl">{sim.description}</p>
        </div>

        <div className="flex items-center gap-3 relative z-10 bg-background/50 p-2 rounded-xl border border-border/50 backdrop-blur-sm">
          <div className="px-4 py-2 text-center border-r border-border/50">
            <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Round</div>
            <div className="font-mono text-xl font-bold text-primary">{sim.currentRound} <span className="text-sm text-muted-foreground">/ {sim.config.numRounds}</span></div>
          </div>
          <div className="px-4 py-2">
            <button
              onClick={handleRunRound}
              disabled={isRunning || sim.status === 'completed'}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-[0_0_15px_rgba(14,165,233,0.3)] hover:shadow-[0_0_25px_rgba(14,165,233,0.5)] disabled:opacity-50 disabled:shadow-none transition-all"
            >
              {isRunning ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
              {isRunning ? "Computing..." : "Execute Round"}
            </button>
          </div>
        </div>
      </div>

      {/* Live Stream Panel */}
      {streamPhase !== "idle" && (
        <div className={`bg-card border rounded-2xl shadow-lg overflow-hidden transition-all ${
          streamPhase === "error" ? "border-destructive/50" :
          streamPhase === "done" ? "border-emerald-500/50" :
          "border-primary/50"
        }`}>
          <div className={`px-5 py-3 flex items-center justify-between ${
            streamPhase === "error" ? "bg-destructive/10" :
            streamPhase === "done" ? "bg-emerald-500/10" :
            "bg-primary/10"
          }`}>
            <div className="flex items-center gap-2">
              <Radio className={`w-4 h-4 ${isRunning ? "animate-pulse text-primary" : streamPhase === "done" ? "text-emerald-400" : "text-destructive"}`} />
              <span className="text-sm font-semibold">
                {streamPhase === "done" ? "Round Complete" : streamPhase === "error" ? "Error" : "Live Stream"}
              </span>
            </div>
            <span className="text-xs font-mono text-muted-foreground">{streamMessage}</span>
          </div>

          {streamProgress && isRunning && (
            <div className="px-5 py-2 border-t border-border/30">
              <div className="flex items-center gap-3">
                <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                  <div
                    className="h-full bg-primary transition-all duration-300 rounded-full"
                    style={{ width: `${progressPct}%` }}
                  />
                </div>
                <span className="text-xs font-mono text-muted-foreground w-16 text-right">
                  {streamProgress.current}/{streamProgress.total}
                </span>
              </div>
            </div>
          )}

          {liveActions.length > 0 && (
            <div className="max-h-48 overflow-y-auto border-t border-border/30">
              {liveActions.map((a, i) => (
                <div key={i} className="flex items-center gap-3 px-5 py-1.5 text-xs border-b border-border/20 last:border-0">
                  <span className={`w-2 h-2 rounded-full shrink-0 ${
                    a.action === "post" ? "bg-primary" : a.action === "comment" ? "bg-accent" : "bg-muted-foreground"
                  }`} />
                  <span className="font-medium w-32 truncate">{a.agentName}</span>
                  <span className={`w-16 text-center rounded px-1.5 py-0.5 font-mono uppercase text-[10px] ${
                    a.action === "post" ? "bg-primary/10 text-primary" :
                    a.action === "comment" ? "bg-accent/10 text-accent" :
                    "bg-secondary text-muted-foreground"
                  }`}>{a.action}</span>
                  <span className="text-muted-foreground flex-1 truncate">{a.content}</span>
                  <span className={`font-mono w-12 text-right ${
                    a.sentiment > 0 ? "text-emerald-400" : a.sentiment < 0 ? "text-destructive" : "text-muted-foreground"
                  }`}>{formatScore(a.sentiment)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}

      <Tabs defaultValue="overview" className="space-y-6">
        <TabsList className="grid w-full max-w-4xl grid-cols-2 sm:grid-cols-4 h-auto p-1 gap-1">
          <TabsTrigger value="overview" className="gap-2 py-2 text-xs sm:text-sm">
            <Activity className="w-4 h-4 shrink-0" />
            <span className="truncate">Overview</span>
          </TabsTrigger>
          <TabsTrigger value="config" className="gap-2 py-2 text-xs sm:text-sm">
            <Settings className="w-4 h-4 shrink-0" />
            <span className="truncate">Config</span>
          </TabsTrigger>
          <TabsTrigger value="beliefs" className="gap-2 py-2 text-xs sm:text-sm">
            <BarChart2 className="w-4 h-4 shrink-0" />
            <span className="truncate">Belief trajectory</span>
          </TabsTrigger>
          <TabsTrigger value="network" className="gap-2 py-2 text-xs sm:text-sm">
            <Network className="w-4 h-4 shrink-0" />
            <span className="hidden sm:inline truncate">Graph &amp; conversations</span>
            <span className="sm:hidden">Graph</span>
          </TabsTrigger>
        </TabsList>

        <TabsContent value="config" className="mt-0 space-y-6">
          <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
            <div className="flex items-center gap-2 border-b border-border/60 bg-secondary/20 px-5 py-3">
              <Settings className="w-5 h-5 text-primary shrink-0" />
              <div>
                <h2 className="text-sm font-semibold tracking-tight text-foreground">Simulation configuration</h2>
                <p className="text-[11px] text-muted-foreground">All settings stored for this run (read-only)</p>
              </div>
            </div>
            <div className="p-5 grid grid-cols-1 md:grid-cols-2 gap-x-10 gap-y-4 text-sm">
              <dl className="space-y-3 md:col-span-1">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Simulation ID</dt>
                  <dd className="font-mono text-foreground">{sim.id}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Created</dt>
                  <dd className="text-foreground">{formatConfigDate(sim.createdAt)}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Status</dt>
                  <dd className="text-foreground capitalize">{sim.status}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Rounds</dt>
                  <dd className="text-foreground">
                    <span className="font-mono">{sim.currentRound}</span>
                    <span className="text-muted-foreground"> current · </span>
                    <span className="font-mono">{sim.config.numRounds}</span>
                    <span className="text-muted-foreground"> planned</span>
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Learning rate (α)</dt>
                  <dd className="font-mono text-foreground">{sim.config.learningRate}</dd>
                </div>
              </dl>
              <dl className="space-y-3 md:col-span-1">
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Agent count (config)</dt>
                  <dd className="font-mono text-foreground">{sim.config.agentCount}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Agents in simulation</dt>
                  <dd className="font-mono text-foreground">{sim.totalAgents}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Posts (total)</dt>
                  <dd className="font-mono text-foreground">{sim.totalPosts}</dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Target policy</dt>
                  <dd className="text-foreground">
                    {policyId != null && policyId > 0 ? (
                      <>
                        <Link href="/policies" className="text-primary font-medium hover:underline">
                          {linkedPolicy?.title ?? `Policy #${policyId}`}
                        </Link>
                        <span className="text-muted-foreground font-mono text-xs ml-1">(id {policyId})</span>
                      </>
                    ) : (
                      <span className="text-muted-foreground">None (baseline)</span>
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Cohort groups</dt>
                  <dd className="text-foreground">
                    {groupIds.length > 0 ? (
                      <span className="flex flex-wrap gap-1.5">
                        {groupIds.map((gid) => (
                          <Link
                            key={gid}
                            href="/groups"
                            className="inline-flex items-center rounded-md border border-border bg-secondary/40 px-2 py-0.5 font-mono text-xs text-primary hover:bg-secondary/70"
                          >
                            Group #{gid}
                          </Link>
                        ))}
                      </span>
                    ) : (
                      <span className="text-muted-foreground">None — agents from template or pool clone only in config</span>
                    )}
                  </dd>
                </div>
                <div className="flex flex-col gap-0.5">
                  <dt className="text-xs font-medium uppercase tracking-wider text-muted-foreground">External events (in rounds)</dt>
                  <dd className="text-foreground">
                    {eventsLoading ? (
                      <span className="text-muted-foreground animate-pulse">Loading…</span>
                    ) : savedEventIds.length === 0 ? (
                      <span className="text-muted-foreground">
                        None selected — pick global catalog events below (create them on the{" "}
                        <Link href="/events" className="text-primary font-medium hover:underline">
                          Events
                        </Link>{" "}
                        page).
                      </span>
                    ) : (
                      <span>
                        <span className="font-medium text-emerald-600 dark:text-emerald-400">Yes</span>
                        <span className="text-muted-foreground">
                          {" "}
                          — {savedEventIds.length} catalog event{savedEventIds.length === 1 ? "" : "s"} included in agent and
                          orchestrator prompts when you run a round.
                          {eventSelectionDirty ? (
                            <span className="text-amber-600 dark:text-amber-400"> Unsaved changes.</span>
                          ) : null}
                        </span>
                      </span>
                    )}
                  </dd>
                </div>
              </dl>
              <div className="md:col-span-2 flex flex-col gap-3 pt-3 border-t border-border/50">
                <div className="flex flex-wrap items-center gap-2">
                  <Zap className="h-4 w-4 text-amber-500 shrink-0" aria-hidden />
                  <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
                    Catalog events for this run
                  </div>
                  <Link href="/events" className="ml-auto text-xs font-medium text-primary hover:underline">
                    Manage catalog
                  </Link>
                </div>
                <p className="text-[11px] text-muted-foreground m-0 leading-relaxed">
                  Choose from the shared global event catalog (not tied to any simulation). Your selection is stored on this run’s
                  config and passed into each round’s prompts in the order shown.
                </p>

                <div className="rounded-xl border border-amber-500/25 bg-amber-500/[0.06] dark:bg-amber-500/10 p-3 sm:p-4 space-y-3">
                  <div className="flex flex-col sm:flex-row sm:flex-wrap gap-2 sm:items-end">
                    <div className="flex-1 min-w-[12rem] space-y-1">
                      <label htmlFor="sim-event-picker" className="text-[11px] font-medium text-muted-foreground">
                        Add from catalog
                      </label>
                      <select
                        id="sim-event-picker"
                        value={eventPicker}
                        onChange={(ev) => setEventPicker(ev.target.value)}
                        disabled={savingEventSelection || globalCatalogEvents.length === 0}
                        className="w-full bg-background/80 border border-border rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-1 focus:ring-amber-500/50"
                      >
                        <option value="">Select an event…</option>
                        {globalCatalogEvents
                          .filter((e) => !draftEventIds.includes(e.id))
                          .map((e) => (
                            <option key={e.id} value={e.id}>
                              #{e.id} · {e.type}
                            </option>
                          ))}
                      </select>
                    </div>
                    <Button
                      type="button"
                      variant="secondary"
                      disabled={!eventPicker || savingEventSelection}
                      onClick={handleAddPickedEvent}
                      className="w-full sm:w-auto"
                    >
                      Add to selection
                    </Button>
                    <Button
                      type="button"
                      disabled={!eventSelectionDirty || savingEventSelection}
                      onClick={() => void handleSaveEventSelection()}
                      className="w-full sm:w-auto bg-amber-600 hover:bg-amber-500 text-amber-50"
                    >
                      {savingEventSelection ? (
                        <>
                          <RefreshCw className="h-4 w-4 mr-2 animate-spin" />
                          Saving…
                        </>
                      ) : (
                        "Save selection"
                      )}
                    </Button>
                  </div>
                  {globalCatalogEvents.length === 0 && !eventsLoading ? (
                    <p className="text-[11px] text-muted-foreground m-0">
                      No global catalog events yet. Create them on the Events page — they are not scoped to a simulation.
                    </p>
                  ) : null}
                  {draftResolvedEvents.length > 0 ? (
                    <ul className="m-0 list-none p-0 space-y-2">
                      {draftResolvedEvents.map((ev) => (
                        <li
                          key={ev.id}
                          className="flex gap-2 rounded-lg border border-border/80 bg-background/60 px-3 py-2 text-xs sm:text-sm"
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2 gap-y-1">
                              <span className="font-mono text-[10px] text-muted-foreground">#{ev.id}</span>
                              <span className="font-medium text-foreground">{ev.type}</span>
                              <span className="font-mono text-[11px] text-muted-foreground tabular-nums">
                                impact {formatScore(ev.impactScore)}
                              </span>
                            </div>
                            <p className="mt-1 m-0 text-muted-foreground leading-snug line-clamp-3">{ev.description}</p>
                          </div>
                          <button
                            type="button"
                            className="shrink-0 self-start rounded-md border border-border px-2 py-1 text-[11px] font-medium text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
                            onClick={() => setDraftEventIds((prev) => prev.filter((x) => x !== ev.id))}
                            disabled={savingEventSelection}
                          >
                            Remove
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-[11px] text-muted-foreground m-0">No events in this run’s selection yet.</p>
                  )}
                </div>
              </div>
              <div className="md:col-span-2 flex flex-col gap-1.5 pt-3 border-t border-border/50">
                <div className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Description</div>
                <p className="text-sm text-foreground leading-relaxed whitespace-pre-wrap m-0">{sim.description || "—"}</p>
              </div>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="overview" className="mt-0 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div className="bg-card border border-border p-4 rounded-xl shadow-sm">
              <div className="text-xs text-muted-foreground mb-1">Total Agents Active</div>
              <div className="text-2xl font-mono font-semibold">{sim.totalAgents}</div>
            </div>
            <div className="bg-card border border-border p-4 rounded-xl shadow-sm">
              <div className="text-xs text-muted-foreground mb-1">Posts Generated</div>
              <div className="text-2xl font-mono font-semibold">{sim.totalPosts}</div>
            </div>
            <div className="bg-card border border-border p-4 rounded-xl shadow-sm">
              <div className="text-xs text-muted-foreground flex items-center justify-between mb-1">
                Learning Rate
                <span className="text-[10px] bg-primary/20 text-primary px-1.5 py-0.5 rounded">α</span>
              </div>
              <div className="text-2xl font-mono font-semibold text-accent">{sim.config.learningRate}</div>
            </div>
          </div>

          <div className="w-full rounded-2xl border border-border/80 bg-card shadow-sm ring-1 ring-black/[0.04] dark:ring-white/[0.06]">
            <div className="sticky top-0 z-[1] flex flex-wrap items-center justify-between gap-2 border-b border-border/60 bg-card/95 px-3 py-2.5 backdrop-blur-md sm:px-4">
              <div className="flex min-w-0 items-center gap-2">
                <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                  <MessageSquare className="h-4 w-4" strokeWidth={2} />
                </div>
                <div className="min-w-0 leading-tight">
                  <h3 className="text-sm font-semibold tracking-tight text-foreground">Simulation feed</h3>
                  <p className="text-[11px] text-muted-foreground">Posts and replies across rounds</p>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2 text-[11px] text-muted-foreground">
                <span className="rounded-full bg-muted/70 px-2 py-0.5 font-medium tabular-nums">
                  {posts.length} thread{posts.length === 1 ? "" : "s"}
                </span>
                <span className="hidden sm:inline">·</span>
                <span className="tabular-nums">R{sim.currentRound}</span>
              </div>
            </div>

            <div className="w-full px-2 py-2 sm:px-3 sm:py-3">
              {posts.length === 0 ? (
                <div className="flex flex-col items-center justify-center rounded-xl border border-dashed border-border/70 bg-muted/10 py-14 text-muted-foreground">
                  <MessageSquare className="mb-2 h-9 w-9 opacity-40" />
                  <p className="text-xs font-medium text-foreground/80">No posts yet</p>
                  <p className="mt-0.5 text-center text-[11px]">Run a round to populate the feed.</p>
                </div>
              ) : (
                <div className="flex w-full flex-col gap-2">
                  {posts.map((post) => {
                    const replies = commentsByPostId.get(post.id) ?? [];
                    const feedTime = shortFeedTime(post.createdAt);
                    const sentimentLabel =
                      post.sentiment > 0.15 ? "positive" : post.sentiment < -0.15 ? "negative" : "neutral";
                    return (
                      <article
                        key={post.id}
                        className="group w-full rounded-xl border border-border/70 bg-card transition-colors hover:border-border/90"
                      >
                        <div className="flex gap-2.5 p-3 sm:gap-3 sm:p-3.5">
                          <div
                            className={cn(
                              "mt-0.5 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[11px] font-bold ring-2 ring-background",
                              avatarGradientClass(post.agentId),
                            )}
                            aria-hidden
                          >
                            {initialsFromName(post.agentName)}
                          </div>
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-0.5 text-[13px]">
                              <span className="font-semibold text-foreground">{post.agentName}</span>
                              <span className="text-muted-foreground">@{post.agentId}</span>
                              {feedTime ? (
                                <>
                                  <span className="text-muted-foreground" aria-hidden>
                                    ·
                                  </span>
                                  <span className="text-xs text-muted-foreground">{feedTime}</span>
                                </>
                              ) : null}
                              <span className="text-muted-foreground" aria-hidden>
                                ·
                              </span>
                              <span className="rounded bg-muted/80 px-1 py-px text-[10px] font-medium text-foreground/90">
                                R{post.round}
                              </span>
                              {post.platform && post.platform !== "simulation" ? (
                                <span className="rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary">
                                  {post.platform}
                                </span>
                              ) : null}
                              {replies.length > 0 ? (
                                <span className="ml-auto inline-flex items-center gap-0.5 text-[11px] font-medium text-primary">
                                  <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                                  {replies.length}
                                </span>
                              ) : null}
                            </div>

                            <p className="mt-1.5 text-[13px] leading-snug text-foreground whitespace-pre-wrap sm:text-sm">
                              {post.content}
                            </p>

                            {post.topicTags && post.topicTags.length > 0 ? (
                              <div className="mt-1.5 flex flex-wrap gap-1">
                                {post.topicTags.map((tag) => (
                                  <span
                                    key={tag}
                                    className="rounded-full bg-primary/10 px-1.5 py-px text-[10px] font-medium text-primary"
                                  >
                                    #{tag}
                                  </span>
                                ))}
                              </div>
                            ) : null}

                            <div className="mt-1.5 flex flex-wrap items-center gap-2">
                              <span
                                className={cn(
                                  "inline-flex rounded-full border px-1.5 py-px text-[10px] font-medium",
                                  sentimentLabel === "positive" &&
                                    "border-emerald-500/30 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400",
                                  sentimentLabel === "negative" &&
                                    "border-destructive/30 bg-destructive/10 text-destructive",
                                  sentimentLabel === "neutral" &&
                                    "border-border bg-muted/50 text-muted-foreground",
                                )}
                              >
                                {formatScore(post.sentiment)}
                              </span>
                            </div>

                            {/* Replies directly under post so they stay in view */}
                            {replies.length > 0 ? (
                              <div
                                className="mt-2.5 border-l-2 border-primary/35 pl-3"
                                role="list"
                                aria-label={`${replies.length} repl${replies.length === 1 ? "y" : "ies"}`}
                              >
                                <div className="mb-1.5 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">
                                  <CornerDownRight className="h-3 w-3" />
                                  Replies
                                </div>
                                <ul className="space-y-2">
                                  {replies.map((reply) => (
                                    <li key={reply.id} className="flex gap-2" role="listitem">
                                      <div
                                        className={cn(
                                          "mt-0.5 flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-[9px] font-bold ring-1 ring-border",
                                          avatarGradientClass(reply.agentId),
                                        )}
                                        aria-hidden
                                      >
                                        {initialsFromName(reply.agentName)}
                                      </div>
                                      <div className="min-w-0 flex-1 rounded-lg bg-muted/40 px-2 py-1.5 ring-1 ring-border/50">
                                        <div className="flex flex-wrap items-baseline gap-x-1.5 gap-y-0 text-[11px]">
                                          <span className="font-semibold text-foreground">{reply.agentName}</span>
                                          <span className="text-muted-foreground">@{reply.agentId}</span>
                                          <span className="text-muted-foreground">· r{reply.round}</span>
                                          <span
                                            className={cn(
                                              "font-mono text-[10px]",
                                              reply.sentiment > 0.15
                                                ? "text-emerald-600 dark:text-emerald-400"
                                                : reply.sentiment < -0.15
                                                  ? "text-destructive"
                                                  : "text-muted-foreground",
                                            )}
                                          >
                                            {formatScore(reply.sentiment)}
                                          </span>
                                        </div>
                                        <p className="mt-0.5 text-[12px] leading-snug text-foreground whitespace-pre-wrap">
                                          {reply.content}
                                        </p>
                                      </div>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}

                            <div
                              className="mt-2 flex items-center gap-3 border-t border-border/40 pt-2 text-[11px] text-muted-foreground"
                              role="group"
                              aria-label="Post actions"
                            >
                              <span className="inline-flex items-center gap-1 font-medium text-foreground/70">
                                <MessageCircle className="h-3.5 w-3.5" strokeWidth={2} />
                                {replies.length}
                              </span>
                              <span className="inline-flex opacity-35">
                                <Repeat2 className="h-3.5 w-3.5" strokeWidth={2} />
                              </span>
                              <span className="inline-flex opacity-35">
                                <Heart className="h-3.5 w-3.5" strokeWidth={2} />
                              </span>
                              <span className="inline-flex opacity-35">
                                <Share2 className="h-3.5 w-3.5" strokeWidth={2} />
                              </span>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        </TabsContent>

        <TabsContent value="beliefs" className="mt-0 space-y-5">
          <div className="bg-card border border-border p-6 rounded-2xl shadow-sm min-h-[360px] h-[min(480px,50vh)] flex flex-col w-full">
            <div className="mb-4 shrink-0 flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div className="min-w-0">
                <h3 className="font-semibold flex items-center gap-2 text-lg">
                  <BarChart2 className="w-5 h-5 text-primary" />
                  Belief evolution trajectory
                </h3>
                <p className="text-xs text-muted-foreground mt-1">
                  Illustrative policy support and public sentiment by round (placeholder series until wired to snapshots).
                </p>
              </div>
              <div className="flex shrink-0 flex-col items-stretch gap-1.5 sm:items-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  className="gap-2 rounded-xl font-medium shadow-sm"
                  disabled={beliefDecodeLoading || mockEvolutionData.length === 0}
                  onClick={() => void handleDecodeBeliefChart()}
                >
                  {beliefDecodeLoading ? (
                    <RefreshCw className="h-4 w-4 animate-spin" strokeWidth={2} />
                  ) : (
                    <Sparkles className="h-4 w-4" strokeWidth={2} />
                  )}
                  Decode the graph
                </Button>
                <span className="text-[10px] text-muted-foreground sm:text-right">PwC GenAI · plain-English summary</span>
              </div>
            </div>
            {beliefDecodeError ? (
              <div className="mb-3 rounded-xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive" role="alert">
                {beliefDecodeError}
              </div>
            ) : null}
            {beliefDecodeReport ? (
              <div className="mb-4 shrink-0 rounded-xl border border-primary/20 bg-primary/[0.04] px-4 py-3 ring-1 ring-border/40">
                <p className="text-[11px] font-semibold uppercase tracking-wide text-primary">GenAI read on this chart</p>
                <p className="mt-2 text-sm leading-relaxed text-foreground whitespace-pre-wrap">{beliefDecodeReport}</p>
              </div>
            ) : null}
            <div className="flex-1 w-full min-h-[240px]">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mockEvolutionData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="round" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} domain={[-1, 1]} />
                  <Tooltip
                    contentStyle={{ backgroundColor: "hsl(var(--card))", borderColor: "hsl(var(--border))", borderRadius: "8px" }}
                    itemStyle={{ color: "hsl(var(--foreground))" }}
                  />
                  <Line type="monotone" dataKey="support" name="Policy Support" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4, fill: "hsl(var(--background))", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="sentiment" name="Public Sentiment" stroke="hsl(var(--accent))" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>

          <section
            className="w-full rounded-2xl border border-primary/20 bg-gradient-to-br from-primary/[0.08] via-muted/30 to-card p-6 shadow-md ring-1 ring-border/60"
            aria-labelledby="beliefs-chart-guide-heading"
          >
            <div className="flex flex-col gap-5 sm:flex-row sm:items-start sm:gap-6">
              <div
                className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary/15 text-primary shadow-sm"
                aria-hidden
              >
                <Info className="h-5 w-5" strokeWidth={2} />
              </div>
              <div className="min-w-0 flex-1 space-y-5">
                <div>
                  <h4 id="beliefs-chart-guide-heading" className="text-base font-semibold tracking-tight text-foreground">
                    How to read this chart
                  </h4>
                  <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                    The bottom axis is <span className="font-medium text-foreground">time in rounds</span> (from the first round through round{" "}
                    {beliefChartStateSummary?.lastRound ?? sim.currentRound}). The vertical scale is a simple{" "}
                    <span className="font-medium text-foreground">support score</span>: lower means more pushback, higher means more buy-in (from −1 to +1).
                  </p>
                  <ul className="mt-4 space-y-2.5 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                    <li className="flex gap-3">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-primary" aria-hidden />
                      <span>
                        <span className="font-medium text-foreground">Policy support</span> — how strongly agents back the policy or option you are testing.
                      </span>
                    </li>
                    <li className="flex gap-3">
                      <span className="mt-2 h-2 w-2 shrink-0 rounded-full bg-[hsl(var(--accent))]" aria-hidden />
                      <span>
                        <span className="font-medium text-foreground">Public sentiment</span> — the broader mood or perception in the simulation.
                      </span>
                    </li>
                  </ul>
                  <p className="mt-4 rounded-xl border border-border/70 bg-background/80 px-4 py-3 text-sm leading-relaxed text-muted-foreground">
                    Today this chart uses <span className="font-medium text-foreground">sample curves</span> so you can see the layout. When your environment saves real belief snapshots, these lines will reflect actual results from each round.
                  </p>
                </div>
                {beliefChartStateSummary ? (
                  <div className="border-t border-border/60 pt-5">
                    <p className="text-xs font-semibold uppercase tracking-wider text-primary">Summary for this run</p>
                    <p className="mt-2 text-[15px] leading-relaxed text-muted-foreground sm:text-base">
                      {beliefChartStateSummary.roundCount === 1
                        ? "You’re still at the opening step—think of this as a starting snapshot until more of the run is filled in."
                        : "You’re partway through the simulation; the chart summarizes how things have moved from the beginning up to now."}{" "}
                      {supportTrendLayman(beliefChartStateSummary.supportTrend)}{" "}
                      <span className="font-medium text-foreground">
                        At this point, stakeholders come across as {scoreToBackingLabel(beliefChartStateSummary.lastSupport)}.
                      </span>{" "}
                      {sentimentTrendLayman(beliefChartStateSummary.sentimentTrend)}{" "}
                      <span className="font-medium text-foreground">
                        {scoreToPublicMoodLabel(beliefChartStateSummary.lastSentiment).replace(/^./, (c) => c.toUpperCase())}.
                      </span>
                    </p>
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        </TabsContent>

        <TabsContent value="network" className="mt-0">
          <SimulationNetworkPanel
            simulationId={id}
            streamHighlightAgentId={streamGraphHighlightAgentId}
            streamPhase={streamPhase}
            progressiveRevealAgentIds={streamRevealedAgentIds}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
