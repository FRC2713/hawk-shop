import { NextRequest, NextResponse } from "next/server";
import { createCard, getCards, setCardProcesses } from "~/lib/kanbanApi/cards";

export async function GET(request: NextRequest) {
  try {
    const url = request.nextUrl;
    const columnId = url.searchParams.get("columnId");

    const result = await getCards();

    if (result.error) {
      console.error("[KANBAN CARDS] Error loading cards:", result.error);
      return NextResponse.json(
        { cards: [], error: result.error },
        { status: 500 }
      );
    }

    let cards = result.cards;

    // Filter by columnId if provided
    if (columnId) {
      cards = cards.filter((card) => card.column_id === columnId);
    }

    return NextResponse.json({ cards });
  } catch (error) {
    console.error("[KANBAN CARDS] Error loading cards:", error);
    return NextResponse.json({ cards: [] }, { status: 500 });
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();

    // Validate required field (only title is required)
    if (!body.title) {
      return NextResponse.json(
        { error: "Missing required field: title" },
        { status: 400 }
      );
    }

    // Create the card
    const newCard = await createCard({
      id: body.id,
      title: body.title,
      imageUrl: body.imageUrl,
      assignee: body.assignee,
      machine: body.machine,
      dueDate: body.dueDate,
      content: body.content,
      processIds: body.processIds || [],
      createdBy: body.createdBy,
    });

    return NextResponse.json({ card: newCard }, { status: 201 });
  } catch (error) {
    console.error("[KANBAN CARDS] Error creating card:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Failed to create card";
    return NextResponse.json({ error: errorMessage }, { status: 500 });
  }
}
