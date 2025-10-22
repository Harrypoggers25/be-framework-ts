// MODULES
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config({ path: './.env', quiet: true });

namespace Env {
    export type DataType = "string" | "number";

    type MappedDataType<T extends DataType> =
        T extends "string" ? string :
        T extends "number" ? number :
        never;

    type ConfigEntry<T extends DataType> = {
        type: T;
        default?: MappedDataType<T>;
    };

    export function define<T extends Record<string, ConfigEntry<DataType>>>(
        config: T,
        options?: { init?: boolean }
    ): { [K in keyof T]: MappedDataType<T[K]["type"]> } {
        const env: any = {};
        for (const [key, entry] of Object.entries(config)) {
            const val = process.env[key];
            if (val !== undefined && entry.type === "number") {
                const num = Number(val);
                env[key] = Number.isNaN(num)
                    ? (entry.default ?? 0)
                    : num;
                continue;
            }
            if (val !== undefined && entry.type !== "number") {
                env[key] = val || entry.default || "";
                continue;
            }
            if (val === undefined) {
                env[key] = entry.default !== undefined
                    ? entry.default
                    : entry.type === "number"
                        ? 0
                        : "";
            }
        }
        if (options?.init) {
            const keys = Object.keys(env).map(key => `${key}=${env[key]}`).join('\n');
            fs.writeFileSync(path.join(process.cwd(), '.env'), keys);
        }
        return env;
    }
}

export default Env;
