import { useState, useCallback, useRef } from "react";
import {
  useListSimulations,
  useGetMonteCarloRuns,
  type Simulation,
} from "@workspace/api-client-react";
import { BarChart2, Zap, Settings, AlertTriangle, Radio } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip as RechartsTooltip, ResponsiveContainer, Cell } from 'recharts';
import { formatScore, formatPercent, normalizeApiArray } from "@/lib/utils";
import { consumeSSEStream, type SSEEvent } from "@/lib/sse";

export default function MonteCarlo() {
  const { data: simulations } = useListSimulations();
  const simulationList = normalizeApiArray<Simulation>(simulations);

  const [selectedSim, setSelectedSim] = useState<string>("");
  const [config, setConfig] = useState({ numRuns: 100, roundsPerRun: 10 });
  const [result, setResult] = useState<any>(null);

  // Streaming state
  const [isRunning, setIsRunning] = useState(false);
  const [streamMessage, setStreamMessage] = useState("");
  const [streamProgress, setStreamProgress] = useState<{ current: number; total: number } | null>(null);
  const [latestSupport, setLatestSupport] = useState<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const { data: history } = useGetMonteCarloRuns(parseInt(selectedSim), {
    query: { enabled: !!selectedSim } as any
  });

  const handleRun = useCallback(() => {
    if (!selectedSim || isRunning) return;
    setIsRunning(true);
    setResult(null);
    setStreamMessage("Starting Monte Carlo...");
    setStreamProgress(null);
    setLatestSupport(null);

    const abort = new AbortController();
    abortRef.current = abort;

    consumeSSEStream({
      url: `/api/montecarlo/${selectedSim}/stream`,
      body: config,
      signal: abort.signal,
      onEvent: (event: SSEEvent) => {
        if (event.type === "status") {
          const e = event as SSEEvent & { message?: string };
          if (e.message) setStreamMessage(e.message);
        } else if (event.type === "mc_progress") {
          const e = event as SSEEvent & { current: number; total: number; latestSupport: number };
          setStreamProgress({ current: e.current, total: e.total });
          setLatestSupport(e.latestSupport);
          setStreamMessage(`Run ${e.current}/${e.total} — latest support: ${e.latestSupport.toFixed(3)}`);
        } else if (event.type === "complete") {
          const e = event as SSEEvent & { result: any };
          setResult(e.result);
          setStreamMessage("Complete!");
        }
      },
      onError: (msg) => {
        setStreamMessage(`Error: ${msg}`);
      },
      onDone: () => {
        setIsRunning(false);
      },
    });
  }, [selectedSim, config, isRunning]);

  const progressPct = streamProgress ? Math.round((streamProgress.current / streamProgress.total) * 100) : 0;

  // Process distribution for histogram
  const histogramData = result?.distribution ? (() => {
    const bins = 20;
    const min = -1;
    const max = 1;
    const step = (max - min) / bins;

    const counts = Array(bins).fill(0);
    result.distribution.forEach((r: any) => {
      let binIndex = Math.floor((r.policySupport - min) / step);
      if (binIndex >= bins) binIndex = bins - 1;
      if (binIndex < 0) binIndex = 0;
      counts[binIndex]++;
    });

    return counts.map((count, i) => ({
      binCenter: min + (i * step) + (step / 2),
      label: (min + (i * step)).toFixed(1),
      count
    }));
  })() : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-3xl font-bold flex items-center gap-3">
          <BarChart2 className="w-8 h-8 text-accent" />
          Monte Carlo Engine
        </h1>
        <p className="text-muted-foreground mt-1">Run probabilistic forecasts across multiple stochastic simulation branches.</p>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Configuration Panel */}
        <div className="bg-card border border-border rounded-2xl shadow-lg p-6">
          <h2 className="text-lg font-semibold mb-6 flex items-center gap-2 border-b border-border/50 pb-3">
            <Settings className="w-5 h-5 text-primary" /> Configuration
          </h2>

          <div className="space-y-5">
            <div className="space-y-2">
              <label className="text-sm font-medium text-foreground">Target Simulation Model</label>
              <select
                value={selectedSim}
                onChange={(e) => setSelectedSim(e.target.value)}
                className="w-full bg-background border border-border rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                disabled={isRunning}
              >
                <option value="">Select a model...</option>
                {simulationList.map(s => (
                  <option key={s.id} value={s.id}>{s.name} (Rounds: {s.config.numRounds})</option>
                ))}
              </select>
            </div>

            <div className="space-y-2">
              <div className="flex justify-between">
                <label className="text-sm font-medium text-foreground">Number of Branches (Runs)</label>
                <span className="text-xs font-mono text-primary">{config.numRuns}</span>
              </div>
              <input
                type="range" min="10" max="500" step="10"
                value={config.numRuns} onChange={(e) => setConfig({...config, numRuns: parseInt(e.target.value)})}
                className="w-full accent-primary"
                disabled={isRunning}
              />
              <div className="flex justify-between text-[10px] text-muted-foreground">
                <span>Fast (10)</span>
                <span>Accurate (500)</span>
              </div>
            </div>

            <div className="space-y-2">
               <div className="flex justify-between">
                <label className="text-sm font-medium text-foreground">Rounds per Branch</label>
                <span className="text-xs font-mono text-primary">{config.roundsPerRun}</span>
              </div>
              <input
                type="range" min="1" max="50" step="1"
                value={config.roundsPerRun} onChange={(e) => setConfig({...config, roundsPerRun: parseInt(e.target.value)})}
                className="w-full"
                disabled={isRunning}
              />
            </div>

            <div className="pt-6 border-t border-border/50">
              <button
                onClick={handleRun}
                disabled={!selectedSim || isRunning}
                className="w-full flex items-center justify-center gap-2 bg-gradient-to-r from-primary to-accent text-white px-4 py-3 rounded-xl font-bold shadow-[0_0_20px_rgba(139,92,246,0.3)] hover:shadow-[0_0_30px_rgba(139,92,246,0.5)] disabled:opacity-50 disabled:shadow-none transition-all"
              >
                {isRunning ? (
                  <><Zap className="w-5 h-5 animate-pulse" /> Computing Tensor...</>
                ) : (
                  <><Zap className="w-5 h-5" /> Execute Monte Carlo</>
                )}
              </button>
            </div>

            {/* Live Stream Status */}
            {isRunning && (
              <div className="rounded-xl border border-primary/30 bg-primary/5 p-4 space-y-3">
                <div className="flex items-center gap-2 text-sm">
                  <Radio className="w-4 h-4 text-primary animate-pulse" />
                  <span className="font-medium text-primary">Running...</span>
                </div>
                <p className="text-xs text-muted-foreground font-mono">{streamMessage}</p>
                {streamProgress && (
                  <div className="space-y-1.5">
                    <div className="flex items-center gap-3">
                      <div className="flex-1 h-2 bg-secondary rounded-full overflow-hidden">
                        <div
                          className="h-full bg-gradient-to-r from-primary to-accent transition-all duration-300 rounded-full"
                          style={{ width: `${progressPct}%` }}
                        />
                      </div>
                      <span className="text-xs font-mono text-muted-foreground w-16 text-right">
                        {progressPct}%
                      </span>
                    </div>
                    <div className="flex justify-between text-[10px] text-muted-foreground">
                      <span>Run {streamProgress.current}/{streamProgress.total}</span>
                      {latestSupport !== null && (
                        <span className={latestSupport > 0 ? "text-emerald-400" : "text-destructive"}>
                          Latest: {formatScore(latestSupport)}
                        </span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Results Panel */}
        <div className="lg:col-span-2 space-y-6">
          {!result && !isRunning ? (
            <div className="bg-card border border-border border-dashed rounded-2xl h-full min-h-[400px] flex flex-col items-center justify-center text-muted-foreground">
              <BarChart2 className="w-16 h-16 opacity-20 mb-4" />
              <p>Select a model and execute to view probabilistic outcomes.</p>
            </div>
          ) : isRunning && !result ? (
            <div className="bg-card border border-primary/30 rounded-2xl h-full min-h-[400px] flex flex-col items-center justify-center relative overflow-hidden">
              <div className="absolute inset-0 bg-primary/5 animate-pulse" />
              <div className="w-16 h-16 border-4 border-primary/20 border-t-primary rounded-full animate-spin mb-4" />
              <p className="text-primary font-mono animate-pulse">Running {config.numRuns} parallel futures...</p>
              {streamProgress && (
                <div className="mt-4 w-64">
                  <div className="h-2 bg-secondary rounded-full overflow-hidden">
                    <div
                      className="h-full bg-primary transition-all duration-300 rounded-full"
                      style={{ width: `${progressPct}%` }}
                    />
                  </div>
                  <p className="text-xs text-muted-foreground text-center mt-2 font-mono">
                    {streamProgress.current}/{streamProgress.total} runs complete
                  </p>
                </div>
              )}
            </div>
          ) : (
            <>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-card border border-border p-4 rounded-xl text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Expected Mean (μ)</div>
                  <div className={`text-2xl font-bold font-mono ${result.meanSupport > 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                    {formatScore(result.meanSupport)}
                  </div>
                </div>
                <div className="bg-card border border-border p-4 rounded-xl text-center">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1">Variance (σ²)</div>
                  <div className="text-2xl font-bold font-mono text-accent">{formatScore(result.variance)}</div>
                </div>
                <div className="bg-card border border-border p-4 rounded-xl text-center md:col-span-2">
                  <div className="text-xs text-muted-foreground uppercase tracking-wider mb-1 flex justify-center items-center gap-1">
                    95% Confidence Interval <AlertTriangle className="w-3 h-3 text-amber-500" />
                  </div>
                  <div className="text-xl font-bold font-mono mt-1">
                    [{formatScore(result.confidenceInterval[0])}, {formatScore(result.confidenceInterval[1])}]
                  </div>
                </div>
              </div>

              <div className="bg-card border border-border p-6 rounded-2xl shadow-sm h-[380px] flex flex-col">
                <h3 className="font-semibold mb-4 text-sm">Outcome Distribution (Policy Support)</h3>
                <div className="flex-1 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={histogramData} margin={{ top: 20, right: 0, left: -20, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" vertical={false} />
                      <XAxis dataKey="label" stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <YAxis stroke="hsl(var(--muted-foreground))" fontSize={12} tickLine={false} axisLine={false} />
                      <RechartsTooltip
                        cursor={{fill: 'hsl(var(--secondary)/0.5)'}}
                        contentStyle={{ backgroundColor: 'hsl(var(--card))', borderColor: 'hsl(var(--border))', borderRadius: '8px' }}
                      />
                      <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                        {histogramData.map((entry, index) => (
                          <Cell key={`cell-${index}`} fill={entry.binCenter > 0 ? 'hsl(var(--primary))' : 'hsl(var(--destructive))'} opacity={0.8} />
                        ))}
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
