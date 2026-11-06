import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DiscussionWorkspace } from "@/features/campaign-strategist/components/discussion-workspace";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Diskusi campaign — Development", robots: { index: false, follow: false } };
export default function DiscussionPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <DiscussionWorkspace />;
}
