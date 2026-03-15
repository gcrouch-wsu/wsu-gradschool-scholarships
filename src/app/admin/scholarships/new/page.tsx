import { redirect } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { NewProgramForm } from "./NewProgramForm";

export default async function NewProgramPage() {
  const user = await getSessionUser();
  if (!user?.is_platform_admin) {
    redirect("/admin/scholarships");
  }
  return <NewProgramForm />;
}
