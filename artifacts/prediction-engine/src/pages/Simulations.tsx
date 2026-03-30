import { useState } from "react";
import {
  useListSimulations,
  useCreateSimulation,
  useListPolicies,
  type Policy,
  type Simulation,
} from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Plus, Play, Info } from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import { format } from "date-fns";
import { normalizeApiArray } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

export default function Simulations() {
  const queryClient = useQueryClient();
  const { data: simulations, isLoading } = useListSimulations();
  const { data: policies } = useListPolicies();
  const createSim = useCreateSimulation();

  const simulationList = normalizeApiArray<Simulation>(simulations);
  const policyList = normalizeApiArray<Policy>(policies);
  
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [formData, setFormData] = useState({
    name: "",
    description: "",
    learningRate: 0.1,
    numRounds: 10,
    agentCount: 100,
    policyId: ""
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const agentCount = Number.isFinite(formData.agentCount)
      ? Math.max(1, Math.floor(formData.agentCount))
      : 100;
    const numRounds = Number.isFinite(formData.numRounds)
      ? Math.max(1, Math.floor(formData.numRounds))
      : 10;
    const learningRate = Number.isFinite(formData.learningRate)
      ? formData.learningRate
      : 0.1;
    const rawPolicyId = formData.policyId
      ? parseInt(formData.policyId, 10)
      : NaN;
    const policyId = Number.isFinite(rawPolicyId) ? rawPolicyId : null;
    createSim.mutate(
      {
        data: {
          name: formData.name.trim(),
          description: formData.description.trim(),
          config: {
            learningRate,
            numRounds,
            agentCount,
            policyId,
          },
        },
      },
      {
        onSuccess: () => {
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
        },
        onError: (err) => {
          const message =
            err instanceof Error ? err.message : "Something went wrong.";
          toast({
            variant: "destructive",
            title: "Could not create simulation",
            description: message,
          });
        },
      },
    );
  };

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
                      <Link 
                        href={`/simulations/${sim.id}`}
                        className="inline-flex items-center gap-1.5 text-sm font-medium text-primary hover:text-primary-foreground hover:bg-primary px-3 py-1.5 rounded-lg transition-colors"
                      >
                        Details <ChevronRight className="w-4 h-4" />
                      </Link>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {isDialogOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-xl overflow-hidden"
          >
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h2 className="text-xl font-bold">Initialize Environment</h2>
              <button onClick={() => setIsDialogOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Simulation Name</label>
                <input 
                  required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                  placeholder="e.g. UBI Impact Study 2025"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">Description</label>
                <textarea 
                  required value={formData.description} onChange={e => setFormData({...formData, description: e.target.value})}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 min-h-[80px] resize-none"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground flex items-center gap-2">
                  Target Policy <Info className="w-4 h-4 text-muted-foreground" />
                </label>
                <select 
                  value={formData.policyId} onChange={e => setFormData({...formData, policyId: e.target.value})}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 appearance-none"
                >
                  <option value="">No specific policy (Baseline)</option>
                  {policyList.map(p => (
                    <option key={p.id} value={p.id}>{p.title}</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-3 gap-4 pt-2">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Agents</label>
                  <input 
                    type="number" required value={formData.agentCount} onChange={e => setFormData({...formData, agentCount: parseInt(e.target.value)})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Rounds</label>
                  <input 
                    type="number" required value={formData.numRounds} onChange={e => setFormData({...formData, numRounds: parseInt(e.target.value)})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground flex items-center gap-1">L. Rate <span className="text-[10px] text-primary">α</span></label>
                  <input 
                    type="number" step="0.01" required value={formData.learningRate} onChange={e => setFormData({...formData, learningRate: parseFloat(e.target.value)})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary font-mono"
                  />
                </div>
              </div>

              <div className="pt-6 flex justify-end gap-3 border-t border-border/50">
                <button type="button" onClick={() => setIsDialogOpen(false)} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors">
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={createSim.isPending}
                  className="flex items-center gap-2 px-6 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 hover:shadow-[0_0_15px_rgba(14,165,233,0.4)] disabled:opacity-50 transition-all"
                >
                  {createSim.isPending ? "Creating..." : <><Play className="w-4 h-4 fill-current" /> Initialize</>}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}

// Needed a Chevron component for the table
function ChevronRight({ className }: { className?: string }) {
  return <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className={className}><path d="m9 18 6-6-6-6"/></svg>
}
