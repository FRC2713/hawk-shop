import { isOnshapeAuthenticated } from "~/lib/onshapeAuth";
import { MainLayoutClient } from "./layout-client";

export default async function MainLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const onshapeAuth = await isOnshapeAuthenticated();

  return (
    <MainLayoutClient isAuthenticated={onshapeAuth} onshapeAuth={onshapeAuth}>
      {children}
    </MainLayoutClient>
  );
}
