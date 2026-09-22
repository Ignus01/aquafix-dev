export default function UnauthorizedPage() {
  return (
    <div className="flex flex-1 items-center justify-center px-4">
      <div className="text-center">
        <h1 className="mb-2 text-xl font-bold text-ink">Not authorized</h1>
        <p className="text-sm text-muted">
          Your account doesn&apos;t have the system_admin role required for
          this page.
        </p>
      </div>
    </div>
  );
}
