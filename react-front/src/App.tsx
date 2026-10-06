import { AppLayout } from "@/components/AppLayout";
import { JobsView } from "@/views/JobsView";
import { LinksView } from "@/views/LinksView";
import { NotesView } from "@/views/NotesView";
import { PlaygroundView } from "@/views/PlaygroundView";
import { TokenView } from "@/views/TokenView";
import { Route, Routes } from "react-router-dom";
import { useAuth } from "./use-auth";

export default function App() {
  const { isLoggedIn } = useAuth();

  return (
    <AppLayout>
      <Routes>
        <Route path="/" element={<PlaygroundView />} />
        <Route path="/notes" element={<NotesView isLoggedIn={isLoggedIn} />} />
        <Route path="/jobs" element={<JobsView isLoggedIn={isLoggedIn} />} />
        <Route path="/links" element={<LinksView isLoggedIn={isLoggedIn} />} />
        <Route path="/token" element={<TokenView />} />
      </Routes>
    </AppLayout>
  );
}
