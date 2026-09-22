import Link from "next/link";

export default function Home() {
  return (
    <div className="flex flex-1 flex-col items-center justify-center bg-page">
      <main className="flex w-full max-w-md flex-col items-center gap-6 px-6 text-center">
        <h1 className="text-2xl font-bold text-ink">AquaFix Master Data</h1>
        <p className="text-sm text-muted">
          Sign in to manage master-file data and user access.
        </p>
        <Link
          href="/login"
          className="rounded-control bg-primary px-5 py-2.5 text-sm font-semibold text-white transition-colors hover:bg-primary-hover"
        >
          Sign in
        </Link>
      </main>
    </div>
  );
}
