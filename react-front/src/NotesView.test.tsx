import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import "@testing-library/jest-dom/vitest";
import axios from "axios";
import { NotesView } from "./App";

vi.mock("axios");

const page = {
  items: [
    { id: 1, title: "Welcome to the notes demo", body: "seeded", owner: "demo", created_at: "2026-10-05T00:00:00Z" },
  ],
  total: 1,
  limit: 20,
  offset: 0,
};

beforeEach(() => {
  vi.mocked(axios.get).mockResolvedValue({ data: page });
  vi.mocked(axios.post).mockResolvedValue({ data: {} });
});

describe("NotesView", () => {
  it("loads and renders the notes list", async () => {
    render(<NotesView service="nodejs" token="fake-token" isLoggedIn />);
    expect(await screen.findByText("Welcome to the notes demo")).toBeInTheDocument();
    expect(screen.getByText(/1 notes/)).toBeInTheDocument();
    expect(axios.get).toHaveBeenCalledWith(
      expect.stringContaining("/api/v1/nodejs/notes?limit=20&offset=0"),
    );
  });

  it("refuses to create when logged out (writes are JWT-gated at the gateway)", async () => {
    render(<NotesView service="nodejs" token="" isLoggedIn={false} />);
    fireEvent.change(screen.getByPlaceholderText("title"), { target: { value: "nope" } });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    expect(await screen.findByText(/log in to create notes/i)).toBeInTheDocument();
    expect(axios.post).not.toHaveBeenCalled();
  });

  it("sends the created note with the bearer token", async () => {
    render(<NotesView service="golang" token="tok-123" isLoggedIn />);
    fireEvent.change(screen.getByPlaceholderText("title"), { target: { value: "from test" } });
    fireEvent.change(screen.getByPlaceholderText("body"), { target: { value: "body" } });
    fireEvent.click(screen.getByRole("button", { name: "create" }));
    await waitFor(() =>
      expect(axios.post).toHaveBeenCalledWith(
        expect.stringContaining("/api/v1/golang/notes"),
        { title: "from test", body: "body" },
        expect.objectContaining({ headers: { authorization: "Bearer tok-123" } }),
      ),
    );
  });
});
