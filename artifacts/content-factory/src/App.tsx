import { Switch, Route, Router as WouterRouter } from "wouter";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import NotFound from "@/pages/not-found";
import { Layout } from "@/components/layout";

import Home from "@/pages/home";
import Posts from "@/pages/posts";
import Calendar from "@/pages/calendar";
import Archive from "@/pages/archive";

const queryClient = new QueryClient();

function Router() {
  return (
    <Layout>
      <Switch>
        {/* VK Я-Инженер */}
        <Route path="/" component={() => <Home channel="ya-inzhener" />} />
        <Route path="/posts" component={() => <Posts channel="ya-inzhener" />} />
        <Route path="/calendar" component={() => <Calendar channel="ya-inzhener" />} />
        <Route path="/archive" component={() => <Archive channel="ya-inzhener" />} />

        {/* VK Безопасность всегда */}
        <Route path="/bez" component={() => <Home channel="bezopasnost" />} />
        <Route path="/bez/posts" component={() => <Posts channel="bezopasnost" />} />
        <Route path="/bez/calendar" component={() => <Calendar channel="bezopasnost" />} />
        <Route path="/bez/archive" component={() => <Archive channel="bezopasnost" />} />

        <Route component={NotFound} />
      </Switch>
    </Layout>
  );
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, "")}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
