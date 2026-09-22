export default function UnauthorizedPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="text-center">
        <h1 className="mb-2 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          Not authorized
        </h1>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Your account doesn&apos;t have the system_admin role required for
          this page.
        </p>
      </div>
    </div>
  );
}
