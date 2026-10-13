import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import React, { lazy, Suspense } from "react";
import ReactDOM from "react-dom/client";
import { serviceError } from "./services";
import "./App.css";
import "@fontsource-variable/outfit";

// Each window loads only its own UI: the HUD over a game skips the library, store and animations.
const App = lazy(() => import("./App"));
const Hud = lazy(() => import("./features/Performance").then((m) => ({ default: m.Hud })));

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      // Errors are message keys; only a dropped connection is worth retrying.
      retry: (failures, error) => failures < 2 && serviceError(error) === "network",
      // Polling queries keep themselves fresh; focus refetches would only add requests.
      refetchOnWindowFocus: false,
    },
  },
});

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <QueryClientProvider client={queryClient}>
      <Suspense fallback={null}>
        {new URLSearchParams(location.search).get("hud") === "1" ? <Hud /> : <App />}
      </Suspense>
    </QueryClientProvider>
  </React.StrictMode>,
);
