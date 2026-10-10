import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  updateEmployee,
  type Employee,
  type UpdateEmployeePayload,
} from "@/services/employee.service";

export const useUpdateEmployee = () => {
  const queryClient = useQueryClient();

  return useMutation<
    Employee,
    Error,
    { employeeId: string; payload: UpdateEmployeePayload }
  >({
    mutationFn: ({ employeeId, payload }) =>
      updateEmployee(employeeId, payload),
    onSuccess: async (_employee, { employeeId }) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["employee", employeeId] }),
        queryClient.invalidateQueries({ queryKey: ["employees"] }),
        queryClient.invalidateQueries({ queryKey: ["district-employees"] }),
        queryClient.invalidateQueries({ queryKey: ["region-employees"] }),
      ]);
    },
  });
};
