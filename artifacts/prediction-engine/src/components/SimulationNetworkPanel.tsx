import { memo, useCallback, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  Controls,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  type Edge,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import {
  getGetSimulationGraphQueryOptions,
  type GraphComment,
  type Post,
  type SimulationGraphEdge,
  type SimulationGraphNode,
} from "@workspace/api-client-react";
import { GitBranch, MessageCircle, Users } from "lucide-react";
import { formatScore } from "@/lib/utils";

type AgentNodeData = {
  label: string;
  stance: string;
  policySupport: number;
};

const stanceRing: Record<string, string> = {
  supportive: "border-emerald-500/60 bg-emerald-500/10",
  opposed: "border-destructive/60 bg-destructive/10",
  neutral: "border-border bg-secondary/40",
  radical: "border-violet-500/60 bg-violet-500/10",
};

const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const ring = stanceRing[d.stance] ?? stanceRing.neutral;
  return (
    <div
      className={`rounded-xl border px-2 py-1.5 min-w-[108px] max-w-[150px] shadow-md backdrop-blur-sm ${ring} ${
        selected ? "ring-2 ring-primary ring-offset-2 ring-offset-background" : ""
      }`}
    >
      <Handle
        type="target"
        position={Position.Top}
        className="!size-2 !border-0 !bg-muted-foreground"
      />
      <div className="text-[11px] font-semibold leading-tight truncate text-foreground" title={d.label}>
        {d.label}
      </div>
      <div className="text-[9px] text-muted-foreground font-mono mt-0.5">
        stance: {d.stance}
      </div>
      <div className="text-[9px] font-mono text-primary/90">μ pol. {formatScore(d.policySupport)}</div>
      <Handle
        type="source"
        position={Position.Bottom}
        className="!size-2 !border-0 !bg-muted-foreground"
      />
    </div>
  );
});

const nodeTypes: NodeTypes = { agent: AgentNode };

function layoutCircle(
  nodes: SimulationGraphNode[],
  width: number,
  height: number,
): Node[] {
  const n = nodes.length;
  const cx = width / 2;
  const cy = height / 2;
  const r = Math.min(width, height) * 0.36;
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / Math.max(n, 1) - Math.PI / 2;
    return {
      id: String(node.id),
      type: "agent",
      position: {
        x: cx + r * Math.cos(angle) - 54,
        y: cy + r * Math.sin(angle) - 28,
      },
      data: {
        label: node.name,
        stance: node.stance,
        policySupport: node.policySupport,
      } satisfies AgentNodeData,
    };
  });
}

function buildEdges(edges: SimulationGraphEdge[]): Edge[] {
  return edges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: String(e.source),
    target: String(e.target),
    type: "smoothstep",
    label: e.weight.toFixed(2),
    markerEnd: { type: MarkerType.ArrowClosed, color: "hsl(var(--muted-foreground))" },
    style: {
      stroke: "hsl(var(--muted-foreground) / 0.65)",
      strokeWidth: 1 + e.weight * 4,
    },
  }));
}

function ConversationThreads({ posts, comments }: { posts: Post[]; comments: GraphComment[] }) {
  const byPost = useMemo(() => {
    const m = new Map<number, GraphComment[]>();
    for (const c of comments) {
      const arr = m.get(c.postId) ?? [];
      arr.push(c);
      m.set(c.postId, arr);
    }
    for (const arr of m.values()) {
      arr.sort((a, b) => a.round - b.round || a.id - b.id);
    }
    return m;
  }, [comments]);

  const sortedPosts = useMemo(
    () => [...posts].sort((a, b) => a.round - b.round || a.id - b.id),
    [posts],
  );

  if (sortedPosts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-muted-foreground text-sm">
        <MessageCircle className="w-10 h-10 mb-2 opacity-40" />
        No posts yet. Run a simulation round to see conversations.
      </div>
    );
  }

  return (
    <div className="space-y-4 max-h-[520px] overflow-y-auto pr-1">
      {sortedPosts.map((post) => (
        <div
          key={post.id}
          className="rounded-xl border border-border/80 bg-background/80 p-4 shadow-sm"
        >
          <div className="flex items-center justify-between gap-2 mb-2">
            <span className="text-xs font-semibold text-foreground">{post.agentName}</span>
            <span className="text-[10px] font-mono text-muted-foreground">
              Round {post.round} · post #{post.id}
            </span>
          </div>
          <p className="text-sm text-muted-foreground leading-relaxed">{post.content}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {post.topicTags?.map((tag) => (
              <span
                key={tag}
                className="text-[9px] uppercase tracking-wide bg-secondary px-1.5 py-0.5 rounded"
              >
                #{tag}
              </span>
            ))}
          </div>
          {(byPost.get(post.id) ?? []).length > 0 && (
            <div className="mt-3 space-y-2 border-t border-border/50 pt-3">
              <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
                Replies
              </div>
              {(byPost.get(post.id) ?? []).map((c) => (
                <div
                  key={c.id}
                  className="ml-1 pl-3 border-l-2 border-primary/40 text-sm"
                >
                  <div className="text-xs font-medium text-foreground">{c.agentName}</div>
                  <p className="text-muted-foreground text-sm mt-0.5">{c.content}</p>
                  <div className="text-[10px] text-muted-foreground font-mono mt-1">
                    R{c.round} · sent {formatScore(c.sentiment)}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ))}
    </div>
  );
}

export function SimulationNetworkPanel({ simulationId }: { simulationId: number }) {
  const graphQueryEnabled =
    Number.isFinite(simulationId) && simulationId > 0 && !Number.isNaN(simulationId);
  const graphQueryOptions = getGetSimulationGraphQueryOptions(simulationId);
  const {
    data: graph,
    isLoading,
    isError,
    error,
    isFetching,
  } = useQuery({
    ...graphQueryOptions,
    enabled: graphQueryEnabled,
  });
  const [selectedId, setSelectedId] = useState<number | null>(null);

  const dims = { w: 720, h: 480 };

  const nodes = useMemo(() => {
    if (!graph?.nodes.length) return [];
    return layoutCircle(graph.nodes, dims.w, dims.h);
  }, [graph?.nodes]);

  const edges = useMemo(() => (graph?.edges.length ? buildEdges(graph.edges) : []), [graph?.edges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      setSelectedId(Number(node.id));
    },
    [],
  );

  const selected = graph?.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedPosts = graph?.posts.filter((p) => p.agentId === selectedId) ?? [];
  const selectedComments = graph?.comments.filter((c) => c.agentId === selectedId) ?? [];
  const outgoing = graph?.edges.filter((e) => e.source === selectedId) ?? [];
  const incoming = graph?.edges.filter((e) => e.target === selectedId) ?? [];

  if (!graphQueryEnabled) {
    return (
      <div className="rounded-2xl border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
        Invalid simulation id. Open a simulation from the list.
      </div>
    );
  }

  if (isLoading || (isFetching && !graph)) {
    return (
      <div className="h-[560px] rounded-2xl border border-border bg-card/50 animate-pulse flex items-center justify-center text-muted-foreground text-sm">
        Loading network…
      </div>
    );
  }

  if (isError) {
    const err = error as unknown;
    const detail = err instanceof Error ? err.message : String(err ?? "Unknown error");
    const httpStatus =
      err !== null &&
      typeof err === "object" &&
      "status" in err &&
      typeof (err as { status: unknown }).status === "number"
        ? (err as { status: number }).status
        : null;
    const hint =
      httpStatus === 404
        ? "Restart the API server so it picks up GET /api/simulations/{id}/graph, or confirm this simulation exists."
        : /failed to fetch|networkerror|load failed/i.test(detail)
          ? "Network error — is the API running and is Vite proxying /api to the correct port (see API_PORT)?"
          : null;
    return (
      <div className="rounded-2xl border border-destructive/30 bg-destructive/5 p-6 space-y-2">
        <p className="text-sm font-medium text-destructive">Could not load graph data</p>
        <p className="text-xs text-muted-foreground font-mono break-words">{detail}</p>
        {hint ? <p className="text-xs text-muted-foreground pt-2">{hint}</p> : null}
      </div>
    );
  }

  if (!graph) {
    return (
      <div className="rounded-2xl border border-border bg-card/50 p-8 text-center text-sm text-muted-foreground">
        No graph payload returned.
      </div>
    );
  }

  return (
    <div className="grid grid-cols-1 xl:grid-cols-5 gap-6">
      <div className="xl:col-span-3 space-y-3">
        <div className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary/50 px-2 py-1 border border-border/50">
            <Users className="w-3.5 h-3.5" />
            {graph.nodes.length} agents
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary/50 px-2 py-1 border border-border/50">
            <GitBranch className="w-3.5 h-3.5" />
            {graph.edges.length} influence links
          </span>
          <span className="inline-flex items-center gap-1.5 rounded-lg bg-secondary/50 px-2 py-1 border border-border/50">
            <MessageCircle className="w-3.5 h-3.5" />
            {graph.posts.length} posts · {graph.comments.length} comments
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          Arrows show who influences whom (thicker = stronger weight). Click an agent to see their activity
          and connections.
        </p>
        <div className="h-[480px] w-full rounded-2xl border border-border overflow-hidden bg-[hsl(220_16%_8%)]">
          {nodes.length === 0 ? (
            <div className="h-full flex items-center justify-center text-muted-foreground text-sm">
              No agents in this simulation.
            </div>
          ) : (
            <ReactFlow
              nodes={nodes}
              edges={edges}
              nodeTypes={nodeTypes}
              onNodeClick={onNodeClick}
              fitView
              fitViewOptions={{ padding: 0.15 }}
              minZoom={0.4}
              maxZoom={1.5}
              proOptions={{ hideAttribution: true }}
              className="!bg-transparent"
            >
              <Background gap={16} size={1} color="hsl(var(--border))" />
              <Controls className="!bg-card !border-border !shadow-lg" />
              <MiniMap
                className="!bg-card !border-border rounded-lg"
                nodeColor={() => "hsl(var(--primary) / 0.5)"}
                maskColor="hsl(0 0% 0% / 0.75)"
              />
            </ReactFlow>
          )}
        </div>
      </div>

      <div className="xl:col-span-2 space-y-4">
        <div className="rounded-2xl border border-border bg-card/80 p-4 min-h-[200px]">
          <h4 className="text-sm font-semibold mb-3 text-foreground">Selected agent</h4>
          {!selected ? (
            <p className="text-xs text-muted-foreground">Click a node in the graph.</p>
          ) : (
            <div className="space-y-3 text-sm">
              <div>
                <div className="font-semibold text-foreground">{selected.name}</div>
                <div className="text-xs text-muted-foreground mt-1">
                  {selected.stance} · influence {formatScore(selected.influenceScore)} · policy support{" "}
                  {formatScore(selected.policySupport)}
                </div>
              </div>
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground font-medium">Influences (out)</div>
                {outgoing.length === 0 ? (
                  <span className="text-muted-foreground/70">None</span>
                ) : (
                  <ul className="list-disc pl-4 space-y-0.5">
                    {outgoing.map((e, i) => {
                      const name = graph.nodes.find((n) => n.id === e.target)?.name ?? `#${e.target}`;
                      return (
                        <li key={`o-${i}`}>
                          → {name}{" "}
                          <span className="font-mono text-[10px]">w={e.weight.toFixed(2)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground font-medium">Influenced by (in)</div>
                {incoming.length === 0 ? (
                  <span className="text-muted-foreground/70">None</span>
                ) : (
                  <ul className="list-disc pl-4 space-y-0.5">
                    {incoming.map((e, i) => {
                      const name = graph.nodes.find((n) => n.id === e.source)?.name ?? `#${e.source}`;
                      return (
                        <li key={`i-${i}`}>
                          ← {name}{" "}
                          <span className="font-mono text-[10px]">w={e.weight.toFixed(2)}</span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </div>
              <div className="text-xs space-y-1 border-t border-border/50 pt-2">
                <div className="text-muted-foreground font-medium">Their posts ({selectedPosts.length})</div>
                {selectedPosts.length === 0 ? (
                  <span className="text-muted-foreground/70">No posts yet.</span>
                ) : (
                  <ul className="space-y-1 max-h-24 overflow-y-auto">
                    {selectedPosts.slice(0, 5).map((p) => (
                      <li key={p.id} className="text-muted-foreground line-clamp-2">
                        R{p.round}: {p.content}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
              <div className="text-xs space-y-1">
                <div className="text-muted-foreground font-medium">Their comments ({selectedComments.length})</div>
                {selectedComments.length === 0 ? (
                  <span className="text-muted-foreground/70">No comments yet.</span>
                ) : (
                  <ul className="space-y-1 max-h-24 overflow-y-auto">
                    {selectedComments.slice(0, 5).map((c) => (
                      <li key={c.id} className="text-muted-foreground line-clamp-2">
                        R{c.round}: {c.content}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="rounded-2xl border border-border bg-card/80 p-4">
          <h4 className="text-sm font-semibold mb-3 flex items-center gap-2">
            <MessageCircle className="w-4 h-4 text-accent" />
            Conversation threads
          </h4>
          <ConversationThreads posts={graph.posts} comments={graph.comments} />
        </div>
      </div>
    </div>
  );
}
