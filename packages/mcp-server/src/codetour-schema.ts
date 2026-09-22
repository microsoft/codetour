import Ajv from "ajv";
import draft04MetaSchema from "ajv/lib/refs/json-schema-draft-04.json";
import codetourSchema from "../schema.json";

// Validate output against the general CodeTour schema (draft-04): the server
// applies its stricter input schema, then guarantees that the generated file
// remains compatible with the existing consumer.
const ajv = new Ajv({ allErrors: true, meta: false, schemaId: "id" });
ajv.addMetaSchema(draft04MetaSchema);

export const validateCodetourTour = ajv.compile(codetourSchema);
