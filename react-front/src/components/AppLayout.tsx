import { useLocation, useNavigate } from "react-router-dom";
import {
  ActionIcon,
  AppShell,
  Badge,
  Button,
  Group,
  NavLink as MantineNavLink,
  Stack,
  Text,
  Title,
  UnstyledButton,
  useMantineColorScheme,
} from "@mantine/core";
import { IconMoon, IconSun } from "@tabler/icons-react";
import { useAuth } from "@/use-auth";

const NAV_ITEMS = [
  { to: "/", label: "API playground", desc: "gateway · auth", icon: "🛝" },
  { to: "/notes", label: "Notes", desc: "golang-back · PostgreSQL", icon: "📝" },
  { to: "/jobs", label: "Jobs", desc: "nodejs worker · Redis Streams", icon: "⚙️" },
  { to: "/links", label: "Links + analytics", desc: "nodejs/libSQL → rust/DuckDB", icon: "🔗" },
  { to: "/token", label: "Token", desc: "decoded JWT", icon: "🎟️" },
];

export function AppLayout({ children }: { children: React.ReactNode }) {
  const { isLoggedIn, login, logout } = useAuth();
  const { colorScheme, toggleColorScheme } = useMantineColorScheme();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <AppShell
      header={{ height: 60 }}
      navbar={{ width: 260, breakpoint: "sm" }}
      padding="md"
    >
      <AppShell.Header>
        <Group h="100%" px="md" justify="space-between">
          <Group gap="sm">
            <Title order={3}>Grogu · polyglot k8s demo</Title>
            <Badge variant="gradient" gradient={{ from: "teal", to: "orange" }} visibleFrom="md">
              3 backends × 3 databases
            </Badge>
          </Group>
          <Group gap="xs">
            <ActionIcon
              variant="default"
              onClick={() => toggleColorScheme()}
              aria-label="toggle color scheme"
              title={colorScheme === "dark" ? "switch to light" : "switch to dark"}
            >
              {colorScheme === "dark" ? <IconSun size={16} /> : <IconMoon size={16} />}
            </ActionIcon>
            <Button
              variant={isLoggedIn ? "default" : "filled"}
              onClick={() => (isLoggedIn ? logout() : login())}
            >
              {isLoggedIn ? "Log out" : "Log in"}
            </Button>
          </Group>
        </Group>
      </AppShell.Header>

      <AppShell.Navbar p="xs">
        <Stack gap={4}>
          {NAV_ITEMS.map((item) => (
            <MantineNavLink
              key={item.to}
              renderRoot={(props) => (
                <UnstyledButton {...props} onClick={() => navigate(item.to)} w="100%" />
              )}
              label={
                <Text size="sm" fw={location.pathname === item.to ? 700 : 500}>
                  {item.label}
                </Text>
              }
              description={item.desc}
              leftSection={<span role="img">{item.icon}</span>}
              active={location.pathname === item.to}
              variant="light"
            />
          ))}
        </Stack>
      </AppShell.Navbar>

      <AppShell.Main>{children}</AppShell.Main>
    </AppShell>
  );
}
