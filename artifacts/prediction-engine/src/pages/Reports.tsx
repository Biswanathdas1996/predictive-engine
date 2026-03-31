import { useState, useCallback, useRef } from "react";
import { useListSimulations, type Simulation } from "@workspace/api-client-react";
import { FileText, Target, AlertTriangle, Users, GitMerge, Download, Radio } from "lucide-react";
import { formatPercent, formatScore } from "@/lib/utils";
import { format } from "date-fns";
import { normalizeApiArray } from "@/lib/utils";
import { consumeSSEStream, type SSEEvent } from "@/lib/sse";

interface Report {
  simulationId: number;
  simulationName: string;
  generatedAt: string;
  keyOutcomes: { label: string; probability: number; impact: string }[];
  riskFactors: string[];
  influentialAgents: { agentId: number; name: string; influenceScore: number; stance: string }[];
  causalDrivers: string[];
  monteCarloSummary: { totalRuns: number; meanSupport: number; variance: number; confidenceInterval: number[] };
  beliefEvolution: { round: number; averagePolicySupport: number; averageTrustInGovernment: number; averageEconomicOutlook: number }[];
}

export default function Reports() {
  const { data: simulations } = useListSimulations();
  const simulationList = normalizeApiArray<Simulation>(simulations);
  const [selectedSim, setSelectedSim] = useState<string>("");

  // Streaming state
  const [isLoading, setIsLoading] = useState(false);
  const [report, setReport] = useState<Report | null>(null);
  const [streamMessage, setStreamMessage] = useState("");
  const [streamPhase, setStreamPhase] = useState("");
  const abortRef = useRef<AbortController | null>(null);

  const loadReport = useCallback((simId: string) => {
    setSelectedSim(simId);
    if (!simId) {
      setReport(null);
      return;
    }

    setIsLoading(true);
    setReport(null);
    setStreamMessage("Loading...");
    setStreamPhase("init");

    const abort = new AbortController();
    abortRef.current = abort;

    consumeSSEStream({
      url: `/api/reports/${simId}/stream`,
      method: "GET",
      signal: abort.signal,
      onEvent: (event: SSEEvent) => {
        if (event.type === "status") {
          const e = event as SSEEvent & { phase?: string; message?: string };
          if (e.phase) setStreamPhase(e.phase);
          if (e.message) setStreamMessage(e.message);
        } else if (event.type === "complete") {
          const e = event as SSEEvent & { report: Report };
          setReport(e.report);
          setStreamMessage("Report generated");
        }
      },
      onError: (msg) => {
        setStreamMessage(`Error: ${msg}`);
      },
      onDone: () => {
        setIsLoading(false);
      },
    });
  }, []);

  return (
    <div className="space-y-6">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <FileText className="w-8 h-8 text-primary" />
            Intelligence Reports
          </h1>
          <p className="text-muted-foreground mt-1">Executive summaries of simulation outcomes and key drivers.</p>
        </div>

        <div className="flex items-center gap-3">
          <select
            value={selectedSim}
            onChange={(e) => loadReport(e.target.value)}
            className="bg-card border border-border rounded-xl px-4 py-2 text-sm font-medium focus:outline-none focus:border-primary shadow-sm min-w-[250px]"
            disabled={isLoading}
          >
            <option value="">Select a simulation...</option>
            {simulationList.map(s => (
              <option key={s.id} value={s.id}>{s.name}</option>
            ))}
          </select>
          <button
            disabled={!report}
            className="flex items-center gap-2 bg-secondary text-secondary-foreground px-4 py-2 rounded-xl font-medium hover:bg-secondary/80 disabled:opacity-50 transition-colors"
          >
            <Download className="w-4 h-4" /> PDF
          </button>
        </div>
      </div>

      {!selectedSim ? (
        <div className="h-[60vh] flex flex-col justify-center items-center bg-card/30 border border-border/30 border-dashed rounded-3xl">
          <FileText className="w-16 h-16 text-muted-foreground opacity-30 mb-4" />
          <p className="text-lg text-muted-foreground">Select a simulation to generate report</p>
        </div>
      ) : isLoading ? (
        <div className="h-[60vh] flex flex-col justify-center items-center bg-card rounded-3xl border border-border">
          <div className="w-12 h-12 border-4 border-primary/30 border-t-primary rounded-full animate-spin mb-4" />
          <p className="text-primary font-mono animate-pulse">Synthesizing intelligence...</p>
          <div className="mt-4 flex items-center gap-2 text-sm text-muted-foreground">
            <Radio className="w-4 h-4 text-primary animate-pulse" />
            <span className="font-mono">{streamMessage}</span>
          </div>
          <div className="mt-3 flex gap-1.5">
            {["init", "agents", "snapshots", "montecarlo", "computing", "risks", "influencers"].map((phase) => (
              <div
                key={phase}
                className={`h-1.5 w-8 rounded-full transition-all duration-500 ${
                  streamPhase === phase ? "bg-primary scale-110" :
                  ["init", "agents", "snapshots", "montecarlo", "computing", "risks", "influencers"].indexOf(phase) <
                  ["init", "agents", "snapshots", "montecarlo", "computing", "risks", "influencers"].indexOf(streamPhase)
                    ? "bg-primary/40" : "bg-secondary"
                }`}
              />
            ))}
          </div>
        </div>
      ) : report ? (
        <div className="bg-card border border-border rounded-2xl shadow-xl overflow-hidden print:shadow-none print:border-none">
          {/* Report Header */}
          <div className="bg-gradient-to-br from-primary/10 to-transparent border-b border-border p-8">
            <div className="flex justify-between items-start mb-6">
              <div>
                <div className="text-xs font-mono text-primary uppercase tracking-wider mb-2">Classified Prediction Document</div>
                <h2 className="text-3xl font-bold text-foreground mb-2">{report.simulationName}</h2>
                <div className="text-sm text-muted-foreground flex items-center gap-4">
                  <span>ID: SIM-{report.simulationId}</span>
                  <span>Generated: {format(new Date(report.generatedAt), 'PPpp')}</span>
                </div>
              </div>
              <div className="text-right">
                <div className="text-xs text-muted-foreground uppercase mb-1">Expected Outcome</div>
                <div className={`text-4xl font-bold font-mono ${report.monteCarloSummary.meanSupport > 0 ? 'text-emerald-400' : 'text-destructive'}`}>
                  {formatScore(report.monteCarloSummary.meanSupport)}
                </div>
              </div>
            </div>
          </div>

          <div className="p-8 grid grid-cols-1 md:grid-cols-2 gap-8">
            {/* Left Column */}
            <div className="space-y-8">
              <section>
                <h3 className="text-lg font-bold flex items-center gap-2 mb-4 border-b border-border/50 pb-2">
                  <Target className="w-5 h-5 text-primary" /> Key Outcomes
                </h3>
                <div className="space-y-3">
                  {report.keyOutcomes.map((outcome, i) => (
                    <div key={i} className="bg-secondary/20 border border-border rounded-lg p-3 flex justify-between items-center">
                      <div>
                        <div className="font-medium">{outcome.label}</div>
                        <div className="text-xs text-muted-foreground">Impact: {outcome.impact}</div>
                      </div>
                      <div className="text-right">
                        <div className="text-xl font-mono text-primary">{formatPercent(outcome.probability)}</div>
                        <div className="text-[10px] uppercase text-muted-foreground">Prob</div>
                      </div>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-lg font-bold flex items-center gap-2 mb-4 border-b border-border/50 pb-2">
                  <GitMerge className="w-5 h-5 text-accent" /> Causal Drivers
                </h3>
                <ul className="list-disc list-inside space-y-2 text-sm text-muted-foreground pl-4">
                  {report.causalDrivers.map((driver, i) => (
                    <li key={i}>{driver}</li>
                  ))}
                </ul>
              </section>
            </div>

            {/* Right Column */}
            <div className="space-y-8">
              <section>
                <h3 className="text-lg font-bold flex items-center gap-2 mb-4 border-b border-border/50 pb-2 text-amber-500">
                  <AlertTriangle className="w-5 h-5" /> Risk Factors
                </h3>
                <div className="space-y-2">
                  {report.riskFactors.map((risk, i) => (
                    <div key={i} className="flex gap-3 text-sm items-start bg-amber-500/5 border border-amber-500/20 p-3 rounded-lg text-amber-100/80">
                      <div className="w-1.5 h-1.5 rounded-full bg-amber-500 mt-1.5 shrink-0" />
                      <p>{risk}</p>
                    </div>
                  ))}
                </div>
              </section>

              <section>
                <h3 className="text-lg font-bold flex items-center gap-2 mb-4 border-b border-border/50 pb-2">
                  <Users className="w-5 h-5 text-primary" /> Key Influencers
                </h3>
                <div className="space-y-3">
                  {report.influentialAgents.map((agent, i) => (
                    <div key={i} className="flex justify-between items-center text-sm border-b border-border/50 pb-2 last:border-0">
                      <div className="font-medium">{agent.name}</div>
                      <div className="flex items-center gap-4">
                        <span className="text-muted-foreground">{agent.stance}</span>
                        <span className="font-mono text-accent w-12 text-right">{formatScore(agent.influenceScore)}</span>
                      </div>
                    </div>
                  ))}
                </div>
              </section>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
