import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";

import { Layout } from "./components/Layout";
import Dashboard from "./pages/Dashboard";
import Agents from "./pages/Agents";
import Simulations from "./pages/Simulations";
import SimulationDetail from "./pages/SimulationDetail";
import MonteCarlo from "./pages/MonteCarlo";
import Reports from "./pages/Reports";
import Policies from "./pages/Policies";
import Groups from "./pages/Groups";
import Events from "./pages/Events";
import Architecture from "./pages/Architecture";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false,
      staleTime: 1000 * 60 * 5, // 5 minutes
    },
  },
});

function Router() {
  return (
    <Layout>
      <Switch>
        <Route path="/" component={Dashboard} />
        <Route path="/agents" component={Agents} />
        <Route path="/simulations" component={Simulations} />
        <Route path="/simulations/:id" component={SimulationDetail} />
        <Route path="/monte-carlo" component={MonteCarlo} />
        <Route path="/reports" component={Reports} />
        <Route path="/policies" component={Policies} />
        <Route path="/groups" component={Groups} />
        <Route path="/events" component={Events} />
        <Route path="/architecture" component={Architecture} />
        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter
          base={(import.meta.env.BASE_URL ?? "/").replace(/\/$/, "")}
        >
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
