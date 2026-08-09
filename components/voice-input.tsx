"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { LoaderCircle, Mic, RotateCcw, Square, X } from "lucide-react";
import { Button } from "@/components/ui/button";

type VoiceInputProps = {
  chatId?: string | null;
  onTranscript: (text: string) => void;
  enabled?: boolean;
  maxDurationSeconds?: number;
};

type VoiceState = "idle" | "permission" | "recording" | "uploading" | "transcribing" | "ready" | "error";

export function VoiceInput({ chatId, onTranscript, enabled = true, maxDurationSeconds }: VoiceInputProps) {
  const [state, setState] = useState<VoiceState>("idle");
  const [error, setError] = useState("");
  const [elapsed, setElapsed] = useState(0);
  const [maxDuration, setMaxDuration] = useState(300);
  const [lastRecording, setLastRecording] = useState<{ blob: Blob; duration: number } | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const startedAtRef = useRef(0);
  const stop = useCallback(() => {
    const recorder = recorderRef.current;
    if (!recorder || recorder.state === "inactive") return;
    recorder.stop();
  }, []);

  useEffect(() => {
    if (typeof maxDurationSeconds === "number") {
      setMaxDuration(Math.max(1, Math.min(3600, Math.floor(maxDurationSeconds))));
      return;
    }
    void fetch("/api/preferences", { cache: "no-store" })
      .then((response) => response.json())
      .then((body) => {
        const value = body.settings?.voiceInput?.maxDurationSeconds;
        if (typeof value === "number" && Number.isFinite(value)) setMaxDuration(Math.max(1, Math.min(3600, Math.floor(value))));
      })
      .catch(() => undefined);
  }, [maxDurationSeconds]);

  useEffect(() => {
    if (state !== "recording") return;
    const timer = window.setInterval(() => {
      const seconds = Math.floor((Date.now() - startedAtRef.current) / 1_000);
      setElapsed(seconds);
      if (seconds >= maxDuration) stop();
    }, 250);
    return () => window.clearInterval(timer);
  }, [state, maxDuration, stop]);

  const cleanup = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    recorderRef.current = null;
  }, []);

  const transcribe = useCallback(async (blob: Blob, duration: number) => {
    setState("uploading");
    setError("");
    const form = new FormData();
    form.append("file", blob, `recording-${Date.now()}.webm`);
    form.append("durationSeconds", String(duration));
    if (chatId) form.append("chatId", chatId);
    setState("transcribing");
    try {
      const response = await fetch("/api/voice/transcribe", {
        method: "POST",
        headers: { "Idempotency-Key": `${Date.now()}-${Math.random()}` },
        body: form,
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok || typeof body.transcript !== "string") throw new Error(body.error || "Transcription failed.");
      onTranscript(body.transcript);
      setState("ready");
    } catch (cause) {
      setState("error");
      setError(cause instanceof Error ? cause.message : "Transcription failed.");
    }
  }, [chatId, onTranscript]);

  const start = async () => {
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
      setState("error");
      setError("This browser does not support microphone recording.");
      return;
    }
    setState("permission");
    setError("");
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      chunksRef.current = [];
      const recorder = new MediaRecorder(stream);
      recorderRef.current = recorder;
      startedAtRef.current = Date.now();
      setElapsed(0);
      recorder.ondataavailable = (event) => {
        if (event.data.size) chunksRef.current.push(event.data);
      };
      recorder.onstop = () => {
        const duration = Math.max(1, Math.min(maxDuration, Math.floor((Date.now() - startedAtRef.current) / 1_000)));
        const blob = new Blob(chunksRef.current, { type: recorder.mimeType || "audio/webm" });
        cleanup();
        setLastRecording({ blob, duration });
        void transcribe(blob, duration);
      };
      recorder.start(250);
      setState("recording");
    } catch (cause) {
      cleanup();
      setState("error");
      setError(cause instanceof Error ? cause.message : "Microphone permission was denied.");
    }
  };

  const discard = () => {
    if (recorderRef.current?.state === "recording") recorderRef.current.stop();
    cleanup();
    setLastRecording(null);
    setElapsed(0);
    setError("");
    setState("idle");
  };

  if (!enabled) return null;

  return (
    <div className="flex items-center gap-1">
      {state === "recording" ? (
        <Button type="button" size="icon" variant="destructive" className="size-9 shrink-0 rounded-full" onClick={stop} aria-label="Stop recording" title={`Stop recording (${elapsed}s / ${maxDuration}s)`}>
          <Square className="size-3.5 fill-current" />
        </Button>
      ) : (
        <Button type="button" size="icon" variant="ghost" className="size-9 shrink-0 rounded-full" onClick={() => void start()} disabled={["permission", "uploading", "transcribing"].includes(state)} aria-label="Record voice input" title="Record voice input">
          <Mic className="size-4" />
        </Button>
      )}
      {state === "recording" ? <span className="text-[10px] tabular-nums text-red-400">{elapsed}s</span> : null}
      {state === "permission" || state === "uploading" || state === "transcribing" ? <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" aria-label={state} /> : null}
      {state === "ready" ? <span className="text-[10px] text-emerald-500">Draft inserted</span> : null}
      {state === "error" ? (
        <>
          <span className="max-w-40 truncate text-[10px] text-destructive" title={error}>{error}</span>
          {lastRecording ? <Button type="button" size="icon-xs" variant="ghost" onClick={() => void transcribe(lastRecording.blob, lastRecording.duration)} aria-label="Retry transcription"><RotateCcw className="size-3.5" /></Button> : null}
          <Button type="button" size="icon-xs" variant="ghost" onClick={discard} aria-label="Discard recording"><X className="size-3.5" /></Button>
        </>
      ) : null}
    </div>
  );
}
