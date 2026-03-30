import { useListPolicies } from "@workspace/api-client-react";
import { FileBadge, Plus } from "lucide-react";
import { format } from "date-fns";

export default function Policies() {
  const { data: policies, isLoading } = useListPolicies();

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <FileBadge className="w-8 h-8 text-primary" />
            Policies
          </h1>
          <p className="text-muted-foreground mt-1">Foundational policies that ground the simulation logic.</p>
        </div>
        <button className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl font-medium shadow-sm hover:opacity-90">
          <Plus className="w-4 h-4" /> New Policy
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full h-32 flex items-center justify-center text-muted-foreground">Loading...</div>
        ) : policies?.map(policy => (
          <div key={policy.id} className="bg-card border border-border p-6 rounded-2xl shadow-sm hover:border-primary/50 transition-all flex flex-col h-full">
            <div className="flex justify-between items-start mb-4">
              <FileBadge className="w-8 h-8 text-primary/70" />
              <div className="text-[10px] text-muted-foreground font-mono bg-secondary px-2 py-1 rounded">ID: {policy.id}</div>
            </div>
            <h3 className="text-lg font-bold mb-2">{policy.title}</h3>
            <p className="text-sm text-muted-foreground mb-4 flex-1">{policy.summary}</p>
            <div className="text-xs text-muted-foreground pt-4 border-t border-border/50">
              Created {format(new Date(policy.createdAt), 'MMM d, yyyy')}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
