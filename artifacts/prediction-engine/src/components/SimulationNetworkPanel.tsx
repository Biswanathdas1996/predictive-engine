import { memo, useCallback, useEffect, useMemo, useState, type CSSProperties } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Background,
  BackgroundVariant,
  BaseEdge,
  EdgeLabelRenderer,
  Handle,
  MarkerType,
  MiniMap,
  Position,
  ReactFlow,
  ReactFlowProvider,
  getBezierPath,
  useReactFlow,
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
import {
  Maximize2,
  Minimize2,
  X,
  ArrowRight,
  MessageCircle,
  Search,
  ZoomIn,
  ZoomOut,
  Crosshair,
} from "lucide-react";
import { formatScore } from "@/lib/utils";

type AgentNodeData = {
  agentId: number;
  label: string;
  stance: string;
  policySupport: number;
  influenceScore: number;
};

const stanceConfig: Record<string, { color: string; label: string }> = {
  supportive: { color: "#22c55e", label: "Supportive" },
  opposed: { color: "#ef4444", label: "Opposed" },
  neutral: { color: "#6366f1", label: "Neutral" },
  radical: { color: "#a855f7", label: "Radical" },
};

const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const cfg = stanceConfig[d.stance] ?? stanceConfig.neutral;
  const nodeSize = 32;

  return (
    <div style={{ position: "relative", display: "flex", alignItems: "center", userSelect: "none" }}>
      <Handle type="target" position={Position.Top} className="!top-0" />
      <Handle type="target" position={Position.Left} id="in-l" />
      <Handle type="target" position={Position.Right} id="in-r" />
      <div
        className="graph-node-circle"
        style={{
          width: nodeSize,
          height: nodeSize,
          borderRadius: "50%",
          background: cfg.color,
          boxShadow: selected
            ? `0 0 0 4px ${cfg.color}40, 0 2px 8px ${cfg.color}30`
            : `0 1px 4px rgba(0,0,0,0.15)`,
          cursor: "pointer",
          flexShrink: 0,
        }}
      />
      <span
        style={{
          position: "absolute",
          left: nodeSize + 6,
          top: "50%",
          transform: "translateY(-50%)",
          fontSize: 11,
          fontWeight: 500,
          color: "#374151",
          whiteSpace: "nowrap",
          pointerEvents: "none",
          textShadow: "0 0 3px #fff, 0 0 3px #fff, 0 0 3px #fff",
          maxWidth: 120,
          overflow: "hidden",
          textOverflow: "ellipsis",
        }}
        title={d.label}
      >
        {d.label}
      </span>
      <Handle type="source" position={Position.Bottom} className="!bottom-0" />
      <Handle type="source" position={Position.Left} id="out-l" />
      <Handle type="source" position={Position.Right} id="out-r" />
    </div>
  );
});

type InfluenceEdgeData = { weight: number; showLabels: boolean };

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
}: EdgeProps) {
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
  const showLabels = d?.showLabels ?? false;

  const baseStyle = { ...(style as CSSProperties), pointerEvents: "none" as const };

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={baseStyle} />
      <EdgeLabelRenderer>
        {showLabels && (
          <div
            className="nodrag nopan"
            style={{
              position: "absolute",
              transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)`,
              zIndex: 5,
              pointerEvents: "none",
            }}
          >
            <span
              style={{
                fontSize: 8,
                fontWeight: 500,
                color: "#9ca3af",
                letterSpacing: "0.04em",
                textTransform: "uppercase",
                background: "rgba(250,251,252,0.9)",
                padding: "1px 4px",
                borderRadius: 3,
              }}
            >
              INFLUENCES {w.toFixed(1)}
            </span>
          </div>
        )}
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes: NodeTypes = { agent: AgentNode };
const edgeTypes = { influence: InfluenceEdge };

const NODES_PER_RING = 14;

function layoutGraphForce(
  nodes: SimulationGraphNode[],
  edges: SimulationGraphEdge[],
  width: number,
  height: number,
): Node[] {
  const n = nodes.length;
  if (n === 0) return [];

  const cx = width / 2;
  const cy = height / 2;
  const minDim = Math.min(width, height);

  const positions: { x: number; y: number }[] = [];

  const connMap = new Map<number, number>();
  for (const e of edges) {
    connMap.set(e.source, (connMap.get(e.source) ?? 0) + 1);
    connMap.set(e.target, (connMap.get(e.target) ?? 0) + 1);
  }

  const sorted = [...nodes].sort((a, b) => {
    const ca = connMap.get(a.id) ?? 0;
    const cb = connMap.get(b.id) ?? 0;
    return cb - ca;
  });

  const rings: SimulationGraphNode[][] = [];
  for (let i = 0; i < sorted.length; i += NODES_PER_RING) {
    rings.push(sorted.slice(i, i + NODES_PER_RING));
  }

  const baseR = minDim * 0.12;
  const step = minDim * 0.11;

  rings.forEach((ringNodes, ringIdx) => {
    const count = ringNodes.length;
    const r = baseR + ringIdx * step;
    const angleOffset = ringIdx * 0.3;
    ringNodes.forEach((_, i) => {
      const angle = (2 * Math.PI * i) / Math.max(count, 1) - Math.PI / 2 + angleOffset;
      const jitterX = (Math.random() - 0.5) * 30;
      const jitterY = (Math.random() - 0.5) * 30;
      positions.push({
        x: cx + r * Math.cos(angle) + jitterX,
        y: cy + r * Math.sin(angle) + jitterY,
      });
    });
  });

  return sorted.map((node, idx) => ({
    id: String(node.id),
    type: "agent",
    position: {
      x: positions[idx].x - 16,
      y: positions[idx].y - 16,
    },
    data: {
      agentId: node.id,
      label: node.name,
      stance: node.stance,
      policySupport: node.policySupport,
      influenceScore: node.influenceScore,
    } satisfies AgentNodeData,
  }));
}

function buildEdges(edges: SimulationGraphEdge[], showLabels: boolean): Edge[] {
  return edges.map((e, i) => ({
    id: `e-${e.source}-${e.target}-${i}`,
    source: String(e.source),
    target: String(e.target),
    type: "influence",
    data: { weight: e.weight, showLabels } satisfies InfluenceEdgeData,
    markerEnd: {
      type: MarkerType.ArrowClosed,
      color: "#ccc",
      width: 14,
      height: 14,
    },
    style: {
      stroke: "#d1d5db",
      strokeWidth: Math.max(1, 0.8 + e.weight * 2),
    },
  }));
}

function GraphToolbarControls({ onFitView }: { onFitView: () => void }) {
  const { zoomIn, zoomOut } = useReactFlow();
  const btnStyle: CSSProperties = {
    background: "none",
    border: "none",
    color: "#6b7280",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    borderRadius: 6,
  };
  return (
    <div className="graph-db-toolbar-group">
      <button onClick={() => zoomIn({ duration: 200 })} style={btnStyle} title="Zoom in">
        <ZoomIn size={16} />
      </button>
      <button onClick={() => zoomOut({ duration: 200 })} style={btnStyle} title="Zoom out">
        <ZoomOut size={16} />
      </button>
      <div style={{ width: 1, height: 16, background: "#e5e7eb" }} />
      <button onClick={onFitView} style={btnStyle} title="Fit to view">
        <Crosshair size={16} />
      </button>
    </div>
  );
}

function InspectorPanel({
  selected,
  outgoing,
  incoming,
  selectedPosts,
  selectedComments,
  allNodes,
  onClose,
}: {
  selected: SimulationGraphNode;
  outgoing: SimulationGraphEdge[];
  incoming: SimulationGraphEdge[];
  selectedPosts: Post[];
  selectedComments: GraphComment[];
  allNodes: SimulationGraphNode[];
  onClose: () => void;
}) {
  const cfg = stanceConfig[selected.stance] ?? stanceConfig.neutral;
  return (
    <div className="graph-db-inspector">
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid #f0f0f0",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              background: cfg.color,
              flexShrink: 0,
            }}
          />
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#111827" }}>{selected.name}</div>
            <div style={{ fontSize: 11, color: "#9ca3af" }}>Agent #{selected.id}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "#f3f4f6",
            border: "1px solid #e5e7eb",
            borderRadius: 6,
            color: "#6b7280",
            cursor: "pointer",
            padding: 5,
            display: "flex",
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          {[
            { label: "Stance", value: selected.stance, color: cfg.color, capitalize: true },
            { label: "Influence", value: formatScore(selected.influenceScore), mono: true },
            { label: "Policy Support", value: formatScore(selected.policySupport), mono: true },
            { label: "Confidence", value: formatScore(selected.confidenceLevel), mono: true },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: "#f9fafb",
                borderRadius: 8,
                padding: "10px 12px",
                border: "1px solid #f0f0f0",
              }}
            >
              <div style={{ fontSize: 9, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
                {item.label}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: item.color ?? "#111827",
                  textTransform: item.capitalize ? "capitalize" : undefined,
                  fontFamily: item.mono ? "ui-monospace, monospace" : undefined,
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        {[
          { title: "Outgoing", items: outgoing, isOutgoing: true },
          { title: "Incoming", items: incoming, isOutgoing: false },
        ].map(({ title, items, isOutgoing }) => (
          <div key={title} style={{ marginBottom: 14 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#9ca3af",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ArrowRight size={12} style={isOutgoing ? undefined : { transform: "rotate(180deg)" }} />
              {title} ({items.length})
            </div>
            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: "#d1d5db" }}>None</div>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 3, maxHeight: 140, overflowY: "auto" }}>
                {items.map((e, i) => {
                  const other = allNodes.find((n) => n.id === (isOutgoing ? e.target : e.source));
                  const oc = stanceConfig[other?.stance ?? "neutral"] ?? stanceConfig.neutral;
                  return (
                    <div
                      key={`${title}-${i}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "5px 8px",
                        background: "#f9fafb",
                        borderRadius: 6,
                        border: "1px solid #f0f0f0",
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: oc.color, flexShrink: 0 }} />
                        <span style={{ color: "#374151" }}>{other?.name ?? `#${isOutgoing ? e.target : e.source}`}</span>
                      </div>
                      <span style={{ color: "#6366f1", fontFamily: "ui-monospace, monospace", fontSize: 10 }}>
                        {e.weight.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        {selectedPosts.length > 0 && (
          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6, display: "flex", alignItems: "center", gap: 6 }}>
              <MessageCircle size={12} />
              Posts ({selectedPosts.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 150, overflowY: "auto" }}>
              {selectedPosts.slice(0, 6).map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: "6px 8px",
                    background: "#f9fafb",
                    borderRadius: 6,
                    border: "1px solid #f0f0f0",
                    fontSize: 11,
                    color: "#6b7280",
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2, fontFamily: "ui-monospace, monospace" }}>
                    Round {p.round}
                  </div>
                  <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {p.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedComments.length > 0 && (
          <div style={{ borderTop: "1px solid #f0f0f0", paddingTop: 12, marginTop: 10 }}>
            <div style={{ fontSize: 10, fontWeight: 600, color: "#9ca3af", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 6 }}>
              Comments ({selectedComments.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 120, overflowY: "auto" }}>
              {selectedComments.slice(0, 5).map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: "6px 8px",
                    background: "#f9fafb",
                    borderRadius: 6,
                    border: "1px solid #f0f0f0",
                    fontSize: 11,
                    color: "#6b7280",
                    lineHeight: 1.4,
                  }}
                >
                  <div style={{ fontSize: 9, color: "#9ca3af", marginBottom: 2, fontFamily: "ui-monospace, monospace" }}>
                    R{c.round} · Sent {formatScore(c.sentiment)}
                  </div>
                  <div style={{ display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {c.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function GraphContent({
  nodes,
  edges,
  onNodeClick,
  selectedId,
  graph,
  isFullscreen,
  onToggleFullscreen,
  showEdgeLabels,
  onToggleEdgeLabels,
}: {
  nodes: Node[];
  edges: Edge[];
  onNodeClick: (_: React.MouseEvent, node: Node) => void;
  selectedId: number | null;
  graph: {
    nodes: SimulationGraphNode[];
    edges: SimulationGraphEdge[];
    posts: Post[];
    comments: GraphComment[];
  };
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  showEdgeLabels: boolean;
  onToggleEdgeLabels: () => void;
}) {
  const { fitView } = useReactFlow();
  const handleFitView = useCallback(() => fitView({ padding: 0.15, duration: 300 }), [fitView]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const selectedPosts = graph.posts.filter((p) => p.agentId === selectedId);
  const selectedComments = graph.comments.filter((c) => c.agentId === selectedId);
  const outgoing = graph.edges.filter((e) => e.source === selectedId);
  const incoming = graph.edges.filter((e) => e.target === selectedId);

  const [searchQuery, setSearchQuery] = useState("");
  const [showSearch, setShowSearch] = useState(false);

  const filteredNodes = useMemo(() => {
    if (!searchQuery.trim()) return null;
    const q = searchQuery.toLowerCase();
    return graph.nodes
      .filter((n) => n.name.toLowerCase().includes(q) || String(n.id).includes(q))
      .slice(0, 8);
  }, [searchQuery, graph.nodes]);

  const btnStyle: CSSProperties = {
    background: "none",
    border: "none",
    color: "#6b7280",
    cursor: "pointer",
    padding: 4,
    display: "flex",
    borderRadius: 6,
  };

  return (
    <>
      <div className="graph-db-toolbar">
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="graph-db-toolbar-group" style={{ gap: 8 }}>
            <span style={{ fontSize: 13, fontWeight: 600, color: "#111827" }}>
              Influence Network
            </span>
            <span style={{ fontSize: 11, color: "#9ca3af" }}>
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </span>
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="graph-db-toolbar-group" style={{ gap: 8 }}>
            <span style={{ fontSize: 11, color: "#6b7280", fontWeight: 500 }}>Show Edge Labels</span>
            <button
              className={`toggle-switch ${showEdgeLabels ? "active" : ""}`}
              onClick={onToggleEdgeLabels}
              title="Toggle edge labels"
            />
          </div>
          {showSearch && (
            <div className="graph-db-toolbar-group" style={{ position: "relative" }}>
              <Search size={14} style={{ color: "#9ca3af" }} />
              <input
                type="text"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search agents..."
                autoFocus
                style={{
                  background: "transparent",
                  border: "none",
                  outline: "none",
                  color: "#111827",
                  fontSize: 12,
                  width: 150,
                }}
              />
              {filteredNodes && filteredNodes.length > 0 && (
                <div
                  style={{
                    position: "absolute",
                    top: "100%",
                    left: 0,
                    right: 0,
                    marginTop: 4,
                    background: "#fff",
                    border: "1px solid #e5e7eb",
                    borderRadius: 8,
                    overflow: "hidden",
                    boxShadow: "0 4px 16px rgba(0,0,0,0.1)",
                    zIndex: 20,
                  }}
                >
                  {filteredNodes.map((n) => {
                    const c = stanceConfig[n.stance] ?? stanceConfig.neutral;
                    return (
                      <button
                        key={n.id}
                        onClick={() => {
                          onNodeClick({} as React.MouseEvent, { id: String(n.id) } as Node);
                          setSearchQuery("");
                          setShowSearch(false);
                        }}
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 8,
                          width: "100%",
                          padding: "8px 12px",
                          background: "transparent",
                          border: "none",
                          borderBottom: "1px solid #f3f4f6",
                          color: "#374151",
                          fontSize: 12,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.color }} />
                        {n.name}
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "#9ca3af" }}>#{n.id}</span>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}
          <GraphToolbarControls onFitView={handleFitView} />
          <div className="graph-db-toolbar-group" style={{ gap: 4 }}>
            <button
              onClick={() => { setShowSearch(!showSearch); setSearchQuery(""); }}
              style={btnStyle}
              title="Search"
            >
              <Search size={16} />
            </button>
            <div style={{ width: 1, height: 16, background: "#e5e7eb" }} />
            <button onClick={onToggleFullscreen} style={btnStyle} title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}>
              {isFullscreen ? <Minimize2 size={16} /> : <Maximize2 size={16} />}
            </button>
          </div>
        </div>
      </div>

      <ReactFlow
        nodes={nodes}
        edges={edges}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={onNodeClick}
        nodesDraggable
        nodesConnectable={false}
        elevateNodesOnSelect
        fitView
        fitViewOptions={{ padding: 0.15 }}
        minZoom={0.1}
        maxZoom={3}
        proOptions={{ hideAttribution: true }}
        className="graph-db-view"
        defaultEdgeOptions={{ zIndex: 0 }}
        style={{ background: "#fafbfc" }}
      >
        <Background
          id="graph-grid"
          variant={BackgroundVariant.Dots}
          gap={30}
          size={0.8}
          color="#e2e8f0"
        />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeStrokeWidth={1}
          nodeStrokeColor="#e5e7eb"
          nodeColor={(n) => {
            const stance = (n.data as AgentNodeData | undefined)?.stance ?? "neutral";
            return stanceConfig[stance]?.color ?? stanceConfig.neutral.color;
          }}
          maskColor="rgba(250, 251, 252, 0.85)"
          style={{ width: 120, height: 80, margin: 60, marginBottom: 12 }}
        />
      </ReactFlow>

      <div className="graph-db-legend">
        <div className="graph-db-legend-title">Entity Types</div>
        <div className="graph-db-legend-items">
          {Object.entries(stanceConfig).map(([stance, cfg]) => (
            <div key={stance} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div style={{ width: 10, height: 10, borderRadius: "50%", background: cfg.color }} />
              <span style={{ fontSize: 12, color: "#374151", fontWeight: 500 }}>{cfg.label}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="graph-db-stats">
        <div className="graph-db-stat-chip">
          {graph.nodes.length} nodes
        </div>
        <div className="graph-db-stat-chip">
          {graph.edges.length} relationships
        </div>
      </div>

      {selected && (
        <InspectorPanel
          selected={selected}
          outgoing={outgoing}
          incoming={incoming}
          selectedPosts={selectedPosts}
          selectedComments={selectedComments}
          allNodes={graph.nodes}
          onClose={() => onNodeClick({} as React.MouseEvent, { id: "" } as Node)}
        />
      )}
    </>
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
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [showEdgeLabels, setShowEdgeLabels] = useState(false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) setIsFullscreen(false);
    };
    document.addEventListener("keydown", handleEsc);
    return () => document.removeEventListener("keydown", handleEsc);
  }, [isFullscreen]);

  useEffect(() => {
    if (isFullscreen) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => { document.body.style.overflow = ""; };
  }, [isFullscreen]);

  const dims = { w: 1000, h: 800 };

  const nodes = useMemo(() => {
    if (!graph?.nodes.length) return [];
    return layoutGraphForce(graph.nodes, graph.edges, dims.w, dims.h);
  }, [graph?.nodes, graph?.edges]);

  const edges = useMemo(
    () => (graph?.edges.length ? buildEdges(graph.edges, showEdgeLabels) : []),
    [graph?.edges, showEdgeLabels],
  );

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const id = Number(node.id);
      setSelectedId((prev) => (prev === id || !id ? null : id));
    },
    [],
  );

  if (!graphQueryEnabled) {
    return (
      <div style={{ borderRadius: 12, border: "1px solid #e5e7eb", background: "#fff", padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
        Invalid simulation id. Open a simulation from the list.
      </div>
    );
  }

  if (isLoading || (isFetching && !graph)) {
    return (
      <div style={{ height: 600, borderRadius: 12, border: "1px solid #e5e7eb", background: "#fafbfc", display: "flex", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 14 }}>
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 36,
              height: 36,
              borderRadius: "50%",
              border: "3px solid #e5e7eb",
              borderTopColor: "#6366f1",
              animation: "spin 1s linear infinite",
            }}
          />
          <span>Loading network graph...</span>
        </div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (isError) {
    const err = error as unknown;
    const detail = err instanceof Error ? err.message : String(err ?? "Unknown error");
    return (
      <div style={{ borderRadius: 12, border: "1px solid #fecaca", background: "#fef2f2", padding: 24 }}>
        <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444", marginBottom: 8 }}>Could not load graph data</div>
        <div style={{ fontSize: 12, color: "#6b7280", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>{detail}</div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div style={{ borderRadius: 12, border: "1px solid #e5e7eb", background: "#fafbfc", padding: 40, textAlign: "center", color: "#9ca3af", fontSize: 14 }}>
        No graph data returned.
      </div>
    );
  }

  return (
    <div className={isFullscreen ? "graph-db-fullscreen" : ""}>
      <div className="graph-db-container" style={{ height: isFullscreen ? "100vh" : 680 }}>
        {nodes.length === 0 ? (
          <div style={{ display: "flex", height: "100%", alignItems: "center", justifyContent: "center", color: "#9ca3af", fontSize: 14 }}>
            No agents in this simulation.
          </div>
        ) : (
          <ReactFlowProvider>
            <GraphContent
              nodes={nodes}
              edges={edges}
              onNodeClick={onNodeClick}
              selectedId={selectedId}
              graph={graph}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
              showEdgeLabels={showEdgeLabels}
              onToggleEdgeLabels={() => setShowEdgeLabels(!showEdgeLabels)}
            />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}
