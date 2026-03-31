import { useMemo, useRef, useState } from "react";
import { useListPolicies, createPolicy, type Policy } from "@workspace/api-client-react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FileBadge, FileText, Paperclip, Plus, X, Library } from "lucide-react";
import { format } from "date-fns";
import { motion } from "framer-motion";
import { normalizeApiArray, cn } from "@/lib/utils";
import { toast } from "@/hooks/use-toast";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

// Include application/octet-stream — Windows often labels .md as binary in the file picker filter
const ACCEPT =
  ".pdf,.docx,.doc,.md,.markdown,.txt,.text,application/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/markdown,text/plain,application/octet-stream";

const POLICY_FILE_INPUT_ID = "policy-file-upload";

export default function Policies() {
  const queryClient = useQueryClient();
  const { data: policies, isLoading } = useListPolicies();
  const policyList = normalizeApiArray<Policy>(policies);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stats = useMemo(() => {
    const total = policyList.length;
    const withAttachments = policyList.filter(
      (p) => (p.attachments?.length ?? 0) > 0,
    ).length;
    const fileCount = policyList.reduce(
      (acc, p) => acc + (p.attachments?.length ?? 0),
      0,
    );
    return { total, withAttachments, fileCount };
  }, [policyList]);

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

  const container = {
    hidden: { opacity: 0 },
    show: { opacity: 1, transition: { staggerChildren: 0.06 } },
  };
  const item = {
    hidden: { opacity: 0, y: 16 },
    show: {
      opacity: 1,
      y: 0,
      transition: { type: "spring" as const, stiffness: 380, damping: 28 },
    },
  };

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
        <div className="relative min-w-0">
          <div className="mb-2 inline-flex items-center gap-2 rounded-full border border-border/60 bg-card/60 px-3 py-1 text-xs font-medium text-muted-foreground backdrop-blur-sm">
            <Library className="h-3.5 w-3.5 text-primary" aria-hidden />
            Policy library
          </div>
          <h1 className="text-3xl font-bold tracking-tight bg-clip-text text-transparent bg-gradient-to-r from-white to-white/55 md:text-4xl">
            Policies
          </h1>
          <p className="mt-2 max-w-xl text-muted-foreground">
            Foundational documents and summaries that ground simulation logic. Upload source files
            or write a concise brief — both can inform how agents interpret the policy.
          </p>
        </div>
        <Button
          size="lg"
          className="h-11 shrink-0 rounded-xl shadow-[0_0_24px_-6px_var(--color-primary)] transition-transform hover:-translate-y-0.5"
          onClick={() => setIsDialogOpen(true)}
        >
          <Plus className="h-5 w-5" />
          New policy
        </Button>
      </div>

      <motion.div
        variants={container}
        initial="hidden"
        animate="show"
        className="grid grid-cols-1 gap-4 sm:grid-cols-3"
      >
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-primary/40"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <FileBadge className="h-24 w-24 text-primary" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Total policies
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.total}
          </p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-accent/40"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <Paperclip className="h-24 w-24 text-accent" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            With source files
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.withAttachments}
          </p>
        </motion.div>
        <motion.div
          variants={item}
          className="relative overflow-hidden rounded-2xl border border-border/50 bg-card/70 p-5 shadow-sm backdrop-blur-sm transition-colors hover:border-emerald-500/35"
        >
          <div className="pointer-events-none absolute -right-2 -top-2 opacity-[0.07]">
            <FileText className="h-24 w-24 text-emerald-500" aria-hidden />
          </div>
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Linked documents
          </p>
          <p className="mt-1 text-3xl font-bold tabular-nums text-foreground">
            {isLoading ? "—" : stats.fileCount}
          </p>
        </motion.div>
      </motion.div>

      <div className="rounded-2xl border border-border/50 bg-card/50 p-4 shadow-lg backdrop-blur-md md:p-6">
        <div className="mb-5 flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h2 className="text-lg font-semibold tracking-tight text-foreground">Your policies</h2>
            <p className="text-sm text-muted-foreground">
              Summaries, IDs, and downloadable originals for each policy.
            </p>
          </div>
        </div>

        {isLoading ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
            {[0, 1, 2].map((i) => (
              <div
                key={i}
                className="animate-pulse rounded-2xl border border-border/40 bg-secondary/20 p-5"
              >
                <div className="flex justify-between gap-3">
                  <div className="h-9 w-9 rounded-xl bg-secondary/60" />
                  <div className="h-5 w-14 rounded-md bg-secondary/50" />
                </div>
                <div className="mt-4 h-5 w-4/5 rounded-md bg-secondary/60" />
                <div className="mt-3 h-3 w-full rounded bg-secondary/40" />
                <div className="mt-2 h-3 w-11/12 rounded bg-secondary/35" />
                <div className="mt-6 h-px w-full bg-secondary/50" />
                <div className="mt-3 h-3 w-28 rounded bg-secondary/40" />
              </div>
            ))}
          </div>
        ) : policyList.length === 0 ? (
          <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-border/70 bg-background/30 px-6 py-16 text-center">
            <div className="mb-4 flex h-14 w-14 items-center justify-center rounded-2xl border border-border/60 bg-card/80 shadow-inner">
              <FileBadge className="h-7 w-7 text-muted-foreground" aria-hidden />
            </div>
            <p className="text-lg font-medium text-foreground">No policies yet</p>
            <p className="mt-1 max-w-sm text-sm text-muted-foreground">
              Add a written summary, upload PDFs or Markdown, or both — then use these policies when
              you configure simulations.
            </p>
            <Button className="mt-6 rounded-xl" onClick={() => setIsDialogOpen(true)}>
              <Plus className="h-4 w-4" />
              New policy
            </Button>
          </div>
        ) : (
          <motion.div
            variants={container}
            initial="hidden"
            animate="show"
            className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3"
          >
            {policyList.map((policy) => (
              <motion.article
                key={policy.id}
                variants={item}
                className="group relative flex flex-col overflow-hidden rounded-2xl border border-border/60 bg-card/80 p-5 shadow-sm transition-all duration-200 hover:border-primary/35 hover:shadow-md hover:shadow-primary/[0.06]"
              >
                <div className="pointer-events-none absolute -right-6 -top-6 h-28 w-28 rounded-full bg-primary/[0.06] blur-2xl transition-opacity group-hover:opacity-100 opacity-70" />
                <div className="relative flex items-start justify-between gap-3">
                  <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-xl border border-border/50 bg-primary/10 text-primary shadow-inner">
                    <FileBadge className="h-5 w-5" aria-hidden />
                  </div>
                  <span className="shrink-0 rounded-full border border-border/60 bg-secondary/40 px-2.5 py-0.5 font-mono text-[10px] font-medium tabular-nums text-muted-foreground">
                    #{policy.id}
                  </span>
                </div>
                <h3 className="relative mt-4 text-base font-semibold leading-snug tracking-tight text-foreground">
                  {policy.title}
                </h3>
                <p className="relative mt-2 flex-1 text-sm leading-relaxed text-muted-foreground line-clamp-6 whitespace-pre-wrap">
                  {policy.summary}
                </p>
                {(policy.attachments?.length ?? 0) > 0 ? (
                  <div className="relative mt-4 rounded-xl border border-border/50 bg-secondary/25 px-3 py-2.5">
                    <p className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
                      Original documents
                    </p>
                    <ul className="space-y-1">
                      {policy.attachments!.map((a) => (
                        <li key={a.id}>
                          <a
                            href={`/api/policies/${policy.id}/attachments/${a.id}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="inline-flex min-w-0 w-full items-center gap-2 rounded-lg py-0.5 text-sm text-primary transition-colors hover:text-primary/90 hover:underline"
                          >
                            <FileText className="h-3.5 w-3.5 shrink-0" aria-hidden />
                            <span className="min-w-0 flex-1 truncate" title={a.filename}>
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
                <div className="relative mt-4 border-t border-border/50 pt-3 text-xs text-muted-foreground">
                  Created {format(new Date(policy.createdAt), "MMM d, yyyy")}
                </div>
              </motion.article>
            ))}
          </motion.div>
        )}
      </div>

      <Dialog
        open={isDialogOpen}
        onOpenChange={(open) => {
          if (!open) resetDialog();
        }}
      >
        <DialogContent
          className={cn(
            "max-h-[90vh] max-w-lg gap-0 overflow-hidden rounded-2xl border-border/60 bg-card/95 p-0 shadow-2xl backdrop-blur-md",
            "flex flex-col",
          )}
        >
          <DialogHeader className="space-y-1 border-b border-border/60 p-6 pb-4 text-left">
            <DialogTitle className="text-xl font-bold tracking-tight">New policy</DialogTitle>
            <DialogDescription>
              Title is required. Add a summary, attach documents, or both.
            </DialogDescription>
          </DialogHeader>
          <form
            onSubmit={handleSubmit}
            className="flex min-h-0 flex-1 flex-col space-y-4 overflow-y-auto p-6 pt-5"
          >
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground" htmlFor="policy-title">
                Title
              </label>
              <Input
                id="policy-title"
                required
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                className="h-10 rounded-xl border-border/70 bg-secondary/40"
                placeholder="e.g. Universal basic income pilot"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-muted-foreground" htmlFor="policy-summary">
                Summary{" "}
                <span className="font-normal text-muted-foreground/80">
                  (optional if you upload documents)
                </span>
              </label>
              <Textarea
                id="policy-summary"
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                rows={4}
                className="min-h-[100px] resize-y rounded-xl border-border/70 bg-secondary/40"
                placeholder="Short description, or leave blank and rely on file text…"
              />
            </div>

            <div className="space-y-2">
              <span className="text-sm font-medium text-muted-foreground">Documents</span>
              <p className="text-xs text-muted-foreground leading-relaxed">
                PDF, Word (.docx), Markdown, or plain text — up to 10 MB each. Legacy{" "}
                <code className="text-[10px]">.doc</code> is not supported; use .docx or PDF. With
                Vertex AI configured, PDFs are sent page-by-page as images to Gemini; other text
                formats are processed in sections with live progress below.
              </p>
              <label className="flex cursor-pointer items-start gap-2 text-xs text-muted-foreground">
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
                className="min-h-[4.5rem] rounded-xl border border-border/60 bg-secondary/25 p-3"
                aria-live="polite"
                aria-label="Selected documents"
              >
                <p className="mb-2 text-[11px] font-medium text-foreground/90">
                  {files.length === 0
                    ? "No files attached yet"
                    : `${files.length} file${files.length === 1 ? "" : "s"} attached`}
                </p>
                {files.length > 0 ? (
                  <ul className="max-h-40 space-y-1.5 overflow-y-auto pr-0.5">
                    {files.map((f, i) => (
                      <li
                        key={fileRowKey(f, i)}
                        className="flex items-center gap-2 rounded-lg border border-border/60 bg-background/60 px-2 py-1.5 text-xs"
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
                          <X className="h-3.5 w-3.5" />
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
                className="inline-flex w-full cursor-pointer items-center justify-center gap-2 rounded-xl border border-dashed border-border/70 bg-secondary/30 px-4 py-3 text-sm font-medium text-muted-foreground transition-colors hover:border-primary/50 hover:bg-secondary/50 hover:text-foreground"
              >
                <Paperclip className="h-4 w-4 shrink-0" aria-hidden />
                {files.length === 0 ? "Choose files" : "Add more files"}
              </label>
            </div>

            {uploadStatus && savePolicy.isPending && files.length > 0 ? (
              <div
                className="rounded-xl border border-border/80 bg-secondary/30 px-3 py-2 font-mono text-xs text-muted-foreground break-words"
                role="status"
                aria-live="polite"
              >
                {uploadStatus}
              </div>
            ) : null}

            <DialogFooter className="gap-2 border-t border-border/50 pt-4 sm:gap-3">
              <Button
                type="button"
                variant="ghost"
                className="rounded-xl"
                onClick={resetDialog}
                disabled={savePolicy.isPending}
              >
                Cancel
              </Button>
              <Button type="submit" className="rounded-xl px-6" disabled={savePolicy.isPending}>
                {savePolicy.isPending && files.length > 0
                  ? "Processing…"
                  : savePolicy.isPending
                    ? "Saving…"
                    : "Create policy"}
              </Button>
            </DialogFooter>
          </form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
