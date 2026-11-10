import { redirect } from "next/navigation";

/** Account creation now starts with choosing applications (organization + subscription are created together). */
export default function RegisterPage() {
  redirect("/trial");
}
