import { test, expect, vi, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { LinksView } from "./LinksView";
import { renderWithProviders } from "@/test-utils";
import { apiAnalytics, apiLinks } from "@/api/client";

vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiLinks: {
      list: vi.fn(),
      create: vi.fn(),
      click: vi.fn(),
      remove: vi.fn(),
    },
    apiAnalytics: {
      summary: vi.fn(),
      link: vi.fn(),
      top: vi.fn(),
    },
  };
});

const page = {
  items: [
    {
      code: "demo001",
      url: "https://kubernetes.io/docs/home/",
      title: "Kubernetes documentation",
      created_by: "demo",
      created_at: "2026-10-06T10:00:00Z",
    },
  ],
  total: 1,
  limit: 5,
  offset: 0,
};

const summary = {
  total_clicks: 7,
  links_with_clicks: 2,
  clicks_last_24h: 5,
  per_day: [{ day: "2026-10-06", clicks: 7 }],
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiLinks.list).mockResolvedValue({ data: page } as never);
  vi.mocked(apiAnalytics.summary).mockResolvedValue({ data: summary } as never);
  vi.mocked(apiAnalytics.top).mockResolvedValue({ data: { items: [{ code: "demo001", clicks: 7 }] } } as never);
});

test("renders the links table and the DuckDB summary cards", async () => {
  renderWithProviders(<LinksView isLoggedIn={false} />);

  expect(apiLinks.list).toHaveBeenCalledWith({ limit: 5, offset: 0, q: undefined });
  // the code appears in the table AND in the top-links card — anchor on the row
  const clickButton = await screen.findByTestId("link-click-demo001");
  const row = clickButton.closest("tr") as HTMLElement;
  expect(row).not.toBeNull();
  expect(within(row).getByText("Kubernetes documentation")).toBeInTheDocument();
  expect(screen.getByTestId("summary-total")).toHaveTextContent("7");
});

test("search terms are sent as the q parameter (FTS5)", async () => {
  renderWithProviders(<LinksView isLoggedIn={false} />);

  await userEvent.type(await screen.findByTestId("link-search-input"), "kube");
  await waitFor(() => {
    expect(apiLinks.list).toHaveBeenCalledWith({ limit: 5, offset: 0, q: "kube" });
  });
});

test("logged-out users see the login hint instead of the create form", async () => {
  renderWithProviders(<LinksView isLoggedIn={false} />);

  await waitFor(() => expect(screen.getByText(/Log in to create links/)).toBeInTheDocument());
  expect(screen.queryByTestId("link-create-button")).not.toBeInTheDocument();
});

test("creating a link posts to nodejs (stored in libSQL)", async () => {
  vi.mocked(apiLinks.create).mockResolvedValue({ data: page.items[0] } as never);
  renderWithProviders(<LinksView isLoggedIn={true} />);

  await userEvent.type(await screen.findByTestId("link-url-input"), "https://example.com");
  await userEvent.click(screen.getByTestId("link-create-button"));

  await waitFor(() => {
    expect(apiLinks.create).toHaveBeenCalledWith({ url: "https://example.com", title: undefined });
  });
});

test("the click button resolves the link (which records the event)", async () => {
  vi.mocked(apiLinks.click).mockResolvedValue({
    data: page.items[0],
  } as never);
  renderWithProviders(<LinksView isLoggedIn={false} />);

  await userEvent.click(await screen.findByTestId("link-click-demo001"));

  await waitFor(() => {
    expect(apiLinks.click).toHaveBeenCalledWith("demo001");
  });
});
