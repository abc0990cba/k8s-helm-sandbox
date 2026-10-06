import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Modal,
  Pagination,
  Stack,
  Text,
  Textarea,
  TextInput,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { IconPencil, IconTrash } from "@tabler/icons-react";
import { apiNotes, type Note } from "@/api/client";
import { StackBadge } from "@/components/StackBadge";

const PAGE_SIZE = 5;

export interface NotesViewProps {
  isLoggedIn: boolean;
}

// notes live in the golang/postgres domain only — the "same notes on two
// backends" demo ended with the database-per-service split
export function NotesView({ isLoggedIn }: NotesViewProps) {
  const [page, setPage] = useState(1);
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [editing, setEditing] = useState<Note | null>(null);
  const queryClient = useQueryClient();

  const { data, isPending, isError, error } = useQuery({
    queryKey: ["notes", page],
    queryFn: () => apiNotes.list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE }).then((r) => r.data),
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["notes"] });

  const createMutation = useMutation({
    mutationFn: () => apiNotes.create({ title: title.trim(), body }),
    onSuccess: () => {
      setTitle("");
      setBody("");
      notifications.show({ message: "Note created (stored in postgres)", color: "teal" });
      invalidate();
    },
    onError: (e) => notifications.show({ message: `Create failed: ${String(e)}`, color: "red" }),
  });

  const updateMutation = useMutation({
    mutationFn: (draft: { id: number; title: string; body: string }) =>
      apiNotes.update(draft.id, { title: draft.title, body: draft.body }),
    onSuccess: () => {
      setEditing(null);
      notifications.show({ message: "Note updated", color: "teal" });
      invalidate();
    },
    onError: (e) => notifications.show({ message: `Update failed: ${String(e)}`, color: "red" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: number) => apiNotes.remove(id),
    onSuccess: () => {
      notifications.show({ message: "Note deleted", color: "teal" });
      invalidate();
    },
    onError: (e) => notifications.show({ message: `Delete failed: ${String(e)}`, color: "red" }),
  });

  const totalPages = data ? Math.max(Math.ceil(data.total / PAGE_SIZE), 1) : 1;

  return (
    <Stack gap="md" maw={860} mx="auto" w="100%">
      <Group justify="space-between">
        <Title order={2}>Notes</Title>
        <StackBadge service="golang" database="PostgreSQL" />
      </Group>

      {isLoggedIn ? (
        <Card withBorder shadow="sm" radius="md">
          <Stack gap="sm">
            <TextInput
              placeholder="Title"
              value={title}
              onChange={(e) => setTitle(e.currentTarget.value)}
              data-testid="note-title-input"
            />
            <Textarea
              placeholder="Body"
              minRows={3}
              value={body}
              onChange={(e) => setBody(e.currentTarget.value)}
              data-testid="note-body-input"
            />
            <Button
              onClick={() => createMutation.mutate()}
              loading={createMutation.isPending}
              disabled={title.trim() === ""}
              data-testid="note-create-button"
            >
              Create note
            </Button>
          </Stack>
        </Card>
      ) : (
        <Card withBorder shadow="sm" radius="md" data-testid="notes-login-required">
          <Text c="dimmed">Log in to create notes — the gateway validates your JWT on every write.</Text>
        </Card>
      )}

      {isPending && <Loader />}
      {isError && <Text c="red">Failed to load notes: {String(error)}</Text>}
      {data && (
        <>
          <Text size="sm" c="dimmed" data-testid="notes-total">
            {data.total} note(s) in postgres
          </Text>
          <Stack gap="sm">
            {data.items.map((note) => (
              <Card key={note.id} withBorder shadow="sm" radius="md">
                <Group justify="space-between" mb={4}>
                  <Text fw={600}>{note.title}</Text>
                  {isLoggedIn && (
                    <Group gap="xs">
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        onClick={() => setEditing(note)}
                        aria-label={`edit note ${note.id}`}
                      >
                        <IconPencil size={14} />
                      </Button>
                      <Button
                        size="compact-xs"
                        variant="subtle"
                        color="red"
                        onClick={() => deleteMutation.mutate(note.id)}
                        aria-label={`delete note ${note.id}`}
                      >
                        <IconTrash size={14} />
                      </Button>
                    </Group>
                  )}
                </Group>
                {note.body && (
                  <Text size="sm" c="dimmed" style={{ whiteSpace: "pre-wrap" }}>
                    {note.body}
                  </Text>
                )}
                <Group gap="xs" mt={8}>
                  <Badge variant="light" size="sm">
                    {note.owner}
                  </Badge>
                  <Text size="xs" c="dimmed">
                    {new Date(note.created_at).toLocaleString()}
                  </Text>
                </Group>
              </Card>
            ))}
          </Stack>
          <Pagination value={page} onChange={setPage} total={totalPages} />
        </>
      )}

      <Modal opened={editing !== null} onClose={() => setEditing(null)} title="Edit note">
        <Stack gap="sm">
          <TextInput
            label="Title"
            value={editing?.title ?? ""}
            onChange={(e) => setEditing((n) => (n ? { ...n, title: e.currentTarget.value } : n))}
          />
          <Textarea
            label="Body"
            minRows={3}
            value={editing?.body ?? ""}
            onChange={(e) => setEditing((n) => (n ? { ...n, body: e.currentTarget.value } : n))}
          />
          <Button
            onClick={() => editing && updateMutation.mutate({ id: editing.id, title: editing.title, body: editing.body })}
            loading={updateMutation.isPending}
          >
            Save
          </Button>
        </Stack>
      </Modal>
    </Stack>
  );
}
