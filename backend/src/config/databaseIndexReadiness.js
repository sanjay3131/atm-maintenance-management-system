import mongoose from "mongoose";
import District from "../modules/districts/district.models.js";

export const createDatabaseIndexInitializer = ({
  models,
  districtModel = District,
}) => {
  let initialization;

  return () => {
    if (!initialization) {
      initialization = (async () => {
        const registeredModels = models ?? Object.values(mongoose.models);
        await Promise.all(registeredModels.map((Model) => Model.init()));

        // District deliberately disables Mongoose autoIndex because its
        // geography indexes are managed explicitly. Build its declared
        // indexes only after the model collection is initialized.
        for (const [fields, options] of districtModel.schema.indexes()) {
          await districtModel.collection.createIndex(fields, options);
        }

        return {
          initializedModels: registeredModels.map((Model) => Model.modelName),
          districtIndexes: districtModel.schema.indexes().length,
        };
      })();
    }
    return initialization;
  };
};

export const initializeDatabaseIndexes = createDatabaseIndexInitializer({});
