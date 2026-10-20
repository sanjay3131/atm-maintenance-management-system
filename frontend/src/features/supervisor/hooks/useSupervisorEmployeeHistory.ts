import { useQuery } from "@tanstack/react-query";
import {
  getSupervisorEmployeeAMC,
  getSupervisorEmployeeAttendance,
  getSupervisorEmployeeJobs,
  type SupervisorEmployeeAMCQuery,
  type SupervisorEmployeeHistoryQuery,
} from "@/services/supervisor.service";

export const useSupervisorEmployeeAttendance = (
  params: SupervisorEmployeeHistoryQuery,
  enabled = true,
) =>
  useQuery({
    queryKey: ["supervisor-employee-attendance", params],
    queryFn: () => getSupervisorEmployeeAttendance(params),
    enabled: enabled && Boolean(params.employeeId),
    staleTime: 30_000,
  });

export const useSupervisorEmployeeJobs = (
  params: SupervisorEmployeeHistoryQuery,
  enabled = true,
) =>
  useQuery({
    queryKey: ["supervisor-employee-jobs", params],
    queryFn: () => getSupervisorEmployeeJobs(params),
    enabled: enabled && Boolean(params.employeeId),
    staleTime: 30_000,
  });

export const useSupervisorEmployeeAMC = (
  params: SupervisorEmployeeAMCQuery,
  enabled = true,
) =>
  useQuery({
    queryKey: ["supervisor-employee-amc", params],
    queryFn: () => getSupervisorEmployeeAMC(params),
    enabled: enabled && Boolean(params.employeeId),
    staleTime: 30_000,
  });
