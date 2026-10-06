import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { useDebouncedValue } from "@mantine/hooks";
import {
  Badge,
  Button,
  Card,
  Group,
  Loader,
  Pagination,
  SimpleGrid,
  Stack,
  Table,
  Text,
  TextInput,
  Title,
  Tooltip as MantineTooltip,
} from "@mantine/core";
import { BarChart, LineChart } from "@mantine/charts";
import { notifications } from "@mantine/notifications";
import { IconChartBar, IconClick, IconSearch, IconTrash } from "@tabler/icons-react";
import {
  apiAnalytics,
  apiLinks,
  type AnalyticsSummary,
  type LinkRow,
  type LinkStats,
} from "@/api/client";
import { StackBadge } from "@/components/StackBadge";

const PAGE_SIZE = 5;

export interface LinksViewProps {
  isLoggedIn: boolean;
}

export function LinksView({ isLoggedIn }: LinksViewProps) {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState("");
  const [debouncedSearch] = useDebouncedValue(search, 300);
  const [url, setUrl] = useState("");
  const [title, setTitle] = useState("");
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const queryClient = useQueryClient();

  const invalidateAnalytics = () => queryClient.invalidateQueries({ queryKey: ["analytics"] });

  const links = useQuery({
    queryKey: ["links", page, debouncedSearch],
    queryFn: () =>
      apiLinks
        .list({ limit: PAGE_SIZE, offset: (page - 1) * PAGE_SIZE, q: debouncedSearch || undefined })
        .then((r) => r.data),
  });

  const summary = useQuery({
    queryKey: ["analytics", "summary"],
    queryFn: () => apiAnalytics.summary().then((r) => r.data),
    refetchInterval: 5000, // the pipeline is async — let the numbers tick live
  });

  const top = useQuery({
    queryKey: ["analytics", "top"],
    queryFn: () => apiAnalytics.top(5).then((r) => r.data.items),
    refetchInterval: 5000,
  });

  const stats = useQuery({
    queryKey: ["analytics", "link", selectedCode],
    enabled: selectedCode !== null,
    queryFn: () => apiAnalytics.link(selectedCode!).then((r) => r.data),
  });

  const createMutation = useMutation({
    mutationFn: () => apiLinks.create({ url: url.trim(), title: title.trim() || undefined }),
    onSuccess: (r) => {
      notifications.show({
        title: "Short link created",
        message: `code: ${r.data.code} (stored in libSQL)`,
        color: "green",
      });
      setUrl("");
      setTitle("");
      queryClient.invalidateQueries({ queryKey: ["links"] });
    },
    onError: (e) => notifications.show({ message: `Create failed: ${String(e)}`, color: "red" }),
  });

  // resolving IS the click: the GET lands the event on the redis clicks
  // stream, the rust/duckdb consumer makes it show up in the charts
  const clickMutation = useMutation({
    mutationFn: (link: LinkRow) => apiLinks.click(link.code).then((r) => r.data),
    onSuccess: (link) => {
      window.open(link.url, "_blank", "noopener,noreferrer");
      notifications.show({ message: `Click recorded for ${link.code} — watch the analytics tick`, color: "orange" });
      invalidateAnalytics();
    },
    onError: (e) => notifications.show({ message: `Click failed: ${String(e)}`, color: "red" }),
  });

  const deleteMutation = useMutation({
    mutationFn: (code: string) => apiLinks.remove(code),
    onSuccess: () => {
      notifications.show({ message: "Link deleted", color: "green" });
      queryClient.invalidateQueries({ queryKey: ["links"] });
    },
    onError: (e) => notifications.show({ message: `Delete failed: ${String(e)}`, color: "red" }),
  });

  const totalPages = links.data ? Math.max(Math.ceil(links.data.total / PAGE_SIZE), 1) : 1;

  return (
    <Stack gap="md" maw={1000} mx="auto" w="100%">
      <Group justify="space-between">
        <Title order={2}>Links + click analytics</Title>
        <Group gap="xs">
          <StackBadge service="nodejs" database="libSQL" />
          <StackBadge service="rust" database="DuckDB" />
        </Group>
      </Group>
      <Text size="sm" c="dimmed">
        Create a short link (nodejs → libSQL), click it, and watch the analytics move: nodejs
        publishes the click on a redis stream, a rust consumer lands it in an embedded DuckDB
        file, and the charts below are DuckDB aggregations — three services, three databases,
        zero synchronous coupling.
      </Text>

      <AnalyticsSummaryCards summary={summary.data} loading={summary.isPending} />

      <Group align="flex-start" grow preventGrowOverflow={false} wrap="wrap">
        <Card withBorder shadow="sm" radius="md" maw={420} style={{ flex: 1 }}>
          <Stack gap="sm">
            <Text fw={600}>Create a short link</Text>
            {isLoggedIn ? (
              <>
                <TextInput
                  label="URL"
                  placeholder="https://kubernetes.io/docs/…"
                  value={url}
                  onChange={(e) => setUrl(e.currentTarget.value)}
                  data-testid="link-url-input"
                />
                <TextInput
                  label="Title (optional)"
                  placeholder="Kubernetes docs"
                  value={title}
                  onChange={(e) => setTitle(e.currentTarget.value)}
                />
                <Button
                  onClick={() => createMutation.mutate()}
                  loading={createMutation.isPending}
                  disabled={url.trim() === ""}
                  data-testid="link-create-button"
                >
                  Shorten
                </Button>
              </>
            ) : (
              <Text c="dimmed">Log in to create links (writes are JWT-gated at the gateway).</Text>
            )}
          </Stack>
        </Card>

        <Card withBorder shadow="sm" radius="md" maw={420} style={{ flex: 1 }}>
          <Stack gap="sm">
            <Group justify="space-between">
              <Text fw={600}>Top links (DuckDB)</Text>
              <Badge variant="light" color="orange">analytics</Badge>
            </Group>
            {top.data && top.data.length > 0 ? (
              top.data.map((c) => (
                <Group key={c.code} justify="space-between">
                  <Text size="sm" ff="monospace">{c.code}</Text>
                  <Badge variant="light">{c.clicks} clicks</Badge>
                </Group>
              ))
            ) : (
              <Text size="sm" c="dimmed">No clicks recorded yet.</Text>
            )}
          </Stack>
        </Card>
      </Group>

      <TextInput
        leftSection={<IconSearch size={16} />}
        placeholder="Search links (FTS5 over url + title)…"
        value={search}
        onChange={(e) => {
          setSearch(e.currentTarget.value);
          setPage(1);
        }}
        data-testid="link-search-input"
      />

      {links.isPending && <Loader />}
      {links.data && (
        <>
          <Card withBorder shadow="sm" radius="md" p={0}>
            <Table verticalSpacing="sm">
              <Table.Thead>
                <Table.Tr>
                  <Table.Th>code</Table.Th>
                  <Table.Th>title</Table.Th>
                  <Table.Th>target</Table.Th>
                  <Table.Th>by</Table.Th>
                  <Table.Th style={{ textAlign: "right" }}>actions</Table.Th>
                </Table.Tr>
              </Table.Thead>
              <Table.Tbody>
                {links.data.items.map((link) => (
                  <Table.Tr key={link.code} bg={selectedCode === link.code ? "var(--mantine-color-teal-light)" : undefined}>
                    <Table.Td><Text size="sm" ff="monospace" fw={700}>{link.code}</Text></Table.Td>
                    <Table.Td>{link.title || <Text size="sm" c="dimmed">—</Text>}</Table.Td>
                    <Table.Td style={{ maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis" }}>
                      <MantineTooltip label={link.url} withArrow>
                        <Text size="sm" c="dimmed" truncate="end" style={{ maxWidth: 260 }}>{link.url}</Text>
                      </MantineTooltip>
                    </Table.Td>
                    <Table.Td><Badge variant="light" size="sm">{link.created_by}</Badge></Table.Td>
                    <Table.Td>
                      <Group gap="xs" justify="flex-end">
                        <Button
                          size="compact-sm"
                          variant="light"
                          color="orange"
                          leftSection={<IconClick size={14} />}
                          onClick={() => clickMutation.mutate(link)}
                          data-testid={`link-click-${link.code}`}
                        >
                          click
                        </Button>
                        <Button
                          size="compact-sm"
                          variant="subtle"
                          leftSection={<IconChartBar size={14} />}
                          onClick={() => setSelectedCode((c) => (c === link.code ? null : link.code))}
                          data-testid={`link-stats-${link.code}`}
                        >
                          stats
                        </Button>
                        {isLoggedIn && (
                          <Button
                            size="compact-sm"
                            variant="subtle"
                            color="red"
                            onClick={() => deleteMutation.mutate(link.code)}
                            aria-label={`delete link ${link.code}`}
                          >
                            <IconTrash size={14} />
                          </Button>
                        )}
                      </Group>
                    </Table.Td>
                  </Table.Tr>
                ))}
              </Table.Tbody>
            </Table>
          </Card>
          <Group justify="space-between">
            <Text size="sm" c="dimmed" data-testid="links-total">
              {links.data.total} link(s) in libSQL
            </Text>
            <Pagination value={page} onChange={setPage} total={totalPages} />
          </Group>
        </>
      )}

      {selectedCode && (
        <LinkStatsCard stats={stats.data} code={selectedCode} loading={stats.isPending} />
      )}
    </Stack>
  );
}

function AnalyticsSummaryCards({ summary, loading }: { summary?: AnalyticsSummary; loading: boolean }) {
  return (
    <SimpleGrid cols={{ base: 1, xs: 3 }} spacing="md">
      <Card withBorder shadow="sm" radius="md" padding="md" data-testid="summary-total">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>total clicks</Text>
        {loading || !summary ? <Loader size="xs" /> : <Text size="xl" fw={700}>{summary.total_clicks}</Text>}
      </Card>
      <Card withBorder shadow="sm" radius="md" padding="md">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>links clicked</Text>
        {loading || !summary ? <Loader size="xs" /> : <Text size="xl" fw={700}>{summary.links_with_clicks}</Text>}
      </Card>
      <Card withBorder shadow="sm" radius="md" padding="md">
        <Text size="xs" c="dimmed" tt="uppercase" fw={700}>clicks · last 24h</Text>
        {loading || !summary ? <Loader size="xs" /> : <Text size="xl" fw={700}>{summary.clicks_last_24h}</Text>}
      </Card>
    </SimpleGrid>
  );
}

function LinkStatsCard({ stats, code, loading }: { stats?: LinkStats; code: string; loading: boolean }) {
  return (
    <Card withBorder shadow="sm" radius="md" data-testid="link-stats-card">
      <Stack gap="md">
        <Group justify="space-between">
          <Text fw={600}>
            Clicks for <Text span ff="monospace">{code}</Text>
          </Text>
          <Badge variant="light" color="orange">DuckDB aggregation</Badge>
        </Group>
        {loading || !stats ? (
          <Loader />
        ) : (
          <>
            <Text size="sm">
              total: <b>{stats.total_clicks}</b>
            </Text>
            <Group align="flex-start" grow wrap="wrap" preventGrowOverflow={false}>
              {stats.per_day.length > 0 ? (
                <Card withBorder radius="md" style={{ flex: 1, minWidth: 280 }}>
                  <Text size="sm" fw={600} mb="xs">clicks per day</Text>
                  <StatsChart data={stats.per_day} />
                </Card>
              ) : (
                <Text size="sm" c="dimmed">No per-day data yet.</Text>
              )}
              {stats.top_referrers.length > 0 ? (
                <Card withBorder radius="md" style={{ flex: 1, minWidth: 280 }}>
                  <Text size="sm" fw={600} mb="xs">top referrers</Text>
                  <ReferrersChart data={stats.top_referrers} />
                </Card>
              ) : (
                <Text size="sm" c="dimmed">No referrer data yet.</Text>
              )}
            </Group>
          </>
        )}
      </Stack>
    </Card>
  );
}

function StatsChart({ data }: { data: { day: string; clicks: number }[] }) {
  return <LineChart h={220} data={data} dataKey="day" series={[{ name: "clicks", color: "teal.6" }]} withDots />;
}

function ReferrersChart({ data }: { data: { referrer: string; clicks: number }[] }) {
  return (
    <BarChart
      h={220}
      data={data}
      dataKey="referrer"
      series={[{ name: "clicks", color: "orange.6" }]}
      withXAxis={false}
    />
  );
}
