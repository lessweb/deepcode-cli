import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { ErrorBoundary } from "@/webview/components/ErrorBoundary";
import { Toaster } from "@/webview/components/ui/sonner";
import { TooltipProvider } from "@/webview/components/ui/tooltip";
import { ThemeProvider } from "@/webview/context/ThemeProvider";
import { ChatProvider } from "@/webview/context/ChatProvider";
import App from "@/webview/App";
import React from "react";
import "./index.css";

const queryClient = new QueryClient();

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <ErrorBoundary>
      <QueryClientProvider client={queryClient}>
        <ThemeProvider defaultTheme="dark" storageKey="ui-theme">
          <TooltipProvider>
            <ChatProvider>
              <App />
              <Toaster />
            </ChatProvider>
          </TooltipProvider>
        </ThemeProvider>
      </QueryClientProvider>
    </ErrorBoundary>
  </StrictMode>
);
