import React, { useState, useEffect, useRef } from "react";
import Keycloak from "keycloak-js";

const client = new Keycloak({
  url: import.meta.env.VITE_KEYCLOAK_URL,
  realm: import.meta.env.VITE_KEYCLOAK_REALM,
  clientId: import.meta.env.VITE_KEYCLOAK_CLIENT,
});


const useAuth = () => {
  const isRun = useRef(false);
  const [token, setToken] = useState(null);
  const [isLogin, setLogin] = useState(false);

  useEffect(() => {
    if (isRun.current) return;

    isRun.current = true;
    client
      .init({
        onLoad: "login-required",
        // onLoad: 'check-sso', // check-sso | login-required
        KeycloakResponseType: 'code',
        // silentCheckSsoRedirectUri: window.location.origin + "/silent-check-sso.html", 
        checkLoginIframe: false,
        pkceMethod: 'S256',
        redirectUri: import.meta.env.VITE_REDIRECT_URL,
      })
      .then((res) => {
        if (!res) {
          console.info("res", res);
          // window.location.reload();
        } else {
          setLogin(res);
        setToken(client.token);
          console.info("Authenticated");
          console.log('auth', res)
          console.log('Keycloak', client)
          client.onTokenExpired = () => {
            console.log('token expired')
          }
        }

        
      });
  }, []);

  return [isLogin, token];
};

export default useAuth;
