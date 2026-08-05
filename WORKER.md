# Durable agent worker

The web service accepts durable jobs at `POST /api/runs`; jobs and checkpoints are
stored below `CHAT_DATA_DIR` (default: `data/`). The worker processes up to four
jobs in parallel by default (`AI_CHAT_WORKER_CONCURRENCY`), and recovers stale
`running` jobs after a process restart.

Install the service definition without enabling it until validation is complete:

```sh
sudo cp deploy/ai-chat-worker.service /etc/systemd/system/ai-chat-worker.service
sudo systemctl daemon-reload
sudo systemctl enable --now ai-chat-worker.service
```

Keep `ai-chat.service` for the Next.js web/API process. Do not restart unrelated
services. The worker requires `CURSOR_API_KEY`, the same `CHAT_DATA_DIR`, and
the agent workspace settings used by the web service.
