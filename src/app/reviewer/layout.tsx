import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { SessionWarning } from "@/components/SessionWarning";

export default async function ReviewerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getSessionUser();
  if (!user) redirect("/login");
  if (user.must_change_password) redirect("/change-password");

  return (
    <>
      {children}
      <SessionWarning />
    </>
  );
}
