import {
  useListSimulations,
  useListAgents,
  useListPolicies,
  useListGroups,
  useListEvents,
  useGetServiceStatus,
  getGetServiceStatusQueryKey,
  type Agent,
  type Event,
  type Group,
  type Policy,
  type ServiceStatus,
  type Simulation,
} from "@workspace/api-client-react";
import { useMemo, type ReactNode } from "react";
import {
  Activity,
  Users,
  TrendingUp,
  ArrowRight,
  Server,
  Database,
  Share2,
  Sparkles,
  Clock,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { cn, normalizeApiArray } from "@/lib/utils";

type StatusTone = "ok" | "warn" | "error" | "muted" | "loading";

function statusTone(tone: StatusTone): string {
  switch (tone) {
    case "ok":
      return "text-emerald-400";
    case "warn":
      return "text-amber-400";
    case "error":
      return "text-red-400";
    case "muted":
      return "text-muted-foreground";
    default:
      return "text-muted-foreground animate-pulse";
  }
}

function ConnectionCell(props: {
  label: string;
  detail: string;
  subDetail?: string;
  tone: StatusTone;
  icon: LucideIcon;
}) {
  const Icon = props.icon;
  return (
    <div className="group flex items-start gap-3 rounded-2xl border border-white/[0.06] bg-gradient-to-br from-background/70 via-background/40 to-background/20 p-4 shadow-sm transition-all duration-300 hover:border-primary/20 hover:shadow-[0_0_0_1px_hsl(var(--primary)_/_0.12),0_16px_40px_-24px_rgba(0,0,0,0.5)]">
      <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-primary/[0.08] text-primary ring-1 ring-primary/15 transition-colors group-hover:bg-primary/[0.12]">
        <Icon className="h-[18px] w-[18px]" />
      </div>
      <div className="min-w-0 flex-1 pt-0.5">
        <p className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground/90">
          {props.label}
        </p>
        <p className={`mt-1 text-sm font-semibold tracking-tight truncate ${statusTone(props.tone)}`}>
          {props.detail}
        </p>
        {props.subDetail ? (
          <p className="mt-1 text-xs text-muted-foreground truncate">{props.subDetail}</p>
        ) : null}
      </div>
    </div>
  );
}

function llmSubDetail(s: ServiceStatus | undefined): string | undefined {
  if (!s || s.llm !== "available") return undefined;
  const backendKey = s.llmBackend as string | null | undefined;
  const backend =
    backendKey === "pwc_genai"
      ? "PwC GenAI"
      : backendKey === "ollama"
        ? "Ollama"
        : backendKey === "openai_compatible"
          ? "OpenAI-compatible"
          : "LLM";
  if (s.llmModel) return `${backend} · ${s.llmModel}`;
  return backend;
}

function formatSnapshotTime(ts: number | undefined): string | null {
  if (ts == null || !Number.isFinite(ts)) return null;
  try {
    return new Date(ts).toLocaleString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
  } catch {
    return null;
  }
}

function HeroStat(props: {
  label: string;
  children: ReactNode;
  sub?: ReactNode;
  loading?: boolean;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col rounded-2xl border border-white/[0.06] bg-gradient-to-br from-background/50 via-background/30 to-transparent p-4 shadow-[inset_0_1px_0_hsl(var(--foreground)_/_0.04)] backdrop-blur-md transition-colors hover:border-white/[0.1]",
        props.className,
      )}
    >
      <p className="text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
        {props.label}
      </p>
      <div className="mt-2 min-h-[2rem] text-2xl font-semibold tabular-nums tracking-tight text-foreground">
        {props.loading ? <span className="text-muted-foreground">…</span> : props.children}
      </div>
      {props.sub ? (
        <div className="mt-1.5 text-xs leading-snug text-muted-foreground">{props.sub}</div>
      ) : null}
    </div>
  );
}

export default function Dashboard() {
  const {
    data: simulations,
    isLoading: isLoadingSims,
    dataUpdatedAt: simsDataUpdatedAt,
  } = useListSimulations();
  const {
    data: agents,
    isLoading: isLoadingAgents,
    dataUpdatedAt: agentsDataUpdatedAt,
  } = useListAgents();
  const {
    data: policies,
    isLoading: isLoadingPolicies,
    dataUpdatedAt: policiesDataUpdatedAt,
  } = useListPolicies();
  const {
    data: groups,
    isLoading: isLoadingGroups,
    dataUpdatedAt: groupsDataUpdatedAt,
  } = useListGroups();
  const {
    data: events,
    isLoading: isLoadingEvents,
    dataUpdatedAt: eventsDataUpdatedAt,
  } = useListEvents();
  const {
    data: serviceStatus,
    isLoading: statusLoading,
    isError: statusError,
  } = useGetServiceStatus({
    query: {
      queryKey: getGetServiceStatusQueryKey(),
      refetchInterval: 30_000,
      retry: 1,
    },
  });
  const statusUnreachable = statusError;

  const simRows = normalizeApiArray<Simulation>(simulations);
  const agentRows = normalizeApiArray<Agent>(agents);
  const policyRows = normalizeApiArray<Policy>(policies);
  const groupRows = normalizeApiArray<Group>(groups);
  const eventRows = normalizeApiArray<Event>(events);

  // Aggregate metrics
  const activeSims = simRows.filter((s) => s.status !== "completed").length;
  const totalAgents = agentRows.length;
  const avgSupport = agentRows.length
    ? agentRows.reduce((acc, a) => acc + a.beliefState.policySupport, 0) / agentRows.length
    : 0;

  const heroMetrics = useMemo(() => {
    const totalPosts = simRows.reduce((acc, s) => acc + (s.totalPosts ?? 0), 0);
    const plannedRounds = simRows.reduce((acc, s) => acc + (s.config?.numRounds ?? 0), 0);
    const progressRounds = simRows.reduce((acc, s) => acc + s.currentRound, 0);
    const roundPct =
      plannedRounds > 0 ? Math.min(100, Math.round((progressRounds / plannedRounds) * 100)) : 0;
    const avgConfidence = agentRows.length
      ? agentRows.reduce((acc, a) => acc + a.confidenceLevel, 0) / agentRows.length
      : 0;
    const policyIds = new Set<number>();
    const groupIds = new Set<number>();
    for (const s of simRows) {
      const pid = s.config?.policyId;
      if (pid != null) policyIds.add(pid);
      for (const gid of s.config?.groupIds ?? []) {
        if (gid != null) groupIds.add(gid);
      }
    }
    const latest =
      simRows.length > 0
        ? [...simRows].sort(
            (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
          )[0]
        : null;
    return {
      totalPosts,
      plannedRounds,
      progressRounds,
      roundPct,
      avgConfidence,
      simsReferencingPolicies: policyIds.size,
      simsReferencingGroups: groupIds.size,
      latest,
    };
  }, [simRows, agentRows]);

  const catalogLoading =
    isLoadingSims || isLoadingAgents || isLoadingPolicies || isLoadingGroups || isLoadingEvents;
  const listDataUpdatedAt = Math.max(
    simsDataUpdatedAt ?? 0,
    agentsDataUpdatedAt ?? 0,
    policiesDataUpdatedAt ?? 0,
    groupsDataUpdatedAt ?? 0,
    eventsDataUpdatedAt ?? 0,
  );
  const snapshotTimeLabel = formatSnapshotTime(
    listDataUpdatedAt > 0 ? listDataUpdatedAt : undefined,
  );
  const listsSettled = !catalogLoading;

  const container = {
    hidden: { opacity: 0 },
    show: {
      opacity: 1,
      transition: { staggerChildren: 0.1 }
    }
  };

  const item = {
    hidden: { opacity: 0, y: 20 },
    show: { opacity: 1, y: 0, transition: { type: "spring" as const, stiffness: 300, damping: 24 } }
  };

  return (
    <div className="space-y-10">
      <section className="relative overflow-hidden rounded-3xl border border-white/[0.08] bg-gradient-to-b from-card/[0.35] via-card/[0.12] to-transparent p-6 shadow-[inset_0_1px_0_hsl(var(--foreground)_/_0.05)] backdrop-blur-xl sm:p-8">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/[0.12] blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-56 w-56 rounded-full bg-accent/[0.08] blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
          <div className="min-w-0 flex-1 space-y-4">
            <div className="flex flex-wrap items-center gap-3">
              <span className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-primary/[0.12] px-3 py-1 text-[11px] font-semibold uppercase tracking-widest text-primary">
                <span className="relative flex h-2 w-2">
                  <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-primary/50 opacity-75" />
                  <span className="relative inline-flex h-2 w-2 rounded-full bg-primary shadow-[0_0_10px_hsl(var(--primary)_/_0.8)]" />
                </span>
                Live
              </span>
              <span className="hidden h-1 w-1 rounded-full bg-border sm:block" aria-hidden />
              <span className="text-xs font-medium tracking-wide text-muted-foreground">Dashboard</span>
              {listsSettled && snapshotTimeLabel ? (
                <span className="inline-flex items-center gap-1.5 rounded-full border border-white/[0.06] bg-background/30 px-2.5 py-1 text-[11px] text-muted-foreground">
                  <Clock className="h-3 w-3 opacity-70" aria-hidden />
                  <span className="font-mono tabular-nums text-muted-foreground/90">{snapshotTimeLabel}</span>
                </span>
              ) : null}
            </div>
            <div>
              <h1 className="text-3xl font-bold tracking-tight text-foreground sm:text-4xl md:text-[2.5rem] md:leading-[1.12]">
                <span className="bg-clip-text text-transparent bg-gradient-to-br from-foreground via-foreground to-foreground/50">
                  Engine overview
                </span>
              </h1>
              <p className="mt-3 max-w-2xl text-sm leading-relaxed text-muted-foreground sm:text-[15px]">
                Cross-catalog read on content and run depth—without repeating the KPI cards below. Open a row in{" "}
                <Link href="/simulations" className="font-medium text-primary underline-offset-4 hover:underline">
                  Simulations
                </Link>{" "}
                or{" "}
                <Link href="/agents" className="font-medium text-primary underline-offset-4 hover:underline">
                  Agents
                </Link>{" "}
                for live controls.
              </p>
            </div>
          </div>
        </div>

        <div className="relative mt-8 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6 lg:gap-4">
          <HeroStat
            label="Workspace"
            loading={catalogLoading}
            className="col-span-2 sm:col-span-3 lg:col-span-2"
            sub="Definitions available to wire into new runs."
          >
            <div className="mt-1 grid grid-cols-3 gap-3">
              <div>
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {isLoadingPolicies ? "…" : policyRows.length}
                </p>
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Policies
                </p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {isLoadingGroups ? "…" : groupRows.length}
                </p>
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Groups
                </p>
              </div>
              <div>
                <p className="text-2xl font-semibold tabular-nums text-foreground">
                  {isLoadingEvents ? "…" : eventRows.length}
                </p>
                <p className="mt-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
                  Events
                </p>
              </div>
            </div>
          </HeroStat>

          <HeroStat
            label="Posts generated"
            loading={isLoadingSims}
            sub="Cumulative synthetic posts across every simulation."
          >
            {heroMetrics.totalPosts.toLocaleString()}
          </HeroStat>

          <HeroStat label="Round depth" loading={isLoadingSims} sub="Σ current round vs Σ planned rounds.">
            <span className="text-xl sm:text-2xl">
              {heroMetrics.progressRounds}
              <span className="mx-0.5 font-normal text-muted-foreground">/</span>
              {heroMetrics.plannedRounds}
            </span>
            <div className="mt-3 h-1.5 overflow-hidden rounded-full bg-white/[0.06]">
              <div
                className="h-full rounded-full bg-gradient-to-r from-primary to-accent transition-[width] duration-500"
                style={{ width: `${heroMetrics.roundPct}%` }}
              />
            </div>
          </HeroStat>

          <HeroStat
            label="Avg confidence"
            loading={isLoadingAgents}
            sub="Mean agent confidence in the catalog (not policy support)."
          >
            {agentRows.length ? heroMetrics.avgConfidence.toFixed(2) : "—"}
          </HeroStat>

          <HeroStat
            label="Config hooks"
            loading={isLoadingSims}
            sub="Distinct policies / group lists referenced by at least one simulation."
          >
            <span className="text-xl sm:text-2xl">
              {heroMetrics.simsReferencingPolicies}
              <span className="mx-1 font-normal text-muted-foreground/80">·</span>
              {heroMetrics.simsReferencingGroups}
            </span>
          </HeroStat>

          <HeroStat
            label="Latest simulation"
            loading={isLoadingSims}
            className="col-span-2 sm:col-span-3 lg:col-span-6"
            sub={
              heroMetrics.latest
                ? new Date(heroMetrics.latest.createdAt).toLocaleString(undefined, {
                    dateStyle: "medium",
                    timeStyle: "short",
                  })
                : "Create a run to populate this tile."
            }
          >
            {heroMetrics.latest ? (
              <Link
                href={`/simulations/${heroMetrics.latest.id}`}
                className="block truncate text-left text-lg font-semibold text-foreground underline-offset-4 transition-colors hover:text-primary hover:underline"
              >
                {heroMetrics.latest.name}
              </Link>
            ) : (
              "—"
            )}
          </HeroStat>
        </div>
      </section>

      <div className="rounded-[1.25rem] border border-white/[0.07] bg-gradient-to-b from-card/90 to-card/50 p-5 shadow-sm backdrop-blur-sm md:p-6">
        <div className="mb-4 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 className="text-sm font-semibold tracking-tight text-foreground">
            Connection status
          </h2>
          <p className="text-xs text-muted-foreground">Infrastructure health · refreshed every 30s</p>
        </div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4 sm:gap-4">
          <ConnectionCell
            label="API"
            icon={Server}
            tone={statusError ? "error" : statusLoading ? "loading" : "ok"}
            detail={
              statusError
                ? "Unreachable"
                : statusLoading
                  ? "Checking…"
                  : "OK"
            }
          />
          <ConnectionCell
            label="PostgreSQL"
            icon={Database}
            tone={
              statusUnreachable
                ? "muted"
                : statusLoading
                  ? "loading"
                  : serviceStatus?.database === "connected"
                    ? "ok"
                    : "error"
            }
            detail={
              statusUnreachable
                ? "—"
                : statusLoading
                  ? "Checking…"
                  : serviceStatus?.database === "connected"
                    ? "Connected"
                    : "Error"
            }
          />
          <ConnectionCell
            label="Neo4j"
            icon={Share2}
            tone={
              statusUnreachable
                ? "muted"
                : statusLoading
                  ? "loading"
                  : serviceStatus?.neo4j === "connected"
                    ? "ok"
                    : serviceStatus?.neo4j === "disabled"
                      ? "muted"
                      : "error"
            }
            detail={
              statusUnreachable
                ? "—"
                : statusLoading
                  ? "Checking…"
                  : serviceStatus?.neo4j === "connected"
                    ? "Connected"
                    : serviceStatus?.neo4j === "disabled"
                      ? "Not configured"
                      : "Unavailable"
            }
          />
          <ConnectionCell
            label="LLM"
            icon={Sparkles}
            tone={
              statusUnreachable
                ? "muted"
                : statusLoading
                  ? "loading"
                  : serviceStatus?.llm === "available"
                    ? "ok"
                    : "warn"
            }
            detail={
              statusUnreachable
                ? "—"
                : statusLoading
                  ? "Checking…"
                  : serviceStatus?.llm === "available"
                    ? "Available"
                    : "Unavailable (deterministic mode)"
            }
            subDetail={
              statusUnreachable || statusLoading
                ? undefined
                : llmSubDetail(serviceStatus)
            }
          />
        </div>
      </div>

      <motion.div 
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4"
      >
        <motion.div variants={item} className="group relative overflow-hidden rounded-[1.25rem] border border-white/[0.06] bg-gradient-to-b from-card/95 to-card/50 p-6 shadow-sm transition-all duration-300 hover:border-primary/25 hover:shadow-[0_20px_50px_-28px_rgba(0,0,0,0.55)]">
          <div className="pointer-events-none absolute -right-4 -top-4 h-28 w-28 rounded-full bg-primary/10 blur-2xl transition-opacity group-hover:opacity-100" />
          <div className="absolute right-4 top-4 opacity-[0.12] transition-opacity group-hover:opacity-20">
            <Activity className="h-14 w-14 text-primary" />
          </div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Active Simulations</p>
          <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-foreground">
            {isLoadingSims ? "…" : activeSims}
            <span className="ml-2 text-lg font-normal text-muted-foreground">/ {simRows.length}</span>
          </div>
        </motion.div>

        <motion.div variants={item} className="group relative overflow-hidden rounded-[1.25rem] border border-white/[0.06] bg-gradient-to-b from-card/95 to-card/50 p-6 shadow-sm transition-all duration-300 hover:border-accent/30 hover:shadow-[0_20px_50px_-28px_rgba(0,0,0,0.55)]">
          <div className="pointer-events-none absolute -right-4 -top-4 h-28 w-28 rounded-full bg-accent/10 blur-2xl" />
          <div className="absolute right-4 top-4 opacity-[0.12] transition-opacity group-hover:opacity-20">
            <Users className="h-14 w-14 text-accent" />
          </div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Total Agents</p>
          <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-foreground">
            {isLoadingAgents ? "…" : totalAgents}
          </div>
        </motion.div>

        <motion.div variants={item} className="group relative overflow-hidden rounded-[1.25rem] border border-white/[0.06] bg-gradient-to-b from-card/95 to-card/50 p-6 shadow-sm transition-all duration-300 hover:border-emerald-500/25 hover:shadow-[0_20px_50px_-28px_rgba(0,0,0,0.55)]">
          <div className="pointer-events-none absolute -right-4 -top-4 h-28 w-28 rounded-full bg-emerald-500/10 blur-2xl" />
          <div className="absolute right-4 top-4 opacity-[0.12] transition-opacity group-hover:opacity-20">
            <TrendingUp className="h-14 w-14 text-emerald-500" />
          </div>
          <p className="text-xs font-medium uppercase tracking-wider text-muted-foreground">Global Avg Policy Support</p>
          <div className="mt-2 text-4xl font-bold tabular-nums tracking-tight text-foreground">
            {isLoadingAgents ? "…" : (avgSupport > 0 ? "+" : "") + avgSupport.toFixed(2)}
          </div>
        </motion.div>

        <motion.div variants={item} className="relative flex flex-col justify-center overflow-hidden rounded-[1.25rem] border border-primary/25 bg-gradient-to-br from-primary/15 via-primary/[0.08] to-accent/15 p-6 shadow-[0_0_40px_-12px_hsl(var(--primary)_/_0.35)]">
          <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(ellipse_at_80%_20%,hsl(var(--accent)_/_0.12),transparent_50%)]" />
          <h3 className="relative font-semibold text-lg tracking-tight">Ready to forecast?</h3>
          <p className="relative mt-1 text-sm text-muted-foreground">Spin up a new simulation in one click.</p>
          <Link 
            href="/simulations" 
            className="relative mt-4 inline-flex w-fit items-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 transition-all hover:bg-primary/90 hover:shadow-[0_0_24px_hsl(var(--primary)_/_0.35)]"
          >
            Create Simulation <ArrowRight className="h-4 w-4" />
          </Link>
        </motion.div>
      </motion.div>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <div className="flex items-end justify-between gap-4 border-b border-white/[0.06] pb-3">
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Recent Simulations</h2>
          </div>
          {isLoadingSims ? (
            <div className="flex h-48 items-center justify-center rounded-[1.25rem] border border-dashed border-white/[0.08] bg-background/20 text-sm text-muted-foreground">
              Loading…
            </div>
          ) : simRows.length === 0 ? (
            <div className="rounded-[1.25rem] border border-dashed border-white/[0.1] bg-gradient-to-b from-card/40 to-transparent p-10 text-center">
              <Activity className="mx-auto mb-4 h-12 w-12 text-muted-foreground/40" />
              <h3 className="text-lg font-semibold text-foreground">No simulations yet</h3>
              <p className="mt-1 text-sm text-muted-foreground">Start your first predictive model.</p>
              <Link href="/simulations" className="mt-5 inline-flex text-sm font-semibold text-primary hover:underline">
                Create one now
              </Link>
            </div>
          ) : (
            <div className="overflow-hidden rounded-[1.25rem] border border-white/[0.06] bg-card/30 shadow-sm">
              {simRows.slice(0, 5).map((sim, i) => (
                <Link key={sim.id} href={`/simulations/${sim.id}`} className="block">
                  <div
                    className={`flex flex-col gap-3 p-4 transition-colors hover:bg-primary/[0.04] sm:flex-row sm:items-center sm:justify-between sm:gap-4 ${
                      i > 0 ? "border-t border-white/[0.05]" : ""
                    } group`}
                  >
                    <div className="min-w-0 flex-1">
                      <h3 className="font-semibold text-foreground transition-colors group-hover:text-primary">
                        {sim.name}
                      </h3>
                      <p className="mt-0.5 line-clamp-1 text-sm text-muted-foreground">{sim.description}</p>
                    </div>
                    <div className="flex shrink-0 items-center gap-4 sm:text-right">
                      <div className="text-sm">
                        <div className="text-[10px] font-medium uppercase tracking-wider text-muted-foreground">Round</div>
                        <div className="font-mono text-sm font-medium tabular-nums">
                          {sim.currentRound} / {sim.config.numRounds}
                        </div>
                      </div>
                      <div
                        className={`rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-wider ${
                          sim.status === "running"
                            ? "border border-primary/25 bg-primary/10 text-primary"
                            : sim.status === "completed"
                              ? "border border-emerald-500/25 bg-emerald-500/10 text-emerald-400"
                              : "border border-border/60 bg-secondary/80 text-secondary-foreground"
                        }`}
                      >
                        {sim.status}
                      </div>
                    </div>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
