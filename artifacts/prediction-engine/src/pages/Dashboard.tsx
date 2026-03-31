import {
  useListSimulations,
  useListAgents,
  useGetServiceStatus,
  getGetServiceStatusQueryKey,
  type Agent,
  type ServiceStatus,
  type Simulation,
} from "@workspace/api-client-react";
import {
  Activity,
  Users,
  TrendingUp,
  ArrowRight,
  Server,
  Database,
  Share2,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { normalizeApiArray } from "@/lib/utils";

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
    <div className="flex items-start gap-2.5 rounded-xl bg-background/50 px-3 py-2.5 border border-border/40">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground mt-0.5" />
      <div className="min-w-0">
        <p className="text-xs text-muted-foreground">{props.label}</p>
        <p className={`text-sm font-medium truncate ${statusTone(props.tone)}`}>
          {props.detail}
        </p>
        {props.subDetail ? (
          <p className="text-xs text-muted-foreground truncate mt-0.5">{props.subDetail}</p>
        ) : null}
      </div>
    </div>
  );
}

function statusDotClass(tone: StatusTone): string {
  switch (tone) {
    case "ok":
      return "bg-emerald-500 shadow-[0_0_8px_rgba(52,211,153,0.5)]";
    case "warn":
      return "bg-amber-500";
    case "error":
      return "bg-red-500";
    case "muted":
      return "bg-muted-foreground/40";
    default:
      return "bg-muted-foreground/30 animate-pulse";
  }
}

function connectionToneFor(
  s: ServiceStatus | undefined,
  key: "api" | "database" | "neo4j" | "llm",
  unreachable: boolean,
  loading: boolean,
  apiError: boolean,
): StatusTone {
  if (key === "api") {
    if (apiError) return "error";
    if (loading) return "loading";
    return "ok";
  }
  if (unreachable) return "muted";
  if (loading) return "loading";
  if (!s) return "muted";
  if (key === "database") return s.database === "connected" ? "ok" : "error";
  if (key === "neo4j") {
    if (s.neo4j === "connected") return "ok";
    if (s.neo4j === "disabled") return "muted";
    return "error";
  }
  return s.llm === "available" ? "ok" : "warn";
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

function HeaderStatusStrip(props: {
  s: ServiceStatus | undefined;
  loading: boolean;
  unreachable: boolean;
  apiError: boolean;
}) {
  const { s, loading, unreachable, apiError } = props;
  const rows: { key: string; label: string; k: "api" | "database" | "neo4j" | "llm" }[] = [
    { key: "api", label: "API", k: "api" },
    { key: "db", label: "DB", k: "database" },
    { key: "neo4j", label: "Neo4j", k: "neo4j" },
    { key: "llm", label: "LLM", k: "llm" },
  ];
  return (
    <div
      className="rounded-xl border border-border/50 bg-card/70 px-3 py-2.5 backdrop-blur-sm"
      aria-live="polite"
    >
      <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2">
        System status
      </p>
      <div className="flex flex-wrap gap-x-4 gap-y-2">
        {rows.map((row) => (
          <div key={row.key} className="flex items-center gap-1.5">
            <span
              className={`h-2 w-2 shrink-0 rounded-full ${statusDotClass(
                connectionToneFor(s, row.k, unreachable, loading, apiError),
              )}`}
              title={row.label}
            />
            <span className="text-xs text-foreground/90">{row.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export default function Dashboard() {
  const { data: simulations, isLoading: isLoadingSims } = useListSimulations();
  const { data: agents, isLoading: isLoadingAgents } = useListAgents();
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

  // Aggregate metrics
  const activeSims = simRows.filter((s) => s.status !== "completed").length;
  const totalAgents = agentRows.length;
  const avgSupport = agentRows.length
    ? agentRows.reduce((acc, a) => acc + a.beliefState.policySupport, 0) / agentRows.length
    : 0;

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
    <div className="space-y-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
        <div>
          <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
            Engine Overview
          </h1>
          <p className="text-muted-foreground mt-2">
            Real-time intelligence from active policy simulations.
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
            <span>
              <span className="text-foreground/80 font-medium">Data:</span>{" "}
              {isLoadingSims ? "Loading simulations…" : `${simRows.length} simulation${simRows.length === 1 ? "" : "s"}`}
              {" · "}
              {isLoadingAgents ? "loading agents…" : `${agentRows.length} agent${agentRows.length === 1 ? "" : "s"}`}
            </span>
          </div>
        </div>
        <HeaderStatusStrip
          s={serviceStatus}
          loading={statusLoading}
          unreachable={statusUnreachable}
          apiError={statusError}
        />
      </div>

      <div className="rounded-2xl border border-border/50 bg-card/80 p-4 md:p-5 shadow-sm">
        <h2 className="text-sm font-semibold text-foreground mb-3 tracking-tight">
          Connection status
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
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
        className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4"
      >
        <motion.div variants={item} className="bg-card border border-border/50 p-6 rounded-2xl shadow-lg relative overflow-hidden group hover:border-primary/50 transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Activity className="w-16 h-16 text-primary" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Active Simulations</p>
          <div className="text-4xl font-bold text-foreground">
            {isLoadingSims ? "..." : activeSims}
            <span className="text-lg text-muted-foreground ml-2 font-normal">/ {simRows.length}</span>
          </div>
        </motion.div>

        <motion.div variants={item} className="bg-card border border-border/50 p-6 rounded-2xl shadow-lg relative overflow-hidden group hover:border-accent/50 transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <Users className="w-16 h-16 text-accent" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Total Agents</p>
          <div className="text-4xl font-bold text-foreground">{isLoadingAgents ? "..." : totalAgents}</div>
        </motion.div>

        <motion.div variants={item} className="bg-card border border-border/50 p-6 rounded-2xl shadow-lg relative overflow-hidden group hover:border-emerald-500/50 transition-colors">
          <div className="absolute top-0 right-0 p-4 opacity-10 group-hover:opacity-20 transition-opacity">
            <TrendingUp className="w-16 h-16 text-emerald-500" />
          </div>
          <p className="text-sm font-medium text-muted-foreground mb-1">Global Avg Policy Support</p>
          <div className="text-4xl font-bold text-foreground">
            {isLoadingAgents ? "..." : (avgSupport > 0 ? '+' : '') + avgSupport.toFixed(2)}
          </div>
        </motion.div>

        <motion.div variants={item} className="bg-gradient-to-br from-primary/20 to-accent/20 border border-primary/30 p-6 rounded-2xl shadow-[0_0_30px_rgba(14,165,233,0.1)] flex flex-col justify-center items-start">
          <h3 className="font-semibold text-lg mb-2">Ready to forecast?</h3>
          <Link 
            href="/simulations" 
            className="inline-flex items-center gap-2 text-sm font-medium bg-primary text-primary-foreground px-4 py-2 rounded-lg hover:bg-primary/90 transition-all hover:shadow-[0_0_15px_rgba(14,165,233,0.4)]"
          >
            Create Simulation <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </motion.div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
        <div className="lg:col-span-2 space-y-4">
          <h2 className="text-xl font-semibold border-b border-border pb-2">Recent Simulations</h2>
          {isLoadingSims ? (
            <div className="h-48 flex items-center justify-center text-muted-foreground">Loading...</div>
          ) : simRows.length === 0 ? (
            <div className="bg-card/50 border border-border/50 border-dashed rounded-xl p-8 text-center">
              <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-1">No simulations found</h3>
              <p className="text-muted-foreground text-sm mb-4">Start your first predictive model.</p>
              <Link href="/simulations" className="text-primary hover:underline text-sm font-medium">Create one now</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {simRows.slice(0, 5).map((sim) => (
                <Link key={sim.id} href={`/simulations/${sim.id}`} className="block">
                  <div className="bg-card border border-border/50 hover:border-primary/50 p-4 rounded-xl shadow-sm transition-all hover:shadow-md hover:-translate-y-0.5 flex items-center justify-between group">
                    <div>
                      <h3 className="font-semibold text-foreground group-hover:text-primary transition-colors">{sim.name}</h3>
                      <p className="text-sm text-muted-foreground line-clamp-1">{sim.description}</p>
                    </div>
                    <div className="flex items-center gap-4 text-right">
                      <div className="text-sm">
                        <div className="text-muted-foreground text-xs">Round</div>
                        <div className="font-mono font-medium">{sim.currentRound} / {sim.config.numRounds}</div>
                      </div>
                      <div className={`px-2.5 py-1 rounded-md text-xs font-medium uppercase tracking-wider ${
                        sim.status === 'running' ? 'bg-primary/10 text-primary border border-primary/20' :
                        sim.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        'bg-secondary text-secondary-foreground border border-border'
                      }`}>
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
