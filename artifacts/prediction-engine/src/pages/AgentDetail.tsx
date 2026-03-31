import type { ReactNode } from "react";
import { useRoute, Link } from "wouter";
import {
  useGetAgent,
  useGetAgentNeighborhood,
  ApiError,
  type Post,
} from "@workspace/api-client-react";
import {
  ArrowLeft,
  Users,
  MessageSquare,
  MapPin,
  Briefcase,
  Hash,
  Sparkles,
  ChevronRight,
  UserRound,
  User,
  CircleUserRound,
  Calendar,
} from "lucide-react";
import { cn, formatScore, normalizeApiArray } from "@/lib/utils";

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

function AgentGenderAvatarIcon({
  gender,
  className,
}: {
  gender?: string | null;
  className?: string;
}) {
  const g = String(gender ?? "")
    .trim()
    .toLowerCase();
  let Icon = CircleUserRound;
  if (g) {
    const female =
      /^(f|female|woman|girl)(\/|\s|,|$)|\bfemale\b|\bwoman\b|\bgirl\b/.test(g) ||
      /^she\b/.test(g);
    const male =
      /^(m|male|man|boy)(\/|\s|,|$)|\bmale\b|\bman\b|\bboy\b/.test(g) || /^he\b/.test(g);
    if (female && !male) Icon = UserRound;
    else if (male && !female) Icon = User;
    else if (female) Icon = UserRound;
    else if (male) Icon = User;
  }
  return <Icon className={className} strokeWidth={1.75} />;
}

function stancePillClass(stance: string): string {
  const s = stance.toLowerCase();
  if (/\boppose|against|skeptic|negative|reject/.test(s)) {
    return "bg-destructive/15 text-destructive border-destructive/25";
  }
  if (/\bsupport|favor|pro|positive|endorse/.test(s)) {
    return "bg-emerald-500/15 text-emerald-400 border-emerald-500/25";
  }
  if (/\bneutral|mixed|uncertain|split/.test(s)) {
    return "bg-amber-500/12 text-amber-200 border-amber-500/20";
  }
  return "bg-primary/10 text-primary border-primary/20";
}

export default function AgentDetail() {
  const [, params] = useRoute("/agents/:id");
  const raw = params?.id ?? "";
  const id = Number.parseInt(raw, 10);
  const idValid = Number.isFinite(id) && id > 0;

  const {
    data: agent,
    isLoading,
    isError,
    error,
  } = useGetAgent(id, {
    query: { enabled: idValid },
  });

  const { data: neighborhood, isLoading: nbLoading } = useGetAgentNeighborhood(
    id,
    { query: { enabled: idValid && !!agent } },
  );

  const nbPosts = normalizeApiArray<Post>(neighborhood?.posts);

  const notFound =
    isError &&
    error instanceof ApiError &&
    (error.status === 404 || error.status === 400);

  if (!idValid) {
    return (
      <div className="space-y-6 max-w-3xl">
        <BackLink />
        <div className="rounded-2xl border border-border bg-card p-8 text-muted-foreground">
          Invalid agent id in the URL.
        </div>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="space-y-6 max-w-3xl">
        <BackLink />
        <div className="h-48 rounded-2xl bg-card/50 border border-border animate-pulse" />
      </div>
    );
  }

  if (isError) {
    if (notFound) {
      return (
        <div className="space-y-6 max-w-3xl">
          <BackLink />
          <div className="rounded-2xl border border-border bg-card p-8">
            <h1 className="text-xl font-semibold text-foreground">Agent not found</h1>
            <p className="text-sm text-muted-foreground mt-2">
              There is no agent with id {id}. It may have been removed.
            </p>
          </div>
        </div>
      );
    }
    return (
      <div className="space-y-6 max-w-3xl">
        <BackLink />
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-8">
          <h1 className="text-xl font-semibold text-foreground">Could not load agent</h1>
          <p className="text-sm text-muted-foreground mt-2">
            {error instanceof Error ? error.message : "Unexpected error."}
          </p>
        </div>
      </div>
    );
  }

  if (!agent) {
    return null;
  }

  const policy = agent.beliefState.policySupport;

  return (
    <div className="w-full space-y-8">
      <BackLink />

      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-card/45 shadow-[0_0_0_1px_hsl(var(--primary)/0.06),0_24px_48px_-12px_rgba(0,0,0,0.45)] backdrop-blur-xl">
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-56 w-56 rounded-full bg-accent/15 blur-3xl"
          aria-hidden
        />

        <div className="relative flex flex-col gap-8 p-6 sm:p-8 md:flex-row md:items-start md:gap-10">
          <div className="flex shrink-0 justify-center md:justify-start">
            <div
              className={cn(
                "flex h-28 w-28 items-center justify-center rounded-2xl p-0.5 shadow-lg ring-2 ring-white/10",
                "bg-gradient-to-br from-primary/40 to-accent/30",
              )}
            >
              <div
                className={cn(
                  "flex h-full w-full items-center justify-center rounded-[0.9rem]",
                  avatarGradientClass(agent.id),
                )}
              >
                <AgentGenderAvatarIcon gender={agent.gender} className="h-14 w-14 opacity-95" />
              </div>
            </div>
          </div>

          <div className="min-w-0 flex-1 space-y-5">
            <div>
              <p className="text-[11px] font-semibold uppercase tracking-[0.2em] text-muted-foreground">
                Agent profile
              </p>
              <h1 className="mt-1 text-3xl font-bold tracking-tight text-foreground sm:text-4xl">
                {agent.name}
              </h1>
              <div className="mt-4 flex flex-wrap gap-2">
                <MetaChip icon={<Calendar className="h-3.5 w-3.5" />}>
                  {agent.age} years
                </MetaChip>
                <MetaChip icon={<Briefcase className="h-3.5 w-3.5" />}>{agent.occupation}</MetaChip>
                <MetaChip icon={<MapPin className="h-3.5 w-3.5" />}>{agent.region}</MetaChip>
                <MetaChip icon={<Sparkles className="h-3.5 w-3.5" />}>{agent.gender}</MetaChip>
              </div>
            </div>

            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <Stat
                label="Influence"
                value={formatScore(agent.influenceScore)}
                fill={agent.influenceScore}
                accent
              />
              <Stat label="Credibility" value={formatScore(agent.credibilityScore)} fill={agent.credibilityScore} />
              <Stat label="Confidence" value={formatScore(agent.confidenceLevel)} fill={agent.confidenceLevel} />
              <Stat label="Activity" value={formatScore(agent.activityLevel)} fill={agent.activityLevel} />
            </div>
          </div>
        </div>
      </section>

      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-6 lg:col-span-3">
          <div className="rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-sm sm:p-7">
            <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Stance
                </h2>
                <span
                  className={cn(
                    "mt-3 inline-flex items-center rounded-full border px-3 py-1 text-sm font-medium",
                    stancePillClass(agent.stance),
                  )}
                >
                  {agent.stance}
                </span>
              </div>
              {(agent.groupId != null || agent.simulationId != null) && (
                <div className="flex flex-wrap gap-2 sm:justify-end">
                  {agent.groupId != null && (
                    <span className="inline-flex items-center gap-1.5 rounded-xl border border-border/60 bg-secondary/40 px-3 py-1.5 text-xs text-muted-foreground">
                      <Hash className="h-3.5 w-3.5 shrink-0 opacity-70" />
                      <span className="font-mono text-foreground">{agent.groupId}</span>
                      <span className="hidden sm:inline">group</span>
                    </span>
                  )}
                  {agent.simulationId != null && (
                    <Link
                      href={`/simulations/${agent.simulationId}`}
                      className="inline-flex items-center gap-1 rounded-xl border border-primary/30 bg-primary/10 px-3 py-1.5 text-xs font-medium text-primary transition-colors hover:bg-primary/15"
                    >
                      Simulation #{agent.simulationId}
                      <ChevronRight className="h-3.5 w-3.5 opacity-80" />
                    </Link>
                  )}
                </div>
              )}
            </div>

            <div className="mt-8 border-t border-border/50 pt-6">
              <div className="flex items-end justify-between gap-4">
                <h2 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  Policy support
                </h2>
                <span
                  className={cn(
                    "font-mono text-lg font-semibold tabular-nums",
                    policy > 0 ? "text-emerald-400" : policy < 0 ? "text-destructive" : "text-muted-foreground",
                  )}
                >
                  {formatScore(policy)}
                </span>
              </div>
              <p className="mt-1 text-xs text-muted-foreground">
                −1 opposed · 0 neutral · +1 supportive
              </p>

              <div className="relative mt-4 h-3 w-full overflow-hidden rounded-full bg-secondary/80 ring-1 ring-border/40">
                <div className="absolute left-1/2 top-0 z-10 h-full w-px -translate-x-1/2 bg-border" />
                {policy < 0 ? (
                  <div
                    className="absolute top-0 h-full rounded-l-full bg-destructive"
                    style={{ right: "50%", width: `${Math.abs(policy) * 50}%` }}
                  />
                ) : null}
                {policy > 0 ? (
                  <div
                    className="absolute top-0 h-full rounded-r-full bg-emerald-500"
                    style={{ left: "50%", width: `${policy * 50}%` }}
                  />
                ) : null}
              </div>

              <div className="mt-4 flex flex-wrap gap-x-6 gap-y-2 text-xs">
                <span className="text-muted-foreground">
                  Trust in govt{" "}
                  <span className="font-mono font-medium text-foreground">
                    {formatScore(agent.beliefState.trustInGovernment)}
                  </span>
                </span>
                <span className="text-muted-foreground">
                  Economic outlook{" "}
                  <span className="font-mono font-medium text-foreground">
                    {formatScore(agent.beliefState.economicOutlook)}
                  </span>
                </span>
              </div>
            </div>
          </div>

          <div className="rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-sm sm:p-7">
            <div className="flex items-center gap-2 border-b border-border/40 pb-4">
              <Sparkles className="h-5 w-5 text-primary/80" />
              <h2 className="text-lg font-semibold tracking-tight text-foreground">Persona</h2>
            </div>
            <p className="mt-5 text-sm leading-relaxed text-foreground/95 whitespace-pre-wrap">
              {agent.persona || "—"}
            </p>
            {agent.systemPrompt ? (
              <>
                <h3 className="mt-8 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                  System prompt
                </h3>
                <pre className="mt-3 max-h-72 overflow-y-auto rounded-xl border border-border/50 bg-secondary/25 p-4 font-mono text-xs leading-relaxed text-muted-foreground whitespace-pre-wrap">
                  {agent.systemPrompt}
                </pre>
              </>
            ) : null}
          </div>
        </div>

        <div className="space-y-6 lg:col-span-2">
          <div className="rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-sm">
            <div className="flex items-center justify-between gap-2 border-b border-border/40 pb-4">
              <div className="flex items-center gap-2">
                <Users className="h-5 w-5 text-primary/80" />
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Connections</h2>
              </div>
              {nbLoading ? (
                <span className="text-xs text-muted-foreground">Loading…</span>
              ) : null}
            </div>
            {!nbLoading && neighborhood && neighborhood.connections.length === 0 ? (
              <p className="mt-5 text-sm text-muted-foreground">No influence edges for this agent.</p>
            ) : null}
            {!nbLoading && neighborhood && neighborhood.connections.length > 0 ? (
              <ul className="mt-4 space-y-2">
                {neighborhood.connections.map((c, idx) => (
                  <li key={`${c.agent.id}-${idx}`}>
                    <Link
                      href={`/agents/${c.agent.id}`}
                      className="group flex items-center justify-between gap-3 rounded-xl border border-border/50 bg-secondary/20 px-3 py-2.5 text-sm transition-colors hover:border-primary/30 hover:bg-primary/5"
                    >
                      <span className="min-w-0 truncate font-medium text-foreground group-hover:text-primary">
                        {c.agent.name}
                      </span>
                      <span className="shrink-0 text-[11px] font-mono text-muted-foreground">
                        {c.direction} · {formatScore(c.influenceWeight)}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            ) : null}
          </div>

          {nbPosts.length > 0 && (
            <div className="rounded-2xl border border-border/70 bg-card/60 p-6 shadow-sm backdrop-blur-sm">
              <div className="flex items-center gap-2 border-b border-border/40 pb-4">
                <MessageSquare className="h-5 w-5 text-primary/80" />
                <h2 className="text-lg font-semibold tracking-tight text-foreground">Recent posts</h2>
              </div>
              <ul className="mt-4 space-y-3">
                {nbPosts.slice(0, 10).map((p) => (
                  <li
                    key={p.id}
                    className="rounded-xl border border-border/40 bg-gradient-to-b from-secondary/30 to-transparent p-4"
                  >
                    <p className="text-sm leading-relaxed text-foreground line-clamp-4">{p.content}</p>
                    {p.createdAt && (
                      <p className="mt-2 text-[11px] text-muted-foreground">{p.createdAt}</p>
                    )}
                  </li>
                ))}
              </ul>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/agents"
      className="group inline-flex w-fit items-center gap-2 rounded-xl border border-transparent px-1 py-1 text-sm font-medium text-muted-foreground transition-colors hover:border-border/60 hover:bg-secondary/30 hover:text-primary"
    >
      <ArrowLeft className="h-4 w-4 transition-transform group-hover:-translate-x-0.5" />
      All agents
    </Link>
  );
}

function MetaChip({ icon, children }: { icon: ReactNode; children: ReactNode }) {
  return (
    <span className="inline-flex max-w-full items-center gap-2 rounded-full border border-border/55 bg-secondary/30 px-3 py-1.5 text-xs text-foreground/95 backdrop-blur-sm">
      <span className="shrink-0 text-muted-foreground">{icon}</span>
      <span className="min-w-0 truncate">{children}</span>
    </span>
  );
}

function Stat({
  label,
  value,
  accent,
  fill,
}: {
  label: string;
  value: string;
  accent?: boolean;
  fill?: number | null;
}) {
  const raw = fill ?? 0;
  const pct =
    raw == null || !Number.isFinite(raw) ? 0 : Math.min(100, Math.max(0, raw * 100));
  return (
    <div className="relative overflow-hidden rounded-2xl border border-border/60 bg-secondary/15 px-3 py-3 shadow-sm">
      <div className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 font-mono text-lg font-bold tabular-nums",
          accent ? "text-primary" : "text-foreground",
        )}
      >
        {value}
      </div>
      <div className="mt-3 h-1 w-full overflow-hidden rounded-full bg-secondary/70">
        <div
          className={cn(
            "h-full rounded-full transition-[width] duration-500",
            accent ? "bg-primary shadow-[0_0_12px_hsl(var(--primary)/0.35)]" : "bg-primary/45",
          )}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}
