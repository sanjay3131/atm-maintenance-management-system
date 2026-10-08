import ApiError from "../../utils/ApiError.js";
import Item from "./item.model.js";

export const ITEM_NAME_INDEX = {
  fields: { normalizedName: 1 },
  options: { unique: true, name: "normalizedName_1" },
};

export const createItemIndexReadiness = (createIndex) => {
  let ready = false;
  let initialization;

  return {
    initialize() {
      if (!initialization) {
        initialization = Promise.resolve()
          .then(createIndex)
          .then(() => {
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
            "Item Master writes are unavailable because the required unique-name index is not ready",
          ),
        );
      }
      return next();
    },
  };
};

const itemIndexReadiness = createItemIndexReadiness(() =>
  Item.collection.createIndex(ITEM_NAME_INDEX.fields, ITEM_NAME_INDEX.options),
);

export const initializeItemNameIndex = itemIndexReadiness.initialize;
export const requireItemNameIndex = itemIndexReadiness.requireReady;
