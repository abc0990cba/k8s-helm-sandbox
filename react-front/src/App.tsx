import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import axios from "axios";
import { useEffect, useState } from "react";
import { useAuth } from "./use-auth";
import { Button } from "./components/ui/button";
import { Label } from "@/components/ui/label"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import { jwtDecode } from 'jwt-decode';

const isDev = import.meta.env.DEV;
const apiBaseUrl = isDev ? 'http://grogu.test' : '';

const NODEJS_PUBLIC_URL = `${apiBaseUrl}/api/v1/nodejs/public`;
const NODEJS_PRIVATE_URL = `${apiBaseUrl}/api/v1/nodejs/private`;
const GOLANG_PUBLIC_URL = `${apiBaseUrl}/api/v1/golang/public`;
const GOLANG_PRIVATE_URL = `${apiBaseUrl}/api/v1/golang/private`;

console.log('envs', import.meta.env);

function App() {
  const [tab, setTab] = useState<'public' | 'private'>('public');
  const [service, setService] = useState<'nodejs' | 'golang'>('nodejs');
  
  const [decodedToken, setDecodedToken] = useState(null);

  const { token, isLoggedIn } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if(token) setDecodedToken(jwtDecode(token));
  }, [token])

  const handleClickFetchButton = () => {
    const config = {
      headers: {
        authorization: `Bearer ${token}`,
      },
    };
    
    const url =
       tab === 'public' 
        ? service === 'nodejs' ? NODEJS_PUBLIC_URL : GOLANG_PUBLIC_URL
        : service === 'nodejs' ? NODEJS_PRIVATE_URL : GOLANG_PRIVATE_URL

    axios
      .get(url, config)
      .then((res) => setData(res.data))
      .catch((err) => setData(err));
  }

  return (
    <Card className="w-[600px] max-w-3xl mx-auto my-auto">
      <CardHeader>
        <CardTitle>API data</CardTitle>
        <CardDescription>api data from public/private nodejs/golang endpoints</CardDescription>
      </CardHeader>

      <CardContent>
        <div className='flex gap-5 w-full'>
          <Button onClick={handleClickFetchButton}>fetch data</Button>
        </div>

        <RadioGroup defaultValue={service} className="mt-8">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="nodejs" id="nodejs" onClick={() => setService('nodejs')}/>
            <Label htmlFor="nodejs">nodejs</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="golang" id="golang" onClick={() => setService('golang')}/>
            <Label htmlFor="golang">golang</Label>
          </div>
        </RadioGroup>

        <RadioGroup defaultValue={tab} className="mt-8">
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="private" id="private" onClick={() => setTab('private')}/>
            <Label htmlFor="private">private</Label>
          </div>
          <div className="flex items-center space-x-2">
            <RadioGroupItem value="public" id="public" onClick={() => setTab('public')}/>
            <Label htmlFor="public">public</Label>
          </div>
        </RadioGroup>

        <Card className="mt-8">
          <CardHeader>
            <CardTitle>Api data</CardTitle>
            <CardDescription>{tab} {service}</CardDescription>
          </CardHeader>
          <CardContent>
            <pre className="bg-muted p-4 rounded-md overflow-x-auto max-h-80">
              <code>{JSON.stringify(data, null, 2)}</code> 
            </pre>
          </CardContent>
        </Card>

        <Card className="mt-8">
            <CardHeader>
              <CardTitle>Token</CardTitle>
              <CardDescription>user token info</CardDescription>
            </CardHeader>
            <CardContent>
              <pre className="bg-muted p-4 rounded-md overflow-x-auto">
                  {isLoggedIn && decodedToken
                    ? <code>{JSON.stringify(decodedToken, null, 2)}</code>
                    : <code>Not Authenticated</code>
                  }   
              </pre>
            </CardContent>
        </Card>
    </CardContent>
  </Card>
  )
}

export default App
