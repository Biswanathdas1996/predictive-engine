import type { ComponentType, ReactNode } from "react";
import { motion } from "framer-motion";
import {
  Boxes,
  Database,
  GitBranch,
  Layers,
  Network,
  Server,
  Sparkles,
  Workflow,
  ArrowUpRight,
} from "lucide-react";
import { MermaidDiagram } from "@/components/MermaidDiagram";
import { cn } from "@/lib/utils";

const CONTAINER_DIAGRAM = `flowchart TB
  subgraph Browser["Browser — Predictive.AI SPA"]
    direction TB
    PE["prediction-engine<br/>Vite + React + Wouter"]
    RQ["TanStack Query"]
    HOOKS["Orval-generated hooks<br/>@workspace/api-client-react"]
    PE --> RQ --> HOOKS
  end

  subgraph DevProxy["Dev: Vite server"]
    VP["Proxy /api → API_PORT<br/>(long timeout for policy uploads)"]
  end

  subgraph API["FastAPI — artifacts/api-server-py"]
    direction TB
    MAIN["main.py — lifespan, CORS, auth, rate limit"]
    RT["Routers: health, agents, simulations,<br/>comments, policies, groups, events"]
    SVC["Services layer"]
    MAIN --> RT --> SVC
  end

  subgraph Data["Persistence & integrations"]
    PG[("PostgreSQL<br/>asyncpg pool")]
    N4J[("Neo4j<br/>optional graph")]
    PWC["PwC GenAI gateway<br/>optional — httpx JSON"]
    OWS["Ollama Cloud web search<br/>optional — events suggest-from-web"]
    VTX["Vertex AI<br/>policy document ingest"]
  end

  HOOKS -->|"fetch /api/*"| VP
  VP -->|"HTTP JSON"| MAIN
  SVC --> PG
  SVC -.->|"sync posts/comments/events"| N4J
  SVC -.->|"agent actions, reports, cohorts"| PWC
  SVC -.->|"OLLAMA_API_KEY"| OWS
  SVC -.->|"document AI"| VTX`;

const API_INTERNAL_DIAGRAM = `flowchart LR
  subgraph Routers["HTTP routers"]
    H["health.py"]
    A["agents.py"]
    S["simulations.py"]
    C["comments.py"]
    P["policies.py"]
    G["groups.py"]
    E["events.py"]
  end

  subgraph Core["Domain services"]
    SE["simulation_engine.py<br/>rounds, beliefs, MC"]
    UPR["user_post_reply.py"]
    LLM["llm_service.py<br/>PwC GenAI"]
    NEO["neo4j_service.py"]
    DOC["document_text.py"]
    VTX["vertex_document.py"]
    AC["agent_cohort.py"]
    EVW["event_suggest_web.py"]
    EWS["event_web_search.py"]
  end

  subgraph IO["I/O"]
    DB["db.py — asyncpg"]
    SER["serialize.py"]
  end

  S --> SE
  S --> NEO
  S --> UPR
  UPR --> LLM
  UPR --> DB
  A --> DB
  P --> DOC
  P --> VTX
  G --> AC
  AC --> LLM
  E --> EVW
  EVW --> LLM
  EVW --> EWS
  SE --> LLM
  SE --> NEO
  SE --> DB
  Routers --> SER
  Routers --> DB
  LLM -->|"HTTPS"| PWC["PwC GenAI"]
  EWS -.->|"Bearer"| OLLAPI["Ollama Cloud<br/>web_search API"]
  NEO -->|"bolt"| N4J[("Neo4j")]`;

const SIM_ROUND_SEQUENCE = `sequenceDiagram
  autonumber
  participant UI as Simulation UI
  participant API as simulations router
  participant ENG as simulation_engine
  participant PG as PostgreSQL
  participant GEN as PwC GenAI
  participant N4 as Neo4j

  UI->>API: POST run round
  API->>ENG: run_simulation_round(id)
  ENG->>PG: load simulation, agents, influences
  loop Each agent
    ENG->>ENG: apply influence → update_belief
    alt GenAI configured
      ENG->>PG: recent posts for context
      ENG->>GEN: generate_agent_action (JSON over HTTPS)
      GEN-->>ENG: post | comment | ignore
    else deterministic
      ENG->>ENG: template-based action
    end
    ENG->>PG: INSERT posts / comments
    opt Neo4j connected
      ENG->>N4: sync_post / sync_comment
    end
    ENG->>PG: UPDATE agents, belief snapshots, round
  end
  ENG-->>API: round summary
  API-->>UI: JSON response`;

const SPEC_PIPELINE_DIAGRAM = `flowchart LR
  subgraph Spec["Contract"]
    OAS["lib/api-spec/openapi.yaml"]
  end

  subgraph Gen["Code generation"]
    ORV["Orval<br/>pnpm --filter @workspace/api-spec codegen"]
  end

  subgraph Pkgs["Workspace packages"]
    ACR["@workspace/api-client-react<br/>src/generated"]
    AZ["@workspace/api-zod<br/>src/generated"]
  end

  OAS --> ORV
  ORV --> ACR
  ORV --> AZ
  ACR --> PE["prediction-engine UI"]
  AZ --> SCR["scripts / tooling"]`;

const layers = [
  {
    title: "Presentation",
    icon: Layers,
    items: [
      "prediction-engine: React 19 SPA, Tailwind, Radix UI, Framer Motion.",
      "Routing via Wouter; global data via TanStack Query and Orval-generated hooks from @workspace/api-client-react.",
      "Vite dev server proxies /api to the FastAPI port (API_PORT) with extended timeouts for long uploads.",
    ],
  },
  {
    title: "API surface",
    icon: Server,
    items: [
      "FastAPI app in artifacts/api-server-py: prefix /api, OpenAPI at /docs.",
      "Routers map REST resources to asyncpg queries and service calls; serialize.py shapes JSON for the client.",
      "Health: GET /api/healthz and GET /api/status expose DB, Neo4j, and LLM connectivity (no secrets).",
    ],
  },
  {
    title: "Simulation & analytics core",
    icon: Workflow,
    items: [
      "simulation_engine.py runs discrete rounds: loads agents and influence edges, updates beliefs from neighbors, then chooses post/comment/ignore.",
      "When PwC GenAI is configured, llm_service drives natural language; otherwise deterministic templates from stance and round.",
      "Monte Carlo paths aggregate many stochastic runs; results persist in PostgreSQL for Reports and dashboards.",
    ],
  },
  {
    title: "Policy & documents",
    icon: GitBranch,
    items: [
      "policies router stores title/summary and binary attachments in PostgreSQL.",
      "Upload stream path can use vertex_document and document_text to extract and summarize content (Google Cloud / file parsing).",
    ],
  },
  {
    title: "Graph & optional AI",
    icon: Network,
    items: [
      "neo4j_service mirrors simulation posts and comments into a property graph when NEO4J_* env vars are set; UI reads graph views via API.",
      "llm_service calls PwC GenAI (PWC_GENAI_ENDPOINT_URL, API key or bearer token, optional model) for short JSON agent actions; falls back to deterministic content if unavailable.",
    ],
  },
  {
    title: "Data & schema",
    icon: Database,
    items: [
      "Runtime persistence uses asyncpg against DATABASE_URL; Drizzle schemas under lib/db define tables and migrations (pnpm db:push).",
      "Entities include simulations, agents, posts, comments, influences, groups, events, policies, attachments, monte_carlo_runs, belief_snapshots.",
    ],
  },
  {
    title: "Contract & shared types",
    icon: Boxes,
    items: [
      "lib/api-spec/openapi.yaml is the source of truth; Orval generates the React client; api-zod holds generated Zod schemas for validation tooling.",
      "Keeps UI request/response types aligned with FastAPI behavior when the spec is updated and codegen is re-run.",
    ],
  },
];

const components = [
  { name: "App.tsx / Router", role: "QueryClientProvider, Wouter routes, Layout shell for all feature pages." },
  { name: "Layout", role: "Sidebar navigation to Dashboard, Simulations, Monte Carlo, Reports, Agents, Policies, Groups, Events, Architecture." },
  { name: "Dashboard", role: "Aggregates simulations, agents, and /api/status integration health." },
  { name: "Simulations / SimulationDetail", role: "CRUD simulations, run rounds, view posts; detail uses graph panel when API exposes graph JSON." },
  { name: "SimulationNetworkPanel", role: "Visualizes agent/post graph from API; handles degraded mode when Neo4j route missing." },
  { name: "Monte Carlo", role: "Triggers batch runs and surfaces statistical summaries from the API." },
  { name: "Reports", role: "Fetches per-simulation prediction report payloads." },
  { name: "Agents / Groups / Events", role: "Manage population, cohorts, and scenario events tied to simulations." },
  { name: "Policies", role: "Lists policies; upload stream and attachment links hit FastAPI policy routes." },
  { name: "main.py", role: "Lifespan: init PostgreSQL pool; parallel init Neo4j + LLM (failures logged, optional services)." },
  { name: "simulation_engine", role: "Core loop: beliefs, LLM or deterministic content, persistence, optional Neo4j sync." },
  { name: "lib/db (Drizzle)", role: "Schema-as-code for PostgreSQL; not used directly by Python (parallel contract with SQL tables)." },
];

function SectionCard({
  index,
  title,
  icon: Icon,
  lead,
  children,
}: {
  index: string;
  title: string;
  icon: ComponentType<{ className?: string }>;
  lead: ReactNode;
  children: ReactNode;
}) {
  return (
    <section className="scroll-mt-8">
      <div className="rounded-2xl border border-border/50 bg-gradient-to-b from-card/50 to-card/20 p-5 sm:p-6 shadow-lg shadow-black/20 ring-1 ring-inset ring-white/[0.03]">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="flex min-w-0 flex-1 gap-4">
            <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-primary/20 bg-primary/10 font-mono text-xs font-semibold text-primary">
              {index}
            </span>
            <div className="min-w-0 space-y-2">
              <h2 className="flex items-center gap-2 text-lg font-semibold tracking-tight text-foreground sm:text-xl">
                <Icon className="h-5 w-5 shrink-0 text-primary" />
                {title}
              </h2>
              <div className="text-sm leading-relaxed text-muted-foreground">{lead}</div>
            </div>
          </div>
        </div>
        <div className="mt-5">{children}</div>
      </div>
    </section>
  );
}

export default function Architecture() {
  return (
    <div className="space-y-8 md:space-y-10">
      <motion.div
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
        className="relative overflow-hidden rounded-2xl border border-border/50 bg-gradient-to-br from-primary/[0.12] via-card/40 to-accent/[0.08] p-6 sm:p-8 md:p-10 shadow-[0_0_0_1px_hsl(var(--foreground)_/_0.04),0_32px_64px_-28px_rgba(0,0,0,0.55)]"
      >
        <div
          className="pointer-events-none absolute -right-24 -top-24 h-64 w-64 rounded-full bg-primary/20 blur-3xl"
          aria-hidden
        />
        <div
          className="pointer-events-none absolute -bottom-32 -left-16 h-72 w-72 rounded-full bg-accent/15 blur-3xl"
          aria-hidden
        />
        <div className="relative space-y-5">
          <div className="inline-flex items-center gap-2 rounded-full border border-primary/30 bg-background/40 px-3 py-1 text-xs font-medium text-primary backdrop-blur-sm">
            <Sparkles className="h-3.5 w-3.5" />
            System architecture
          </div>
          <div className="space-y-3">
            <h1 className="max-w-4xl bg-gradient-to-br from-foreground via-foreground to-primary/85 bg-clip-text text-3xl font-bold tracking-tight text-transparent sm:text-4xl md:text-[2.5rem] md:leading-[1.15]">
              Application architecture
            </h1>
            <p className="max-w-3xl text-base leading-relaxed text-muted-foreground sm:text-[1.05rem]">
              End-to-end view of the Predictive Engine monorepo: the React client, generated API client, FastAPI backend,
              simulation and policy pipelines, optional Neo4j graph sync, PwC GenAI for agent and report flows, and optional
              Ollama Cloud web search for event suggestions. Arrows in the diagrams indicate primary data and control flow.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            {[
              { label: "React 19 + Vite", tone: "primary" as const },
              { label: "FastAPI + asyncpg", tone: "accent" as const },
              { label: "OpenAPI → Orval", tone: "muted" as const },
            ].map((chip) => (
              <span
                key={chip.label}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full border px-3 py-1 text-xs font-medium backdrop-blur-sm",
                  chip.tone === "primary" && "border-primary/25 bg-primary/10 text-primary",
                  chip.tone === "accent" && "border-accent/25 bg-accent/10 text-accent-foreground",
                  chip.tone === "muted" && "border-border/60 bg-secondary/40 text-muted-foreground",
                )}
              >
                {chip.label}
                <ArrowUpRight className="h-3 w-3 opacity-60" />
              </span>
            ))}
          </div>
        </div>
      </motion.div>

      <div className="space-y-6 md:space-y-8">
        <SectionCard
          index="01"
          title="System context and containers"
          icon={Layers}
          lead={
            <>
              The browser loads the Vite-built SPA. All REST calls use relative paths under{" "}
              <code className="rounded-md border border-border/50 bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground/90">
                /api
              </code>
              , which in development are forwarded to FastAPI. The API is stateless at the HTTP layer; session state lives
              in PostgreSQL.
            </>
          }
        >
          <MermaidDiagram chart={CONTAINER_DIAGRAM} />
        </SectionCard>

        <SectionCard
          index="02"
          title="API composition"
          icon={Server}
          lead={
            <>
              Routers stay thin; heavy logic sits in services. Simulation rounds are the busiest path: they read graph and
              agent rows, optionally call PwC GenAI via <span className="font-mono text-foreground/80">llm_service</span>,
              write posts and comments, and mirror graph edges to Neo4j when configured. Groups and events use the same LLM
              stack for cohort generation and web-assisted event drafts.
            </>
          }
        >
          <MermaidDiagram chart={API_INTERNAL_DIAGRAM} />
        </SectionCard>

        <SectionCard
          index="03"
          title="Simulation round data flow"
          icon={Workflow}
          lead={
            <>
              One round is a single transactional narrative: beliefs shift from influence weights, then each agent
              produces social actions that become durable records. Neo4j synchronization is best-effort and does not block
              the SQL commit path.
            </>
          }
        >
          <MermaidDiagram chart={SIM_ROUND_SEQUENCE} />
        </SectionCard>

        <SectionCard
          index="04"
          title="OpenAPI to client pipeline"
          icon={GitBranch}
          lead={
            <>
              Updating{" "}
              <code className="rounded-md border border-border/50 bg-secondary/60 px-1.5 py-0.5 font-mono text-[0.7rem] text-foreground/90">
                lib/api-spec/openapi.yaml
              </code>{" "}
              and regenerating clients keeps TypeScript hooks and Zod types in sync with documented endpoints.
            </>
          }
        >
          <MermaidDiagram chart={SPEC_PIPELINE_DIAGRAM} />
        </SectionCard>
      </div>

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4 border-b border-border/40 pb-3">
          <h2 className="text-xl font-semibold tracking-tight">Architectural layers</h2>
          <span className="hidden text-xs text-muted-foreground sm:inline">Stack overview</span>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          {layers.map((layer, i) => {
            const LIcon = layer.icon;
            return (
              <motion.div
                key={layer.title}
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.035, duration: 0.3 }}
                className="group rounded-2xl border border-border/50 bg-card/25 p-5 shadow-md shadow-black/10 transition-[transform,box-shadow,border-color] duration-200 hover:-translate-y-0.5 hover:border-primary/25 hover:shadow-lg hover:shadow-primary/5"
              >
                <div className="flex items-center gap-3 border-b border-border/30 pb-3">
                  <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/10 text-primary ring-1 ring-primary/15">
                    <LIcon className="h-4 w-4" />
                  </span>
                  <span className="text-sm font-semibold tracking-tight">{layer.title}</span>
                </div>
                <ul className="mt-4 space-y-2.5 text-sm leading-relaxed text-muted-foreground">
                  {layer.items.map((item, j) => (
                    <li key={`${layer.title}-${j}`} className="flex gap-2">
                      <span className="mt-2 h-1 w-1 shrink-0 rounded-full bg-primary/50" aria-hidden />
                      <span>{item}</span>
                    </li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="space-y-5">
        <div className="flex items-end justify-between gap-4 border-b border-border/40 pb-3">
          <h2 className="text-xl font-semibold tracking-tight">Component inventory</h2>
          <span className="hidden text-xs text-muted-foreground sm:inline">UI and backend modules</span>
        </div>
        <div className="overflow-hidden rounded-2xl border border-border/50 bg-card/20 shadow-lg shadow-black/15 ring-1 ring-inset ring-white/[0.03]">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[32rem] text-sm">
              <thead>
                <tr className="border-b border-border/50 bg-secondary/25 text-left">
                  <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Component
                  </th>
                  <th className="px-4 py-3.5 text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    Role in the data flow
                  </th>
                </tr>
              </thead>
              <tbody>
                {components.map((row, ri) => (
                  <tr
                    key={row.name}
                    className={cn(
                      "border-b border-border/35 transition-colors last:border-0",
                      ri % 2 === 1 && "bg-secondary/[0.12]",
                      "hover:bg-primary/[0.06]",
                    )}
                  >
                    <td className="whitespace-nowrap px-4 py-3.5 align-top font-mono text-xs font-medium text-primary">
                      {row.name}
                    </td>
                    <td className="px-4 py-3.5 align-top text-muted-foreground">{row.role}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
        <p className="text-xs leading-relaxed text-muted-foreground">
          Other repo artifacts: <span className="font-mono text-foreground/80">mockup-sandbox</span> is a separate Vite app
          for UI experiments; <span className="font-mono text-foreground/80">start.bat</span> launches API and
          prediction-engine together on Windows.
        </p>
      </section>
    </div>
  );
}
