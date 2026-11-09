/** Exchange only a popup code and proof; Suite tokens remain HttpOnly. */
export async function connectEmbeddedSession(code: string, verifier: string) {
  const response = await fetch("/auth/embed/exchange", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ code, verifier }),
  });
  if (!response.ok) throw new Error("Exchange failed");
  // Detect blocked cookies without navigating the frame into Suite's login.
  const session = await fetch("/auth/embed/session", { redirect: "manual" });
  return session.status === 204;
}
