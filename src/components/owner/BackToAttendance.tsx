import { Link } from "@tanstack/react-router";
import { ArrowLeft } from "lucide-react";

/** Shared "Back to Attendance" link for attendance sub-pages. */
export function BackToAttendance() {
  return (
    <Link
      to="/owner/attendance"
      className="inline-flex min-h-12 items-center gap-2 rounded-md px-1 text-sm font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
    >
      <ArrowLeft className="h-4 w-4" />
      Back to Attendance
    </Link>
  );
}
