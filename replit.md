# Workspace

## Overview

Policy-Grounded Multi-Agent Prediction Engine - a full-stack application for graph-based social simulation, causal reasoning, probabilistic prediction, and continuous learning.

## Stack

- **Monorepo tool**: pnpm workspaces
- **Node.js version**: 24
- **Package manager**: pnpm
- **TypeScript version**: 5.9
- **API framework**: Express 5
- **Database**: PostgreSQL + Drizzle ORM
- **Validation**: Zod (`zod/v4`), `drizzle-zod`
- **API codegen**: Orval (from OpenAPI spec)
- **Build**: esbuild (CJS bundle)
- **Frontend**: React + Vite + Tailwind CSS + Recharts
- **Charts**: Recharts for data visualization

## Structure

```text
artifacts-monorepo/
├── artifacts/
│   ├── api-server/         # Express API server
│   └── prediction-engine/  # React frontend dashboard
├── lib/
│   ├── api-spec/           # OpenAPI spec + Orval codegen config
│   ├── api-client-react/   # Generated React Query hooks
│   ├── api-zod/            # Generated Zod schemas from OpenAPI
│   └── db/                 # Drizzle ORM schema + DB connection
├── scripts/
├── pnpm-workspace.yaml
├── tsconfig.base.json
├── tsconfig.json
└── package.json
```

## Key Features

### Multi-Agent Simulation
- Create and manage AI agents with unique personas, belief states, and influence scores
- Agents interact through influence networks with weighted relationships
- Belief update algorithm with configurable learning rates

### Monte Carlo Engine
- Probabilistic prediction through multiple simulation runs
- Statistical analysis: mean, variance, confidence intervals
- Historical run tracking and comparison

### Social Simulation
- Agents generate posts based on their personas and belief states
- Sentiment analysis and topic tagging
- Round-by-round simulation advancement

### Prediction Reports
- Executive-level reports with key outcomes and probabilities
- Risk factor identification
- Influential agent ranking
- Causal driver analysis
- Belief evolution tracking over simulation rounds

## Database Schema

### Tables
- `groups` - Agent groups
- `policies` - Policy definitions
- `simulations` - Simulation configurations and state
- `agents` - AI agent personas with belief states (JSONB)
- `posts` - Agent-generated social simulation posts
- `influences` - Weighted influence relationships between agents
- `events` - External events that impact simulations
- `monte_carlo_runs` - Monte Carlo analysis results
- `belief_snapshots` - Belief evolution tracking per round

## API Endpoints

### Agents
- `GET/POST /api/agents` - List/create agents
- `GET/PATCH/DELETE /api/agents/:id` - Agent CRUD
- `GET /api/agents/:id/neighborhood` - Agent influence graph
- `POST /api/influences` - Create influence relationships

### Simulations
- `GET/POST /api/simulations` - List/create simulations
- `GET/DELETE /api/simulations/:id` - Simulation CRUD
- `POST /api/simulations/:id/run` - Advance simulation round
- `GET /api/simulations/:id/posts` - Get simulation posts

### Monte Carlo
- `POST /api/montecarlo/:simulationId` - Run Monte Carlo analysis
- `GET /api/montecarlo/:simulationId/runs` - Get run history

### Reports
- `GET /api/reports/:simulationId` - Generate prediction report

### Other
- `GET/POST /api/policies` - Policy management
- `GET/POST /api/groups` - Group management
- `GET/POST /api/events` - Event management

## Simulation Engine

The simulation engine (`artifacts/api-server/src/lib/simulation-engine.ts`) implements:

1. **Belief Update Algorithm**: Agents update their beliefs based on incoming signals from connected agents, weighted by influence and credibility scores. Uses a configurable learning rate (default 0.3).

2. **Agent Action Generation**: Each round, agents decide to post, comment, or ignore based on their activity level, generating content consistent with their stance and persona.

3. **Monte Carlo Analysis**: Runs N independent simulations with different random seeds, then aggregates results for statistical analysis including mean support, variance, and confidence intervals.

## TypeScript & Composite Projects

Every package extends `tsconfig.base.json` which sets `composite: true`. The root `tsconfig.json` lists all packages as project references.

## Root Scripts

- `pnpm run build` — runs `typecheck` first, then recursively runs `build` in all packages
- `pnpm run typecheck` — runs `tsc --build --emitDeclarationOnly` using project references
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API types

## Packages

### `artifacts/api-server` (`@workspace/api-server`)
Express 5 API server with simulation engine, Monte Carlo analysis, and prediction reporting.

### `artifacts/prediction-engine` (`@workspace/prediction-engine`)
React + Vite dashboard with dark mode professional design, featuring simulation management, agent visualization, Monte Carlo analysis, and prediction reports.

### `lib/db` (`@workspace/db`)
Database layer using Drizzle ORM with PostgreSQL. 9 tables for full simulation state management.

### `lib/api-spec` (`@workspace/api-spec`)
OpenAPI 3.1 spec with comprehensive endpoints for agents, simulations, Monte Carlo, reports, policies, groups, and events.
