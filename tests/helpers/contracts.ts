import Ajv2020, { type AnySchema, type ValidateFunction } from "ajv/dist/2020.js";
import addFormats from "ajv-formats";
import schema from "../../public/schemas/public-api-v1.schema.json";

const ajv = new Ajv2020({ allErrors: true, strict: true });
addFormats(ajv);
ajv.addSchema(schema as AnySchema);

const validators = new Map<string, ValidateFunction>();

export function assertPublicContract(definition: string, value: unknown): void {
  let validate = validators.get(definition);
  if (!validate) {
    validate = ajv.compile({ $ref: `${schema.$id}#/$defs/${definition}` });
    validators.set(definition, validate);
  }
  if (!validate(value)) {
    throw new Error(`${definition} contract drift: ${ajv.errorsText(validate.errors, { separator: "; " })}`);
  }
}
