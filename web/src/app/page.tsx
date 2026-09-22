import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-zinc-50 font-sans dark:bg-black">
      <main className="flex w-full max-w-md flex-col items-center gap-6 px-6 text-center">
        <h1 className="text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
          AquaFix Master Data
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Sign in to manage master-file data and user access.
        </p>
        <Link
          href="/login"
          className="rounded-full bg-foreground px-5 py-2.5 text-sm font-medium text-background transition-colors hover:bg-[#383838] dark:hover:bg-[#ccc]"
        >
          Sign in
        </Link>
      </main>
    </div>
  );
}
