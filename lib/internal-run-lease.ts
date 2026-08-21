import { isJobLeaseActive } from "@/lib/db-jobs";

export function internalRunLeaseAuthorized(req: Request, jobId: string) {
  const workerId = req.headers.get("x-ai-chat-worker-id")?.trim() || "";
  const leaseToken = req.headers.get("x-ai-chat-lease-token")?.trim() || "";
  // In-process route tests and local development do not have a worker lease.
  // Production gateway calls always carry both headers.
  if (!workerId || !leaseToken) return process.env.NODE_ENV !== "production";
  return isJobLeaseActive(jobId, workerId, leaseToken);
}
