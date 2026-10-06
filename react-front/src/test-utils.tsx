import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { MantineProvider } from "@mantine/core";
import { Notifications } from "@mantine/notifications";
import { render, type RenderOptions } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { type ReactElement, type ReactNode } from "react";

// providers every view needs: Mantine theme, notifications, a fresh query
// client per test (no cache bleed), and a router for the nav links
export function renderWithProviders(ui: ReactElement, options: Omit<RenderOptions, "wrapper"> = {}) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });

  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <MantineProvider>
        <Notifications />
        <QueryClientProvider client={queryClient}>
          <MemoryRouter>{children}</MemoryRouter>
        </QueryClientProvider>
      </MantineProvider>
    );
  }

  return render(ui, { wrapper: Wrapper, ...options });
}
