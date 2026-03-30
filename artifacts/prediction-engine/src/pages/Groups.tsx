import { useState } from "react";
import { createGroup, useListGroups, type Group } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Network, Plus, X } from "lucide-react";
import { motion } from "framer-motion";
import { normalizeApiArray } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

export default function Groups() {
  const queryClient = useQueryClient();
  const { data: groups, isLoading } = useListGroups();
  const groupList = normalizeApiArray<Group>(groups);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");

  const saveGroup = useMutation({
    mutationFn: (input: { name: string; description: string }) =>
      createGroup({
        name: input.name,
        description: input.description,
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      setIsDialogOpen(false);
      setName("");
      setDescription("");
      toast({ title: "Group created" });
    },
    onError: (err) => {
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      toast({
        variant: "destructive",
        title: "Could not create group",
        description: message,
      });
    },
  });

  const resetDialog = () => {
    setIsDialogOpen(false);
    setName("");
    setDescription("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;
    saveGroup.mutate({ name: n, description: description.trim() });
  };

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
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          className="flex items-center gap-2 bg-accent text-accent-foreground px-4 py-2 rounded-xl font-medium shadow-sm hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> Create Group
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full text-center text-muted-foreground py-12">Loading...</div>
        ) : groupList.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card/30 py-16 text-center text-muted-foreground text-sm">
            <p>No groups yet.</p>
            <button
              type="button"
              onClick={() => setIsDialogOpen(true)}
              className="mt-3 text-accent font-medium hover:underline"
            >
              Create your first group
            </button>
          </div>
        ) : (
          groupList.map((group) => (
            <div
              key={group.id}
              className="bg-card border border-border p-6 rounded-2xl shadow-sm hover:border-accent/50 transition-all"
            >
              <h3 className="text-xl font-bold mb-2 text-foreground">{group.name}</h3>
              <p className="text-sm text-muted-foreground">{group.description}</p>
            </div>
          ))
        )}
      </div>

      {isDialogOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-lg overflow-hidden"
          >
            <div className="p-6 border-b border-border flex justify-between items-center">
              <h2 className="text-xl font-bold">New group</h2>
              <button
                type="button"
                onClick={resetDialog}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="rounded-xl border border-border/80 bg-secondary/20 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                <p className="font-medium text-foreground/80 mb-1">Examples</p>
                <p>
                  <span className="text-foreground/70">Name:</span>{" "}
                  <span className="font-mono text-[11px]">Coastal climate advocates</span>
                </p>
                <p className="mt-1">
                  <span className="text-foreground/70">Description:</span> Homeowners and
                  small-business owners in seaboard metros; high concern for flooding and
                  insurance costs; active on local news and community boards.
                </p>
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-muted-foreground"
                  htmlFor="group-name"
                >
                  Name
                </label>
                <input
                  id="group-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                  placeholder="Coastal climate advocates"
                  autoComplete="off"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-muted-foreground"
                  htmlFor="group-description"
                >
                  Description
                </label>
                <textarea
                  id="group-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 min-h-[80px] resize-y"
                  placeholder="Who they are, what they care about, and where they show up (media, geography, demographics)…"
                />
              </div>
              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={resetDialog}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
                  disabled={saveGroup.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={saveGroup.isPending}
                  className="px-6 py-2 bg-accent text-accent-foreground rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {saveGroup.isPending ? "Saving…" : "Create group"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
