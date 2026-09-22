import LoginForm from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-page px-4">
      <div className="w-full max-w-sm rounded-card border border-border bg-card p-8">
        <h1 className="mb-1 text-xl font-bold text-ink">Sign in</h1>
        <p className="mb-6 text-sm text-muted">
          AquaFix master data administration
        </p>
        <LoginForm next={next ?? "/admin/masterdata"} />
      </div>
    </div>
  );
}
