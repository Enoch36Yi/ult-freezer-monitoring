import { notFound } from "next/navigation";
import { FreezerDetail } from "@/components/FreezerDetail";
import { FREEZER_IDS, FREEZER_ID_MAX, FREEZER_ID_MIN } from "@/lib/types";

export function generateStaticParams() {
  return FREEZER_IDS.map((id) => ({ id: String(id) }));
}

export default async function FreezerPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const freezerId = Number(id);

  // The same 1–21 bound the table's check constraint enforces.
  if (
    !Number.isInteger(freezerId) ||
    freezerId < FREEZER_ID_MIN ||
    freezerId > FREEZER_ID_MAX
  ) {
    notFound();
  }

  return <FreezerDetail freezerId={freezerId} />;
}
