"""Pydantic request / response models for the Predictive Engine API.

Using strict Pydantic models instead of raw dicts gives us:
- automatic request validation & clear 422 error messages
- OpenAPI schema generation
- type safety throughout the codebase
"""

from __future__ import annotations

from datetime import datetime
from typing import Any, Literal

from pydantic import BaseModel, Field, field_validator


# ---------------------------------------------------------------------------
# Shared / reusable
# ---------------------------------------------------------------------------

class BeliefStateSchema(BaseModel):
    policySupport: float = Field(default=0.0, ge=-1, le=1)
    trustInGovernment: float = Field(default=0.5, ge=-1, le=1)
    economicOutlook: float = Field(default=0.5, ge=-1, le=1)


class PaginationParams(BaseModel):
    """Query-string pagination (use as Depends())."""
    limit: int = Field(default=50, ge=1, le=500)
    offset: int = Field(default=0, ge=0)


# ---------------------------------------------------------------------------
# Simulation
# ---------------------------------------------------------------------------

class SimulationConfigIn(BaseModel):
    # 0 is valid (no belief updates from learning terms); UI often allows clearing the field to 0
    learningRate: float = Field(default=0.3, ge=0.0, le=1.0)
    numRounds: int = Field(default=10, ge=1, le=1000)
    agentCount: int = Field(default=10, ge=1, le=5000)
    policyId: int | None = None
    groupIds: list[int] | None = Field(
        default=None,
        description="When set, clone pool agents from these groups; agentCount is replaced by pool size.",
    )


class CreateGroupWithAgentsRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=4000)
    agentCount: int = Field(..., ge=1, le=500)
    demographics: str = Field(..., min_length=1, max_length=4000)
    community: str = Field(..., min_length=1, max_length=4000)
    educationProfession: str = Field(..., min_length=1, max_length=4000)


class SuggestGroupCohortFieldsRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=4000)


class SuggestGroupCohortFieldsResponse(BaseModel):
    description: str = Field(default="", max_length=4000)
    agentCount: int = Field(..., ge=1, le=500)
    demographics: str = Field(..., min_length=1, max_length=4000)
    community: str = Field(..., min_length=1, max_length=4000)
    educationProfession: str = Field(..., min_length=1, max_length=4000)


class BeliefEvolutionSeriesPoint(BaseModel):
    """One row of the belief trajectory chart (policy support vs public sentiment by round)."""

    round: int = Field(..., ge=0, le=10_000)
    support: float = Field(..., ge=-3, le=3)
    sentiment: float = Field(..., ge=-3, le=3)


class DecodeBeliefChartRequest(BaseModel):
    series: list[BeliefEvolutionSeriesPoint] = Field(..., min_length=1, max_length=500)


class DecodeBeliefChartResponse(BaseModel):
    report: str = Field(..., min_length=1, max_length=12_000)


class CreateSimulationRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=255)
    description: str = Field(default="", max_length=2000)
    config: SimulationConfigIn


class SimulationOut(BaseModel):
    id: int
    name: str
    description: str
    status: str
    currentRound: int
    totalAgents: int
    totalPosts: int
    config: dict[str, Any]
    createdAt: str | None


class SimulationListOut(BaseModel):
    items: list[SimulationOut]
    total: int
    limit: int
    offset: int


# ---------------------------------------------------------------------------
# Round execution
# ---------------------------------------------------------------------------

class AgentStateOut(BaseModel):
    agentId: int
    name: str
    policySupport: float
    confidenceLevel: float
    action: str
    sentiment: float


class RoundResultOut(BaseModel):
    round: int
    postsGenerated: int
    beliefsUpdated: int
    averageSentiment: float
    averagePolicySupport: float
    agentStates: list[AgentStateOut]


# ---------------------------------------------------------------------------
# Monte Carlo
# ---------------------------------------------------------------------------

class MonteCarloRequest(BaseModel):
    numRuns: int = Field(default=50, ge=1, le=10000)
    roundsPerRun: int = Field(default=5, ge=1, le=100)


class MonteCarloResultOut(BaseModel):
    meanSupport: float
    variance: float
    min: float
    max: float
    confidenceInterval: list[float]
    distribution: list[dict[str, Any]]


class MonteCarloJobOut(BaseModel):
    """Returned when a Monte Carlo run is submitted as a background job."""
    jobId: str
    status: Literal["queued", "running", "completed", "failed"]
    simulationId: int
    numRuns: int
    roundsPerRun: int
    result: MonteCarloResultOut | None = None


# ---------------------------------------------------------------------------
# Graph
# ---------------------------------------------------------------------------

class GraphNodeOut(BaseModel):
    id: int
    name: str
    stance: str
    influenceScore: float
    policySupport: float
    confidenceLevel: float
    age: int
    gender: str
    region: str
    occupation: str
    persona: str
    systemPrompt: str | None = None
    credibilityScore: float
    activityLevel: float
    beliefState: BeliefStateSchema
    groupId: int | None = None


class GraphEdgeOut(BaseModel):
    source: int
    target: int
    weight: float


class PostOut(BaseModel):
    id: int
    content: str
    sentiment: float
    platform: str
    topicTags: list[str]
    round: int
    agentId: int
    simulationId: int
    createdAt: str | None
    agentName: str | None = None


class CommentOut(BaseModel):
    id: int
    content: str
    sentiment: float
    round: int
    agentId: int
    agentName: str
    postId: int
    simulationId: int
    createdAt: str | None


class SimulationGraphOut(BaseModel):
    simulationId: int
    nodes: list[GraphNodeOut]
    edges: list[GraphEdgeOut]
    posts: list[PostOut]
    comments: list[CommentOut]


# ---------------------------------------------------------------------------
# Report
# ---------------------------------------------------------------------------

class KeyOutcomeOut(BaseModel):
    label: str
    probability: float
    impact: str


class InfluentialAgentOut(BaseModel):
    agentId: int
    name: str
    influenceScore: float
    stance: str


class MCReportSummary(BaseModel):
    totalRuns: int
    meanSupport: float
    variance: float
    confidenceInterval: list[float]


class BeliefEvolutionPoint(BaseModel):
    round: int
    averagePolicySupport: float
    averageTrustInGovernment: float
    averageEconomicOutlook: float


class SimulationReportOut(BaseModel):
    simulationId: int
    simulationName: str
    generatedAt: str
    keyOutcomes: list[KeyOutcomeOut]
    riskFactors: list[str]
    influentialAgents: list[InfluentialAgentOut]
    causalDrivers: list[str]
    monteCarloSummary: MCReportSummary
    beliefEvolution: list[BeliefEvolutionPoint]


# ---------------------------------------------------------------------------
# Monte Carlo stored run
# ---------------------------------------------------------------------------

class MonteCarloRunOut(BaseModel):
    id: int
    simulationId: int
    numRuns: int
    meanSupport: float
    variance: float
    minSupport: float
    maxSupport: float
    createdAt: str | None
