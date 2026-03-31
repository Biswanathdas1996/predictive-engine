import { useState } from "react";
import {
  createGroup,
  useCreateGroupWithAgents,
  useListGroups,
  useSuggestGroupCohortFields,
  type Group,
  type SuggestGroupCohortFieldsResponse,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Network, Plus, Sparkles, X } from "lucide-react";
import { motion } from "framer-motion";
import { normalizeApiArray } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

export default function Groups() {
  const queryClient = useQueryClient();
  const { data: groups, isLoading } = useListGroups();
  const groupList = normalizeApiArray<Group>(groups);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [emptyGroupOnly, setEmptyGroupOnly] = useState(false);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [agentCount, setAgentCount] = useState(24);
  const [demographics, setDemographics] = useState("");
  const [community, setCommunity] = useState("");
  const [educationProfession, setEducationProfession] = useState("");

  const saveEmptyGroup = useMutation({
    mutationFn: (input: { name: string; description: string }) =>
      createGroup({
        name: input.name,
        description: input.description || "",
      }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
      resetDialog();
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

  const saveCohort = useCreateGroupWithAgents({
    mutation: {
      onSuccess: (res) => {
        queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
        resetDialog();
        toast({
          title: "Cohort created",
          description: `${res.agentsCreated} agents added to “${res.group.name}”.`,
        });
      },
      onError: (err) => {
        const message =
          err instanceof Error ? err.message : "Something went wrong.";
        toast({
          variant: "destructive",
          title: "Could not create cohort",
          description: message,
        });
      },
    },
  });

  const suggestFields = useSuggestGroupCohortFields({
    mutation: {
      onSuccess: (data: SuggestGroupCohortFieldsResponse) => {
        setDescription(data.description ?? "");
        setAgentCount(
          Math.max(1, Math.min(500, Math.floor(data.agentCount ?? 24))),
        );
        setDemographics(data.demographics ?? "");
        setCommunity(data.community ?? "");
        setEducationProfession(data.educationProfession ?? "");
        toast({
          title: "Fields filled",
          description: "Review and edit the suggested cohort details, then submit.",
        });
      },
      onError: (err: unknown) => {
        const message =
          err instanceof Error ? err.message : "Something went wrong.";
        toast({
          variant: "destructive",
          title: "Could not generate fields",
          description: message,
        });
      },
    },
  });

  const resetDialog = () => {
    setIsDialogOpen(false);
    setEmptyGroupOnly(false);
    setName("");
    setDescription("");
    setAgentCount(24);
    setDemographics("");
    setCommunity("");
    setEducationProfession("");
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const n = name.trim();
    if (!n) return;

    if (emptyGroupOnly) {
      saveEmptyGroup.mutate({ name: n, description: description.trim() });
      return;
    }

    const ac = Math.max(1, Math.min(500, Math.floor(agentCount)));
    const demo = demographics.trim();
    const comm = community.trim();
    const edu = educationProfession.trim();
    if (!demo || !comm || !edu) {
      toast({
        variant: "destructive",
        title: "Missing fields",
        description: "Fill demographics, community, and education / profession.",
      });
      return;
    }

    saveCohort.mutate({
      data: {
        name: n,
        description: description.trim() || undefined,
        agentCount: ac,
        demographics: demo,
        community: comm,
        educationProfession: edu,
      },
    });
  };

  const pending =
    saveEmptyGroup.isPending || saveCohort.isPending || suggestFields.isPending;

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <Network className="w-8 h-8 text-accent" />
            Agent Groups
          </h1>
          <p className="text-muted-foreground mt-1">
            LLM-generated cohorts with shared community context; link them into simulations.
          </p>
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
              <p className="text-sm text-muted-foreground line-clamp-4">{group.description}</p>
              {group.poolAgentCount != null && (
                <p className="mt-3 text-xs font-mono text-accent">
                  Pool: {group.poolAgentCount} agent{group.poolAgentCount === 1 ? "" : "s"} ready for simulations
                </p>
              )}
            </div>
          ))
        )}
      </div>

      {isDialogOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4 overflow-y-auto">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-lg overflow-hidden my-8"
          >
            <div className="p-6 border-b border-border flex justify-between items-center">
              <div className="flex items-center gap-2">
                <Sparkles className="w-5 h-5 text-accent" />
                <h2 className="text-xl font-bold">New agent group</h2>
              </div>
              <button
                type="button"
                onClick={() => !pending && resetDialog()}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
                disabled={pending}
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[min(70vh,640px)] overflow-y-auto">
              <label className="flex items-center gap-2 text-sm cursor-pointer">
                <input
                  type="checkbox"
                  checked={emptyGroupOnly}
                  onChange={(e) => setEmptyGroupOnly(e.target.checked)}
                  disabled={pending}
                  className="rounded border-border"
                />
                <span className="text-muted-foreground">Empty group only (no agents yet)</span>
              </label>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground" htmlFor="group-name">
                  Name
                </label>
                <input
                  id="group-name"
                  required
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50"
                  placeholder="e.g. Riverside parent–teacher network"
                  autoComplete="off"
                  disabled={pending}
                />
                <button
                  type="button"
                  disabled={pending || !name.trim()}
                  onClick={() => {
                    const n = name.trim();
                    if (!n) return;
                    suggestFields.mutate({
                      data: {
                        name: n,
                        description: description.trim() || undefined,
                      },
                    });
                  }}
                  className="mt-2 w-full flex items-center justify-center gap-2 rounded-xl border border-border bg-secondary/40 px-3 py-2 text-sm font-medium text-foreground hover:bg-secondary/70 disabled:opacity-50 disabled:pointer-events-none transition-colors"
                >
                  <Sparkles className="w-4 h-4 text-accent shrink-0" />
                  {suggestFields.isPending ? "Generating…" : "Generate fields with AI"}
                </button>
                <p className="text-xs text-muted-foreground leading-relaxed">
                  Uses PwC GenAI from the group name and any description you already typed. Fills description,
                  agent count, and cohort details (you can edit everything before creating).
                </p>
              </div>

              <div className="space-y-1.5">
                <label className="text-sm font-medium text-muted-foreground" htmlFor="group-description">
                  Short description <span className="text-xs font-normal">(optional)</span>
                </label>
                <textarea
                  id="group-description"
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={2}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent focus:ring-1 focus:ring-accent/50 min-h-[64px] resize-y"
                  placeholder="One-line summary for cards and reports…"
                  disabled={pending}
                />
              </div>

              {!emptyGroupOnly && (
                <>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground" htmlFor="agent-count">
                      How many agents
                    </label>
                    <input
                      id="agent-count"
                      type="number"
                      min={1}
                      max={500}
                      required
                      value={agentCount}
                      onChange={(e) => setAgentCount(parseInt(e.target.value, 10) || 1)}
                      className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm font-mono focus:outline-none focus:border-accent"
                      disabled={pending}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground" htmlFor="demographics">
                      Demographics
                    </label>
                    <textarea
                      id="demographics"
                      required={!emptyGroupOnly}
                      value={demographics}
                      onChange={(e) => setDemographics(e.target.value)}
                      rows={3}
                      className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent min-h-[72px] resize-y"
                      placeholder="Age bands, income mix, family structure, languages, etc."
                      disabled={pending}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground" htmlFor="community">
                      Community
                    </label>
                    <textarea
                      id="community"
                      required={!emptyGroupOnly}
                      value={community}
                      onChange={(e) => setCommunity(e.target.value)}
                      rows={3}
                      className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent min-h-[72px] resize-y"
                      placeholder="Neighborhood, online spaces, organizations, how they know each other…"
                      disabled={pending}
                    />
                  </div>
                  <div className="space-y-1.5">
                    <label className="text-sm font-medium text-muted-foreground" htmlFor="edu-prof">
                      Education, qualifications &amp; profession mix
                    </label>
                    <textarea
                      id="edu-prof"
                      required={!emptyGroupOnly}
                      value={educationProfession}
                      onChange={(e) => setEducationProfession(e.target.value)}
                      rows={3}
                      className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-accent min-h-[72px] resize-y"
                      placeholder="Degree levels, trades, employment sectors, career stages…"
                      disabled={pending}
                    />
                  </div>
                  <div className="rounded-xl border border-border/80 bg-secondary/20 px-3 py-2.5 text-xs text-muted-foreground leading-relaxed">
                    The model invents distinct personas, belief priors, and per-agent behavioral system prompts
                    so they stay in character during simulation rounds. If the LLM is unavailable, templated
                    agents are still created from your specs.
                  </div>
                </>
              )}

              <div className="flex justify-end gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => !pending && resetDialog()}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
                  disabled={pending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pending}
                  className="px-6 py-2 bg-accent text-accent-foreground rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {pending ? "Working…" : emptyGroupOnly ? "Create empty group" : "Generate cohort"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
