import {
  memo,
  useCallback,
  useEffect,
  useMemo,
  useState,
  type CSSProperties,
} from "react";
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
  useNodesState,
  useEdgesState,
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
  MessageSquare,
  User,
} from "lucide-react";
import { formatScore } from "@/lib/utils";

/* ─── Stance Config ─── */

type AgentNodeData = {
  agentId: number;
  label: string;
  stance: string;
  policySupport: number;
  influenceScore: number;
  /** SSE run-stream: this agent’s turn in the generation batch */
  streamHighlighted?: boolean;
};

const stanceConfig: Record<string, { color: string; glow: string; label: string }> = {
  supportive: { color: "#22c55e", glow: "rgba(34, 197, 94, 0.4)", label: "Supportive" },
  opposed: { color: "#ef4444", glow: "rgba(239, 68, 68, 0.4)", label: "Opposed" },
  neutral: { color: "#6366f1", glow: "rgba(99, 102, 241, 0.4)", label: "Neutral" },
  radical: { color: "#f59e0b", glow: "rgba(245, 158, 11, 0.4)", label: "Radical" },
};

/* ─── Agent Node ─── */

const AgentNode = memo(function AgentNode({ data, selected }: NodeProps) {
  const d = data as AgentNodeData;
  const cfg = stanceConfig[d.stance] ?? stanceConfig.neutral;
  const streamOn = Boolean(d.streamHighlighted);
  const size = 44;
  const iconSize = Math.round(size * 0.5);

  return (
    <div className={`graph-node-outer${streamOn ? " graph-node-stream-active" : ""}`}>
      <Handle type="target" position={Position.Top} />
      <Handle type="target" position={Position.Left} id="in-l" />
      <Handle type="target" position={Position.Right} id="in-r" />

      <div
        className="graph-node-ring"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}cc)`,
          boxShadow: streamOn
            ? undefined
            : selected
              ? `0 0 0 3px ${cfg.color}60, 0 0 20px ${cfg.glow}, 0 4px 16px rgba(0,0,0,0.4)`
              : `0 0 12px ${cfg.glow}, 0 2px 8px rgba(0,0,0,0.3)`,
          border: `2px solid ${selected && !streamOn ? cfg.color : "rgba(255,255,255,0.15)"}`,
        }}
      >
        <div className="graph-node-glow" style={{ background: cfg.glow }} />
        <User
          size={iconSize}
          strokeWidth={2.5}
          className="graph-node-user-icon"
          aria-hidden
        />
      </div>

      <span className="graph-node-label" title={d.label}>
        {d.label}
      </span>

      <Handle type="source" position={Position.Bottom} />
      <Handle type="source" position={Position.Left} id="out-l" />
      <Handle type="source" position={Position.Right} id="out-r" />
    </div>
  );
});

/* ─── Influence Edge ─── */

type InfluenceEdgeData = {
  weight: number;
  showLabels: boolean;
  convoCount: number;
  sourceStance: string;
  targetStance: string;
};

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
  const convoCount = d?.convoCount ?? 0;

  const baseStyle: CSSProperties = {
    ...(style as CSSProperties),
    strokeDasharray: convoCount > 0 ? undefined : "6 4",
    animation: convoCount > 0 ? "edge-flow 1.5s linear infinite" : undefined,
  };

  return (
    <>
      <BaseEdge id={id} path={edgePath} markerEnd={markerEnd} style={baseStyle} />
      <EdgeLabelRenderer>
        <div
          className="edge-convo-badge nodrag nopan"
          style={{
            left: labelX,
            top: labelY,
            pointerEvents: convoCount > 0 || showLabels ? "all" : "none",
          }}
        >
          {convoCount > 0 && (
            <div
              className="edge-convo-pill"
              style={{
                background: "rgba(99, 102, 241, 0.2)",
                border: "1px solid rgba(99, 102, 241, 0.3)",
                color: "#a5b4fc",
              }}
            >
              <MessageSquare size={10} />
              <span>{convoCount}</span>
            </div>
          )}
          {showLabels && convoCount === 0 && (
            <div
              className="edge-convo-pill"
              style={{
                background: "rgba(15, 23, 42, 0.85)",
                border: "1px solid rgba(51, 65, 85, 0.5)",
                color: "#94a3b8",
              }}
            >
              {w.toFixed(1)}
            </div>
          )}
        </div>
      </EdgeLabelRenderer>
    </>
  );
});

const nodeTypes: NodeTypes = { agent: AgentNode };
const edgeTypes = { influence: InfluenceEdge };

/* ─── Layout ─── */

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

  const baseR = minDim * 0.14;
  const step = minDim * 0.13;

  const positions: { x: number; y: number }[] = [];
  rings.forEach((ringNodes, ringIdx) => {
    const count = ringNodes.length;
    const r = baseR + ringIdx * step;
    const angleOffset = ringIdx * 0.3;
    ringNodes.forEach((_, i) => {
      const angle = (2 * Math.PI * i) / Math.max(count, 1) - Math.PI / 2 + angleOffset;
      const jitterX = (Math.random() - 0.5) * 20;
      const jitterY = (Math.random() - 0.5) * 20;
      positions.push({
        x: cx + r * Math.cos(angle) + jitterX,
        y: cy + r * Math.sin(angle) + jitterY,
      });
    });
  });

  return sorted.map((node, idx) => ({
    id: String(node.id),
    type: "agent",
    position: { x: positions[idx].x - 22, y: positions[idx].y - 22 },
    data: {
      agentId: node.id,
      label: node.name,
      stance: node.stance ?? "neutral",
      policySupport: node.policySupport ?? 0,
      influenceScore: node.influenceScore ?? 0,
    } satisfies AgentNodeData,
  }));
}

/* ─── Conversation helpers ─── */

type ConversationItem = {
  id: number;
  agentId: number;
  agentName: string;
  content: string;
  round: number;
  sentiment: number;
  type: "post" | "comment";
};

function sameId(a: number, b: number): boolean {
  return Number(a) === Number(b);
}

function getEdgeConversations(
  sourceId: number,
  targetId: number,
  posts: Post[],
  comments: GraphComment[],
): ConversationItem[] {
  const items: ConversationItem[] = [];

  // Posts by source agent that have comments from target, and vice versa
  const sourcePosts = posts.filter((p) => sameId(p.agentId, sourceId));
  const targetPosts = posts.filter((p) => sameId(p.agentId, targetId));
  const sourcePostIds = new Set(sourcePosts.map((p) => p.id));
  const targetPostIds = new Set(targetPosts.map((p) => p.id));

  // Comments from target on source's posts
  const targetCommentsOnSource = comments.filter(
    (c) => sameId(c.agentId, targetId) && sourcePostIds.has(c.postId),
  );
  // Comments from source on target's posts
  const sourceCommentsOnTarget = comments.filter(
    (c) => sameId(c.agentId, sourceId) && targetPostIds.has(c.postId),
  );

  // Add the relevant posts that have cross-agent comments
  const postsWithReplies = new Set<number>();
  for (const c of targetCommentsOnSource) postsWithReplies.add(c.postId);
  for (const c of sourceCommentsOnTarget) postsWithReplies.add(c.postId);

  for (const p of [...sourcePosts, ...targetPosts]) {
    if (postsWithReplies.has(p.id)) {
      items.push({
        id: p.id,
        agentId: p.agentId,
        agentName: p.agentName,
        content: p.content,
        round: p.round,
        sentiment: p.sentiment,
        type: "post",
      });
    }
  }

  for (const c of [...targetCommentsOnSource, ...sourceCommentsOnTarget]) {
    items.push({
      id: c.id + 100000,
      agentId: c.agentId,
      agentName: c.agentName,
      content: c.content,
      round: c.round,
      sentiment: c.sentiment,
      type: "comment",
    });
  }

  items.sort((a, b) => a.round - b.round || a.id - b.id);
  return items;
}

type AgentPostThread = {
  post: Post;
  /** All comments on this post, ordered by round */
  replies: GraphComment[];
};

type AgentReplyElsewhere = {
  comment: GraphComment;
  parentPost: Post;
};

function buildAgentPostThreads(agentId: number, posts: Post[], comments: GraphComment[]): AgentPostThread[] {
  const myPosts = posts
    .filter((p) => sameId(p.agentId, agentId))
    .sort((a, b) => a.round - b.round || a.id - b.id);
  return myPosts.map((post) => ({
    post,
    replies: comments
      .filter((c) => c.postId === post.id)
      .sort((a, b) => a.round - b.round || a.id - b.id),
  }));
}

function buildAgentRepliesOnOthersPosts(
  agentId: number,
  posts: Post[],
  comments: GraphComment[],
): AgentReplyElsewhere[] {
  const postById = new Map(posts.map((p) => [p.id, p]));
  const out: AgentReplyElsewhere[] = [];
  for (const c of comments) {
    if (!sameId(c.agentId, agentId)) continue;
    const parent = postById.get(c.postId);
    if (!parent || sameId(parent.agentId, agentId)) continue;
    out.push({ comment: c, parentPost: parent });
  }
  out.sort((a, b) => a.comment.round - b.comment.round || a.comment.id - b.comment.id);
  return out;
}

function countEdgeConversations(
  sourceId: number,
  targetId: number,
  posts: Post[],
  comments: GraphComment[],
): number {
  const sourcePostIds = new Set(posts.filter((p) => sameId(p.agentId, sourceId)).map((p) => p.id));
  const targetPostIds = new Set(posts.filter((p) => sameId(p.agentId, targetId)).map((p) => p.id));
  let count = 0;
  for (const c of comments) {
    if (sameId(c.agentId, targetId) && sourcePostIds.has(c.postId)) count++;
    if (sameId(c.agentId, sourceId) && targetPostIds.has(c.postId)) count++;
  }
  return count;
}

/* ─── Build edges ─── */

function buildEdges(
  edges: SimulationGraphEdge[],
  showLabels: boolean,
  nodes: SimulationGraphNode[],
  posts: Post[],
  comments: GraphComment[],
): Edge[] {
  const nodeMap = new Map(nodes.map((n) => [n.id, n]));
  return edges.map((e, i) => {
    const sourceNode = nodeMap.get(e.source);
    const targetNode = nodeMap.get(e.target);
    const convoCount = countEdgeConversations(e.source, e.target, posts, comments);
    const sourceColor = stanceConfig[sourceNode?.stance ?? "neutral"]?.color ?? "#6366f1";
    const targetColor = stanceConfig[targetNode?.stance ?? "neutral"]?.color ?? "#6366f1";

    // Blend source and target colors for the edge
    const hasConvo = convoCount > 0;
    const strokeColor = hasConvo
      ? "rgba(99, 102, 241, 0.5)"
      : "rgba(99, 102, 241, 0.15)";

    return {
      id: `e-${e.source}-${e.target}-${i}`,
      source: String(e.source),
      target: String(e.target),
      type: "influence",
      data: {
        weight: e.weight,
        showLabels,
        convoCount,
        sourceStance: sourceNode?.stance ?? "neutral",
        targetStance: targetNode?.stance ?? "neutral",
      } satisfies InfluenceEdgeData,
      markerEnd: {
        type: MarkerType.ArrowClosed,
        color: hasConvo ? "rgba(99, 102, 241, 0.6)" : "rgba(99, 102, 241, 0.25)",
        width: 12,
        height: 12,
      },
      style: {
        stroke: strokeColor,
        strokeWidth: Math.max(1.5, 1 + e.weight * 2.5),
      },
    };
  });
}

/* ─── Conversation Panel ─── */

function ConversationPanel({
  sourceNode,
  targetNode,
  conversations,
  onClose,
}: {
  sourceNode: SimulationGraphNode;
  targetNode: SimulationGraphNode;
  conversations: ConversationItem[];
  onClose: () => void;
}) {
  const sCfg = stanceConfig[sourceNode.stance] ?? stanceConfig.neutral;
  const tCfg = stanceConfig[targetNode.stance] ?? stanceConfig.neutral;

  return (
    <div className="convo-panel">
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(51, 65, 85, 0.4)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: sCfg.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "#fff",
              border: "2px solid rgba(255,255,255,0.15)",
            }}
          >
            {sourceNode.name.charAt(0)}
          </div>
          <ArrowRight size={14} style={{ color: "#64748b" }} />
          <div
            style={{
              width: 28,
              height: 28,
              borderRadius: "50%",
              background: tCfg.color,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 10,
              fontWeight: 700,
              color: "#fff",
              border: "2px solid rgba(255,255,255,0.15)",
            }}
          >
            {targetNode.name.charAt(0)}
          </div>
          <div style={{ marginLeft: 4 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
              Conversation
            </div>
            <div style={{ fontSize: 10, color: "#64748b" }}>
              {sourceNode.name} & {targetNode.name}
            </div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "rgba(51, 65, 85, 0.4)",
            border: "1px solid rgba(71, 85, 105, 0.5)",
            borderRadius: 8,
            color: "#94a3b8",
            cursor: "pointer",
            padding: 5,
            display: "flex",
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: "16px 20px", display: "flex", flexDirection: "column", gap: 10 }}>
        {conversations.length === 0 ? (
          <div style={{ textAlign: "center", color: "#64748b", fontSize: 12, padding: "20px 0" }}>
            No direct conversations found between these agents.
          </div>
        ) : (
          conversations.map((item) => {
            const isSource = item.agentId === sourceNode.id;
            const agentCfg = isSource ? sCfg : tCfg;
            return (
              <div
                key={`${item.type}-${item.id}`}
                style={{ display: "flex", flexDirection: "column", alignItems: isSource ? "flex-start" : "flex-end" }}
              >
                <div
                  style={{
                    fontSize: 9,
                    color: "#64748b",
                    marginBottom: 3,
                    display: "flex",
                    alignItems: "center",
                    gap: 4,
                  }}
                >
                  <div style={{ width: 6, height: 6, borderRadius: "50%", background: agentCfg.color }} />
                  <span style={{ fontWeight: 600 }}>{item.agentName}</span>
                  <span style={{ color: "#475569" }}>
                    R{item.round} · {item.type === "post" ? "posted" : "replied"}
                  </span>
                </div>
                <div className={`convo-msg ${isSource ? "convo-msg-left" : "convo-msg-right"}`}>
                  {item.content}
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}

/* ─── Toolbar ─── */

function GraphToolbarControls({ onFitView }: { onFitView: () => void }) {
  const { zoomIn, zoomOut } = useReactFlow();
  const btnStyle: CSSProperties = {
    background: "none",
    border: "none",
    color: "#94a3b8",
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
      <div style={{ width: 1, height: 16, background: "rgba(51, 65, 85, 0.5)" }} />
      <button onClick={onFitView} style={btnStyle} title="Fit to view">
        <Crosshair size={16} />
      </button>
    </div>
  );
}

/* ─── Inspector Panel ─── */

const inspectorSectionTitleStyle: CSSProperties = {
  fontSize: 10,
  fontWeight: 600,
  color: "#64748b",
  textTransform: "uppercase",
  letterSpacing: "0.08em",
  marginBottom: 8,
};

const msgBodyStyleBase: CSSProperties = {
  fontSize: 12,
  color: "#e2e8f0",
  lineHeight: 1.55,
  whiteSpace: "pre-wrap",
  wordBreak: "break-word",
};

function coerceSimulationGraphNode(n: SimulationGraphNode): SimulationGraphNode {
  const rawBs = n.beliefState;
  const policyFromTop = n.policySupport;
  const policyFromNested = rawBs?.policySupport;
  const policy =
    typeof policyFromTop === "number"
      ? policyFromTop
      : typeof policyFromNested === "number"
        ? policyFromNested
        : 0;
  return {
    ...n,
    name: n.name ?? "Unknown",
    stance: n.stance ?? "neutral",
    influenceScore: typeof n.influenceScore === "number" ? n.influenceScore : 0,
    policySupport: policy,
    confidenceLevel: typeof n.confidenceLevel === "number" ? n.confidenceLevel : 0,
    age: typeof n.age === "number" ? n.age : 0,
    gender: n.gender ?? "—",
    region: n.region ?? "—",
    occupation: n.occupation ?? "—",
    persona: n.persona ?? "",
    credibilityScore: typeof n.credibilityScore === "number" ? n.credibilityScore : 0,
    activityLevel: typeof n.activityLevel === "number" ? n.activityLevel : 0,
    beliefState: {
      policySupport: typeof rawBs?.policySupport === "number" ? rawBs.policySupport : policy,
      trustInGovernment:
        typeof rawBs?.trustInGovernment === "number" ? rawBs.trustInGovernment : 0,
      economicOutlook: typeof rawBs?.economicOutlook === "number" ? rawBs.economicOutlook : 0,
    },
  };
}

function InspectorScrollableText({
  title,
  text,
  emptyLabel,
  maxHeight = 200,
}: {
  title: string;
  text: string | null | undefined;
  emptyLabel?: string;
  maxHeight?: number;
}) {
  const trimmed = (text ?? "").trim();
  return (
    <div style={{ marginBottom: 16 }}>
      <div style={inspectorSectionTitleStyle}>{title}</div>
      {!trimmed ? (
        <div style={{ fontSize: 12, color: "#64748b" }}>{emptyLabel ?? "—"}</div>
      ) : (
        <div
          style={{
            ...msgBodyStyleBase,
            maxHeight,
            overflowY: "auto",
            padding: "10px 12px",
            background: "rgba(30, 41, 59, 0.55)",
            borderRadius: 10,
            border: "1px solid rgba(51, 65, 85, 0.5)",
          }}
        >
          {trimmed}
        </div>
      )}
    </div>
  );
}

function InspectorPanel({
  selected,
  outgoing,
  incoming,
  posts,
  comments,
  allNodes,
  onClose,
}: {
  selected: SimulationGraphNode;
  outgoing: SimulationGraphEdge[];
  incoming: SimulationGraphEdge[];
  posts: Post[];
  comments: GraphComment[];
  allNodes: SimulationGraphNode[];
  onClose: () => void;
}) {
  const sel = useMemo(() => coerceSimulationGraphNode(selected), [selected]);
  const cfg = stanceConfig[sel.stance] ?? stanceConfig.neutral;
  const postThreads = useMemo(
    () => buildAgentPostThreads(sel.id, posts, comments),
    [sel.id, posts, comments],
  );
  const repliesOnOthersPosts = useMemo(
    () => buildAgentRepliesOnOthersPosts(sel.id, posts, comments),
    [sel.id, posts, comments],
  );
  const [systemPromptExpanded, setSystemPromptExpanded] = useState(false);
  const systemPromptText = (sel.systemPrompt ?? "").trim();
  const systemPromptLong = systemPromptText.length > 500;
  const systemPromptShown =
    systemPromptLong && !systemPromptExpanded
      ? `${systemPromptText.slice(0, 500)}…`
      : systemPromptText;
  const bs = sel.beliefState;

  useEffect(() => {
    setSystemPromptExpanded(false);
  }, [sel.id]);

  return (
    <div className="graph-db-inspector">
      <div
        style={{
          padding: "16px 20px",
          borderBottom: "1px solid rgba(51, 65, 85, 0.4)",
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
              background: `linear-gradient(135deg, ${cfg.color}, ${cfg.color}cc)`,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontSize: 14,
              fontWeight: 700,
              color: "#fff",
              border: "2px solid rgba(255,255,255,0.15)",
              boxShadow: `0 0 16px ${cfg.glow}`,
            }}
          >
            {sel.name
              .split(/\s+/)
              .map((w) => w[0])
              .join("")
              .toUpperCase()
              .slice(0, 2)}
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0" }}>{sel.name}</div>
            <div style={{ fontSize: 11, color: "#64748b" }}>Agent #{sel.id}</div>
          </div>
        </div>
        <button
          onClick={onClose}
          style={{
            background: "rgba(51, 65, 85, 0.4)",
            border: "1px solid rgba(71, 85, 105, 0.5)",
            borderRadius: 8,
            color: "#94a3b8",
            cursor: "pointer",
            padding: 5,
            display: "flex",
          }}
        >
          <X size={14} />
        </button>
      </div>

      <div style={{ padding: "16px 20px" }}>
        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8, marginBottom: 14 }}>
          {[
            { label: "Stance", value: sel.stance, color: cfg.color, capitalize: true },
            { label: "Influence", value: formatScore(sel.influenceScore), mono: true },
            { label: "Policy support", value: formatScore(sel.policySupport), mono: true },
            { label: "Confidence", value: formatScore(sel.confidenceLevel), mono: true },
            { label: "Credibility", value: formatScore(sel.credibilityScore), mono: true },
            { label: "Activity", value: formatScore(sel.activityLevel), mono: true },
            { label: "Trust (gov)", value: formatScore(bs.trustInGovernment), mono: true },
            { label: "Econ outlook", value: formatScore(bs.economicOutlook), mono: true },
          ].map((item) => (
            <div
              key={item.label}
              style={{
                background: "rgba(30, 41, 59, 0.6)",
                borderRadius: 10,
                padding: "10px 12px",
                border: "1px solid rgba(51, 65, 85, 0.5)",
              }}
            >
              <div
                style={{
                  fontSize: 9,
                  color: "#64748b",
                  textTransform: "uppercase",
                  letterSpacing: "0.08em",
                  marginBottom: 4,
                }}
              >
                {item.label}
              </div>
              <div
                style={{
                  fontSize: 13,
                  fontWeight: 600,
                  color: item.color ?? "#e2e8f0",
                  textTransform: item.capitalize ? "capitalize" : undefined,
                  fontFamily: item.mono ? "ui-monospace, monospace" : undefined,
                }}
              >
                {item.value}
              </div>
            </div>
          ))}
        </div>

        <div style={{ marginBottom: 16 }}>
          <div style={inspectorSectionTitleStyle}>Profile</div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "1fr 1fr",
              gap: 8,
              fontSize: 12,
              color: "#cbd5e1",
            }}
          >
            <div
              style={{
                background: "rgba(30, 41, 59, 0.45)",
                borderRadius: 8,
                padding: "8px 10px",
                border: "1px solid rgba(51, 65, 85, 0.45)",
              }}
            >
              <span style={{ color: "#64748b", fontSize: 10, display: "block", marginBottom: 2 }}>
                Age
              </span>
              {sel.age}
            </div>
            <div
              style={{
                background: "rgba(30, 41, 59, 0.45)",
                borderRadius: 8,
                padding: "8px 10px",
                border: "1px solid rgba(51, 65, 85, 0.45)",
              }}
            >
              <span style={{ color: "#64748b", fontSize: 10, display: "block", marginBottom: 2 }}>
                Gender
              </span>
              <span style={{ textTransform: "capitalize" }}>{sel.gender}</span>
            </div>
            <div
              style={{
                gridColumn: "1 / -1",
                background: "rgba(30, 41, 59, 0.45)",
                borderRadius: 8,
                padding: "8px 10px",
                border: "1px solid rgba(51, 65, 85, 0.45)",
              }}
            >
              <span style={{ color: "#64748b", fontSize: 10, display: "block", marginBottom: 2 }}>
                Region
              </span>
              {sel.region}
            </div>
            <div
              style={{
                gridColumn: "1 / -1",
                background: "rgba(30, 41, 59, 0.45)",
                borderRadius: 8,
                padding: "8px 10px",
                border: "1px solid rgba(51, 65, 85, 0.45)",
              }}
            >
              <span style={{ color: "#64748b", fontSize: 10, display: "block", marginBottom: 2 }}>
                Occupation
              </span>
              {sel.occupation}
            </div>
            {sel.groupId != null && (
              <div
                style={{
                  gridColumn: "1 / -1",
                  background: "rgba(30, 41, 59, 0.35)",
                  borderRadius: 8,
                  padding: "8px 10px",
                  border: "1px solid rgba(99, 102, 241, 0.2)",
                  fontFamily: "ui-monospace, monospace",
                  fontSize: 11,
                  color: "#a5b4fc",
                }}
              >
                Agent pool group id: {sel.groupId}
              </div>
            )}
          </div>
        </div>

        <InspectorScrollableText title="Persona" text={sel.persona} maxHeight={160} />

        <div style={{ marginBottom: 16 }}>
          <div style={inspectorSectionTitleStyle}>Behavioral instructions (system prompt)</div>
          {!systemPromptText ? (
            <div style={{ fontSize: 12, color: "#64748b" }}>No custom system prompt stored.</div>
          ) : (
            <>
              <div
                style={{
                  ...msgBodyStyleBase,
                  maxHeight: systemPromptExpanded ? 320 : undefined,
                  overflowY: systemPromptExpanded ? "auto" : undefined,
                  padding: "10px 12px",
                  background: "rgba(30, 41, 59, 0.55)",
                  borderRadius: 10,
                  border: "1px solid rgba(51, 65, 85, 0.5)",
                }}
              >
                {systemPromptShown}
              </div>
              {systemPromptLong && (
                <button
                  type="button"
                  onClick={() => setSystemPromptExpanded((v) => !v)}
                  style={{
                    marginTop: 8,
                    fontSize: 11,
                    fontWeight: 600,
                    color: "#818cf8",
                    background: "transparent",
                    border: "none",
                    cursor: "pointer",
                    padding: 0,
                  }}
                >
                  {systemPromptExpanded ? "Show less" : "Show full prompt"}
                </button>
              )}
            </>
          )}
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
                color: "#64748b",
                textTransform: "uppercase",
                letterSpacing: "0.08em",
                marginBottom: 6,
                display: "flex",
                alignItems: "center",
                gap: 6,
              }}
            >
              <ArrowRight
                size={12}
                style={isOutgoing ? undefined : { transform: "rotate(180deg)" }}
              />
              {title} ({items.length})
            </div>
            {items.length === 0 ? (
              <div style={{ fontSize: 12, color: "#475569" }}>None</div>
            ) : (
              <div
                style={{
                  display: "flex",
                  flexDirection: "column",
                  gap: 3,
                  maxHeight: 140,
                  overflowY: "auto",
                }}
              >
                {items.map((e, i) => {
                  const other = allNodes.find(
                    (n) => n.id === (isOutgoing ? e.target : e.source),
                  );
                  const oc = stanceConfig[other?.stance ?? "neutral"] ?? stanceConfig.neutral;
                  return (
                    <div
                      key={`${title}-${i}`}
                      style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "space-between",
                        padding: "6px 10px",
                        background: "rgba(30, 41, 59, 0.5)",
                        borderRadius: 8,
                        border: "1px solid rgba(51, 65, 85, 0.4)",
                        fontSize: 12,
                      }}
                    >
                      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: oc.color,
                            boxShadow: `0 0 6px ${oc.glow}`,
                            flexShrink: 0,
                          }}
                        />
                        <span style={{ color: "#cbd5e1" }}>
                          {other?.name ?? `#${isOutgoing ? e.target : e.source}`}
                        </span>
                      </div>
                      <span
                        style={{
                          color: "#818cf8",
                          fontFamily: "ui-monospace, monospace",
                          fontSize: 10,
                        }}
                      >
                        {e.weight.toFixed(2)}
                      </span>
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        ))}

        <div
          style={{
            borderTop: "1px solid rgba(51, 65, 85, 0.4)",
            paddingTop: 12,
            marginTop: 4,
          }}
        >
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
            Conversation
          </div>

          {postThreads.length === 0 && repliesOnOthersPosts.length === 0 ? (
            <div style={{ fontSize: 12, color: "#475569", lineHeight: 1.5 }}>
              Nothing in graph data for this agent yet—often they chose <strong style={{ color: "#94a3b8" }}>ignore</strong>{" "}
              that round (no post/comment row). Try another agent, refresh the tab, or re-open Network after a round
              finishes. Data is from the API <span style={{ fontFamily: "ui-monospace, monospace" }}>/graph</span> (Postgres),
              not Neo4j.
            </div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
              {postThreads.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#818cf8",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 8,
                    }}
                  >
                    Their posts & replies on them ({postThreads.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {postThreads.map(({ post, replies }) => (
                      <div
                        key={post.id}
                        style={{
                          padding: "10px 12px",
                          background: "rgba(30, 41, 59, 0.55)",
                          borderRadius: 10,
                          border: "1px solid rgba(51, 65, 85, 0.45)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            color: "#818cf8",
                            marginBottom: 6,
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 600,
                          }}
                        >
                          {sel.name} · posted · round {post.round} · sent{" "}
                          {formatScore(post.sentiment)}
                        </div>
                        <div style={msgBodyStyleBase}>{post.content}</div>
                        {replies.length > 0 ? (
                          <div
                            style={{
                              marginTop: 10,
                              paddingTop: 10,
                              borderTop: "1px solid rgba(51, 65, 85, 0.35)",
                            }}
                          >
                            <div
                              style={{
                                fontSize: 9,
                                fontWeight: 600,
                                color: "#64748b",
                                textTransform: "uppercase",
                                letterSpacing: "0.06em",
                                marginBottom: 8,
                              }}
                            >
                              Replies ({replies.length})
                            </div>
                            <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                              {replies.map((c) => {
                                const isSelf = c.agentId === sel.id;
                                return (
                                  <div
                                    key={c.id}
                                    style={{
                                      padding: "8px 10px",
                                      background: "rgba(15, 23, 42, 0.65)",
                                      borderRadius: 8,
                                      border: "1px solid rgba(71, 85, 105, 0.35)",
                                    }}
                                  >
                                    <div
                                      style={{
                                        fontSize: 9,
                                        color: "#94a3b8",
                                        marginBottom: 4,
                                        fontFamily: "ui-monospace, monospace",
                                      }}
                                    >
                                      {isSelf ? `${sel.name} (reply)` : c.agentName} · round{" "}
                                      {c.round} · sent {formatScore(c.sentiment)}
                                    </div>
                                    <div style={{ ...msgBodyStyleBase, fontSize: 11, color: "#cbd5e1" }}>
                                      {c.content}
                                    </div>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ) : (
                          <div
                            style={{
                              marginTop: 8,
                              fontSize: 11,
                              color: "#475569",
                              fontStyle: "italic",
                            }}
                          >
                            No replies on this post.
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {repliesOnOthersPosts.length > 0 && (
                <div>
                  <div
                    style={{
                      fontSize: 10,
                      fontWeight: 600,
                      color: "#818cf8",
                      textTransform: "uppercase",
                      letterSpacing: "0.06em",
                      marginBottom: 8,
                    }}
                  >
                    Their replies on others&apos; posts ({repliesOnOthersPosts.length})
                  </div>
                  <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                    {repliesOnOthersPosts.map(({ comment, parentPost }) => (
                      <div
                        key={comment.id}
                        style={{
                          padding: "10px 12px",
                          background: "rgba(30, 41, 59, 0.55)",
                          borderRadius: 10,
                          border: "1px solid rgba(51, 65, 85, 0.45)",
                        }}
                      >
                        <div
                          style={{
                            fontSize: 9,
                            color: "#94a3b8",
                            marginBottom: 6,
                            fontFamily: "ui-monospace, monospace",
                            fontWeight: 600,
                          }}
                        >
                          Original — {parentPost.agentName} · round {parentPost.round}
                        </div>
                        <div style={{ ...msgBodyStyleBase, fontSize: 11, color: "#94a3b8" }}>
                          {parentPost.content}
                        </div>
                        <div
                          style={{
                            marginTop: 10,
                            paddingTop: 10,
                            borderTop: "1px solid rgba(51, 65, 85, 0.35)",
                          }}
                        >
                          <div
                            style={{
                              fontSize: 9,
                              color: "#818cf8",
                              marginBottom: 4,
                              fontFamily: "ui-monospace, monospace",
                              fontWeight: 600,
                            }}
                          >
                            {sel.name} replied · round {comment.round} · sent{" "}
                            {formatScore(comment.sentiment)}
                          </div>
                          <div style={msgBodyStyleBase}>{comment.content}</div>
                        </div>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/* ─── Graph Content ─── */

function GraphContent({
  initialNodes,
  initialEdges,
  onNodeClick,
  selectedId,
  graph,
  totalAgentCount,
  progressiveActive,
  isFullscreen,
  onToggleFullscreen,
  showEdgeLabels,
  onToggleEdgeLabels,
  streamHighlightAgentId,
  streamPhase,
}: {
  initialNodes: Node[];
  initialEdges: Edge[];
  onNodeClick: (_: React.MouseEvent, node: Node) => void;
  selectedId: number | null;
  graph: {
    nodes: SimulationGraphNode[];
    edges: SimulationGraphEdge[];
    posts: Post[];
    comments: GraphComment[];
  };
  totalAgentCount: number;
  progressiveActive: boolean;
  isFullscreen: boolean;
  onToggleFullscreen: () => void;
  showEdgeLabels: boolean;
  onToggleEdgeLabels: () => void;
  streamHighlightAgentId: number | null;
  streamPhase: string;
}) {
  const [nodes, setNodes, onNodesChange] = useNodesState(initialNodes);
  const [edges, setEdges, onEdgesChange] = useEdgesState(initialEdges);
  const { fitView } = useReactFlow();
  const handleFitView = useCallback(() => fitView({ padding: 0.15, duration: 300 }), [fitView]);

  // Sync edges when showEdgeLabels changes
  useEffect(() => {
    setEdges(initialEdges);
  }, [initialEdges, setEdges]);

  // Layout from initialNodes; preserve React Flow positions when only SSE highlight / selection changes.
  useEffect(() => {
    setNodes((prev) => {
      const byInitial = new Map(initialNodes.map((n) => [n.id, n]));
      const structureOk =
        prev.length === initialNodes.length &&
        prev.length > 0 &&
        prev.every((p) => byInitial.has(p.id));

      const applyMeta = (n: Node, d: AgentNodeData) => {
        const streamOn =
          streamHighlightAgentId != null && d.agentId === streamHighlightAgentId;
        return {
          ...n,
          zIndex: streamOn ? 30 : selectedId === d.agentId ? 20 : 0,
          data: { ...d, streamHighlighted: streamOn },
        };
      };

      if (!structureOk) {
        return initialNodes.map((n) => applyMeta(n, n.data as AgentNodeData));
      }
      return prev.map((n) => {
        const fresh = byInitial.get(n.id);
        if (!fresh) return n;
        const fd = fresh.data as AgentNodeData;
        return applyMeta({ ...n, data: { ...fd } }, fd);
      });
    });
  }, [initialNodes, streamHighlightAgentId, selectedId, setNodes]);

  const selected = graph.nodes.find((n) => n.id === selectedId) ?? null;
  const outgoing = graph.edges.filter((e) => e.source === selectedId);
  const incoming = graph.edges.filter((e) => e.target === selectedId);

  // Edge click for conversation panel
  const [selectedEdge, setSelectedEdge] = useState<{
    source: number;
    target: number;
  } | null>(null);

  const onEdgeClick = useCallback(
    (_: React.MouseEvent, edge: Edge) => {
      const src = Number(edge.source);
      const tgt = Number(edge.target);
      setSelectedEdge((prev) =>
        prev?.source === src && prev?.target === tgt ? null : { source: src, target: tgt },
      );
    },
    [],
  );

  const edgeConversations = useMemo(() => {
    if (!selectedEdge) return [];
    return getEdgeConversations(
      selectedEdge.source,
      selectedEdge.target,
      graph.posts,
      graph.comments,
    );
  }, [selectedEdge, graph.posts, graph.comments]);

  const edgeSourceNode = selectedEdge
    ? graph.nodes.find((n) => n.id === selectedEdge.source)
    : null;
  const edgeTargetNode = selectedEdge
    ? graph.nodes.find((n) => n.id === selectedEdge.target)
    : null;

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
    color: "#94a3b8",
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
            <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>
              Influence Network
            </span>
            <span style={{ fontSize: 11, color: "#64748b" }}>
              {graph.nodes.length} nodes · {graph.edges.length} edges
            </span>
            {streamPhase === "generation" && streamHighlightAgentId != null ? (
              <span
                className="graph-stream-live-badge"
                style={{
                  fontSize: 10,
                  fontWeight: 700,
                  textTransform: "uppercase",
                  letterSpacing: "0.06em",
                  color: "#22d3ee",
                  padding: "2px 8px",
                  borderRadius: 8,
                  border: "1px solid rgba(34, 211, 238, 0.35)",
                  background: "rgba(34, 211, 238, 0.08)",
                }}
              >
                Generating · agent #{streamHighlightAgentId}
              </span>
            ) : null}
          </div>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
          <div className="graph-db-toolbar-group" style={{ gap: 8 }}>
            <span style={{ fontSize: 11, color: "#94a3b8", fontWeight: 500 }}>Edge Labels</span>
            <button
              className={`toggle-switch ${showEdgeLabels ? "active" : ""}`}
              onClick={onToggleEdgeLabels}
              title="Toggle edge labels"
            />
          </div>
          {showSearch && (
            <div className="graph-db-toolbar-group" style={{ position: "relative" }}>
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
                    background: "rgba(15, 23, 42, 0.95)",
                    border: "1px solid rgba(99, 102, 241, 0.2)",
                    borderRadius: 10,
                    overflow: "hidden",
                    boxShadow: "0 8px 24px rgba(0,0,0,0.4)",
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
                          borderBottom: "1px solid rgba(51, 65, 85, 0.3)",
                          color: "#cbd5e1",
                          fontSize: 12,
                          cursor: "pointer",
                          textAlign: "left",
                        }}
                      >
                        <div
                          style={{
                            width: 8,
                            height: 8,
                            borderRadius: "50%",
                            background: c.color,
                            boxShadow: `0 0 6px ${c.glow}`,
                          }}
                        />
                        {n.name}
                        <span style={{ marginLeft: "auto", fontSize: 10, color: "#475569" }}>
                          #{n.id}
                        </span>
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
              onClick={() => {
                setShowSearch(!showSearch);
                setSearchQuery("");
              }}
              style={btnStyle}
              title="Search"
            >
              <Search size={16} />
            </button>
            <div style={{ width: 1, height: 16, background: "rgba(51, 65, 85, 0.5)" }} />
            <button
              onClick={onToggleFullscreen}
              style={btnStyle}
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
        onNodesChange={onNodesChange}
        onEdgesChange={onEdgesChange}
        nodeTypes={nodeTypes}
        edgeTypes={edgeTypes}
        onNodeClick={(e, node) => {
          setSelectedEdge(null);
          onNodeClick(e, node);
        }}
        onEdgeClick={onEdgeClick}
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
        style={{ background: "#0b0f1a" }}
      >
        <Background
          id="graph-grid"
          variant={BackgroundVariant.Dots}
          gap={30}
          size={0.6}
          color="rgba(99, 102, 241, 0.08)"
        />
        <MiniMap
          position="bottom-left"
          pannable
          zoomable
          nodeStrokeWidth={1}
          nodeStrokeColor="rgba(99, 102, 241, 0.3)"
          nodeColor={(n) => {
            const stance = (n.data as AgentNodeData | undefined)?.stance ?? "neutral";
            return stanceConfig[stance]?.color ?? stanceConfig.neutral.color;
          }}
          maskColor="rgba(11, 15, 26, 0.85)"
          style={{ width: 130, height: 90, margin: 60, marginBottom: 12 }}
        />
      </ReactFlow>

      <div className="graph-db-legend">
        <div className="graph-db-legend-title">Stance Types</div>
        <div className="graph-db-legend-items">
          {Object.entries(stanceConfig).map(([stance, cfg]) => (
            <div key={stance} style={{ display: "flex", alignItems: "center", gap: 6 }}>
              <div
                style={{
                  width: 10,
                  height: 10,
                  borderRadius: "50%",
                  background: cfg.color,
                  boxShadow: `0 0 8px ${cfg.glow}`,
                }}
              />
              <span style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 500 }}>{cfg.label}</span>
            </div>
          ))}
          <div style={{ display: "flex", alignItems: "center", gap: 6, marginLeft: 8 }}>
            <MessageSquare size={10} style={{ color: "#818cf8" }} />
            <span style={{ fontSize: 12, color: "#cbd5e1", fontWeight: 500 }}>Has conversation</span>
          </div>
        </div>
      </div>

      <div className="graph-db-stats">
        <div className="graph-db-stat-chip">
          {progressiveActive
            ? `${graph.nodes.length} / ${totalAgentCount} agents visible`
            : `${graph.nodes.length} nodes`}
        </div>
        <div className="graph-db-stat-chip">{graph.edges.length} relationships</div>
      </div>

      {selected && !selectedEdge && (
        <InspectorPanel
          selected={selected}
          outgoing={outgoing}
          incoming={incoming}
          posts={graph.posts}
          comments={graph.comments}
          allNodes={graph.nodes}
          onClose={() => onNodeClick({} as React.MouseEvent, { id: "" } as Node)}
        />
      )}

      {selectedEdge && edgeSourceNode && edgeTargetNode && (
        <ConversationPanel
          sourceNode={edgeSourceNode}
          targetNode={edgeTargetNode}
          conversations={edgeConversations}
          onClose={() => setSelectedEdge(null)}
        />
      )}
    </>
  );
}

/* ─── Main Export ─── */

export function SimulationNetworkPanel({
  simulationId,
  streamHighlightAgentId = null,
  streamPhase = "idle",
  progressiveRevealAgentIds = null,
}: {
  simulationId: number;
  /** From simulation run-stream SSE: agent whose content was just generated (generation phase). */
  streamHighlightAgentId?: number | null;
  streamPhase?: string;
  /** `null` = full graph. During a round, ids of agents that have emitted `agent_action` so far (starts `[]`). */
  progressiveRevealAgentIds?: number[] | null;
}) {
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
    staleTime: 0,
    refetchOnMount: "always",
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
    return () => {
      document.body.style.overflow = "";
    };
  }, [isFullscreen]);

  const dims = { w: 1000, h: 800 };

  const viewGraph = useMemo(() => {
    if (!graph) return null;
    if (progressiveRevealAgentIds == null) return graph;
    const idSet = new Set(progressiveRevealAgentIds);
    return {
      ...graph,
      nodes: graph.nodes.filter((n) => idSet.has(n.id)),
      edges: graph.edges.filter((e) => idSet.has(e.source) && idSet.has(e.target)),
    };
  }, [graph, progressiveRevealAgentIds]);

  const progressiveActive = progressiveRevealAgentIds != null;
  const waitingForStreamAgents =
    progressiveRevealAgentIds !== null &&
    progressiveRevealAgentIds.length === 0 &&
    (graph?.nodes.length ?? 0) > 0;

  useEffect(() => {
    if (waitingForStreamAgents) setSelectedId(null);
  }, [waitingForStreamAgents]);

  const initialNodes = useMemo(() => {
    if (!viewGraph?.nodes.length) return [];
    return layoutGraphForce(viewGraph.nodes, viewGraph.edges, dims.w, dims.h);
  }, [viewGraph?.nodes, viewGraph?.edges]);

  const initialEdges = useMemo(
    () =>
      viewGraph?.edges.length
        ? buildEdges(
            viewGraph.edges,
            showEdgeLabels,
            viewGraph.nodes,
            viewGraph.posts,
            viewGraph.comments,
          )
        : [],
    [viewGraph, showEdgeLabels],
  );

  const onNodeClick = useCallback((_: React.MouseEvent, node: Node) => {
    const id = Number(node.id);
    setSelectedId((prev) => (prev === id || !id ? null : id));
  }, []);

  if (!graphQueryEnabled) {
    return (
      <div
        style={{
          borderRadius: 16,
          border: "1px solid rgba(99, 102, 241, 0.15)",
          background: "#0b0f1a",
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
          border: "1px solid rgba(99, 102, 241, 0.15)",
          background: "#0b0f1a",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "#64748b",
          fontSize: 14,
        }}
      >
        <div
          style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 12 }}
        >
          <div
            style={{
              width: 36,
              height: 36,
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
          border: "1px solid rgba(239, 68, 68, 0.3)",
          background: "rgba(127, 29, 29, 0.15)",
          padding: 24,
        }}
      >
        <div style={{ fontSize: 14, fontWeight: 600, color: "#ef4444", marginBottom: 8 }}>
          Could not load graph data
        </div>
        <div
          style={{
            fontSize: 12,
            color: "#94a3b8",
            fontFamily: "ui-monospace, monospace",
            wordBreak: "break-all",
          }}
        >
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
          border: "1px solid rgba(99, 102, 241, 0.15)",
          background: "#0b0f1a",
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

  return (
    <div className={isFullscreen ? "graph-db-fullscreen" : ""}>
      <div className="graph-db-container" style={{ height: isFullscreen ? "100vh" : 680 }}>
        {!graph.nodes.length ? (
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
        ) : waitingForStreamAgents ? (
          <div
            className="graph-progressive-wait"
            style={{
              display: "flex",
              flexDirection: "column",
              height: "100%",
              alignItems: "center",
              justifyContent: "center",
              color: "#94a3b8",
              fontSize: 14,
              textAlign: "center",
              padding: 32,
              gap: 12,
            }}
          >
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: "50%",
                border: "3px solid rgba(99, 102, 241, 0.2)",
                borderTopColor: "#22d3ee",
                animation: "spin 0.9s linear infinite",
              }}
            />
            <div style={{ fontWeight: 600, color: "#e2e8f0" }}>Round in progress</div>
            <div style={{ maxWidth: 360, lineHeight: 1.55, fontSize: 13 }}>
              The graph starts empty. Each agent appears here as soon as their response is generated (live SSE).
            </div>
            <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
          </div>
        ) : initialNodes.length === 0 ? (
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
              initialNodes={initialNodes}
              initialEdges={initialEdges}
              onNodeClick={onNodeClick}
              selectedId={selectedId}
              graph={viewGraph!}
              totalAgentCount={graph.nodes.length}
              progressiveActive={progressiveActive}
              isFullscreen={isFullscreen}
              onToggleFullscreen={() => setIsFullscreen(!isFullscreen)}
              showEdgeLabels={showEdgeLabels}
              onToggleEdgeLabels={() => setShowEdgeLabels(!showEdgeLabels)}
              streamHighlightAgentId={streamHighlightAgentId}
              streamPhase={streamPhase}
            />
          </ReactFlowProvider>
        )}
      </div>
    </div>
  );
}
