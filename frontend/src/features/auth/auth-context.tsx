import {
  createContext,
  useContext,
  useCallback,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from "react";
import axios from "axios";
import { useQueryClient } from "@tanstack/react-query";
import { wasAuthCleanupHandled } from "@/lib/axios";
import {
  getCurrentUser,
  loginAdmin,
  logout as logoutUser,
  refreshAccessToken,
  type LoginPayload,
} from "@/services/auth.service";

interface User {
  _id: string;
  firstName: string;
  lastName?: string;
  email: string;
  phoneNumber?: string;
  userType: string;
}

interface AuthContextType {
  user: User | null;
  accessToken: string | null;
  isLoading: boolean;
  initializationError: string | null;
  login: (payload: LoginPayload) => Promise<User>;
  logout: () => Promise<void>;
  retryAuthentication: () => Promise<void>;
  refreshSocketAccessToken: () => Promise<string>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const queryClient = useQueryClient();
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(
    localStorage.getItem("accessToken"),
  );
  const [isLoading, setIsLoading] = useState(true);
  const [initializationError, setInitializationError] = useState<string | null>(
    null,
  );
  const initializationPromise = useRef<Promise<void> | null>(null);

  const restoreSession = useCallback(async () => {
    try {
      let token = localStorage.getItem("accessToken");

      if (!token) {
        const refreshData = await refreshAccessToken();

        const newToken = refreshData.accessToken;

        localStorage.setItem("accessToken", newToken);
        setAccessToken(newToken);

        token = newToken;
      }

      const userData = await getCurrentUser();

      queryClient.clear();
      setAccessToken(localStorage.getItem("accessToken"));
      setUser(userData.user);
      setInitializationError(null);
    } catch (error: unknown) {
      queryClient.clear();
      setUser(null);

      const status = axios.isAxiosError(error)
        ? error.response?.status
        : undefined;
      const isAuthenticationFailure = status === 401 || status === 403;

      if (isAuthenticationFailure) {
        if (
          !wasAuthCleanupHandled(error) &&
          localStorage.getItem("accessToken")
        ) {
          localStorage.removeItem("accessToken");
        }
        setAccessToken(null);
        setInitializationError("Your session is no longer valid. Please sign in.");
      } else {
        setAccessToken(localStorage.getItem("accessToken"));
        setInitializationError(
          status && status >= 500
            ? "The authentication service is temporarily unavailable. Please retry."
            : "Unable to verify your session. Check your connection and retry.",
        );
      }
    } finally {
      setIsLoading(false);
    }
  }, [queryClient]);

  const retryAuthentication = useCallback(() => {
    if (initializationPromise.current) {
      return initializationPromise.current;
    }

    setIsLoading(true);
    setInitializationError(null);

    const promise = restoreSession();
    initializationPromise.current = promise;
    void promise.finally(() => {
      if (initializationPromise.current === promise) {
        initializationPromise.current = null;
      }
    });

    return promise;
  }, [restoreSession]);

  useEffect(() => {
    void retryAuthentication();
  }, [retryAuthentication]);

  const login = async (payload: LoginPayload): Promise<User> => {
    const data = await loginAdmin(payload);

    queryClient.clear();
    localStorage.setItem("accessToken", data.accessToken);

    setAccessToken(data.accessToken);
    setUser(data.user);
    setInitializationError(null);

    return data.user;
  };

  const logout = async () => {
    try {
      await logoutUser();
    } finally {
      queryClient.clear();
      localStorage.removeItem("accessToken");
      setAccessToken(null);
      setUser(null);
      setInitializationError(null);
    }
  };

  const refreshSocketAccessToken = useCallback(async () => {
    const refreshData = await refreshAccessToken();
    const token = refreshData.accessToken;
    if (typeof token !== "string" || !token) {
      throw new Error("Access token refresh returned no token");
    }
    localStorage.setItem("accessToken", token);
    setAccessToken(token);
    return token;
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isLoading,
        initializationError,
        login,
        logout,
        retryAuthentication,
        refreshSocketAccessToken,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const context = useContext(AuthContext);

  if (!context) {
    throw new Error("useAuth must be used inside AuthProvider");
  }

  return context;
}
