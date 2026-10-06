import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Group,
  NumberInput,
  SegmentedControl,
  Stack,
  Text,
  Textarea,
  Title,
} from "@mantine/core";
import { notifications } from "@mantine/notifications";
import { apiJobs, type JobRow } from "@/api/client";
import { StackBadge } from "@/components/StackBadge";

export interface JobsViewProps {
  isLoggedIn: boolean;
}

// async jobs: POST returns 202 immediately, the work flows through the redis
// `jobs` stream to the worker deployment, results land in libSQL — TanStack
// Query polls until the row says done/failed
export function JobsView({ isLoggedIn }: JobsViewProps) {
  const [type, setType] = useState<"wordcount" | "fibonacci">("fibonacci");
  const [n, setN] = useState<number | string>(10);
  const [text, setText] = useState("the quick brown fox jumps over the lazy dog");
  const [jobId, setJobId] = useState<string | null>(null);

  const enqueue = useMutation({
    mutationFn: () =>
      apiJobs.enqueue(type, type === "fibonacci" ? { n: Number(n) } : { text }),
    onSuccess: (r) => {
      setJobId(r.data.id);
      notifications.show({ message: "Job queued (202) — polling for the worker to pick it up", color: "green" });
    },
    onError: (e) => notifications.show({ message: `Enqueue failed: ${String(e)}`, color: "red" }),
  });

  const job = useQuery({
    queryKey: ["job", jobId],
    enabled: jobId !== null,
    queryFn: () => apiJobs.get(jobId!).then((r) => r.data),
    // poll every 1.5s until the worker reports a terminal state
    refetchInterval: (query) => {
      const row: JobRow | undefined = query.state.data;
      return row && (row.status === "done" || row.status === "failed") ? false : 1500;
    },
  });

  return (
    <Stack gap="md" maw={860} mx="auto" w="100%">
      <Group justify="space-between">
        <Title order={2}>Async jobs</Title>
        <StackBadge service="nodejs" database="libSQL" />
      </Group>
      <Text size="sm" c="dimmed">
        POST /jobs answers 202 right away; the row starts as <b>queued</b>, the worker consumes the
        redis stream and flips the status to <b>processing → done</b>. This is the demo of
        background processing in kubernetes: API pods and worker pods scale independently.
      </Text>

      {isLoggedIn ? (
        <Card withBorder shadow="sm" radius="md">
          <Stack gap="sm">
            <SegmentedControl
              value={type}
              onChange={(v) => setType(v as "wordcount" | "fibonacci")}
              data={[
                { label: "fibonacci", value: "fibonacci" },
                { label: "wordcount", value: "wordcount" },
              ]}
            />
            {type === "fibonacci" ? (
              <NumberInput
                label="n"
                min={0}
                max={1000}
                value={n}
                onChange={setN}
                data-testid="job-fib-input"
              />
            ) : (
              <Textarea
                label="text"
                minRows={2}
                value={text}
                onChange={(e) => setText(e.currentTarget.value)}
                data-testid="job-text-input"
              />
            )}
            <Button onClick={() => enqueue.mutate()} loading={enqueue.isPending} data-testid="job-submit">
              Enqueue job
            </Button>
          </Stack>
        </Card>
      ) : (
        <Card withBorder shadow="sm" radius="md">
          <Text c="dimmed">Log in to enqueue jobs (writes are JWT-gated at the gateway).</Text>
        </Card>
      )}

      {jobId && (
        <Card withBorder shadow="sm" radius="md" data-testid="job-status-card">
          <Group justify="space-between" mb={4}>
            <Text fw={600}>Job {jobId.slice(0, 8)}…</Text>
            <Badge
              color={
                job.data?.status === "done" ? "teal" : job.data?.status === "failed" ? "red" : "yellow"
              }
              data-testid="job-status"
            >
              {job.data?.status ?? "queued"}
            </Badge>
          </Group>
          {job.data?.status === "done" ? (
            <Text size="sm" data-testid="job-result">
              result: <code>{JSON.stringify(job.data.result)}</code>
            </Text>
          ) : job.data?.status === "failed" ? (
            <Text size="sm" c="red">
              error: {job.data.error}
            </Text>
          ) : (
            <Text size="sm" c="dimmed">
              waiting for the worker…
            </Text>
          )}
        </Card>
      )}
    </Stack>
  );
}
