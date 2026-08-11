import { NextRequest, NextResponse } from "next/server";
import { updateCard } from "~/lib/kanbanApi/cards";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const { assignee } = await request.json();

  console.log(`Assigning card ${id} to user ${assignee}`);
  const updatedCard = await updateCard(id, {
    assignee,
  });
  return NextResponse.json({ card: updatedCard });
}
