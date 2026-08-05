"use client";

import { useEffect, useState } from "react";
import { ChevronRight, File, Folder, Fullscreen, LoaderCircle, Minimize2, Pencil, Plus, Save, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

type RemoteEntry = { name: string; directory: boolean; path: string };

type RemoteFileEditorProps = {
  cwd: string;
  onCwdChange: (cwd: string) => void;
};

function parseListing(output: string, cwd: string): RemoteEntry[] {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => {
      const match = line.match(/^([d-])[^\s]*\s+\d+\s+\S+\s+\S+\s+\d+\s+\S+\s+\S+\s+(.+)$/);
      if (!match) return null;
      const name = match[2].replace(/ -> .*$/, "");
      if (name === "." || name === "..") return null;
      return { name, directory: match[1] === "d", path: `${cwd.replace(/\/$/, "")}/${name}` };
    })
    .filter((entry): entry is RemoteEntry => Boolean(entry))
    .sort((a, b) => Number(b.directory) - Number(a.directory) || a.name.localeCompare(b.name));
}

export function RemoteFileEditor({ cwd, onCwdChange }: RemoteFileEditorProps) {
  const [entries, setEntries] = useState<RemoteEntry[]>([]);
  const [selectedPath, setSelectedPath] = useState("");
  const [selectedEntryPath, setSelectedEntryPath] = useState("");
  const [content, setContent] = useState("");
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [newName, setNewName] = useState("");
  const [fullscreen, setFullscreen] = useState(false);

  async function request(body: Record<string, unknown>) {
    const response = await fetch("/api/remote", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const data = (await response.json()) as { error?: string; output?: string; content?: string; path?: string; newPath?: string };
    if (!response.ok) throw new Error(data.error || "Remote file action failed");
    return data;
  }

  async function loadDirectory(nextPath = cwd) {
    setLoading(true);
    setError("");
    try {
      const data = await request({ action: "list", path: nextPath, cwd });
      setEntries(parseListing(data.output || "", nextPath));
      onCwdChange(nextPath);
      setSelectedPath("");
      setContent("");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Directory could not be loaded");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadDirectory(cwd);
    // The editor should refresh when the shared remote cwd changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cwd]);

  async function openEntry(entry: RemoteEntry) {
    setError("");
    setSelectedEntryPath(entry.path);
    if (entry.directory) {
      await loadDirectory(entry.path);
      setSelectedEntryPath(entry.path);
      return;
    }
    try {
      const data = await request({ action: "read", path: entry.path, cwd });
      setSelectedPath(entry.path);
      setContent(data.content || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "File could not be read");
    }
  }

  async function save() {
    if (!selectedPath) return;
    setSaving(true);
    try {
      await request({ action: "write", path: selectedPath, cwd, content });
      toast.success("Datei gespeichert");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "File could not be saved");
    } finally {
      setSaving(false);
    }
  }

  async function createFile() {
    const name = newName.trim();
    if (!name) return;
    try {
      await request({ action: "write", path: `${cwd.replace(/\/$/, "")}/${name}`, cwd, content: "" });
      setNewName("");
      await loadDirectory(cwd);
      toast.success("Datei erstellt");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "File could not be created");
    }
  }

  async function createFolder() {
    const name = window.prompt("Name des neuen Ordners");
    if (!name?.trim()) return;
    try {
      await request({ action: "mkdir", path: `${cwd.replace(/\/$/, "")}/${name.trim()}`, cwd });
      await loadDirectory(cwd);
      toast.success("Ordner erstellt");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Folder could not be created");
    }
  }

  async function renameSelected() {
    if (!selectedEntryPath) return;
    const currentName = selectedEntryPath.split("/").pop() || "";
    const name = window.prompt("Neuer Name", currentName);
    if (!name?.trim() || name.trim() === currentName) return;
    try {
      await request({
        action: "rename",
        path: selectedEntryPath,
        newPath: `${selectedEntryPath.slice(0, -currentName.length)}${name.trim()}`,
        cwd,
      });
      setSelectedEntryPath("");
      setSelectedPath("");
      setContent("");
      await loadDirectory(cwd);
      toast.success("Umbenannt");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "Entry could not be renamed");
    }
  }

  async function deleteSelected() {
    if (!selectedEntryPath || !window.confirm(`"${selectedEntryPath}" wirklich löschen?`)) return;
    try {
      await request({ action: "delete", path: selectedEntryPath, cwd });
      setSelectedPath("");
      setSelectedEntryPath("");
      setContent("");
      await loadDirectory(cwd);
      toast.success("Datei gelöscht");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "File could not be deleted");
    }
  }

  return (
    <div className={fullscreen ? "fixed inset-0 z-50 flex min-h-0 flex-col gap-3 bg-background p-4" : "flex min-h-0 flex-1 flex-col gap-2"}>
      <div className="flex items-center gap-2">
        <Input value={cwd} onChange={(event) => onCwdChange(event.target.value)} aria-label="Remote directory" className="h-8 min-w-0 flex-1 font-mono text-xs" />
        <Button type="button" size="icon-sm" variant="ghost" onClick={() => void loadDirectory(cwd)} aria-label="Refresh files">
          <LoaderCircle className={loading ? "size-3.5 animate-spin" : "size-3.5"} />
        </Button>
        {fullscreen ? (
          <div className="flex items-center gap-1">
            <Button type="button" size="icon-sm" variant="secondary" disabled={!selectedPath || saving} onClick={() => void save()} aria-label="Save file" title="Save file">
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
            </Button>
            <Button type="button" size="icon-sm" variant="secondary" onClick={() => setFullscreen(false)} aria-label="Exit fullscreen" title="Exit fullscreen">
              <Minimize2 className="size-3.5" />
            </Button>
          </div>
        ) : null}
      </div>
      <div className="flex min-h-0 flex-1 gap-2">
        <div className="min-h-0 w-2/5 overflow-y-auto rounded-md border border-border/40 p-1">
          {entries.map((entry) => (
            <button key={entry.path} type="button" onClick={() => void openEntry(entry)} className="flex w-full items-center gap-1.5 rounded px-2 py-1.5 text-left text-xs hover:bg-muted/50">
              {entry.directory ? <Folder className="size-3.5 text-primary" /> : <File className="size-3.5 text-muted-foreground" />}
              <span className="min-w-0 flex-1 truncate">{entry.name}</span>
              {entry.directory ? <ChevronRight className="size-3 text-muted-foreground" /> : null}
            </button>
          ))}
          {!loading && entries.length === 0 ? <p className="p-2 text-xs text-muted-foreground">Verzeichnis ist leer.</p> : null}
        </div>
        <div className="flex min-h-0 min-w-0 flex-1 flex-col gap-2">
          <div className="flex items-center gap-1">
            <Input value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="Neue Datei…" className="h-8 min-w-0 flex-1 text-xs" />
            <Button type="button" size="icon-sm" variant="ghost" disabled={!newName.trim()} onClick={() => void createFile()} aria-label="Create file">
              <Plus className="size-3.5" />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" onClick={() => void createFolder()} aria-label="Create folder">
              <Folder className="size-3.5" />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" disabled={!selectedEntryPath} onClick={() => void renameSelected()} aria-label="Rename entry">
              <Pencil className="size-3.5" />
            </Button>
            <Button type="button" size="icon-sm" variant="ghost" disabled={!selectedEntryPath} onClick={() => void deleteSelected()} aria-label="Delete entry">
              <Trash2 className="size-3.5" />
            </Button>
            {!fullscreen ? (
              <Button type="button" size="sm" variant="outline" disabled={!selectedPath} onClick={() => setFullscreen(true)} aria-label="Open file fullscreen" title="Open file fullscreen">
                <Fullscreen className="size-3.5" />
                Vollbild
              </Button>
            ) : null}
            {!fullscreen ? (
              <Button type="button" size="icon-sm" disabled={!selectedPath || saving} onClick={() => void save()} aria-label="Save file" title="Save file">
              {saving ? <LoaderCircle className="size-3.5 animate-spin" /> : <Save className="size-3.5" />}
              </Button>
            ) : null}
          </div>
          <Textarea value={content} onChange={(event) => setContent(event.target.value)} disabled={!selectedPath} placeholder="Datei auswählen…" className="min-h-0 flex-1 resize-none font-mono text-xs leading-5" />
        </div>
      </div>
      {selectedPath ? <p className="truncate text-[11px] text-muted-foreground">{selectedPath}</p> : null}
      {error ? <p className="whitespace-pre-wrap text-xs text-destructive">{error}</p> : null}
    </div>
  );
}
