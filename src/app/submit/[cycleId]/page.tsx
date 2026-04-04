import IntakeForm from "./IntakeForm";

export default async function SubmitPage({
  params,
}: {
  params: Promise<{ cycleId: string }>;
}) {
  const { cycleId } = await params;

  return (
    <main id="main-content" className="min-h-screen bg-zinc-50">
      <IntakeForm cycleId={cycleId} />
    </main>
  );
}
