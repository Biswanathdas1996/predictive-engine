import { useRoute } from "wouter";
import { useGetSimulation, useGetSimulationPosts, useRunSimulationRound } from "@workspace/api-client-react";
import { useQueryClient } from "@tanstack/react-query";
import { Activity, Play, StopCircle, RefreshCw, MessageSquare, BrainCircuit, ArrowLeft } from "lucide-react";
import { Link } from "wouter";
import { formatScore } from "@/lib/utils";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';

export default function SimulationDetail() {
  const [, params] = useRoute("/simulations/:id");
  const id = parseInt(params?.id || "0");
  
  const queryClient = useQueryClient();
  const { data: sim, isLoading } = useGetSimulation(id);
  const { data: posts } = useGetSimulationPosts(id, { limit: 50 });
  const runRound = useRunSimulationRound();

  const handleRunRound = () => {
    runRound.mutate({ id }, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: [`/api/simulations/${id}`] });
        queryClient.invalidateQueries({ queryKey: [`/api/simulations/${id}/posts`] });
      }
    });
  };

  if (isLoading || !sim) return <div className="p-8 text-center text-muted-foreground animate-pulse">Loading simulation core...</div>;

  // Mock data for chart since we don't have historical round data endpoint yet, 
  // we normally would fetch this from /reports or store it in sim state.
  const mockEvolutionData = Array.from({ length: sim.currentRound + 1 }).map((_, i) => ({
    round: i,
    support: 0.2 + (Math.sin(i * 0.5) * 0.3) + (i * 0.05), // Fake drift
    sentiment: 0.5 + (Math.cos(i * 0.5) * 0.2)
  }));

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
              disabled={runRound.isPending || sim.status === 'completed'}
              className="flex items-center gap-2 px-6 py-3 bg-primary text-primary-foreground rounded-lg font-medium shadow-[0_0_15px_rgba(14,165,233,0.3)] hover:shadow-[0_0_25px_rgba(14,165,233,0.5)] disabled:opacity-50 disabled:shadow-none transition-all"
            >
              {runRound.isPending ? <RefreshCw className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
              {runRound.isPending ? "Computing..." : "Execute Round"}
            </button>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left Column: Stats & Chart */}
        <div className="lg:col-span-2 space-y-6">
          <div className="grid grid-cols-3 gap-4">
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

          <div className="bg-card border border-border p-6 rounded-2xl shadow-sm h-[400px] flex flex-col">
            <h3 className="font-semibold mb-6 flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary" />
              Belief Evolution Trajectory
            </h3>
            <div className="flex-1 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={mockEvolutionData} margin={{ top: 5, right: 20, bottom: 5, left: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                  <XAxis dataKey="round" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                  <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} domain={[-1, 1]} />
                  <Tooltip 
                    contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                    itemStyle={{ color: 'hsl(var(--foreground))' }}
                  />
                  <Line type="monotone" dataKey="support" name="Policy Support" stroke="hsl(var(--primary))" strokeWidth={3} dot={{ r: 4, fill: "hsl(var(--background))", strokeWidth: 2 }} activeDot={{ r: 6 }} />
                  <Line type="monotone" dataKey="sentiment" name="Public Sentiment" stroke="hsl(var(--accent))" strokeWidth={3} dot={false} />
                </LineChart>
              </ResponsiveContainer>
            </div>
          </div>
        </div>

        {/* Right Column: Social Feed */}
        <div className="bg-card border border-border rounded-2xl shadow-sm flex flex-col h-[520px]">
          <div className="p-4 border-b border-border flex justify-between items-center bg-secondary/20 rounded-t-2xl">
            <h3 className="font-semibold flex items-center gap-2">
              <MessageSquare className="w-5 h-5 text-accent" />
              Social Feed Stream
            </h3>
            <div className="text-xs px-2 py-1 bg-background rounded border border-border font-mono">Live</div>
          </div>
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {posts?.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center text-muted-foreground opacity-50">
                <MessageSquare className="w-12 h-12 mb-2" />
                <p className="text-sm">No communications yet.</p>
                <p className="text-xs">Run a round to generate posts.</p>
              </div>
            ) : (
              posts?.map((post) => (
                <div key={post.id} className="bg-background border border-border/50 rounded-xl p-4 text-sm shadow-sm relative overflow-hidden group">
                  <div className="absolute left-0 top-0 bottom-0 w-1 bg-primary/50 group-hover:bg-primary transition-colors" />
                  <div className="flex justify-between items-start mb-2">
                    <div className="font-semibold text-foreground flex items-center gap-1.5">
                      <BrainCircuit className="w-3.5 h-3.5 text-muted-foreground" />
                      {post.agentName}
                    </div>
                    <div className="text-xs font-mono text-muted-foreground">R{post.round}</div>
                  </div>
                  <p className="text-muted-foreground mb-3">{post.content}</p>
                  <div className="flex justify-between items-center">
                    <div className="flex gap-1.5">
                      {post.topicTags?.map(tag => (
                        <span key={tag} className="text-[10px] uppercase tracking-wider bg-secondary text-secondary-foreground px-1.5 py-0.5 rounded font-medium">#{tag}</span>
                      ))}
                    </div>
                    <div className="text-[10px] font-mono flex items-center gap-1">
                      Sent: <span className={post.sentiment > 0 ? 'text-emerald-400' : post.sentiment < 0 ? 'text-destructive' : 'text-muted-foreground'}>{formatScore(post.sentiment)}</span>
                    </div>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
