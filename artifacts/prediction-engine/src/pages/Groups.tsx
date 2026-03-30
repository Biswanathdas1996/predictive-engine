import { useListGroups, type Group } from "@workspace/api-client-react";
import { Network, Plus } from "lucide-react";
import { normalizeApiArray } from "@/lib/utils";

export default function Groups() {
  const { data: groups, isLoading } = useListGroups();
  const groupList = normalizeApiArray<Group>(groups);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Network className="w-8 h-8 text-accent" />
            Agent Groups
          </h1>
          <p className="text-muted-foreground mt-1">Demographic and ideological clusters.</p>
        </div>
        <button className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-xl font-medium shadow-sm hover:opacity-90">
          <Plus className="w-4 h-4" /> Create Group
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full text-center text-muted-foreground py-12">Loading...</div>
        ) : groupList.map((group) => (
          <div key={group.id} className="bg-card border border-border p-6 rounded-2xl shadow-sm hover:border-accent/50 transition-all">
            <h3 className="text-xl font-bold mb-2 text-foreground">{group.name}</h3>
            <p className="text-sm text-muted-foreground">{group.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
