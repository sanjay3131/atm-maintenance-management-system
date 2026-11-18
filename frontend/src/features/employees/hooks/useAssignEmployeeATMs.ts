import { useMutation, useQueryClient } from "@tanstack/react-query";
import { assignEmployeeAtms } from "@/services/employee.service";

interface AssignEmployeeATMsVariables {
  employeeId: string;
  assignedAtmIds: string[];
}

export const useAssignEmployeeATMs = () => {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ employeeId, assignedAtmIds }: AssignEmployeeATMsVariables) =>
      assignEmployeeAtms(employeeId, assignedAtmIds),
    onSuccess: async (_employee, { employeeId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["atms"] }),
        queryClient.invalidateQueries({ queryKey: ["district-atms"] }),
        queryClient.invalidateQueries({ queryKey: ["region-atms"] }),
        queryClient.invalidateQueries({ queryKey: ["atm"] }),
        queryClient.invalidateQueries({ queryKey: ["employee", employeeId] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["employee-options"] }),
        queryClient.invalidateQueries({ queryKey: ["district-employees"] }),
        queryClient.invalidateQueries({ queryKey: ["region-employees"] }),
      ]);
    },
  });
};
