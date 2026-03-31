import { useState, useCallback, useRef, useMemo } from "react";
import {
  useListSimulations,
  useListPolicies,
  useListGroups,
  useDeleteSimulation,
  type Group,
  type Policy,
  type Simulation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import {
  Activity,
  Plus,
  Play,
  Info,
  Radio,
  Trash2,
  ChevronRight,
  Layers,
  CheckCircle2,
  UsersRound,
} from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { format } from "date-fns";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import { normalizeApiArray, cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { consumeSSEStream, type SSEEvent } from "@/lib/sse";

function statusBadgeClass(status: string) {
  switch (status) {
    case "running":
      return "bg-primary/15 text-primary border-primary/30 shadow-[0_0_20px_-8px_var(--color-primary)]";
    case "completed":
      return "bg-emerald-500/10 text-emerald-400 border-emerald-500/25";
    default:
      return "bg-secondary/80 text-muted-foreground border-border/60";
  }
}

export default function Simulations() {
  const queryClient = useQueryClient();
  const { data: simulations, isLoading } = useListSimulations();
  const deleteSimulation = useDeleteSimulation({
    mutation: {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: ["/api/simulations"] });
        toast({ title: "Simulation deleted" });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Could not delete simulation",
          description: "Try again or check the server.",
        });
      },
    },
  });
  const { data: policies } = useListPolicies();
  const { data: groupsData } = useListGroups();

  const simulationList = normalizeApiArray<Simulation>(simulations);
  const policyList = normalizeApiArray<Policy>(policies);
  const groupsList = normalizeApiArray<Group>(groupsData);

  const stats = useMemo(() => {
    const total = simulationList.length;
    const running = simulationList.filter((s) => s.status === "running").length;
    const completed = simulationList.filter((s) => s.status === "completed").length;
    const agents = simulationList.reduce((acc, s) => acc + (s.totalAgents ?? 0), 0);
    return { total, running, completed, agents };
  }, [simulationList]);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    learningRate: 0.1,
    numRounds: 10,
    agentCount: 100,
    policyId: ""
  });
  const [selectedGroupIds, setSelectedGroupIds] = useState<number[]>([]);

  const pooledAgentTotal = useMemo(() => {
    return selectedGroupIds.reduce((acc, gid) => {
      const g = groupsList.find((x) => x.id === gid);
      return acc + (g?.poolAgentCount ?? 0);
    }, 0);
  }, [selectedGroupIds, groupsList]);

  // Streaming state
  const [isCreating, setIsCreating] = useState(false);
  const [createMessage, setCreateMessage] = useState("");
  const [createProgress, setCreateProgress] = useState<{ current: number; total: number } | null>(null);
  const [createPhase, setCreatePhase] = useState<string>("");
  const abortRef = useRef<AbortController | null>(null);
  const [simPendingDelete, setSimPendingDelete] = useState<Simulation | null>(null);

  const handleSubmit = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (isCreating) return;

    const nameTrimmed = formData.name.trim();
    if (!nameTrimmed) {
      toast({
        variant: "destructive",
        title: "Name required",
        description: "Enter a simulation name.",
      });
      return;
    }

    const agentCount = Number.isFinite(formData.agentCount)
      ? Math.max(1, Math.floor(formData.agentCount))
      : 100;
    const numRounds = Number.isFinite(formData.numRounds)
      ? Math.max(1, Math.floor(formData.numRounds))
      : 10;
    const learningRate = Math.min(
      1,
      Math.max(
        0,
        Number.isFinite(formData.learningRate) ? formData.learningRate : 0.1,
      ),
    );
    const rawPolicyId = formData.policyId
      ? parseInt(formData.policyId, 10)
      : NaN;
    const policyId = Number.isFinite(rawPolicyId) ? rawPolicyId : null;

    if (selectedGroupIds.length > 0 && pooledAgentTotal < 1) {
      toast({
        variant: "destructive",
        title: "No pool agents",
        description:
          "Pick groups that already have generated agents, or clear group selection to use a numeric agent count.",
      });
      return;
    }

    setIsCreating(true);
    setCreateMessage("Initializing...");
    setCreateProgress(null);
    setCreatePhase("init");

    const abort = new AbortController();
    abortRef.current = abort;

    const useGroups = selectedGroupIds.length > 0;
    const config = {
      learningRate,
      numRounds,
      agentCount: useGroups ? Math.max(1, pooledAgentTotal) : agentCount,
      policyId,
      ...(useGroups ? { groupIds: selectedGroupIds } : {}),
    };

    consumeSSEStream({
      url: "/api/simulations/create-stream",
      body: {
        name: nameTrimmed,
        description: formData.description.trim(),
        config,
      },
      signal: abort.signal,
      onEvent: (event: SSEEvent) => {
        if (event.type === "status") {
          const e = event as SSEEvent & { phase?: string; message?: string; current?: number; total?: number; agentName?: string };
          if (e.phase) setCreatePhase(e.phase);
          if (e.message) setCreateMessage(e.message);
          if (e.current != null && e.total != null) {
            setCreateProgress({ current: e.current, total: e.total });
          }
        } else if (event.type === "complete") {
          queryClient.invalidateQueries({ queryKey: ["/api/simulations"] });
          setIsDialogOpen(false);
          setFormData({
            name: "",
            description: "",
            learningRate: 0.1,
            numRounds: 10,
            agentCount: 100,
            policyId: "",
          });
          setSelectedGroupIds([]);
          toast({ title: "Simulation created" });
        }
      },
      onError: (msg) => {
        toast({
          variant: "destructive",
          title: "Could not create simulation",
          description: msg,
        });
      },
      onDone: () => {
        setIsCreating(false);
        setCreateMessage("");
        setCreateProgress(null);
        setCreatePhase("");
      },
    });
  }, [formData, isCreating, queryClient, selectedGroupIds, pooledAgentTotal]);

  const progressPct = createProgress ? Math.round((createProgress.current / createProgress.total) * 100) : 0;

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
            <Activity className="h-3.5 w-3.5 text-primary" aria-hidden />
            Policy forecasting
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/55 md:text-4xl">
            Simulation environments
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Configure and monitor policy impact models. Spin up cohorts, run rounds, and drill into each environment from the cards below.
          </p>
        </div>
        <Button
          size="lg"
          className="h-11 shrink-0 rounded-xl shadow-[0_0_24px_-6px_var(--color-primary)] transition-transform hover:-translate-y-0.5"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="h-5 w-5" />
          New simulation
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
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <Layers className="h-24 w-24 text-primary" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Environments</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.total}
          </p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <Radio className="h-24 w-24 text-primary" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Running</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.running}
          </p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-emerald-500/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <CheckCircle2 className="h-24 w-24 text-emerald-500" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Completed</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.completed}
          </p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-accent/40"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <UsersRound className="h-24 w-24 text-accent" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Agents modeled</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.agents.toLocaleString()}
          </p>
        </motion.div>
      </motion.div>

      <div className="rounded-2xl border border-border/50 bg-card/50 p-4 shadow-lg backdrop-blur-md md:p-6">
        <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Your simulations</h2>
            <p className="text-sm text-muted-foreground">Status, progress, and quick actions per environment.</p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-border/40 bg-secondary/20 p-5"
              >
                <div className="h-5 w-2/3 rounded-md bg-secondary/60" />
                <div className="mt-3 h-3 w-full rounded bg-secondary/40" />
                <div className="mt-6 h-2 w-full rounded-full bg-secondary/50" />
              </div>
            ))}
          </div>
        ) : simulationList.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/30 px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-card/80 shadow-inner">
              <Layers className="h-7 w-7 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-lg font-medium text-foreground">No environments yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Create your first simulation to start forecasting how policies propagate through synthetic populations.
            </p>
            <Button className="mt-6 rounded-xl" onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New simulation
            </Button>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {simulationList.map((sim) => {
              const roundsTotal = Math.max(1, sim.config?.numRounds ?? 1);
              const roundPct = Math.min(100, (sim.currentRound / roundsTotal) * 100);
              return (
                <motion.article
                  key={sim.id}
                  variants={item}
                  className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm transition-all duration-200 hover:border-primary/35 hover:shadow-md hover:shadow-primary/[0.06]"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <Link
                        href={`/simulations/${sim.id}`}
                        className="block font-semibold leading-snug text-foreground transition-colors hover:text-primary"
                      >
                        {sim.name}
                      </Link>
                      {sim.description ? (
                        <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{sim.description}</p>
                      ) : null}
                    </div>
                    <span
                      className={cn(
                        "shrink-0 rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider",
                        statusBadgeClass(sim.status),
                      )}
                    >
                      {sim.status}
                    </span>
                  </div>

                  <div className="mt-5">
                    <div className="mb-1.5 flex items-center justify-between text-xs text-muted-foreground">
                      <span>Round progress</span>
                      <span className="font-mono tabular-nums text-foreground/90">
                        {sim.currentRound}/{roundsTotal}
                      </span>
                    </div>
                    <div className="h-2 overflow-hidden rounded-full bg-secondary/80">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-primary to-primary/70 transition-all duration-300"
                        style={{ width: `${roundPct}%` }}
                      />
                    </div>
                  </div>

                  <div className="mt-5 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border/50 pt-4 text-xs text-muted-foreground">
                    <span>
                      <span className="text-muted-foreground/80">Agents</span>{" "}
                      <span className="font-mono font-medium text-foreground">{sim.totalAgents}</span>
                    </span>
                    <span className="hidden h-3 w-px bg-border sm:inline" aria-hidden />
                    <span>Created {format(new Date(sim.createdAt), "MMM d, yyyy")}</span>
                  </div>

                  <div className="mt-4 flex flex-wrap gap-2">
                    <Button variant="secondary" size="sm" className="rounded-lg border border-border/60 bg-background/50" asChild>
                      <Link href={`/simulations/${sim.id}`} className="inline-flex items-center gap-1">
                        Open
                        <ChevronRight className="h-3.5 w-3.5 opacity-70" />
                      </Link>
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-lg text-destructive hover:bg-destructive/10 hover:text-destructive"
                      disabled={deleteSimulation.isPending}
                      onClick={() => setSimPendingDelete(sim)}
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                      Delete
                    </Button>
                  </div>
                </motion.article>
              );
            })}
          </motion.div>
        )}
      </div>

      <AlertDialog
        open={!!simPendingDelete}
        onOpenChange={(open) => {
          if (!open) setSimPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete simulation?</AlertDialogTitle>
            <AlertDialogDescription>
              This permanently removes &quot;{simPendingDelete?.name}&quot; and all related
              agents, posts, and runs. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              disabled={deleteSimulation.isPending}
              onClick={() => {
                if (simPendingDelete) {
                  deleteSimulation.mutate({ id: simPendingDelete.id });
                }
              }}
            >
              {deleteSimulation.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {isDialogOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-xl overflow-hidden"
          >
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h2 className="text-xl font-bold">Initialize Environment</h2>
              <button onClick={() => { if (!isCreating) setIsDialogOpen(false); }} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Simulation Name</label>
                <input
                  required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                  placeholder="e.g. UBI Impact Study 2025"
                  disabled={isCreating}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <textarea
                  required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 min-h-[80px] resize-none"
                  disabled={isCreating}
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  Target Policy <Info className="w-4 h-4 text-muted-foreground" />
                </label>
                <select
                  value={formData.policyId} onChange={e => setFormData({...formData, policyId: e.target.value})}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 appearance-none"
                  disabled={isCreating}
                >
                  <option value="">No specific policy (Baseline)</option>
                  {policyList.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              <div className="space-y-2 rounded-xl border border-border/80 bg-secondary/10 px-3 py-3">
                <div className="flex items-center justify-between gap-2">
                  <label className="text-sm font-medium text-muted-foreground">
                    Agent groups <span className="text-xs font-normal">(optional)</span>
                  </label>
                  {selectedGroupIds.length > 0 && (
                    <button
                      type="button"
                      className="text-xs text-primary hover:underline"
                      disabled={isCreating}
                      onClick={() => setSelectedGroupIds([])}
                    >
                      Clear
                    </button>
                  )}
                </div>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  When selected, the simulation clones pool agents from these groups (with their behavioral prompts).
                  Otherwise, generic template agents are created from the count below.
                </p>
                {groupsList.length === 0 ? (
                  <p className="text-xs text-muted-foreground italic">No groups yet — create one under Groups.</p>
                ) : (
                  <ul className="max-h-36 overflow-y-auto space-y-1.5 pr-1">
                    {groupsList.map((g) => {
                      const pool = g.poolAgentCount ?? 0;
                      const checked = selectedGroupIds.includes(g.id);
                      return (
                        <li key={g.id}>
                          <label className="flex items-start gap-2 text-sm cursor-pointer">
                            <input
                              type="checkbox"
                              className="mt-0.5 rounded border-border"
                              checked={checked}
                              disabled={isCreating || pool < 1}
                              onChange={() => {
                                setSelectedGroupIds((prev) =>
                                  prev.includes(g.id)
                                    ? prev.filter((x) => x !== g.id)
                                    : [...prev, g.id],
                                );
                              }}
                            />
                            <span className={pool < 1 ? "text-muted-foreground/60" : ""}>
                              <span className="font-medium text-foreground">{g.name}</span>
                              <span className="text-xs text-muted-foreground ml-2 font-mono">
                                pool {pool}
                              </span>
                            </span>
                          </label>
                        </li>
                      );
                    })}
                  </ul>
                )}
                {selectedGroupIds.length > 0 && (
                  <p className="text-xs font-mono text-primary">
                    → {pooledAgentTotal} agent{pooledAgentTotal === 1 ? "" : "s"} from groups
                  </p>
                )}
              </div>

              <div className="grid grid-cols-3 gap-4 pt-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Agents</label>
                  <input
                    type="number" required value={formData.agentCount} onChange={e => setFormData({...formData, agentCount: parseInt(e.target.value)})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono disabled:opacity-50"
                    disabled={isCreating || selectedGroupIds.length > 0}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Rounds</label>
                  <input
                    type="number" required value={formData.numRounds} onChange={e => setFormData({...formData, numRounds: parseInt(e.target.value)})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                    disabled={isCreating}
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">L. Rate <span className="text-[10px] text-primary">α</span></label>
                  <input
                    type="number" min={0} max={1} step="0.01" required value={formData.learningRate} onChange={e => setFormData({...formData, learningRate: parseFloat(e.target.value)})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                    disabled={isCreating}
                  />
                </div>
              </div>

              {/* Live Stream Status */}
              {isCreating && (
                <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-2">
                  <div className="flex items-center gap-2 text-sm">
                    <Radio className="w-4 h-4 text-primary animate-pulse" />
                    <span className="font-medium text-primary">Creating...</span>
                    <span className="text-xs text-muted-foreground ml-auto font-mono">{createPhase}</span>
                  </div>
                  <p className="text-xs text-muted-foreground">{createMessage}</p>
                  {createProgress && (
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-1.5 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-primary transition-all duration-300 rounded-full"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="text-[10px] font-mono text-muted-foreground">
                        {createProgress.current}/{createProgress.total}
                      </span>
                    </div>
                  )}
                </div>
              )}

              <div className="pt-6 flex justify-end gap-3 border-t border-border/50">
                <button type="button" onClick={() => { if (!isCreating) setIsDialogOpen(false); }} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors" disabled={isCreating}>
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreating}
                  className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 hover:shadow-[0_0_15px_rgba(14,165,233,0.4)] disabled:opacity-50 transition-all"
                >
                  {isCreating ? "Creating..." : <><Play className="w-4 h-4 fill-current" /> Initialize</>}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
