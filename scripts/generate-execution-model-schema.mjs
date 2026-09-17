import { writeFile } from 'node:fs/promises';
import { z } from 'zod';
import { ExecutionIntentSchema } from '../dist/core/models/execution-model.js';

const jsonSchema = z.toJSONSchema(ExecutionIntentSchema, {
  target: 'draft-2020-12',
  unrepresentable: 'any',
});

await writeFile('schemas/execution-model.json', `${JSON.stringify(jsonSchema, null, 2)}\n`);
