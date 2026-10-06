import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card"
import axios from "axios";
import { useCallback, useEffect, useRef, useState } from "react";
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

const inputClass = "border rounded-md px-3 py-2 w-full bg-white dark:bg-slate-900";
const preClass = "bg-muted p-4 rounded-md overflow-x-auto max-h-80";

function authConfig(token: string) {
  return { headers: { authorization: `Bearer ${token}` } };
}

// same REST contract on both stacks — the tab's radio switches the backend
function notesUrl(service: 'nodejs' | 'golang', suffix = '') {
  return `${apiBaseUrl}/api/v1/${service}/notes${suffix}`;
}

type Note = { id: number; title: string; body: string; owner: string; created_at: string };
type NotePage = { items: Note[]; total: number; limit: number; offset: number };
type Job = { id: string; type: string; status: string; result?: unknown; error?: string };

// exported for the unit tests (NotesView.test.tsx)
export function NotesView({ service, token, isLoggedIn }: { service: 'nodejs' | 'golang'; token: string; isLoggedIn: boolean }) {
  const [page, setPage] = useState<NotePage | null>(null);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [editing, setEditing] = useState<Note | null>(null);
  const [error, setError] = useState('');

  const load = useCallback((offset = 0) => {
    setError('');
    axios.get<NotePage>(notesUrl(service, `?limit=20&offset=${offset}`))
      .then((res) => setPage(res.data))
      .catch((err) => setError(String(err)));
  }, [service]);

  useEffect(() => { load(0); }, [load]);

  const create = () => {
    if (!isLoggedIn) { setError('log in to create notes (writes are JWT-gated at the gateway)'); return; }
    axios.post(notesUrl(service), { title, body }, authConfig(token))
      .then(() => { setTitle(''); setBody(''); load(0); })
      .catch((err) => setError(err?.response?.data?.message || String(err)));
  };

  const save = () => {
    if (!editing) return;
    axios.patch(notesUrl(service, `/${editing.id}`), { title: editing.title, body: editing.body }, authConfig(token))
      .then(() => { setEditing(null); load(page?.offset ?? 0); })
      .catch((err) => setError(err?.response?.data?.message || String(err)));
  };

  const remove = (id: number) => {
    if (!isLoggedIn) { setError('log in to delete notes'); return; }
    axios.delete(notesUrl(service, `/${id}`), authConfig(token))
      .then(() => load(page?.offset ?? 0))
      .catch((err) => setError(err?.response?.data?.message || String(err)));
  };

  return (
    <div className="space-y-4">
      testing argocd work msg v2
      <CardDescription>
        CRUD served by the <b>{service}</b> backend (the golang one implements the same contract) —
        Postgres storage, Redis read-through cache on GET by id
      </CardDescription>

      <div className="flex gap-2">
        <input className={inputClass} placeholder="title" value={title} onChange={(e) => setTitle(e.target.value)} />
        <input className={inputClass} placeholder="body" value={body} onChange={(e) => setBody(e.target.value)} />
        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap" onClick={create}>create</Button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      <div className="space-y-2 max-h-80 overflow-y-auto">
        {page?.items.map((note) => (
          <div key={note.id} className="border rounded-md p-3 text-sm">
            {editing?.id === note.id ? (
              <div className="space-y-2">
                <input className={inputClass} value={editing.title} onChange={(e) => setEditing({ ...editing, title: e.target.value })} />
                <input className={inputClass} value={editing.body} onChange={(e) => setEditing({ ...editing, body: e.target.value })} />
                <div className="flex gap-2">
                  <Button className="h-8 bg-emerald-600 hover:bg-emerald-700 text-white" onClick={save}>save</Button>
                  <Button className="h-8" variant="outline" onClick={() => setEditing(null)}>cancel</Button>
                </div>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-2">
                <div>
                  <p className="font-medium">{note.title}</p>
                  <p className="text-muted-foreground">{note.body}</p>
                  <p className="text-xs text-muted-foreground mt-1">#{note.id} by {note.owner}</p>
                </div>
                <div className="flex gap-1">
                  <Button className="h-8" variant="outline" onClick={() => setEditing(note)}>edit</Button>
                  <Button className="h-8" variant="outline" onClick={() => remove(note.id)}>delete</Button>
                </div>
              </div>
            )}
          </div>
        ))}
      </div>

      <div className="flex items-center justify-between text-sm text-muted-foreground">
        <Button className="h-8" variant="outline" disabled={(page?.offset ?? 0) <= 0}
          onClick={() => load((page?.offset ?? 0) - (page?.limit ?? 20))}>prev</Button>
        <span>{page?.total ?? 0} notes</span>
        <Button className="h-8" variant="outline" disabled={(page?.offset ?? 0) + (page?.limit ?? 20) >= (page?.total ?? 0)}
          onClick={() => load((page?.offset ?? 0) + (page?.limit ?? 20))}>next</Button>
      </div>
    </div>
  );
}

function JobsView({ token, isLoggedIn }: { token: string; isLoggedIn: boolean }) {
  const [type, setType] = useState<'wordcount' | 'fibonacci'>('wordcount');
  const [noteId, setNoteId] = useState('1');
  const [n, setN] = useState('200');
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState('');
  const pollTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => () => { if (pollTimer.current) clearTimeout(pollTimer.current); }, []);

  const poll = (id: string, tries: number) => {
    if (tries <= 0) { setError('job did not finish in time'); return; }
    pollTimer.current = setTimeout(() => {
      axios.get<Job>(`${apiBaseUrl}/api/v1/nodejs/jobs/${id}`)
        .then((res) => {
          setJob(res.data);
          if (res.data.status === 'done' || res.data.status === 'failed') return;
          poll(id, tries - 1);
        })
        .catch((err) => setError(err?.response?.data?.message || String(err)));
    }, 1500);
  };

  const submit = () => {
    if (!isLoggedIn) { setError('log in to submit jobs (they are JWT-gated at the gateway)'); return; }
    setError('');
    setJob(null);
    const payload = type === 'wordcount' ? { noteId: Number(noteId) } : { n: Number(n) };
    axios.post<Job>(`${apiBaseUrl}/api/v1/nodejs/jobs`, { type, payload }, authConfig(token))
      .then((res) => { setJob(res.data); poll(res.data.id, 40); })
      .catch((err) => setError(err?.response?.data?.message || String(err)));
  };

  return (
    <div className="space-y-4">
      <CardDescription>
        async jobs: the API inserts a row and XADDs to a Redis Stream; a worker
        Deployment consumes the stream and fills <code>result</code> — the classic queue pattern
      </CardDescription>

      <RadioGroup defaultValue={type} className="flex gap-5">
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="wordcount" id="jw" onClick={() => setType('wordcount')} />
          <Label htmlFor="jw">wordcount (note id)</Label>
        </div>
        <div className="flex items-center space-x-2">
          <RadioGroupItem value="fibonacci" id="jf" onClick={() => setType('fibonacci')} />
          <Label htmlFor="jf">fibonacci (n)</Label>
        </div>
      </RadioGroup>

      <div className="flex gap-2">
        {type === 'wordcount'
          ? <input className={inputClass} value={noteId} onChange={(e) => setNoteId(e.target.value)} placeholder="note id" />
          : <input className={inputClass} value={n} onChange={(e) => setN(e.target.value)} placeholder="n" />}
        <Button className="bg-indigo-600 hover:bg-indigo-700 text-white whitespace-nowrap" onClick={submit}>submit job</Button>
      </div>

      {error && <p className="text-red-600 text-sm">{error}</p>}

      {job && (
        <pre className={preClass}>
          <code>{JSON.stringify(job, null, 2)}</code>
        </pre>
      )}
    </div>
  );
}

function App() {
  const [view, setView] = useState<'api' | 'notes' | 'jobs'>('api');
  const [tab, setTab] = useState<'public' | 'private'>('public');
  const [service, setService] = useState<'nodejs' | 'golang'>('nodejs');

  const [decodedToken, setDecodedToken] = useState(null);

  const { token, isLoggedIn } = useAuth();
  const [data, setData] = useState(null);

  useEffect(() => {
    if (token) setDecodedToken(jwtDecode(token));
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
    <Card className="w-[680px] max-w-3xl mx-auto my-auto">
      <CardHeader>
        <CardTitle>API data</CardTitle>
        <CardDescription>api data from public/private nodejs/golang endpoints</CardDescription>
      </CardHeader>

      <CardContent>
        <div className="flex gap-2">
          <Button className={(view === 'api' ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-400 hover:bg-slate-500") + " text-white"} onClick={() => setView('api')}>api</Button>
          <Button className={(view === 'notes' ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-400 hover:bg-slate-500") + " text-white"} onClick={() => setView('notes')}>notes</Button>
          <Button className={(view === 'jobs' ? "bg-indigo-600 hover:bg-indigo-700" : "bg-slate-400 hover:bg-slate-500") + " text-white"} onClick={() => setView('jobs')}>jobs</Button>
          {view === 'api' && <Button className="ml-auto bg-emerald-600 hover:bg-emerald-700 text-white" onClick={handleClickFetchButton}>fetch data (v0.4.0 via CI)</Button>}
        </div>

        {view === 'api' && (
          <>
            <RadioGroup defaultValue={service} className="mt-8">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="nodejs" id="nodejs" onClick={() => setService('nodejs')} />
                <Label htmlFor="nodejs">nodejs</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="golang" id="golang" onClick={() => setService('golang')} />
                <Label htmlFor="golang">golang</Label>
              </div>
            </RadioGroup>

            <RadioGroup defaultValue={tab} className="mt-8">
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="private" id="private" onClick={() => setTab('private')} />
                <Label htmlFor="private">private</Label>
              </div>
              <div className="flex items-center space-x-2">
                <RadioGroupItem value="public" id="public" onClick={() => setTab('public')} />
                <Label htmlFor="public">public</Label>
              </div>
            </RadioGroup>

            <Card className="mt-8">
              <CardHeader>
                <CardTitle>Api data</CardTitle>
                <CardDescription>{tab} {service}</CardDescription>
              </CardHeader>
              <CardContent>
                <pre className={preClass}>
                  <code>{JSON.stringify(data, null, 2)}</code>
                </pre>
              </CardContent>
            </Card>
          </>
        )}

        {view === 'notes' && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Notes</CardTitle>
            </CardHeader>
            <CardContent>
              <RadioGroup defaultValue={service} className="mb-4 flex gap-5">
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="nodejs" id="n-nodejs" onClick={() => setService('nodejs')} />
                  <Label htmlFor="n-nodejs">nodejs backend</Label>
                </div>
                <div className="flex items-center space-x-2">
                  <RadioGroupItem value="golang" id="n-golang" onClick={() => setService('golang')} />
                  <Label htmlFor="n-golang">golang backend</Label>
                </div>
              </RadioGroup>
              <NotesView service={service} token={token} isLoggedIn={isLoggedIn} />
            </CardContent>
          </Card>
        )}

        {view === 'jobs' && (
          <Card className="mt-8">
            <CardHeader>
              <CardTitle>Async jobs</CardTitle>
            </CardHeader>
            <CardContent>
              <JobsView token={token} isLoggedIn={isLoggedIn} />
            </CardContent>
          </Card>
        )}

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
