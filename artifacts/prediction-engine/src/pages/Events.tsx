import { useListEvents, type Event } from "@workspace/api-client-react";
import { AlertTriangle, Plus } from "lucide-react";
import { formatScore, normalizeApiArray } from "@/lib/utils";

export default function Events() {
  const { data: events, isLoading } = useListEvents();
  const eventList = normalizeApiArray<Event>(events);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <AlertTriangle className="w-8 h-8 text-amber-500" />
            External Events
          </h1>
          <p className="text-muted-foreground mt-1">Exogenous shocks injected into simulations.</p>
        </div>
        <button className="flex items-center gap-2 bg-amber-500 text-amber-950 px-4 py-2 rounded-xl font-medium shadow-sm hover:bg-amber-400">
          <Plus className="w-4 h-4" /> Inject Event
        </button>
      </div>

      <div className="bg-card border border-border rounded-2xl shadow-sm overflow-hidden">
        <table className="w-full text-left border-collapse">
          <thead>
            <tr className="bg-secondary/30 border-b border-border text-xs uppercase tracking-wider text-muted-foreground">
              <th className="px-6 py-4 font-medium">Type</th>
              <th className="px-6 py-4 font-medium">Description</th>
              <th className="px-6 py-4 font-medium">Impact Score</th>
              <th className="px-6 py-4 font-medium text-right">Target Sim</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border/50">
            {isLoading ? (
              <tr><td colSpan={4} className="px-6 py-8 text-center text-muted-foreground">Loading...</td></tr>
            ) : eventList.map((event) => (
              <tr key={event.id} className="hover:bg-secondary/10 transition-colors">
                <td className="px-6 py-4 font-medium">
                  <span className="bg-amber-500/10 text-amber-500 border border-amber-500/20 px-2 py-1 rounded text-xs">
                    {event.type}
                  </span>
                </td>
                <td className="px-6 py-4 text-sm text-muted-foreground">{event.description}</td>
                <td className="px-6 py-4 font-mono font-bold text-amber-500">{formatScore(event.impactScore)}</td>
                <td className="px-6 py-4 text-right text-sm">{event.simulationId || 'Global'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
