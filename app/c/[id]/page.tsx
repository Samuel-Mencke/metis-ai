import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

/** Legacy /c/[id] → /?c=[id] */
export default async function ChatRedirectPage({ params }: Props) {
  const { id } = await params;
  redirect(`/?c=${encodeURIComponent(id)}`);
}
