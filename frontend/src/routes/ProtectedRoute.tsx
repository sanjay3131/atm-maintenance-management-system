import { Navigate, Outlet } from "react-router-dom";
import { useAuth } from "@/features/auth/auth-context";

interface ProtectedRouteProps {
  allowedRoles?: string[];
}

export default function ProtectedRoute({ allowedRoles }: ProtectedRouteProps) {
  const { user, isLoading } = useAuth();

  if (isLoading) {
    return <div>Loading...</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  if (allowedRoles && !allowedRoles.includes(user.userType)) {
    if (user.userType === "admin" || user.userType === "superAdmin") {
      return <Navigate to="/admin" replace />;
    }

    if (user.userType === "supervisor") {
      return <Navigate to="/supervisor" replace />;
    }

    if (user.userType === "employee") {
      return <Navigate to="/employee" replace />;
    }

    return <Navigate to="/login" replace />;
  }

  return <Outlet />;
}
