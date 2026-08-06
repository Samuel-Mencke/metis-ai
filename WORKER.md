# Durable agent worker

The web service accepts durable jobs at `POST /api/runs`; jobs and checkpoints are
stored below `CHAT_DATA_DIR` (default: `data/`). The worker processes up to four
jobs in parallel by default (`AI_CHAT_WORKER_CONCURRENCY`), and recovers stale
`running` jobs after a process restart.

The native installer can generate and install the worker service:

```sh
./scripts/install.sh --non-interactive --yes \
  --install-dir /opt/metis-ai \
  --data-dir /var/lib/metis-ai \
  --enable-service
```

The installer replaces the placeholders in
`deploy/metis-ai-worker.service` with the target user, application directory,
and environment file. If installing manually, keep `ai-chat.service` for the
Next.js web/API process and do not restart unrelated services. The worker
requires `CURSOR_API_KEY`, the same `CHAT_DATA_DIR`, and the agent workspace
settings used by the web service.
