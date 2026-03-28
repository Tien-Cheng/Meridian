"use client";

import { useAuthActions } from "@convex-dev/auth/react";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function SignIn() {
  const { signIn } = useAuthActions();
  const [flow, setFlow] = useState<"signIn" | "signUp">("signIn");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  return (
    <div className="flex flex-col gap-8 w-full max-w-md mx-auto h-screen justify-center items-center px-4">
      <div className="text-center flex flex-col items-center gap-4">
        <h1 className="text-3xl font-mono font-bold tracking-widest text-amber-500">
          MERIDIAN
        </h1>
        <p className="text-zinc-500 font-mono text-sm">
          GEOSPATIAL INVESTIGATION CONSOLE
        </p>
      </div>
      <form
        className="flex flex-col gap-4 w-full bg-zinc-900 p-8 border border-zinc-800"
        onSubmit={(e) => {
          e.preventDefault();
          setLoading(true);
          setError(null);
          const formData = new FormData(e.target as HTMLFormElement);
          formData.set("flow", flow);
          void signIn("password", formData)
            .catch((error) => {
              setError(error.message);
              setLoading(false);
            })
            .then(() => {
              router.push("/");
            });
        }}
      >
        <input
          className="bg-zinc-950 text-zinc-100 p-3 border border-zinc-800 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 outline-none transition-all placeholder:text-zinc-600 font-mono text-sm"
          type="email"
          name="email"
          placeholder="Email"
          required
        />
        <div className="flex flex-col gap-1">
          <input
            className="bg-zinc-950 text-zinc-100 p-3 border border-zinc-800 focus:border-amber-500/50 focus:ring-1 focus:ring-amber-500/30 outline-none transition-all placeholder:text-zinc-600 font-mono text-sm"
            type="password"
            name="password"
            placeholder="Password"
            minLength={8}
            required
          />
          {flow === "signUp" && (
            <p className="text-xs text-zinc-500 px-1 font-mono">
              Min 8 characters
            </p>
          )}
        </div>
        <button
          className="bg-amber-500 hover:bg-amber-400 text-zinc-950 font-mono font-bold py-3 transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed text-sm tracking-wider"
          type="submit"
          disabled={loading}
        >
          {loading
            ? "AUTHENTICATING..."
            : flow === "signIn"
              ? "SIGN IN"
              : "SIGN UP"}
        </button>
        <div className="flex flex-row gap-2 text-sm justify-center font-mono">
          <span className="text-zinc-500">
            {flow === "signIn"
              ? "No account?"
              : "Already registered?"}
          </span>
          <span
            className="text-amber-500 hover:text-amber-400 cursor-pointer transition-colors"
            onClick={() => setFlow(flow === "signIn" ? "signUp" : "signIn")}
          >
            {flow === "signIn" ? "Sign up" : "Sign in"}
          </span>
        </div>
        {error && (
          <div className="bg-red-500/10 border border-red-500/30 p-3">
            <p className="text-red-400 font-mono text-xs">
              ERROR: {error}
            </p>
          </div>
        )}
      </form>
    </div>
  );
}
