import { useState, useMemo, useCallback } from "react";
import {
  createGroup,
  useCreateGroupWithAgents,
  useDeleteGroup,
  useListGroups,
  useListAgents,
  useSuggestGroupCohortFields,
  type Group,
  type Agent,
  type SuggestGroupCohortFieldsResponse,
} from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Network,
  Plus,
  Sparkles,
  Trash2,
  X,
  UsersRound,
  Layers,
  ChevronRight,
  User,
  Box,
} from "lucide-react";
import { Link } from "wouter";
import { motion } from "framer-motion";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Button, buttonVariants } from "@/components/ui/button";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { ScrollArea } from "@/components/ui/scroll-area";
import { normalizeApiArray, cn, formatScore } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

export default function Groups() {
  const queryClient = useQueryClient();
  const { data: groups, isLoading } = useListGroups();
  const { data: agentsData, isLoading: agentsLoading } = useListAgents();
  const groupList = normalizeApiArray<Group>(groups);
  const agentList = normalizeApiArray<Agent>(agentsData);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);
  const [groupPendingDelete, setGroupPendingDelete] = useState<Group | null>(
    null,
  );
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
        queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
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

  const deleteGroup = useDeleteGroup({
    mutation: {
      onSuccess: (_data, variables) => {
        queryClient.invalidateQueries({ queryKey: ["/api/groups"] });
        queryClient.invalidateQueries({ queryKey: ["/api/agents"] });
        setSelectedGroup((cur) => (cur?.id === variables.id ? null : cur));
        setGroupPendingDelete(null);
        toast({ title: "Group deleted" });
      },
      onError: () => {
        toast({
          variant: "destructive",
          title: "Could not delete group",
          description: "Try again or check the server.",
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

  const agentsByGroupId = useMemo(() => {
    const m = new Map<number, Agent[]>();
    for (const a of agentList) {
      const gid = a.groupId;
      if (gid == null) continue;
      const list = m.get(gid) ?? [];
      list.push(a);
      m.set(gid, list);
    }
    for (const [, list] of m) {
      list.sort((x, y) => x.name.localeCompare(y.name, undefined, { sensitivity: "base" }));
    }
    return m;
  }, [agentList]);

  const stats = useMemo(() => {
    let linked = 0;
    for (const a of agentList) {
      if (a.groupId != null) linked += 1;
    }
    const poolTotal = groupList.reduce((acc, g) => acc + (g.poolAgentCount ?? 0), 0);
    return { linked, poolTotal };
  }, [agentList, groupList]);

  const container = useMemo(
    () => ({
      hidden: { opacity: 0 },
      show: { opacity: 1, transition: { staggerChildren: 0.06 } },
    }),
    [],
  );
  const item = useMemo(
    () => ({
      hidden: { opacity: 0, y: 16 },
      show: {
        opacity: 1,
        y: 0,
        transition: { type: "spring" as const, stiffness: 380, damping: 28 },
      },
    }),
    [],
  );

  const openGroupAgents = useCallback((g: Group) => {
    setSelectedGroup(g);
  }, []);

  const sheetAgents = useMemo(() => {
    if (!selectedGroup) return [];
    const all = agentsByGroupId.get(selectedGroup.id) ?? [];
    return all
      .filter((a) => a.simulationId == null)
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  }, [selectedGroup, agentsByGroupId]);

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="relative min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <Network className="h-3.5 w-3.5 text-accent" aria-hidden />
            Cohort design
          </div>
          <h1 className="bg-gradient-to-r from-foreground to-foreground/55 bg-clip-text text-3xl font-bold tracking-tight text-transparent md:text-4xl">
            Agent groups
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            LLM-generated cohorts with shared community context. Use them as agent pools when you create
            simulations—click a card to inspect every persona in that group.
          </p>
        </div>
        <Button
          size="lg"
          className="h-11 shrink-0 gap-2 rounded-xl bg-accent text-accent-foreground shadow-[0_0_24px_-8px_hsl(var(--accent))] transition-transform hover:-translate-y-0.5 hover:opacity-95"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="h-5 w-5" />
          Create group
        </Button>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-accent/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <Layers className="h-24 w-24 text-accent" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Cohorts</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : groupList.length}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Named groups in your workspace</p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <UsersRound className="h-24 w-24 text-primary" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Linked agents</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {agentsLoading ? "—" : stats.linked}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Personas assigned to any cohort</p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-emerald-500/30"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <Box className="h-24 w-24 text-emerald-500" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Pool (ready)</p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.poolTotal}
          </p>
          <p className="mt-1 text-xs text-muted-foreground">Agents available to clone into new runs</p>
        </motion.div>
      </motion.div>

      <div className="rounded-2xl border border-border/50 bg-card/50 p-4 shadow-lg backdrop-blur-md md:p-6">
        <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Your cohorts</h2>
            <p className="text-sm text-muted-foreground">
              Select a group to view agents. Delete is isolated so you don&apos;t open the sheet by mistake.
            </p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
          {isLoading ? (
            <div className="col-span-full py-16 text-center text-sm text-muted-foreground">Loading groups…</div>
          ) : groupList.length === 0 ? (
            <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/50 bg-gradient-to-b from-card/40 to-transparent px-6 py-20 text-center">
              <div className="flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-card/80 shadow-md">
                <Network className="h-7 w-7 text-accent/80" />
              </div>
              <p className="mt-4 font-medium text-foreground">No groups yet</p>
              <p className="mt-1 max-w-sm text-sm text-muted-foreground">
                Create a cohort with GenAI personas, or an empty shell to fill later.
              </p>
              <Button className="mt-6 gap-2 rounded-xl bg-accent text-accent-foreground" onClick={() => setIsDialogOpen(true)}>
                <Plus className="h-4 w-4" />
                Create your first group
              </Button>
            </div>
          ) : (
            groupList.map((group) => {
              const members = agentsByGroupId.get(group.id) ?? [];
              const poolPersonas = members.filter((a) => a.simulationId == null);
              return (
                <motion.div
                  key={group.id}
                  layout
                  initial={{ opacity: 0, y: 10 }}
                  animate={{ opacity: 1, y: 0 }}
                  className={cn(
                    "group relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/65 shadow-sm ring-1 ring-foreground/[0.04] backdrop-blur-md",
                    "transition-all duration-300 ease-out",
                    "hover:-translate-y-0.5 hover:border-primary/40 hover:shadow-lg hover:shadow-primary/[0.07]",
                  )}
                >
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-primary/45 to-transparent opacity-80"
                    aria-hidden
                  />
                  <div
                    className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 rounded-full bg-gradient-to-br from-primary/[0.12] to-accent/[0.06] blur-2xl transition-opacity duration-300 group-hover:opacity-100 opacity-60"
                    aria-hidden
                  />
                  <div
                    role="button"
                    tabIndex={0}
                    className="relative flex flex-1 cursor-pointer flex-col p-5 text-left outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                    onClick={() => openGroupAgents(group)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" || e.key === " ") {
                        e.preventDefault();
                        openGroupAgents(group);
                      }
                    }}
                  >
                    <div className="mb-4 flex items-start justify-between gap-3">
                      <div className="flex min-w-0 flex-1 items-start gap-3">
                        <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-gradient-to-br from-primary/12 to-accent/8 text-primary shadow-inner">
                          <Network className="h-5 w-5" aria-hidden />
                        </div>
                        <h3 className="min-w-0 flex-1 pt-1 text-lg font-semibold leading-snug tracking-tight text-foreground transition-colors group-hover:text-primary">
                          {group.name}
                        </h3>
                      </div>
                      <ChevronRight
                        className="mt-1.5 h-5 w-5 shrink-0 text-muted-foreground transition-all duration-300 group-hover:translate-x-0.5 group-hover:text-primary"
                        aria-hidden
                      />
                    </div>
                    <p className="line-clamp-3 flex-1 text-sm leading-relaxed text-muted-foreground">
                      {group.description || "No description."}
                    </p>
                    <div className="mt-5 flex flex-wrap items-center gap-2">
                      <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-secondary/35 px-2.5 py-1 text-xs font-medium text-foreground/90 backdrop-blur-sm">
                        <UsersRound className="h-3.5 w-3.5 text-primary" aria-hidden />
                        {poolPersonas.length} persona{poolPersonas.length === 1 ? "" : "s"} in pool
                      </span>
                      {members.length > poolPersonas.length ? (
                        <span className="inline-flex items-center gap-1.5 rounded-full border border-border/50 bg-muted/40 px-2.5 py-1 text-xs font-medium text-muted-foreground">
                          +{members.length - poolPersonas.length} sim cop{members.length - poolPersonas.length === 1 ? "y" : "ies"}
                        </span>
                      ) : null}
                    </div>
                    <p className="mt-4 flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/80">
                      <span className="h-1 w-1 rounded-full bg-primary/60" aria-hidden />
                      Open pool · one row per persona
                    </p>
                  </div>
                  <div className="relative border-t border-border/50 bg-gradient-to-b from-muted/20 to-muted/5 px-3 py-2 backdrop-blur-sm">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        setGroupPendingDelete(group);
                      }}
                      disabled={deleteGroup.isPending}
                      className="flex w-full items-center justify-center gap-2 rounded-xl py-2.5 text-sm font-medium text-destructive/95 transition-colors hover:bg-destructive/[0.08] disabled:opacity-50"
                      aria-label={`Delete group ${group.name}`}
                    >
                      <Trash2 className="h-4 w-4" />
                      Delete group
                    </button>
                  </div>
                </motion.div>
              );
            })
          )}
        </div>
      </div>

      <Sheet
        open={!!selectedGroup}
        onOpenChange={(open) => {
          if (!open) setSelectedGroup(null);
        }}
      >
        <SheetContent
          side="right"
          className="flex w-full flex-col border-border/50 bg-background/95 backdrop-blur-md sm:max-w-lg"
        >
          {selectedGroup ? (
            <>
              <SheetHeader className="space-y-1 pr-8 text-left">
                <SheetTitle className="text-xl tracking-tight">{selectedGroup.name}</SheetTitle>
                <SheetDescription className="text-sm leading-relaxed">
                  {selectedGroup.description?.trim() || "No description for this cohort."}
                </SheetDescription>
                <div className="flex flex-wrap gap-2 pt-2">
                  <span className="rounded-full border border-border/60 bg-muted/30 px-2.5 py-0.5 text-xs font-medium text-muted-foreground">
                    {sheetAgents.length} pool persona{sheetAgents.length === 1 ? "" : "s"}
                  </span>
                </div>
                <p className="rounded-lg border border-border/50 bg-muted/20 px-3 py-2.5 text-xs leading-relaxed text-muted-foreground">
                  Only <span className="font-medium text-foreground">cohort pool</span> personas are listed—one row per
                  template. Copies created for simulations are hidden here; open a simulation to work with those runs.
                </p>
              </SheetHeader>

              <div className="mt-2 min-h-0 flex-1">
                {agentsLoading ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">Loading agents…</p>
                ) : sheetAgents.length === 0 ? (
                  <div className="rounded-xl border border-dashed border-border/60 bg-muted/10 py-12 text-center">
                    <User className="mx-auto h-10 w-10 text-muted-foreground/40" />
                    <p className="mt-3 text-sm font-medium text-foreground">No pool personas</p>
                    <p className="mx-auto mt-1 max-w-xs text-xs text-muted-foreground">
                      Generate a cohort to add pool agents, or every linked row may only exist inside simulations (copies
                      are not shown in this list).
                    </p>
                  </div>
                ) : (
                  <ScrollArea className="h-[calc(100vh-14rem)] pr-3">
                    <ul className="space-y-2 pb-6">
                      {sheetAgents.map((agent) => (
                        <li key={agent.id}>
                          <Link
                            href={`/agents/${agent.id}`}
                            className="flex items-center gap-3 rounded-xl border border-border/50 bg-card/60 p-3 transition-colors hover:border-primary/35 hover:bg-card"
                          >
                            <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/60 bg-secondary/50">
                              <User className="h-5 w-5 text-muted-foreground" aria-hidden />
                            </div>
                            <div className="min-w-0 flex-1">
                              <div className="flex flex-wrap items-center gap-2">
                                <span className="truncate font-medium text-foreground">{agent.name}</span>
                              </div>
                              <p className="truncate text-xs text-muted-foreground">
                                {agent.age} · {agent.gender} · {agent.occupation} · {agent.region}
                              </p>
                              <p className="mt-0.5 text-xs font-mono text-muted-foreground">
                                Influence {formatScore(agent.influenceScore)}
                              </p>
                            </div>
                            <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" aria-hidden />
                          </Link>
                        </li>
                      ))}
                    </ul>
                  </ScrollArea>
                )}
              </div>
            </>
          ) : null}
        </SheetContent>
      </Sheet>

      <AlertDialog
        open={!!groupPendingDelete}
        onOpenChange={(open) => {
          if (!open) setGroupPendingDelete(null);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete group?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes &quot;{groupPendingDelete?.name}&quot; and all pool agents in that
              group. Agents already copied into simulations stay in those runs, but lose the
              group link. This cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className={cn(buttonVariants({ variant: "destructive" }))}
              disabled={deleteGroup.isPending}
              onClick={() => {
                if (groupPendingDelete) {
                  deleteGroup.mutate({ id: groupPendingDelete.id });
                }
              }}
            >
              {deleteGroup.isPending ? "Deleting…" : "Delete"}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

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
