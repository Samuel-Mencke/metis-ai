import { notFound } from "next/navigation";
import JailbreakLibrary from "@/components/jailbreak-library";
import { isUncensoredEnabled } from "@/lib/feature-flags";

export const dynamic = "force-dynamic";

export default function JailbreaksPage() {
  if (!isUncensoredEnabled()) notFound();
  return <JailbreakLibrary />;
}
