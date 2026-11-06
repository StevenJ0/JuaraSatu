import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { CampaignSimulator } from "@/features/campaign-simulator/components/campaign-simulator";
import LoadingSimulator from "./preview-loading";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Simulator campaign — Preview development",
  robots: { index: false, follow: false },
};

export default function SimulatorPreviewPage() {
  if (process.env.NODE_ENV !== "development") notFound();
  return <Suspense fallback={<LoadingSimulator />}><DevelopmentSimulator /></Suspense>;
}

async function DevelopmentSimulator() {
  const { developmentFacts } = await import("@/features/campaign-simulator/development-fixtures");
  return <CampaignSimulator facts={developmentFacts} />;
}
