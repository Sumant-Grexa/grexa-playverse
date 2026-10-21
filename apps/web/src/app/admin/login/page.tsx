import { login } from "@/lib/actions/admin";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ error?: string }>;
}) {
  const params = await searchParams;
  return (
    <main className="mx-auto flex min-h-screen max-w-md flex-col justify-center px-4">
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src="/brand/logo.png" alt="Grexa Playverse" className="h-24 w-auto" />
      <h1 className="pixel-label mt-6 text-bid">Admin</h1>
      <p className="mt-3 text-mist/80">The projector board stays open. This password runs the auction.</p>
      <form action={login} className="arcade-panel mt-8 p-6">
        <label className="block">
          <span className="pixel-label text-gold">Password</span>
          <input name="password" type="password" required autoFocus className="field" />
        </label>
        {params.error ? <p className="mt-3 text-gold">That password did not match.</p> : null}
        <button type="submit" className="btn btn-cyan mt-5">
          Enter
        </button>
      </form>
    </main>
  );
}
