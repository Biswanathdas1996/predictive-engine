import { useMemo, useState } from "react";
import {
  useListAgents,
  useCreateAgent,
  useListGroups,
  type Agent,
  type Group,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Users,
  Plus,
  BrainCircuit,
  ChevronRight,
  Check,
  Layers,
  ArrowUpRight,
  Sparkles,
} from "lucide-react";
import { Link } from "wouter";
import { formatScore, normalizeApiArray, cn } from "@/lib/utils";
import { motion } from "framer-motion";

export default function Agents() {
  const queryClient = useQueryClient();
  const { data: agents, isLoading } = useListAgents();
  const { data: groupsData } = useListGroups();
  const createAgent = useCreateAgent();
  const agentList = normalizeApiArray<Agent>(agents);
  const groupsList = normalizeApiArray<Group>(groupsData);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  const agentSections = useMemo(() => {
    const byGroup = new Map<number, Agent[]>();
    const unassigned: Agent[] = [];
    for (const a of agentList) {
      const gid = a.groupId;
      if (gid == null) {
        unassigned.push(a);
        continue;
      }
      const list = byGroup.get(gid) ?? [];
      list.push(a);
      byGroup.set(gid, list);
    }

    const knownIds = new Set(groupsList.map((g) => g.id));
    type Section = {
      key: string;
      title: string;
      subtitle?: string;
      agents: Agent[];
    };
    const sections: Section[] = [];

    for (const g of [...groupsList].sort((a, b) =>
      a.name.localeCompare(b.name, undefined, { sensitivity: "base" }),
    )) {
      const list = byGroup.get(g.id);
      if (list?.length) {
        sections.push({
          key: `group-${g.id}`,
          title: g.name,
          subtitle: g.description?.trim() || undefined,
          agents: list,
        });
      }
    }

    for (const [gid, list] of byGroup) {
      if (!knownIds.has(gid) && list.length) {
        sections.push({
          key: `group-orphan-${gid}`,
          title: `Group #${gid}`,
          subtitle: "Cohort was removed; agents still carry this group id.",
          agents: list,
        });
      }
    }

    if (unassigned.length) {
      sections.push({
        key: "no-group",
        title: "No group",
        subtitle:
          "Agents not assigned to a cohort (including simulation-only personas with no group link).",
        agents: unassigned,
      });
    }

    return sections;
  }, [agentList, groupsList]);

  const [formData, setFormData] = useState({
    name: "",
    age: 35,
    gender: "Female",
    region: "Urban",
    occupation: "Professional",
    persona: "",
    stance: "Neutral"
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createAgent.mutate({
      data: {
        ...formData,
        influenceScore: 0.5,
        credibilityScore: 0.5,
        confidenceLevel: 0.8,
        activityLevel: 0.5,
        beliefState: {
          policySupport: 0,
          trustInGovernment: 0.5,
          economicOutlook: 0.5
        }
      }
    }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
        setIsDialogOpen(false);
      }
    });
  };

  const totalAgents = agentList.length;
  const cohortSections = agentSections.filter((s) => s.key !== "no-group");
  const cohortCount = cohortSections.length;

  return (
    <div className="space-y-6 md:space-y-8 -mt-1">
      <header className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/35 p-5 shadow-[0_0_0_1px_rgba(255,255,255,0.03)_inset] backdrop-blur-md md:p-6">
        <div
          className="pointer-events-none absolute -right-20 -top-24 h-56 w-56 rounded-full bg-primary/15 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-16 -left-16 h-48 w-48 rounded-full bg-accent/10 blur-3xl"
          aria-hidden
        />
        <div className="relative flex flex-col gap-5 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-primary/25 to-primary/5 text-primary shadow-inner ring-1 ring-primary/20">
              <Users className="h-5 w-5" strokeWidth={2} />
            </div>
            <div className="min-w-0 space-y-1.5">
              <div className="flex flex-wrap items-center gap-2.5 gap-y-1">
                <h1 className="bg-gradient-to-r from-foreground via-foreground to-primary/85 bg-clip-text text-2xl font-semibold tracking-tight text-transparent md:text-3xl">
                  Population Agents
                </h1>
                {!isLoading && totalAgents > 0 ? (
                  <span className="inline-flex items-center gap-1 rounded-full border border-primary/25 bg-primary/10 px-2.5 py-0.5 font-mono text-[10px] font-semibold uppercase tracking-wider text-primary">
                    <Sparkles className="h-3 w-3" strokeWidth={2} />
                    {totalAgents} total
                  </span>
                ) : null}
              </div>
              <p className="max-w-xl text-sm leading-relaxed text-muted-foreground md:text-[15px]">
                Synthetic personas for simulations — grouped by cohort. Tune cohorts in Groups,
                then drill into each persona for belief state and runs.
              </p>
            </div>
          </div>
          <div className="flex shrink-0 flex-col gap-2 sm:flex-row sm:items-center lg:flex-col lg:items-stretch xl:flex-row">
            <Link
              href="/groups"
              className="inline-flex items-center justify-center gap-1.5 rounded-xl border border-border/70 bg-background/40 px-4 py-2.5 text-sm font-medium text-muted-foreground transition hover:border-border hover:bg-background/60 hover:text-foreground"
            >
              Manage cohorts
              <ArrowUpRight className="h-3.5 w-3.5 opacity-70" />
            </Link>
            <button
              type="button"
              onClick={() => setIsDialogOpen(true)}
              className="inline-flex items-center justify-center gap-2 rounded-xl bg-primary px-4 py-2.5 text-sm font-semibold text-primary-foreground shadow-lg shadow-primary/20 ring-1 ring-primary/30 transition hover:bg-primary/90 hover:shadow-primary/25"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Generate agent
            </button>
          </div>
        </div>

        {!isLoading ? (
          <div className="relative mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 md:gap-4">
            <div className="rounded-xl border border-border/40 bg-background/30 px-4 py-3 md:px-5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Personas
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
                {totalAgents}
              </p>
            </div>
            <div className="rounded-xl border border-border/40 bg-background/30 px-4 py-3 md:px-5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Cohorts
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
                {cohortCount}
              </p>
            </div>
            <div className="col-span-2 rounded-xl border border-border/40 bg-background/30 px-4 py-3 sm:col-span-1 md:px-5">
              <p className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                Unassigned
              </p>
              <p className="mt-1 font-mono text-2xl font-semibold tabular-nums text-foreground">
                {agentSections.find((s) => s.key === "no-group")?.agents.length ?? 0}
              </p>
            </div>
          </div>
        ) : null}
      </header>

      {isLoading ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {[1, 2, 3, 4, 5, 6].map((i) => (
            <div
              key={i}
              className="h-48 animate-pulse rounded-2xl border border-border/40 bg-card/50"
            />
          ))}
        </div>
      ) : agentSections.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/60 bg-card/20 px-6 py-14 text-center">
          <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl bg-secondary/50 ring-1 ring-border/50">
            <Users className="h-7 w-7 text-muted-foreground" strokeWidth={1.5} />
          </div>
          <p className="text-sm font-medium text-foreground">No personas yet</p>
          <p className="mt-2 max-w-sm text-xs leading-relaxed text-muted-foreground md:text-sm">
            Generate an agent or create a cohort under Groups to seed synthetic population runs.
          </p>
          <div className="mt-6 flex flex-wrap items-center justify-center gap-2">
            <button
              type="button"
              onClick={() => setIsDialogOpen(true)}
              className="inline-flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground shadow-md shadow-primary/15"
            >
              <Plus className="h-4 w-4" />
              Generate agent
            </button>
            <Link
              href="/groups"
              className="inline-flex items-center gap-1.5 rounded-xl border border-border/70 px-4 py-2 text-sm font-medium text-muted-foreground hover:text-foreground"
            >
              Open Groups
              <ChevronRight className="h-4 w-4" />
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-8 md:space-y-10">
          {agentSections.map((section) => (
            <section
              key={section.key}
              className="relative overflow-hidden rounded-2xl border border-border/45 bg-card/25 p-4 shadow-sm backdrop-blur-sm md:p-6"
            >
              <div
                className={cn(
                  "pointer-events-none absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-primary/60 to-accent/40",
                  section.key === "no-group" && "from-amber-500/50 to-amber-600/20",
                )}
                aria-hidden
              />
              <div className="relative space-y-4 pl-3 md:pl-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2.5">
                      <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-secondary/60 ring-1 ring-border/50">
                        <Layers className="h-4 w-4 text-muted-foreground" strokeWidth={2} />
                      </div>
                      <h2 className="text-base font-semibold tracking-tight text-foreground md:text-lg">
                        {section.title}
                      </h2>
                      <span className="rounded-full border border-border/60 bg-background/60 px-2.5 py-0.5 font-mono text-[11px] font-medium tabular-nums text-muted-foreground">
                        {section.agents.length}
                      </span>
                    </div>
                    {section.subtitle ? (
                      <p className="mt-2 line-clamp-2 max-w-3xl text-xs leading-relaxed text-muted-foreground md:text-[13px]">
                        {section.subtitle}
                      </p>
                    ) : null}
                  </div>
                </div>
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
                  {section.agents.map((agent, i) => (
                    <AgentPersonaCard key={agent.id} agent={agent} index={i} />
                  ))}
                </div>
              </div>
            </section>
          ))}
        </div>
      )}

      {isDialogOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-background/85 p-4 backdrop-blur-md">
          <motion.div
            initial={{ scale: 0.97, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="w-full max-w-lg overflow-hidden rounded-2xl border border-border/80 bg-card/95 shadow-2xl shadow-black/40 ring-1 ring-white/[0.06]"
          >
            <div className="flex items-center justify-between border-b border-border/60 bg-secondary/20 px-5 py-4">
              <div>
                <h2 className="text-base font-semibold">Generate agent</h2>
                <p className="mt-0.5 text-xs text-muted-foreground">
                  Adds a standalone persona; assign cohorts from the persona detail if needed.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setIsDialogOpen(false)}
                className="shrink-0 rounded-lg p-2 text-muted-foreground transition hover:bg-secondary hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4 p-5">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Name</label>
                  <input
                    required
                    value={formData.name}
                    onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 md:text-sm"
                    placeholder="e.g. John Doe"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Age</label>
                  <input
                    type="number"
                    required
                    value={formData.age}
                    onChange={(e) =>
                      setFormData({ ...formData, age: parseInt(e.target.value, 10) })
                    }
                    className="w-full rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 md:text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Occupation</label>
                  <input
                    required
                    value={formData.occupation}
                    onChange={(e) => setFormData({ ...formData, occupation: e.target.value })}
                    className="w-full rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 md:text-sm"
                  />
                </div>
                <div className="space-y-1">
                  <label className="text-[11px] font-medium text-muted-foreground">Region</label>
                  <select
                    value={formData.region}
                    onChange={(e) => setFormData({ ...formData, region: e.target.value })}
                    className="w-full appearance-none rounded-lg border border-border bg-secondary/40 px-2.5 py-1.5 text-xs focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 md:text-sm"
                  >
                    <option>Urban</option>
                    <option>Suburban</option>
                    <option>Rural</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1">
                <label className="text-[11px] font-medium text-muted-foreground">
                  System persona prompt
                </label>
                <textarea
                  required
                  value={formData.persona}
                  onChange={(e) => setFormData({ ...formData, persona: e.target.value })}
                  className="min-h-[88px] w-full resize-none rounded-lg border border-border bg-secondary/40 px-2.5 py-2 font-mono text-[11px] focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary/40 md:text-xs"
                  placeholder="You are an urban professional who strongly values..."
                />
              </div>

              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsDialogOpen(false)}
                  className="rounded-lg px-3 py-1.5 text-xs font-medium text-muted-foreground hover:bg-secondary md:text-sm"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createAgent.isPending}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 text-xs font-medium text-primary-foreground hover:bg-primary/90 disabled:opacity-50 md:text-sm"
                >
                  {createAgent.isPending ? (
                    "Generating…"
                  ) : (
                    <>
                      <Check className="h-3.5 w-3.5" />
                      Generate
                    </>
                  )}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

function AgentPersonaCard({ agent, index }: { agent: Agent; index: number }) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: Math.min(index * 0.03, 0.24) }}
    >
      <Link href={`/agents/${agent.id}`} className="block h-full">
        <div className="group flex h-full flex-col rounded-2xl border border-border/60 bg-card/70 p-4 shadow-sm backdrop-blur-[2px] transition-all duration-200 hover:-translate-y-0.5 hover:border-primary/40 hover:bg-card hover:shadow-lg hover:shadow-primary/5">
          <div className="mb-3 flex items-start justify-between gap-2">
            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-secondary to-secondary/40 ring-1 ring-border/50 transition-[box-shadow,transform] group-hover:scale-[1.02] group-hover:ring-primary/30">
              <BrainCircuit className="h-[18px] w-[18px] text-muted-foreground transition-colors group-hover:text-primary" />
            </div>
            <div className="text-right">
              <div className="text-[9px] font-medium uppercase tracking-wider text-muted-foreground">
                Influence
              </div>
              <div className="font-mono text-sm font-semibold tabular-nums text-accent">
                {formatScore(agent.influenceScore)}
              </div>
            </div>
          </div>

          <h3 className="line-clamp-1 text-sm font-semibold leading-tight text-foreground">
            {agent.name}
          </h3>
          <p className="mb-2.5 mt-1 line-clamp-2 text-[11px] leading-snug text-muted-foreground">
            <span>{agent.age}yo</span>
            <span className="mx-1 text-border" aria-hidden>
              ·
            </span>
            <span>{agent.occupation}</span>
            <span className="mx-1 text-border" aria-hidden>
              ·
            </span>
            <span>{agent.region}</span>
          </p>

          <div className="mt-auto space-y-2.5">
            <div>
              <div className="mb-1 flex justify-between text-[10px]">
                <span className="text-muted-foreground">Policy support</span>
                <span
                  className={`font-mono font-medium tabular-nums ${
                    agent.beliefState.policySupport > 0
                      ? "text-emerald-400"
                      : agent.beliefState.policySupport < 0
                        ? "text-destructive"
                        : "text-muted-foreground"
                  }`}
                >
                  {formatScore(agent.beliefState.policySupport)}
                </span>
              </div>
              <div className="flex h-1 w-full overflow-hidden rounded-full bg-secondary">
                <div className="flex w-1/2 justify-end">
                  {agent.beliefState.policySupport < 0 && (
                    <div
                      className="h-full bg-destructive"
                      style={{
                        width: `${Math.abs(agent.beliefState.policySupport) * 100}%`,
                      }}
                    />
                  )}
                </div>
                <div className="flex w-1/2 justify-start">
                  {agent.beliefState.policySupport > 0 && (
                    <div
                      className="h-full bg-emerald-500"
                      style={{ width: `${agent.beliefState.policySupport * 100}%` }}
                    />
                  )}
                </div>
              </div>
            </div>

            <div className="flex items-center justify-between border-t border-border/50 pt-2 text-[11px] font-medium text-muted-foreground transition-colors group-hover:text-primary">
              <span>View persona</span>
              <ChevronRight className="h-3.5 w-3.5 opacity-70 transition-transform group-hover:translate-x-0.5" />
            </div>
          </div>
        </div>
      </Link>
    </motion.div>
  );
}
