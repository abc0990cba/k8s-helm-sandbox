import axios from "axios";

const isDev = import.meta.env.DEV;
// dev: call the deployed cluster directly (the hosts file maps grogu.test to
// it); prod: same origin behind the ingress
const apiBaseUrl = isDev ? "http://grogu.test" : "";

export const api = axios.create({ baseURL: apiBaseUrl });

// use-auth wires the live keycloak token in at boot — keeps this module free
// of the auth dependency (and keeps it trivially mockable in tests)
let tokenProvider: () => string | undefined = () => undefined;

export function setTokenProvider(provider: () => string | undefined) {
  tokenProvider = provider;
}

api.interceptors.request.use((config) => {
  const token = tokenProvider();
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

// ---------- types (the gateway is a no-op passthrough: these mirror the
// backends' own JSON contracts) ----------

export interface Note {
  id: number;
  title: string;
  body: string;
  owner: string;
  created_at: string;
  updated_at: string;
}

export interface Page<T> {
  items: T[];
  total: number;
  limit: number;
  offset: number;
}

export type JobStatus = "queued" | "processing" | "done" | "failed";

export interface JobRow {
  id: string;
  type: string;
  status: JobStatus;
  payload: unknown;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_by: string;
  created_at: string;
  updated_at?: string | null;
}

export interface LinkRow {
  code: string;
  url: string;
  title: string;
  created_by: string;
  created_at: string;
}

export interface DayCount {
  day: string;
  clicks: number;
}

export interface AnalyticsSummary {
  total_clicks: number;
  links_with_clicks: number;
  clicks_last_24h: number;
  per_day: DayCount[];
}

export interface LinkStats {
  code: string;
  total_clicks: number;
  per_day: DayCount[];
  top_referrers: { referrer: string; clicks: number }[];
}

export interface CodeCount {
  code: string;
  clicks: number;
}

// ---------- domains (one backend, one database each) ----------

// golang-back · postgres — notes
export const apiNotes = {
  list: (params: { limit: number; offset: number }) =>
    api.get<Page<Note>>("/api/v1/golang/notes", { params }),
  create: (body: { title: string; body: string }) => api.post<Note>("/api/v1/golang/notes", body),
  update: (id: number, body: { title?: string; body?: string }) =>
    api.patch<Note>(`/api/v1/golang/notes/${id}`, body),
  remove: (id: number) => api.delete<void>(`/api/v1/golang/notes/${id}`),
};

// nodejs-back · libSQL — link shortener (+ async jobs)
export const apiLinks = {
  list: (params: { limit: number; offset: number; q?: string }) =>
    api.get<Page<LinkRow>>("/api/v1/nodejs/links", { params }),
  create: (body: { url: string; title?: string }) => api.post<LinkRow>("/api/v1/nodejs/links", body),
  // resolving IS the click: nodejs records the event on the redis `clicks`
  // stream, the rust consumer lands it in DuckDB
  click: (code: string) => api.get<LinkRow>(`/api/v1/nodejs/links/${code}`),
  remove: (code: string) => api.delete<void>(`/api/v1/nodejs/links/${code}`),
};

// rust-back · DuckDB — click analytics (read-only)
export const apiAnalytics = {
  summary: () => api.get<AnalyticsSummary>("/api/v1/rust/analytics/summary"),
  link: (code: string) => api.get<LinkStats>(`/api/v1/rust/analytics/links/${code}`),
  top: (limit: number) => api.get<{ items: CodeCount[] }>(`/api/v1/rust/analytics/top?limit=${limit}`),
};

export const apiJobs = {
  enqueue: (type: "wordcount" | "fibonacci", payload: Record<string, unknown>) =>
    api.post<{ id: string; type: string; status: JobStatus }>("/api/v1/nodejs/jobs", { type, payload }),
  get: (id: string) => api.get<JobRow>(`/api/v1/nodejs/jobs/${id}`),
};

// the auth playground: hit a public/private pair through the gateway and let
// KrakenD's JWT validator answer instead of the backend
export const apiPlayground = {
  call: (path: string) => api.get(path),
};
