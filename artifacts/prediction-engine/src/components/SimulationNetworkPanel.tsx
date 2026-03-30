import { memo, useCallback, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  Controls,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  getBezierPath,
  type Edge,
  type EdgeProps,
  type Node,
  type NodeProps,
  type NodeTypes,
} from "@xyflow/react";
import "@xyflow/react/dist/style.css";
import "./SimulationNetworkPanel.css";
import {
  getGetSimulationGraphQueryOptions,
  type GraphComment,
  type Post,
  type SimulationGraphEdge,
  type SimulationGraphNode,
} from "@workspace/api-client-react";
import { Database, GitBranch, MessageCircle, Users } from "lucide-react";
import { formatScore } from "@/lib/utils";

type AgentNodeData = {
  agentId: number;
  label: string;
  stance: string;
  policySupport: number;
};

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    const a = parts[0][0] ?? "";
    const b = parts[parts.length - 1][0] ?? "";
    return `${a}${b}`.toUpperCase() || "?";
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

/** Neo4j-style node capsule colors (dark UI) */
const stanceNeo: Record<string, { fill: string; ring: string; glow: string }> = {
  supportive: {
    fill: "bg-[#1a3d2e]",
    ring: "border-[#3fb950]",
    glow: "shadow-[0_0_24px_rgba(63,185,80,0.35)]",
  },
  opposed: {
    fill: "bg-[#3d1a1f]",
    ring: "border-[#f85149]",
    glow: "shadow-[0_0_24px_rgba(248,81,73,0.3)]",
  },
  neutral: {
    fill: "bg-[#21262d]",
    ring: "border-[#8b949e]",
    glow: "shadow-[0_0_20px_rgba(139,148,158,0.2)]",
  },
  radical: {
    fill: "bg-[#2d1f3d]",
    ring: "border-[#a371f7]",
    glow: "shadow-[0_0_24px_rgba(163,113,247,0.35)]",
  },
};

const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const neo = stanceNeo[d.stance] ?? stanceNeo.neutral;
  const initials = initialsFromName(d.label);
  const tip = `${d.label}\n:id ${d.agentId} · ${d.stance}\nPolicy support ${formatScore(d.policySupport)}`;
  return (
    <div
      className="neo-agent-root relative flex w-[84px] flex-col items-center"
      role="group"
      aria-label={tip.replaceAll("\n", ". ")}
    >
      <Handle type="target" position={Position.Top} className="!top-0" />
      <Handle type="target" position={Position.Left} id="in-l" />
      <Handle type="target" position={Position.Right} id="in-r" />
      <div
        className={[
          "flex h-[68px] w-[68px] shrink-0 items-center justify-center rounded-full border-[2.5px] transition-all duration-200",
          neo.fill,
          neo.ring,
          neo.glow,
          selected
            ? "scale-[1.06] ring-2 ring-[#58a6ff] ring-offset-2 ring-offset-[#0d1117]"
            : "hover:brightness-[1.08]",
        ].join(" ")}
        title={tip}
      >
        <span className="select-none text-[19px] font-bold tabular-nums tracking-tight text-[#f0f6fc]">
          {initials}
        </span>
      </div>
      <div className="mt-1 flex w-full flex-col items-center gap-0.5">
        <span className="select-none rounded bg-[#21262d] px-1.5 py-px font-mono text-[9px] font-medium text-[#8b949e] ring-1 ring-[#30363d]">
          Agent
        </span>
        <span className="select-none max-w-full truncate font-mono text-[9px] text-[#6e7681]" title={d.label}>
          #{d.agentId}
        </span>
      </div>
      <Handle type="source" position={Position.Bottom} className="!bottom-0" />
      <Handle type="source" position={Position.Left} id="out-l" />
      <Handle type="source" position={Position.Right} id="out-r" />
    </div>
  );
});

type InfluenceEdgeData = { weight: number; labelMode: "always" | "hover-only" };

const InfluenceEdge = memo(function InfluenceEdge({
  id,
  sourceX,
  sourceY,
  targetX,
  targetY,
  sourcePosition,
  targetPosition,
  style,
  markerEnd,
  data,
  selected,
}: EdgeProps) {
  const [hovered, setHovered] = useState(false);
  const [edgePath, labelX, labelY] = getBezierPath({
    sourceX,
    sourceY,
    sourcePosition,
    targetX,
    targetY,
    targetPosition,
  });
  const d = data as InfluenceEdgeData | undefined;
  const w = typeof d?.weight === "number" ? d.weight : 0;
  const mode = d?.labelMode ?? "hover-only";
  const showLabel = mode === "always" || hovered || Boolean(selected);

  const baseStyle = { ...(style as CSSProperties), pointerEvents: "none" as const };

  return (
    <>
      {/* Wide invisible stroke for hover — readable labels when graph is dense */}
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={22}
        strokeLinecap="round"
        className="react-flow__edge-interaction"
        style={{ cursor: mode === "hover-only" ? "pointer" : "default" }}
        onMouseEnter={() => setHovered(true)}
        onMouseLeave={() => setHovered(false)}
      />
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={baseStyle} />
      <EdgeLabelRenderer>
        {showLabel ? (
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              zIndex: 1000,
              pointerEvents: "none",
            }}
          >
            <div className="neo-edge-label flex flex-col items-center gap-0.5 rounded-lg border-2 border-[#58a6ff] bg-[#0d1117] px-3 py-1.5 shadow-[0_4px_24px_rgba(0,0,0,0.65),0_0_0_1px_rgba(255,255,255,0.08)]">
              <span className="text-[10px] font-semibold uppercase tracking-[0.12em] text-[#8b949e]">
                Influence
              </span>
              <span
                className="tabular-nums text-[15px] font-bold leading-none tracking-tight text-[#f0f6fc]"
                style={{ textShadow: "0 1px 2px rgba(0,0,0,0.9)" }}
              >
                {w.toFixed(2)}
              </span>
            </div>
          </div>
        ) : null}
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes: NodeTypes = { agent: AgentNode };
const edgeTypes = { influence: InfluenceEdge };

const NODES_PER_RING = 12;
/** Visual half-extent of node (circle + label stack) for centering */
const NODE_LAYOUT_R = 48;

/**
 * Concentric rings (graph-db style) so dense simulations stay legible.
 */
function layoutGraphRings(
  nodes: SimulationGraphNode[],
  width: number,
  height: number,
): Node[] {
  const n = nodes.length;
  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);

  const rings: SimulationGraphNode[][] = [];
  for (let i = 0; i < n; i += NODES_PER_RING) {
    rings.push(nodes.slice(i, i + NODES_PER_RING));
  }

  const ringCount = rings.length;
  const baseR = minDim * (n <= 10 ? 0.16 : 0.2);
  const step = minDim * Math.max(0.1, 0.11 - ringCount * 0.008);

  const out: Node[] = [];
  rings.forEach((ringNodes, ringIdx) => {
    const count = ringNodes.length;
    const r = baseR + ringIdx * step;
    ringNodes.forEach((node, i) => {
      const angle = (2 * Math.PI * i) / Math.max(count, 1) - Math.PI / 2;
      out.push({
        id: String(node.id),
        type: "agent",
        position: {
          x: cx + r * Math.cos(angle) - NODE_LAYOUT_R,
          y: cy + r * Math.sin(angle) - NODE_LAYOUT_R,
        },
        data: {
          agentId: node.id,
          label: node.name,
          stance: node.stance,
          policySupport: node.policySupport,
        } satisfies AgentNodeData,
      });
    });
  });

  return out;
}

/** Beyond this, edge labels overlap — show weight on hover only. */
const EDGE_LABEL_ALWAYS_MAX = 14;

function buildEdges(edges: SimulationGraphEdge[]): Edge[] {
  const labelMode: InfluenceEdgeData["labelMode"] =
    edges.length <= EDGE_LABEL_ALWAYS_MAX ? "always" : "hover-only";
  return edges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: String(e.source),
    target: String(e.target),
    type: "influence",
    data: { weight: e.weight, labelMode },
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#7d8590",
      width: 22,
      height: 22,
    },
    style: {
      stroke: "#6e7681",
      strokeWidth: Math.max(1.25, 1.25 + e.weight * 3.5),
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

  const dims = { w: 760, h: 520 };

  const nodes = useMemo(() => {
    if (!graph?.nodes.length) return [];
    return layoutGraphRings(graph.nodes, dims.w, dims.h);
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
        <div className="overflow-hidden rounded-2xl border border-[#30363d] bg-[#0d1117] shadow-[0_0_0_1px_rgba(255,255,255,0.06),0_24px_48px_rgba(0,0,0,0.35)]">
          <div className="flex items-center justify-between gap-3 border-b border-[#21262d] bg-[#161b22] px-4 py-2.5">
            <div className="flex items-center gap-2">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-[#21262d] text-[#58a6ff] ring-1 ring-[#30363d]">
                <Database className="h-4 w-4" aria-hidden />
              </span>
              <div>
                <div className="text-xs font-semibold tracking-tight text-[#e6edf3]">
                  Graph · Influence network
                </div>
                <div className="text-[10px] text-[#8b949e]">
                  Neo4j-style view · directed relationships
                </div>
              </div>
            </div>
            <div className="hidden md:flex flex-col items-end gap-1.5">
              <div className="flex flex-wrap justify-end gap-x-3 gap-y-1 text-[9px] text-[#8b949e]">
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#3fb950] ring-1 ring-[#30363d]" />
                  supportive
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#f85149] ring-1 ring-[#30363d]" />
                  opposed
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#8b949e] ring-1 ring-[#30363d]" />
                  neutral
                </span>
                <span className="inline-flex items-center gap-1.5">
                  <span className="h-2 w-2 rounded-full bg-[#a371f7] ring-1 ring-[#30363d]" />
                  radical
                </span>
              </div>
              <div className="flex gap-2 text-[10px] text-[#8b949e]">
                <span className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono">
                  :Agent
                </span>
                <span className="rounded border border-[#30363d] bg-[#0d1117] px-2 py-0.5 font-mono">
                  INFLUENCES
                </span>
              </div>
            </div>
          </div>
          <p className="border-b border-[#21262d] bg-[#0d1117] px-4 py-2 text-[11px] leading-relaxed text-[#8b949e]">
            Nodes show initials + id (full name in tooltip). Drag to pan · scroll to zoom · thicker links =
            stronger weight · click a node for the inspector.
            {graph.edges.length > EDGE_LABEL_ALWAYS_MAX ? (
              <span className="mt-1 block font-medium text-[#58a6ff]">
                Hover any link to read its influence weight ({graph.edges.length} links — labels hide when dense).
              </span>
            ) : null}
          </p>
          <div className="h-[520px] w-full">
            {nodes.length === 0 ? (
              <div className="flex h-full items-center justify-center bg-[#0d1117] text-sm text-[#8b949e]">
                No agents in this simulation.
              </div>
            ) : (
              <ReactFlow
                nodes={nodes}
                edges={edges}
                nodeTypes={nodeTypes}
                edgeTypes={edgeTypes}
                onNodeClick={onNodeClick}
                nodesDraggable={false}
                nodesConnectable={false}
                elevateNodesOnSelect
                fitView
                fitViewOptions={{ padding: 0.22 }}
                minZoom={0.2}
                maxZoom={1.85}
                proOptions={{ hideAttribution: true }}
                className="neo4j-graph-view !bg-[#0d1117]"
                defaultEdgeOptions={{ zIndex: 0 }}
              >
                <Background
                  id="neo-dots"
                  variant={BackgroundVariant.Dots}
                  gap={22}
                  size={1.2}
                  color="#30363d"
                />
                <Controls showInteractive={false} />
                <MiniMap
                  position="bottom-right"
                  pannable
                  zoomable
                  nodeStrokeWidth={2}
                  nodeStrokeColor="#30363d"
                  nodeColor={(n) => {
                    const stance = (n.data as AgentNodeData | undefined)?.stance ?? "neutral";
                    const map: Record<string, string> = {
                      supportive: "#3fb950",
                      opposed: "#f85149",
                      neutral: "#8b949e",
                      radical: "#a371f7",
                    };
                    return map[stance] ?? map.neutral;
                  }}
                  maskColor="rgba(1, 4, 9, 0.85)"
                  className="!m-3"
                />
              </ReactFlow>
            )}
          </div>
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
