import { useListSimulations, useListAgents, useGetMonteCarloRuns } from "@workspace/api-client-react";
import { Activity, Users, BarChart2, TrendingUp, ArrowRight } from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";

export default function Dashboard() {
  const { data: simulations, isLoading: isLoadingSims } = useListSimulations();
  const { data: agents, isLoading: isLoadingAgents } = useListAgents();

  // Aggregate metrics
  const activeSims = simulations?.filter(s => s.status !== 'completed').length || 0;
  const totalAgents = agents?.length || 0;
  const avgSupport = agents?.length 
    ? agents.reduce((acc, a) => acc + a.beliefState.policySupport, 0) / agents.length 
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
    show: { opacity: 1, y: 0, transition: { type: "spring", stiffness: 300, damping: 24 } }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold bg-clip-text text-transparent bg-gradient-to-r from-white to-white/60">
          Engine Overview
        </h1>
        <p className="text-muted-foreground mt-2">Real-time intelligence from active policy simulations.</p>
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
            <span className="text-lg text-muted-foreground ml-2 font-normal">/ {simulations?.length || 0}</span>
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
          ) : simulations?.length === 0 ? (
            <div className="bg-card/50 border border-border/50 border-dashed rounded-xl p-8 text-center">
              <Activity className="w-12 h-12 text-muted-foreground mx-auto mb-3 opacity-50" />
              <h3 className="text-lg font-medium text-foreground mb-1">No simulations found</h3>
              <p className="text-muted-foreground text-sm mb-4">Start your first predictive model.</p>
              <Link href="/simulations" className="text-primary hover:underline text-sm font-medium">Create one now</Link>
            </div>
          ) : (
            <div className="space-y-3">
              {simulations?.slice(0, 5).map(sim => (
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
