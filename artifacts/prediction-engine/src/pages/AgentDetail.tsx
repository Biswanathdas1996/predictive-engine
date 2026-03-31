import { useRoute, Link } from "wouter";
import {
  useGetAgent,
  useGetAgentNeighborhood,
  ApiError,
  type Post,
} from "@workspace/api-client-react";
import { ArrowLeft, BrainCircuit, Users, MessageSquare } from "lucide-react";
import { cn, formatScore, normalizeApiArray } from "@/lib/utils";

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

  return (
    <div className="space-y-8 max-w-4xl">
      <div className="flex items-center gap-4">
        <BackLink />
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center border border-border shrink-0">
            <BrainCircuit className="w-6 h-6 text-primary" />
          </div>
          <div className="min-w-0">
            <h1 className="text-2xl font-bold text-foreground truncate">{agent.name}</h1>
            <p className="text-sm text-muted-foreground">
              {agent.age}yo · {agent.occupation} · {agent.region} · {agent.gender}
            </p>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Influence" value={formatScore(agent.influenceScore)} accent />
        <Stat label="Credibility" value={formatScore(agent.credibilityScore)} />
        <Stat label="Confidence" value={formatScore(agent.confidenceLevel)} />
        <Stat label="Activity" value={formatScore(agent.activityLevel)} />
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Stance
          </h2>
          <p className="text-foreground mt-1">{agent.stance}</p>
        </div>
        {(agent.groupId != null || agent.simulationId != null) && (
          <div className="flex flex-wrap gap-4 text-sm">
            {agent.groupId != null && (
              <span className="text-muted-foreground">
                Group id:{" "}
                <span className="font-mono text-foreground">{agent.groupId}</span>
              </span>
            )}
            {agent.simulationId != null && (
              <Link
                href={`/simulations/${agent.simulationId}`}
                className="text-primary hover:underline font-medium"
              >
                Simulation #{agent.simulationId}
              </Link>
            )}
          </div>
        )}
        <div>
          <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
            Policy support
          </h2>
          <div className="mt-2 flex justify-between text-xs mb-1.5 max-w-md">
            <span className="text-muted-foreground">Support</span>
            <span
              className={cn(
                "font-mono font-medium",
                agent.beliefState.policySupport > 0
                  ? "text-emerald-400"
                  : agent.beliefState.policySupport < 0
                    ? "text-destructive"
                    : "text-muted-foreground",
              )}
            >
              {formatScore(agent.beliefState.policySupport)}
            </span>
          </div>
          <div className="h-1.5 max-w-md w-full bg-secondary rounded-full overflow-hidden flex">
            <div className="w-1/2 flex justify-end">
              {agent.beliefState.policySupport < 0 && (
                <div
                  className="h-full bg-destructive"
                  style={{
                    width: `${Math.abs(agent.beliefState.policySupport) * 100}%`,
                  }}
                />
              )}
            </div>
            <div className="w-1/2 flex justify-start">
              {agent.beliefState.policySupport > 0 && (
                <div
                  className="h-full bg-emerald-500"
                  style={{ width: `${agent.beliefState.policySupport * 100}%` }}
                />
              )}
            </div>
          </div>
          <p className="text-xs text-muted-foreground mt-3">
            Trust in government {formatScore(agent.beliefState.trustInGovernment)} · Economic
            outlook {formatScore(agent.beliefState.economicOutlook)}
          </p>
        </div>
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-3">
        <h2 className="text-sm font-medium text-muted-foreground uppercase tracking-wider">
          Persona
        </h2>
        <p className="text-sm text-foreground whitespace-pre-wrap leading-relaxed">
          {agent.persona || "—"}
        </p>
        {agent.systemPrompt ? (
          <>
            <h3 className="text-xs font-medium text-muted-foreground uppercase tracking-wider pt-2">
              System prompt
            </h3>
            <pre className="text-xs font-mono text-muted-foreground whitespace-pre-wrap bg-secondary/30 rounded-xl p-4 border border-border/50 max-h-72 overflow-y-auto">
              {agent.systemPrompt}
            </pre>
          </>
        ) : null}
      </div>

      <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2">
          <Users className="w-5 h-5 text-muted-foreground" />
          <h2 className="text-lg font-semibold text-foreground">Connections</h2>
          {nbLoading && (
            <span className="text-xs text-muted-foreground">Loading…</span>
          )}
        </div>
        {!nbLoading && neighborhood && neighborhood.connections.length === 0 ? (
          <p className="text-sm text-muted-foreground">No influence edges for this agent.</p>
        ) : null}
        {!nbLoading && neighborhood && neighborhood.connections.length > 0 ? (
          <ul className="space-y-2">
            {neighborhood.connections.map((c, idx) => (
              <li
                key={`${c.agent.id}-${idx}`}
                className="flex flex-wrap items-center justify-between gap-2 text-sm border border-border/60 rounded-xl px-3 py-2"
              >
                <Link
                  href={`/agents/${c.agent.id}`}
                  className="font-medium text-primary hover:underline"
                >
                  {c.agent.name}
                </Link>
                <span className="text-xs text-muted-foreground font-mono">
                  {c.direction} · {formatScore(c.influenceWeight)}
                </span>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {nbPosts.length > 0 && (
        <div className="rounded-2xl border border-border bg-card p-6 shadow-sm space-y-4">
          <div className="flex items-center gap-2">
            <MessageSquare className="w-5 h-5 text-muted-foreground" />
            <h2 className="text-lg font-semibold text-foreground">Recent posts</h2>
          </div>
          <ul className="space-y-3">
            {nbPosts.slice(0, 10).map((p) => (
              <li
                key={p.id}
                className="text-sm border border-border/60 rounded-xl p-3 bg-secondary/10"
              >
                <p className="text-foreground line-clamp-4">{p.content}</p>
                {p.createdAt && (
                  <p className="text-xs text-muted-foreground mt-2">{p.createdAt}</p>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function BackLink() {
  return (
    <Link
      href="/agents"
      className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-primary transition-colors"
    >
      <ArrowLeft className="w-4 h-4" />
      All agents
    </Link>
  );
}

function Stat({
  label,
  value,
  accent,
}: {
  label: string;
  value: string;
  accent?: boolean;
}) {
  return (
    <div className="rounded-xl border border-border bg-card/80 px-3 py-3">
      <div className="text-[10px] uppercase tracking-wider text-muted-foreground font-semibold">
        {label}
      </div>
      <div
        className={cn(
          "font-mono text-lg font-bold mt-0.5",
          accent ? "text-accent" : "text-foreground",
        )}
      >
        {value}
      </div>
    </div>
  );
}
