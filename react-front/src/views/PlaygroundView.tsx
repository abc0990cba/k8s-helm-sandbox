import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Badge,
  Button,
  Card,
  Code,
  Group,
  Loader,
  Radio,
  ScrollArea,
  Stack,
  Text,
  Title,
} from "@mantine/core";
import { apiAnalytics, apiPlayground } from "@/api/client";
import { StackBadge } from "@/components/StackBadge";

const TARGETS = [
  { label: "nodejs", value: "nodejs" },
  { label: "golang", value: "golang" },
];
const MODES = [
  { label: "public", value: "public" },
  { label: "private (JWT)", value: "private" },
];

// the auth playground: the same /numbers endpoint exists on both nodejs and
// golang; on `private`, the GATEWAY validates the RS256 token before proxying
// — the 401/200 verdict comes from KrakenD, not the backends
export function PlaygroundView() {
  const [target, setTarget] = useState("nodejs");
  const [mode, setMode] = useState("public");
  const [lastPath, setLastPath] = useState<string | null>(null);

  const playground = useQuery({
    queryKey: ["playground", target, mode],
    enabled: false, // fired manually by the button — this is a playground, not a dashboard
    queryFn: () => apiPlayground.call(`/api/v1/${target}/${mode}`).then((r) => r.data),
    retry: false,
  });

  const summary = useQuery({
    queryKey: ["playground", "rust-summary"],
    queryFn: () => apiAnalytics.summary().then((r) => r.data),
    refetchInterval: 5000,
  });

  const path = `/api/v1/${target}/${mode}`;

  return (
    <Stack gap="md" maw={860} mx="auto" w="100%">
      <Group justify="space-between">
        <Title order={2}>API playground</Title>
        <Group gap="xs">
          <StackBadge service="nodejs" database="libSQL" />
          <StackBadge service="golang" database="PostgreSQL" />
          <StackBadge service="rust" database="DuckDB" />
        </Group>
      </Group>

      <Card withBorder shadow="sm" radius="md">
        <Stack gap="sm">
          <Group justify="space-between">
            <Text fw={600}>public vs private — who validates the JWT?</Text>
            <Badge variant="light" color="violet">krakend-gateway</Badge>
          </Group>
          <Group gap="xl">
            <Radio.Group value={target} onChange={setTarget}>
              <Group mt="xs">{TARGETS.map((t) => <Radio key={t.value} value={t.value} label={t.label} />)}</Group>
            </Radio.Group>
            <Radio.Group value={mode} onChange={setMode}>
              <Group mt="xs">{MODES.map((m) => <Radio key={m.value} value={m.value} label={m.label} />)}</Group>
            </Radio.Group>
            <Button
              onClick={() => {
                setLastPath(path);
                playground.refetch();
              }}
              data-testid="playground-send"
            >
              Send request
            </Button>
          </Group>
          <Code block>{`GET ${path}`}</Code>
          {playground.isFetching && <Loader size="sm" />}
          {playground.isError && (
            <Text c="red" data-testid="playground-error">
              {lastPath} failed: {String(playground.error)} — a 401 here is the gateway doing its job.
            </Text>
          )}
          {playground.data !== undefined && (
            <ScrollArea.Autosize mah={300}>
              <Code block c="teal" data-testid="playground-result">
                {JSON.stringify(playground.data, null, 2)}
              </Code>
            </ScrollArea.Autosize>
          )}
        </Stack>
      </Card>

      <Card withBorder shadow="sm" radius="md">
        <Group justify="space-between" mb="xs">
          <Text fw={600}>rust analytics summary (live)</Text>
          <Badge variant="light" color="orange">GET /api/v1/rust/analytics/summary</Badge>
        </Group>
        {summary.data && (
          <Code block data-testid="rust-summary">
            {JSON.stringify(summary.data, null, 2)}
          </Code>
        )}
      </Card>
    </Stack>
  );
}
