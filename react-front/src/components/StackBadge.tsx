import { Badge, Tooltip } from "@mantine/core";
import { IconDatabase } from "@tabler/icons-react";

const COLORS: Record<string, string> = {
  nodejs: "green",
  golang: "cyan",
  rust: "orange",
};

// the educational overlay: every card in the demo states which service and
// which database actually served it — the whole point of the polyglot setup
export function StackBadge({ service, database }: { service: string; database: string }) {
  return (
    <Tooltip label={`served by ${service}, persisted in ${database}`} withArrow>
      <Badge variant="light" color={COLORS[service] ?? "gray"} leftSection={<IconDatabase size={12} />}>
        {service} · {database}
      </Badge>
    </Tooltip>
  );
}
