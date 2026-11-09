import type { APIRoute } from "astro";
import { requireAuth } from "~/lib/requireAuth";
import { queueProblemReport } from "~/lib/slack/reports";

export const POST: APIRoute = async ({ request, locals }) => {
  const unauthorized = await requireAuth();
  if (unauthorized) return unauthorized;
  const expected = new URL(process.env.APP_URL || request.url).origin;
  if (
    request.headers.get("origin") !== expected ||
    !request.headers.get("content-type")?.startsWith("application/json")
  )
    return Response.json(
      { error: "Request origin is not allowed." },
      { status: 403 }
    );
  try {
    const body = await request.json();
    if (
      !body ||
      typeof body.message !== "string" ||
      !body.message.trim() ||
      body.message.length > 2000
    )
      return Response.json(
        { error: "Describe the problem in 1 to 2,000 characters." },
        { status: 400 }
      );
    const context =
      body.context &&
      typeof body.context === "object" &&
      !Array.isArray(body.context)
        ? body.context
        : {};
    return queueProblemReport(locals.identity!, body.message.trim(), context);
  } catch {
    return Response.json(
      { error: "Your report could not be saved. Please try again." },
      { status: 503 }
    );
  }
};
