import { useParams } from "react-router-dom";
import { useNoteFile } from "@/api/queries";
import { Reader } from "@/components/Reader";

/** Renders `GET /file` for the note at the current route (`/s/:set/n/*`) through `Reader`. */
export default function NotePage() {
  const params = useParams<{ set: string; "*": string }>();
  const set = params.set;
  // The route carries the path inside notes/ (`/s/:set/n/03-svd.md`); the API wants it set-relative.
  const path = params["*"] ? `notes/${params["*"]}` : undefined;

  const { data: file, isLoading, isError } = useNoteFile(set, path);

  if (!set || !path) {
    return <div className="p-6 text-sm text-muted-foreground">No note selected.</div>;
  }
  if (isLoading) {
    return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
  }
  if (isError || !file) {
    return <div className="p-6 text-sm text-destructive">Failed to load this note.</div>;
  }

  return <Reader set={set} path={path} file={file} />;
}
