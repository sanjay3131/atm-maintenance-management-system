import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";

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
      const loggedInUser = await login({
        email,
        password,
      });

      if (
        loggedInUser.userType === "admin" ||
        loggedInUser.userType === "superAdmin"
      ) {
        navigate("/admin");
      } else if (loggedInUser.userType === "supervisor") {
        navigate("/supervisor");
      } else if (loggedInUser.userType === "employee") {
        navigate("/employee");
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
    <div className="flex min-h-screen items-center justify-center p-4">
      <form
        onSubmit={handleSubmit}
        className="w-full max-w-md space-y-6 rounded-xl border p-6 shadow-sm"
      >
        <div>
          <h1 className="text-2xl font-bold">ATM Maintenance</h1>
          <p className="text-muted-foreground">Login to your account</p>
        </div>

        {error && (
          <div className="rounded-md border border-red-300 bg-red-50 p-3 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="space-y-2">
          <label htmlFor="email" className="text-sm font-medium">
            Email
          </label>

          <input
            id="email"
            type="email"
            value={email}
            onChange={(event) => setEmail(event.target.value)}
            placeholder="Enter your email"
            required
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        <div className="space-y-2">
          <label htmlFor="password" className="text-sm font-medium">
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
            className="w-full rounded-md border px-3 py-2"
          />
        </div>

        <button
          type="submit"
          disabled={isLoading}
          className="w-full rounded-md bg-black px-4 py-2 text-white disabled:opacity-50"
        >
          {isLoading ? "Logging in..." : "Login"}
        </button>
      </form>
    </div>
  );
}
