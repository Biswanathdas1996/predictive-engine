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
import { Activity, Plus, Play, Info, Radio, Trash2 } from "lucide-react";
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
import { buttonVariants } from "@/components/ui/button";
import { normalizeApiArray, cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { consumeSSEStream, type SSEEvent } from "@/lib/sse";

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Activity className="w-8 h-8 text-primary" />
            Simulation Environments
          </h1>
          <p className="text-muted-foreground mt-1">Configure and monitor policy impact forecasting models.</p>
        </div>
        <button
          onClick={() => setIsDialogOpen(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl font-medium shadow-[0_0_20px_rgba(14,165,233,0.2)] hover:shadow-[0_0_25px_rgba(14,165,233,0.4)] hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-5 h-5" />
          New Simulation
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl shadow-lg overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse">
            <thead>
              <tr className="bg-secondary/30 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
                <th className="px-6 py-4 font-medium">Name</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Progress</th>
                <th className="px-6 py-4 font-medium">Agents</th>
                <th className="px-6 py-4 font-medium">Created</th>
                <th className="px-6 py-4 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border/50">
              {isLoading ? (
                <tr><td colSpan={6} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
              ) : simulationList.length === 0 ? (
                <tr><td colSpan={6} className="px-6 py-12 text-center text-muted-foreground">No simulations created yet.</td></tr>
              ) : (
                simulationList.map((sim) => (
                  <tr key={sim.id} className="hover:bg-secondary/20 transition-colors group">
                    <td className="px-6 py-4">
                      <div className="font-semibold text-foreground">{sim.name}</div>
                      <div className="text-xs text-muted-foreground line-clamp-1 max-w-xs">{sim.description}</div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-medium uppercase tracking-wider ${
                        sim.status === 'running' ? 'bg-primary/10 text-primary border border-primary/20' :
                        sim.status === 'completed' ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20' :
                        'bg-secondary text-secondary-foreground border border-border'
                      }`}>
                        {sim.status}
                      </span>
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden max-w-[100px]">
                          <div
                            className="h-full bg-primary"
                            style={{ width: `${(sim.currentRound / sim.config.numRounds) * 100}%` }}
                          />
                        </div>
                        <span className="text-xs font-mono text-muted-foreground">
                          {sim.currentRound}/{sim.config.numRounds}
                        </span>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <div className="font-mono text-sm">{sim.totalAgents}</div>
                    </td>
                    <td className="px-6 py-4 text-sm text-muted-foreground">
                      {format(new Date(sim.createdAt), 'MMM d, yyyy')}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="inline-flex flex-wrap items-center justify-end gap-2">
                        <Link
                          href={`/simulations/${sim.id}`}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-foreground hover:bg-primary px-3 py-1.5 rounded-lg transition-colors"
                        >
                          Details <ChevronRight className="w-4 h-4" />
                        </Link>
                        <button
                          type="button"
                          onClick={() => setSimPendingDelete(sim)}
                          disabled={deleteSimulation.isPending}
                          className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive hover:bg-destructive/10 px-3 py-1.5 rounded-lg transition-colors disabled:opacity-50"
                        >
                          <Trash2 className="w-4 h-4" />
                          Delete
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
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

function ChevronRight({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6"/></svg>
}
