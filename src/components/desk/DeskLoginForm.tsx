"use client";

import { LockKeyhole } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, type FormEvent } from "react";
import { getBrowserSupabase } from "@/lib/supabase/browser";
import { Button, Card, Field, inputClass } from "../ui/primitives";

export function DeskLoginForm({ next }: { next: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError(null);
    const { error: authError } = await getBrowserSupabase().auth.signInWithPassword({
      email: email.trim(),
      password,
    });
    setLoading(false);
    if (authError) {
      setError(authError.message === "Invalid login credentials" ? "Wrong email or password." : authError.message);
      return;
    }
    router.replace(next);
    router.refresh();
  }

  return (
    <Card className="w-full max-w-sm p-6">
      <div className="mb-6 flex items-center gap-3">
        <span className="flex size-10 items-center justify-center rounded-xl bg-amber-500/10 text-amber-400">
          <LockKeyhole className="size-5" />
        </span>
        <div>
          <h1 className="text-lg font-bold">Quick-Desk</h1>
          <p className="text-sm text-zinc-500">Staff sign in</p>
        </div>
      </div>
      <form onSubmit={onSubmit} className="space-y-4">
        <Field label="Email" htmlFor="email">
          <input
            id="email"
            type="email"
            autoComplete="username"
            required
            className={inputClass}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
          />
        </Field>
        <Field label="Password" htmlFor="password">
          <input
            id="password"
            type="password"
            autoComplete="current-password"
            required
            className={inputClass}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
          />
        </Field>
        {error && <p className="text-sm text-rose-300">{error}</p>}
        <Button type="submit" size="lg" className="w-full" loading={loading}>
          Sign in
        </Button>
      </form>
    </Card>
  );
}
