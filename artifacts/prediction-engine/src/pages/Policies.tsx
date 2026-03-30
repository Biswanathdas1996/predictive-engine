import { useRef, useState } from "react";
import { useListPolicies, createPolicy, type Policy } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileBadge, FileText, Paperclip, Plus, X } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { normalizeApiArray } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";

// Include application/octet-stream — Windows often labels .md as binary in the file picker filter
const ACCEPT =
  ".pdf,.docx,.doc,.md,.markdown,.txt,.text,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,application/octet-stream";

const POLICY_FILE_INPUT_ID = "policy-file-upload";

export default function Policies() {
  const queryClient = useQueryClient();
  const { data: policies, isLoading } = useListPolicies();
  const policyList = normalizeApiArray<Policy>(policies);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [summary, setSummary] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [localExtractionOnly, setLocalExtractionOnly] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<string | null>(null);

  type StreamPayload =
    | { type: "status"; message?: string; file?: string; page?: number; total?: number; phase?: string; vertex?: boolean; model?: string | null }
    | { type: "complete"; policy: Policy }
    | { type: "error"; message: string };

  async function uploadPolicyWithStream(input: {
    title: string;
    summary: string;
    files: File[];
    localExtractionOnly: boolean;
  }): Promise<Policy> {
    const fd = new FormData();
    fd.append("title", input.title);
    fd.append("summary", input.summary);
    fd.append("vertex_mode", input.localExtractionOnly ? "off" : "auto");
    input.files.forEach((f) => fd.append("files", f));

    const res = await fetch("/api/policies/upload-stream", {
      method: "POST",
      body: fd,
    });

    if (!res.ok) {
      const data = (await res.json().catch(() => null)) as {
        detail?: { error?: string } | string;
      } | null;
      let msg = `HTTP ${res.status}`;
      const d = data?.detail;
      if (typeof d === "object" && d?.error) msg = d.error;
      else if (typeof d === "string") msg = d;
      throw new Error(msg);
    }

    const reader = res.body?.getReader();
    if (!reader) throw new Error("No response stream");

    const dec = new TextDecoder();
    let buffer = "";
    let policy: Policy | null = null;

    const applyStatus = (p: StreamPayload) => {
      if (p.type !== "status") return;
      const parts: string[] = [];
      if (p.file) parts.push(p.file);
      if (p.page != null && p.total != null && p.total > 0) {
        parts.push(`${p.page}/${p.total}`);
      }
      if (p.message) parts.push(p.message);
      if (parts.length) setUploadStatus(parts.join(" — "));
    };

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += dec.decode(value, { stream: true });
      const blocks = buffer.split("\n\n");
      buffer = blocks.pop() ?? "";
      for (const block of blocks) {
        const line = block.trim();
        if (!line.startsWith("data: ")) continue;
        let raw: unknown;
        try {
          raw = JSON.parse(line.slice(6)) as StreamPayload;
        } catch {
          continue;
        }
        if (!raw || typeof raw !== "object" || !("type" in raw)) continue;
        const payload = raw as StreamPayload;
        if (payload.type === "error") {
          throw new Error(payload.message || "Upload failed");
        }
        if (payload.type === "complete" && payload.policy) {
          policy = payload.policy;
          setUploadStatus("Done");
          continue;
        }
        if (payload.type === "status") applyStatus(payload);
      }
    }

    if (!policy) throw new Error("Stream ended before policy was saved");
    return policy;
  }

  const savePolicy = useMutation({
    mutationFn: async (input: {
      title: string;
      summary: string;
      files: File[];
      localExtractionOnly: boolean;
    }) => {
      if (input.files.length > 0) {
        return uploadPolicyWithStream(input);
      }
      return createPolicy({ title: input.title, summary: input.summary });
    },
    onMutate: () => {
      setUploadStatus("Starting…");
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/policies"] });
      setIsDialogOpen(false);
      setTitle("");
      setSummary("");
      setFiles([]);
      setLocalExtractionOnly(false);
      setUploadStatus(null);
      if (fileInputRef.current) fileInputRef.current.value = "";
      toast({ title: "Policy created" });
    },
    onError: (err) => {
      setUploadStatus(null);
      const message =
        err instanceof Error ? err.message : "Something went wrong.";
      toast({
        variant: "destructive",
        title: "Could not create policy",
        description: message,
      });
    },
  });

  const resetDialog = () => {
    setIsDialogOpen(false);
    setTitle("");
    setSummary("");
    setFiles([]);
    setLocalExtractionOnly(false);
    setUploadStatus(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const t = title.trim();
    const s = summary.trim();
    if (!t) return;
    if (files.length === 0 && !s) {
      toast({
        variant: "destructive",
        title: "Add a summary or upload files",
        description:
          "Enter a written summary, or attach PDF / Word / Markdown / TXT (or both).",
      });
      return;
    }
    savePolicy.mutate({ title: t, summary: s, files, localExtractionOnly });
  };

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const input = e.target;
    const list = input.files;
    if (!list?.length) return;
    const incoming = Array.from(list);
    setFiles((prev) => [...prev, ...incoming]);
    // Defer reset so React applies state before clearing; avoids rare cases where
    // the picker clears the live FileList before we've copied references.
    queueMicrotask(() => {
      input.value = "";
    });
  };

  function fileRowKey(f: File, i: number) {
    return `${f.name}-${f.size}-${f.lastModified}-${i}`;
  }

  const removeFile = (index: number) => {
    setFiles((prev) => prev.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <div>
          <h1 className="text-3xl font-bold flex items-center gap-3">
            <FileBadge className="w-8 h-8 text-primary" />
            Policies
          </h1>
          <p className="text-muted-foreground mt-1">
            Foundational policies that ground the simulation logic.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setIsDialogOpen(true)}
          className="flex items-center gap-2 bg-primary text-primary-foreground px-4 py-2 rounded-xl font-medium shadow-sm hover:opacity-90"
        >
          <Plus className="w-4 h-4" /> New Policy
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
        {isLoading ? (
          <div className="col-span-full h-32 flex items-center justify-center text-muted-foreground">
            Loading...
          </div>
        ) : policyList.length === 0 ? (
          <div className="col-span-full rounded-2xl border border-dashed border-border bg-card/30 py-16 text-center text-muted-foreground text-sm">
            <p>No policies yet.</p>
            <button
              type="button"
              onClick={() => setIsDialogOpen(true)}
              className="mt-3 text-primary font-medium hover:underline"
            >
              Create your first policy
            </button>
          </div>
        ) : (
          policyList.map((policy) => (
            <div
              key={policy.id}
              className="bg-card border border-border p-6 rounded-2xl shadow-sm hover:border-primary/50 transition-all flex flex-col h-full"
            >
              <div className="flex justify-between items-start mb-4">
                <FileBadge className="w-8 h-8 text-primary/70" />
                <div className="text-[10px] text-muted-foreground font-mono bg-secondary px-2 py-1 rounded">
                  ID: {policy.id}
                </div>
              </div>
              <h3 className="text-lg font-bold mb-2">{policy.title}</h3>
              <p className="text-sm text-muted-foreground mb-4 flex-1 line-clamp-6 whitespace-pre-wrap">
                {policy.summary}
              </p>
              {(policy.attachments?.length ?? 0) > 0 ? (
                <div className="mb-4 rounded-xl border border-border/70 bg-secondary/20 px-3 py-2">
                  <p className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground mb-1.5">
                    Original documents
                  </p>
                  <ul className="space-y-1">
                    {policy.attachments!.map((a) => (
                      <li key={a.id}>
                        <a
                          href={`/api/policies/${policy.id}/attachments/${a.id}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="inline-flex items-center gap-2 text-sm text-primary hover:underline min-w-0 w-full"
                        >
                          <FileText className="w-3.5 h-3.5 shrink-0" aria-hidden />
                          <span className="truncate min-w-0" title={a.filename}>
                            {a.filename}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                            {a.size < 1024
                              ? `${a.size} B`
                              : `${(a.size / 1024).toFixed(a.size < 10240 ? 1 : 0)} KB`}
                          </span>
                        </a>
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
              <div className="text-xs text-muted-foreground pt-4 border-t border-border/50 mt-auto">
                Created {format(new Date(policy.createdAt), "MMM d, yyyy")}
              </div>
            </div>
          ))
        )}
      </div>

      {isDialogOpen && (
        <div className="fixed inset-0 bg-background/80 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <motion.div
            initial={{ scale: 0.95, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            className="bg-card border border-border shadow-2xl rounded-2xl w-full max-w-lg overflow-hidden max-h-[90vh] flex flex-col"
          >
            <div className="p-6 border-b border-border flex justify-between items-center shrink-0">
              <h2 className="text-xl font-bold">New policy</h2>
              <button
                type="button"
                onClick={resetDialog}
                className="text-muted-foreground hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <form
              onSubmit={handleSubmit}
              className="p-6 space-y-4 overflow-y-auto flex-1 min-h-0"
            >
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-muted-foreground"
                  htmlFor="policy-title"
                >
                  Title
                </label>
                <input
                  id="policy-title"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50"
                  placeholder="e.g. Universal basic income pilot"
                />
              </div>
              <div className="space-y-1.5">
                <label
                  className="text-sm font-medium text-muted-foreground"
                  htmlFor="policy-summary"
                >
                  Summary{" "}
                  <span className="font-normal text-muted-foreground/80">
                    (optional if you upload documents)
                  </span>
                </label>
                <textarea
                  id="policy-summary"
                  value={summary}
                  onChange={(e) => setSummary(e.target.value)}
                  rows={4}
                  className="w-full bg-secondary/50 border border-border rounded-xl px-3 py-2 text-sm focus:outline-none focus:border-primary focus:ring-1 focus:ring-primary/50 min-h-[100px] resize-y"
                  placeholder="Short description, or leave blank and rely on file text…"
                />
              </div>

              <div className="space-y-2">
                <span className="text-sm font-medium text-muted-foreground">
                  Documents
                </span>
                <p className="text-xs text-muted-foreground">
                  PDF, Word (.docx), Markdown, or plain text — up to 10 MB each. Legacy{" "}
                  <code className="text-[10px]">.doc</code> is not supported; use .docx or PDF.
                  With Vertex AI configured, PDFs are sent page-by-page as images to Gemini; other
                  text formats are processed in sections with live progress below.
                </p>
                <label className="flex items-start gap-2 text-xs text-muted-foreground cursor-pointer">
                  <input
                    type="checkbox"
                    checked={localExtractionOnly}
                    onChange={(e) => setLocalExtractionOnly(e.target.checked)}
                    className="mt-0.5 rounded border-border"
                  />
                  <span>
                    Local extraction only (skip Vertex AI — uses pypdf / python-docx on the server)
                  </span>
                </label>

                <div
                  className="rounded-xl border border-border bg-secondary/25 p-3 min-h-[4.5rem]"
                  aria-live="polite"
                  aria-label="Selected documents"
                >
                  <p className="text-[11px] font-medium text-foreground/90 mb-2">
                    {files.length === 0
                      ? "No files attached yet"
                      : `${files.length} file${files.length === 1 ? "" : "s"} attached`}
                  </p>
                  {files.length > 0 ? (
                    <ul className="space-y-1.5 max-h-40 overflow-y-auto pr-0.5">
                      {files.map((f, i) => (
                        <li
                          key={fileRowKey(f, i)}
                          className="flex items-center gap-2 text-xs rounded-lg bg-background/60 border border-border/60 px-2 py-1.5"
                        >
                          <span
                            className="min-w-0 flex-1 truncate font-mono text-foreground/90"
                            title={f.name}
                          >
                            {f.name}
                          </span>
                          <span className="shrink-0 text-[10px] text-muted-foreground tabular-nums">
                            {(f.size / 1024).toFixed(f.size < 10240 ? 1 : 0)} KB
                          </span>
                          <button
                            type="button"
                            onClick={() => removeFile(i)}
                            className="shrink-0 rounded-lg p-1 text-muted-foreground hover:bg-destructive/15 hover:text-destructive"
                            aria-label={`Remove ${f.name}`}
                          >
                            <X className="w-3.5 h-3.5" />
                          </button>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Use the button below to pick PDF, Word, Markdown, or text files.
                    </p>
                  )}
                </div>

                <input
                  id={POLICY_FILE_INPUT_ID}
                  ref={fileInputRef}
                  type="file"
                  multiple
                  accept={ACCEPT}
                  className="sr-only"
                  onChange={onFileChange}
                  aria-label="Choose policy documents"
                />
                <label
                  htmlFor={POLICY_FILE_INPUT_ID}
                  className="inline-flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-border bg-secondary/30 px-4 py-3 text-sm font-medium text-muted-foreground hover:border-primary/50 hover:bg-secondary/50 hover:text-foreground transition-colors w-full justify-center"
                >
                  <Paperclip className="w-4 h-4 shrink-0" aria-hidden />
                  {files.length === 0 ? "Choose files" : "Add more files"}
                </label>
              </div>

              {uploadStatus && savePolicy.isPending && files.length > 0 ? (
                <div
                  className="rounded-xl border border-border/80 bg-secondary/30 px-3 py-2 text-xs font-mono text-muted-foreground break-words"
                  role="status"
                  aria-live="polite"
                >
                  {uploadStatus}
                </div>
              ) : null}

              <div className="flex justify-end gap-3 pt-4 border-t border-border/50 shrink-0">
                <button
                  type="button"
                  onClick={resetDialog}
                  className="px-4 py-2 rounded-xl text-sm font-medium text-muted-foreground hover:bg-secondary transition-colors"
                  disabled={savePolicy.isPending}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={savePolicy.isPending}
                  className="px-6 py-2 bg-primary text-primary-foreground rounded-xl text-sm font-medium hover:opacity-90 disabled:opacity-50"
                >
                  {savePolicy.isPending && files.length > 0
                    ? "Processing…"
                    : savePolicy.isPending
                      ? "Saving…"
                      : "Create policy"}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
}
