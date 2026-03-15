import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";

export default async function Home() {
  const user = await getSessionUser();
  if (user) {
    if (user.must_change_password) {
      redirect("/change-password");
    }
    const { canAccessAdmin } = await import("@/lib/admin");
    const hasAdminAccess = await canAccessAdmin(user.id, user.is_platform_admin);
    redirect(hasAdminAccess ? "/admin" : "/reviewer");
  }
  redirect("/login");
}
