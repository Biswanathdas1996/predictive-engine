import { useState } from "react";
import { useListAgents, useCreateAgent } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Users, Plus, BrainCircuit, Activity, ChevronRight, Check } from "lucide-react";
import { Link } from "wouter";
import { formatScore } from "@/lib/utils";
import { motion } from "framer-motion";

export default function Agents() {
  const queryClient = useQueryClient();
  const { data: agents, isLoading } = useListAgents();
  const createAgent = useCreateAgent();
  const [isDialogOpen, setIsDialogOpen] = useState(false);

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

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Users className="w-8 h-8 text-primary" />
            Population Agents
          </h1>
          <p className="text-muted-foreground mt-1">Manage synthetic personas participating in simulations.</p>
        </div>
        <button 
          onClick={() => setIsDialogOpen(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2.5 rounded-xl font-medium shadow-[0_0_20px_rgba(14,165,233,0.2)] hover:shadow-[0_0_25px_rgba(14,165,233,0.4)] hover:-translate-y-0.5 transition-all"
        >
          <Plus className="w-5 h-5" />
          Generate Agent
        </button>
      </div>

      {isLoading ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-4">
          {[1,2,3,4,5,6].map(i => (
            <div key={i} className="h-64 bg-card/50 border border-border/50 rounded-2xl animate-pulse" />
          ))}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6">
          {agents?.map((agent, i) => (
            <motion.div 
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: i * 0.05 }}
              key={agent.id}
            >
              <Link href={`/agents/${agent.id}`} className="block h-full">
                <div className="bg-card border border-border hover:border-primary/50 rounded-2xl p-5 shadow-lg transition-all duration-300 hover:shadow-xl hover:shadow-primary/5 h-full flex flex-col group">
                  
                  <div className="flex justify-between items-start mb-4">
                    <div className="w-12 h-12 rounded-full bg-secondary flex items-center justify-center border border-border group-hover:border-primary/30 transition-colors">
                      <BrainCircuit className="w-6 h-6 text-muted-foreground group-hover:text-primary transition-colors" />
                    </div>
                    <div className="text-right">
                      <div className="text-xs text-muted-foreground uppercase font-semibold tracking-wider">Influence</div>
                      <div className="font-mono text-lg font-bold text-accent">{formatScore(agent.influenceScore)}</div>
                    </div>
                  </div>

                  <h3 className="text-lg font-bold text-foreground line-clamp-1">{agent.name}</h3>
                  <div className="flex items-center gap-2 text-xs text-muted-foreground mb-4">
                    <span>{agent.age}yo</span> • 
                    <span>{agent.occupation}</span> • 
                    <span>{agent.region}</span>
                  </div>

                  <div className="mt-auto space-y-4">
                    <div>
                      <div className="flex justify-between text-xs mb-1.5">
                        <span className="text-muted-foreground">Policy Support</span>
                        <span className={`font-mono font-medium ${agent.beliefState.policySupport > 0 ? 'text-emerald-400' : agent.beliefState.policySupport < 0 ? 'text-destructive' : 'text-muted-foreground'}`}>
                          {formatScore(agent.beliefState.policySupport)}
                        </span>
                      </div>
                      <div className="h-1.5 w-full bg-secondary rounded-full overflow-hidden flex">
                        {/* Render support bar (-1 to 1) */}
                        <div className="w-1/2 flex justify-end">
                          {agent.beliefState.policySupport < 0 && (
                            <div className="h-full bg-destructive" style={{ width: `${Math.abs(agent.beliefState.policySupport) * 100}%` }} />
                          )}
                        </div>
                        <div className="w-1/2 flex justify-start">
                          {agent.beliefState.policySupport > 0 && (
                            <div className="h-full bg-emerald-500" style={{ width: `${agent.beliefState.policySupport * 100}%` }} />
                          )}
                        </div>
                      </div>
                    </div>

                    <div className="pt-4 border-t border-border/50 flex justify-between items-center group-hover:text-primary transition-colors">
                      <span className="text-sm font-medium">View Persona</span>
                      <ChevronRight className="w-4 h-4" />
                    </div>
                  </div>
                </div>
              </Link>
            </motion.div>
          ))}
        </div>
      )}

      {isDialogOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div 
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-lg overflow-hidden"
          >
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h2 className="text-xl font-bold">Generate New Agent</h2>
              <button onClick={() => setIsDialogOpen(false)} className="text-muted-foreground hover:text-foreground">✕</button>
            </div>
            
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Name</label>
                  <input 
                    required value={formData.name} onChange={e => setFormData({...formData, name: e.target.value})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                    placeholder="e.g. John Doe"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Age</label>
                  <input 
                    type="number" required value={formData.age} onChange={e => setFormData({...formData, age: parseInt(e.target.value)})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Occupation</label>
                  <input 
                    required value={formData.occupation} onChange={e => setFormData({...formData, occupation: e.target.value})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                  />
                </div>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-muted-foreground">Region</label>
                  <select 
                    value={formData.region} onChange={e => setFormData({...formData, region: e.target.value})}
                    className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 appearance-none"
                  >
                    <option>Urban</option>
                    <option>Suburban</option>
                    <option>Rural</option>
                  </select>
                </div>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground">System Persona Prompt</label>
                <textarea 
                  required value={formData.persona} onChange={e => setFormData({...formData, persona: e.target.value})}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 min-h-[100px] resize-none font-mono text-xs"
                  placeholder="You are an urban professional who strongly values..."
                />
              </div>

              <div className="pt-4 flex justify-end gap-3">
                <button type="button" onClick={() => setIsDialogOpen(false)} className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors">
                  Cancel
                </button>
                <button 
                  type="submit" 
                  disabled={createAgent.isPending}
                  className="flex items-center gap-2 px-5 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:bg-primary/90 disabled:opacity-50 transition-all"
                >
                  {createAgent.isPending ? "Generating..." : <><Check className="w-4 h-4" /> Generate</>}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
