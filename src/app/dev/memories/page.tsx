import { notFound } from "next/navigation";
import { MemoryWorkspace } from "@/features/business-memory/components/memory-workspace";
export default function MemoryPage(){if(process.env.NODE_ENV!=="development")notFound();return <MemoryWorkspace/>;}
