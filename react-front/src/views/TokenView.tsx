import { jwtDecode } from "jwt-decode";
import { Button, Card, Code, CopyButton, Group, Stack, Text, Title } from "@mantine/core";
import { useAuth } from "@/use-auth";

export function TokenView() {
  const { token, isLoggedIn, login, logout } = useAuth();

  return (
    <Stack gap="md" maw={860} mx="auto" w="100%">
      <Title order={2}>Token</Title>
      <Card withBorder shadow="sm" radius="md">
        {isLoggedIn ? (
          <Stack gap="sm">
            <Group>
              <CopyButton value={token}>
                {({ copied, copy }) => (
                  <Button variant="default" size="xs" onClick={copy}>
                    {copied ? "Copied" : "Copy token"}
                  </Button>
                )}
              </CopyButton>
              <Button variant="light" color="red" size="xs" onClick={logout}>
                Log out
              </Button>
            </Group>
            <Code block data-testid="token-payload">
              {JSON.stringify(jwtDecode(token), null, 2)}
            </Code>
            <Text size="xs" c="dimmed">
              Decoded payload (not verified — decoding ≠ verification). The gateway verifies the
              RS256 signature against Keycloak's JWKS on every private route.
            </Text>
          </Stack>
        ) : (
          <Group>
            <Text c="dimmed">Not authenticated.</Text>
            <Button size="xs" onClick={login}>
              Log in
            </Button>
          </Group>
        )}
      </Card>
    </Stack>
  );
}
