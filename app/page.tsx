// app/page.tsx
export const dynamic = "force-dynamic";
export const revalidate = 0;

import EvaluatorClient from "./EvaluatorClient";

export default function Home() {
  return <EvaluatorClient />;
}
