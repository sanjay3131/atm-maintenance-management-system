import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
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
  login: (payload: LoginPayload) => Promise<User>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [accessToken, setAccessToken] = useState<string | null>(
    localStorage.getItem("accessToken"),
  );
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const restoreSession = async () => {
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

        setUser(userData.user);
      } catch {
        localStorage.removeItem("accessToken");
        setAccessToken(null);
        setUser(null);
      } finally {
        setIsLoading(false);
      }
    };

    restoreSession();
  }, []);

  const login = async (payload: LoginPayload): Promise<User> => {
    const data = await loginAdmin(payload);

    localStorage.setItem("accessToken", data.accessToken);

    setAccessToken(data.accessToken);
    setUser(data.user);

    return data.user;
  };

  const logout = async () => {
    try {
      await logoutUser();
    } finally {
      localStorage.removeItem("accessToken");
      setAccessToken(null);
      setUser(null);
    }
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        accessToken,
        isLoading,
        login,
        logout,
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
