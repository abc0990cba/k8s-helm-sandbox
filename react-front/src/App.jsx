import Protected from "./components/Protected";
import Public from "./components/Public";

import useAuth from "./hooks/useAuth";

function App() {
  const [isLogin, token] = useAuth();
  console.log('envs', {
    url: import.meta.env.VITE_KEYCLOAK_URL,
    realm: import.meta.env.VITE_KEYCLOAK_REALM,
    clientId: import.meta.env.VITE_KEYCLOAK_CLIENT,
    redirectUri: import.meta.env.VITE_REDIRECT_URL
  })

  return isLogin ? <Protected token={token} /> : <Public />;
}

export default App;
