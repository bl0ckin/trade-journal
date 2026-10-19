"use client";

import { Suspense } from "react";
import { AiWorkspace } from "@/components/ai-chat";
import { FilterBar } from "@/components/filter-bar";
import Loading from "@/app/loading";

export default function AiPage() {
  return (
    <Suspense fallback={<Loading />}>
      <FilterBar title="AI" />
      <AiWorkspace />
    </Suspense>
  );
}
