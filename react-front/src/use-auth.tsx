import { useState, useEffect, useRef } from "react";
import Keycloak from "keycloak-js";

const client = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT,
});

export const useAuth = () => {
  const isRun = useRef(false);
  const [token, setToken] = useState<string>('');
  const [isLoggedIn, setIsLoggedIn] = useState(false);

  useEffect(() => {
    if (isRun.current) return;
    isRun.current = true;
    client
      .init({
        onLoad: "login-required",
        // eslint-disable-next-line @typescript-eslint/ban-ts-comment
        //@ts-ignore
        KeycloakResponseType: 'code',
        checkLoginIframe: false,
        pkceMethod: 'S256',
        redirectUri: import.meta.env.VITE_REDIRECT_URL,
      })
      .then((res) => {
        if (!res) {
          console.info("res", res);
        } else {
          setIsLoggedIn(res);
          setToken(client?.token || '');
          client.onTokenExpired = () => {
            console.log('token expired')
          }
        }
      });
  }, []);

  return { isLoggedIn, token };
};

