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
  CircleDot,
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

function initialsFromName(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return `${parts[0][0] ?? ""}${parts[parts.length - 1][0] ?? ""}`.toUpperCase() || "?";
  }
  if (parts.length === 1 && parts[0].length >= 2) {
    return parts[0].slice(0, 2).toUpperCase();
  }
  return (parts[0]?.[0] ?? "?").toUpperCase();
}

const stanceColors: Record<string, { bg: string; border: string; glow: string; text: string; dot: string }> = {
  supportive: {
    bg: "rgba(34, 197, 94, 0.12)",
    border: "rgba(34, 197, 94, 0.5)",
    glow: "0 0 20px rgba(34, 197, 94, 0.2)",
    text: "#4ade80",
    dot: "#22c55e",
  },
  opposed: {
    bg: "rgba(239, 68, 68, 0.12)",
    border: "rgba(239, 68, 68, 0.5)",
    glow: "0 0 20px rgba(239, 68, 68, 0.2)",
    text: "#f87171",
    dot: "#ef4444",
  },
  neutral: {
    bg: "rgba(148, 163, 184, 0.1)",
    border: "rgba(148, 163, 184, 0.35)",
    glow: "0 0 16px rgba(148, 163, 184, 0.1)",
    text: "#94a3b8",
    dot: "#94a3b8",
  },
  radical: {
    bg: "rgba(139, 92, 246, 0.12)",
    border: "rgba(139, 92, 246, 0.5)",
    glow: "0 0 20px rgba(139, 92, 246, 0.2)",
    text: "#a78bfa",
    dot: "#8b5cf6",
  },
};

const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const colors = stanceColors[d.stance] ?? stanceColors.neutral;
  const initials = initialsFromName(d.label);

  return (
    <div className="neo-agent-root relative flex flex-col items-center" style={{ width: 80 }}>
      <Handle type="target" position={Position.Top} className="!top-0" />
      <Handle type="target" position={Position.Left} id="in-l" />
      <Handle type="target" position={Position.Right} id="in-r" />
      <div
        style={{
          width: 56,
          height: 56,
          borderRadius: "50%",
          background: colors.bg,
          border: `2px solid ${colors.border}`,
          boxShadow: selected
            ? `${colors.glow}, 0 0 0 3px rgba(99, 102, 241, 0.4)`
            : colors.glow,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          transition: "all 0.2s ease",
          transform: selected ? "scale(1.1)" : "scale(1)",
        }}
      >
        <span
          style={{
            fontSize: 18,
            fontWeight: 700,
            color: colors.text,
            letterSpacing: "-0.5px",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {initials}
        </span>
      </div>
      <div
        style={{
          marginTop: 6,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: 2,
        }}
      >
        <span
          style={{
            fontSize: 10,
            fontWeight: 600,
            color: "#e2e8f0",
            maxWidth: 80,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
            textAlign: "center",
          }}
          title={d.label}
        >
          {d.label}
        </span>
        <span
          style={{
            fontSize: 9,
            color: "#64748b",
            fontFamily: "ui-monospace, monospace",
          }}
        >
          {d.stance}
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
      <path
        d={edgePath}
        fill="none"
        stroke="transparent"
        strokeWidth={20}
        strokeLinecap="round"
        className="react-flow__edge-interaction"
        style={{ cursor: "pointer" }}
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
            <div
              style={{
                background: "rgba(15, 18, 25, 0.95)",
                backdropFilter: "blur(8px)",
                border: "1px solid rgba(99, 102, 241, 0.4)",
                borderRadius: 8,
                padding: "4px 10px",
                boxShadow: "0 4px 20px rgba(0,0,0,0.5)",
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: "#c7d2fe",
                  fontFamily: "ui-monospace, monospace",
                }}
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
const NODE_LAYOUT_R = 44;

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
  const baseR = minDim * (n <= 10 ? 0.18 : 0.22);
  const step = minDim * Math.max(0.1, 0.12 - ringCount * 0.008);

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
          influenceScore: node.influenceScore,
        } satisfies AgentNodeData,
      });
    });
  });

  return out;
}

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
      color: "rgba(99, 102, 241, 0.5)",
      width: 18,
      height: 18,
    },
    style: {
      stroke: `rgba(99, 102, 241, ${0.25 + Math.min(e.weight, 1) * 0.4})`,
      strokeWidth: Math.max(1.2, 1.2 + e.weight * 3),
    },
  }));
}

function GraphToolbarControls({ onFitView }: { onFitView: () => void }) {
  const { zoomIn, zoomOut } = useReactFlow();
  return (
    <div className="graph-db-toolbar-group">
      <button
        onClick={() => zoomIn({ duration: 200 })}
        style={{
          background: "none",
          border: "none",
          color: "#94a3b8",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          borderRadius: 6,
        }}
        title="Zoom in"
      >
        <ZoomIn size={16} />
      </button>
      <button
        onClick={() => zoomOut({ duration: 200 })}
        style={{
          background: "none",
          border: "none",
          color: "#94a3b8",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          borderRadius: 6,
        }}
        title="Zoom out"
      >
        <ZoomOut size={16} />
      </button>
      <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.08)" }} />
      <button
        onClick={onFitView}
        style={{
          background: "none",
          border: "none",
          color: "#94a3b8",
          cursor: "pointer",
          padding: 4,
          display: "flex",
          borderRadius: 6,
        }}
        title="Fit to view"
      >
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
  const colors = stanceColors[selected.stance] ?? stanceColors.neutral;
  return (
    <div className="graph-db-inspector">
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(255,255,255,0.06)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              background: colors.bg,
              border: `2px solid ${colors.border}`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 15,
              fontWeight: 700,
              color: colors.text,
              fontFamily: "ui-monospace, monospace",
            }}
          >
            {initialsFromName(selected.name)}
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{selected.name}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>
              Agent #{selected.id}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "rgba(255,255,255,0.05)",
            border: "1px solid rgba(255,255,255,0.08)",
            borderRadius: 8,
            color: "#94a3b8",
            cursor: "pointer",
            padding: 6,
            display: "flex",
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 16 }}>
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 10,
              padding: "10px 12px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Stance
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: colors.text, textTransform: "capitalize" }}>
              {selected.stance}
            </div>
          </div>
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 10,
              padding: "10px 12px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Influence
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: "ui-monospace, monospace" }}>
              {formatScore(selected.influenceScore)}
            </div>
          </div>
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 10,
              padding: "10px 12px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Policy Support
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: "ui-monospace, monospace" }}>
              {formatScore(selected.policySupport)}
            </div>
          </div>
          <div
            style={{
              background: "rgba(255,255,255,0.03)",
              borderRadius: 10,
              padding: "10px 12px",
              border: "1px solid rgba(255,255,255,0.05)",
            }}
          >
            <div style={{ fontSize: 9, color: "#64748b", textTransform: "uppercase", letterSpacing: "0.08em", marginBottom: 4 }}>
              Confidence
            </div>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", fontFamily: "ui-monospace, monospace" }}>
              {formatScore(selected.confidenceLevel)}
            </div>
          </div>
        </div>

        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ArrowRight size={12} />
            Outgoing ({outgoing.length})
          </div>
          {outgoing.length === 0 ? (
            <div style={{ fontSize: 12, color: "#475569" }}>No outgoing links</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {outgoing.map((e, i) => {
                const target = allNodes.find((n) => n.id === e.target);
                const tc = stanceColors[target?.stance ?? "neutral"] ?? stanceColors.neutral;
                return (
                  <div
                    key={`o-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 10px",
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.04)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: tc.dot }} />
                      <span style={{ color: "#cbd5e1" }}>{target?.name ?? `#${e.target}`}</span>
                    </div>
                    <span style={{ color: "#6366f1", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                      {e.weight.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div
            style={{
              fontSize: 10,
              fontWeight: 600,
              color: "#64748b",
              textTransform: "uppercase",
              letterSpacing: "0.08em",
              marginBottom: 8,
              display: "flex",
              alignItems: "center",
              gap: 6,
            }}
          >
            <ArrowRight size={12} style={{ transform: "rotate(180deg)" }} />
            Incoming ({incoming.length})
          </div>
          {incoming.length === 0 ? (
            <div style={{ fontSize: 12, color: "#475569" }}>No incoming links</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
              {incoming.map((e, i) => {
                const source = allNodes.find((n) => n.id === e.source);
                const sc = stanceColors[source?.stance ?? "neutral"] ?? stanceColors.neutral;
                return (
                  <div
                    key={`i-${i}`}
                    style={{
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "space-between",
                      padding: "6px 10px",
                      background: "rgba(255,255,255,0.02)",
                      borderRadius: 8,
                      border: "1px solid rgba(255,255,255,0.04)",
                      fontSize: 12,
                    }}
                  >
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      <div style={{ width: 8, height: 8, borderRadius: "50%", background: sc.dot }} />
                      <span style={{ color: "#cbd5e1" }}>{source?.name ?? `#${e.source}`}</span>
                    </div>
                    <span style={{ color: "#6366f1", fontFamily: "ui-monospace, monospace", fontSize: 11 }}>
                      {e.weight.toFixed(2)}
                    </span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {selectedPosts.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <MessageCircle size={12} />
              Posts ({selectedPosts.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 160, overflowY: "auto" }}>
              {selectedPosts.slice(0, 5).map((p) => (
                <div
                  key={p.id}
                  style={{
                    padding: "8px 10px",
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.04)",
                    fontSize: 11,
                    color: "#94a3b8",
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4, fontFamily: "ui-monospace, monospace" }}>
                    Round {p.round}
                  </div>
                  <div style={{ display: "-webkit-box", WebkitLineClamp: 3, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                    {p.content}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {selectedComments.length > 0 && (
          <div style={{ borderTop: "1px solid rgba(255,255,255,0.06)", paddingTop: 12, marginTop: 12 }}>
            <div
              style={{
                fontSize: 10,
                fontWeight: 600,
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 8,
              }}
            >
              Comments ({selectedComments.length})
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 6, maxHeight: 120, overflowY: "auto" }}>
              {selectedComments.slice(0, 5).map((c) => (
                <div
                  key={c.id}
                  style={{
                    padding: "8px 10px",
                    background: "rgba(255,255,255,0.02)",
                    borderRadius: 8,
                    border: "1px solid rgba(255,255,255,0.04)",
                    fontSize: 11,
                    color: "#94a3b8",
                    lineHeight: 1.5,
                  }}
                >
                  <div style={{ fontSize: 9, color: "#64748b", marginBottom: 4, fontFamily: "ui-monospace, monospace" }}>
                    Round {c.round} · Sentiment {formatScore(c.sentiment)}
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
}) {
  const { fitView } = useReactFlow();
  const handleFitView = useCallback(() => fitView({ padding: 0.2, duration: 300 }), [fitView]);

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

  return (
    <>
      <div className="graph-db-toolbar">
        <div className="graph-db-toolbar-group" style={{ gap: 10 }}>
          <CircleDot size={16} style={{ color: "#6366f1" }} />
          <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
            Influence Network
          </span>
          <span style={{ fontSize: 11, color: "#64748b" }}>
            {graph.nodes.length} nodes · {graph.edges.length} edges
          </span>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {showSearch && (
            <div
              className="graph-db-toolbar-group"
              style={{ position: "relative" }}
            >
              <Search size={14} style={{ color: "#64748b" }} />
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
                  color: "#e2e8f0",
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
                    background: "rgba(15, 18, 25, 0.98)",
                    border: "1px solid rgba(255,255,255,0.08)",
                    borderRadius: 10,
                    overflow: "hidden",
                    boxShadow: "0 8px 32px rgba(0,0,0,0.5)",
                  }}
                >
                  {filteredNodes.map((n) => {
                    const c = stanceColors[n.stance] ?? stanceColors.neutral;
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
                          borderBottom: "1px solid rgba(255,255,255,0.04)",
                          color: "#cbd5e1",
                          fontSize: 12,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot }} />
                        {n.name}
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569" }}>#{n.id}</span>
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
              style={{
                background: "none",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                borderRadius: 6,
              }}
              title="Search"
            >
              <Search size={16} />
            </button>
            <div style={{ width: 1, height: 16, background: "rgba(255,255,255,0.08)" }} />
            <button
              onClick={onToggleFullscreen}
              style={{
                background: "none",
                border: "none",
                color: "#94a3b8",
                cursor: "pointer",
                padding: 4,
                display: "flex",
                borderRadius: 6,
              }}
              title={isFullscreen ? "Exit fullscreen" : "Fullscreen"}
            >
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
        fitViewOptions={{ padding: 0.2 }}
        minZoom={0.1}
        maxZoom={2.5}
        proOptions={{ hideAttribution: true }}
        className="graph-db-view !bg-[#0a0c14]"
        defaultEdgeOptions={{ zIndex: 0 }}
      >
        <Background
          id="graph-grid"
          variant={BackgroundVariant.Dots}
          gap={24}
          size={1}
          color="rgba(148, 163, 184, 0.08)"
        />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeStrokeWidth={2}
          nodeStrokeColor="rgba(255,255,255,0.1)"
          nodeColor={(n) => {
            const stance = (n.data as AgentNodeData | undefined)?.stance ?? "neutral";
            return stanceColors[stance]?.dot ?? stanceColors.neutral.dot;
          }}
          maskColor="rgba(10, 12, 20, 0.88)"
          style={{ width: 140, height: 100, margin: 16 }}
        />
      </ReactFlow>

      <div className="graph-db-legend">
        {Object.entries(stanceColors).map(([stance, c]) => (
          <div key={stance} style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <div style={{ width: 8, height: 8, borderRadius: "50%", background: c.dot, boxShadow: `0 0 6px ${c.dot}44` }} />
            <span style={{ fontSize: 11, color: "#94a3b8", textTransform: "capitalize" }}>{stance}</span>
          </div>
        ))}
      </div>

      <div className="graph-db-stats">
        <div className="graph-db-stat-chip">
          <CircleDot size={12} style={{ color: "#6366f1" }} />
          {graph.nodes.length} nodes
        </div>
        <div className="graph-db-stat-chip">
          <ArrowRight size={12} style={{ color: "#6366f1" }} />
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

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape" && isFullscreen) {
        setIsFullscreen(false);
      }
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

  const dims = { w: 900, h: 700 };

  const nodes = useMemo(() => {
    if (!graph?.nodes.length) return [];
    return layoutGraphRings(graph.nodes, dims.w, dims.h);
  }, [graph?.nodes]);

  const edges = useMemo(() => (graph?.edges.length ? buildEdges(graph.edges) : []), [graph?.edges]);

  const onNodeClick = useCallback(
    (_: React.MouseEvent, node: Node) => {
      const id = Number(node.id);
      setSelectedId((prev) => (prev === id || !id ? null : id));
    },
    [],
  );

  if (!graphQueryEnabled) {
    return (
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "#0a0c14",
          padding: 40,
          textAlign: "center",
          color: "#64748b",
          fontSize: 14,
        }}
      >
        Invalid simulation id. Open a simulation from the list.
      </div>
    );
  }

  if (isLoading || (isFetching && !graph)) {
    return (
      <div
        style={{
          height: 600,
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "#0a0c14",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#64748b",
          fontSize: 14,
        }}
      >
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}>
          <div
            style={{
              width: 40,
              height: 40,
              borderRadius: "50%",
              border: "3px solid rgba(99, 102, 241, 0.2)",
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
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(239, 68, 68, 0.2)",
          background: "rgba(239, 68, 68, 0.05)",
          padding: 24,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "#f87171", marginBottom: 8 }}>
          Could not load graph data
        </div>
        <div style={{ fontSize: 12, color: "#94a3b8", fontFamily: "ui-monospace, monospace", wordBreak: "break-all" }}>
          {detail}
        </div>
      </div>
    );
  }

  if (!graph) {
    return (
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(255,255,255,0.06)",
          background: "#0a0c14",
          padding: 40,
          textAlign: "center",
          color: "#64748b",
          fontSize: 14,
        }}
      >
        No graph data returned.
      </div>
    );
  }

  const wrapperClass = isFullscreen ? "graph-db-fullscreen" : "";

  return (
    <div className={wrapperClass}>
      <div
        className="graph-db-container"
        style={{ height: isFullscreen ? "100vh" : 650 }}
      >
        {nodes.length === 0 ? (
          <div
            style={{
              display: "flex",
              height: "100%",
              alignItems: "center",
              justifyContent: "center",
              color: "#64748b",
              fontSize: 14,
            }}
          >
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
            />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}
