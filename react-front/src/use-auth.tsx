import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import Keycloak from "keycloak-js";
import { Loader, Center } from "@mantine/core";
import { setTokenProvider } from "@/api/client";

const client = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL || "http://auth.test/",
  realm: import.meta.env.VITE_KEYCLOAK_REALM || "demorealm",
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT || "reactclient",
});

interface AuthState {
  isLoggedIn: boolean;
  token: string;
  login: () => void;
  logout: () => void;
}

const AuthContext = createContext<AuthState>({
  isLoggedIn: false,
  token: "",
  login: () => {},
  logout: () => {},
});

const redirectUri = import.meta.env.VITE_REDIRECT_URL || `${window.location.origin}/`;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false);
  const [token, setToken] = useState("");

  useEffect(() => {
    // PKCE authorization-code flow (the default response type); the old bogus
    // KeycloakResponseType option is gone — keycloak-js 26 types it strictly
    client
      .init({
        onLoad: "login-required",
        checkLoginIframe: false,
        pkceMethod: "S256",
        redirectUri,
      })
      .then(() => {
        setToken(client.token || "");
        setReady(true);
      })
      .catch((err) => {
        console.error("keycloak init failed", err);
        setReady(true);
      });

    // keep the context (and the axios interceptor) in sync with the token
    const sync = () => setToken(client.token || "");
    client.onAuthSuccess = sync;
    client.onAuthRefreshSuccess = sync;
    client.onAuthLogout = sync;
    // refresh 60s before expiry instead of the old console.log — tokens live
    // 5 minutes in the demo realm, so long sessions stay valid
    client.onTokenExpired = () => {
      client.updateToken(60).catch(sync);
    };
    setTokenProvider(() => client.token || undefined);
  }, []);

  const value = useMemo<AuthState>(
    () => ({
      isLoggedIn: Boolean(token),
      token,
      login: () => client.login({ redirectUri }),
      logout: () => client.logout({ redirectUri }),
    }),
    [token],
  );

  if (!ready) {
    return (
      <Center h="100vh">
        <Loader size="lg" />
      </Center>
    );
  }

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);
