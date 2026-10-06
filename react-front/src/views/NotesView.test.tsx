import { test, expect, vi, beforeEach } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NotesView } from "./NotesView";
import { renderWithProviders } from "@/test-utils";
import { apiNotes } from "@/api/client";

// the views depend on the typed api layer, not on axios directly — mock one
// small module and every component test stays a pure UI test
vi.mock("@/api/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/api/client")>();
  return {
    ...actual,
    apiNotes: {
      list: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      remove: vi.fn(),
    },
  };
});

const page = {
  items: [
    {
      id: 1,
      title: "hello",
      body: "world",
      owner: "demo",
      created_at: "2026-10-06T10:00:00Z",
      updated_at: "2026-10-06T10:00:00Z",
    },
  ],
  total: 1,
  limit: 5,
  offset: 0,
};

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(apiNotes.list).mockResolvedValue({ data: page } as never);
});

test("renders notes with total and asks the golang backend for page 1", async () => {
  renderWithProviders(<NotesView isLoggedIn={false} />);

  expect(apiNotes.list).toHaveBeenCalledWith({ limit: 5, offset: 0 });
  await waitFor(() => {
    expect(screen.getByTestId("notes-total")).toHaveTextContent("1 note(s)");
  });
  expect(screen.getByText("hello")).toBeInTheDocument();
});

test("logged-out users see the login hint and cannot create", async () => {
  renderWithProviders(<NotesView isLoggedIn={false} />);

  await waitFor(() => expect(screen.getByTestId("notes-login-required")).toBeInTheDocument());
  expect(screen.queryByTestId("note-create-button")).not.toBeInTheDocument();
  expect(apiNotes.create).not.toHaveBeenCalled();
});

test("logged-in users create notes against golang/postgres", async () => {
  vi.mocked(apiNotes.create).mockResolvedValue({ data: page.items[0] } as never);
  renderWithProviders(<NotesView isLoggedIn={true} />);

  await userEvent.type(await screen.findByTestId("note-title-input"), "hello");
  await userEvent.click(screen.getByTestId("note-create-button"));

  await waitFor(() => {
    expect(apiNotes.create).toHaveBeenCalledWith({ title: "hello", body: "" });
  });
});
