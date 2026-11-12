import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";
import WebThreads from "../../../@/components/WebThreads";

export default function LoginPage() {
  const navigate = useNavigate();
  const { login } = useAuth();

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setError("");
    setIsLoading(true);

    try {
      const loggedInUser = await login({ email, password });

      if (
        loggedInUser.userType === "admin" ||
        loggedInUser.userType === "superAdmin"
      ) {
        navigate("/admin");
      } else if (loggedInUser.userType === "supervisor") {
        navigate("/supervisor");
      } else if (loggedInUser.userType === "employee") {
        navigate("/employee");
      } else if (loggedInUser.userType === "customer") {
        navigate("/customer");
      } else {
        setError("Unknown user role.");
      }
    } catch (error: any) {
      setError(
        error?.response?.data?.message ||
          "Login failed. Please check your email and password.",
      );
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-[#071426] px-4 py-8">
      {/* Animated background */}
      <div
        className="pointer-events-none absolute inset-0 z-0"
        aria-hidden="true"
      >
        <WebThreads
          colors={["#F59E0B", "#244B83"]}
          coreColor="#FFFFFF"
          threadCount={6}
          spread={0.18}
          lightMode={false}
          speed={0.2}
          frequency={5}
          taper={1}
          position={0.5}
          pinch={0.5}
          nodes={1}
          angle={0}
          glow={0.02}
          falloff={0.6}
          thickness={1.1}
          brightness={0.6}
          opacity={1}
          depth={0}
          pulses={0}
          mirror
          shimmer={false}
          fade={0}
          grain={0.05}
          intro
          mouseInteraction
          mouseStrength={0.5}
          pulseOnClick
          paused={false}
        />
      </div>

      {/* Login content */}
      <div className="relative z-10 w-full max-w-md">
        {/* Branding */}
        <div className="mb-7 text-center text-white">
          <h1 className="text-3xl font-bold tracking-wide">
            <span className="text-orange-400">SEN</span>THUR
            <span className="ml-2 font-light">ENGINEERING</span>
          </h1>

          <p className="mt-2 text-sm tracking-widest text-slate-300">
            ATM MAINTENANCE MANAGEMENT
          </p>
        </div>

        {/* Login card */}
        <form
          onSubmit={handleSubmit}
          className="space-y-6 rounded-2xl border border-white/15 bg-[#10243a]/15 p-7 shadow-2xl backdrop-blur-[10px] sm:p-9"
        >
          <div className="text-center">
            <h2 className="text-2xl font-bold text-white">Welcome Back</h2>
            <p className="mt-2 text-sm text-slate-300">Login to your account</p>
          </div>

          {error && (
            <div className="rounded-md border border-red-400/40 bg-red-500/10 p-3 text-sm text-red-300">
              {error}
            </div>
          )}

          <div className="space-y-2">
            <label
              htmlFor="email"
              className="text-sm font-medium text-slate-200"
            >
              Email
            </label>

            <input
              id="email"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="Enter your email"
              required
              autoComplete="username"
              className="w-full rounded-lg border border-white/15 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-white focus:border-orange-400 focus:ring-1 focus:ring-orange-400 font-bold backdrop-blur-2xl"
            />
          </div>

          <div className="space-y-2">
            <label
              htmlFor="password"
              className="text-sm font-medium text-slate-200"
            >
              Password
            </label>

            <input
              id="password"
              type="password"
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              placeholder="Enter your password"
              required
              minLength={8}
              autoComplete="current-password"
              className="w-full rounded-lg border border-white/15 bg-white/10 px-4 py-3 text-white outline-none placeholder:text-white focus:border-orange-400 focus:ring-1 focus:ring-orange-400 font-bold backdrop-blur-2xl"
            />
          </div>

          <button
            type="submit"
            disabled={isLoading}
            className="w-full rounded-lg bg-orange-500 px-4 py-3 font-semibold text-white transition-colors hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {isLoading ? "Logging in..." : "Sign In"}
          </button>
        </form>

        <p className="mt-6 text-center text-xs text-slate-400">
          Powered by Senthur Engineering
        </p>
      </div>
    </main>
  );
}
