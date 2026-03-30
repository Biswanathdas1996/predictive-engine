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
} from "lucide-react";
import { MermaidDiagram } from "@/components/MermaidDiagram";

const CONTAINER_DIAGRAM = `flowchart TB
  subgraph Browser["Browser — Predictive.AI SPA"]
    direction TB
    PE["prediction-engine<br/>Vite + React + Wouter"]
    RQ["TanStack Query"]
    HOOKS["Orval-generated hooks<br/>@workspace/api-client-react"]
    PE --> RQ --> HOOKS
  end

  subgraph DevProxy["Dev: Vite server"]
    VP["Proxy /api → API_PORT"]
  end

  subgraph API["FastAPI — artifacts/api-server-py"]
    direction TB
    MAIN["main.py — lifespan, CORS"]
    RT["Routers: health, agents, simulations,<br/>comments, policies, groups, events"]
    SVC["Services layer"]
    MAIN --> RT --> SVC
  end

  subgraph Data["Persistence & integrations"]
    PG[("PostgreSQL<br/>asyncpg pool")]
    N4J[("Neo4j<br/>optional graph")]
    OLL["Ollama<br/>optional LLM"]
    VTX["Vertex AI<br/>policy document ingest"]
  end

  HOOKS -->|"fetch /api/*"| VP
  VP -->|"HTTP JSON"| MAIN
  SVC --> PG
  SVC -.->|"sync posts/comments"| N4J
  SVC -.->|"generate /api/generate"| OLL
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
    LLM["llm_service.py"]
    NEO["neo4j_service.py"]
    DOC["document_text.py"]
    VTX["vertex_document.py"]
    PT["prompt_templates.py"]
  end

  subgraph IO["I/O"]
    DB["db.py — asyncpg"]
    SER["serialize.py"]
  end

  S --> SE
  S --> NEO
  A --> DB
  P --> DOC
  P --> VTX
  SE --> LLM
  SE --> NEO
  SE --> DB
  Routers --> SER
  Routers --> DB
  LLM -->|"httpx"| EXT["Ollama HTTP"]
  NEO -->|"bolt"| N4J[("Neo4j")]`;

const SIM_ROUND_SEQUENCE = `sequenceDiagram
  autonumber
  participant UI as Simulation UI
  participant API as simulations router
  participant ENG as simulation_engine
  participant PG as PostgreSQL
  participant LLM as Ollama
  participant N4 as Neo4j

  UI->>API: POST run round
  API->>ENG: run_simulation_round(id)
  ENG->>PG: load simulation, agents, influences
  loop Each agent
    ENG->>ENG: apply influence → update_belief
    alt LLM available
      ENG->>PG: recent posts for context
      ENG->>LLM: generate action / content
      LLM-->>ENG: post | comment | ignore
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
    ORV["Orval"]
    ORV2["tsc — api-zod"]
  end

  subgraph Pkgs["Workspace packages"]
    ACR["@workspace/api-client-react"]
    AZ["@workspace/api-zod"]
  end

  OAS --> ORV --> ACR
  OAS --> ORV2 --> AZ
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
      "When Ollama is reachable, llm_service drives natural language; otherwise deterministic templates from stance and round.",
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
      "llm_service targets Ollama (OLLAMA_BASE_URL, OLLAMA_MODEL) with configurable read timeouts for local CPU inference.",
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

export default function Architecture() {
  return (
    <div className="space-y-10 pb-16">
      <motion.div
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
        className="space-y-3"
      >
        <div className="inline-flex items-center gap-2 rounded-full border border-primary/25 bg-primary/10 px-3 py-1 text-xs font-medium text-primary">
          <Sparkles className="h-3.5 w-3.5" />
          System architecture
        </div>
        <h1 className="text-3xl font-bold tracking-tight">Application architecture</h1>
        <p className="text-muted-foreground max-w-3xl leading-relaxed">
          End-to-end view of the Predictive Engine monorepo: the React client, generated API client, FastAPI backend,
          simulation and policy pipelines, and optional Neo4j and Ollama integrations. Arrows in the diagrams indicate
          primary data and control flow.
        </p>
      </motion.div>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Layers className="h-5 w-5 text-primary" />
          System context and containers
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          The browser loads the Vite-built SPA. All REST calls use relative paths under{" "}
          <code className="text-xs bg-secondary/80 px-1.5 py-0.5 rounded">/api</code>, which in development are forwarded
          to FastAPI. The API is stateless at the HTTP layer; session state lives in PostgreSQL.
        </p>
        <MermaidDiagram chart={CONTAINER_DIAGRAM} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Server className="h-5 w-5 text-primary" />
          API composition
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Routers stay thin; heavy logic sits in services. Simulation rounds are the busiest path: they read graph and
          agent rows, optionally call the LLM, write posts and comments, and mirror graph edges to Neo4j when configured.
        </p>
        <MermaidDiagram chart={API_INTERNAL_DIAGRAM} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <Workflow className="h-5 w-5 text-primary" />
          Simulation round data flow
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          One round is a single transactional narrative: beliefs shift from influence weights, then each agent produces
          social actions that become durable records. Neo4j synchronization is best-effort and does not block the SQL
          commit path.
        </p>
        <MermaidDiagram chart={SIM_ROUND_SEQUENCE} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold flex items-center gap-2">
          <GitBranch className="h-5 w-5 text-primary" />
          OpenAPI to client pipeline
        </h2>
        <p className="text-sm text-muted-foreground max-w-3xl">
          Updating <code className="text-xs bg-secondary/80 px-1.5 py-0.5 rounded">lib/api-spec/openapi.yaml</code> and
          regenerating clients keeps TypeScript hooks and Zod types in sync with documented endpoints.
        </p>
        <MermaidDiagram chart={SPEC_PIPELINE_DIAGRAM} />
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Architectural layers</h2>
        <div className="grid gap-4 md:grid-cols-2">
          {layers.map((layer, i) => {
            const Icon = layer.icon;
            return (
              <motion.div
                key={layer.title}
                initial={{ opacity: 0, y: 6 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.04 }}
                className="rounded-xl border border-border/60 bg-card/30 p-5 space-y-3"
              >
                <div className="flex items-center gap-2 text-sm font-semibold">
                  <Icon className="h-4 w-4 text-primary shrink-0" />
                  {layer.title}
                </div>
                <ul className="text-sm text-muted-foreground space-y-2 list-disc pl-4 leading-relaxed">
                  {layer.items.map((item, j) => (
                    <li key={`${layer.title}-${j}`}>{item}</li>
                  ))}
                </ul>
              </motion.div>
            );
          })}
        </div>
      </section>

      <section className="space-y-4">
        <h2 className="text-xl font-semibold">Component inventory</h2>
        <div className="rounded-xl border border-border/60 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border/60 bg-secondary/30 text-left">
                <th className="px-4 py-3 font-medium">Component</th>
                <th className="px-4 py-3 font-medium">Role in the data flow</th>
              </tr>
            </thead>
            <tbody>
              {components.map((row) => (
                <tr key={row.name} className="border-b border-border/40 last:border-0">
                  <td className="px-4 py-3 font-mono text-xs text-primary align-top whitespace-nowrap">
                    {row.name}
                  </td>
                  <td className="px-4 py-3 text-muted-foreground align-top">{row.role}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="text-xs text-muted-foreground">
          Other repo artifacts: <span className="font-mono">mockup-sandbox</span> is a separate Vite app for UI
          experiments; <span className="font-mono">start.bat</span> launches API and prediction-engine together on Windows.
        </p>
      </section>
    </div>
  );
}
