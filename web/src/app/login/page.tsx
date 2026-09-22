import LoginForm from "./login-form";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;

  return (
    <div className="flex flex-1 items-center justify-center bg-zinc-50 px-4 dark:bg-black">
      <div className="w-full max-w-sm rounded-lg border border-black/[.08] bg-white p-8 dark:border-white/[.145] dark:bg-zinc-950">
        <h1 className="mb-1 text-xl font-semibold text-zinc-950 dark:text-zinc-50">
          Sign in
        </h1>
        <p className="mb-6 text-sm text-zinc-600 dark:text-zinc-400">
          AquaFix master data administration
        </p>
        <LoginForm next={next ?? "/admin/users"} />
      </div>
    </div>
  );
}
