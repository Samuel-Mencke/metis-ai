export async function register() {
  if (process.env.NEXT_RUNTIME && process.env.NEXT_RUNTIME !== "nodejs") return;
  const { startControlRuntime } = await import("@/lib/control-runtime");
  startControlRuntime();
}
