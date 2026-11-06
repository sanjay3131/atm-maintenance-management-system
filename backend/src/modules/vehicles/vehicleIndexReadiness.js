import ApiError from "../../utils/ApiError.js";
import Vehicle from "./vehicle.model.js";
import VehicleAssignment from "./vehicleAssignment.model.js";
import VehicleUsageSession from "./vehicleUsageSession.model.js";
import VehicleService from "./vehicleService.model.js";
import VehicleServicePolicy from "./vehicleServicePolicy.model.js";
import VehicleServiceReminder from "./vehicleServiceReminder.model.js";
import VehicleOdometerCorrection from "./vehicleOdometerCorrection.model.js";

const VEHICLE_MODELS = [
  Vehicle,
  VehicleAssignment,
  VehicleUsageSession,
  VehicleService,
  VehicleServicePolicy,
  VehicleServiceReminder,
  VehicleOdometerCorrection,
];

export const createVehicleIndexReadiness = (createIndex) => {
  let ready = false;
  let initialization;

  return {
    initialize() {
      if (!initialization) {
        initialization = Promise.all(
          VEHICLE_MODELS.flatMap((Model) =>
            Model.schema
              .indexes()
              .map(([fields, options]) => createIndex(Model, fields, options)),
          ),
        ).then(() => {
          ready = true;
        });
      }
      return initialization;
    },
    requireReady(_req, _res, next) {
      if (!ready) {
        return next(
          new ApiError(
            503,
            "Vehicle writes are unavailable until required indexes are ready",
          ),
        );
      }
      return next();
    },
    isReady: () => ready,
  };
};

const readiness = createVehicleIndexReadiness((Model, fields, options) =>
  Model.collection.createIndex(fields, options),
);

export const initializeVehicleIndexes = readiness.initialize;
export const requireVehicleIndexes = readiness.requireReady;
export const areVehicleIndexesReady = readiness.isReady;
