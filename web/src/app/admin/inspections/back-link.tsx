import Link from "next/link";
import { ChevronLeftIcon } from "../icons";

// "‹ Instructions" above a record's page.
export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link href={href} className="inline-flex w-fit items-center gap-1 text-[13px] font-medium text-muted hover:text-ink">
      <ChevronLeftIcon className="h-4 w-4" />
      {label}
    </Link>
  );
}
